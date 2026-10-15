package contact

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/mail"
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
	mailPerHour   = 10
	mailPerDay    = 50
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
		`CREATE TABLE IF NOT EXISTS contact_retryable_submissions (submission_id TEXT PRIMARY KEY)`,
		`CREATE TABLE IF NOT EXISTS contact_mail_attempts (id INTEGER PRIMARY KEY, attempted_at INTEGER NOT NULL)`,
		`CREATE INDEX IF NOT EXISTS contact_mail_attempts_time ON contact_mail_attempts(attempted_at)`,
		`CREATE TABLE IF NOT EXISTS contact_submissions (submission_id TEXT PRIMARY KEY, challenge_salt TEXT NOT NULL UNIQUE, request_digest TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','sent')))`,
		`CREATE INDEX IF NOT EXISTS contact_submissions_created_at ON contact_submissions(created_at)`,
		`CREATE TABLE IF NOT EXISTS contact_challenge_uses (challenge_salt TEXT PRIMARY KEY, submission_id TEXT NOT NULL, created_at INTEGER NOT NULL)`,
		`CREATE INDEX IF NOT EXISTS contact_challenge_uses_created_at ON contact_challenge_uses(created_at)`,
	} {
		if _, err := db.Exec(q); err != nil {
			db.Close()
			return nil, err
		}
	}
	if err := ensureDigestColumn(db); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec(`INSERT OR IGNORE INTO contact_challenge_uses(challenge_salt,submission_id,created_at) SELECT challenge_salt,submission_id,created_at FROM contact_submissions`); err != nil {
		db.Close()
		return nil, err
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
	msg := Message{Name: strings.TrimSpace(req.Name), Email: strings.TrimSpace(req.Email), Category: req.Category, Body: strings.TrimSpace(req.Message), SubmissionID: req.SubmissionID}
	digest := h.requestDigest(msg)
	if err := h.reserve(req.SubmissionID, salt, digest); err != nil {
		if errors.Is(err, errDuplicateSent) {
			writeJSON(w, 200, response{Status: "sent"})
			return
		}
		if errors.Is(err, errMailVolume) {
			w.Header().Set("Retry-After", "3600")
			writeError(w, http.StatusTooManyRequests, "mail_limit_reached")
			return
		}
		if errors.Is(err, errSubmissionConflict) || errors.Is(err, errChallengeUsed) {
			writeError(w, http.StatusConflict, "submission_unconfirmed")
			return
		}
		writeError(w, 503, "temporarily_unavailable")
		return
	}
	if err := h.mailer.Send(msg); err != nil {
		var safe *retryableDeliveryError
		if errors.As(err, &safe) {
			// Keep the original payload digest, challenge binding, and attempt budget.
			_, _ = h.db.Exec(`INSERT OR IGNORE INTO contact_retryable_submissions(submission_id) VALUES(?)`, req.SubmissionID)
			w.Header().Set("Retry-After", "60")
			writeError(w, http.StatusServiceUnavailable, "delivery_temporarily_unavailable")
			return
		}
		writeError(w, http.StatusServiceUnavailable, "delivery_unconfirmed")
		return
	}
	if _, err := h.db.Exec(`UPDATE contact_submissions SET status='sent' WHERE submission_id=?`, req.SubmissionID); err != nil {
		writeError(w, http.StatusServiceUnavailable, "delivery_unconfirmed")
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

var (
	errMailVolume         = errors.New("outbound message budget exhausted")
	errDuplicateSent      = errors.New("matching submission already sent")
	errSubmissionConflict = errors.New("submission id is already reserved")
	errChallengeUsed      = errors.New("challenge was already used")
)

func ensureDigestColumn(db *sql.DB) error {
	rows, err := db.Query(`PRAGMA table_info(contact_submissions)`)
	if err != nil {
		return err
	}
	found := false
	for rows.Next() {
		var cid, notnull, pk int
		var name, typ string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &typ, &notnull, &defaultValue, &pk); err != nil {
			_ = rows.Close()
			return err
		}
		if name == "request_digest" {
			found = true
			break
		}
	}
	rowErr := rows.Err()
	if err := rows.Close(); err != nil {
		return err
	}
	if rowErr != nil {
		return rowErr
	}
	if found {
		return nil
	}
	_, err = db.Exec(`ALTER TABLE contact_submissions ADD COLUMN request_digest TEXT NOT NULL DEFAULT ''`)
	return err
}

func (h *Handler) requestDigest(msg Message) string {
	canonical, _ := json.Marshal([]string{strings.TrimSpace(msg.Name), strings.ToLower(strings.TrimSpace(msg.Email)), msg.Category, strings.TrimSpace(msg.Body)})
	mac := hmac.New(sha256.New, h.secret)
	_, _ = mac.Write(canonical)
	return hex.EncodeToString(mac.Sum(nil))
}

func (h *Handler) reserve(id, salt, digest string) error {
	tx, err := h.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	cutoff := time.Now().Add(-30 * 24 * time.Hour).Unix()
	if _, err = tx.Exec(`DELETE FROM contact_challenge_uses WHERE created_at < ?`, cutoff); err != nil {
		return err
	}
	if _, err = tx.Exec(`DELETE FROM contact_submissions WHERE created_at < ?`, cutoff); err != nil {
		return err
	}
	var challengeSubmissionID string
	err = tx.QueryRow(`SELECT submission_id FROM contact_challenge_uses WHERE challenge_salt=?`, salt).Scan(&challengeSubmissionID)
	if err == nil && challengeSubmissionID != id {
		if err := tx.Commit(); err != nil {
			return err
		}
		return errChallengeUsed
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if errors.Is(err, sql.ErrNoRows) {
		if _, err = tx.Exec(`INSERT INTO contact_challenge_uses(challenge_salt,submission_id,created_at) VALUES(?,?,?)`, salt, id, time.Now().Unix()); err != nil {
			return err
		}
	}
	var status, storedDigest string
	err = tx.QueryRow(`SELECT status, request_digest FROM contact_submissions WHERE submission_id=?`, id).Scan(&status, &storedDigest)
	switch {
	case err == nil:
		if status == "sent" && storedDigest == digest {
			if err := tx.Commit(); err != nil {
				return err
			}
			return errDuplicateSent
		}
		if status != "pending" || storedDigest != digest {
			return errSubmissionConflict
		}
		result, deleteErr := tx.Exec(`DELETE FROM contact_retryable_submissions WHERE submission_id=?`, id)
		if deleteErr != nil {
			return deleteErr
		}
		deleted, deleteErr := result.RowsAffected()
		if deleteErr != nil {
			return deleteErr
		}
		if deleted != 1 {
			return errSubmissionConflict
		}
	case !errors.Is(err, sql.ErrNoRows):
		return err
	}
	if _, err = tx.Exec(`DELETE FROM contact_retryable_submissions WHERE submission_id NOT IN (SELECT submission_id FROM contact_submissions)`); err != nil {
		return err
	}
	now := time.Now().Unix()
	if _, err = tx.Exec(`DELETE FROM contact_mail_attempts WHERE attempted_at < ?`, now-2*86400); err != nil {
		return err
	}
	var hourly, daily int
	if err = tx.QueryRow(`SELECT COALESCE(SUM(attempted_at>=?),0),COUNT(*) FROM contact_mail_attempts WHERE attempted_at>=?`, now-3600, now-86400).Scan(&hourly, &daily); err != nil {
		return err
	}
	if hourly >= mailPerHour || daily >= mailPerDay {
		return errMailVolume
	}
	if _, err = tx.Exec(`INSERT INTO contact_mail_attempts(attempted_at) VALUES(?)`, now); err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT OR IGNORE INTO contact_submissions(submission_id,challenge_salt,request_digest,created_at,status) VALUES(?,?,?,?,'pending')`, id, salt, digest, time.Now().Unix()); err != nil {
		return err
	}
	return tx.Commit()
}

func (h *Handler) checkOrigin(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		if r.Method != http.MethodGet {
			writeError(w, 403, "origin_required")
			return false
		}
		if r.Header.Get("Sec-Fetch-Site") == "same-origin" {
			if h.origin != "" {
				configured, err := url.Parse(h.origin)
				if err != nil || !strings.EqualFold(configured.Host, r.Host) {
					writeError(w, 403, "origin_denied")
					return false
				}
			}
		} else {
			ref, err := url.Parse(r.Header.Get("Referer"))
			if err != nil || ref.Scheme == "" || ref.Host == "" || !h.matchesOrigin(ref.Scheme+"://"+ref.Host, r) {
				writeError(w, 403, "origin_required")
				return false
			}
		}
		return true
	}
	if !h.matchesOrigin(origin, r) {
		writeError(w, 403, "origin_denied")
		return false
	}
	return true
}

func (h *Handler) matchesOrigin(origin string, r *http.Request) bool {
	if h.origin != "" {
		return origin == h.origin
	}
	u, err := url.Parse(origin)
	return err == nil && u.Host != "" && strings.EqualFold(u.Host, r.Host)
}

func (h *Handler) allow(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer := net.ParseIP(host)
	if peer != nil && peer.IsLoopback() {
		if ip := net.ParseIP(strings.TrimSpace(r.Header.Get("X-Real-IP"))); ip != nil {
			host = ip.String()
		} else {
			// Only trust proxy metadata when the connection itself came from loopback.
			forwarded := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
			if len(forwarded) > 0 {
				candidate := strings.TrimSpace(forwarded[len(forwarded)-1])
				if ip := net.ParseIP(candidate); ip != nil {
					host = ip.String()
				}
			}
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
