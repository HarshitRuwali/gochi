// extension.ts — VS Code extension entry point for Gochi Activity Watcher.
//
// Activates on startup (onStartupFinished) and:
//   1. Creates an HTTP client for the Gochi daemon's HTTP frontend.
//   2. Starts the ActivityWatcher (event subscriptions + state machine).
//   3. Shows a status-bar item reflecting the current auto-detected state.
//   4. Registers two commands:
//        gochi.toggleAutoMode — enable / disable auto updates
//        gochi.setStatus      — manually pick a status (pauses auto for 30 min)

import * as vscode from "vscode";

import { GochiClient } from "./gochi-client.js";
import { ActivityWatcher, STATE_LABEL, type WatcherState } from "./watcher.js";

// All available status names (mirrors cli/src/status.ts — kept in sync manually).
const STATUS_NAMES: Array<{ label: string; name: string; description: string }> =
  [
    { name: "available",      label: "Available",       description: "Free to chat and collaborate" },
    { name: "busy",           label: "Busy",            description: "Working — keep interruptions to a minimum" },
    { name: "in-meeting",     label: "In Meeting",      description: "Currently in a meeting" },
    { name: "deep-focus",     label: "Deep Focus",      description: "Flow state — please don't interrupt" },
    { name: "frustrated",     label: "Frustrated",      description: "Hitting blockers or feeling stressed" },
    { name: "on-break",       label: "On Break",        description: "Coffee or lunch — back soon" },
    { name: "away",           label: "Away",            description: "Stepped away from my desk" },
    { name: "do-not-disturb", label: "Do Not Disturb",  description: "Absolute focus — hold all messages" },
    { name: "reviewing",      label: "Reviewing",       description: "In a code or document review" },
    { name: "thinking",       label: "Thinking",        description: "Problem-solving mode" },
  ];

