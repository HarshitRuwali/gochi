"use strict";
// watcher.ts — VS Code activity → Gochi status state machine.
//
// Detected states and what triggers them:
//
//   available    — default; also restored after debugging / errors clear
//   deep-focus   — sustained typing for N seconds (no debug, no spike)
//   thinking     — a debug session is active
//   frustrated   — N new errors vs baseline, OR a task/build exits non-zero
//   away         — no keyboard / editor activity for N minutes
//
// Priority (highest wins when multiple signals fire at once):
//   thinking > frustrated > deep-focus > available > away
//
// Manual override: if the user calls `gochi status` from the CLI or the
// command palette, the watcher backs off for `manualOverrideMinutes` so
// it doesn't immediately override what was chosen.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActivityWatcher = exports.STATE_LABEL = void 0;
const vscode = __importStar(require("vscode"));
// Human-readable label shown in the status bar.
exports.STATE_LABEL = {
    available: "$(smiley) Available",
    "deep-focus": "$(eye) Deep Focus",
    thinking: "$(bug) Thinking",
    frustrated: "$(warning) Frustrated",
    away: "$(clock) Away",
};
// Short text sent to the OLED display (used when a project label is set).
const STATE_TEXT = {
    available: "Available",
    "deep-focus": "Deep Focus",
    thinking: "Thinking...",
    frustrated: "Frustrated",
    away: "Away",
};
class ActivityWatcher {
    client;
    onStateChange;
    state = "available";
    // State before debugging started — restored when the debug session ends.
    preDebugState = "available";
    debugDepth = 0;
    // Baseline error count. We only care about *increases* above this.
    errorBaseline = 0;
    // Don't auto-update while manual override is active.
    manualOverrideUntil = 0;
    // Project label prefixed to every display message (e.g. "Alpha").
    projectLabel_ = "";
    idleHandle = null;
    focusHandle = null;
    refreshHandle = null;
    subscriptions = [];
    constructor(client, onStateChange) {
        this.client = client;
        this.onStateChange = onStateChange;
        this.subscribe();
        // Seed the baseline so a pre-existing red squiggle sea doesn't
        // immediately slam the pet into "frustrated" on extension startup.
        this.errorBaseline = this.countErrors();
        // Kick off the idle timer from the start.
        this.resetIdleTimer();
        // Periodic heartbeat: re-push the current display text every 30 s so it
        // stays visible even if the daemon restarted or another source overwrote it.
        this.refreshHandle = setInterval(() => void this.refreshDisplay(), 30_000);
    }
    // ── Public API ────────────────────────────────────────────────────────
    currentState() {
        return this.state;
    }
    // Called when the user manually sets a status — back off for a while.
    notifyManualOverride() {
        const mins = this.cfg().manualOverrideMinutes;
        this.manualOverrideUntil = Date.now() + mins * 60_000;
    }
    // True while a manual override is suppressing auto-transitions.
    isManualOverrideActive() {
        return this.isManualOverride();
    }
    // How many minutes remain in the manual override (0 if not active).
    manualOverrideRemainingMinutes() {
        const remaining = this.manualOverrideUntil - Date.now();
        return remaining > 0 ? Math.ceil(remaining / 60_000) : 0;
    }
    // Cancel an active manual override and resume auto-tracking immediately.
    clearManualOverride() {
        this.manualOverrideUntil = 0;
    }
    // Set (or clear) the project label shown as a prefix on the OLED display.
    // Pass an empty string to disable project context.
    setProjectLabel(label) {
        this.projectLabel_ = label.trim();
    }
    projectLabel() {
        return this.projectLabel_;
    }
    dispose() {
        this.clearIdleTimer();
        this.clearFocusTimer();
        if (this.refreshHandle !== null) {
            clearInterval(this.refreshHandle);
            this.refreshHandle = null;
        }
        for (const s of this.subscriptions)
            s.dispose();
    }
    // ── VS Code event subscriptions ───────────────────────────────────────
    subscribe() {
        this.subscriptions.push(
        // Typing / editing
        vscode.workspace.onDidChangeTextDocument(() => this.onActivity()), 
        // Switching files (lighter signal — prevents going `away` when browsing)
        vscode.window.onDidChangeActiveTextEditor(() => this.onBrowse()), 
        // Debug sessions
        vscode.debug.onDidStartDebugSession(() => this.onDebugStart()), vscode.debug.onDidTerminateDebugSession(() => this.onDebugEnd()), 
        // Build / test tasks
        vscode.tasks.onDidEndTaskProcess((e) => this.onTaskEnd(e.exitCode ?? 1)), 
        // Diagnostics (errors / warnings)
        vscode.languages.onDidChangeDiagnostics(() => this.onDiagnosticsChanged()));
    }
    // ── Signal handlers ───────────────────────────────────────────────────
    onActivity() {
        this.resetIdleTimer();
        if (this.state === "away") {
            // Any keystroke wakes us back up immediately.
            void this.transition("available");
            return;
        }
        if (this.state === "available") {
            // Start the focus delay — sustained typing escalates to deep-focus.
            this.scheduleFocusTimer();
        }
    }
    // Browsing files (no edit) — resets idle but doesn't start focus timer.
    onBrowse() {
        this.resetIdleTimer();
        if (this.state === "away") {
            void this.transition("available");
        }
    }
    onDebugStart() {
        this.debugDepth++;
        if (this.debugDepth === 1) {
            // Save where we were so we can restore it when the session ends.
            this.preDebugState =
                this.state === "away" ? "available" : this.state;
            this.clearFocusTimer();
            void this.transition("thinking");
        }
    }
    onDebugEnd() {
        this.debugDepth = Math.max(0, this.debugDepth - 1);
        if (this.debugDepth === 0) {
            // Return to where we were before debugging (or available if it was away).
            void this.transition(this.preDebugState === "away" ? "available" : this.preDebugState);
        }
    }
    onTaskEnd(exitCode) {
        if (exitCode !== 0) {
            void this.transition("frustrated");
        }
        else if (this.state === "frustrated") {
            // Build went green — cheer up.
            void this.transition("available");
        }
    }
    onDiagnosticsChanged() {
        const errors = this.countErrors();
        const delta = errors - this.errorBaseline;
        if (delta >= this.cfg().errorThreshold) {
            void this.transition("frustrated");
        }
        else if (errors === 0 && this.state === "frustrated") {
            // All errors resolved — clear the baseline and recover.
            this.errorBaseline = 0;
            void this.transition("available");
        }
        // Ratchet the baseline downward so clearing errors is detectable, but
        // never upward — we want to catch a spike, not a slow creep.
        if (errors < this.errorBaseline)
            this.errorBaseline = errors;
    }
    // ── Timers ─────────────────────────────────────────────────────────────
    scheduleFocusTimer() {
        // Already scheduled or already in a focused/higher-priority state.
        if (this.focusHandle !== null)
            return;
        if (this.state !== "available")
            return;
        const ms = this.cfg().focusDelaySeconds * 1000;
        this.focusHandle = setTimeout(() => {
            this.focusHandle = null;
            if (this.state === "available") {
                void this.transition("deep-focus");
            }
        }, ms);
    }
    clearFocusTimer() {
        if (this.focusHandle !== null) {
            clearTimeout(this.focusHandle);
            this.focusHandle = null;
        }
    }
    resetIdleTimer() {
        this.clearIdleTimer();
        const ms = this.cfg().idleTimeoutMinutes * 60_000;
        this.idleHandle = setTimeout(() => {
            this.idleHandle = null;
            this.clearFocusTimer();
            void this.transition("away");
        }, ms);
    }
    clearIdleTimer() {
        if (this.idleHandle !== null) {
            clearTimeout(this.idleHandle);
            this.idleHandle = null;
        }
    }
    // ── Helpers ────────────────────────────────────────────────────────────
    countErrors() {
        let n = 0;
        for (const [, diags] of vscode.languages.getDiagnostics()) {
            n += diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;
        }
        return n;
    }
    cfg() {
        const c = vscode.workspace.getConfiguration("gochi");
        return {
            enabled: c.get("autoMode.enabled", true),
            idleTimeoutMinutes: c.get("autoMode.idleTimeoutMinutes", 5),
            focusDelaySeconds: c.get("autoMode.focusDelaySeconds", 45),
            errorThreshold: c.get("autoMode.errorThreshold", 5),
            manualOverrideMinutes: c.get("autoMode.manualOverrideMinutes", 30),
        };
    }
    isManualOverride() {
        return Date.now() < this.manualOverrideUntil;
    }
    async transition(next) {
        if (next === this.state)
            return;
        if (!this.cfg().enabled)
            return;
        if (this.isManualOverride())
            return;
        this.state = next;
        this.onStateChange(next);
        await this.client.setStatus(next);
        // If a project label is set, overlay the display with "Project | State"
        // so the pet always identifies both the active project and the state.
        if (this.projectLabel_) {
            const text = `${this.projectLabel_} | ${STATE_TEXT[next]}`;
            await this.client.setText(text);
        }
    }
    // Re-push the current display text without changing state.  Called by the
    // heartbeat interval so the label stays visible even if the daemon restarted
    // or another source (CLI) temporarily overwrote the display.
    // Spotify takes priority: if a track is playing, its code image (or text
    // fallback) is re-pushed instead of the project/state label.
    async refreshDisplay() {
        if (!this.cfg().enabled)
            return;
        if (this.isManualOverride())
            return;
        // Prefer Spotify "now playing" when the user has it running.
        const spotify = await this.client.getSpotifyTrack();
        if (spotify) {
            if (spotify.image) {
                await this.client.setImage(spotify.image);
            }
            else if (spotify.track) {
                await this.client.setText(spotify.track);
            }
            return;
        }
        if (!this.projectLabel_)
            return;
        const text = `${this.projectLabel_} | ${STATE_TEXT[this.state]}`;
        await this.client.setText(text);
    }
}
exports.ActivityWatcher = ActivityWatcher;
//# sourceMappingURL=watcher.js.map