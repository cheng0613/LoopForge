#!/usr/bin/env bash
# Run Go tests for the platform on this Windows machine.
#
# The platform uses Unix-only syscalls (syscall.Kill, syscall.Flock,
# SysProcAttr.Setpgid), so it cannot build or run tests natively on Windows. Go
# cross-compiles the test binary here and this script runs it in a Linux
# container, which avoids rebuilding a full image for every run.
#
#   ./scripts/gotest.sh ./internal/repo/            # whole package
#   ./scripts/gotest.sh ./internal/engine/ -run TestWorkflowAgent
#   ./scripts/gotest.sh ./internal/httpapi/ -v -run TestGlobalPartner
#
# Needs Go (C:\Program Files\Go\bin) and Docker.

set -euo pipefail
cd "$(dirname "$0")/.."

GO_BIN="${GO_BIN:-/c/Program Files/Go/bin}"
export PATH="$GO_BIN:$PATH"

pkg="${1:?usage: gotest.sh <package> [go test flags...]}"
shift || true

out=".testbin"
mkdir -p "$out"
name="$(echo "$pkg" | tr '/.' '__')"

echo "[gotest] building $pkg for linux/amd64"
GOOS=linux GOARCH=amd64 go test -c -o "$out/$name.test" "$pkg"

echo "[gotest] running in container"
# Some tests read seed data through a path relative to the package directory
# ("../../migrations"), so run from the package itself, not from .testbin.
# Engine tests shell out to git for workspace and gate cases, so the image needs
# a git binary; debian-slim has none.
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(pwd)":/src -w "/src/$pkg" \
  golang:1.26-bookworm "/src/$out/$name.test" "$@"
