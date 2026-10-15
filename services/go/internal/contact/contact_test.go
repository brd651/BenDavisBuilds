package contact

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	altcha "github.com/altcha-org/altcha-lib-go"
)

type fakeMailer struct {
	mu    sync.Mutex
	calls []Message
	err   error
}

type blockingMailer struct {
	entered chan struct{}
	release chan struct{}
	mu      sync.Mutex
	calls   int
}

func (m *blockingMailer) Send(Message) error {
	m.mu.Lock()
	m.calls++
	m.mu.Unlock()
	close(m.entered)
	<-m.release
	return nil
}

func (m *fakeMailer) Send(v Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls = append(m.calls, v)
	return m.err
}

func newTestHandler(t *testing.T, m Mailer) *Handler {
	t.Helper()
	h, err := New(Config{DBPath: filepath.Join(t.TempDir(), "private", "contact.sqlite"), Secret: []byte(strings.Repeat("s", 40)), Origin: "https://example.test", Mailer: m})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Close() })
	return h
}

func TestChallengeAndSubmissionAreSignedAndDeduplicated(t *testing.T) {
	mailer := &fakeMailer{}
	h := newTestHandler(t, mailer)
	challenge := getChallenge(t, h)
	payload := solvePayload(t, challenge, strings.Repeat("s", 40), time.Now().Add(5*time.Minute))
	body := validBody(payload)
	first := post(h, body)
	if first.Code != 200 || !strings.Contains(first.Body.String(), `"status":"sent"`) {
		t.Fatalf("first submit: %d %s", first.Code, first.Body.String())
	}
	second := post(h, body)
	if second.Code != 200 || !strings.Contains(second.Body.String(), `"status":"sent"`) {
		t.Fatalf("duplicate submit: %d %s", second.Code, second.Body.String())
	}
	if len(mailer.calls) != 1 {
		t.Fatalf("mail delivered %d times", len(mailer.calls))
	}
	if _, err := h.db.Exec(`UPDATE contact_submissions SET created_at=?`, time.Now().Unix()); err != nil {
		t.Fatal(err)
	}
	replay := post(h, validBody(payload))
	if replay.Code != 200 {
		t.Fatalf("replay should return idempotent response: %d", replay.Code)
	}
	if len(mailer.calls) != 1 {
		t.Fatalf("challenge replay delivered mail")
	}
	newIDReplay := post(h, bodyWith(payload, "99999999999999999999999999999999", "A message"))
	if newIDReplay.Code != http.StatusConflict {
		t.Fatalf("same proof with new id status %d", newIDReplay.Code)
	}
}

func TestPendingAndUncertainDeliveryNeverReportSent(t *testing.T) {
	mailer := &blockingMailer{entered: make(chan struct{}), release: make(chan struct{})}
	h := newTestHandler(t, mailer)
	payload := solvePayload(t, getChallenge(t, h), "", time.Time{})
	body := validBody(payload)
	firstDone := make(chan *httptest.ResponseRecorder, 1)
	go func() { firstDone <- post(h, body) }()
	<-mailer.entered
	if got := post(h, body).Code; got != http.StatusConflict {
		t.Fatalf("pending duplicate status %d", got)
	}
	close(mailer.release)
	if got := (<-firstDone).Code; got != 200 {
		t.Fatalf("first send status %d", got)
	}

	failed := &fakeMailer{err: errors.New("ambiguous transport failure")}
	uncertain := newTestHandler(t, failed)
	failedPayload := solvePayload(t, getChallenge(t, uncertain), "", time.Time{})
	failedBody := validBody(failedPayload)
	if got := post(uncertain, failedBody).Code; got != http.StatusServiceUnavailable {
		t.Fatalf("uncertain send status %d", got)
	}
	resp := post(uncertain, failedBody)
	if resp.Code != http.StatusConflict || strings.Contains(resp.Body.String(), `"status":"sent"`) {
		t.Fatalf("uncertain retry response %d %s", resp.Code, resp.Body.String())
	}
	if len(failed.calls) != 1 {
		t.Fatalf("ambiguous submission retried %d times", len(failed.calls))
	}
}

func TestPayloadDigestAndChallengeReplayConflicts(t *testing.T) {
	mailer := &fakeMailer{}
	h := newTestHandler(t, mailer)
	firstPayload := solvePayload(t, getChallenge(t, h), "", time.Time{})
	id := "11111111111111111111111111111111"
	if got := post(h, bodyWith(firstPayload, id, "original content")).Code; got != 200 {
		t.Fatalf("first status %d", got)
	}
	secondPayload := solvePayload(t, getChallenge(t, h), "", time.Time{})
	changed := post(h, bodyWith(secondPayload, id, "changed content"))
	if changed.Code != http.StatusConflict {
		t.Fatalf("changed payload status %d", changed.Code)
	}
	var digest string
	if err := h.db.QueryRow(`SELECT request_digest FROM contact_submissions WHERE submission_id=?`, id).Scan(&digest); err != nil {
		t.Fatal(err)
	}
	if len(digest) != 64 || strings.Contains(digest, "original content") || strings.Contains(digest, "ben@example.test") {
		t.Fatalf("request digest is not a private HMAC: %q", digest)
	}
	otherID := "22222222222222222222222222222222"
	challengeReplay := post(h, bodyWith(firstPayload, otherID, "original content"))
	if challengeReplay.Code != http.StatusConflict {
		t.Fatalf("reused challenge status %d", challengeReplay.Code)
	}
	if len(mailer.calls) != 1 {
		t.Fatalf("conflicting requests delivered %d times", len(mailer.calls))
	}
}

