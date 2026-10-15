package contact

import (
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"strconv"
	"time"
)

type SMTPConfig struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
	From     string `json:"from"`
	To       string `json:"to"`
}

func NewSMTPMailer(c SMTPConfig) (Mailer, error) {
	relay := c.Host == "smtp-relay.gmail.com" && c.Port == 587 && c.Username == "" && c.Password == ""
	if !relay {
		return nil, errors.New("invalid Google SMTP configuration")
	}
	// Neither configuration nor visitor input can change the envelope destination.
	if c.From != "hello@bendavisbuilds.com" || c.To != "hello@bendavisbuilds.com" {
		return nil, errors.New("invalid contact sender or recipient")
	}
	return smtpMailer{cfg: c}, nil
}

type smtpMailer struct{ cfg SMTPConfig }

// Only a definitely unaccepted delivery may release its submission reservation.
// Unknown outcomes after DATA stay reserved to prevent duplicate email.
type retryableDeliveryError struct{ cause error }

func (e *retryableDeliveryError) Error() string { return "mail temporarily unavailable" }
func (e *retryableDeliveryError) Unwrap() error { return e.cause }

func (m smtpMailer) Send(msg Message) error {
	return m.deliver(msg, func(addr string) (net.Conn, error) { return net.DialTimeout("tcp4", addr, 10*time.Second) }, &tls.Config{ServerName: m.cfg.Host, MinVersion: tls.VersionTLS12})
}

func (m smtpMailer) deliver(msg Message, dial func(string) (net.Conn, error), tlsConfig *tls.Config) (err error) {
	if err = validate(request{Name: msg.Name, Email: msg.Email, Category: msg.Category, Message: msg.Body, SubmissionID: msg.SubmissionID}); err != nil {
		return err
	}
	// Defense in depth for direct callers, independent of the public handler.
	if _, err = NewSMTPMailer(m.cfg); err != nil {
		return err
	}
	reply, err := mail.ParseAddress(msg.Email)
	if err != nil || reply.Address != msg.Email {
		return errors.New("invalid reply address")
	}
	dataStarted := false
	defer func() {
		if err == nil {
			return
		}
		var smtpError *textproto.Error
		if !dataStarted || (errors.As(err, &smtpError) && smtpError.Code >= 400 && smtpError.Code < 500) {
			err = &retryableDeliveryError{cause: err}
		}
	}()
	conn, err := dial(net.JoinHostPort(m.cfg.Host, strconv.Itoa(m.cfg.Port)))
	if err != nil {
		return err
	}
	defer conn.Close()
	if err = conn.SetDeadline(time.Now().Add(20 * time.Second)); err != nil {
		return err
	}
	var smtpConn net.Conn = conn
	client, err := smtp.NewClient(smtpConn, m.cfg.Host)
	if err != nil {
		return err
	}
	defer client.Close()
	if err = client.Hello("bendavisbuilds.com"); err != nil {
		return err
	}
	if m.cfg.Port == 587 {
		if supported, _ := client.Extension("STARTTLS"); !supported {
			return errors.New("SMTP STARTTLS required")
		}
		if err = client.StartTLS(tlsConfig); err != nil {
			return err
		}
	}
	// IP authorization only; never send SMTP AUTH credentials.
	if err = client.Mail(m.cfg.From); err != nil {
		return err
	}
	if err = client.Rcpt(m.cfg.To); err != nil {
		return err
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	dataStarted = true
	body := fmt.Sprintf("From: %s\r\nTo: %s\r\nReply-To: %s\r\nSubject: Ben Davis Builds contact: %s\r\nMessage-ID: <%s@bendavisbuilds.com>\r\nDate: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nName: %s\nEmail: %s\nCategory: %s\nSubmission: %s\n\n%s\n", m.cfg.From, m.cfg.To, reply.Address, msg.Category, msg.SubmissionID, time.Now().UTC().Format(time.RFC1123Z), msg.Name, msg.Email, msg.Category, msg.SubmissionID, msg.Body)
	if _, err = w.Write([]byte(body)); err != nil {
		return err
	}
	// A successful final DATA reply, rather than QUIT, establishes acceptance.
	return w.Close()
}
