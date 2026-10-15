package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/brd651/BenDavisBuilds/services/go/internal/platform"
	"github.com/brd651/BenDavisBuilds/services/go/internal/reporting"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	_ "modernc.org/sqlite"
)

func main() {
	platform.Logging()
	manual := flag.Bool("manual", false, "run without the scheduled hourly gate")
	report := flag.Bool("report", false, "print aggregate report JSON locally without contacting Google")
	flag.Parse()
	dbPath := os.Getenv("BDB_ANALYTICS_DB")
	if dbPath == "" {
		fatal("BDB_ANALYTICS_DB is required")
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		fatal("open analytics database", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	if _, err = db.Exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;`); err != nil {
		fatal("configure SQLite", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	now := time.Now().UTC()
	tables, err := reporting.BuildTables(ctx, db, now)
	if err != nil {
		fatal("build aggregate report", err)
	}
	if *report {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(tables); err != nil {
			fatal("encode report", err)
		}
		return
	}
	budget := &reporting.Budget{DB: db}
	if err := budget.Init(ctx); err != nil {
		fatal("initialize persisted request budget", err)
	}
	if err := budget.MarkAttempt(ctx, now); err != nil {
		fatal("record export attempt", err)
	}
	release, err := budget.Acquire(ctx, !*manual)
	if err != nil {
		if errors.Is(err, reporting.ErrDeferred) {
			_ = budget.MarkDeferred(ctx, "hourly_gate")
			slog.Info("export deferred by hourly schedule")
			return
		}
		if errors.Is(err, reporting.ErrBusy) {
			_ = budget.MarkDeferred(ctx, "another_export_active")
			slog.Info("export deferred because another export is active")
			return
		}
		fatal("acquire exporter lease", err)
	}
	defer release()
	credentialPath := os.Getenv("BDB_SHEETS_CREDENTIALS")
	spreadsheet := os.Getenv("BDB_SPREADSHEET_ID")
	if credentialPath == "" || spreadsheet == "" {
		_ = budget.MarkFailure(ctx)
		fatal("BDB_SHEETS_CREDENTIALS and BDB_SPREADSHEET_ID are required")
	}
	credential, err := readCredential(credentialPath)
	if err != nil {
		_ = budget.MarkFailure(ctx)
		fatal(err.Error())
	}
	config, err := google.JWTConfigFromJSON(credential, "https://www.googleapis.com/auth/spreadsheets")
	for i := range credential {
		credential[i] = 0
	}
	if err != nil {
		_ = budget.MarkFailure(ctx)
		fatal("invalid Sheets service-account configuration")
	}
	client := &reporting.Client{HTTP: oauth2.NewClient(ctx, config.TokenSource(ctx)), Budget: budget, SpreadsheetID: spreadsheet}
	if err := client.Export(ctx, tables); err != nil {
		if errors.Is(err, reporting.ErrDeferred) {
			_ = budget.MarkDeferred(ctx, "request_budget")
			slog.Info("export deferred because request budget is exhausted")
			return
		}
		_ = budget.MarkFailure(ctx)
		// The API client intentionally returns status-only and sanitized errors.
		if strings.Contains(err.Error(), "HTTP ") {
			fatal("Sheets API request failed", err)
		}
		fatal("Sheets export failed")
	}
	if err := budget.MarkSuccess(ctx, time.Now()); err != nil {
		fatal("record export success", err)
	}
	slog.Info("aggregate Sheets export completed", "tables", len(tables))
}

func readCredential(path string) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Mode().Perm()&0400 == 0 {
		return nil, errors.New("Sheets credential must be a readable regular file with owner-only permissions")
	}
	credential, err := os.ReadFile(path)
	if err != nil {
		return nil, errors.New("unable to read protected Sheets credential")
	}
	return credential, nil
}

func fatal(message string, err ...error) {
	if len(err) > 0 {
		slog.Error(message, "error", err[0])
	} else {
		slog.Error(message)
	}
	fmt.Fprintln(os.Stderr, "exporter stopped")
	os.Exit(1)
}
