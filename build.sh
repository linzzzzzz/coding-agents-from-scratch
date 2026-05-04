#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

rm -rf "$ROOT/docs"
mkdir -p "$ROOT/docs"

echo "Building TypeScript edition..."
(cd "$ROOT/typescript" && mdbook build)

echo "Building Python edition..."
(cd "$ROOT/python" && mdbook build)

# Copy landing page to docs root
cp "$ROOT/index.html" "$ROOT/docs/index.html"

echo "Done! Output in docs/"
