// gochi-client.ts — thin HTTP client for the Gochi HTTP frontend.
// Talks to the TCP server started by `gochi server enable` (default :7474).
// All calls are fire-and-forget safe: they swallow network errors so a
// disconnected device or disabled frontend never crashes the extension.

export interface HealthResult {
  ok: boolean;
  connected: boolean;
  port?: string;
  version?: string;
}

export class GochiClient {
  constructor(private baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async health(): Promise<HealthResult | null> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return (await res.json()) as HealthResult;
    } catch {
      return null;
    }
  }

  // Apply a named availability-status profile (face + mood + optional text).
  async setStatus(name: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
        signal: AbortSignal.timeout(3000),
      });
      const data = (await res.json()) as { ok: boolean };
      return data.ok === true;
    } catch {
      return false;
    }
  }

  // Show arbitrary scrolling text on the display.
  async setText(text: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(3000),
      });
      const data = (await res.json()) as { ok: boolean };
      return data.ok === true;
    } catch {
      return false;
    }
  }

  // Send a 128×64 1bpp frame (base64) to the display via SHOW image.
  async setImage(data: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
        signal: AbortSignal.timeout(3000),
      });
      const json = (await res.json()) as { ok: boolean };
      return json.ok === true;
    } catch {
      return false;
    }
  }

  // Return the current Spotify "now playing" state stored in the daemon,
  // or null if nothing is playing / Spotify watch is not running.
  async getSpotifyTrack(): Promise<{ track: string | null; image: string | null } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/spotify/track`, {
        signal: AbortSignal.timeout(2000),
      });
      const data = (await res.json()) as {
        ok: boolean;
        track?: string | null;
        image?: string | null;
      };
      if (!data.ok) return null;
      return {
        track: typeof data.track === "string" ? data.track : null,
        image: typeof data.image === "string" ? data.image : null,
      };
    } catch {
      return null;
    }
  }
}
