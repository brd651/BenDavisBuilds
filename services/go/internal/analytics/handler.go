package analytics

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

const maxBody = 16 << 10
const sessionTTL = 30 * time.Minute

var noncePattern = regexp.MustCompile(`^[a-fA-F0-9]{32}$`)
var allowedTypes = map[string]bool{"pageview": true, "engagement": true, "scroll": true, "navigation_click": true, "social_click": true, "project_interaction": true, "contact_intent": true, "contact_submitted": true, "mentorship_intent": true, "booking_intent": true}
var pathPattern = regexp.MustCompile(`^/[A-Za-z0-9/_~.-]{0,180}$`)
var tokenPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$`)

type Handler struct {
	DB           *sql.DB
	Secret       []byte
	Origin       string
	AllowedPaths map[string]bool
	now          func() time.Time
	mu           sync.Mutex
	limits       map[string]bucket
}
type bucket struct {
	start time.Time
	count int
}
type request struct {
	SessionID string  `json:"session_id"`
	VisitorID string  `json:"visitor_id,omitempty"`
	Consent   bool    `json:"consent,omitempty"`
	Events    []event `json:"events"`
}
type event struct {
	ID         string                     `json:"id"`
	Type       string                     `json:"type"`
	Path       string                     `json:"path"`
	Properties map[string]json.RawMessage `json:"properties,omitempty"`
}

func NewHandler(db *sql.DB, secret []byte, origin string) *Handler {
	return &Handler{DB: db, Secret: append([]byte(nil), secret...), Origin: strings.TrimRight(origin, "/"), now: time.Now, limits: map[string]bucket{}}
}
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.Path == "/healthz" && r.Method == http.MethodGet {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.URL.Path != "/api/telemetry" {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	mediaType, _, mediaErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaErr != nil || mediaType != "application/json" {
		http.Error(w, "application/json required", http.StatusUnsupportedMediaType)
		return
	}
	if h.DB == nil || len(h.Secret) < 32 {
		http.Error(w, "collector unavailable", http.StatusServiceUnavailable)
		return
	}
	if h.Origin != "" && r.Header.Get("Origin") != h.Origin {
		http.Error(w, "request rejected", http.StatusForbidden)
		return
	}
	ua := strings.ToLower(r.UserAgent())
	if ua == "" || strings.Contains(ua, "bot") || strings.Contains(ua, "crawler") || strings.Contains(ua, "spider") {
		http.Error(w, "request rejected", http.StatusForbidden)
		return
	}
	if !h.allow(ipOf(r)) {
		http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req request
	if err := dec.Decode(&req); err != nil {
		http.Error(w, "invalid event batch", http.StatusBadRequest)
		return
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		http.Error(w, "invalid event batch", http.StatusBadRequest)
		return
	}
	if !noncePattern.MatchString(req.SessionID) || len(req.Events) == 0 || len(req.Events) > 20 || (req.Consent && !noncePattern.MatchString(req.VisitorID)) {
		http.Error(w, "invalid event batch", http.StatusBadRequest)
		return
	}
	clean := make([]event, len(req.Events))
	for i, e := range req.Events {
		if !validEvent(e, h.AllowedPaths) || (h.AllowedPaths != nil && !h.AllowedPaths[e.Path]) {
			http.Error(w, "invalid event batch", http.StatusBadRequest)
			return
		}
		if raw, ok := e.Properties["referrer"]; ok {
			var ref string
			_ = json.Unmarshal(raw, &ref)
			host := sanitizeHost(ref)
			e.Properties["referrer"], _ = json.Marshal(host)
		}
		clean[i] = e
	}
	if err := h.store(r, req, clean); err != nil {
		http.Error(w, "event batch unavailable", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func validEvent(e event, allowedPaths map[string]bool) bool {
	if !noncePattern.MatchString(e.ID) || !allowedTypes[e.Type] || !pathPattern.MatchString(e.Path) || strings.Contains(e.Path, "..") || strings.ContainsAny(e.Path, "?#") {
		return false
	}
	keys := map[string]bool{}
	switch e.Type {
	case "pageview":
		keys = map[string]bool{"referrer": true, "utm_source": true, "utm_medium": true, "utm_campaign": true}
	case "engagement":
		keys = map[string]bool{"kind": true, "seconds": true}
	case "scroll":
		keys = map[string]bool{"milestone": true}
	case "navigation_click":
		keys = map[string]bool{"destination": true}
	case "social_click":
		keys = map[string]bool{"destination": true}
	case "project_interaction":
		keys = map[string]bool{"project": true, "action": true}
	case "contact_intent", "contact_submitted":
		keys = map[string]bool{"category": true}
	case "mentorship_intent":
		keys = map[string]bool{"action": true}
	case "booking_intent":
		keys = map[string]bool{"provider": true}
	}
	for k, raw := range e.Properties {
		if !keys[k] {
			return false
		}
		if len(raw) > 256 {
			return false
		}
		var s string
		var n json.Number
		switch k {
		case "referrer":
			if json.Unmarshal(raw, &s) != nil || sanitizeHost(s) == "" {
				return false
			}
		case "utm_source", "utm_medium", "utm_campaign":
			if json.Unmarshal(raw, &s) != nil || !safeToken(s, 60) {
				return false
			}
		case "kind":
			if json.Unmarshal(raw, &s) != nil || (s != "article" && s != "page") {
				return false
			}
		case "action":
			if json.Unmarshal(raw, &s) != nil || (s != "open" && s != "toggle" && s != "select") {
				return false
			}
		case "category":
			if json.Unmarshal(raw, &s) != nil || (s != "general" && s != "leadership" && s != "project" && s != "mentorship") {
				return false
			}
		case "provider":
			if json.Unmarshal(raw, &s) != nil || (s != "calendly" && s != "google-calendar") {
				return false
			}
		case "destination":
			if json.Unmarshal(raw, &s) != nil {
				return false
			}
			if e.Type == "social_click" {
				if s != "linkedin" && s != "github" && s != "x" {
					return false
				}
			} else if !knownPathSlug(s, allowedPaths) {
				return false
			}
		case "project":
			if json.Unmarshal(raw, &s) != nil || !knownPathSlug(s, allowedPaths) {
				return false
			}
		case "seconds", "milestone":
			d := json.NewDecoder(strings.NewReader(string(raw)))
			d.UseNumber()
			if d.Decode(&n) != nil {
				return false
			}
			f, err := n.Float64()
			if err != nil || f < 0 || f > 100000 || (k == "milestone" && (f != 25 && f != 50 && f != 75 && f != 90 && f != 100)) {
				return false
			}
		}
	}
	return true
}
func knownPathSlug(slug string, paths map[string]bool) bool {
	if !safeToken(slug, 60) {
		return false
	}
	if paths == nil {
		return false
	}
	for path := range paths {
		candidate := strings.Trim(path, "/")
		if candidate == "" {
			candidate = "home"
		}
		candidate = strings.ReplaceAll(candidate, "/", "-")
		if len(candidate) > 60 {
			continue
		}
		if slug == candidate {
			return true
		}
	}
	return false
}
func safeToken(s string, max int) bool {
	return len(s) <= max && tokenPattern.MatchString(s)
}
func sanitizeHost(s string) string {
	u, err := url.Parse(s)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return ""
	}
	host := strings.ToLower(u.Hostname())
	if len(host) > 253 || strings.Contains(host, "@") {
		return ""
	}
	return host
}
func (h *Handler) digest(label, value string) string {
	m := hmac.New(sha256.New, h.Secret)
	m.Write([]byte(label + "\x00" + value))
	return hex.EncodeToString(m.Sum(nil))
}
func (h *Handler) store(r *http.Request, req request, events []event) error {
	now := h.now().UTC().Unix()
	sessionKey := h.digest("session", req.SessionID)
	visitorID := ""
	if req.Consent {
		visitorID = h.digest("visitor", req.VisitorID)
	}
	tx, err := h.DB.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if visitorID != "" {
		if _, err = tx.ExecContext(r.Context(), `INSERT INTO visitors(id,first_seen,last_seen) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen`, visitorID, now, now); err != nil {
			return err
		}
	}
	var sessionID string
	var last int64
	err = tx.QueryRowContext(r.Context(), "SELECT id,last_seen FROM sessions WHERE session_key=?", sessionKey).Scan(&sessionID, &last)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if errors.Is(err, sql.ErrNoRows) || now-last > int64(sessionTTL.Seconds()) {
		if !errors.Is(err, sql.ErrNoRows) {
			if _, err = tx.ExecContext(r.Context(), "UPDATE sessions SET session_key=NULL WHERE id=?", sessionID); err != nil {
				return err
			}
		}
		sessionID, err = randomID()
		if err != nil {
			return err
		}
		if visitorID == "" {
			visitorID = ""
		}
		source, us, um, uc := attribution(events)
		_, err = tx.ExecContext(r.Context(), `INSERT INTO sessions(id,visitor_id,started_at,last_seen,source,utm_source,utm_medium,utm_campaign,session_key) VALUES(?,?,?,?,?,?,?,?,?)`, sessionID, nullString(visitorID), now, now, source, us, um, uc, sessionKey)
		if err != nil {
			return err
		}
	} else {
		if req.Consent {
			_, err = tx.ExecContext(r.Context(), "UPDATE sessions SET last_seen=?,visitor_id=COALESCE(visitor_id,?) WHERE id=?", now, nullString(visitorID), sessionID)
		} else {
			_, err = tx.ExecContext(r.Context(), "UPDATE sessions SET last_seen=?,visitor_id=NULL WHERE id=?", now, sessionID)
		}
		if err != nil {
			return err
		}
	}
	for _, e := range events {
		properties := e.Properties
		if properties == nil {
			properties = map[string]json.RawMessage{}
		}
		props, err := json.Marshal(properties)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(r.Context(), `INSERT OR IGNORE INTO events(id,session_id,type,path,occurred_at,properties) VALUES(?,?,?,?,?,?)`, strings.ToLower(e.ID), sessionID, e.Type, e.Path, now, string(props))
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}
func attribution(events []event) (source, us, um, uc string) {
	for _, e := range events {
		if e.Type != "pageview" {
			continue
		}
		get := func(k string) string { var s string; _ = json.Unmarshal(e.Properties[k], &s); return s }
		source = get("referrer")
		us = get("utm_source")
		um = get("utm_medium")
		uc = get("utm_campaign")
		break
	}
	return
}
func nullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}
func randomID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
func ipOf(r *http.Request) string {
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		if addr := net.ParseIP(host); addr != nil && addr.IsLoopback() {
			forwarded := net.ParseIP(strings.TrimSpace(r.Header.Get("X-Real-IP")))
			if forwarded != nil {
				return forwarded.String()
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return "unknown"
	}
	return host
}
func (h *Handler) allow(ip string) bool {
	key := h.digest("rate", ip)
	now := h.now()
	h.mu.Lock()
	defer h.mu.Unlock()
	for k, b := range h.limits {
		if now.Sub(b.start) > 2*time.Minute {
			delete(h.limits, k)
		}
	}
	if len(h.limits) > 4096 {
		return false
	}
	b := h.limits[key]
	if now.Sub(b.start) >= time.Minute || b.start.IsZero() {
		b = bucket{start: now}
	}
	if b.count >= 60 {
		h.limits[key] = b
		return false
	}
	b.count++
	h.limits[key] = b
	return true
}

// Retain removes expired events and then unreferenced sessions and visitors.
func Retain(ctx context.Context, db *sql.DB, days int) error {
	if days < 1 {
		return errors.New("retention days must be positive")
	}
	cutoff := time.Now().UTC().Add(-time.Duration(days) * 24 * time.Hour).Unix()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "DELETE FROM events WHERE occurred_at < ?", cutoff); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM sessions WHERE last_seen < ? AND NOT EXISTS (SELECT 1 FROM events WHERE events.session_id=sessions.id)", cutoff); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM visitors WHERE last_seen < ? AND NOT EXISTS (SELECT 1 FROM sessions WHERE sessions.visitor_id=visitors.id)", cutoff); err != nil {
		return err
	}
	return tx.Commit()
}
