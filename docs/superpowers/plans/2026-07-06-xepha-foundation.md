# Xepha Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the scalable Xepha monorepo foundation before product logic expands.

**Architecture:** Keep intelligence in pure TypeScript packages and use NestJS as the API orchestration layer. Keep Next.js limited to website and playground surfaces.

**Tech Stack:** Turborepo, pnpm, TypeScript, NestJS, Next.js, Vitest, Husky, commitlint, lint-staged, release-please.

---

### Task 1: Monorepo Shape

**Files:**

- Modify: `package.json`
- Modify: `turbo.json`
- Modify: `apps/website/package.json`
- Modify: `apps/playground/package.json`
- Create: `apps/api/package.json`
- Create: `packages/core/package.json`
- Create: `packages/memory/package.json`
- Create: `packages/graph/package.json`
- Create: `packages/protocol/package.json`
- Create: `packages/adapters/package.json`
- Create: `packages/cli/package.json`

- [x] Rename apps from starter names to Xepha domain names.
- [x] Add pure TypeScript packages for the core intelligence layers.
- [x] Add a NestJS API package as orchestration only.
- [x] Keep a shared UI package for future web surfaces.

### Task 2: Quality And Release Tooling

**Files:**

- Create: `.editorconfig`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Create: `commitlint.config.cjs`
- Create: `.husky/commit-msg`
- Create: `.husky/pre-commit`
- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release-please.yml`

- [x] Enforce Conventional Commits locally.
- [x] Run lint-staged before commits.
- [x] Configure release-please for single-version MVP releases.
- [x] Add CI for install, format, lint, typecheck, test, and build.

### Task 3: First Domain Contracts

**Files:**

- Create: `packages/core/src/index.ts`
- Create: `packages/memory/src/index.ts`
- Create: `packages/graph/src/index.ts`
- Create: `packages/protocol/src/index.ts`
- Create: `packages/adapters/src/index.ts`
- Create: `packages/cli/src/index.ts`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/health.controller.ts`

- [x] Define `KnowledgeEvent` as the first atomic knowledge primitive.
- [x] Add in-memory storage and graph/context contracts.
- [x] Add `xepha doctor` CLI command.
- [x] Add API `/health` endpoint.

### Task 4: Verification

**Files:**

- Modify: `pnpm-lock.yaml`

- [x] Run `pnpm install`.
- [x] Run `pnpm format:check`.
- [x] Run `pnpm lint`.
- [x] Run `pnpm check-types`.
- [x] Run `pnpm test`.
- [x] Run `pnpm build`.
