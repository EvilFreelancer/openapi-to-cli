# openapi-to-cli (ocli) - agent brief

`ocli` is a TypeScript CLI that turns OpenAPI/Swagger specs into runtime commands. No code generation: every invocation loads a cached spec and builds the command tree on the fly. Profiles live in `.ocli/profiles.ini`, cached specs under `.ocli/specs/`. Tests are the specification of behavior; `README.md` is the public contract.

This file is the canonical top-level brief for every coding agent (Codex, Claude Code, Cursor, others). `CLAUDE.md` is a symlink to it. Detailed rules live in `.cursor/rules/*.mdc` and their mirrors in `.claude/rules/*.md`; Codex receives the Cursor side through the hook bridge in `.codex/` (see the last section).

## Commands

```bash
npm ci                                   # install
npm test                                 # full Jest suite
npx jest tests/<module>.test.ts -t "<title>"   # one test
npm run build                            # tsc, must be clean
bash tests/fixtures/download.sh          # large real-spec fixtures (GitHub, Box); their suites skip when absent
```

## Workflow that must not be skipped

1. **Failing test first.** A bug gets a reproduction test, a feature gets a behavior test, in `tests/<module>.test.ts`. Run it alone and confirm it fails for the right reason before touching `src/`.
2. **Minimal change at the lowest layer.** Pure (`bm25.ts`, `command-args.ts`) -> I/O wrappers (`config.ts`, `profile-store.ts`, `openapi-loader.ts`) -> transform (`openapi-to-commands.ts`, `command-search.ts`) -> entry (`cli.ts`, the only module that talks to yargs, axios, process). Lower layers never import upper ones.
3. **Green everywhere.** `npm test` passes in full and `npm run build` is clean before the work is called done.
4. **README for anything a user can observe.** Flags, command names, profile fields, `.ocli/` layout, search behavior, supported spec features, authentication and header handling (which requests carry credentials, and to which hosts), spec loading and caching, `--help` text, error messages, exit codes. A change counts even when it adds no flag. `examples/skill-ocli-api.md` and `skills/ocli-api/SKILL.md` stay aligned with the documented agent workflow.
5. **Rules Sync.** Any change to a rule file is mirrored between `.claude/rules/` and `.cursor/rules/` in the same commit, and the index in `.codex/rules.md` plus the rule list below are refreshed when a rule is added, renamed, or removed.

## Conventions that are easy to miss

- Inject I/O through constructor options (`fs`, `httpClient`, `stdout`); tests pass fakes. Never `jest.mock` the real `fs` or `axios` modules.
- `strict: true`; explicit types on exported APIs; `unknown` over `any` at module boundaries.
- English identifiers, comments, and docs. Straight double quotes in code, plain hyphens rather than em-dashes in prose. Comments only where the why is non-obvious.
- Errors are `Error` subclasses with informative messages; only `cli.ts` translates them for the user.
- `tests/fixtures/github-openapi.json` and `box-openapi.yaml` are real specs and contracts; never hand-edit them. New fixtures are minimal and named after the feature they cover.

## Rule files

| Topic | Cursor (source for Codex) | Claude Code | Scope |
|-------|---------------------------|-------------|-------|
| Workflow | `.cursor/rules/workflow.mdc` | `.claude/rules/workflow.md` | always |
| Code style | `.cursor/rules/code-style.mdc` | `.claude/rules/code-style.md` | `**/*.ts` |
| Architecture | `.cursor/rules/architecture.mdc` | `.claude/rules/architecture.md` | `src/**/*.ts` |
| Testing | `.cursor/rules/testing.mdc` | `.claude/rules/testing.md` | `tests/**/*.ts` |
| Implementation order | `.cursor/rules/implementation-order.mdc` | `.claude/rules/implementation-order.md` | `src/**/*.ts`, optional |

## Codex

Codex loads this file once per session and has no glob-based rule attachment of its own. The bridge in `.codex/hooks.json` and `.codex/hooks/attach_rules.py` fills the gap: it injects every `alwaysApply: true` rule from `.cursor/rules/` at `SessionStart` and the glob-matched rules before each `apply_patch`, `Edit`, or `Write`. Run `/hooks` in Codex once per clone to trust the bridge, and again after any edit to the two hook files. The human-readable index is `.codex/rules.md`.
