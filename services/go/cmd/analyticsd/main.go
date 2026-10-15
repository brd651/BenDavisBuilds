package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/brd651/BenDavisBuilds/services/go/internal/analytics"
	"github.com/brd651/BenDavisBuilds/services/go/internal/platform"
	"github.com/brd651/BenDavisBuilds/services/go/internal/storage"
)

func main() {
	dbPath := platform.Env("BDB_ANALYTICS_DB", "/var/lib/bdb-analytics/analytics.sqlite")
	db, err := storage.Open(dbPath)
	if err != nil {
		log.Fatal("analytics database unavailable")
	}
	defer db.Close()
	if len(os.Args) > 1 {
		if err := runCommand(db, dbPath, os.Args[1:]); err != nil {
			log.Fatal(err)
		}
		return
	}
	secretPath := platform.Env("BDB_ANALYTICS_SECRET_FILE", "")
	if secretPath == "" {
		log.Fatal("BDB_ANALYTICS_SECRET_FILE required")
	}
	info, err := os.Stat(secretPath)
	if err != nil {
		log.Fatal("analytics secret unavailable")
	}
	if info.Mode().Perm()&0077 != 0 {
		log.Fatal("analytics secret permissions must be 0600")
	}
	secret, err := os.ReadFile(secretPath)
	if err != nil || len(secret) < 32 {
		log.Fatal("analytics secret unavailable")
	}
	pathsFile := platform.Env("BDB_ANALYTICS_PATHS_FILE", "")
	if pathsFile == "" {
		log.Fatal("BDB_ANALYTICS_PATHS_FILE required")
	}
	pathsData, err := os.ReadFile(pathsFile)
	if err != nil {
		log.Fatal("analytics allowed paths unavailable")
	}
	var paths []string
	decoder := json.NewDecoder(bytes.NewReader(pathsData))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&paths); err != nil || len(paths) == 0 {
		log.Fatal("analytics allowed paths invalid")
	}
	if err = decoder.Decode(new(any)); err != io.EOF {
		log.Fatal("analytics allowed paths invalid")
	}
	pathRE := regexp.MustCompile(`^/[A-Za-z0-9/_~.-]{0,180}$`)
	allowedPaths := make(map[string]bool, len(paths))
	for _, path := range paths {
		if !pathRE.MatchString(path) || strings.Contains(path, "..") || strings.ContainsAny(path, "?#") {
			log.Fatal("analytics allowed paths invalid")
		}
		allowedPaths[path] = true
	}
	address := platform.Env("BDB_ANALYTICS_ADDR", "127.0.0.1:8091")
	h := analytics.NewHandler(db, secret, platform.Env("BDB_ORIGIN", "https://bendavisbuilds.com"))
	h.AllowedPaths = allowedPaths
	if err := platform.Serve(address, http.Handler(h)); err != nil {
		log.Fatal("analytics listener failed")
	}
}

func runCommand(db *sql.DB, dbPath string, args []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	switch args[0] {
	case "integrity":
		return storage.Integrity(ctx, db)
	case "backup":
		if len(args) != 2 {
			return fmt.Errorf("usage: analyticsd backup DESTINATION")
		}
		return storage.Backup(ctx, db, args[1])
	case "restore":
		if len(args) != 3 {
			return fmt.Errorf("usage: analyticsd restore BACKUP DESTINATION")
		}
		return storage.Restore(ctx, args[1], args[2])
	case "retention":
		days := 90
		if len(args) == 2 {
			n, err := strconv.Atoi(args[1])
			if err != nil {
				return err
			}
			days = n
		}
		return analytics.Retain(ctx, db, days)
	case "report":
		var visitors, sessions, views, contacts, mentorship int64
		now := time.Now().UTC()
		day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).Unix()
		queries := []struct {
			q    string
			dest *int64
		}{{"SELECT COUNT(*) FROM visitors WHERE first_seen>=?", &visitors}, {"SELECT COUNT(*) FROM sessions WHERE started_at>=?", &sessions}, {"SELECT COUNT(*) FROM events WHERE type='pageview' AND occurred_at>=?", &views}, {"SELECT COUNT(*) FROM events WHERE type IN ('contact_intent','contact_submitted') AND occurred_at>=?", &contacts}, {"SELECT COUNT(*) FROM events WHERE type IN ('mentorship_intent','booking_intent') AND occurred_at>=?", &mentorship}}
		for _, item := range queries {
			if err := db.QueryRowContext(ctx, item.q, day).Scan(item.dest); err != nil {
				return err
			}
		}
		fmt.Printf("UTC date: %s\nVisitors: %d\nSessions: %d\nPageviews: %d\nContact intent/submissions: %d\nMentorship/booking intent: %d\n", now.Format("2006-01-02"), visitors, sessions, views, contacts, mentorship)
		return nil
	default:
		return fmt.Errorf("unknown analyticsd command")
	}
}
