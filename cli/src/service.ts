// service.ts — macOS launchd auto-start for the local server.
//
// `tamagotchi server install` writes a LaunchAgent plist that runs
// `tamagotchi server run` at login and keeps it alive (KeepAlive=true).
// The other server.* commands wrap launchctl + a quick HTTP health probe.

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { SERVER_PORT } from "./server";

const LABEL = "com.tamagotchi.server";
const PLIST_DIR = join(homedir(), "Library", "LaunchAgents");
const PLIST_PATH = join(PLIST_DIR, `${LABEL}.plist`);

function whichBin(name: string): string | null {
  try {
    const p = execSync(`command -v ${name}`, { encoding: "utf8", shell: "/bin/sh" }).trim();
    return p || null;
  } catch {
    return null;
  }
}

// The plist invokes `node <tsx-cli.mjs> src/cli.ts server run` directly —
// avoiding the wrapper script and launchd's minimal PATH. tsx loads the
// TS source under Node, where `serialport`'s native module works (Bun is
// missing the libuv function it needs: oven-sh/bun#18546).
function plistFor(nodePath: string, tsxPath: string, cliEntry: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${tsxPath}</string>
    <string>${cliEntry}</string>
    <string>server</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>/tmp/tamagotchi.out.log</string>
  <key>StandardErrorPath</key><string>/tmp/tamagotchi.err.log</string>
</dict>
</plist>
`;
}

function uid(): number {
  // process.getuid is POSIX-only and may not exist on all platforms.
  const f = (process as unknown as { getuid?: () => number }).getuid;
  return f ? f.call(process) : 0;
}

export function install(): void {
  if (process.platform !== "darwin") {
    console.error("server install: only macOS (launchd) is supported right now.");
    process.exit(1);
  }
  const tamagotchiSymlink = whichBin("tamagotchi");
  const nodePath = whichBin("node");
  if (!tamagotchiSymlink) {
    console.error(
      "`tamagotchi` is not on your PATH. Run `bun link` (or `npm link`) inside the cli/ folder first.",
    );
    process.exit(1);
  }
  if (!nodePath) {
    console.error("`node` is not on your PATH. Install Node 18+ first.");
    process.exit(1);
  }
  // The global bin is a symlink to ./bin/tamagotchi.js; resolve it and
  // walk to the cli/ root so we can find tsx and src/cli.ts.
  const wrapperPath = realpathSync(tamagotchiSymlink);
  const cliRoot = join(wrapperPath, "..", "..");
  const tsxPath = join(cliRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const cliEntry = join(cliRoot, "src", "cli.ts");
  mkdirSync(PLIST_DIR, { recursive: true });
  writeFileSync(PLIST_PATH, plistFor(nodePath, tsxPath, cliEntry));
  // Reload: try bootout (modern), then bootstrap.
  spawnSync("launchctl", ["bootout", `gui/${uid()}/${LABEL}`], { stdio: "ignore" });
  spawnSync("launchctl", ["unload", PLIST_PATH], { stdio: "ignore" });
  const r = spawnSync(
    "launchctl",
    ["bootstrap", `gui/${uid()}`, PLIST_PATH],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    // Fallback to legacy `load`.
    const r2 = spawnSync("launchctl", ["load", PLIST_PATH], { encoding: "utf8" });
    if (r2.status !== 0) {
      console.error("launchctl failed:", r.stderr || r2.stderr);
      process.exit(1);
    }
  }
  console.log(`installed: ${PLIST_PATH}`);
  console.log("server is set to run at login (and is starting now).");
}

export function uninstall(): void {
  if (!existsSync(PLIST_PATH)) {
    console.log("not installed.");
    return;
  }
  spawnSync("launchctl", ["bootout", `gui/${uid()}/${LABEL}`], { stdio: "ignore" });
  spawnSync("launchctl", ["unload", PLIST_PATH], { stdio: "ignore" });
  unlinkSync(PLIST_PATH);
  console.log("uninstalled.");
}

export function start(): void {
  if (!existsSync(PLIST_PATH)) {
    console.error("not installed. Run: tamagotchi server install");
    process.exit(1);
  }
  // kickstart will start if stopped (or restart with -k).
  const r = spawnSync(
    "launchctl",
    ["kickstart", "-k", `gui/${uid()}/${LABEL}`],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    spawnSync("launchctl", ["load", PLIST_PATH], { stdio: "ignore" });
  }
  console.log("started.");
}

export function stop(): void {
  if (!existsSync(PLIST_PATH)) {
    console.log("not installed.");
    return;
  }
  spawnSync("launchctl", ["bootout", `gui/${uid()}/${LABEL}`], { stdio: "ignore" });
  console.log("stopped.");
}

export async function status(): Promise<void> {
  const installed = existsSync(PLIST_PATH);
  const launchctl = spawnSync("launchctl", ["list", LABEL], { encoding: "utf8" });
  const launchdLoaded = launchctl.status === 0;

  let httpUp = false;
  let health: unknown = null;
  try {
    const res = await fetch(`http://localhost:${SERVER_PORT}/health`, {
      signal: AbortSignal.timeout(500),
    });
    if (res.ok) {
      httpUp = true;
      health = await res.json();
    }
  } catch {
    // server not up
  }

  console.log(
    JSON.stringify(
      {
        installed,
        plist: installed ? PLIST_PATH : null,
        launchd: launchdLoaded ? "loaded" : "not loaded",
        http: httpUp ? "up" : "down",
        port: SERVER_PORT,
        health,
      },
      null,
      2,
    ),
  );
}
