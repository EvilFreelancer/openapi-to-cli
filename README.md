## OpenAPI to CLI (ocli)

`openapi-to-cli` (short `ocli`) is a TypeScript CLI concept that turns any HTTP API described by an OpenAPI/Swagger spec into a set of CLI commands.

- **Input**: OpenAPI/Swagger spec (URL or file) plus API connection settings.
- **Output**: an executable `ocli` binary where each API operation is exposed as a dedicated subcommand.

Unlike [openapi-to-mcp](https://github.com/EvilFreelancer/openapi-to-mcp), which starts an MCP server with tools, `ocli` provides a direct command line interface.

### High level idea

- The user installs the package (via `npx` or as an npm dependency) and gets the `ocli` binary in `$PATH`.
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
ocli messages --profile myapi --limit 10
ocli channels_username_get --profile myapi --username alice
```

or using the default profile:

```bash
ocli use myapi
ocli messages --limit 10
```

### Profiles and configuration files

- A profile describes a single API connection.
- Profiles are stored in an INI file (one section per profile, no special "current" key in the INI):
  - global: `~/.oclirc/profiles.ini`
  - project-local: `./.oclirc/profiles.ini` (has higher priority than global)
- The profile to use when the user does not pass `--profile` is stored in `.oclirc/current` (one line: profile name). If the file is missing or empty, the profile named `default` is used. The profile named `default` is a normal profile like any other; it is just used when no profile is specified.

Example `profiles.ini` structure:

```ini
[default]
api_base_url = http://127.0.0.1:1111
api_basic_auth =
api_bearer_token = MY_TOKEN
openapi_spec_source = http://127.0.0.1:1111/openapi.json
openapi_spec_cache = /home/user/.oclirc/specs/default.json
include_endpoints = get:/messages,get:/channels
exclude_endpoints = 

[myapi]
api_base_url = http://127.0.0.1:2222
api_basic_auth =
api_bearer_token = MY_TOKEN
openapi_spec_source = http://127.0.0.1:2222/openapi.json
openapi_spec_cache = /home/user/.oclirc/specs/myapi.json
include_endpoints = get:/messages,get:/channels
exclude_endpoints = 
```

The local file `./.oclirc/profiles.ini`, if present, fully overrides the global one when resolving profiles.

### OpenAPI/Swagger caching

- Config and cache directory:
  - globally: `~/.oclirc/`
  - locally: `./.oclirc/` relative to the directory where `ocli` is executed.

- Inside `.oclirc` the CLI creates:
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
- `ocli use <profile>` - set the profile to use when `--profile` is not passed (writes profile name to `.oclirc/current`).

Help:

- `ocli -h|--help` - global help and command overview;
- `ocli onboard -h|--help` - onboarding help;
- `ocli profiles -h|--help` - profile management help;
- `ocli <tool-name> -h|--help` - description of a particular operation, list of options and their types (generated from OpenAPI).

### Architecture (concept)

The `openapi-to-cli` project mirrors parts of the `openapi-to-mcp` architecture but implements a CLI instead of an MCP server:

- `config` - reads profile configuration and cache paths (INI files, global and local `.oclirc` lookup).
- `profile-store` - works with `profiles.ini` (read, write, select profile, current profile).
- `openapi-loader` - loads and caches the OpenAPI spec (URL or file) into `.oclirc/specs/`.
- `openapi-to-commands` - parses OpenAPI, applies include/exclude filters, generates command names and option schemas (based on `openapi-to-mcp/openapi-to-tools.ts` ideas).
- `cli` - entry point, argument parser, command registration, help output.

### Next implementation steps

This `openapi-to-cli` directory currently documents the concept and architecture of the future CLI project.

When moving to implementation, we will:

- add full CLI logic in `src/` (argument parsing, commands, profile handling, spec loading);
- add tests for:
  - parsing and persisting `profiles.ini`;
  - caching and loading OpenAPI specs;
  - mapping OpenAPI operations to commands and options.

The project is intended to be published as an npm package so it can be invoked as:

```bash
npx openapi-to-cli onboard ...
ocli messages --profile myapi ...
```
