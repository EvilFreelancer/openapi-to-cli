# Codex bridge for Cursor rules

This repository keeps detailed project rules in `.cursor/rules/*.mdc`, and that directory
is their single source of truth (mirrored by hand into `.claude/rules/*.md` for Claude Code).
Codex does not read `.mdc` files on its own, so `.codex/hooks/attach_rules.py` delivers them.

## How delivery works

| Trigger | What is attached |
|---------|------------------|
| `SessionStart` | every rule with `alwaysApply: true` |
| `PreToolUse` on `apply_patch` / `Edit` / `Write` | rules whose `globs` cover the files in the patch, once per rule per session |

The hook parses `.mdc` frontmatter (`description`, `globs`, `alwaysApply`) directly, so a
new rule file is picked up with no wiring. It fails open: a malformed rule exits quietly
instead of blocking an edit. Configuration lives in `.codex/hooks.json`.

Codex tracks hooks by content hash and skips untrusted ones without a hard error. Run
`/hooks` once per clone, and again after any edit to `attach_rules.py` or `hooks.json`.
Project-local hooks load only when the `.codex/` layer is trusted.

To see what a given patch would pull in, no Codex session needed:

```bash
echo '{"hook_event_name":"PreToolUse","session_id":"probe","tool_input":{"command":"*** Begin Patch\n*** Update File: src/openapi-loader.ts\n*** End Patch"}}' | python3 .codex/hooks/attach_rules.py
```

## Rule index

| Cursor rule | Applies to | Attachment |
|-------------|------------|------------|
| [workflow.mdc](../.cursor/rules/workflow.mdc) | TDD flow for features and bugs, README update triggers, Rules Sync | always |
| [code-style.mdc](../.cursor/rules/code-style.mdc) | TypeScript style, naming, error handling, constructor-injected I/O | always, `**/*.ts` |
| [architecture.mdc](../.cursor/rules/architecture.mdc) | Layers, modules, allowed dependencies, spec parser guidance | always, `src/**/*.ts` |
| [testing.mdc](../.cursor/rules/testing.mdc) | Jest layout, isolation (no module mocks), fixtures | always, `tests/**/*.ts` |
| [implementation-order.mdc](../.cursor/rules/implementation-order.mdc) | Layer-by-layer order for new modules | `src/**/*.ts` |

Keep the always-on set small and let the rest attach by glob. Codex caps model-visible hook
output (roughly 2500 tokens by default; `additionalContextLimit` in `hooks.json` raises it),
and oversized always-on context degrades the model instead of helping it.

## Operating rule

Keep `.cursor/rules/` and `.claude/rules/` in lockstep (see the Rules sync section of
`workflow.mdc`). The hook needs no update when rules change, but this index and the rule
list in `AGENTS.md` do: refresh both in the same change that adds, renames, or removes a
rule file. A rule is only reachable from Codex if its frontmatter carries `globs` or
`alwaysApply: true`, and `globs` must stay unquoted (`globs: src/**/*.ts`): the parser reads
the value literally, so a quoted glob never matches.