func TestChallengeRequiresSameOriginFetch(t *testing.T) {
	h := newTestHandler(t, &fakeMailer{})
	r := httptest.NewRequest(http.MethodGet, "/api/contact/challenge", nil)
	r.Host = "example.test"
	r.Header.Set("Sec-Fetch-Site", "same-origin")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("same-origin fetch status %d: %s", w.Code, w.Body.String())
	}
	r = httptest.NewRequest(http.MethodGet, "/api/contact/challenge", nil)
	r.Host = "example.test"
	r.Header.Set("Sec-Fetch-Site", "cross-site")
	r.Header.Set("Referer", "https://evil.test/page")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("cross-site fetch status %d", w.Code)
	}
}

func TestUncertainSubmissionStaysReservedAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "private", "contact.sqlite")
	secret := []byte(strings.Repeat("p", 40))
	failed := &fakeMailer{err: errors.New("ambiguous failure")}
	h, err := New(Config{DBPath: path, Secret: secret, Origin: "https://example.test", Mailer: failed})
	if err != nil {
		t.Fatal(err)
	}
	payload := solvePayload(t, getChallenge(t, h), "", time.Time{})
	body := bodyWith(payload, "33333333333333333333333333333333", "possibly delivered")
	if got := post(h, body).Code; got != http.StatusServiceUnavailable {
		t.Fatalf("first send status %d", got)
	}
	if err := h.Close(); err != nil {
		t.Fatal(err)
	}
	mockAfterRestart := &fakeMailer{}
	h, err = New(Config{DBPath: path, Secret: secret, Origin: "https://example.test", Mailer: mockAfterRestart})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	resp := post(h, body)
	if resp.Code != http.StatusConflict || strings.Contains(resp.Body.String(), `"status":"sent"`) {
		t.Fatalf("restart retry: %d %s", resp.Code, resp.Body.String())
	}
	if len(mockAfterRestart.calls) != 0 {
		t.Fatalf("uncertain restart caused %d duplicate deliveries", len(mockAfterRestart.calls))
	}
}

func TestExistingDatabaseGetsDigestMigration(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "private")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "contact.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE contact_submissions (submission_id TEXT PRIMARY KEY, challenge_salt TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','sent')))`)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	h, err := New(Config{DBPath: path, Secret: []byte(strings.Repeat("m", 40)), Origin: "https://example.test", Mailer: &fakeMailer{}})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	var count int
	if err := h.db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('contact_submissions') WHERE name='request_digest'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatal("request_digest migration missing")
	}
}

func TestChallengeExpiryAndTamperingRejected(t *testing.T) {
	h := newTestHandler(t, &fakeMailer{})
	challenge := getChallenge(t, h)
	old, err := altcha.CreateChallenge(altcha.ChallengeOptions{Algorithm: altcha.SHA256, MaxNumber: challengeWork, HMACKey: strings.Repeat("s", 40), Expires: timePtr(time.Now().Add(-time.Minute))})
	if err != nil {
		t.Fatal(err)
	}
	expired := solvePayload(t, old, strings.Repeat("s", 40), time.Now().Add(-time.Minute))
	if got := post(h, validBody(expired)).Code; got != 400 {
		t.Fatalf("expired status %d", got)
	}
	challenge = getChallenge(t, h)
	payload := solvePayload(t, challenge, strings.Repeat("s", 40), time.Now().Add(5*time.Minute))
	var p altcha.Payload
	b, _ := base64.StdEncoding.DecodeString(payload)
	if err := json.Unmarshal(b, &p); err != nil {
		t.Fatal(err)
	}
	p.Number++
	b, _ = json.Marshal(p)
	tampered := base64.StdEncoding.EncodeToString(b)
	if got := post(h, validBody(tampered)).Code; got != 400 {
		t.Fatalf("tampered status %d", got)
	}
}

func TestReplayStateSurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "private", "contact.sqlite")
	secret := []byte(strings.Repeat("r", 40))
	mailer := &fakeMailer{}
	h, err := New(Config{DBPath: path, Secret: secret, Origin: "https://example.test", Mailer: mailer})
	if err != nil {
		t.Fatal(err)
	}
	challenge := getChallenge(t, h)
	payload := solvePayload(t, challenge, "", time.Time{})
	body := validBody(payload)
	if got := post(h, body).Code; got != 200 {
		t.Fatalf("first submit: %d", got)
	}
	if err := h.Close(); err != nil {
		t.Fatal(err)
	}
	h, err = New(Config{DBPath: path, Secret: secret, Origin: "https://example.test", Mailer: mailer})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	if got := post(h, body).Code; got != 200 {
		t.Fatalf("replay after restart: %d", got)
	}
	if len(mailer.calls) != 1 {
		t.Fatalf("replay after restart delivered %d messages", len(mailer.calls))
	}
}

func TestInputOriginAndDisabledDelivery(t *testing.T) {
	h := newTestHandler(t, &fakeMailer{})
	if got := postRaw(h, `{"name":"x","unexpected":true}`).Code; got != 400 {
		t.Fatalf("unknown field status %d", got)
	}
	r := httptest.NewRequest(http.MethodGet, "/api/contact/challenge", nil)
	r.Header.Set("Origin", "https://evil.test")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("bad origin status %d", w.Code)
	}
	disabled := newTestHandler(t, nil)
	r = httptest.NewRequest(http.MethodGet, "/api/contact/challenge", nil)
	r.Header.Set("Origin", "https://example.test")
	w = httptest.NewRecorder()
	disabled.ServeHTTP(w, r)
	if w.Code != 503 {
		t.Fatalf("disabled status %d", w.Code)
	}
}

func TestHoneypotDoesNotSendMailAndValidation(t *testing.T) {
	m := &fakeMailer{}
	h := newTestHandler(t, m)
	if err := validate(request{Name: "X", Email: "bad\r\nBcc:x@y", Category: "general", Message: "Hello", SubmissionID: strings.Repeat("a", 32)}); err == nil {
		t.Fatal("accepted header injection")
	}
	if err := validate(request{Name: "X", Email: "x@example.test", Category: "wrong", Message: "Hello", SubmissionID: strings.Repeat("a", 32)}); err == nil {
		t.Fatal("accepted category")
	}
	r := httptest.NewRequest(http.MethodPost, "/api/contact", strings.NewReader(`{"website":"spam"}`))
	r.Header.Set("Origin", "https://example.test")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || len(m.calls) != 0 {
		t.Fatalf("honeypot handling: %d mails=%d", w.Code, len(m.calls))
	}
}

func TestRateLimitAndSMTPConfiguration(t *testing.T) {
	h := newTestHandler(t, &fakeMailer{})
	r := httptest.NewRequest(http.MethodGet, "/api/contact/challenge", nil)
	r.Header.Set("Origin", "https://example.test")
	for i := 0; i < 5; i++ {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatalf("request %d status %d", i, w.Code)
		}
	}
	w := httptest.NewRecorder()
	r.Header.Set("X-Real-IP", "198.51.100.45") // ignored because the peer is not loopback
	h.ServeHTTP(w, r)
	if w.Code != 429 {
		t.Fatalf("rate limit status %d", w.Code)
	}
	if _, err := NewSMTPMailer(SMTPConfig{Host: "evil.test", Port: 587, Username: "u", Password: "p", From: "a@example.test", To: "hello@bendavisbuilds.com"}); err == nil {
		t.Fatal("accepted non-Gmail host")
	}
}

func getChallenge(t *testing.T, h http.Handler) altcha.Challenge {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/api/contact/challenge", nil)
	r.Header.Set("Origin", "https://example.test")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("challenge: %d %s", w.Code, w.Body.String())
	}
	var c altcha.Challenge
	if err := json.Unmarshal(w.Body.Bytes(), &c); err != nil {
		t.Fatal(err)
	}
	return c
}
func timePtr(t time.Time) *time.Time { return &t }
func solvePayload(t *testing.T, c altcha.Challenge, key string, expires time.Time) string {
	t.Helper()
	sol, err := altcha.SolveChallenge(c.Challenge, c.Salt, altcha.Algorithm(c.Algorithm), int(c.MaxNumber), 0, nil)
	if err != nil || sol == nil {
		t.Fatalf("solve challenge: %v", err)
	}
	p := altcha.Payload{Algorithm: c.Algorithm, Challenge: c.Challenge, Number: int64(sol.Number), Salt: c.Salt, Signature: c.Signature}
	b, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	_ = key
	_ = expires
	return base64.StdEncoding.EncodeToString(b)
}
func validBody(payload string) string {
	return bodyWith(payload, "0123456789abcdef0123456789abcdef", "A message")
}
func bodyWith(payload, id, message string) string {
	v := map[string]string{"name": "Ben Example", "email": "ben@example.test", "category": "general", "message": message, "altcha": payload, "submission_id": id}
	b, _ := json.Marshal(v)
	return string(b)
}
func post(h http.Handler, body string) *httptest.ResponseRecorder { return postRaw(h, body) }
func postRaw(h http.Handler, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/api/contact", strings.NewReader(body))
	r.Header.Set("Origin", "https://example.test")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
