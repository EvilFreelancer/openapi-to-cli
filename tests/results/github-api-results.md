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

---

## CLI Output Examples

### `ocli commands | wc -l`

```
847
```

### `ocli search --query "list repositories" --limit 5`

```
Found 5 command(s):

  repositories                                     GET  /repositories  List public repositories
  installation_repositories                        GET  /installation/repositories  List repositories accessible to the app installation
  user_migrations_migration_id_repositories        GET  /user/migrations/{migration_id}/repositories  List repositories for a user migration
  user_installations_installation_id_repositories  GET  /user/installations/{installation_id}/repositories  List repositories accessible to the user access token
  orgs_org_migrations_migration_id_repositories    GET  /orgs/{org}/migrations/{migration_id}/repositories  List repositories in an organization migration
```

### `ocli search --query "pull request reviews" --limit 5`

```
Found 5 command(s):

  repos_owner_repo_pulls_pull_number_reviews_get               GET     /repos/{owner}/{repo}/pulls/{pull_number}/reviews  List reviews for a pull request
  repos_owner_repo_pulls_pull_number_reviews_post              POST    /repos/{owner}/{repo}/pulls/{pull_number}/reviews  Create a review for a pull request
  repos_owner_repo_pulls_pull_number_reviews_review_id_get     GET     /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}  Get a review for a pull request
  repos_owner_repo_pulls_pull_number_reviews_review_id_put     PUT     /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}  Update a review for a pull request
  repos_owner_repo_pulls_pull_number_reviews_review_id_delete  DELETE  /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}  Delete a pending review for a pull request
```

### `ocli search --query "create issue" --limit 5`

```
Found 5 command(s):

  repos_owner_repo_issues_issue_number_comments_post          POST  /repos/{owner}/{repo}/issues/{issue_number}/comments  Create an issue comment
  repos_owner_repo_issues_issue_number_reactions_post         POST  /repos/{owner}/{repo}/issues/{issue_number}/reactions  Create reaction for an issue
  repos_owner_repo_issues_post                                POST  /repos/{owner}/{repo}/issues  Create an issue
  repos_owner_repo_issues_comments_comment_id_reactions_post  POST  /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions  Create reaction for an issue comment
  repos_owner_repo_issues_issue_number_get                    GET   /repos/{owner}/{repo}/issues/{issue_number}  Get an issue
```

### `ocli search --query "actions workflow" --limit 5`

```
Found 5 command(s):

  orgs_org_actions_permissions_workflow_get            GET  /orgs/{org}/actions/permissions/workflow  Get default workflow permissions for an organization
  orgs_org_actions_permissions_workflow_put            PUT  /orgs/{org}/actions/permissions/workflow  Set default workflow permissions for an organization
  repos_owner_repo_actions_permissions_workflow_get    GET  /repos/{owner}/{repo}/actions/permissions/workflow  Get default workflow permissions for a repository
  repos_owner_repo_actions_permissions_workflow_put    PUT  /repos/{owner}/{repo}/actions/permissions/workflow  Set default workflow permissions for a repository
  repos_owner_repo_actions_workflows_workflow_id_runs  GET  /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs  List workflow runs for a workflow
```

### `ocli search --regex "gist" --limit 5`

```
Found 5 command(s):

  gists_get          GET   /gists  List gists for the authenticated user
  gists_post         POST  /gists  Create a gist
  gists_public       GET   /gists/public  List public gists
  gists_starred      GET   /gists/starred  List starred gists
  gists_gist_id_get  GET   /gists/{gist_id}  Get a gist
```

### `ocli search --regex "repos.*pulls" --limit 5`

```
Found 5 command(s):

  repos_owner_repo_commits_commit_sha_pulls       GET   /repos/{owner}/{repo}/commits/{commit_sha}/pulls  List pull requests associated with a commit
  repos_owner_repo_pulls_get                      GET   /repos/{owner}/{repo}/pulls  List pull requests
  repos_owner_repo_pulls_post                     POST  /repos/{owner}/{repo}/pulls  Create a pull request
  repos_owner_repo_pulls_comments                 GET   /repos/{owner}/{repo}/pulls/comments  List review comments in a repository
  repos_owner_repo_pulls_comments_comment_id_get  GET   /repos/{owner}/{repo}/pulls/comments/{comment_id}  Get a review comment for a pull request
```

### `ocli repos_owner_repo_get -h`

```
ocli repos_owner_repo_get

Get a repository

Опции:

  -h, --help  Показать помощь  [булевый тип]
```
