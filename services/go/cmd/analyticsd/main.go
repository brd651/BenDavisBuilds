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
		return report(ctx, db)
	default:
		return fmt.Errorf("unknown analyticsd command")
	}
}

// report prints bounded private aggregates and a handful of path-only journeys for SSH use.
func report(ctx context.Context, db *sql.DB) error {
	now := time.Now().UTC()
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).Unix()
	week := now.AddDate(0, 0, -7).Unix()
	month := now.AddDate(0, -1, 0).Unix()
	fmt.Printf("UTC date: %s\n", now.Format("2006-01-02"))
	for _, period := range []struct {
		name  string
		since int64
	}{{"today", day}, {"7 days", week}, {"30 days", month}} {
		var visitors, sessions, views, returning int64
		if err := db.QueryRowContext(ctx, "SELECT COUNT(DISTINCT visitor_id) FROM sessions WHERE started_at>=? AND visitor_id IS NOT NULL", period.since).Scan(&visitors); err != nil {
			return err
		}
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM sessions WHERE started_at>=?", period.since).Scan(&sessions); err != nil {
			return err
		}
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM events WHERE type='pageview' AND occurred_at>=?", period.since).Scan(&views); err != nil {
			return err
		}
		if err := db.QueryRowContext(ctx, `SELECT COUNT(DISTINCT s.visitor_id) FROM sessions s WHERE s.started_at>=? AND s.visitor_id IS NOT NULL AND EXISTS(SELECT 1 FROM sessions old WHERE old.visitor_id=s.visitor_id AND old.started_at<s.started_at)`, period.since).Scan(&returning); err != nil {
			return err
		}
		var returningPct float64
		if visitors > 0 {
			returningPct = 100 * float64(returning) / float64(visitors)
		}
		fmt.Printf("%s — consented visitors %d (new %d, returning %d / %.1f%%), sessions %d, pageviews %d\n", period.name, visitors, visitors-returning, returning, returningPct, sessions, views)
	}
	fmt.Println("\nTraffic sources (30 days):")
	if err := printRows(ctx, db, `SELECT COALESCE(NULLIF(source,''),'direct'),utm_source,utm_medium,utm_campaign,COUNT(*) FROM sessions WHERE started_at>=? GROUP BY source,utm_source,utm_medium,utm_campaign ORDER BY COUNT(*) DESC LIMIT 10`, month); err != nil {
		return err
	}
	fmt.Println("\nContent performance (30 days):")
	if err := printRows(ctx, db, `SELECT path,SUM(type='pageview'),SUM(type='engagement'),SUM(type='scroll') FROM events WHERE occurred_at>=? GROUP BY path ORDER BY SUM(type='pageview') DESC LIMIT 10`, month); err != nil {
		return err
	}
	fmt.Println("\nEngagement and conversions (30 days):")
	if err := printRows(ctx, db, `SELECT type,COUNT(*),ROUND(AVG(CASE WHEN type='engagement' THEN CAST(json_extract(properties,'$.seconds') AS REAL) END),1) FROM events WHERE occurred_at>=? GROUP BY type ORDER BY COUNT(*) DESC`, month); err != nil {
		return err
	}
	fmt.Println("\nContact funnel by category (30 days):")
	if err := printRows(ctx, db, `SELECT type,COALESCE(json_extract(properties,'$.category'),'unspecified'),COUNT(*) FROM events WHERE occurred_at>=? AND type IN ('contact_intent','contact_submitted') GROUP BY type,json_extract(properties,'$.category') ORDER BY type,COUNT(*) DESC`, month); err != nil {
		return err
	}
	fmt.Println("\nMentorship and booking intent (30 days):")
	if err := printRows(ctx, db, `SELECT type,COUNT(*) FROM events WHERE occurred_at>=? AND type IN ('mentorship_intent','booking_intent') GROUP BY type`, month); err != nil {
		return err
	}
	fmt.Println("\nNavigation paths (30 days):")
	if err := printRows(ctx, db, `WITH pages AS (SELECT session_id,path,occurred_at,LAG(path) OVER(PARTITION BY session_id ORDER BY occurred_at,rowid) AS previous FROM events WHERE type='pageview' AND occurred_at>=?) SELECT previous||' -> '||path,COUNT(*) FROM pages WHERE previous IS NOT NULL GROUP BY previous,path ORDER BY COUNT(*) DESC LIMIT 10`, month); err != nil {
		return err
	}
	fmt.Println("\nRecent journeys (paths only, latest 5 sessions):")
	rows, err := db.QueryContext(ctx, "SELECT id FROM sessions ORDER BY last_seen DESC LIMIT 5")
	if err != nil {
		return err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for i, id := range ids {
		journey, err := db.QueryContext(ctx, "SELECT path FROM events WHERE session_id=? AND type='pageview' ORDER BY occurred_at,rowid LIMIT 20", id)
		if err != nil {
			return err
		}
		var paths []string
		for journey.Next() {
			var path string
			if err = journey.Scan(&path); err != nil {
				journey.Close()
				return err
			}
			paths = append(paths, path)
		}
		if err = journey.Err(); err != nil {
			journey.Close()
			return err
		}
		journey.Close()
		fmt.Printf("%d. %s\n", i+1, strings.Join(paths, " -> "))
	}
	fmt.Println("\nCollector health:")
	var total, lastHour, sessionsLastHour int64
	var latest sql.NullInt64
	if err = db.QueryRowContext(ctx, "SELECT COUNT(*),COALESCE(SUM(occurred_at>=?),0),MAX(occurred_at) FROM events", now.Add(-time.Hour).Unix()).Scan(&total, &lastHour, &latest); err != nil {
		return err
	}
	if err = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM sessions WHERE last_seen>=?", now.Add(-time.Hour).Unix()).Scan(&sessionsLastHour); err != nil {
		return err
	}
	fmt.Printf("events total %d, events last hour %d, active sessions last hour %d, latest event UTC %s\n", total, lastHour, sessionsLastHour, nullableTime(latest))
	return nil
}

func printRows(ctx context.Context, db *sql.DB, query string, args ...any) error {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return err
	}
	for rows.Next() {
		values := make([]any, len(cols))
		dest := make([]any, len(cols))
		for i := range values {
			dest[i] = &values[i]
		}
		if err = rows.Scan(dest...); err != nil {
			return err
		}
		parts := make([]string, len(cols))
		for i, v := range values {
			parts[i] = fmt.Sprint(v)
		}
		fmt.Println(strings.Join(parts, " | "))
	}
	return rows.Err()
}
func nullableTime(value sql.NullInt64) string {
	if !value.Valid {
		return "none"
	}
	return time.Unix(value.Int64, 0).UTC().Format(time.RFC3339)
}
