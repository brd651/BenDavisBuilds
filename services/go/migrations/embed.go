// Package migrations contains the versioned SQLite schema and migration source.
package migrations

import "embed"

//go:embed *.sql
var Files embed.FS
