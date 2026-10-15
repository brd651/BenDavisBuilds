package contact

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	altcha "github.com/altcha-org/altcha-lib-go"
	_ "modernc.org/sqlite"
)

const (
	maxBodyBytes  = 16 << 10
	challengeTTL  = 5 * time.Minute
	challengeWork = 250_000
)

var (
	submissionIDPattern = regexp.MustCompile(`^[a-fA-F0-9]{32}$`)
	validCategories     = map[string]bool{"general": true, "leadership": true, "project": true, "mentorship": true}
)

type Message struct {
	Name, Email, Category, Body string
	SubmissionID                string
}

type Mailer interface{ Send(Message) error }

type Config struct {
	DBPath string
	Secret []byte
	Origin string
	Mailer Mailer
}

type Handler struct {
	db     *sql.DB
	secret []byte
	origin string
	mailer Mailer
	mu     sync.Mutex
	rate   map[string][]time.Time
}

type request struct {
	Name         string `json:"name"`
	Email        string `json:"email"`
	Category     string `json:"category"`
	Message      string `json:"message"`
	Website      string `json:"website"`
	ALTCHA       string `json:"altcha"`
	SubmissionID string `json:"submission_id"`
}

type response struct {
	Status string `json:"status,omitempty"`
	Error  string `json:"error,omitempty"`
}

func New(cfg Config) (*Handler, error) {
	if len(cfg.Secret) < 32 {
		return nil, errors.New("contact secret must be at least 32 bytes")
	}
	if cfg.DBPath == "" {
		return nil, errors.New("contact database path required")
	}
	if cfg.Origin != "" {
		u, err := url.Parse(cfg.Origin)
		if err != nil || u.Scheme == "" || u.Host == "" || u.Path != "" {
			return nil, errors.New("invalid allowed origin")
		}
	}
	dbDir := dirOf(cfg.DBPath)
	if err := os.MkdirAll(dbDir, 0700); err != nil {
		return nil, err
	}
	dirInfo, err := os.Stat(dbDir)
	if err != nil || !dirInfo.IsDir() || dirInfo.Mode().Perm()&0077 != 0 {
		return nil, errors.New("contact database directory must be private")
	}
	db, err := sql.Open("sqlite", cfg.DBPath)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	for _, q := range []string{
		`PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`, `PRAGMA busy_timeout=5000`,
		`CREATE TABLE IF NOT EXISTS contact_submissions (submission_id TEXT PRIMARY KEY, challenge_salt TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','sent')))`,
		`CREATE INDEX IF NOT EXISTS contact_submissions_created_at ON contact_submissions(created_at)`,
	} {
		if _, err := db.Exec(q); err != nil {
			db.Close()
			return nil, err
		}
	}
	if err := os.Chmod(cfg.DBPath, 0600); err != nil {
		db.Close()
		return nil, err
	}
	return &Handler{db: db, secret: append([]byte(nil), cfg.Secret...), origin: cfg.Origin, mailer: cfg.Mailer, rate: map[string][]time.Time{}}, nil
}

func dirOf(path string) string {
	i := strings.LastIndex(path, "/")
	if i < 1 {
		return "."
	}
	return path[:i]
}

func (h *Handler) Close() error { return h.db.Close() }

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	switch {
	case r.URL.Path == "/healthz" && r.Method == http.MethodGet:
		writeJSON(w, 200, map[string]bool{"delivery_enabled": h.mailer != nil})
	case r.URL.Path == "/api/contact/challenge" && r.Method == http.MethodGet:
		h.challenge(w, r)
	case r.URL.Path == "/api/contact" && r.Method == http.MethodPost:
		h.submit(w, r)
	default:
		writeError(w, http.StatusNotFound, "not_found")
	}
}

func (h *Handler) challenge(w http.ResponseWriter, r *http.Request) {
	if h.mailer == nil {
		writeError(w, http.StatusServiceUnavailable, "delivery_unavailable")
		return
	}
	if !h.checkOrigin(w, r) {
		return
	}
	if !h.allow(r) {
		writeError(w, http.StatusTooManyRequests, "try_later")
		return
	}
	expires := time.Now().Add(challengeTTL)
	c, err := altcha.CreateChallenge(altcha.ChallengeOptions{Algorithm: altcha.SHA256, MaxNumber: challengeWork, HMACKey: string(h.secret), SaltLength: 24, Expires: &expires})
	if err != nil {
		writeError(w, 500, "unavailable")
		return
	}
	writeJSON(w, 200, c)
}

