package storage

import (
	"context"
	"path/filepath"
	"testing"
)

func TestOpenWALAndBackupRestore(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "db", "analytics.sqlite")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var mode string
	if err = db.QueryRow("PRAGMA journal_mode").Scan(&mode); err != nil || mode != "wal" {
		t.Fatalf("journal mode=%q err=%v", mode, err)
	}
	var version int
	if err = db.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != latestVersion {
		t.Fatalf("migration version=%d err=%v", version, err)
	}
	if _, err = db.Exec("INSERT INTO events(id,session_id,type,path,occurred_at,properties) VALUES('e','missing','pageview','/',1,'{}')"); err == nil {
		t.Fatal("foreign key constraint was not enforced")
	}
	if _, err = db.Exec("INSERT INTO sessions(id,started_at,last_seen) VALUES('s',1,1)"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO events(id,session_id,type,path,occurred_at,properties) VALUES('e','s','pageview','/',1,'{}')"); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	backup := filepath.Join(dir, "backup.sqlite")
	if err = Backup(ctx, db, backup); err != nil {
		t.Fatal(err)
	}
	if err = Integrity(ctx, db); err != nil {
		t.Fatal(err)
	}
	restored := filepath.Join(dir, "restored.sqlite")
	if err = Restore(ctx, backup, restored); err != nil {
		t.Fatal(err)
	}
	copy, err := Open(restored)
	if err != nil {
		t.Fatal(err)
	}
	defer copy.Close()
	var n int
	if err = copy.QueryRow("SELECT COUNT(*) FROM events").Scan(&n); err != nil || n != 1 {
		t.Fatalf("restored events=%d err=%v", n, err)
	}
}

func TestMigrationRejectsNewerDatabaseVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "analytics.sqlite")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err = db.Exec("PRAGMA user_version=99"); err != nil {
		t.Fatal(err)
	}
	if err = ApplyMigrations(context.Background(), db); err == nil {
		t.Fatal("newer database version accepted")
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	if newer, err := Open(path); err == nil {
		newer.Close()
		t.Fatal("Open accepted newer database version")
	}
}
