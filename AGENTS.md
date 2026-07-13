# Agent Halo Agent Rules

## Project Reality

- Agent Halo is a local-first Letta Code presence companion and Tauri desktop app. Start with `README.md` and `docs/` for product, architecture, event protocol, and presence-model context.
- Use `pnpm` only (`packageManager: pnpm@10.33.0`). Do not add npm/yarn lockfiles.
- Preserve local/generated state. `.agent-state/`, `.letta/`, `.cocoindex_code/`, `node_modules/`, build output, and test reports are ignored local state.
- After changing `mods/agent-halo.js`, install/reload the Letta mod before judging live behavior. After native desktop changes, run an appropriate desktop check/build/install path.
- Do not commit or push unless explicitly asked.

## Codebase Search

- Prefer `cocoindex-code` MCP `search` for semantic codebase search, broad repo exploration, fuzzy implementation lookup, and unfamiliar modules when the MCP tool is available.
- If the MCP tool is unavailable, use `ccc search` for semantic search and `ccc index` or `ccc search --refresh` when the index may be stale. This repo has local CocoIndex state under `.cocoindex_code/`, and the CLI may be available as `ccc`.
- Use CocoIndex/ccc as a token-saving first pass: avoid broad blind reads by letting semantic search narrow the repo to candidate files and line ranges.
- Run semantic search from the repo root, or pass `--path`, because `ccc search` defaults to the current working-directory scope.
- Treat semantic results as candidate locations: read only the returned file/ranges needed for verification with the available file-read tool or `sed -n` before editing or making strong claims.
- Use `rg` for exact text, regex, symbol, and filename search.
- Use AST-aware search for syntax-shaped queries when available.
- Go directly to file reads, `rg`, or AST tools for known files, exact symbols, or tiny lookups; CocoIndex is a locator, not a replacement for source reads.
- Treat requests like `search the codebase`, `find where X is implemented`, `how does this repo work`, `ดู repo หน่อย`, and `หาโค้ดส่วนนี้` as CocoIndex-first triggers when available.
- After meaningful code changes, refresh or re-index before relying on semantic search results.

## Validation Commands

- TypeScript/workspace check: `pnpm check`
- Browser demo regression: `pnpm test:demo`
- Hook integration tests: `pnpm test:hooks`
- Desktop web build: `pnpm desktop:web:build`
- Native desktop build/install: `pnpm desktop:build` or `pnpm desktop:install`
- Rust-only native check: run `cargo check` from `apps/desktop/src-tauri/`
