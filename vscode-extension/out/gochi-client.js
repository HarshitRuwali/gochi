"use strict";
// gochi-client.ts — thin HTTP client for the Gochi HTTP frontend.
// Talks to the TCP server started by `gochi server enable` (default :7474).
// All calls are fire-and-forget safe: they swallow network errors so a
// disconnected device or disabled frontend never crashes the extension.
Object.defineProperty(exports, "__esModule", { value: true });
exports.GochiClient = void 0;
class GochiClient {
    baseUrl;
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this.baseUrl = baseUrl.replace(/\/$/, "");
    }
    async health() {
        try {
            const res = await fetch(`${this.baseUrl}/health`, {
                signal: AbortSignal.timeout(2000),
            });
            return (await res.json());
        }
        catch {
            return null;
        }
    }
    // Apply a named availability-status profile (face + mood + optional text).
    async setStatus(name) {
        try {
            const res = await fetch(`${this.baseUrl}/status`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
                signal: AbortSignal.timeout(3000),
            });
            const data = (await res.json());
            return data.ok === true;
        }
        catch {
            return false;
        }
    }
    // Show arbitrary scrolling text on the display.
    async setText(text) {
        try {
            const res = await fetch(`${this.baseUrl}/text`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text }),
                signal: AbortSignal.timeout(3000),
            });
            const data = (await res.json());
            return data.ok === true;
        }
        catch {
            return false;
        }
    }
    // Send a 128×64 1bpp frame (base64) to the display via SHOW image.
    async setImage(data) {
        try {
            const res = await fetch(`${this.baseUrl}/image`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ data }),
                signal: AbortSignal.timeout(3000),
            });
            const json = (await res.json());
            return json.ok === true;
        }
        catch {
            return false;
        }
    }
    // Return the current Spotify "now playing" state stored in the daemon,
    // or null if nothing is playing / Spotify watch is not running.
    async getSpotifyTrack() {
        try {
            const res = await fetch(`${this.baseUrl}/spotify/track`, {
                signal: AbortSignal.timeout(2000),
            });
            const data = (await res.json());
            if (!data.ok)
                return null;
            return {
                track: typeof data.track === "string" ? data.track : null,
                image: typeof data.image === "string" ? data.image : null,
            };
        }
        catch {
            return null;
        }
    }
}
exports.GochiClient = GochiClient;
//# sourceMappingURL=gochi-client.js.map