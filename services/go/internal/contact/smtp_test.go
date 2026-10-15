package contact

import (
	"bufio"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/textproto"
	"strings"
	"sync"
	"testing"
	"time"
)

func relayConfig() SMTPConfig {
	return SMTPConfig{Host: "smtp-relay.gmail.com", Port: 587, From: "hello@bendavisbuilds.com", To: "hello@bendavisbuilds.com"}
}
func testMessage() Message {
	return Message{Name: "Test", Email: "visitor@example.test", Category: "general", Body: "Temporary test content.", SubmissionID: strings.Repeat("a", 32)}
}
func TestRelayConfigurationAndInjection(t *testing.T) {
	cfg := relayConfig()
	if _, err := NewSMTPMailer(cfg); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*SMTPConfig){func(c *SMTPConfig) { c.Port = 25 }, func(c *SMTPConfig) { c.Username = "user" }, func(c *SMTPConfig) { c.Password = "secret" }, func(c *SMTPConfig) { c.From = "other@example.test" }, func(c *SMTPConfig) { c.To = "other@example.test" }, func(c *SMTPConfig) { c.To += "\r\nBcc:evil@example.test" }, func(c *SMTPConfig) { c.Host = "other.example.test" }} {
		c := cfg
		mutate(&c)
		if _, err := NewSMTPMailer(c); err == nil {
			t.Fatal("unsafe relay configuration accepted")
		}
	}
	for _, mutate := range []func(*Message){func(m *Message) { m.Email += "\r\nBcc:evil@example.test" }, func(m *Message) { m.Category = "general\r\nBcc:evil@example.test" }, func(m *Message) { m.SubmissionID += "\r\nX:bad" }} {
		msg := testMessage()
		mutate(&msg)
		m, _ := NewSMTPMailer(cfg)
		if err := m.Send(msg); err == nil {
			t.Fatal("header injection accepted")
		}
	}
}

func testCertificate(t *testing.T) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "smtp-relay.gmail.com"}, DNSNames: []string{"smtp-relay.gmail.com"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, BasicConstraintsValid: true}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(leaf)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, pool
}

func TestRelayTLSConversation(t *testing.T) {
	cert, pool := testCertificate(t)
	for _, mode := range []string{"success", "no-starttls", "untrusted", "temporary", "uncertain"} {
		t.Run(mode, func(t *testing.T) {
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			done := make(chan struct{})
			var transcript []string
			var received string
			go func() {
				defer close(done)
				conn, e := listener.Accept()
				if e != nil {
					return
				}
				defer conn.Close()
				_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
				reader := bufio.NewReader(conn)
				send := func(s string) { _, _ = io.WriteString(conn, s+"\r\n") }
				send("220 test relay")
				for {
					line, e := reader.ReadString('\n')
					if e != nil {
						return
					}
					line = strings.TrimSpace(line)
					transcript = append(transcript, line)
					switch {
					case strings.HasPrefix(line, "EHLO "):
						if mode == "no-starttls" {
							send("250 test relay")
						} else {
							send("250-test relay\r\n250 STARTTLS")
						}
					case line == "STARTTLS":
						send("220 begin TLS")
						secured := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12})
						if secured.Handshake() != nil {
							return
						}
						conn = secured
						reader = bufio.NewReader(conn)
					case strings.HasPrefix(line, "MAIL FROM:"):
						if mode == "temporary" {
							send("451 temporarily unavailable")
							return
						}
						send("250 sender accepted")
					case strings.HasPrefix(line, "RCPT TO:"):
						send("250 recipient accepted")
					case line == "DATA":
						send("354 send message")
						for {
							part, e := reader.ReadString('\n')
							if e != nil {
								return
							}
							if part == ".\r\n" {
								break
							}
							received += part
						}
						if mode == "uncertain" {
							return
						}
						send("250 accepted")
					default:
						return
					}
				}
			}()
			roots := pool
			if mode == "untrusted" {
				roots = x509.NewCertPool()
			}
			mailer := smtpMailer{cfg: relayConfig()}
			err = mailer.deliver(testMessage(), func(string) (net.Conn, error) { return net.Dial("tcp", listener.Addr().String()) }, &tls.Config{ServerName: "smtp-relay.gmail.com", RootCAs: roots, MinVersion: tls.VersionTLS12})
			<-done
			var safe *retryableDeliveryError
			if mode == "success" {
				if err != nil {
					t.Fatal(err)
				}
				if !strings.Contains(received, "Reply-To: visitor@example.test\r\n") || !strings.Contains(received, "Subject: Ben Davis Builds contact: general\r\n") {
					t.Fatal("missing safe message headers")
				}
			} else if err == nil {
				t.Fatal("unsafe delivery succeeded")
			}
			if mode == "uncertain" && errors.As(err, &safe) {
				t.Fatal("uncertain DATA outcome is retryable")
			}
			if mode == "temporary" && !errors.As(err, &safe) {
				t.Fatal("explicit pre-DATA rejection not retryable")
			}
			for _, line := range transcript {
				if strings.HasPrefix(line, "AUTH") {
					t.Fatal("AUTH used for IP relay")
				}
				if strings.HasPrefix(line, "RCPT TO:") && !strings.Contains(line, "<hello@bendavisbuilds.com>") {
					t.Fatal("recipient changed")
				}
			}
			if (mode == "no-starttls" || mode == "untrusted") && received != "" {
				t.Fatal("message transmitted without verified TLS")
			}
		})
	}
}

