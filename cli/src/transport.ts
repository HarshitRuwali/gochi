// transport.ts — wraps a serial port with the pet's line-based protocol.

import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { EventEmitter } from "node:events";

const BAUD = 115200;

// SerialTransport owns one open serial connection. send() writes a
// newline-terminated line and resolves with the next response line, or
// null on timeout. Lines that look like the device's boot banner are
// skipped so a fresh connection doesn't return the banner as a response.
export class SerialTransport extends EventEmitter {
  private port: SerialPort | null = null;
  private parser: ReadlineParser | null = null;
  private opened = false;
  private bufferedLines: string[] = [];

  constructor(readonly path: string) {
    super();
  }

  isOpen(): boolean {
    return this.opened;
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const port = new SerialPort({ path: this.path, baudRate: BAUD, autoOpen: false });
      this.port = port;
      port.open((err: Error | null) => {
        if (err) return reject(err);
        this.opened = true;
        this.parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));
        this.parser.on("data", (line: string) => {
          this.bufferedLines.push(line.replace(/\r$/, ""));
          this.emit("line", line);
        });
        port.on("close", () => {
          this.opened = false;
          this.emit("close");
        });
        port.on("error", (e: Error) => this.emit("error", e));
        resolve();
      });
    });
  }

  // Send `line` and resolve with the first non-banner response line.
  // Resolves to null on timeout.
  async send(line: string, timeoutMs = 1500): Promise<string | null> {
    if (!this.opened || !this.port || !this.parser) throw new Error("not open");
    // Drain any stale buffered lines before we wait.
    this.bufferedLines.length = 0;
    return new Promise<string | null>((resolve) => {
      const onLine = (raw: string) => {
        const r = raw.replace(/\r$/, "");
        if (isBanner(r)) return;  // boot banner; keep waiting
        cleanup();
        resolve(r);
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.parser?.off("data", onLine);
      };
      this.parser!.on("data", onLine);
      this.port!.write(line + "\n");
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.port) return resolve();
      this.port.close(() => {
        this.opened = false;
        resolve();
      });
    });
  }
}

function isBanner(line: string): boolean {
  // The firmware prints a banner like "Tamagotchi ready (Free Mode). ..."
  // on connect — distinguish it from real responses.
  return line.startsWith("Tamagotchi ");
}
