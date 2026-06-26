// transport_interface.ts — common interface for Serial and BLE transports.

import { EventEmitter } from "node:events";

// Common interface for both SerialTransport and BLETransport so the
// daemon can manage either type without caring which one it is.
export interface ITransport extends EventEmitter {
  isOpen(): boolean;
  open(): Promise<void>;
  send(line: string, timeoutMs?: number): Promise<string | null>;
  close(): Promise<void>;
}
