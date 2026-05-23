// discovery.ts — find the connected Tamagotchi by PINGing candidate ports.

import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";

// USB VID for Espressif's native CDC (ESP32-S2/S3/C3 with CDCOnBoot).
const ESPRESSIF_VID = "303a";

// Returns the device path (e.g. /dev/cu.usbmodem101) of a connected pet,
// or null if none found.
export async function findDevice(): Promise<string | null> {
  const ports = await SerialPort.list();
  // On macOS SerialPort.list returns /dev/tty.* (blocking, waits for
  // carrier on open); we want /dev/cu.* (non-blocking call-up device).
  const isMac = process.platform === "darwin";
  const normalize = (p: string) =>
    isMac && p.startsWith("/dev/tty.") ? p.replace("/dev/tty.", "/dev/cu.") : p;

  // Best candidates first: Espressif VID; then anything that looks like a
  // USB-CDC / USB-serial path. Filter out obvious noise (Bluetooth, debug).
  const score = (p: any) => {
    const path = p.path || "";
    if (/Bluetooth|debug-console/i.test(path)) return -1;
    if ((p.vendorId || "").toLowerCase() === ESPRESSIF_VID) return 2;
    if (/usbmodem|ttyACM|ttyUSB|usbserial/i.test(path)) return 1;
    return 0;
  };
  const candidates = ports
    .map((p) => ({ ...p, _score: score(p), _path: normalize(p.path || "") }))
    .filter((p) => p._score >= 0)
    .sort((a, b) => b._score - a._score);

  for (const c of candidates) {
    console.log(`[discovery] trying ${c._path} (vid=${c.vendorId || "-"})`);
    if (await tryHandshake(c._path)) {
      console.log(`[discovery] handshake ok on ${c._path}`);
      return c._path;
    }
  }
  if (candidates.length === 0) {
    console.log("[discovery] no candidate serial ports");
  } else {
    console.log("[discovery] no port responded to PING");
  }
  return null;
}

// Open the port briefly, send PING, listen for PONG.
function tryHandshake(path: string, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    let port: SerialPort | null = null;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try {
        port?.close(() => {});
      } catch {}
      resolve(ok);
    };
    try {
      port = new SerialPort({ path, baudRate: 115200, autoOpen: false });
    } catch {
      return finish(false);
    }
    port.on("error", () => finish(false));
    port.open((err: Error | null) => {
      if (err) return finish(false);
      const parser = port!.pipe(new ReadlineParser({ delimiter: "\n" }));
      const timer = setTimeout(() => finish(false), timeoutMs);
      parser.on("data", (line: string) => {
        if (line.trim() === "PONG") {
          clearTimeout(timer);
          finish(true);
        }
      });
      // Slight delay so the port settles before we write.
      setTimeout(() => port!.write("PING\n"), 50);
    });
  });
}
