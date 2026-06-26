// cli.ts — CLI entry point (invoked by ../bin/gochi.js via tsx).
//
// User-facing surface:
//   gochi setup                  one-time install (daemon + HTTP frontend)
//   gochi face|mood|text|image   drive the pet (talks to daemon via UDS)
//   gochi ping|health            liveness / status
//   gochi get|list               queries
//   gochi server enable          turn HTTP frontend on (default after setup)
//   gochi server disable         turn HTTP frontend off
//   gochi server status          HTTP frontend state
//   gochi daemon status          daemon state
//
// Internal (invoked by launchd plists / systemd units / Task Scheduler):
//   gochi daemon run             foreground daemon process
//   gochi server run             foreground HTTP frontend process

import { select } from "@inquirer/prompts";
import { Command } from "commander";

import packageJson from "../package.json";
import * as client from "./client";
import { runDaemon } from "./daemon";
import { fileToFrameBase64 } from "./image";
import { runServer } from "./server";
import * as service from "./service";
import { spotifyLogin, spotifyLogout, spotifyNow, spotifyWatch } from "./spotify";
import { STATUS_PROFILES } from "./status";
import { runTest } from "./test";
import { discoverDevices } from "./transport_ble";

const VERSION: string = packageJson.version;

// Kept in sync with the firmware's expression / mood registries.
const FACES = [
  "neutral",
  "happy",
  "sad",
  "sleepy",
  "excited",
  "surprised",
  "angry",
  "blink",
  "love",
  "sexy",
  "shy",
  "dead",
];
const MOODS = ["content", "playful", "grumpy", "sleepy", "affectionate"];

const program = new Command();
program
  .name("gochi")
  .description("Drive the Tamagotchi desk pet over USB serial.")
  .version(VERSION, "-v, --version");

// --- One-time setup ----------------------------------------------------

program
  .command("setup")
  .description(
    "install the daemon (and HTTP frontend) so the pet is always reachable",
  )
  .action(() => service.setup());

// stop / start release and reacquire the serial port. The daemon keeps
// running; only the device link is dropped. Used before `make flash` and
// any other tool that needs exclusive access to /dev/cu.usbmodem*.
program
  .command("stop")
  .description("release the serial port (e.g. before flashing firmware)")
  .action(async () => print(await client.stop()));

program
  .command("start")
  .description("reacquire the serial port after a `stop`")
  .action(async () => print(await client.start()));

// `kill` terminates the running daemon. The launchd / systemd / Task
// Scheduler unit auto-respawns it, which is the whole point: the new
// process picks up any source changes (added endpoints, daemon-side
// bug fixes) without having to rewrite the service unit.
program
  .command("kill")
  .description(
    "kill the daemon (launchd/systemd auto-respawns it with the current code)",
  )
  .action(() => service.killDaemon());

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
  .command("status")
  .description("set your availability status (office-friendly presets)")
  .argument("[name]", "status name (e.g. available, busy, in-meeting, deep-focus)")
  .action(async (name?: string) => {
    const chosen =
      name ??
      (await select({
        message: "Set your status:",
        choices: STATUS_PROFILES.map((p) => ({
          name: p.label,
          value: p.name,
          description: p.description,
        })),
      }));
    print(await client.status(chosen));
  });

program
  .command("text")
  .description("show a line of text (long text scrolls)")
  .argument("<text...>", "the text to show")
  .action(async (parts: string[]) => print(await client.text(parts.join(" "))));

