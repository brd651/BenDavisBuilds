package storage

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS visitors(id TEXT PRIMARY KEY, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, visitor_id TEXT REFERENCES visitors(id), started_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, source TEXT NOT NULL DEFAULT '', utm_source TEXT NOT NULL DEFAULT '', utm_medium TEXT NOT NULL DEFAULT '', utm_campaign TEXT NOT NULL DEFAULT '', session_key TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, type TEXT NOT NULL, path TEXT NOT NULL, occurred_at INTEGER NOT NULL, properties TEXT NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS events_occurred_idx ON events(occurred_at);
CREATE INDEX IF NOT EXISTS events_session_time_idx ON events(session_id, occurred_at);
CREATE INDEX IF NOT EXISTS events_type_time_idx ON events(type, occurred_at);
CREATE INDEX IF NOT EXISTS sessions_started_idx ON sessions(started_at);
CREATE INDEX IF NOT EXISTS sessions_visitor_idx ON sessions(visitor_id, started_at);
`

// Open creates the database directory, applies idempotent migrations, and configures SQLite for a single bounded writer.
func Open(path string) (*sql.DB, error) {
	if path == "" || path == ":memory:" {
		return nil, fmt.Errorf("persistent database path required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	u := url.URL{Scheme: "file", Path: path}
	db, err := sql.Open("sqlite", u.String()+"?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if _, err = db.ExecContext(ctx, schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate analytics database: %w", err)
	}
	return db, nil
}

// Backup uses SQLite's online backup implementation through VACUUM INTO.
func Backup(ctx context.Context, db *sql.DB, destination string) error {
	if destination == "" {
		return fmt.Errorf("backup destination required")
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
		return err
	}
	if _, err := os.Stat(destination); err == nil {
		return fmt.Errorf("backup destination already exists")
	} else if !os.IsNotExist(err) {
		return err
	}
	_, err := db.ExecContext(ctx, "VACUUM INTO ?", destination)
	if err != nil {
		return err
	}
	return os.Chmod(destination, 0600)
}

// Integrity runs SQLite's integrity and foreign-key checks.
func Integrity(ctx context.Context, db *sql.DB) error {
	var result string
	if err := db.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&result); err != nil {
		return err
	}
	if result != "ok" {
		return fmt.Errorf("sqlite integrity check: %s", result)
	}
	rows, err := db.QueryContext(ctx, "PRAGMA foreign_key_check")
	if err != nil {
		return err
	}
	defer rows.Close()
	if rows.Next() {
		return fmt.Errorf("sqlite foreign key check failed")
	}
	return rows.Err()
}

// Restore validates a backup in a temporary connection and installs it only when the destination does not exist.
func Restore(ctx context.Context, backup, destination string) error {
	check, err := sql.Open("sqlite", "file:"+backup+"?mode=ro&_pragma=foreign_keys(1)")
	if err != nil {
		return err
	}
	if err = Integrity(ctx, check); err != nil {
		check.Close()
		return err
	}
	if err = check.Close(); err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
		return err
	}
	if _, err = os.Stat(destination); err == nil {
		return fmt.Errorf("restore destination already exists")
	} else if !os.IsNotExist(err) {
		return err
	}
	in, err := os.Open(backup)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	if _, err = io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(destination)
		return err
	}
	if err = out.Sync(); err != nil {
		out.Close()
		os.Remove(destination)
		return err
	}
	if err = out.Close(); err != nil {
		os.Remove(destination)
		return err
	}
	return nil
}
