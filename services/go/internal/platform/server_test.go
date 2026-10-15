package platform

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestLogsExcludeRequestData(t *testing.T) {
	var logs bytes.Buffer
	old := slog.Default()
	defer slog.SetDefault(old)
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	h := bounded(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	r := httptest.NewRequest("POST", "/private@example.test?email=secret@example.test", strings.NewReader("private message"))
	r.Header.Set("X-Real-IP", "192.0.2.45")
	h.ServeHTTP(httptest.NewRecorder(), r)
	for _, s := range []string{"private", "secret", "192.0.2.45"} {
		if strings.Contains(logs.String(), s) {
			t.Fatal("request data logged")
		}
	}
	if !strings.Contains(logs.String(), `"status":204`) {
		t.Fatal("missing structured status")
	}
}
func TestConcurrentRequestsAreBounded(t *testing.T) {
	release := make(chan struct{})
	entered := make(chan struct{}, 32)
	h := bounded(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { entered <- struct{}{}; <-release; w.WriteHeader(204) }))
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/healthz", nil))
		}()
	}
	for i := 0; i < 32; i++ {
		<-entered
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/healthz", nil))
	if w.Code != 503 {
		t.Fatalf("unbounded request: %d", w.Code)
	}
	close(release)
	wg.Wait()
}
