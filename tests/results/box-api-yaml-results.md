# Box API Test Results (YAML format)

- **Spec**: https://api.apis.guru/v2/specs/box.com/2.0.0/openapi.yaml
- **Endpoints**: 258
- **Format**: YAML
- **Date**: 2026-03-13

## YAML Spec Parsing (4/4)

| Test | Status |
|------|--------|
| parses 250+ endpoints from YAML | PASS |
| generates unique command names | PASS |
| every command has valid fields | PASS |
| preserves descriptions from YAML (100+) | PASS |

## BM25 Search on YAML-loaded Spec (7/7)

| Test | Status | Time |
|------|--------|------|
| finds file operations | PASS | 7ms |
| finds folder operations | PASS | 5ms |
| finds collaboration endpoints | PASS | 6ms |
| finds comment endpoints | PASS | 5ms |
| finds user/group management | PASS | 7ms |
| finds webhook/event endpoints | PASS | 6ms |
| finds metadata endpoints | PASS | 5ms |

## Regex Search (2/2)

| Test | Status |
|------|--------|
| finds all file-related endpoints (10+) | PASS |
| finds all folder-related endpoints (5+) | PASS |

## Summary

**13 tests | 13 passed | 0 failed | ~1s**
