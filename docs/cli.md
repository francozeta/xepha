# CLI

The CLI is split into a short workspace flow and lower-level commands for
debugging the protocol.

## Workspace flow

From a project root:

```sh
pnpm xepha init
pnpm xepha
pnpm xepha sync
pnpm xepha explain
```

The `pnpm xepha` script runs the built CLI. If `packages/cli/dist/index.js` does
not exist yet, or package source files are newer than the build output, it
builds the CLI first.

`pnpm xepha init` creates a visible `.xepha/` workspace:

```txt
.xepha/
  config.json
  sources.json
  rules/
    project.json
  context/
    profile.json
    project.md
  knowledge/
    index.md
```

`config.json`, `sources.json`, `rules/`, and `context/` are intended to be read
and edited. Runtime files such as `knowledge.db`, `cache/`, and `runs/` stay
local.

`pnpm xepha` syncs the configured sources, infers the current work from the
workspace, writes `.xepha/knowledge/index.md`, and prints a short human summary.
`pnpm xepha explain` shows why the current evidence was selected.

`knowledge.db` is the local SQLite store. It is not meant to be opened by hand.
Use `.xepha/knowledge/index.md` when you want the readable snapshot for humans
or agents.

The default sources are:

- `git`, for recent local commit history;
- `markdown`, for durable context written under `.xepha/context/`.

Use `.xepha/context/project.md` for notes that should survive agent sessions,
context compaction, or handoffs between tools.

## Advanced commands

The lower-level commands remain available for tests, debugging, and tools that
need the protocol directly:

```sh
pnpm xepha doctor
pnpm xepha ingest git --repo . --db .xepha/knowledge.db --limit 20
pnpm xepha events list --db .xepha/knowledge.db --limit 20
pnpm xepha context "continue the current work" --db .xepha/knowledge.db --format yaml
pnpm xepha context "continue the current work" --db .xepha/knowledge.db --explain
```

When redirecting context output, use `pnpm --silent` so pnpm lifecycle text does
not mix with YAML or JSON:

```sh
pnpm --silent xepha context "resume the project" --db .xepha/knowledge.db --explain 1> context.yml 2> explain.txt
```

The default database path is `.xepha/knowledge.db`. It is a local SQLite file.
The default readable snapshot path is `.xepha/knowledge/index.md`.

Context packs include both raw evidence and a small derived knowledge summary.
The `events` section is still useful for debugging, but consumers should prefer
the `knowledge` section first.

To inspect another local repository, pass its path with `--repo` and write the
database wherever you want:

```sh
pnpm xepha ingest git --repo C:/path/to/project --db C:/path/to/project/.xepha/knowledge.db
pnpm xepha context "resume the project" --db C:/path/to/project/.xepha/knowledge.db
```

The CLI is still experimental. It currently supports git commit ingest, local
SQLite storage, event listing, simple event ranking, ranking explanations, and
context pack rendering with derived knowledge summaries.
