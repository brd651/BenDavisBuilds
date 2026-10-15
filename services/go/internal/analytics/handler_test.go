package analytics

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/brd651/BenDavisBuilds/services/go/internal/storage"
)

func TestIngestDeduplicatesAndDoesNotStoreRawVisitorID(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "analytics.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := NewHandler(db, bytes.Repeat([]byte("k"), 32), "https://example.test")
	h.AllowedPaths = map[string]bool{"/writing/": true}
	h.now = func() time.Time { return time.Unix(1700000000, 0) }
	props := map[string]any{"referrer": "https://news.example/path?email=secret@example.test", "utm_source": "newsletter"}
	p, _ := json.Marshal(props)
	body := `{"session_id":"11111111111111111111111111111111","visitor_id":"22222222222222222222222222222222","consent":true,"events":[{"id":"33333333333333333333333333333333","type":"pageview","path":"/writing/","properties":` + string(p) + `}]}`
	for i := 0; i < 2; i++ {
		r := httptest.NewRequest("POST", "/api/telemetry", strings.NewReader(body))
		r.Header.Set("Origin", "https://example.test")
		r.Header.Set("User-Agent", "Mozilla/5.0")
		r.Header.Set("Content-Type", "application/json")
		r.RemoteAddr = "192.0.2.1:1234"
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 204 {
			t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
		}
	}
	var n int
	if err = db.QueryRow("SELECT COUNT(*) FROM events").Scan(&n); err != nil || n != 1 {
		t.Fatalf("dedup count=%d err=%v", n, err)
	}
	var visitor string
	if err = db.QueryRow("SELECT id FROM visitors").Scan(&visitor); err != nil {
		t.Fatal(err)
	}
	if visitor == "22222222222222222222222222222222" {
		t.Fatal("raw visitor id stored")
	}
	var source, stored string
	if err = db.QueryRow("SELECT source FROM sessions").Scan(&source); err != nil {
		t.Fatal(err)
	}
	if source != "news.example" {
		t.Fatalf("source=%q", source)
	}
	if err = db.QueryRow("SELECT properties FROM events").Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored, "secret@example.test") || strings.Contains(stored, "/path") {
		t.Fatalf("raw referrer stored: %s", stored)
	}
}

func TestRejectsUnknownPropertiesAndUntrustedEvents(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "db.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := NewHandler(db, bytes.Repeat([]byte("k"), 32), "")
	cases := []string{
		`{"session_id":"11111111111111111111111111111111","events":[{"id":"22222222222222222222222222222222","type":"booking_confirmed","path":"/"}]}`,
		`{"session_id":"11111111111111111111111111111111","events":[{"id":"22222222222222222222222222222222","type":"pageview","path":"/","properties":{"email":"a@b.test"}}]}`,
		`{"session_id":"11111111111111111111111111111111","unexpected":true,"events":[{"id":"22222222222222222222222222222222","type":"pageview","path":"/"}]}`,
	}
	for _, body := range cases {
		r := httptest.NewRequest("POST", "/api/telemetry", strings.NewReader(body))
		r.Header.Set("User-Agent", "Mozilla/5.0")
		r.Header.Set("Content-Type", "application/json")
		r.RemoteAddr = "192.0.2.1:1"
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatalf("expected 400, got %d", w.Code)
		}
	}
}

func TestRequiresApplicationJSONAndEnforcesEnums(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "db.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := NewHandler(db, bytes.Repeat([]byte("k"), 32), "")
	h.AllowedPaths = map[string]bool{"/writing/": true, "/projects/lab/": true}
	valid := `{"session_id":"11111111111111111111111111111111","events":[{"id":"22222222222222222222222222222222","type":"navigation_click","path":"/writing/","properties":{"destination":"projects-lab"}}]}`
	r := httptest.NewRequest("POST", "/api/telemetry", strings.NewReader(valid))
	r.Header.Set("User-Agent", "Mozilla/5.0")
	r.RemoteAddr = "192.0.2.2:123"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("missing content-type status=%d", w.Code)
	}
	r = httptest.NewRequest("POST", "/api/telemetry", strings.NewReader(valid))
	r.Header.Set("User-Agent", "Mozilla/5.0")
	r.Header.Set("Content-Type", "application/json")
	r.RemoteAddr = "192.0.2.20:123"
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusNoContent {
		t.Fatalf("valid path slug status=%d body=%s", w.Code, w.Body.String())
	}
	cases := []struct{ typ, props string }{{"engagement", `{"kind":"other"}`}, {"project_interaction", `{"project":"projects-lab","action":"delete"}`}, {"contact_intent", `{"category":"personal"}`}, {"booking_intent", `{"provider":"other"}`}, {"social_click", `{"destination":"mastodon"}`}, {"navigation_click", `{"destination":"made-up"}`}}
	for i, test := range cases {
		id := fmt.Sprintf("333333333333333333333333333333%02x", i)
		body := `{"session_id":"11111111111111111111111111111111","events":[{"id":"` + id + `","type":"` + test.typ + `","path":"/writing/","properties":` + test.props + `}]}`
		r = httptest.NewRequest("POST", "/api/telemetry", strings.NewReader(body))
		r.Header.Set("User-Agent", "Mozilla/5.0")
		r.Header.Set("Content-Type", "application/json; charset=utf-8")
		r.RemoteAddr = fmt.Sprintf("192.0.2.%d:123", i+3)
		w = httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("type %s props %s status=%d", test.typ, test.props, w.Code)
		}
	}
}

func TestRetentionPreservesEventsFromLongLivedSession(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "db.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	started := int64(1)
	lastSeen := time.Now().Unix()
	if _, err = db.Exec("INSERT INTO sessions(id,started_at,last_seen) VALUES('old-session',?,?)", started, lastSeen); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO events(id,session_id,type,path,occurred_at,properties) VALUES('recent-event','old-session','pageview','/',?,'{}')", lastSeen); err != nil {
		t.Fatal(err)
	}
	if err = Retain(context.Background(), db, 90); err != nil {
		t.Fatal(err)
	}
	var n int
	if err = db.QueryRow("SELECT COUNT(*) FROM events WHERE id='recent-event'").Scan(&n); err != nil || n != 1 {
		t.Fatalf("recent events=%d err=%v", n, err)
	}
}

func TestSessionExpiresAfterThirtyMinutes(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "db.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := NewHandler(db, bytes.Repeat([]byte("s"), 32), "")
	now := time.Unix(1700000000, 0)
	h.now = func() time.Time { return now }
	req := request{SessionID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", Events: []event{{ID: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", Type: "pageview", Path: "/"}}}
	r := httptest.NewRequest("POST", "/api/telemetry", nil)
	if err := h.store(r, req, req.Events); err != nil {
		t.Fatal(err)
	}
	now = now.Add(sessionTTL + time.Second)
	req.Events = []event{{ID: "cccccccccccccccccccccccccccccccc", Type: "pageview", Path: "/"}}
	if err := h.store(r, req, req.Events); err != nil {
		t.Fatal(err)
	}
	var n int
	if err = db.QueryRow("SELECT COUNT(*) FROM sessions").Scan(&n); err != nil || n != 2 {
		t.Fatalf("sessions=%d err=%v", n, err)
	}
}