program
  .command("image")
  .description("show a PNG/JPG on the OLED (auto-resized to 128x64, 1-bit)")
  .argument("<path>", "path to a PNG or JPG file")
  .option(
    "--no-dither",
    "use a plain brightness threshold instead of Floyd–Steinberg",
  )
  .option(
    "-t, --threshold <n>",
    "threshold cutoff 0..255 (only with --no-dither)",
    "128",
  )
  .option("--invert", "swap on/off pixels")
  .option("--bg <color>", "letterbox fill: black|white", "black")
  .action(
    async (
      path: string,
      opts: {
        dither: boolean;
        threshold: string;
        invert?: boolean;
        bg: string;
      },
    ) => {
      const t = Number(opts.threshold);
      if (!Number.isFinite(t) || t < 0 || t > 255) {
        console.error("threshold must be a number 0..255");
        process.exit(1);
      }
      if (opts.bg !== "black" && opts.bg !== "white") {
        console.error("bg must be 'black' or 'white'");
        process.exit(1);
      }
      let base64: string;
      try {
        base64 = await fileToFrameBase64(path, {
          dither: opts.dither,
          threshold: t,
          invert: opts.invert,
          background: opts.bg,
        });
      } catch (e: any) {
        console.error(`could not read or decode "${path}": ${e?.message || e}`);
        process.exit(1);
      }
      print(await client.image(base64));
    },
  );

// --- Queries -----------------------------------------------------------

const get = program.command("get");
get
  .command("state")
  .description("current view + expression")
  .action(async () => print(await client.state()));
get
  .command("fps")
  .description("current display frame rate")
  .action(async () => print(await client.fps()));

const list = program.command("list");
list
  .command("faces")
  .description("list all expression names")
  .action(async () => print(await client.faces()));
list
  .command("statuses")
  .description("list all availability status presets")
  .action(() => {
    const nameWidth = Math.max(...STATUS_PROFILES.map((p) => p.name.length)) + 2;
    for (const p of STATUS_PROFILES) {
      console.log(`  ${p.name.padEnd(nameWidth)} ${p.description}`);
    }
  });

program
  .command("ping")
  .description("liveness check (PONG)")
  .action(async () => print(await client.ping()));

// Names for I2C addresses we know about — purely cosmetic, the firmware
// just returns the addresses.
const I2C_LABELS: Record<string, string> = {
  "0x3C": "SSD1306 OLED",
  "0x68": "MPU-6050 IMU",
  "0x69": "MPU-6050 IMU (AD0 high)",
};

program
  .command("i2c")
  .description("scan both I2C buses and list every device that ACKs")
  .action(async () => {
    const result = await client.i2c();

    // Daemon reachable but the board isn't — most commonly because
    // `gochi stop` released the serial port. Tell the user how to fix it
    // instead of dumping a JSON error blob at them.
    if (!result.ok || result.connected === false) {
      const why =
        result.message ?? "no response from the daemon (device may be disconnected)";
      console.error(`i2c scan failed: ${why}`);
      console.error("");
      console.error("If you ran `gochi stop`, run `gochi start` to reconnect.");
      console.error("Otherwise check `gochi daemon status` and the USB cable.");
      process.exit(1);
    }

    // The firmware replies with `{"A":[...],"B":[...]}` — the daemon
    // may pass it as a parsed object or as the raw string. Either way,
    // guard against an empty/garbage payload so we don't crash on
    // `parsed.A` if the daemon handed us null.
    let parsed: { A?: string[]; B?: string[] } | null = null;
    const raw = result.response;
    if (raw != null) {
      try {
        parsed = typeof raw === "string" ? JSON.parse(raw) : (raw as any);
      } catch {
        // fall through to the "bad payload" handler below
      }
    }
    if (parsed == null || typeof parsed !== "object") {
      console.error("i2c scan failed: the daemon returned an empty or malformed response.");
      console.error(`Raw payload: ${JSON.stringify(raw)}`);
      console.error("Try `gochi start` to refresh the device connection.");
      process.exit(1);
    }

    const buses: Array<[string, string, string[]]> = [
      ["A", "hardware I2C, GPIO5/6", parsed.A ?? []],
      ["B", "software I2C, GPIO7/8", parsed.B ?? []],
    ];
    for (const [label, where, addrs] of buses) {
      console.log(`Bus ${label} (${where}):`);
      if (addrs.length === 0) {
        console.log("  (no devices)");
      } else {
        for (const addr of addrs) {
          const name = I2C_LABELS[addr];
          console.log(`  ${addr}${name ? `  ${name}` : ""}`);
        }
      }
    }
  });

