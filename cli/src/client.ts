// client.ts — the CLI's HTTP client (talks to the local server).

import { SERVER_PORT } from "./server";

const BASE = process.env.TAMAGOTCHI_URL || `http://localhost:${SERVER_PORT}`;

export type Result = {
  ok: boolean;
  connected?: boolean;
  response?: unknown;
  message?: string;
  [k: string]: unknown;
};

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<Result> {
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return (await res.json()) as Result;
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (/ECONNREFUSED|ConnectionRefused|fetch failed|Connection refused|Unable to connect/i.test(msg)) {
      console.error(
        `Could not reach the Tamagotchi server at ${BASE}.\n` +
          "Start it with: tamagotchi server start (or `tamagotchi server install` for auto-start)",
      );
      process.exit(1);
    }
    throw e;
  }
}

export const health = () => call("GET", "/health");
export const face = (name: string) => call("POST", "/face", { name });
export const text = (s: string) => call("POST", "/text", { text: s });
export const mood = (name: string) => call("POST", "/mood", { name });
// `data` is a base64-encoded 128x64 1bpp bitmap (1024 bytes raw, MSB-first).
export const image = (data: string) => call("POST", "/image", { data });
export const state = () => call("GET", "/state");
export const fps = () => call("GET", "/fps");
export const faces = () => call("GET", "/faces");
export const ping = () => call("POST", "/ping");
