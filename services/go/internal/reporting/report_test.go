package reporting

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	db, e := sql.Open("sqlite", ":memory:")
	if e != nil {
		t.Fatal(e)
	}
	db.SetMaxOpenConns(1)
	_, e = db.Exec(`CREATE TABLE visitors(id TEXT PRIMARY KEY,first_seen INTEGER,last_seen INTEGER);CREATE TABLE sessions(id TEXT PRIMARY KEY,visitor_id TEXT,started_at INTEGER,last_seen INTEGER,source TEXT,utm_source TEXT,utm_medium TEXT,utm_campaign TEXT);CREATE TABLE events(id TEXT PRIMARY KEY,session_id TEXT,type TEXT,path TEXT,occurred_at INTEGER,properties TEXT);`)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestBuildTablesAggregatesWithoutIdentity(t *testing.T) {
	db := testDB(t)
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	_, e := db.Exec(`INSERT INTO visitors VALUES('secret-visitor',1,2);INSERT INTO sessions VALUES('private-session','secret-visitor',?,?,'search','google','organic','fall');INSERT INTO events VALUES('e1','private-session','pageview','/writing/',?,'{}'),('e2','private-session','scroll','/writing/',?,'{}')`, now.Unix(), now.Unix(), now.Unix(), now.Unix())
	if e != nil {
		t.Fatal(e)
	}
	tables, e := BuildTables(context.Background(), db, now)
	if e != nil {
		t.Fatal(e)
	}
	encoded, _ := json.Marshal(tables)
	s := string(encoded)
	if strings.Contains(s, "secret-visitor") || strings.Contains(s, "private-session") {
		t.Fatalf("identity leaked: %s", s)
	}
	if !strings.Contains(s, "/writing/") || !strings.Contains(s, "Traffic Sources") {
		t.Fatalf("expected aggregate rows missing: %s", s)
	}
	if got := tables[0].Values[1][1]; got != int64(1) {
		t.Fatalf("expected visitor count 1, got %#v", got)
	}
}

func TestBuildTablesPropagatesOverviewSchemaErrors(t *testing.T) {
	db := testDB(t)
	if _, err := db.Exec(`DROP TABLE sessions`); err != nil {
		t.Fatal(err)
	}
	if _, err := BuildTables(context.Background(), db, time.Now()); err == nil {
		t.Fatal("expected missing sessions table error")
	}
}

func TestExportLabelsSuppressPersonalAttributionAndQuery(t *testing.T) {
	if got := safeAttribution("https://example.test/path?email=a@example.test", true); got != "Other / withheld" {
		t.Fatalf("unsafe source: %q", got)
	}
	if got := safeAttribution("campaign@example.test", false); got != "Other / withheld" {
		t.Fatalf("unsafe UTM label: %q", got)
	}
	if got := safePath("/people/alex%40example.test?token=private"); got != "/people/[withheld]" {
		t.Fatalf("unsafe content path: %q", got)
	}
}

func TestBudgetPersistsAndEnforcesSlidingAndDailyLimits(t *testing.T) {
	db := testDB(t)
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	b := &Budget{DB: db, Now: func() time.Time { return now }}
	if e := b.Init(context.Background()); e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 10; i++ {
		if e := b.Reserve(context.Background()); e != nil {
			t.Fatal(e)
		}
	}
	if e := b.Reserve(context.Background()); e != ErrDeferred {
		t.Fatalf("11th request: %v", e)
	}
	// Restarting the Budget object must retain reservations.
	b = &Budget{DB: db, Now: func() time.Time { return now }}
	if e := b.Init(context.Background()); e != nil {
		t.Fatal(e)
	}
	if e := b.Reserve(context.Background()); e != ErrDeferred {
		t.Fatalf("restart reset rolling quota: %v", e)
	}
	now = now.Add(time.Minute + time.Second)
	for i := 0; i < 10; i++ {
		if e := b.Reserve(context.Background()); e != nil {
			t.Fatal(e)
		}
	}
	if e := b.Reserve(context.Background()); e != ErrDeferred {
		t.Fatalf("daily cap not persisted/enforced: %v", e)
	}
}

