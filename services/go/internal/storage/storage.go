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

	"github.com/brd651/BenDavisBuilds/services/go/migrations"
	_ "modernc.org/sqlite"
)

const latestVersion = 1

// Open configures SQLite for a single bounded writer and applies embedded, versioned migrations.
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
	if err = ApplyMigrations(ctx, db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

// ApplyMigrations refuses to open a database from a newer binary before applying any changes.
func ApplyMigrations(ctx context.Context, db *sql.DB) error {
	var version int
	if err := db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version > latestVersion {
		return fmt.Errorf("database version %d is newer than supported version %d", version, latestVersion)
	}
	if version == latestVersion {
		return nil
	}
	script, err := migrations.Files.ReadFile("0001_initial.sql")
	if err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, string(script)); err != nil {
		return fmt.Errorf("apply migration 1: %w", err)
	}
	return tx.Commit()
}

// Backup uses SQLite's online snapshot implementation through VACUUM INTO.
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

// Restore validates a backup and copies it to a new, private destination without modifying the source.
func Restore(ctx context.Context, backup, destination string) error {
	u := url.URL{Scheme: "file", Path: backup}
	check, err := sql.Open("sqlite", u.String()+"?mode=ro&_pragma=foreign_keys(1)")
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
