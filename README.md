## OpenAPI to CLI (ocli)

`openapi-to-cli` (short `ocli`) is a TypeScript CLI that turns any HTTP API described by an OpenAPI, Swagger, or OpenRPC spec into a set of CLI commands — at runtime, without code generation.

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

# Or target a different profile for a single call (no 'use' required)
ocli myapi_messages_post --profile other --text "Hello world"
ocli commands -p other --query "send message"
```

`--profile` (short `-p`) overrides the profile selected by `ocli use` for this invocation only. It works for both dynamic API commands and `ocli commands`. Place it anywhere after the command name. When omitted, the profile set via `ocli use` is used (falling back to `default`).

### OpenRPC and JSON-RPC APIs

`ocli` also accepts OpenRPC JSON or YAML documents through the existing `--openapi-spec` option. It creates one command for each documented RPC method and exposes documented RPC parameters as command flags.

```bash
ocli profiles add widgets \
  --api-base-url https://api.example.com/rpc \
  --openapi-spec ./openrpc.json \
  --api-bearer-token "$TOKEN"

ocli use widgets
ocli getWidget --widgetId widget-7
```

OpenRPC commands always send an HTTP `POST` request with `Content-Type: application/json`. `ocli` builds the JSON-RPC 2.0 envelope automatically:

```json
{
  "jsonrpc": "2.0",
  "method": "getWidget",
  "params": {
    "widgetId": "widget-7"
  },
  "id": 1
}
```

The profile's `--api-base-url` remains the request target. If it is empty, `ocli` falls back to the first server URL in the OpenRPC document.

`ocli` serializes parameters from their documented schemas. Integers, numbers, and booleans are sent as JSON scalars. Arrays and objects must be supplied as JSON values. For methods with `paramStructure: "by-position"`, the same flags are emitted as a JSON array in the documented parameter order. Named and `either` methods use a JSON object.

OpenRPC method names must be unique. `ocli` rejects an OpenRPC document that declares the same method name more than once instead of creating ambiguous CLI commands.

For an OpenRPC profile, endpoint filters select RPC method names with the `rpc:` prefix:

```bash
ocli profiles add widgets \
  --api-base-url https://api.example.com/rpc \
  --openapi-spec ./openrpc.json \
  --include-endpoints "rpc:getWidget,rpc:listWidgets" \
  --exclude-endpoints "rpc:deleteWidget"
```

REST filter keys such as `get:/widgets` apply only to OpenAPI and Swagger operations.

### Authentication and custom headers

A profile stores up to three credentials, set with `ocli profiles add` (or `ocli onboard`):

- `--api-bearer-token <token>` sends `Authorization: Bearer <token>`
- `--api-basic-auth <user:password>` sends `Authorization: Basic <base64>`; when both are set, Basic wins
- `--custom-headers '{"X-Tenant":"acme"}'` adds any extra headers

`ocli` attaches these headers to every API request and to the download of the OpenAPI spec itself, so a spec served behind the same auth as the API (for example `/openapi.json` answering 401 to anonymous requests) loads with `ocli profiles add`. The headers are sent only to the two origins named in the profile, the `--openapi-spec` URL and the `--api-base-url`. External `$ref` documents on those origins receive them too, at any nesting depth; `$ref` documents on any other host are fetched anonymously, so a spec cannot forward your credentials to a third-party host. Specs loaded from a local file path involve no request.

When the spec download is rejected with 401 or 403, `ocli` reports the failing URL and the status and points at the three flags above:

```bash
$ ocli profiles add myapi --api-base-url https://api.example.com --openapi-spec https://api.example.com/openapi.json
Failed to fetch OpenAPI document https://api.example.com/openapi.json: HTTP 401. Check --api-basic-auth, --api-bearer-token, or --custom-headers of profile myapi.
```

The spec is downloaded once and cached under `.ocli/specs/<profile>.json`. Later invocations read the cache and do not contact the spec URL. Re-run `ocli profiles add` with the same profile name to refresh it.

### Strict flag validation

`ocli` refuses to run a command with a flag the spec does not define, instead of dropping it from the request:

```bash
$ ocli people_vanId_get --vanId 12345678 --expand addresses
Unknown option: --expand (did you mean --$expand?). Run 'ocli people_vanId_get --help' to see available options.
$ echo $?
1
```

The same applies to built-in commands: `ocli commands --qeury pull` exits with `Unknown argument: qeury`.

One exception is kept on purpose. When an operation accepts a body (`POST`, `PUT`, `PATCH`, `DELETE`) and the spec describes no request body, undeclared flags are still forwarded as JSON body fields — that is the only way to call endpoints whose payload is not documented. As soon as the spec declares body properties or `formData` parameters, those names become the full list of accepted flags.

Or use `npx` without global install:

```bash
npx openapi-to-cli onboard \
  --api-base-url https://api.example.com \
  --openapi-spec https://api.example.com/openapi.json
```

### Broader spec support

`ocli` now handles a wider range of real-world API descriptions:

- OAS 3 `requestBody` for JSON payloads
- Swagger 2 `body` and `formData` parameters
- path-level parameters inherited by operations
- local `$ref` references for parameters and request bodies
- header and cookie parameters in generated commands
- OpenRPC methods with named or positional parameters, schema-typed values, local schema references, and method filters

In practice this improves compatibility with APIs that define inputs outside simple path/query parameters, especially for `POST`, `PUT`, and `PATCH` operations.

### Better request generation

`ocli` now uses more request metadata from the specification when building real HTTP calls:

- query and path parameter serialization from OpenAPI / Swagger metadata
- support for array and object-style query parameters such as `deepObject`, `pipeDelimited`, and Swagger 2 collection formats
- operation-level and path-level server overrides when the spec defines different targets for different endpoints

In practice this improves compatibility with APIs that rely on non-trivial parameter encoding or per-operation server definitions.


### Multi-file specs and richer help

`ocli` now works better with larger, more structured API descriptions:

- external `$ref` resolution across multiple local or remote OpenAPI / Swagger documents
- support for multi-document specs that split paths, parameters, and request bodies into separate files
- richer `--help` output with schema hints such as `enum`, `default`, `nullable`, and `oneOf`
- better handling of composed schemas that use `allOf` for shared request object structure

In practice this improves compatibility with modular specs and makes generated commands easier to use without opening the original OpenAPI document.

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
| OpenRPC (JSON + YAML) | ✅ | ? | ? | ? |
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