func TestScheduledGateAndLease(t *testing.T) {
	db := testDB(t)
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	b := &Budget{DB: db, Now: func() time.Time { return now }}
	_ = b.Init(context.Background())
	release, e := b.Acquire(context.Background(), true)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = b.Acquire(context.Background(), false); e != ErrBusy {
		t.Fatalf("parallel exporter accepted: %v", e)
	}
	release()
	if _, e = b.Acquire(context.Background(), true); e != ErrDeferred {
		t.Fatalf("scheduled hourly gate missing: %v", e)
	}
	if _, e = b.Acquire(context.Background(), false); e != nil {
		t.Fatalf("manual run should be allowed after release: %v", e)
	}
}

func TestAttemptAndDeferredStatusPersist(t *testing.T) {
	db := testDB(t)
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	budget := &Budget{DB: db, Now: func() time.Time { return now }}
	if err := budget.Init(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := budget.MarkAttempt(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	if err := budget.MarkDeferred(context.Background(), "request_budget"); err != nil {
		t.Fatal(err)
	}
	status, ok, err := budget.GetState(context.Background(), "last_status")
	if err != nil || !ok || status != "deferred:request_budget" {
		t.Fatalf("status=%q found=%v err=%v", status, ok, err)
	}
	attempt, ok, err := budget.GetState(context.Background(), "last_attempt")
	if err != nil || !ok || attempt != now.Format(time.RFC3339) {
		t.Fatalf("attempt=%q found=%v err=%v", attempt, ok, err)
	}
}

type fakeDoer struct {
	codes    []int
	calls    int
	payloads [][]byte
	bodies   [][]byte
}

func (f *fakeDoer) Do(r *http.Request) (*http.Response, error) {
	f.calls++
	requestBody, _ := io.ReadAll(r.Body)
	f.bodies = append(f.bodies, requestBody)
	i := f.calls - 1
	code := 200
	if i < len(f.codes) {
		code = f.codes[i]
	}
	var body string
	if i < len(f.payloads) {
		body = string(f.payloads[i])
	} else {
		body = `{"sheets":[{"properties":{"title":"Overview","sheetId":1}}]}`
	}
	return &http.Response{StatusCode: code, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
}

func TestTabMetadataCachedAndEmptyCellsCleared(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	budget := &Budget{DB: db}
	if err := budget.Init(ctx); err != nil {
		t.Fatal(err)
	}
	fake := &fakeDoer{payloads: [][]byte{[]byte(`{"sheets":[]}`), []byte(`{}`), []byte(`{"totalUpdatedRows":3}`)}}
	client := &Client{HTTP: fake, Budget: budget, SpreadsheetID: "mock", Wait: func(context.Context, time.Duration) error { return nil }}
	table := []Table{{Name: "Overview", Values: [][]any{{"Metric", "Value"}, {"Visitors", 2}}}}
	if err := client.Export(ctx, table); err != nil {
		t.Fatal(err)
	}
	if fake.calls != 3 {
		t.Fatalf("first run calls=%d; want metadata, initialize, write", fake.calls)
	}
	var values struct {
		Data []struct {
			Values [][]any `json:"values"`
		} `json:"data"`
	}
	if err := json.Unmarshal(fake.bodies[2], &values); err != nil {
		t.Fatal(err)
	}
	if got := values.Data[0].Values[999][0]; got != "" {
		t.Fatalf("unused cell must be empty string, got %#v", got)
	}
	if err := client.Export(ctx, table); err != nil {
		t.Fatal(err)
	}
	if fake.calls != 4 {
		t.Fatalf("second run repeated metadata or initialization: calls=%d", fake.calls)
	}
	var reserved int
	if err := db.QueryRow(`SELECT count(*) FROM sheets_request_usage`).Scan(&reserved); err != nil {
		t.Fatal(err)
	}
	if reserved != 4 {
		t.Fatalf("reserved requests=%d; want all four API requests", reserved)
	}
}

func TestStaleTabCacheInvalidatedAfterNotFound(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	budget := &Budget{DB: db}
	_ = budget.Init(ctx)
	if err := budget.SetState(ctx, "tab_metadata:mock", `["Overview"]`); err != nil {
		t.Fatal(err)
	}
	fake := &fakeDoer{codes: []int{404}}
	client := &Client{HTTP: fake, Budget: budget, SpreadsheetID: "mock", Wait: func(context.Context, time.Duration) error { return nil }}
	table := []Table{{Name: "Overview", Values: [][]any{{"Metric"}, {"Visitors"}}}}
	if err := client.Export(ctx, table); err == nil {
		t.Fatal("expected stale tab request to fail")
	}
	if _, ok, err := budget.GetState(ctx, "tab_metadata:mock"); err != nil || ok {
		t.Fatalf("stale metadata cache retained: found=%v err=%v", ok, err)
	}
	if err := client.Export(ctx, table); err != nil {
		t.Fatal(err)
	}
	if fake.calls != 3 {
		t.Fatalf("recovery did not reread metadata then write: calls=%d", fake.calls)
	}
}
func TestExporterBatchesAndRetriesWithinBudget(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	b := &Budget{DB: db}
	if e := b.Init(ctx); e != nil {
		t.Fatal(e)
	}
	fake := &fakeDoer{codes: []int{429, 200, 200, 200}, payloads: [][]byte{[]byte(`{"error":"busy"}`), []byte(`{"sheets":[{"properties":{"title":"Overview","sheetId":1}}]}`), []byte(`{}`), []byte(`{"totalUpdatedRows":3}`)}}
	waits := 0
	c := &Client{HTTP: fake, Budget: b, SpreadsheetID: "mock", Wait: func(context.Context, time.Duration) error { waits++; return nil }}
	if e := c.Export(ctx, []Table{{Name: "Overview", Values: [][]any{{"Metric", "Value"}, {"Visitors", 2}}}}); e != nil {
		t.Fatal(e)
	}
	if fake.calls != 3 || waits != 1 {
		t.Fatalf("calls=%d waits=%d", fake.calls, waits)
	}
	var reservations int
	if e := db.QueryRow(`SELECT count(*) FROM sheets_request_usage`).Scan(&reservations); e != nil || reservations != 3 {
		t.Fatalf("reserved count=%d err=%v", reservations, e)
	}
}

func TestExporterStopsWhenBudgetExhausted(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	b := &Budget{DB: db}
	_ = b.Init(ctx)
	for i := 0; i < 10; i++ {
		if e := b.Reserve(ctx); e != nil {
			t.Fatal(e)
		}
	}
	fake := &fakeDoer{}
	c := &Client{HTTP: fake, Budget: b, SpreadsheetID: "mock"}
	e := c.Export(ctx, []Table{{Name: "Overview", Values: [][]any{{"Metric"}}}})
	if !errors.Is(e, ErrDeferred) {
		t.Fatalf("expected defer, got %v", e)
	}
	if fake.calls != 0 {
		t.Fatalf("request escaped quota: %d", fake.calls)
	}
}

type networkFailureDoer struct{ calls int }

func (f *networkFailureDoer) Do(r *http.Request) (*http.Response, error) {
	f.calls++
	if f.calls == 1 {
		return nil, fmt.Errorf("temporary network failure")
	}
	return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"sheets":[{"properties":{"title":"Overview","sheetId":1}}]}`)), Request: r}, nil
}
func TestNetworkFailureRetriesWithoutNilResponsePanic(t *testing.T) {
	db := testDB(t)
	b := &Budget{DB: db}
	_ = b.Init(context.Background())
	doer := &networkFailureDoer{}
	c := &Client{HTTP: doer, Budget: b, SpreadsheetID: "mock", Wait: func(context.Context, time.Duration) error { return nil }}
	if e := c.request(context.Background(), http.MethodGet, "https://example.invalid", nil, &metadata{}); e != nil {
		t.Fatal(e)
	}
	if doer.calls != 2 {
		t.Fatalf("expected retry, got %d calls", doer.calls)
	}
}

func TestDailyCapAt120(t *testing.T) {
	db := testDB(t)
	now := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC)
	b := &Budget{DB: db, Now: func() time.Time { return now }}
	_ = b.Init(context.Background())
	for i := 0; i < 120; i++ {
		now = now.Add(time.Minute + time.Second)
		if e := b.Reserve(context.Background()); e != nil {
			t.Fatalf("at %d: %v", i, e)
		}
	}
	if e := b.Reserve(context.Background()); e != ErrDeferred {
		t.Fatalf("daily 121 request accepted: %v", e)
	}
}
