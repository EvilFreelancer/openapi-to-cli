## OpenAPI to CLI (ocli)

`openapi-to-cli` (short `ocli`) is a TypeScript CLI that turns any HTTP API described by an OpenAPI/Swagger spec into a set of CLI commands — at runtime, without code generation.

```bash
npm install -g openapi-to-cli

ocli profiles add github \
  --api-base-url https://api.github.com \
  --openapi-spec https://api.github.com/openapi.json \
  --api-bearer-token "$GITHUB_TOKEN"

ocli commands --query "create pull request" --limit 3
ocli repos_owner_repo_pulls_post --owner octocat --repo hello --title "Fix bug" --head feature --base main
```

### Where CLI fits: Tools, MCP, Skills, and CLI

Tools, MCP, skills, and CLI are not competing approaches — they solve different problems at different layers:

| Layer | What | Best for |
|-------|------|----------|
| **Built-in tools** | Standard agent toolset | Critical capabilities that must always be in context (file read/write, shell, browser) |
| **MCP** | Remote tool servers | APIs that need centralized auth, enterprise SSO, shared state, persistent connections, or can't be in standard delivery |
| **Skills** | On-demand instructions | Context isolation, teaching agents _when_ and _how_ to use a tool — loaded only when needed |
| **CLI** | Runtime execution | Long action chains, automation, shell pipelines — agent already knows what to do |

`ocli` lives at the **runtime layer**. When an agent needs to call a REST API — search for the right endpoint, check its parameters, execute the call — CLI does this with minimal context overhead and zero infrastructure.

MCP is the right choice when you need centralized auth, persistent connections, or shared state. CLI is the right choice when you need a lightweight, portable way to call HTTP APIs from any agent with shell access.

### Quick start

```bash
# Install
npm install -g openapi-to-cli

# Add an API profile
ocli profiles add myapi \
  --api-base-url https://api.example.com \
  --openapi-spec https://api.example.com/openapi.json \
  --api-bearer-token "$TOKEN" \
  --include-endpoints "get:/messages,post:/messages" \
  --command-prefix "myapi_" \
  --custom-headers '{"X-Tenant":"acme"}'

# Set as active profile
ocli use myapi

# Discover commands
ocli commands --query "send message" --limit 5

# Check parameters
ocli myapi_messages_post --help

# Execute
ocli myapi_messages_post --text "Hello world"
```

Or use `npx` without global install:

```bash
npx openapi-to-cli onboard \
  --api-base-url https://api.example.com \
  --openapi-spec https://api.example.com/openapi.json
```

### Command search

```bash
# BM25 natural language search
ocli commands --query "upload files" --limit 5

# Regex pattern matching
ocli commands --regex "users.*post" --limit 10

# List all commands
ocli commands
```

The BM25 engine ranks commands by relevance across name, method, path, description, and parameter names. Tested on APIs with 845+ endpoints (GitHub API).

### Using with AI agents

#### OpenClaw skill

