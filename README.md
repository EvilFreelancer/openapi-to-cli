## OpenAPI to CLI (ocli)

`openapi-to-cli` (short `ocli`) is a TypeScript CLI that turns any HTTP API described by an OpenAPI/Swagger spec into a set of CLI commands — at runtime, without code generation.

- **Input**: OpenAPI/Swagger spec (URL or file) plus API connection settings.
- **Output**: an executable `ocli` binary where each API operation is exposed as a dedicated subcommand.

Unlike [openapi-to-mcp](https://github.com/EvilFreelancer/openapi-to-mcp), which starts an MCP server with tools, `ocli` provides a direct command-line interface.

### Why convert OpenAPI spec to CLI?

The trend is clear: **CLI commands are cheaper and more native than MCP tools** for AI agents.

| Factor | MCP Tools | CLI Commands |
|--------|-----------|--------------|
| **Token cost** | Each tool call requires full JSON schema in context on every request | CLI commands are invoked by name with flags — minimal token overhead |
| **Startup overhead** | MCP server must be running, connected via transport layer | Single process, instant execution, zero transport cost |
| **Composability** | Tools are isolated in MCP server scope | CLI commands pipe, chain, and integrate with shell scripts natively |
| **Agent compatibility** | Requires MCP-aware client (Claude, Cursor, etc.) | Any agent that can run shell commands — universal |
| **Discoverability** | Agent must hold all tool schemas in context window | `--help` for quick lookup, `search --query` for BM25-ranked discovery |
| **Multi-API** | One MCP server per API, each consuming context | Multiple profiles in one binary, switch with `ocli use <profile>` |
| **Endpoint scoping** | All tools exposed at once, no per-session filtering | Per-profile `--include/--exclude-endpoints` — same API, different command sets for different roles |
| **Debugging** | Opaque transport, hard to inspect | Plain HTTP requests, visible in terminal |

When an agent has access to 200+ API endpoints, loading all of them as MCP tools burns thousands of tokens per turn. With `ocli`, the agent calls `ocli search --query "upload files"` to discover relevant commands, then executes them directly. The context window stays clean.

**Bottom line**: if your agent talks to HTTP APIs, CLI is the most token-efficient and portable interface available today.

### Comparison with [openapi-cli-generator](https://github.com/danielgtaylor/openapi-cli-generator)

| Feature | ocli | openapi-cli-generator |
|---------|:----:|:---------------------:|
| Runtime interpretation (no codegen) | ✅ | ❌ |
| Zero-setup install (`npx`) | ✅ | ❌ |
| Multiple API profiles in one binary | ✅ | ❌ |
| Multiple endpoint sets per API | ✅ | ❌ |
| BM25 command search | ✅ | ❌ |
| Regex command search | ✅ | ❌ |
| Per-profile endpoint filtering | ✅ | ❌ |
| Spec caching with refresh | ✅ | ❌ |
| Add new API without recompile | ✅ | ❌ |
| Basic / Bearer auth | ✅ | ✅ |
| OAuth2 / Auth0 | ❌ | ✅ |
| Response JMESPath filtering | ❌ | ✅ |
| Syntax-highlighted output | ❌ | ✅ |
| Middleware / waiters | ❌ | ✅ |
| Active project | ✅ | ❌ (deprecated) |

### High level idea

- The user installs the package (for example via `npx` or globally) and gets the `ocli` binary in `$PATH`.
- On first use the user onboards an API with a command like:

```bash
ocli profiles add myapi \
  --api-base-url http://127.0.0.1:2222 \
  --openapi-spec http://127.0.0.1:2222/openapi.json \
  --api-bearer-token "..." \
  --include-endpoints get:/messages,get:/channels \
  --exclude-endpoints post:/admin/secret
```

Alternatively, `ocli onboard` (with the same options, no profile name) creates a profile named `default`.

- The CLI:
  - downloads and validates the OpenAPI spec;
  - stores profile configuration;
  - caches the spec in the filesystem;
  - builds a set of commands based on paths and methods.

After onboarding, commands can be used like:

```bash
ocli messages_get --profile myapi --limit 10
ocli channels_username_get --profile myapi --username alice
```

or using the default profile:

```bash
ocli use myapi
ocli messages --limit 10
```

### Command search

When the API surface is too large for `--help`, use command filtering with `commands`:

```bash
# BM25 natural language search
ocli commands --query "upload files"
ocli commands -q "list messages" --limit 5

# Regex pattern matching
ocli commands --regex "admin.*get"
ocli commands -r "messages" -n 3
```

The BM25 engine (ported from [picoclaw](https://github.com/sipeed/picoclaw)) ranks commands by relevance across name, method, path, description, and parameter names. This enables agents to discover the right endpoint without loading all command schemas into context. The legacy `ocli search` command is kept as a deprecated alias and internally forwards to `ocli commands` with the same flags.

### Installation and usage via npm and npx

To use `ocli` locally without installing it globally you can rely on `npx`:

```bash
npx openapi-to-cli onboard \
  --api-base-url http://127.0.0.1:2222 \
  --openapi-spec http://127.0.0.1:2222/openapi.json
```

The command above will

- download the `openapi-to-cli` package from npm if it is not cached yet
- run the `ocli` binary from the package
- create the `default` profile and cache the OpenAPI spec under `.ocli/specs/default.json`

After onboarding you can continue to use the generated commands with the `ocli` binary that `npx` runs for you:

```bash
npx openapi-to-cli use myapi
npx openapi-to-cli messages_get --limit 10
```

If you prefer a global installation you can also install the package once

```bash
npm install -g openapi-to-cli
```

and then call the binary directly

```bash
ocli onboard --api-base-url http://127.0.0.1:2222 --openapi-spec http://127.0.0.1:2222/openapi.json
ocli messages_get --limit 10
```

### Profiles and configuration files

- A profile describes a single API connection.
- Profiles are stored in an INI file (one section per profile, no special "current" key in the INI):
  - global: `~/.ocli/profiles.ini`
  - project-local: `./.ocli/profiles.ini` (has higher priority than global)
- The profile to use when the user does not pass `--profile` is stored in `.ocli/current` (one line: profile name). If the file is missing or empty, the profile named `default` is used. The profile named `default` is a normal profile like any other; it is just used when no profile is specified.

Example `profiles.ini` structure:

```ini
[default]
api_base_url = http://127.0.0.1:1111
api_basic_auth =
api_bearer_token = MY_TOKEN
openapi_spec_source = http://127.0.0.1:1111/openapi.json
openapi_spec_cache = /home/user/.ocli/specs/default.json
include_endpoints = get:/messages,get:/channels
exclude_endpoints =

[myapi]
api_base_url = http://127.0.0.1:2222
api_basic_auth =
api_bearer_token = MY_TOKEN
openapi_spec_source = http://127.0.0.1:2222/openapi.json
openapi_spec_cache = /home/user/.ocli/specs/myapi.json
include_endpoints = get:/messages,get:/channels
exclude_endpoints =
```

The local file `./.ocli/profiles.ini`, if present, fully overrides the global one when resolving profiles.

### OpenAPI/Swagger caching

- Config and cache directory:
  - globally: `~/.ocli/`
  - locally: `./.ocli/` relative to the directory where `ocli` is executed.

- Inside `.ocli` the CLI creates:
  - `profiles.ini` - profile configuration (one section per profile);
  - `current` - one line with the profile name to use when `--profile` is not passed (optional; if missing, profile `default` is used);
  - `specs/` - directory with cached specs:
    - `specs/<profile-name>.json` - OpenAPI spec content for the profile.

- During onboarding:
  - the CLI loads the spec from `--openapi-spec`;
  - writes it to `specs/<profile-name>.json`;
  - stores the cache path in `openapi_spec_cache` in the corresponding profile section.

- When running commands:
  - by default the spec is read from `openapi_spec_cache`;
  - later we can add a flag to force spec refresh (for example `--refresh-spec`) that will overwrite the cache.

### Mapping OpenAPI operations to CLI commands

- For each OpenAPI operation (method + path) the CLI exposes one subcommand.
- Command name is derived from the path:
  - `/messages` → `messages`
  - `/channels/{username}` → `channels_username`
- If the same path segment is used by multiple methods (GET, POST, etc.), a method suffix is added:
  - `/messages` GET → `messages_get`
  - `/messages` POST → `messages_post`

Invocation format:

```bash
ocli [--profile <profile>] <tool-name> [options...]
```

where:

- `tool-name` is the name derived from the path (with method suffix when needed);
- `options` is the set of flags representing operation parameters:
  - query and path parameters → `--param-name`;
  - JSON body fields → also `--field-name`.

Option types and required flags are determined from the OpenAPI schema.

### CLI commands and help

The `ocli` binary provides the following core commands:

- `ocli onboard` - add a new profile named `default` (alias for `ocli profiles add default`). Options:
  - `--api-base-url <url>` - API base URL;
  - `--openapi-spec <url-or-path>` - OpenAPI source (URL or file path);
  - `--api-basic-auth <user:pass>` - optional;
  - `--api-bearer-token <token>` - optional;
  - `--include-endpoints <list>` - comma-separated `method:path`;
  - `--exclude-endpoints <list>` - comma-separated `method:path`.

- `ocli profiles add <name>` - add a new profile with the given name and cache the OpenAPI spec. Same options as `onboard` (profile name is the positional argument).

- `ocli profiles list` - list all profiles;
- `ocli profiles show <profile>` - show profile details;
- `ocli profiles remove <profile>` - remove a profile;
- `ocli use <profile>` - set the profile to use when `--profile` is not passed (writes profile name to `.ocli/current`).
- `ocli commands` - list available commands generated from the current profile and its OpenAPI spec, optionally filter them with `--query` (BM25) or `--regex`.
- `ocli search` - deprecated alias for `ocli commands` with `--query/--regex`, kept for backward compatibility.
- `ocli --version` - print the CLI version baked at build time (derived from the latest git tag when available).

Help:

- `ocli -h|--help` - global help and command overview;
- `ocli onboard -h|--help` - onboarding help;
- `ocli profiles -h|--help` - profile management help;
- `ocli <tool-name> -h|--help` - description of a particular operation, list of options and their types (generated from OpenAPI).

### Architecture

```
src/
├── cli.ts                  # Entry point, command routing, HTTP requests
├── config.ts               # .ocli directory resolution (local > global)
├── openapi-loader.ts       # OpenAPI spec download and caching
├── openapi-to-commands.ts  # OpenAPI → CLI command generation
├── command-search.ts       # BM25 + regex search over commands
├── bm25.ts                 # BM25 ranking engine (ported from picoclaw)
├── profile-store.ts        # Profile persistence in INI format
└── version.ts              # Version constant (generated at build)
```

The project mirrors parts of the `openapi-to-mcp` architecture but implements a CLI instead of an MCP server:

- `config` - reads profile configuration and cache paths (INI files, global and local `.ocli` lookup).
- `profile-store` - works with `profiles.ini` (read, write, select profile, current profile).
- `openapi-loader` - loads and caches the OpenAPI spec (URL or file) into `.ocli/specs/`.
- `openapi-to-commands` - parses OpenAPI, applies include/exclude filters, generates command names and option schemas.
- `command-search` - BM25 and regex search over generated commands for discovery on large API surfaces.
- `bm25` - generic BM25 ranking engine with Robertson IDF smoothing and min-heap top-K extraction.
- `cli` - entry point, argument parser, command registration, help output.

### Similar projects

- [openapi-cli-generator](https://github.com/danielgtaylor/openapi-cli-generator) - generates a CLI from an OpenAPI 3 specification using code generation.
- [openapi-commander](https://github.com/bcoughlan/openapi-commander) - Node.js command-line tool generator based on OpenAPI definitions.
- [OpenAPI Generator](https://openapi-generator.tech/docs/usage) - general-purpose OpenAPI code generator that can also generate CLI clients.
- [openapi2cli](https://pypi.org/project/openapi2cli/) - Python tool that builds CLI interfaces for OpenAPI 3 APIs.

### License

This project is licensed under the MIT License, see the [LICENSE](./LICENSE) file in the repository root for details.