func TestOutboundBudgetsPersistAndSerialize(t *testing.T) {
	h := newTestHandler(t, &fakeMailer{})
	var wg sync.WaitGroup
	var mu sync.Mutex
	accepted := 0
	for i := 0; i < 30; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			err := h.reserve(fmt.Sprintf("%032x", i), fmt.Sprint("salt", i), "digest")
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				accepted++
			} else if !errors.Is(err, errMailVolume) {
				t.Errorf("unexpected reservation error: %v", err)
			}
		}(i)
	}
	wg.Wait()
	if accepted != mailPerHour {
		t.Fatalf("accepted %d, want %d", accepted, mailPerHour)
	}
	// Opening a second handler against the persisted database must not reset limits.
	var dbpath string
	if err := h.db.QueryRow(`SELECT file FROM pragma_database_list WHERE name='main'`).Scan(&dbpath); err != nil {
		t.Fatal(err)
	}
	other, err := New(Config{DBPath: dbpath, Secret: []byte(strings.Repeat("s", 32)), Origin: "https://example.test", Mailer: &fakeMailer{}})
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	if err := other.reserve(strings.Repeat("f", 32), "new salt", "digest"); !errors.Is(err, errMailVolume) {
		t.Fatal("budget reset on restart")
	}
	for i := mailPerHour; i < mailPerDay; i++ {
		if _, err := h.db.Exec(`INSERT INTO contact_mail_attempts(attempted_at) VALUES(?)`, time.Now().Add(-2*time.Hour).Unix()); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := h.db.Exec(`UPDATE contact_mail_attempts SET attempted_at=?`, time.Now().Add(-2*time.Hour).Unix()); err != nil {
		t.Fatal(err)
	}
	if err := h.reserve(strings.Repeat("e", 32), "day salt", "digest"); !errors.Is(err, errMailVolume) {
		t.Fatal("daily budget bypassed")
	}
}

func TestKnownTemporaryFailureCanRetryWithoutResettingBudget(t *testing.T) {
	m := &fakeMailer{err: &retryableDeliveryError{cause: &textproto.Error{Code: 451, Msg: "temporary"}}}
	h := newTestHandler(t, m)
	payload := solvePayload(t, getChallenge(t, h), "", time.Time{})
	body := validBody(payload)
	first := post(h, body)
	if first.Code != 503 || first.Header().Get("Retry-After") != "60" {
		t.Fatalf("temporary result %d", first.Code)
	}
	if got := post(h, bodyWith(payload, "0123456789abcdef0123456789abcdef", "changed request")); got.Code != 409 {
		t.Fatal("safe retry lost original digest binding")
	}
	m.err = nil
	if got := post(h, body); got.Code != 200 {
		t.Fatalf("safe retry result %d", got.Code)
	}
	var count int
	if err := h.db.QueryRow(`SELECT COUNT(*) FROM contact_mail_attempts`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatal("failed attempt budget lost")
	}
	if got := post(h, body); got.Code != 200 || len(m.calls) != 2 {
		t.Fatal("sent duplicate was retried")
	}
}
