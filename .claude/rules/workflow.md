# Workflow (TDD, layered, docs-aware)

This file has no `paths:` frontmatter, so it loads at session start (same priority as `CLAUDE.md`).

`openapi-to-cli` (`ocli`) is a TypeScript CLI that turns OpenAPI/Swagger specs into runtime commands. The user-facing surface is the `ocli` binary, `.ocli/` config dir, and `profiles.ini`. Tests live next to source in `tests/` and run with Jest. Behavior is specified by tests; the README documents the public CLI contract.

## New features (TDD)

When the user asks for a new feature (words like "feature", "add", "implement", "фича", "добавить"), follow this order. Do not skip steps.

1. **Plan**: outline the steps for the change (modules to touch, tests to add). Use a task list if it spans more than 2-3 steps.
2. **Failing test first**: add or extend a test in `tests/<module>.test.ts`. The test must describe the new behavior in `describe`/`it` and **fail** for the right reason.
3. **Confirm red**: run only that test: `npx jest tests/<module>.test.ts -t "<title>"`. Confirm it fails as expected.
4. **Implement**: write the minimum code in `src/` that makes the test pass. Follow [architecture.md](architecture.md) and [code-style.md](code-style.md). When adding new classes, follow [implementation-order.md](implementation-order.md) - lower layer first.
5. **Confirm green**: re-run the same test; it must pass.
6. **Full suite**: `npm test`. All tests must be green. Fix regressions before moving on.
7. **Build check**: `npm run build` to confirm `tsc` is clean (no type errors).
8. **Docs**: update `README.md` whenever any of the following change: CLI flags, command names, profile fields, `.ocli/` layout, BM25 search behavior, supported OpenAPI/Swagger features, or the benchmark numbers. If you changed observable CLI output (`--help`, error messages, exit codes), update the relevant section of the README. The `examples/skill-ocli-api.md` and `skills/ocli-api/SKILL.md` must stay aligned with the documented agent workflow.
9. **Report**: brief summary of files touched, tests added, suite result.

## Bug fixes (TDD)

When the user reports a bug (words like "bug", "fix", "ошибка", "баг", "исправить"):

1. **Plan** the fix.
2. **Reproduction test**: add a test in `tests/<module>.test.ts` that reproduces the bug. It must **fail** on the broken code for the right reason.
3. **Confirm red**: run only that test and confirm it fails.
4. **Fix**: minimal code change in `src/` to make the test pass; respect existing module boundaries.
5. **Confirm green**: re-run the regression test.
6. **Full suite**: `npm test`. All tests green.
7. **Build check**: `npm run build`.
8. **Docs**: update `README.md` if the bug affected documented behavior.
9. **Report**: what was broken, what changed, suite result.

## Before the final answer

- `npm test` is green - **always**.
- `npm run build` is clean.
- `README.md` reflects any user-visible change.
- Report what changed, which tests were added, and the suite result.

## Rules sync (Cursor <-> Claude)

`.claude/rules/*.md` and `.cursor/rules/*.mdc` cover the same topics and must stay aligned. **Any change to a rule in one location must be mirrored to the other in the same change**, no exceptions.

Mapping:

| Topic | Claude | Cursor |
|-------|--------|--------|
| Workflow | `.claude/rules/workflow.md` | `.cursor/rules/workflow.mdc` |
| Architecture | `.claude/rules/architecture.md` | `.cursor/rules/architecture.mdc` |
| Code style | `.claude/rules/code-style.md` | `.cursor/rules/code-style.mdc` |
| Testing | `.claude/rules/testing.md` | `.cursor/rules/testing.mdc` |
| Implementation order | `.claude/rules/implementation-order.md` | `.cursor/rules/implementation-order.mdc` (create if absent) |

When propagating, translate the frontmatter:

- Claude `paths: ["src/**/*.ts"]` -> Cursor `globs: "src/**/*.ts"` + `alwaysApply: true` (or `false` for optional topics like `implementation-order`).
- Claude rule without frontmatter (loaded every session, e.g. `workflow.md`) -> Cursor `alwaysApply: true` with no `globs`.
- Replace cross-rule links: Claude `[architecture.md](architecture.md)` -> Cursor `@architecture.mdc`.

Body content stays identical. If the change is Cursor-only or Claude-only (very rare - e.g. tool-specific quirk), state that explicitly in the file as "Tool-specific:" and skip mirroring for that section only.

## Relationship to other rules

- [architecture.md](architecture.md) is loaded under `src/**` - use it when picking modules and dependency direction.
- [implementation-order.md](implementation-order.md) is loaded under `src/**` - use it to decide layer order when adding new classes.
- [code-style.md](code-style.md) is loaded for all `.ts` files - applies to both `src/` and `tests/`.
- [testing.md](testing.md) is loaded under `tests/` - applies when writing or editing tests.
