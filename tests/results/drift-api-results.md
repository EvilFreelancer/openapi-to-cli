# Drift API Test Results

- **Spec**: https://drift.neuraldeep.tech/openapi.json
- **Endpoints**: 324
- **Date**: 2026-03-13

## Spec Parsing (5/5)

| Test | Status |
|------|--------|
| parses all endpoints from Drift spec | PASS |
| every command has a name, method, and path | PASS |
| generates unique command names | PASS |
| preserves path parameters as options | PASS |
| preserves query parameters | PASS |

## BM25 Search (12/12)

| Test | Status | Time |
|------|--------|------|
| finds chat-related endpoints | PASS | 3ms |
| finds file management commands | PASS | 2ms |
| finds messenger commands | PASS | 2ms |
| finds admin endpoints | PASS | 1ms |
| finds calendar events | PASS | 1ms |
| finds skills management | PASS | 2ms |
| finds MCP server management | PASS | 1ms |
| finds team management | PASS | 2ms |
| finds auth endpoints | PASS | 2ms |
| finds network channels | PASS | 2ms |
| returns scored results sorted by relevance | PASS | 1ms |
| handles broad query across 324 endpoints | PASS | 2ms |

## Regex Search (4/4)

| Test | Status |
|------|--------|
| finds all admin endpoints by path pattern (50+) | PASS |
| finds all DELETE endpoints (10+) | PASS |
| finds messenger-related by regex | PASS |
| finds workspace skills by regex | PASS |

## Endpoint Filtering (3/3)

| Test | Status |
|------|--------|
| filters to only v1 public endpoints | PASS |
| exclude admin endpoints via profile | PASS |
| search works on filtered command set | PASS |

## Summary

**24 tests | 24 passed | 0 failed | 1.226s**
