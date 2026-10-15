package reporting

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

var ErrDeferred = errors.New("export deferred by request budget or schedule")
var ErrBusy = errors.New("another export is in progress")

// Budget persists every reserved Sheets request. Reservations are made before
// the network call, so a crash can over-count but can never exceed a limit.
type Budget struct {
	DB  *sql.DB
	Now func() time.Time
}

func (b *Budget) Init(ctx context.Context) error {
	_, err := b.DB.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS sheets_request_usage (
		id INTEGER PRIMARY KEY AUTOINCREMENT, reserved_at INTEGER NOT NULL, utc_day TEXT NOT NULL
	); CREATE INDEX IF NOT EXISTS sheets_usage_time_idx ON sheets_request_usage(reserved_at);
	CREATE TABLE IF NOT EXISTS sheets_export_state (
		key TEXT PRIMARY KEY, value TEXT NOT NULL
	);`)
	return err
}

func (b *Budget) now() time.Time {
	if b.Now != nil {
		return b.Now().UTC()
	}
	return time.Now().UTC()
}

// Acquire serializes exporters across processes using a renewable lease.
func (b *Budget) Acquire(ctx context.Context, scheduled bool) (func(), error) {
	now := b.now()
	tx, err := b.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO sheets_export_state(key,value) VALUES('lease_until','0')`); err != nil {
		return nil, err
	}
	var lease int64
	if err = tx.QueryRowContext(ctx, `SELECT CAST(value AS INTEGER) FROM sheets_export_state WHERE key='lease_until'`).Scan(&lease); err != nil {
		return nil, err
	}
	if lease > now.Unix() {
		return nil, ErrBusy
	}
	if scheduled {
		var last int64
		queryErr := tx.QueryRowContext(ctx, `SELECT CAST(value AS INTEGER) FROM sheets_export_state WHERE key='last_scheduled'`).Scan(&last)
		if queryErr != nil && queryErr != sql.ErrNoRows {
			return nil, queryErr
		}
		if last > 0 && now.Unix()-last < 3600 {
			return nil, ErrDeferred
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO sheets_export_state(key,value) VALUES('last_scheduled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, fmt.Sprint(now.Unix())); err != nil {
			return nil, err
		}
	}
	if _, err = tx.ExecContext(ctx, `UPDATE sheets_export_state SET value=? WHERE key='lease_until'`, fmt.Sprint(now.Add(15*time.Minute).Unix())); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return func() { _, _ = b.DB.Exec(`UPDATE sheets_export_state SET value='0' WHERE key='lease_until'`) }, nil
}

func (b *Budget) Reserve(ctx context.Context) error {
	now := b.now()
	day := now.Format("2006-01-02")
	tx, err := b.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var minute, daily int
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM sheets_request_usage WHERE reserved_at>?`, now.Add(-60*time.Second).Unix()).Scan(&minute); err != nil {
		return err
	}
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM sheets_request_usage WHERE utc_day=?`, day).Scan(&daily); err != nil {
		return err
	}
	if minute >= 10 || daily >= 120 {
		return ErrDeferred
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO sheets_request_usage(reserved_at,utc_day) VALUES(?,?)`, now.Unix(), day); err != nil {
		return err
	}
	return tx.Commit()
}

func (b *Budget) MarkSuccess(ctx context.Context, at time.Time) error {
	tx, err := b.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stamp := at.UTC().Format(time.RFC3339)
	for key, value := range map[string]string{"last_success": stamp, "last_attempt": stamp, "last_status": "success"} {
		if _, err := tx.ExecContext(ctx, `INSERT INTO sheets_export_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (b *Budget) MarkAttempt(ctx context.Context, at time.Time) error {
	stamp := at.UTC().Format(time.RFC3339)
	tx, err := b.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for key, value := range map[string]string{"last_attempt": stamp, "last_status": "running"} {
		if _, err := tx.ExecContext(ctx, `INSERT INTO sheets_export_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (b *Budget) MarkDeferred(ctx context.Context, reason string) error {
	return b.SetState(ctx, "last_status", "deferred:"+reason)
}

func (b *Budget) MarkFailure(ctx context.Context) error {
	return b.SetState(ctx, "last_status", "failed")
}

func (b *Budget) GetState(ctx context.Context, key string) (string, bool, error) {
	var value string
	err := b.DB.QueryRowContext(ctx, `SELECT value FROM sheets_export_state WHERE key=?`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return value, true, nil
}

func (b *Budget) SetState(ctx context.Context, key, value string) error {
	_, err := b.DB.ExecContext(ctx, `INSERT INTO sheets_export_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}

func (b *Budget) DeleteState(ctx context.Context, key string) error {
	_, err := b.DB.ExecContext(ctx, `DELETE FROM sheets_export_state WHERE key=?`, key)
	return err
}