export function activate(context: vscode.ExtensionContext): void {
  const url = vscode.workspace
    .getConfiguration("gochi")
    .get<string>("daemonUrl", "http://localhost:7474");

  const client = new GochiClient(url);

  // Resolve the project label: explicit setting takes priority, then the
  // workspace folder name, then empty (no overlay).
  function resolveProjectLabel(): string {
    const cfg = vscode.workspace
      .getConfiguration("gochi")
      .get<string>("projectLabel", "");
    if (cfg.trim()) return cfg.trim();
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) return folders[0].name;
    return "";
  }

  // Status-bar item — click it to quickly pick a status.
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    50,
  );
  statusBar.command = "gochi.setStatus";
  statusBar.tooltip = "Gochi desk pet status (click to set manually)";
  context.subscriptions.push(statusBar);

  function updateStatusBar(state: WatcherState): void {
    const enabled = vscode.workspace
      .getConfiguration("gochi")
      .get<boolean>("autoMode.enabled", true);
    if (!enabled) {
      statusBar.text = "$(circle-slash) Gochi (paused)";
      statusBar.tooltip = "Auto-mode disabled — click to set status";
    } else if (watcher.isManualOverrideActive()) {
      const mins = watcher.manualOverrideRemainingMinutes();
      statusBar.text = `$(lock) ${STATE_LABEL[state].replace(/^\$\([^)]+\) /, "")} (manual, ${mins}m)`;
      statusBar.tooltip = "Manual override active — click to resume auto-mode or pick a new status";
    } else {
      statusBar.text = STATE_LABEL[state];
      statusBar.tooltip = "Gochi auto-mode active — click to set status manually";
    }
    statusBar.show();
  }

  const watcher = new ActivityWatcher(client, (state) => {
    updateStatusBar(state);
  });
  context.subscriptions.push(watcher);

  // Seed project label from config / workspace folder.
  watcher.setProjectLabel(resolveProjectLabel());

  // Show initial state.
  updateStatusBar(watcher.currentState());

  // Ping the daemon once so the user sees a warning if it isn't reachable.
  void client.health().then((h) => {
    if (h === null) {
      vscode.window.showWarningMessage(
        "Gochi: cannot reach the HTTP frontend. Run `gochi server enable` in your terminal.",
        "Dismiss",
      );
    } else if (!h.connected) {
      vscode.window.showInformationMessage(
        "Gochi: daemon is running but the device is not connected.",
      );
    }
  });

  // ── Commands ──────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand("gochi.toggleAutoMode", () => {
      const cfg = vscode.workspace.getConfiguration("gochi");
      const current = cfg.get<boolean>("autoMode.enabled", true);
      void cfg
        .update("autoMode.enabled", !current, vscode.ConfigurationTarget.Global)
        .then(() => {
          const nowEnabled = !current;
          updateStatusBar(watcher.currentState());
          vscode.window.showInformationMessage(
            nowEnabled
              ? "Gochi auto-mode enabled — the pet now mirrors your activity."
              : "Gochi auto-mode paused — use `Gochi: Set Status` to update manually.",
          );
        });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("gochi.setStatus", async () => {
      // If override is active, offer a quick "resume" shortcut at the top.
      if (watcher.isManualOverrideActive()) {
        const mins = watcher.manualOverrideRemainingMinutes();
        const resume = await vscode.window.showQuickPick(
          [
            { label: "$(play) Resume auto-mode", description: `Cancel the ${mins}m manual lock`, value: "__resume__" },
            { label: "$(edit) Set a different status…", description: "Pick a new status (resets the timer)", value: "__pick__" },
          ],
          { title: `Gochi — manual override active (${mins}m left)`, placeHolder: "" },
        );
        if (!resume) return;
        if (resume.value === "__resume__") {
          watcher.clearManualOverride();
          updateStatusBar(watcher.currentState());
          vscode.window.showInformationMessage("Gochi: auto-mode resumed.");
          return;
        }
        // fall through to the full picker below
      }

      const picked = await vscode.window.showQuickPick(
        STATUS_NAMES.map((s) => ({
          label: s.label,
          description: s.description,
          detail: s.name,  // shown as small text, also used as the API slug
        })),
        {
          title: "Set Gochi Status",
          placeHolder: "Choose your current availability…",
          matchOnDescription: true,
        },
      );

      if (!picked) return; // user cancelled

      const ok = await client.setStatus(picked.detail!);
      if (ok) {
        watcher.notifyManualOverride();
        // If a project label is active, follow the status with a project overlay.
        const label = watcher.projectLabel();
        if (label) {
          await client.setText(`${label} | ${picked.label}`);
        }
        statusBar.text = `$(check) ${picked.label}`;
        const mins = vscode.workspace
          .getConfiguration("gochi")
          .get<number>("autoMode.manualOverrideMinutes", 30);
        setTimeout(() => updateStatusBar(watcher.currentState()), 2000);
        const choice = await vscode.window.showInformationMessage(
          `Gochi: status set to "${picked.label}". Auto-mode paused for ${mins} min.`,
          "Resume Auto",
        );
        if (choice === "Resume Auto") {
          watcher.clearManualOverride();
          updateStatusBar(watcher.currentState());
        }
      } else {
        vscode.window.showErrorMessage(
          "Gochi: failed to set status — is the HTTP frontend running? (`gochi server enable`)",
        );
      }
    }),
  );

  // React to config changes (e.g. user toggling autoMode from settings UI).
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("gochi.autoMode.enabled")) {
        updateStatusBar(watcher.currentState());
      }
      if (e.affectsConfiguration("gochi.projectLabel")) {
        watcher.setProjectLabel(resolveProjectLabel());
      }
      if (e.affectsConfiguration("gochi.daemonUrl")) {
        // Restart with the new URL requires a reload — prompt the user.
        void vscode.window
          .showInformationMessage(
            "Gochi: daemon URL changed. Reload the window to apply.",
            "Reload",
          )
          .then((choice) => {
            if (choice === "Reload") {
              void vscode.commands.executeCommand("workbench.action.reloadWindow");
            }
          });
      }
    }),
  );
}

export function deactivate(): void {
  // Subscriptions and watcher are cleaned up via context.subscriptions.
}
