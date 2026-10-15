package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"

	"github.com/brd651/BenDavisBuilds/services/go/internal/contact"
	"github.com/brd651/BenDavisBuilds/services/go/internal/platform"
)

func main() {
	secretPath := platform.Env("BDB_CONTACT_SECRET_FILE", "")
	if secretPath == "" {
		slog.Error("contact_secret_file_required")
		os.Exit(1)
	}
	secret, err := readPrivate(secretPath)
	if err != nil || len(secret) < 32 {
		slog.Error("contact_secret_unavailable")
		os.Exit(1)
	}
	var mailer contact.Mailer
	mailPath := platform.Env("BDB_MAIL_CONFIG_FILE", "")
	if mailPath != "" {
		b, e := readPrivate(mailPath)
		if e != nil {
			slog.Error("mail_config_unavailable")
			os.Exit(1)
		}
		dec := json.NewDecoder(bytes.NewReader(b))
		dec.DisallowUnknownFields()
		var cfg contact.SMTPConfig
		if e = dec.Decode(&cfg); e == nil {
			var extra any
			if dec.Decode(&extra) != io.EOF {
				e = errors.New("invalid mail configuration")
			}
		}
		if e != nil {
			slog.Error("mail_config_invalid")
			os.Exit(1)
		}
		mailer, err = contact.NewSMTPMailer(cfg)
		if err != nil {
			slog.Error("mail_config_invalid")
			os.Exit(1)
		}
	}
	h, err := contact.New(contact.Config{DBPath: platform.Env("BDB_CONTACT_DB", "/var/lib/ben-davis-contact/contact.sqlite"), Secret: secret, Origin: platform.Env("BDB_ORIGIN", ""), Mailer: mailer})
	if err != nil {
		slog.Error("contact_start_failed")
		os.Exit(1)
	}
	defer h.Close()
	if err := platform.Serve(platform.Env("BDB_CONTACT_ADDR", "127.0.0.1:8092"), h); err != nil {
		slog.Error("contact_server_failed")
		os.Exit(1)
	}
}

func readPrivate(path string) ([]byte, error) {
	st, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if !st.Mode().IsRegular() || st.Mode().Perm()&0077 != 0 {
		return nil, errors.New("secret file must be regular and private")
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(b) > 16<<10 {
		return nil, errors.New("secret file too large")
	}
	return b, nil
}
