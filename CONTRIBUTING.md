# Contributing

Xepha is experimental. Contributions should keep the repository small, clear,
and easy to change.

## Local Setup

```sh
pnpm install
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

## Pull Requests

- Keep changes focused.
- Explain the problem before the implementation.
- Include tests when behavior changes.
- Update docs when package boundaries or commands change.
- Use Conventional Commits for commit messages.

## Commit Format

```txt
feat(core): add project event model
fix(api): return health version
docs(repo): document local setup
```

Allowed scopes are defined in `commitlint.config.cjs`.