func (h *Handler) submit(w http.ResponseWriter, r *http.Request) {
	if h.mailer == nil {
		writeError(w, http.StatusServiceUnavailable, "delivery_unavailable")
		return
	}
	if !h.checkOrigin(w, r) {
		return
	}
	if !h.allow(r) {
		writeError(w, http.StatusTooManyRequests, "try_later")
		return
	}
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		writeError(w, http.StatusUnsupportedMediaType, "content_type_required")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req request
	if err := dec.Decode(&req); err != nil {
		writeError(w, 400, "invalid_request")
		return
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		writeError(w, 400, "invalid_request")
		return
	}
	if req.Website != "" {
		writeJSON(w, 200, response{Status: "sent"})
		return
	}
	if err := validate(req); err != nil {
		writeError(w, 400, "invalid_request")
		return
	}
	var p altcha.Payload
	_, err := decodePayload(req.ALTCHA, &p)
	if err != nil {
		writeError(w, 400, "invalid_challenge")
		return
	}
	ok, err := altcha.VerifySolutionSafe(req.ALTCHA, string(h.secret), true)
	if err != nil || !ok || p.Algorithm != "SHA-256" || p.Number < 0 || p.Number > challengeWork {
		writeError(w, 400, "invalid_challenge")
		return
	}
	params := altcha.ExtractParams(p)
	expUnix, err := parseExpiry(params.Get("expires"))
	if err != nil || time.Now().Unix() > expUnix || time.Until(time.Unix(expUnix, 0)) > challengeTTL+time.Second {
		writeError(w, 400, "invalid_challenge")
		return
	}
	salt := p.Salt
	if err := h.reserve(req.SubmissionID, salt); err != nil {
		if errors.Is(err, errDuplicate) {
			writeJSON(w, 200, response{Status: "sent"})
			return
		}
		writeError(w, 503, "temporarily_unavailable")
		return
	}
	msg := Message{Name: strings.TrimSpace(req.Name), Email: strings.TrimSpace(req.Email), Category: req.Category, Body: strings.TrimSpace(req.Message), SubmissionID: req.SubmissionID}
	if err := h.mailer.Send(msg); err != nil {
		h.unreserve(req.SubmissionID)
		writeError(w, 502, "delivery_failed")
		return
	}
	if _, err := h.db.Exec(`UPDATE contact_submissions SET status='sent' WHERE submission_id=?`, req.SubmissionID); err != nil {
		writeError(w, 503, "temporarily_unavailable")
		return
	}
	writeJSON(w, 200, response{Status: "sent"})
}

func decodePayload(encoded string, p *altcha.Payload) ([]byte, error) {
	if len(encoded) > 4096 {
		return nil, errors.New("payload too large")
	}
	decoded, err := decodeBase64(encoded)
	if err != nil {
		return nil, err
	}
	dec := json.NewDecoder(strings.NewReader(string(decoded)))
	dec.DisallowUnknownFields()
	if err = dec.Decode(p); err != nil {
		return nil, err
	}
	var trailing any
	if err = dec.Decode(&trailing); err != io.EOF {
		return nil, errors.New("invalid challenge payload")
	}
	return decoded, nil
}

func decodeBase64(s string) ([]byte, error) {
	// ALTCHA browser widgets produce standard base64; RawStdEncoding is accepted for URL-safe clients.
	if b, e := base64.StdEncoding.DecodeString(s); e == nil {
		return b, nil
	}
	return base64.RawStdEncoding.DecodeString(s)
}

func validate(r request) error {
	if !submissionIDPattern.MatchString(r.SubmissionID) || !validCategories[r.Category] {
		return errors.New("invalid fields")
	}
	name := strings.TrimSpace(r.Name)
	body := strings.TrimSpace(r.Message)
	email := strings.TrimSpace(r.Email)
	if len(name) < 1 || len(name) > 100 || len(body) < 1 || len(body) > 5000 || len(email) > 254 || strings.ContainsAny(name+body, "\x00\r") {
		return errors.New("invalid fields")
	}
	if strings.ContainsAny(email, "\r\n") {
		return errors.New("invalid email")
	}
	a, err := mail.ParseAddress(email)
	if err != nil || a.Address != email || strings.ContainsAny(a.Address, " <>\r\n") {
		return errors.New("invalid email")
	}
	return nil
}

var errDuplicate = errors.New("duplicate submission")

