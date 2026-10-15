package reporting

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const apiBase = "https://sheets.googleapis.com/v4/spreadsheets/"

type Doer interface {
	Do(*http.Request) (*http.Response, error)
}
type WaitFunc func(context.Context, time.Duration) error
type Client struct {
	HTTP          Doer
	Budget        *Budget
	SpreadsheetID string
	Wait          WaitFunc
	Now           func() time.Time
}
type tabMeta struct {
	Properties struct {
		Title   string `json:"title"`
		SheetID int    `json:"sheetId"`
	} `json:"properties"`
}
type metadata struct {
	Sheets []tabMeta `json:"sheets"`
}

type apiStatusError struct{ status int }

func (e *apiStatusError) Error() string { return fmt.Sprintf("Sheets API returned HTTP %d", e.status) }

func (c *Client) cacheKey() string { return "tab_metadata:" + c.SpreadsheetID }

func (c *Client) now() time.Time {
	if c.Now != nil {
		return c.Now().UTC()
	}
	return time.Now().UTC()
}

func (c *Client) Export(ctx context.Context, tables []Table) error {
	if c.HTTP == nil || c.Budget == nil || c.SpreadsheetID == "" {
		return errors.New("Sheets client is not configured")
	}
	existing := map[string]bool{}
	cached, found, err := c.Budget.GetState(ctx, c.cacheKey())
	if err != nil {
		return fmt.Errorf("read cached tab metadata: %w", err)
	}
	if found {
		var titles []string
		if json.Unmarshal([]byte(cached), &titles) != nil {
			found = false
			_ = c.Budget.DeleteState(ctx, c.cacheKey())
		}
		for _, title := range titles {
			existing[title] = true
		}
	}
	if !found {
		var meta metadata
		if err := c.request(ctx, http.MethodGet, apiBase+c.SpreadsheetID+"?fields=sheets.properties(title,sheetId)", nil, &meta); err != nil {
			return fmt.Errorf("read spreadsheet metadata: %w", err)
		}
		for _, s := range meta.Sheets {
			existing[s.Properties.Title] = true
		}
	}
	var missing []map[string]any
	for _, t := range tables {
		if !existing[t.Name] {
			missing = append(missing, map[string]any{"addSheet": map[string]any{"properties": map[string]any{"title": t.Name}}})
		}
	}
	if len(missing) > 0 {
		body, _ := json.Marshal(map[string]any{"requests": missing})
		if err := c.request(ctx, http.MethodPost, apiBase+c.SpreadsheetID+":batchUpdate", body, nil); err != nil {
			c.invalidateOnStaleMetadata(ctx, err)
			return fmt.Errorf("initialize report tabs: %w", err)
		}
		for _, t := range tables {
			existing[t.Name] = true
		}
	}
	titles := make([]string, 0, len(existing))
	for title := range existing {
		titles = append(titles, title)
	}
	encodedTitles, err := json.Marshal(titles)
	if err != nil {
		return errors.New("encode tab metadata cache")
	}
	if err := c.Budget.SetState(ctx, c.cacheKey(), string(encodedTitles)); err != nil {
		return fmt.Errorf("cache tab metadata: %w", err)
	}
	type dataRange struct {
		Range          string  `json:"range"`
		MajorDimension string  `json:"majorDimension"`
		Values         [][]any `json:"values"`
	}
	data := make([]dataRange, 0, len(tables))
	for _, t := range tables {
		if len(t.Values) == 0 || len(t.Values[0]) == 0 {
			return fmt.Errorf("report table %q has no header", t.Name)
		}
		v := make([][]any, 1000)
		for i := range v {
			v[i] = make([]any, len(t.Values[0]))
			for j := range v[i] {
				v[i][j] = ""
			}
			if i < len(t.Values) {
				copy(v[i], t.Values[i])
			}
		}
		data = append(data, dataRange{Range: "'" + strings.ReplaceAll(t.Name, "'", "''") + "'!A1", MajorDimension: "ROWS", Values: v})
	}
	body, _ := json.Marshal(map[string]any{"valueInputOption": "RAW", "data": data})
	if err := c.request(ctx, http.MethodPost, apiBase+c.SpreadsheetID+"/values:batchUpdate", body, nil); err != nil {
		c.invalidateOnStaleMetadata(ctx, err)
		return fmt.Errorf("write report values: %w", err)
	}
	return nil
}

func (c *Client) invalidateOnStaleMetadata(ctx context.Context, err error) {
	var status *apiStatusError
	if errors.As(err, &status) && (status.status == http.StatusBadRequest || status.status == http.StatusNotFound) {
		_ = c.Budget.DeleteState(ctx, c.cacheKey())
	}
}

func (c *Client) request(ctx context.Context, method, url string, body []byte, out any) error {
	var last error
	for attempt := 0; attempt <= 2; attempt++ {
		if err := c.Budget.Reserve(ctx); err != nil {
			return err
		}
		req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := c.HTTP.Do(req)
		delay := time.Duration(1<<attempt) * time.Second
		if err != nil {
			last = errors.New("Sheets API transport failure")
		} else {
			payload, e := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
			resp.Body.Close()
			if e != nil {
				last = errors.New("unable to read Sheets API response")
			} else if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				if out != nil && len(payload) > 0 {
					if json.Unmarshal(payload, out) != nil {
						return errors.New("invalid Sheets API JSON response")
					}
					return nil
				}
				return nil
			} else {
				last = &apiStatusError{status: resp.StatusCode}
				if resp.StatusCode < 500 && resp.StatusCode != 429 {
					return last
				}
			}
			if resp.StatusCode == 429 {
				if raw := resp.Header.Get("Retry-After"); raw != "" {
					if seconds, e := strconv.Atoi(raw); e == nil && seconds >= 0 {
						if seconds > 60 {
							return last
						}
						delay = time.Duration(seconds) * time.Second
					} else if stamp, e := http.ParseTime(raw); e == nil && stamp.After(c.now()) {
						delay = stamp.Sub(c.now())
						if delay > 60*time.Second {
							return last
						}
					}
				}
			}
		}
		if attempt < 2 {
			wait := c.Wait
			if wait == nil {
				wait = func(ctx context.Context, d time.Duration) error {
					timer := time.NewTimer(d)
					defer timer.Stop()
					select {
					case <-ctx.Done():
						return ctx.Err()
					case <-timer.C:
						return nil
					}
				}
			}
			if e := wait(ctx, delay); e != nil {
				return e
			}
		}
	}
	return last
}
