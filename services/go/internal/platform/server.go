package platform

import (
 "context"
 "log/slog"
 "net/http"
 "os"
 "os/signal"
 "syscall"
 "time"
 "net"
)

// Serve accepts loopback listeners only and drains on systemd SIGTERM.
func Serve(address string, handler http.Handler) error {
 host, _, err := net.SplitHostPort(address)
 if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() { return &net.AddrError{Err:"loopback listener required",Addr:address} }
 server := &http.Server{Addr:address,Handler:handler,ReadHeaderTimeout:5*time.Second,ReadTimeout:10*time.Second,WriteTimeout:20*time.Second,IdleTimeout:30*time.Second,MaxHeaderBytes:8192}
 ctx, stop := signal.NotifyContext(context.Background(),os.Interrupt,syscall.SIGTERM);defer stop()
 go func(){ <-ctx.Done(); shutdown,cancel:=context.WithTimeout(context.Background(),10*time.Second);defer cancel();_ = server.Shutdown(shutdown) }()
 slog.Info("service_started")
 err=server.ListenAndServe();if err==http.ErrServerClosed{return nil};return err
}
func Env(name, fallback string) string { if value:=os.Getenv(name);value!=""{return value};return fallback }