// --- Self-test ---------------------------------------------------------

// --- Spotify -----------------------------------------------------------

const spotify = program
  .command("spotify")
  .description("connect Spotify and show now-playing on the display");

spotify
  .command("login")
  .description("authenticate with Spotify (opens a browser, stores tokens)")
  .argument("<client-id>", "your Spotify app Client ID from developer.spotify.com")
  .action(async (clientId: string) => {
    await spotifyLogin(clientId);
  });

spotify
  .command("logout")
  .description("remove stored Spotify tokens")
  .action(() => spotifyLogout());

spotify
  .command("now")
  .description("show the currently playing track on the display (one-shot)")
  .action(async () => {
    await spotifyNow();
  });

spotify
  .command("watch")
  .description("poll Spotify and push every track change to the display (Ctrl-C to stop)")
  .action(async () => {
    await spotifyWatch();
  });

program
  .command("test")
  .description("interactive hardware self-test (asks y/n per component)")
  .argument(
    "[component]",
    "serial | oled | buzzer | imu | all (omit to pick from a menu)",
  )
  .action(async (component?: string) => {
    await runTest(component);
  });

program
  .command("health")
  .description("daemon + device status")
  .action(async () => print(await client.health()));

// --- Bluetooth LE ------------------------------------------------------

const ble = program
  .command("ble")
  .description("Bluetooth LE device management");

ble
  .command("scan")
  .description("scan for nearby Gochi devices over BLE")
  .option("-t, --timeout <ms>", "scan timeout in milliseconds", "5000")
  .action(async (opts: { timeout: string }) => {
    const timeout = Number(opts.timeout);
    if (!Number.isFinite(timeout) || timeout < 0) {
      console.error("timeout must be a positive number");
      process.exit(1);
    }
    
    console.log(`Scanning for Gochi devices (${timeout}ms)...`);
    try {
      const devices = await discoverDevices(timeout);
      if (devices.length === 0) {
        console.log("No devices found.");
        console.log("\nMake sure:");
        console.log("  - Your Gochi device is powered on");
        console.log("  - BLE is enabled in the firmware (BLE_ENABLED 1)");
        console.log("  - Bluetooth is enabled on this computer");
      } else {
        console.log(`\nFound ${devices.length} device(s):\n`);
        for (const dev of devices) {
          console.log(`  ${dev.name}`);
          console.log(`    Address: ${dev.address}`);
        }
        console.log("\nTo connect via BLE, use: gochi ble connect <name>");
      }
    } catch (e: any) {
      console.error(`BLE scan failed: ${e?.message || e}`);
      process.exit(1);
    }
  });

ble
  .command("connect")
  .description("connect to a specific Gochi device via BLE")
  .argument("<device>", "device name (e.g., Gochi-A1B2) or address")
  .action(async (device: string) => {
    console.log(`Connecting to ${device} via BLE...`);
    const result = await client.bleConnect(device);
    print(result);
  });

// --- Daemon management -------------------------------------------------

const daemon = program
  .command("daemon")
  .description("manage the long-lived port-owning daemon");
daemon
  .command("run")
  .description("run the daemon in the foreground (used by launchd)")
  .action(() => runDaemon());
daemon
  .command("status")
  .description("show daemon launchd + socket status")
  .action(() => service.daemonStatus());

// --- HTTP frontend management -----------------------------------------

const server = program
  .command("server")
  .description("manage the optional HTTP frontend");
server
  .command("enable")
  .description("turn on the TCP HTTP listener (auto-started at login)")
  .action(() => service.enableHttp());
server
  .command("disable")
  .description("turn off the TCP HTTP listener")
  .action(() => service.disableHttp());
server
  .command("status")
  .description("show HTTP frontend status")
  .action(() => service.serverStatus());
server
  .command("run")
  .description("run the HTTP frontend in the foreground (used by launchd)")
  .action(() => runServer());

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
