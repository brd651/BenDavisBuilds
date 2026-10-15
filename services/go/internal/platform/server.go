package platform

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func Logging() { slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, nil))) }

type responseStatus struct {
	http.ResponseWriter
	status int
}

func (w *responseStatus) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}
func (w *responseStatus) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(200)
	}
	return w.ResponseWriter.Write(data)
}
func bounded(handler http.Handler) http.Handler {
	slots := make(chan struct{}, 32)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			http.Error(w, "service busy", 503)
			return
		}
		start := time.Now()
		rw := &responseStatus{ResponseWriter: w}
		handler.ServeHTTP(rw, r)
		status := rw.status
		if status == 0 {
			status = 200
		}
		// Request bodies, URL paths/queries, headers and addresses never enter logs.
		slog.Info("http_request", "status", status, "duration_ms", time.Since(start).Milliseconds())
	})
}

// Serve accepts loopback listeners only and drains on systemd SIGTERM.
func Serve(address string, handler http.Handler) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		return &net.AddrError{Err: "loopback listener required", Addr: address}
	}
	server := &http.Server{Addr: address, Handler: bounded(handler), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	slog.Info("service_started")
	err = server.ListenAndServe()
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}
func Env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
