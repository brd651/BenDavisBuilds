package reporting

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const maxRows = 999

var privatePathToken = regexp.MustCompile(`(?i)[^/]*(@|%40)[^/]*`)

type Table struct {
	Name   string  `json:"name"`
	Values [][]any `json:"values"`
}

// BuildTables returns bounded, aggregate-only tables. No visitor/session IDs,
// event properties, or individual journeys leave SQLite.
func BuildTables(ctx context.Context, db *sql.DB, now time.Time) ([]Table, error) {
	utc := now.UTC()
	startDay := time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC).Unix()
	week := utc.AddDate(0, 0, -6).Unix()
	month := utc.AddDate(0, -1, 0).Unix()
	tables := []Table{{Name: "Overview", Values: [][]any{{"Metric", "Value", "As of UTC"},
		{"Visitors today", scalar(ctx, db, `SELECT count(DISTINCT COALESCE(visitor_id,session_id)) FROM sessions WHERE started_at>=?`, startDay), utc.Format(time.RFC3339)},
		{"Sessions today", scalar(ctx, db, `SELECT count(*) FROM sessions WHERE started_at>=?`, startDay), utc.Format(time.RFC3339)},
		{"Visitors this week", scalar(ctx, db, `SELECT count(DISTINCT COALESCE(visitor_id,session_id)) FROM sessions WHERE started_at>=?`, week), utc.Format(time.RFC3339)},
		{"Visitors this month", scalar(ctx, db, `SELECT count(DISTINCT COALESCE(visitor_id,session_id)) FROM sessions WHERE started_at>=?`, month), utc.Format(time.RFC3339)},
		{"Returning visitor percentage", scalar(ctx, db, `SELECT CASE WHEN count(*)=0 THEN 0.0 ELSE 100.0*sum(CASE WHEN visits>1 THEN 1 ELSE 0 END)/count(*) END FROM (SELECT visitor_id,count(*) visits FROM sessions WHERE visitor_id IS NOT NULL GROUP BY visitor_id)`), utc.Format(time.RFC3339)},
		{"Contact submissions", scalar(ctx, db, `SELECT count(*) FROM events WHERE type='contact_submitted' AND occurred_at>=?`, startDay), utc.Format(time.RFC3339)},
		{"Mentorship intent", scalar(ctx, db, `SELECT count(*) FROM events WHERE type='mentorship_intent' AND occurred_at>=?`, startDay), utc.Format(time.RFC3339)},
		{"Booking intent", scalar(ctx, db, `SELECT count(*) FROM events WHERE type='booking_intent' AND occurred_at>=?`, startDay), utc.Format(time.RFC3339)},
	}}}
	queries := []struct {
		name, query string
		header      []any
	}{
		{"Traffic Sources", `SELECT COALESCE(NULLIF(source,''),'Direct / unknown'),COALESCE(NULLIF(utm_source,''),''),COALESCE(NULLIF(utm_medium,''),''),COALESCE(NULLIF(utm_campaign,''),''),count(*) FROM sessions GROUP BY 1,2,3,4 ORDER BY 5 DESC LIMIT 1000`, []any{"Source", "UTM source", "UTM medium", "UTM campaign", "Sessions"}},
		{"Content Performance", `SELECT path,count(*) FROM events WHERE type='pageview' GROUP BY path ORDER BY 2 DESC LIMIT 1000`, []any{"Path", "Pageviews"}},
		{"Returning Visitors", `SELECT CASE WHEN visits=1 THEN 'New (one observed session)' ELSE 'Returning' END,count(*) FROM (SELECT visitor_id,count(*) visits FROM sessions WHERE visitor_id IS NOT NULL GROUP BY visitor_id) GROUP BY 1`, []any{"Visitor cohort", "Visitors"}},
		{"Engagement", `SELECT type,count(*) FROM events WHERE type IN ('engagement','scroll','navigation_click','social_click','project_interaction') GROUP BY type ORDER BY type`, []any{"Event", "Count"}},
		{"Conversions", `SELECT type,count(*) FROM events WHERE type IN ('contact_intent','contact_submitted','mentorship_intent','booking_intent') GROUP BY type ORDER BY type`, []any{"Intent", "Count"}},
		{"Collector Health", `SELECT 'Events received',count(*) FROM events UNION ALL SELECT 'Events last 24 hours',count(*) FROM events WHERE occurred_at>=? UNION ALL SELECT 'Latest event UTC',COALESCE(max(occurred_at),0) FROM events`, []any{"Metric", "Value"}},
		{"Daily", `SELECT strftime('%Y-%m-%d',occurred_at,'unixepoch') day,type,count(*) FROM events WHERE occurred_at>=? GROUP BY 1,2 ORDER BY 1 DESC,2 LIMIT 1000`, []any{"UTC date", "Event", "Count"}},
		{"Hourly", `SELECT strftime('%Y-%m-%d %H:00',occurred_at,'unixepoch') hour,type,count(*) FROM events WHERE occurred_at>=? GROUP BY 1,2 ORDER BY 1 DESC,2 LIMIT 1000`, []any{"UTC hour", "Event", "Count"}},
	}
	for _, q := range queries {
		args := []any{}
		if q.name == "Collector Health" {
			args = append(args, utc.Add(-24*time.Hour).Unix())
		}
		if q.name == "Daily" {
			args = append(args, utc.AddDate(0, 0, -90).Unix())
		}
		if q.name == "Hourly" {
			args = append(args, utc.Add(-7*24*time.Hour).Unix())
		}
		rows, err := db.QueryContext(ctx, q.query, args...)
		if err != nil {
			return nil, fmt.Errorf("query %s: %w", q.name, err)
		}
		t := Table{Name: q.name, Values: [][]any{q.header}}
		for rows.Next() {
			vals := make([]any, len(q.header))
			ptr := make([]any, len(vals))
			for i := range vals {
				ptr[i] = &vals[i]
			}
			if err := rows.Scan(ptr...); err != nil {
				rows.Close()
				return nil, err
			}
			for i, v := range vals {
				if x, ok := v.([]byte); ok {
					vals[i] = string(x)
				}
			}
			if q.name == "Traffic Sources" {
				for i := 0; i < 4; i++ {
					vals[i] = safeAttribution(fmt.Sprint(vals[i]), i == 0)
				}
			}
			if q.name == "Content Performance" && len(vals) > 0 {
				vals[0] = safePath(fmt.Sprint(vals[0]))
			}
			t.Values = append(t.Values, vals)
			if len(t.Values) >= maxRows+1 {
				break
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
		tables = append(tables, t)
	}
	return tables, nil
}

func safeAttribution(value string, source bool) string {
	value = strings.TrimSpace(value)
	if strings.ContainsAny(value, "@?#") {
		return "Other / withheld"
	}
	if source && strings.Contains(value, "://") {
		u, err := url.Parse(value)
		if err != nil || u.Hostname() == "" {
			return "Other / withheld"
		}
		value = u.Hostname()
	}
	if len(value) > 100 {
		value = value[:100]
	}
	return value
}

func safePath(path string) string {
	u, err := url.Parse(path)
	if err == nil {
		path = u.Path
	}
	parts := strings.Split(path, "/")
	for i := range parts {
		if privatePathToken.MatchString(parts[i]) {
			parts[i] = "[withheld]"
		}
	}
	path = strings.Join(parts, "/")
	if len(path) > 200 {
		return path[:200]
	}
	return path
}

func scalar(ctx context.Context, db *sql.DB, q string, args ...any) any {
	var v any
	if err := db.QueryRowContext(ctx, q, args...).Scan(&v); err != nil {
		return 0
	}
	if b, ok := v.([]byte); ok {
		return string(b)
	}
	return v
}
