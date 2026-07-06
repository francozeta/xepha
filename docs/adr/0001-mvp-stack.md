# ADR 0001: MVP Stack

## Status

Accepted

## Context

Xepha needs to validate the product model quickly without coupling the core to a
specific UI, cloud service, or future runtime.

## Decision

The MVP uses Turborepo, pnpm, TypeScript, NestJS, Next.js, and a planned SQLite
local persistence layer.

NestJS is the API/control-plane layer. The intelligence model lives in pure
TypeScript packages under `packages/*`.

## Consequences

- The core can be tested without running the API or web apps.
- The API can orchestrate without owning product logic.
- A future Rust runtime can replace performance-sensitive pieces behind package
  boundaries.
- The first version optimizes for speed and clarity over maximum runtime
  performance.
