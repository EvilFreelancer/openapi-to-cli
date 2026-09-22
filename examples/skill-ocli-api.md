# ocli API skill

Example Claude Code skill that uses `ocli` to interact with an API.

## Setup

```bash
# Install ocli globally
npm install -g openapi-to-cli

# Add your API profile
ocli profiles add myapi \
  --api-base-url https://api.example.com \
  --openapi-spec https://api.example.com/openapi.json \
  --api-bearer-token "$API_TOKEN"
```

## Skill file

Save as `.claude/skills/api.md` in your project:

````markdown
---
name: api
description: Interact with the API using ocli
---

You have access to the `ocli` CLI tool for making API calls.

## Discovering commands

To find relevant API endpoints, use search:

```bash
# Natural language search
ocli commands --query "your search terms" --limit 10

# Regex search by path or name
ocli commands --regex "users.*get" --limit 10
```

## Making API calls

Once you find the right command, execute it directly:

```bash
# Example: list resources
ocli resources_get --limit 10

# Example: get a specific resource
ocli resources_id_get --id 123

# Example: create a resource
ocli resources_post --name "New Resource" --description "Details"
```

## Workflow

1. First search for the relevant command using `ocli commands --query`
2. Check command help with `ocli <command> --help`
3. Execute the command with required parameters
4. Parse the JSON response for the information needed

## Multiple APIs

```bash
# Switch the default profile permanently
ocli use github

# Or override the profile for a single call (short alias: -p)
ocli repos_get --profile github --owner octocat --repo Hello-World
ocli commands -p github --query "list pull requests"
```

## OpenRPC APIs

`ocli` accepts OpenRPC JSON or YAML documents through `--openapi-spec` too. It creates one command per RPC method and automatically sends a JSON-RPC 2.0 envelope. Pass documented named RPC parameters as regular flags:

```bash
ocli profiles add widgets \
  --api-base-url https://api.example.com/rpc \
  --openapi-spec ./openrpc.json

ocli getWidget --widgetId widget-7
```

## Tips

- All responses are JSON — pipe through `jq` for filtering
- Path parameters (like `{id}`) are passed as `--id <value>`
- Required parameters will error if missing
- Undeclared flags are rejected with `Unknown option: --x`, so copy names exactly from `--help` (including a leading `$`)
- Use `ocli commands` to list all available commands
- Use `--profile <name>` (or `-p <name>`) to switch profile for a single call without running `ocli use`
- For OpenRPC, pass documented RPC parameters as flags. `ocli` adds `jsonrpc`, `method`, and `id` to the request body.
````
