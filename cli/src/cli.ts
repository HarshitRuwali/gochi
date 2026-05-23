// cli.ts — CLI entry point (invoked by ../bin/tamagotchi.js via tsx).

import { select } from "@inquirer/prompts";
import { Command } from "commander";

import * as client from "./client";
import { runServer } from "./server";
import * as service from "./service";

const VERSION = "0.1.0";

// Kept in sync with the firmware's expression / mood registries.
const FACES = [
  "neutral", "happy", "sad", "sleepy", "excited", "surprised",
  "angry",   "blink", "love", "horny",  "shy",     "dead",
];
const MOODS = ["content", "playful", "grumpy", "sleepy", "affectionate"];

const program = new Command();
program
  .name("tamagotchi")
  .description("Drive the Tamagotchi desk pet over USB serial.")
  .version(VERSION, "-v, --version");

// --- Pet commands ------------------------------------------------------

program
  .command("face")
  .description("show a face expression (omit name to pick from a menu)")
  .argument("[name]", "face name (e.g. happy)")
  .action(async (name?: string) => {
    const chosen = name ?? (await pickFrom("Pick a face:", FACES));
    print(await client.face(chosen));
  });

program
  .command("mood")
  .description("set the pet's mood (omit name to pick from a menu)")
  .argument("[name]", "mood name (e.g. playful)")
  .action(async (name?: string) => {
    const chosen = name ?? (await pickFrom("Pick a mood:", MOODS));
    print(await client.mood(chosen));
  });

program
  .command("text")
  .description("show a line of text (long text scrolls)")
  .argument("<text...>", "the text to show")
  .action(async (parts: string[]) => print(await client.text(parts.join(" "))));

// --- Queries -----------------------------------------------------------

const get = program.command("get");
get.command("state").description("current view + expression")
  .action(async () => print(await client.state()));
get.command("fps").description("current display frame rate")
  .action(async () => print(await client.fps()));

const list = program.command("list");
list.command("faces").description("list all expression names")
  .action(async () => print(await client.faces()));

program.command("ping").description("liveness check (PONG)")
  .action(async () => print(await client.ping()));

program.command("health").description("server + device status")
  .action(async () => print(await client.health()));

// --- Server management -------------------------------------------------

const server = program.command("server").description("manage the local HTTP server");
server.command("run").description("run the server in the foreground (used by launchd)")
  .action(() => runServer());
server.command("status").description("show installed / launchd / HTTP status")
  .action(() => service.status());
server.command("start").description("start the installed server")
  .action(() => service.start());
server.command("stop").description("stop the running server")
  .action(() => service.stop());
server.command("install").description("install the launchd agent so it auto-starts at login")
  .action(() => service.install());
server.command("uninstall").description("remove the launchd agent")
  .action(() => service.uninstall());

program.parseAsync(process.argv).catch((e) => {
  // Inquirer throws this on Ctrl-C — exit quietly instead of stack-tracing.
  if (e?.name === "ExitPromptError") {
    process.exit(130);
  }
  console.error(e?.stack || e);
  process.exit(1);
});

// --- Helpers -----------------------------------------------------------

async function pickFrom(message: string, options: string[]): Promise<string> {
  return await select({
    message,
    choices: options.map((value) => ({ name: value, value })),
  });
}

function print(result: unknown): void {
  if (typeof result === "string") console.log(result);
  else console.log(JSON.stringify(result, null, 2));
}
