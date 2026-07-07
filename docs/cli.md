# CLI

The CLI can already run against a local git repository.

From the Xepha repository:

```sh
pnpm xepha doctor
pnpm xepha ingest git --repo . --db .xepha/knowledge.db --limit 20
pnpm xepha events list --db .xepha/knowledge.db
pnpm xepha context "continue the current work" --db .xepha/knowledge.db --format yaml
```

The `pnpm xepha` script builds the CLI package and its local dependencies before
running the command.

To inspect another local repository, pass its path with `--repo` and write the
database wherever you want:

```sh
pnpm xepha ingest git --repo C:/path/to/project --db C:/path/to/project/.xepha/knowledge.db
pnpm xepha context "resume the project" --db C:/path/to/project/.xepha/knowledge.db
```

The CLI is still experimental. It currently supports git commit ingest, local
SQLite storage, event listing, simple event ranking, and context pack rendering.
