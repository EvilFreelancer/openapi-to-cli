#!/bin/bash
# Downloads test fixtures for integration tests
# Run: bash tests/fixtures/download.sh

DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Downloading GitHub API spec (11MB, 845 endpoints)..."
curl -sL https://api.apis.guru/v2/specs/github.com/api.github.com/1.1.4/openapi.json -o "$DIR/github-openapi.json"

echo "Downloading Box API spec YAML (1.2MB, 258 endpoints)..."
curl -sL https://api.apis.guru/v2/specs/box.com/2.0.0/openapi.yaml -o "$DIR/box-openapi.yaml"

echo "Done. Fixtures saved to $DIR"
ls -lh "$DIR"/*.json "$DIR"/*.yaml 2>/dev/null
