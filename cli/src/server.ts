// server.ts — HTTP API in front of the serial transport (Node http).
//
// The server owns the serial port (one process can have it open at a
// time). Every command endpoint returns HTTP 200 so AI agents don't see
// errors for a missing pet — `connected: false` signals it and the
// request is dropped silently.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { findDevice } from "./discovery";
import { SerialTransport } from "./transport";

export const SERVER_PORT = Number(process.env.TAMAGOTCHI_PORT) || 7474;
export const SERVER_VERSION = "0.1.0";

class Device {
  private transport: SerialTransport | null = null;
  private path: string | null = null;
  private connecting = false;

  isConnected(): boolean {
    return !!this.transport?.isOpen();
  }
  port(): string | null {
    return this.path;
  }

  async connect(): Promise<void> {
    if (this.connecting || this.isConnected()) return;
    this.connecting = true;
    try {
      const found = await findDevice();
      if (!found) return;
      const t = new SerialTransport(found);
      await t.open();
      t.on("close", () => {
        log(`disconnected (${this.path})`);
        this.transport = null;
        this.path = null;
      });
      t.on("error", (e: Error) => log("serial error:", e.message));
      this.transport = t;
      this.path = found;
      log(`connected to ${found}`);
    } catch (e: any) {
      log("connect failed:", e?.message || e);
      this.transport = null;
      this.path = null;
    } finally {
      this.connecting = false;
    }
  }

  async send(line: string): Promise<string | null> {
    if (!this.isConnected()) return null;
    try {
      return await this.transport!.send(line);
    } catch (e: any) {
      log("send failed:", e?.message || e);
      return null;
    }
  }
}

function log(...args: unknown[]): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}]`, ...args);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    const raw = await readBody(req);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function send(res: ServerResponse, data: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data, null, 2) + "\n");
}

export async function runServer(): Promise<void> {
  const device = new Device();
  await device.connect();
  setInterval(() => device.connect(), 5000);

  const sendCmd = async (res: ServerResponse, line: string): Promise<void> => {
    if (!device.isConnected()) {
      return send(res, {
        ok: true,
        connected: false,
        message: "device offline; request ignored",
      });
    }
    const response = await device.send(line);
    if (response === null) {
      return send(res, {
        ok: false,
        connected: device.isConnected(),
        message: "no response from device",
      });
    }
    send(res, { ok: true, connected: true, response });
  };

  const http = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || "/";
    const path = url.split("?")[0];
    const method = req.method || "GET";

    try {
      // --- Health -----------------------------------------------------
      if (method === "GET" && path === "/health") {
        return send(res, {
          ok: true,
          connected: device.isConnected(),
          port: device.port(),
          version: SERVER_VERSION,
        });
      }

      // --- Command endpoints -----------------------------------------
      if (method === "POST" && path === "/face") {
        const body = await readJson(req);
        const name = body?.name;
        if (typeof name !== "string" || !name) {
          return send(res, { ok: false, connected: device.isConnected(), message: "missing name" });
        }
        return sendCmd(res, `SHOW face ${name}`);
      }
      if (method === "POST" && path === "/text") {
        const body = await readJson(req);
        const text = (body?.text ?? "") as string;
        if (typeof text !== "string") {
          return send(res, { ok: false, connected: device.isConnected(), message: "invalid text" });
        }
        return sendCmd(res, `SHOW text ${text}`);
      }
      if (method === "POST" && path === "/mood") {
        const body = await readJson(req);
        const name = body?.name;
        if (typeof name !== "string" || !name) {
          return send(res, { ok: false, connected: device.isConnected(), message: "missing name" });
        }
        return sendCmd(res, `SET mood ${name}`);
      }
      if (method === "GET" && path === "/state") return sendCmd(res, "GET state");
      if (method === "GET" && path === "/fps") return sendCmd(res, "GET fps");
      if (method === "GET" && path === "/faces") return sendCmd(res, "LIST faces");
      if (method === "POST" && path === "/ping") return sendCmd(res, "PING");

      send(res, { ok: false, message: "not found" }, 404);
    } catch (e: any) {
      send(res, { ok: false, connected: device.isConnected(), message: e?.message || String(e) });
    }
  });

  http.listen(SERVER_PORT, () => {
    log(`Tamagotchi server listening on http://localhost:${SERVER_PORT}`);
  });
}
