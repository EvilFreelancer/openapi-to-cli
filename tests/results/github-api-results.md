# GitHub API Test Results

- **Spec**: https://api.apis.guru/v2/specs/github.com/api.github.com/1.1.4/openapi.json
- **Endpoints**: 845
- **Format**: JSON
- **Date**: 2026-03-13

## Spec Parsing (2/2)

| Test | Status |
|------|--------|
| parses 800+ endpoints | PASS |
| generates unique command names | PASS |

## BM25 Search at Scale (9/9)

| Test | Status | Time |
|------|--------|------|
| finds repository endpoints | PASS | 16ms |
| finds pull request endpoints | PASS | 7ms |
| finds issues endpoints | PASS | 11ms |
| finds git operations | PASS | 7ms |
| finds actions/workflow endpoints | PASS | 14ms |
| finds user/org endpoints | PASS | 7ms |
| finds gist endpoints | PASS | 8ms |
| returns results fast on 845 endpoints (10 searches) | PASS | 75ms |
| limits results correctly | PASS | 7ms |

## Regex Search (2/2)

| Test | Status |
|------|--------|
| finds all repos endpoints by path (100+) | PASS |
| finds webhook endpoints | PASS |

## Summary

**13 tests | 13 passed | 0 failed | ~1s**
