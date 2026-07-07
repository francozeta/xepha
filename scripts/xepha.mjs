#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const cliEntryPath = fileURLToPath(
  new URL("../packages/cli/dist/index.js", import.meta.url),
);

if (!existsSync(cliEntryPath)) {
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

function runBuild() {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(pnpm, ["--silent", "xepha:build"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
  });

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
