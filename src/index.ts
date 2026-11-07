#!/usr/bin/env node
import { runCli } from "./cli.js";
import { runStdio } from "./transports/stdio.js";

const main = async (): Promise<void> => {
  const command = process.argv[2];
  if (command && (await runCli(command))) return;
  await runStdio();
};

if (process.env.NODE_ENV !== "test") {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown startup error";
    process.stderr.write(`AraraHQ MCP failed: ${message}\n`);
    process.exitCode = 1;
  });
}
