# Tamagotchi CLI

A Node CLI for driving the [Tamagotchi firmware](../firmware/) over USB
serial, with an optional HTTP frontend for non-CLI clients.
TypeScript sources are loaded under Node via [`tsx`](https://tsx.is) —
`serialport`'s native module hits an unsupported libuv function under
Bun ([oven-sh/bun#18546](https://github.com/oven-sh/bun/issues/18546)),
so Node owns the runtime. (Bun is fine for `install`/`link`.)

The CLI is a thin client. The real work happens in two long-lived
pieces:

- **Daemon** — owns the USB serial port, listens on a Unix domain
  socket (`~/.tamagotchi/daemon.sock`). Required. The CLI talks to it
  directly.
- **HTTP frontend** — optional TCP listener on `:7474` that
  reverse-proxies to the daemon. Useful for `curl`, AI agents, web
  UIs, or anything that's easier with HTTP than a Unix socket.

`gochi setup` installs both as platform-native auto-start jobs that
come up at login:

| Platform | Service backend             |
| -------- | --------------------------- |
| macOS    | `launchctl` LaunchAgents    |
| Linux    | `systemctl --user` units    |
| Windows  | Task Scheduler logon tasks  |

**All command endpoints return HTTP 200** — even when the pet is
unplugged — so agents see a steady, calm API and never see error codes
for a missing device. The `connected` flag in the body signals state.

## Install

```sh
npm i -g @0xpv/gochi
gochi setup           # one-time: installs daemon + HTTP frontend
```

Confirm:

```sh
gochi daemon status   # daemon launchd + socket
gochi health          # daemon-reported device state
```

Local dev (no npm publish):

```sh
cd cli
bun install
bun link            # registers `gochi` globally
gochi setup
```

## CLI

```sh
gochi --version
gochi --help

# faces — name it, or omit to pick from an interactive menu
gochi face happy
gochi face                # opens a select with all 12 faces
gochi mood playful
gochi mood                # opens a select with all 5 moods

# availability status — applies a preset (face + mood + optional text)
gochi status              # opens a rich picker with descriptions
gochi status available
gochi status busy
gochi status in-meeting
gochi status deep-focus
gochi status frustrated
gochi status on-break
gochi status away
gochi status do-not-disturb
gochi status reviewing
gochi status thinking

# text
gochi text hello there    # extra args are joined

# image — auto-resized to 128x64, dithered to 1-bit
gochi image ./logo.png
gochi image ./photo.jpg --no-dither -t 96   # plain threshold
gochi image ./icon.png --invert --bg white  # invert + white letterbox

# queries
gochi get state
gochi get fps
gochi list faces
gochi list statuses    # all availability presets
gochi ping
gochi health

# enumerate every device on both I2C buses (handy when wiring a sensor)
gochi i2c

# interactive hardware self-test — picks a component from a menu,
# asks y/n after each, drops troubleshooting tips on 'no'.
gochi test               # menu: serial / OLED / buzzer / IMU / all
gochi test oled          # jump straight to one component
gochi test imu           # lift + shake the device, verify the face reacts
gochi test all           # run them all in order
```

Faces: `neutral happy sad sleepy excited surprised angry blink love sexy shy dead`.
Moods: `content playful grumpy sleepy affectionate`.
Statuses: `available busy in-meeting deep-focus frustrated on-break away do-not-disturb reviewing thinking`.

### Spotify

```sh
gochi spotify login <client-id>  # one-time auth (opens a browser)
gochi spotify now                # print + display the current track
gochi spotify watch              # live polling loop — push every track change
gochi spotify logout             # remove stored tokens
```

The CLI talks to the daemon over `~/.tamagotchi/daemon.sock` by default.
Set `GOCHI_URL=http://host:port` to point it at a remote daemon's
HTTP frontend instead.

## Daemon

The daemon is the only process that holds the serial port. It's
hotplug-aware: it polls the OS port list and only opens devices that
advertise the Espressif USB VID (`303a`), so plugging in an unrelated
USB-serial board (an Arduino, a different ESP) won't get probed or
reset.

```sh
gochi daemon status   # plist + socket + connected device
gochi daemon run      # foreground (used by launchd; rare for users)
```

### Releasing the port temporarily

`gochi stop` tells the daemon to drop the serial port without
shutting itself down. Use it before any tool that needs exclusive
access to `/dev/cu.usbmodem*` — most commonly `arduino-cli upload`.

```sh
gochi stop            # release the port
# ...flash firmware, run a monitor, whatever...
gochi start           # daemon reconnects on the next ~1.5s tick
```

The firmware Makefile wraps `make flash` with this automatically, so
you don't normally type these by hand.

### Picking up daemon code changes

The daemon is long-lived — it only restarts at login. If you edit
`daemon.ts` (or any module it imports), the running process keeps
serving the old code. `gochi kill` terminates it and lets the platform
service unit auto-respawn a fresh instance:

```sh
gochi kill            # SIGTERM the daemon; launchd/systemd brings it back
```

You'll see `daemon killed; launchd is respawning it…` and within a
second the new process is serving any newly-added endpoints.

## HTTP frontend (optional)

Enabled by default after `setup`. Turn it off if you don't need a TCP
listener on your machine:

```sh
gochi server status    # is the HTTP frontend running?
gochi server disable   # turn it off (persists across reboots)
gochi server enable    # bring it back
gochi server run       # foreground (used by launchd)
```

Default port: **7474**. Override with `GOCHI_PORT`.

### HTTP API

All responses are JSON. `GET /health` is the only endpoint that lets
you know whether the pet is connected; **every command endpoint
returns 200 either way** — when offline, the response is
`{"ok": true, "connected": false, "message": "device offline; ..."}`.

| Method | Path     | Body                 | Sends to device |
| ------ | -------- | -------------------- | --------------- |
| GET    | /health  | —                    | (none)          |
| POST   | /face    | `{"name":"..."}`     | `SHOW face …`   |
| POST   | /text    | `{"text":"..."}`     | `SHOW text …`   |
| POST   | /image   | `{"data":"<b64>"}`   | `SHOW image …` (128×64 1bpp, MSB-first) |
| POST   | /mood    | `{"name":"..."}`     | `SET mood …`    |
| POST   | /status  | `{"name":"..."}`     | `SET mood … + SHOW face/text …` (preset) |
| GET    | /statuses | —                   | list all status presets |
| GET    | /state   | —                    | `GET state`     |
| GET    | /fps     | —                    | `GET fps`       |
| GET    | /faces   | —                    | `LIST faces`    |
| POST   | /ping    | —                    | `PING`          |

Quick check (HTTP frontend must be enabled):

```sh
curl http://localhost:7474/health
curl -X POST http://localhost:7474/face -H 'content-type: application/json' -d '{"name":"happy"}'
curl -X POST http://localhost:7474/status -H 'content-type: application/json' -d '{"name":"in-meeting"}'
curl http://localhost:7474/statuses
curl http://localhost:7474/state
```

## Spotify integration

Gochi can scroll the currently playing Spotify track on the OLED display. It
uses **OAuth 2.0 Authorization Code + PKCE** — no client secret needed, and
tokens are stored locally at `~/.tamagotchi/spotify.json` (mode `0600`).

### 1. Create a Spotify app

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and create an app.
2. Under **Edit Settings → Redirect URIs**, add: `http://127.0.0.1:8765/callback`
   > Use `127.0.0.1`, **not** `localhost` — Spotify's dashboard accepts `http://` only for the
   > loopback IP (`127.0.0.1`), not for the hostname `localhost`.
3. Copy the **Client ID** (you don't need the secret).

### 2. Login

```sh
gochi spotify login <your-client-id>
```

This opens your browser at the Spotify consent page. After you approve, the
callback is captured automatically on `127.0.0.1:8765` and tokens are saved.
You only need to do this once; tokens are refreshed automatically.

If your browser doesn't redirect back (e.g. a corporate proxy blocks loopback
redirects), the CLI also accepts a manual paste — just copy the full redirect
URL from your browser's address bar and paste it into the terminal when
prompted.

### 3. Commands

```sh
gochi spotify now     # one-shot: print current track + push to display
gochi spotify watch   # live loop — polls every 10 s, pushes on track change
gochi spotify logout  # remove stored tokens
```

`watch` runs until Ctrl-C. It only sends a command to the device when the
track actually changes, so it's quiet if you're listening to one song for a while.

**Example output:**

```
Watching Spotify… (updates every 10s, Ctrl-C to stop)

▶  Bohemian Rhapsody - Queen
▶  Stairway to Heaven - Led Zeppelin
⏸  Stairway to Heaven - Led Zeppelin
```

### Display format

The track is shown as `Song Title - Artist` as scrolling text on the OLED.
Long titles scroll across the full 128 px width automatically (firmware handles it).

### Scopes requested

| Scope | Why |
| ----- | --- |
| `user-read-currently-playing` | Fetch the active track |
| `user-read-playback-state` | Know if playback is paused |

No write scopes are ever requested.

## Availability status

`gochi status` composes three primitives (`SET mood`, `SHOW face`, `SHOW text`) into
one named preset. Statuses with a short text label show the **text view** so
colleagues can read them at a glance; expressive statuses show the matching
**face expression** instead.

| Name              | Visible display  | Face       | Mood         |
| ----------------- | ---------------- | ---------- | ------------ |
| `available`       | happy face       | happy      | content      |
| `busy`            | neutral face     | neutral    | grumpy       |
| `in-meeting`      | "In Meeting"     | neutral    | content      |
| `deep-focus`      | "Deep Focus"     | sleepy     | sleepy       |
| `frustrated`      | angry face       | angry      | grumpy       |
| `on-break`        | "On Break!"      | excited    | playful      |
| `away`            | "Away"           | sleepy     | sleepy       |
| `do-not-disturb`  | "DND"            | dead       | grumpy       |
| `reviewing`       | "Reviewing"      | surprised  | content      |
| `thinking`        | surprised face   | surprised  | playful      |

Presets are defined in `src/status.ts`. Add or edit entries there; the daemon,
client, and CLI all pick them up at build time.

The HTTP endpoint applies mood + view atomically (mood first, then the
view switch) and responds:

```json
{ "ok": true, "connected": true, "status": "in-meeting", "label": "In Meeting" }
```

## VS Code extension

The `vscode-extension/` directory contains a companion extension that
automatically updates the status based on what you're doing in the editor — no
manual `gochi status` calls needed.

### Install

```sh
cd vscode-extension
npm install
npm run compile
# VS Code: Ctrl+Shift+P → Developer: Install Extension from Location…
```

The HTTP frontend must be enabled (it is by default after `gochi setup`):

```sh
gochi server enable
```

### Auto-detected states

| State        | What triggers it                                              |
| ------------ | ------------------------------------------------------------- |
| `available`  | Default; also restored after errors clear or debug ends       |
| `deep-focus` | Sustained typing for 45 s with no debug session or errors     |
| `thinking`   | A debug session is active                                     |
| `frustrated` | 5+ new errors vs baseline, or a build/test task exits non-zero |
| `away`       | No keyboard or editor activity for 5 minutes                  |

Priority when multiple signals fire: **thinking › frustrated › deep-focus › available › away**.

### Status bar

A status-bar item (bottom-right) shows the current state at a glance:

- `$(smiley) Available` — auto-mode tracking normally
- `$(eye) Deep Focus` — sustained typing detected
- `$(bug) Thinking` — debug session active
- `$(warning) Frustrated` — error spike / build failure
- `$(clock) Away` — idle timeout hit
- `$(lock) Deep Focus (manual, 8m)` — manual override active, N minutes left
- `$(circle-slash) Gochi (paused)` — auto-mode disabled via settings

Clicking the item opens a quick-pick. If an override is active, the first
option is **Resume auto-mode** (cancels the timer immediately).

### Commands

| Command                   | What it does                                          |
| ------------------------- | ----------------------------------------------------- |
| `Gochi: Set Status`       | Pick a status manually; pauses auto-mode for 30 min   |
| `Gochi: Toggle Auto Mode` | Enable / disable automatic status tracking            |

### Settings

All thresholds are configurable under **Settings → Extensions → Gochi Activity Watcher**:

| Setting                                | Default                   | Description                                                   |
| -------------------------------------- | ------------------------- | ------------------------------------------------------------- |
| `gochi.autoMode.enabled`               | `true`                    | Enable / disable auto tracking                                |
| `gochi.daemonUrl`                      | `http://localhost:7474`   | URL of the Gochi HTTP frontend                                |
| `gochi.projectLabel`                   | `""` (workspace folder)   | Project name shown as `"Label \| State"` on the OLED display  |
| `gochi.autoMode.idleTimeoutMinutes`    | `5`                       | Minutes of inactivity before switching to `away`              |
| `gochi.autoMode.focusDelaySeconds`     | `45`                      | Seconds of sustained typing to trigger `deep-focus`           |
| `gochi.autoMode.errorThreshold`        | `5`                       | New errors above baseline that trigger `frustrated`           |
| `gochi.autoMode.manualOverrideMinutes` | `30`                      | Minutes auto-mode is paused after a manual status pick        |

#### Project label

Every auto state transition overlays a `"ProjectName | State"` message on the
display so colleagues can see both which project you're on and what you're doing.

By default the workspace folder name is used automatically. To override it,
add to your project's `.vscode/settings.json`:

```jsonc
// Project Alpha
{ "gochi.projectLabel": "Alpha" }

// Project Beta
{ "gochi.projectLabel": "Beta" }
```

Set `"gochi.projectLabel": ""` to disable the overlay entirely — the pet will
show only the bare face/text from the status preset.

What the display shows after each transition:

| State        | Display (with label "Alpha")  |
| ------------ | ----------------------------- |
| `available`  | `Alpha \| Available`          |
| `deep-focus` | `Alpha \| Deep Focus`         |
| `thinking`   | `Alpha \| Thinking...`        |
| `frustrated` | `Alpha \| Frustrated`         |
| `away`       | `Alpha \| Away`               |

Manual picks via the command palette also overlay the project label, so
`Gochi: Set Status → In Meeting` shows `Alpha | In Meeting`.

### Manual override

Setting a status manually (via the command palette or `gochi status` in the
terminal) activates a **manual override** that suppresses auto-transitions for
`manualOverrideMinutes` minutes. While active:

- The status bar shows a lock icon and the remaining time.
- The `Set Status` picker offers a **Resume Auto** shortcut.
- The toast notification after setting a status also has a **Resume Auto** button.
- Calling `gochi kill` (to reload daemon code) does not clear the override.

## How it finds the pet

The daemon polls `SerialPort.list()` every ~1.5 s, filters to
Espressif's VID (`303a`), and opens any newly-arrived matching port.
Unplug the pet and the daemon notices on the next tick; plug it back in
and it reconnects within ~1.5 s. The daemon never opens non-Espressif
ports, so unrelated USB-serial devices stay untouched.

## Layout

```
cli/
  bin/gochi.js            Node wrapper — spawns `node tsx src/cli.ts ...`
  src/cli.ts              CLI dispatcher (commander)
  src/transport.ts        wraps a serial port with the pet's protocol
  src/discovery.ts        hotplug watcher (VID-filtered SerialPort.list polling)
  src/daemon.ts           the UDS daemon, owns the serial port
  src/server.ts           optional TCP HTTP reverse-proxy to the daemon
  src/ipc.ts              shared UDS paths + HTTP-over-UDS helpers
  src/service/            setup / enable / disable / status, per-platform
    index.ts                platform dispatcher
    common.ts               shared helpers (path resolution, health checks)
    darwin.ts               macOS launchd backend
    linux.ts                systemd --user backend
    windows.ts              Task Scheduler backend
  src/client.ts           CLI's transport (UDS by default, TCP if GOCHI_URL set)
  src/image.ts            PNG/JPG → 128×64 1bpp (dither + MSB-pack)
  src/status.ts           availability status presets (name → face + mood + text)
  src/spotify.ts          Spotify OAuth PKCE + now-playing polling
```

## Notes

- Auto-start is supported on macOS (launchd), Linux (`systemctl --user`),
  and Windows (Task Scheduler). On Linux, services stop when you log
  out unless you run `sudo loginctl enable-linger $USER` — `setup`
  prints a hint if lingering isn't on. If your environment can't host
  one of these (minimal container, WSL1, etc.), run `gochi daemon
  run` (and optionally `gochi server run`) in a terminal manually.
- The daemon is the only thing that holds the serial port — running
  `arduino-cli monitor` or the Arduino IDE at the same time will fight
  for it. Stop one of them.
- Mood lives in firmware RAM (resets to `content` on reboot).
- Upgrading from a pre-`setup` install: `gochi setup` will tear
  down the legacy `com.tamagotchi.server` plist for you.
