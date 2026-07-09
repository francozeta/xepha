# Xepha

Xepha is an experimental open source project for storing and reusing project
context outside an AI chat session.

AI coding tools can read files and make changes, but they usually rebuild the
same context over and over. They also lose track of decisions that happened in
issues, commits, reviews, docs, and previous sessions.

This repository is exploring a small local system for recording that project
history as structured data, then retrieving the parts that are useful for a
specific task.

## Current Goal

The first goal is to build a local MVP that can:

- ingest project events such as decisions, commits, and discussions;
- store them locally;
- link related events;
- produce small context packs for humans or tools.

The project is early. Most packages currently contain boundaries and starter
contracts, not complete implementations.

## Repository Layout

```txt
apps/
  api/          NestJS API used for local orchestration
  playground/  Next.js app for inspecting experiments
  website/     Next.js app for the public site and docs

packages/
  adapters/    Interfaces for ingesting external sources
  cli/         Command line entry point
  core/        Shared project event types
  graph/       Event relationship utilities
  memory/      Storage interfaces
  protocol/    Context request and response types
  ui/          Shared UI components
```

## Run Locally

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts the local API, website, and playground.

Useful commands:

```sh
pnpm xepha init
pnpm xepha
pnpm xepha sync
pnpm xepha explain
pnpm check
```

CLI usage is documented in [docs/cli.md](docs/cli.md).

## Development

Use Conventional Commits:

```txt
feat(core): add project event model
fix(cli): handle missing workspace path
docs(repo): update contributor docs
```

CI runs formatting, linting, type checks, tests, and builds. Releases are managed
with release-please once changes land on `main`.

## License

MIT
