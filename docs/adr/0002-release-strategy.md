# ADR 0002: Release Strategy

## Status

Accepted

## Context

Xepha is starting as a tightly coupled MVP. Independent package releases would
add process overhead before package boundaries are stable.

## Decision

Use Conventional Commits, commitlint, and release-please manifest mode with a
single repository version.

The default release tag format is `vX.Y.Z`.

## Consequences

- Contributors get immediate feedback on commit format.
- Release PRs are generated automatically from merged conventional commits.
- The project can migrate to independent package versions later when packages
  are stable and publishable.
