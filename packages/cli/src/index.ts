#!/usr/bin/env node
import { Command } from "commander";
import { XEPHA_PROJECT } from "@xepha/core";

const program = new Command();

program
  .name("xepha")
  .description("Local-first project intelligence for AI-native software development.")
  .version(XEPHA_PROJECT.version);

program
  .command("doctor")
  .description("Print the current Xepha workspace baseline.")
  .action(() => {
    console.log(`${XEPHA_PROJECT.name} ${XEPHA_PROJECT.version}`);
    console.log(XEPHA_PROJECT.summary);
  });

program.parse();
