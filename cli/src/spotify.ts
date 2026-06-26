// spotify.ts — Spotify "now playing" integration for the Gochi display.
//
// Auth: OAuth 2.0 Authorization Code + PKCE (no client secret needed).
// Tokens are stored at ~/.tamagotchi/spotify.json.
//
// Commands (wired in cli.ts):
//   gochi spotify login     — open browser, capture callback, store tokens
//   gochi spotify logout    — remove stored tokens
//   gochi spotify now       — one-shot: print + display current track
//   gochi spotify watch     — poll loop, push track to display (Ctrl-C stops)

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { exec } from "node:child_process";

import { DAEMON_DIR, ensureDaemonDir } from "./ipc.js";
import * as client from "./client.js";
import { bufferToFrameBase64 } from "./image.js";

// ── Constants ──────────────────────────────────────────────────────────────

const TOKEN_FILE = join(DAEMON_DIR, "spotify.json");
const CALLBACK_PORT = 8765;
const CALLBACK_URL = `http://127.0.0.1:${CALLBACK_PORT}/callback`;
const SPOTIFY_SCOPES = "user-read-currently-playing user-read-playback-state";

// How often to poll the Spotify API in watch mode (ms).
const POLL_INTERVAL_MS = 5_000;

// ── Token persistence ──────────────────────────────────────────────────────

interface TokenData {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

function loadTokens(): TokenData | null {
  try {
    if (!existsSync(TOKEN_FILE)) return null;
    return JSON.parse(readFileSync(TOKEN_FILE, "utf8")) as TokenData;
  } catch {
    return null;
  }
}

function saveTokens(data: TokenData): void {
  ensureDaemonDir();
  // 0600 — tokens are sensitive; restrict to owner only.
  writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function clearTokens(): void {
  if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE);
}

// ── PKCE helpers ───────────────────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

function generateCodeChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

// ── Spotify API calls ──────────────────────────────────────────────────────

async function exchangeCode(
  clientId: string,
  code: string,
  verifier: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: CALLBACK_URL,
    client_id: clientId,
    code_verifier: verifier,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

async function refreshAccessToken(
  clientId: string,
  refreshToken: string,
): Promise<{ accessToken: string; expiresIn: number; newRefreshToken?: string }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    newRefreshToken: data.refresh_token,
  };
}

// ── Track info ─────────────────────────────────────────────────────────────

export interface TrackInfo {
  title: string;
  artist: string;
  uri: string;  // e.g. "spotify:track:4cOdK2wGLETKBW3PvgPWqT"
  isPlaying: boolean;
}

async function fetchCurrentTrack(accessToken: string): Promise<TrackInfo | null> {
  const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // 204 = nothing playing; 401 = token expired (handled by caller)
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new Error(`Spotify API error: ${res.status}`);
  const data = (await res.json()) as {
    is_playing: boolean;
    item?: {
      name: string;
      uri: string;
      artists?: Array<{ name: string }>;
    };
  };
  if (!data.item) return null;
  return {
    title: data.item.name,
    artist: (data.item.artists ?? []).map((a) => a.name).join(", "),
    uri: data.item.uri,
    isPlaying: data.is_playing,
  };
}

// Fetch the Spotify Code scannable image for a track URI, convert it to a
// 128×64 1bpp frame, and return base64 ready for `SHOW image`.
// Spotify's scannables API is public and requires no auth.
// The code image is very wide (~4.84:1), so we stretch it to fill the OLED
// (fit: fill) — the bars are more legible tall than letterboxed tiny.
async function fetchSpotifyCodeImage(uri: string): Promise<string> {
  const url =
    `https://scannables.scdn.co/uri/plain/png/000000/ffffff/64/` +
    encodeURIComponent(uri);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Spotify code fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // dither:false — the code is already pure B&W; dithering would add noise.
  return bufferToFrameBase64(buf, { dither: false });
}

// ── Token manager (auto-refresh) ───────────────────────────────────────────

async function getValidAccessToken(): Promise<string> {
  const stored = loadTokens();
  if (!stored) {
    throw new Error("Not logged in. Run `gochi spotify login` first.");
  }
  // Refresh 60 s before expiry so we're never mid-poll when it expires.
  if (Date.now() < stored.expiresAt - 60_000) {
    return stored.accessToken;
  }
  const refreshed = await refreshAccessToken(stored.clientId, stored.refreshToken);
  const updated: TokenData = {
    clientId: stored.clientId,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.newRefreshToken ?? stored.refreshToken,
    expiresAt: Date.now() + refreshed.expiresIn * 1000,
  };
  saveTokens(updated);
  return updated.accessToken;
}

// ── Display helper ─────────────────────────────────────────────────────────

function trackToDisplayText(track: TrackInfo): string {
  // Keep it punchy — the OLED scrolls, but shorter is snappier.
  return `${track.title} - ${track.artist}`;
}

// ── Public commands ────────────────────────────────────────────────────────

