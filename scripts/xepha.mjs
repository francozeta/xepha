#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const cliEntryPath = fileURLToPath(
  new URL("../packages/cli/dist/index.js", import.meta.url),
);
const buildInputPaths = [
  "package.json",
  "pnpm-lock.yaml",
  "packages/adapters/package.json",
  "packages/adapters/src",
  "packages/cli/package.json",
  "packages/cli/src",
  "packages/core/package.json",
  "packages/core/src",
  "packages/graph/package.json",
  "packages/graph/src",
  "packages/memory/package.json",
  "packages/memory/src",
  "packages/protocol/package.json",
  "packages/protocol/src",
].map((path) => fileURLToPath(new URL(`../${path}`, import.meta.url)));

if (needsBuild()) {
  runBuild();
}

const result = spawnSync(process.execPath, [cliEntryPath, ...process.argv.slice(2)], {
  cwd: repoRoot,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);

function needsBuild() {
  if (!existsSync(cliEntryPath)) {
    return true;
  }

  const cliEntryMtime = statSync(cliEntryPath).mtimeMs;

  return buildInputPaths.some((path) => getNewestMtime(path) > cliEntryMtime);
}

function getNewestMtime(path) {
  if (!existsSync(path)) {
    return 0;
  }

  const stats = statSync(path);

  if (!stats.isDirectory()) {
    return stats.mtimeMs;
  }

  return readdirSync(path, {
    withFileTypes: true,
  }).reduce((newestMtime, entry) => {
    const entryMtime = getNewestMtime(`${path}/${entry.name}`);

    return Math.max(newestMtime, entryMtime);
  }, stats.mtimeMs);
}

function runBuild() {
  const pnpm = "pnpm";
  const result = spawnSync(
    pnpm,
    ["--silent", "--filter", "@xepha/cli...", "build"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
      stdio: ["inherit", "pipe", "inherit"],
    },
  );

  if (result.stdout) {
    process.stderr.write(result.stdout);
  }

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
