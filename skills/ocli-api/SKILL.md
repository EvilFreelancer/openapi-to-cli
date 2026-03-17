---
name: ocli-api
description: Turn any OpenAPI/Swagger API into CLI commands and call them. Search endpoints with BM25, check parameters, execute — no MCP server needed.
version: 1.0.0
user-invocable: true
disable-model-invocation: false
metadata: {"openclaw":{"emoji":"🔌","requires":{"bins":["ocli"],"env":[]}}}
homepage: https://github.com/EvilFreelancer/openapi-to-cli
---

# ocli — OpenAPI to CLI

Call any HTTP API described by an OpenAPI/Swagger spec as CLI commands.
No MCP server, no code generation, no JSON schemas in context.

## When to use

- You need to call a REST API (internal, cloud, SaaS)
- You have an OpenAPI or Swagger spec (URL or local file)
- You want minimal token overhead (1 tool, ~158 tokens/turn)

## Setup (one-time)

```bash
npm install -g openapi-to-cli

ocli profiles add <name> \
  --api-base-url <BASE_URL> \
  --openapi-spec <SPEC_URL_OR_PATH> \
  --api-bearer-token "$TOKEN"

ocli use <name>
```

## Workflow

1. **Search** for the right command:
   ```bash
   ocli commands --query "your task description" --limit 5
   ```
2. **Check parameters** of the chosen command:
   ```bash
   ocli <command> --help
   ```
3. **Execute** the command:
   ```bash
   ocli <command> --param1 value1 --param2 value2
   ```
4. **Parse** the JSON response and act on the result.

## Search options

```bash
# BM25 natural language search
ocli commands --query "upload file to storage" --limit 5

# Regex pattern search
ocli commands --regex "users.*post" --limit 10

# List all commands
ocli commands
```

## Multiple APIs

```bash
# Switch active profile
ocli use github

# Or specify per-call
ocli repos_get --profile github --owner octocat --repo Hello-World
```

## Guardrails

- Always search before guessing a command name.
- Always check `--help` before calling a command you haven't used before.
- Never fabricate parameter names — use the ones from `--help` output.
- If a command returns an error, read the response body before retrying.

## Failure handling

- **Command not found**: re-search with different keywords or use `--regex`.
- **Missing required parameter**: run `--help` and add the missing flag.
- **401/403**: check that the profile has a valid token (`ocli profiles show <name>`).
- **Spec not loaded**: run `ocli profiles add` again with `--openapi-spec` to refresh cache.