Install the [ocli-api](https://clawhub.ai/skills/ocli-api) skill from [ClawHub](https://clawhub.ai):

```bash
clawhub install ocli-api
```

Or manually copy [`skills/ocli-api/SKILL.md`](skills/ocli-api/SKILL.md) to `~/.openclaw/skills/ocli-api/SKILL.md`.

#### Claude Code skill

Copy the example skill to your project:

```bash
cp examples/skill-ocli-api.md .claude/skills/api.md
```

#### Agent workflow

1. `ocli commands --query "upload file"` — discover the right command
2. `ocli files_content_post --help` — check parameters
3. `ocli files_content_post --file ./data.csv` — execute

### Benchmark

Four strategies compared on [Swagger Petstore](https://petstore3.swagger.io/) (19 endpoints), with scaling projections to [GitHub API](https://api.apis.guru/v2/specs/github.com/api.github.com/1.1.4/openapi.json) (845 endpoints). All search strategies use the same BM25 engine.

```
  TOOL DEFINITION OVERHEAD (sent with every API request)

  MCP Naive          █████████████████████████  2,945 tok  (19 tools)
  MCP+Search Full    ███                          355 tok  (2 tools)
  MCP+Search Compact ████                         437 tok  (3 tools)
  CLI (ocli)         █                            158 tok  (1 tool)

  TOTAL TOKENS PER TASK (realistic multi-turn agent flow)

  MCP Naive          █████████████████████████  3,015 tok  (1 turn)
  MCP+Search Full    ██████████████████         2,185 tok  (2 turns)
  MCP+Search Compact █████████████████          2,066 tok  (3 turns)
  CLI (ocli)         ████████                     925 tok  (3 turns)

  SCALING: OVERHEAD PER TURN vs ENDPOINT COUNT

  Endpoints   MCP Naive      MCP+S Compact    CLI (ocli)
  19            2,945 tok         437 tok        158 tok   ← Petstore
  845         130,106 tok         437 tok        158 tok   ← GitHub API
```

Run the benchmark yourself: `npx ts-node benchmarks/benchmark.ts`

Note: MCP+Search Compact (search → get_schema → call) is the fairest comparison to CLI (search → --help → execute) — same number of turns, same BM25 engine. The difference is tool definition overhead (437 vs 158 tok/turn) and schema format (JSON vs text).

### Comparison

| Feature | ocli | [mcp2cli](https://github.com/knowsuchagency/mcp2cli) | [openapi-cli-generator](https://github.com/danielgtaylor/openapi-cli-generator) | [CLI-Anything](https://github.com/HKUDS/CLI-Anything) |
|---------|:----:|:------:|:---------------------:|:-------------:|
| Runtime interpretation (no codegen) | ✅ | ✅ | ❌ | ❌ |
| Works without LLM | ✅ | ✅ | ✅ | ❌ |
| Zero-setup install (`npx`/`uvx`) | ✅ | ✅ | ❌ | ❌ |
| Multiple API profiles | ✅ | ✅ (bake mode) | ❌ | ❌ |
| BM25 command search | ✅ | ❌ (substring only) | ❌ | ❌ |
| Regex command search | ✅ | ❌ | ❌ | ❌ |
| Per-profile endpoint filtering | ✅ | ✅ | ❌ | ❌ |
| OpenAPI/Swagger (JSON + YAML) | ✅ | ✅ | ✅ | ❌ |
| MCP server support | ❌ | ✅ (HTTP/SSE/stdio) | ❌ | ❌ |
| GraphQL support | ❌ | ✅ (introspection) | ❌ | ❌ |
| Spec caching | ✅ | ✅ (1h TTL) | ❌ | ❌ |
| Custom HTTP headers | ✅ | ✅ | ❌ | ❌ |
| Command name prefix | ✅ | ❌ | ❌ | ❌ |
| Basic / Bearer auth | ✅ | ✅ | ✅ | ❌ |
| OAuth2 | ❌ | ✅ (PKCE) | ✅ | ✅ |
| Response filtering (jq/JMESPath) | ❌ | ✅ (jq) | ✅ (JMESPath) | ❌ |
| Token-optimized output (TOON) | ❌ | ✅ | ❌ | ❌ |
| JSON structured output | ❌ | ✅ | ✅ | ✅ |
| Active project | ✅ | ✅ | ❌ (deprecated) | ✅ |

### Similar projects

- [mcp2cli](https://github.com/knowsuchagency/mcp2cli) — Python CLI that converts MCP servers, OpenAPI specs, and GraphQL endpoints into CLI commands at runtime. Supports OAuth, TOON output format, and daemon sessions.
- [openapi-cli-generator](https://github.com/danielgtaylor/openapi-cli-generator) — generates a CLI from an OpenAPI 3 specification using code generation.
- [anything-llm-cli](https://github.com/Mintplex-Labs/anything-llm/tree/master/clients/anything-cli) — CLI for interacting with AnythingLLM, can consume HTTP APIs and tools.
- [openapi-commander](https://github.com/bcoughlan/openapi-commander) — Node.js command-line tool generator based on OpenAPI definitions.
- [OpenAPI Generator](https://openapi-generator.tech/docs/usage) — general-purpose OpenAPI code generator that can also generate CLI clients.
- [openapi2cli](https://pypi.org/project/openapi2cli/) — Python tool that builds CLI interfaces for OpenAPI 3 APIs.

### License

This project is licensed under the MIT License, see the [LICENSE](./LICENSE) file in the repository root for details.
