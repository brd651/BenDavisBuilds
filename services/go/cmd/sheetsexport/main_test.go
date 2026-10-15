package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadCredentialRequiresOwnerOnlyRegularFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credential.json")
	if err := os.WriteFile(path, []byte(`{"private_key":"test"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if got, err := readCredential(path); err != nil || len(got) == 0 {
		t.Fatalf("owner-only credential rejected: %v", err)
	}
	if err := os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := readCredential(path); err == nil {
		t.Fatal("group/world-readable credential accepted")
	}
	dir := t.TempDir()
	if _, err := readCredential(dir); err == nil {
		t.Fatal("directory accepted as credential")
	}
}
