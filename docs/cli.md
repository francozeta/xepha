# CLI

The CLI can already run against a local git repository.

From the Xepha repository:

```sh
pnpm xepha doctor
pnpm xepha ingest git --repo . --db .xepha/knowledge.db --limit 20
pnpm xepha events list --db .xepha/knowledge.db --limit 20
pnpm xepha context "continue the current work" --db .xepha/knowledge.db --format yaml
pnpm xepha context "continue the current work" --db .xepha/knowledge.db --explain
```

The `pnpm xepha` script runs the built CLI. If `packages/cli/dist/index.js` does
not exist yet, or package source files are newer than the build output, it
builds the CLI first.

When redirecting context output to a file, use `pnpm --silent` so pnpm lifecycle
text does not mix with YAML or JSON:

```sh
pnpm --silent xepha context "resume the project" --db .xepha/knowledge.db --explain 1> context.yml 2> explain.txt
```

The default database path is `.xepha/knowledge.db`. It is a local SQLite file and
is ignored by git.

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
