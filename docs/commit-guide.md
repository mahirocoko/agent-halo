# Git Commit Guide

There is no commitlint or repository hook enforcing commit messages. This guide reflects the observed history and a recommended local baseline.

## Commit Message Format

Recent commits use a conventional type and concise imperative subject:

```text
feat: add resizable Usage dashboard and persistence
fix: ship corrected session behavior
docs: add protocol notes
```

## Commit Types

- **feat**: new product capability
- **fix**: behavior or regression correction
- **docs**: documentation-only change
- **refactor**: code restructuring without intended behavior change
- **test**: test coverage or test-only change
- **build**: tooling/dependency/build change
- **chore**: maintenance work

## Subject Rules

- Keep the subject concise and in present tense.
- Prefer imperative wording.
- Explain why in the body when the change crosses a protocol, persistence, native, or visual boundary.
- Keep formatting-only changes separate from behavior changes when practical.

## Checks Before Commit

```bash
pnpm quality
pnpm test:demo
```

Add native build/install or `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` when the change touches native behavior.

## Scope and Safety

- Do not commit secrets, local credentials, generated app state, screenshots, or native build output.
- Keep docs commits separate from code commits when practical.
- Do not commit or push unless explicitly requested.
