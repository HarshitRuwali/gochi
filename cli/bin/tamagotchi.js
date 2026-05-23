#!/usr/bin/env node
// tamagotchi — Node wrapper that runs the TypeScript CLI via tsx.
//
// This file just exists so the global `tamagotchi` symlink is a plain
// JS entry that any Node install can execute. It spawns a child Node
// process with tsx loading src/cli.ts (Bun was the original plan, but
// the `serialport` native module hits an unsupported libuv function
// under Bun — github.com/oven-sh/bun/issues/18546).

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tsxBin = join(here, "..", "node_modules", "tsx", "dist", "cli.mjs");
const cliEntry = join(here, "..", "src", "cli.ts");

const child = spawn(process.execPath, [tsxBin, cliEntry, ...process.argv.slice(2)], {
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
