---
paths:
  - "src/**/*.ts"
---

# Implementation order (one unit at a time)

Applies when adding or extending modules under `src/`.

## Layer order (lower first)

The architecture in [architecture.md](architecture.md) defines four layers. New behavior should be added at the lowest layer it can live in, then composed upward:

1. **Layer 0 - pure** (`bm25.ts`, type-only files): no I/O, no Node built-ins beyond `Buffer`/`URL`/etc.
2. **Layer 1 - I/O wrappers** (`config.ts`, `profile-store.ts`, `openapi-loader.ts`): touch `fs`, network, or env.
3. **Layer 2 - transform** (`openapi-to-commands.ts`, `command-search.ts`): combine Layer 0 + Layer 1 outputs into the CLI command model.
4. **Layer 3 - entry** (`cli.ts`): wire everything together for yargs and axios.

Forbidden: Layer N importing from Layer M when M > N. If a Layer 1 module suddenly needs a Layer 2 type, that is a sign the type belongs lower.

## Steps for a new module or class

1. Decide the layer using [architecture.md](architecture.md).
2. Write a failing test in `tests/<module>.test.ts` that describes the smallest useful behavior (see [testing.md](testing.md) and [workflow.md](workflow.md)).
3. Add the minimum implementation in `src/<module>.ts`. Follow [code-style.md](code-style.md) for types, naming, and constructor-injected I/O.
4. Make the test pass.
5. Run `npm test` to confirm no regressions, then `npm run build` to confirm `tsc` is clean.
6. Only **then** integrate the new module into the layer above (typically `cli.ts`), guarded by its own test.

## Forbidden

- Implementing two unrelated modules in one step before either has tests.
- Wiring a new module into `cli.ts` before its own tests pass.
- Adding optional fields to `Profile`, `CliCommand`, or `CliCommandOption` without a test that exercises the new field.
- Editing real-spec fixtures (`github-api.*`, `box-api-yaml.*`) to "make tests pass" - those represent contracts.

## Allowed

- Stub or fake dependencies (mock `HttpClient`, in-memory `fs`) while a lower layer is incomplete, provided the stub matches the documented contract.
- Refactor a passing module to a cleaner shape after the test suite stays green.
- Extending an existing Layer 2 module with a new transformation, as long as it is covered by a new test and does not import upward.