// Kick off PKCE OAuth flow: open the browser, spin up a one-shot local
// HTTP server to capture the callback, exchange code for tokens.
export async function spotifyLogin(clientId: string): Promise<void> {
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = base64url(randomBytes(8));

  const authUrl =
    `https://accounts.spotify.com/authorize?` +
    new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      scope: SPOTIFY_SCOPES,
      redirect_uri: CALLBACK_URL,
      state,
      code_challenge_method: "S256",
      code_challenge: challenge,
    }).toString();

  console.log("\nOpening Spotify login in your browser…");
  console.log("If it doesn't open, visit this URL manually:\n");
  console.log(authUrl + "\n");

  // Best-effort browser open (macOS / Linux / Windows).
  const opener =
    process.platform === "darwin" ? "open" :
    process.platform === "win32" ? "start" : "xdg-open";
  exec(`${opener} "${authUrl}"`);

  // Spin up a one-shot local server on 127.0.0.1 to catch the callback.
  // If the auto-capture fails (e.g. browser doesn't redirect back),
  // we also print instructions for manual paste as a fallback.
  console.log(
    `\nWaiting for Spotify callback on ${CALLBACK_URL}` +
    `\nIf the browser doesn't redirect automatically, paste the full redirect URL below.\n`,
  );

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${CALLBACK_PORT}`);
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");

      if (error) {
        res.end("<h1>Login cancelled.</h1><p>You can close this tab.</p>");
        server.close();
        reject(new Error(`Spotify auth error: ${error}`));
        return;
      }
      if (returnedState !== state || !code) {
        res.end("<h1>Bad response.</h1><p>Please try again.</p>");
        server.close();
        reject(new Error("State mismatch or missing code — possible CSRF."));
        return;
      }

      res.end(`
        <html><body style="font-family:sans-serif;padding:2rem">
          <h1>✓ Gochi connected to Spotify!</h1>
          <p>You can close this tab and go back to your terminal.</p>
        </body></html>
      `);
      server.close();
      resolve(code);
    });

    // Bind to 127.0.0.1 only — not accessible from the network.
    server.listen(CALLBACK_PORT, "127.0.0.1");

    // Manual paste fallback: read from stdin in case the auto-redirect
    // doesn't fire (some browsers or corp proxies block loopback redirects).
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (raw: string) => {
      const input = raw.toString().trim();
      try {
        // Accept either a full URL or just the bare code.
        let extractedCode: string | null = null;
        let extractedState: string | null = null;
        if (input.startsWith("http")) {
          const u = new URL(input);
          extractedCode = u.searchParams.get("code");
          extractedState = u.searchParams.get("state");
        } else {
          // Bare code — skip state check.
          extractedCode = input;
          extractedState = state;
        }
        if (!extractedCode) {
          server.close();
          reject(new Error("No code found in pasted URL."));
          return;
        }
        if (extractedState !== null && extractedState !== state) {
          server.close();
          reject(new Error("State mismatch in pasted URL — possible CSRF."));
          return;
        }
        server.close();
        resolve(extractedCode);
      } catch {
        server.close();
        reject(new Error("Could not parse pasted URL."));
      }
    });

    // Time out after 5 minutes.
    setTimeout(() => {
      server.close();
      reject(new Error("Login timed out — no callback received within 5 minutes."));
    }, 300_000);
  });

  const tokens = await exchangeCode(clientId, code, verifier);
  saveTokens({
    clientId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
  });

  console.log("✓ Logged in! Tokens saved to ~/.tamagotchi/spotify.json");
}

export function spotifyLogout(): void {
  clearTokens();
  console.log("Logged out — Spotify tokens removed.");
}

// One-shot: fetch current track, print it, push to display.
export async function spotifyNow(): Promise<void> {
  const token = await getValidAccessToken();
  const track = await fetchCurrentTrack(token);

  if (!track) {
    console.log("Nothing is currently playing on Spotify.");
    return;
  }

  const text = trackToDisplayText(track);
  const status = track.isPlaying ? "▶" : "⏸";
  console.log(`${status}  ${text}`);
  // Try to show the Spotify Code image; fall back to scrolling text.
  const image = await fetchSpotifyCodeImage(track.uri).catch(() => null);
  if (image) {
    await client.image(image);
    await client.setSpotifyTrack(text, image);
  } else {
    await client.text(text);
    await client.setSpotifyTrack(text, null);
  }
}

// Polling loop: push track to display every POLL_INTERVAL_MS.
// Exits cleanly on Ctrl-C.
export async function spotifyWatch(): Promise<void> {
  console.log(`Watching Spotify… (updates every ${POLL_INTERVAL_MS / 1000}s, Ctrl-C to stop)\n`);

  let lastText = "";

  async function tick(): Promise<void> {
    try {
      const token = await getValidAccessToken();
      const track = await fetchCurrentTrack(token);

      if (!track) {
        if (lastText !== "") {
          console.log("— Nothing playing");
          await client.setSpotifyTrack(null);
          lastText = "";
        }
        return;
      }

      const text = trackToDisplayText(track);
      if (text !== lastText) {
        const status = track.isPlaying ? "▶" : "⏸";
        console.log(`${status}  ${text}`);
        // Try to show the Spotify Code image; fall back to scrolling text.
        const image = await fetchSpotifyCodeImage(track.uri).catch(() => null);
        if (image) {
          await client.image(image);
          await client.setSpotifyTrack(text, image);
        } else {
          await client.text(text);
          await client.setSpotifyTrack(text, null);
        }
        lastText = text;
      }
    } catch (e: any) {
      console.error("Spotify error:", e?.message ?? e);
    }
  }

  // Run once immediately, then on interval.
  await tick();
  const handle = setInterval(() => void tick(), POLL_INTERVAL_MS);

  // Clean shutdown on Ctrl-C.
  process.on("SIGINT", () => {
    clearInterval(handle);
    // Clear the daemon state so the VS Code extension heartbeat can resume
    // showing the project/state label immediately.
    void client.setSpotifyTrack(null).finally(() => {
      console.log("\nStopped.");
      process.exit(0);
    });
  });

  // Keep the process alive.
  await new Promise<void>(() => {});
}