func (h *Handler) reserve(id, salt string) error {
	_, err := h.db.Exec(`DELETE FROM contact_submissions WHERE created_at < ? AND status='sent'`, time.Now().Add(-30*24*time.Hour).Unix())
	if err != nil {
		return err
	}
	_, err = h.db.Exec(`INSERT INTO contact_submissions(submission_id,challenge_salt,created_at,status) VALUES(?,?,?,'pending')`, id, salt, time.Now().Unix())
	if err != nil {
		var count int
		if e := h.db.QueryRow(`SELECT COUNT(*) FROM contact_submissions WHERE submission_id=? OR challenge_salt=?`, id, salt).Scan(&count); e == nil && count > 0 {
			return errDuplicate
		}
		return err
	}
	return nil
}
func (h *Handler) unreserve(id string) {
	_, _ = h.db.Exec(`DELETE FROM contact_submissions WHERE submission_id=? AND status='pending'`, id)
}

func (h *Handler) checkOrigin(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		writeError(w, 403, "origin_required")
		return false
	}
	if h.origin != "" {
		if origin != h.origin {
			writeError(w, 403, "origin_denied")
			return false
		}
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || !strings.EqualFold(u.Host, r.Host) {
		writeError(w, 403, "origin_denied")
		return false
	}
	return true
}

func (h *Handler) allow(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	// The service only listens on loopback behind Caddy. Caddy appends the
	// connected client address to X-Forwarded-For; use its final valid entry.
	forwarded := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	if len(forwarded) > 0 {
		candidate := strings.TrimSpace(forwarded[len(forwarded)-1])
		if ip := net.ParseIP(candidate); ip != nil {
			host = ip.String()
		}
	}
	mac := hmac.New(sha256.New, h.secret)
	_, _ = mac.Write([]byte(host))
	key := hex.EncodeToString(mac.Sum(nil))
	now := time.Now()
	h.mu.Lock()
	defer h.mu.Unlock()
	for k, v := range h.rate {
		kept := v[:0]
		for _, t := range v {
			if now.Sub(t) < time.Minute {
				kept = append(kept, t)
			}
		}
		if len(kept) == 0 {
			delete(h.rate, k)
		} else {
			h.rate[k] = kept
		}
	}
	if _, exists := h.rate[key]; !exists && len(h.rate) >= 4096 {
		return false
	}
	if len(h.rate[key]) >= 5 {
		return false
	}
	h.rate[key] = append(h.rate[key], now)
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, response{Error: code})
}
func parseExpiry(s string) (int64, error) {
	if s == "" {
		return 0, errors.New("missing expiry")
	}
	return strconv.ParseInt(s, 10, 64)
}

type SMTPConfig struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
	From     string `json:"from"`
	To       string `json:"to"`
}

func NewSMTPMailer(c SMTPConfig) (Mailer, error) {
	if c.Host != "smtp.gmail.com" || (c.Port != 465 && c.Port != 587) || c.Username == "" || c.Password == "" {
		return nil, errors.New("invalid Gmail SMTP configuration")
	}
	from, err := mail.ParseAddress(c.From)
	if err != nil || from.Address != c.From {
		return nil, errors.New("invalid sender")
	}
	to, err := mail.ParseAddress(c.To)
	if err != nil || to.Address != "hello@bendavisbuilds.com" {
		return nil, errors.New("invalid recipient")
	}
	return smtpMailer{cfg: c}, nil
}

type smtpMailer struct{ cfg SMTPConfig }

func (m smtpMailer) Send(msg Message) error {
	from, _ := mail.ParseAddress(m.cfg.From)
	to, _ := mail.ParseAddress(m.cfg.To)
	body := fmt.Sprintf("From: %s\r\nTo: %s\r\nReply-To: %s\r\nSubject: Ben Davis Builds contact: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nName: %s\nEmail: %s\nCategory: %s\nSubmission: %s\n\n%s\n", from.Address, to.Address, msg.Email, msg.Category, msg.Name, msg.Email, msg.Category, msg.SubmissionID, msg.Body)
	auth := smtp.PlainAuth("", m.cfg.Username, m.cfg.Password, m.cfg.Host)
	addr := net.JoinHostPort(m.cfg.Host, strconv.Itoa(m.cfg.Port))
	if m.cfg.Port == 465 {
		conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
		if err != nil {
			return err
		}
		tlsConn := tls.Client(conn, &tls.Config{ServerName: m.cfg.Host, MinVersion: tls.VersionTLS12})
		defer tlsConn.Close()
		client, err := smtp.NewClient(tlsConn, m.cfg.Host)
		if err != nil {
			return err
		}
		defer client.Close()
		if err = client.Auth(auth); err != nil {
			return err
		}
		if err = client.Mail(from.Address); err != nil {
			return err
		}
		if err = client.Rcpt(to.Address); err != nil {
			return err
		}
		w, err := client.Data()
		if err != nil {
			return err
		}
		if _, err = w.Write([]byte(body)); err != nil {
			return err
		}
		return w.Close()
	}
	return smtp.SendMail(addr, auth, from.Address, []string{to.Address}, []byte(body))
}
