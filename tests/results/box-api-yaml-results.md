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

---

## CLI Output Examples (Box API, loaded from YAML)

### `ocli search --query "upload file" --limit 5`

```
Found 5 command(s):

  files_upload_sessions_post                POST  /files/upload_sessions  Create upload session
  files_upload_sessions_id_put              PUT   /files/upload_sessions/{upload_session_id}  Upload part of file
  files_upload_sessions_id_commit_post      POST  /files/upload_sessions/{upload_session_id}/commit  Commit upload session
  files_content_post                        POST  /files/content  Upload a file
  files_id_content_post                     POST  /files/{file_id}/content  Upload a file version
```

### `ocli search --query "create folder" --limit 5`

```
Found 5 command(s):

  folders_post                POST  /folders  Create folder
  folders_id_get              GET   /folders/{folder_id}  Get folder info
  folders_id_items            GET   /folders/{folder_id}/items  List items in folder
  folders_id_copy_post        POST  /folders/{folder_id}/copy  Copy folder
  folders_id_put              PUT   /folders/{folder_id}  Update folder
```

### `ocli search --regex "metadata" --limit 5`

```
Found 5 command(s):

  files_id_metadata                            GET     /files/{file_id}/metadata  List metadata on file
  files_id_metadata_scope_template_get         GET     /files/{file_id}/metadata/{scope}/{template_key}  Get metadata instance on file
  files_id_metadata_scope_template_post        POST    /files/{file_id}/metadata/{scope}/{template_key}  Create metadata instance on file
  files_id_metadata_scope_template_put         PUT     /files/{file_id}/metadata/{scope}/{template_key}  Update metadata instance on file
  files_id_metadata_scope_template_delete      DELETE  /files/{file_id}/metadata/{scope}/{template_key}  Remove metadata instance from file
```
