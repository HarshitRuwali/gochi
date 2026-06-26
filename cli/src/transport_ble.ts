// transport_ble.ts — BLE transport for Gochi device communication.

import { EventEmitter } from "node:events";
import { createBluetooth } from "node-ble";

const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const CHAR_TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // Device → Client (notify)
const CHAR_RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // Client → Device (write)

// BLETransport connects to a Gochi device over BLE using the Nordic UART
// Service. It provides the same API as SerialTransport for compatibility.
export class BLETransport extends EventEmitter {
  private device: any = null;
  private gattServer: any = null;
  private rxChar: any = null;
  private txChar: any = null;
  private connected = false;
  private lineBuffer = "";
  private bluetooth: any = null;
  private adapter: any = null;

  constructor(readonly deviceId: string) {
    super();
  }

  isOpen(): boolean {
    return this.connected;
  }

  async open(): Promise<void> {
    try {
      const { bluetooth, destroy } = createBluetooth();
      this.bluetooth = { bluetooth, destroy };
      this.adapter = await bluetooth.defaultAdapter();
      
      if (! await this.adapter.isDiscovering()) {
        await this.adapter.startDiscovery();
      }

      // Wait a bit for discovery
      await new Promise(resolve => setTimeout(resolve, 2000));

      const devices = await this.adapter.devices();
      let targetDevice = null;

      for (const deviceAddr of devices) {
        const device = await this.adapter.getDevice(deviceAddr);
        const name = await device.getName().catch(() => "");
        
        if (name.startsWith(this.deviceId) || deviceAddr === this.deviceId) {
          targetDevice = device;
          break;
        }
      }

      await this.adapter.stopDiscovery();

      if (!targetDevice) {
        throw new Error(`Device ${this.deviceId} not found`);
      }

      this.device = targetDevice;
      await this.connectAndSetup();
      this.connected = true;
    } catch (err: any) {
      if (this.adapter) {
        await this.adapter.stopDiscovery().catch(() => {});
      }
      throw new Error(`BLE connection failed: ${err.message}`);
    }
  }

  private async connectAndSetup(): Promise<void> {
    if (!this.device) throw new Error("No device");

    await this.device.connect();
    this.gattServer = await this.device.gatt();

    const service = await this.gattServer.getPrimaryService(SERVICE_UUID);
    
    this.txChar = await service.getCharacteristic(CHAR_TX_UUID);
    this.rxChar = await service.getCharacteristic(CHAR_RX_UUID);

    if (!this.txChar || !this.rxChar) {
      throw new Error("Required BLE characteristics not found");
    }

    // Subscribe to TX characteristic (device notifications).
    await this.txChar.startNotifications();
    this.txChar.on("valuechanged", (data: Buffer) => {
      const text = data.toString("utf-8");
      this.lineBuffer += text;
      
      // Emit complete lines.
      let newlineIndex;
      while ((newlineIndex = this.lineBuffer.indexOf("\n")) >= 0) {
        const line = this.lineBuffer.substring(0, newlineIndex).replace(/\r$/, "");
        this.lineBuffer = this.lineBuffer.substring(newlineIndex + 1);
        this.emit("line", line);
      }
    });

    this.device.on("disconnect", () => {
      this.connected = false;
      this.emit("close");
    });
  }

  async send(line: string, timeoutMs = 1500): Promise<string | null> {
    if (!this.connected || !this.rxChar) throw new Error("not open");

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
        this.off("line", onLine);
      };

      this.on("line", onLine);
      
      // Write to RX characteristic (client → device).
      const data = Buffer.from(line + "\n", "utf-8");
      this.rxChar.writeValue(data).catch(() => {
        cleanup();
        resolve(null);
      });
    });
  }

  async close(): Promise<void> {
    if (this.device && this.connected) {
      await this.device.disconnect().catch(() => {});
      this.connected = false;
    }
    if (this.bluetooth) {
      this.bluetooth.destroy();
    }
  }
}

function isBanner(line: string): boolean {
  return line.startsWith("Tamagotchi ");
}

// Discover nearby Gochi devices advertising the Nordic UART Service.
export async function discoverDevices(timeoutMs = 5000): Promise<Array<{ name: string; address: string }>> {
  const { bluetooth, destroy } = createBluetooth();
  
  try {
    const adapter = await bluetooth.defaultAdapter();
    
    if (! await adapter.isDiscovering()) {
      await adapter.startDiscovery();
    }

    // Wait for discovery
    await new Promise(resolve => setTimeout(resolve, timeoutMs));

    await adapter.stopDiscovery();

    const devices = await adapter.devices();
    const results: Array<{ name: string; address: string }> = [];

    for (const deviceAddr of devices) {
      const device = await adapter.getDevice(deviceAddr);
      const name = await device.getName().catch(() => "");
      
      // Only include devices that look like Gochi devices.
      if (name.startsWith("Gochi-")) {
        results.push({ name, address: deviceAddr });
      }
    }

    destroy();
    return results;
  } catch (err: any) {
    destroy();
    throw new Error(`BLE scan failed: ${err.message}`);
  }
}

