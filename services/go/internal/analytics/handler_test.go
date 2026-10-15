package analytics

import (
	"bytes"
	"encoding/json"
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
		r.RemoteAddr = "192.0.2.1:1"
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatalf("expected 400, got %d", w.Code)
		}
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
