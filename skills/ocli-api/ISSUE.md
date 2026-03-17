# Issue draft for openclaw/openclaw

**Title:** Skill: ocli-api — call any REST API via CLI, no MCP server needed

**Body:**

## Problem

Connecting AI agents to REST APIs today means either:

1. **MCP Naive** — register every endpoint as a tool. At 100+ endpoints, that's 15K+ tokens of JSON schemas injected every turn. At GitHub API scale (845 endpoints) it's 130K tokens/turn.
2. **MCP+Search** — better, but still requires a running MCP server, transport layer, and search results carry full JSON schemas back to context.

Both approaches require a persistent server process and MCP-aware client. This is the "MCP madness" — every new API means another server to run, another transport to manage, another set of tool schemas eating your context window.

## Solution

[openapi-to-cli](https://github.com/EvilFreelancer/openapi-to-cli) (`ocli`) turns any OpenAPI/Swagger spec into CLI commands at runtime. The agent needs only 1 tool (`execute_command`) and discovers endpoints via BM25 search:

```
Agent: ocli commands --query "create pull request" --limit 3
→  repos_owner_repo_pulls_post   post    /repos/{owner}/{repo}/pulls  Create a pull request

Agent: ocli repos_owner_repo_pulls_post --help
→  Options: --owner (required) --repo (required) --title --head --base --body

Agent: ocli repos_owner_repo_pulls_post --owner octocat --repo hello --title "Fix bug" --head feature --base main
→  { "number": 42, "html_url": "..." }
```

**Benchmark results (honest, all strategies use same BM25 engine):**

| Strategy | Overhead/turn | Turns | Search result | Server? |
|----------|--------------|-------|---------------|---------|
| MCP Naive (19 ep) | 2,945 tok | 1 | N/A | Yes |
| MCP+Search Full | 355 tok | 2 | 1,305 tok/query | Yes |
| MCP+Search Compact | 437 tok | 3 | 61 tok/query | Yes |
| **CLI (ocli)** | **158 tok** | **3** | **67 tok/query** | **No** |

At 845 endpoints, MCP Naive costs $1,172/month vs CLI at $11/month (100 tasks/day, Sonnet $3/M).

## Proposed skill

```yaml
---
name: ocli-api
description: Turn any OpenAPI/Swagger API into CLI commands and call them. Search endpoints with BM25, check parameters, execute — no MCP server needed.
version: 1.0.0
user-invocable: true
metadata: {"openclaw":{"emoji":"🔌","requires":{"bins":["ocli"]}}}
homepage: https://github.com/EvilFreelancer/openapi-to-cli
---
```

The full `SKILL.md` is available at: https://github.com/EvilFreelancer/openapi-to-cli/tree/main/skills/ocli-api

### What the skill teaches the agent

1. **Search** — `ocli commands --query "..." --limit 5` (BM25 ranked)
2. **Inspect** — `ocli <command> --help` (text parameters, not JSON schemas)
3. **Execute** — `ocli <command> --flag value` (plain HTTP, JSON response)

### Installation

Once the skill is published to ClawHub:

```bash
# Install the skill
clawhub install ocli-api

# Prerequisite: install ocli itself
npm install -g openapi-to-cli

# Onboard your first API
ocli profiles add myapi \
  --api-base-url https://api.example.com \
  --openapi-spec https://api.example.com/openapi.json \
  --api-bearer-token "$TOKEN"
```

Or manually — copy `skills/ocli-api/SKILL.md` to `~/.openclaw/skills/ocli-api/SKILL.md`.

### Why this belongs in openclaw skills

- **Zero infrastructure** — `npm install -g openapi-to-cli`, no server process
- **Universal** — works with any OpenAPI/Swagger spec (Bitrix24, GitHub, Box, Petstore, internal APIs)
- **Token-efficient** — 158 tok overhead vs 2,945+ for MCP approaches
- **Composable** — pipes, chains, shell scripts natively
- **Multiple APIs** — profiles with per-API auth, endpoint filtering, command prefixes
- **Replaces MCP for REST APIs** — agent doesn't need MCP-aware client, just shell access
