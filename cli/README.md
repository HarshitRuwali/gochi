# Tamagotchi CLI

A Node CLI and local HTTP server for driving the
[Tamagotchi firmware](../firmware/) over USB serial. TypeScript sources
are loaded under Node via [`tsx`](https://tsx.is) — `serialport`'s native
module hits an unsupported libuv function under Bun
([oven-sh/bun#18546](https://github.com/oven-sh/bun/issues/18546)), so
Node owns the runtime. (Bun is fine for `install`/`link`.)

- A `tamagotchi` CLI that runs the pet's commands from the terminal.
- A local HTTP server that exposes the same commands as a REST API for
  AI agents and other tooling.
- An auto-persistent server: once installed it runs at login, owns the
  serial port, and stays up across reboots (macOS launchd).
- **All command endpoints return HTTP 200** — even when the pet is
  unplugged — so agents see a steady, calm API and never see error codes
  for a missing device. The `connected` flag in the body signals state.

## Install

```sh
cd cli
bun install                # or `npm install`
bun link                   # or `npm link` — registers the `tamagotchi` command globally
tamagotchi server install  # writes a launchd plist (auto-starts at login)
```

Confirm:

```sh
tamagotchi server status
tamagotchi health
```

## CLI

```sh
tamagotchi --version
tamagotchi --help

# faces — name it, or omit to pick from an interactive menu
tamagotchi face happy
tamagotchi face                # opens a select with all 12 faces
tamagotchi mood playful
tamagotchi mood                # opens a select with all 5 moods

# text
tamagotchi text hello there    # extra args are joined

# queries
tamagotchi get state
tamagotchi get fps
tamagotchi list faces
tamagotchi ping
tamagotchi health
```

Faces: `neutral happy sad sleepy excited surprised angry blink love horny shy dead`.
Moods: `content playful grumpy sleepy affectionate`.

The CLI is a thin client — it talks to the local server over HTTP. If
the server isn't running you get a friendly hint to start it.

## Server

```sh
tamagotchi server install     # set up the launchd auto-start
tamagotchi server uninstall   # remove it
tamagotchi server start       # start the installed server
tamagotchi server stop        # stop it
tamagotchi server status      # installed / launchd / HTTP state
tamagotchi server run         # run in the foreground (used by launchd)
```

Default port: **7474**. Override with `TAMAGOTCHI_PORT` and
`TAMAGOTCHI_URL` (for the client).

### HTTP API

All responses are JSON. `GET /health` is the only endpoint that lets you
know whether the pet is connected; **every command endpoint returns 200
either way** — when offline, the response is
`{"ok": true, "connected": false, "message": "device offline; ..."}`.

| Method | Path     | Body            | Sends to device |
| ------ | -------- | --------------- | --------------- |
| GET    | /health  | —               | (none)          |
| POST   | /face    | `{"name":"..."}` | `SHOW face …`  |
| POST   | /text    | `{"text":"..."}` | `SHOW text …`  |
| POST   | /mood    | `{"name":"..."}` | `SET mood …`   |
| GET    | /state   | —               | `GET state`     |
| GET    | /fps     | —               | `GET fps`       |
| GET    | /faces   | —               | `LIST faces`    |
| POST   | /ping    | —               | `PING`          |

Quick check:

```sh
curl http://localhost:7474/health
curl -X POST http://localhost:7474/face -H 'content-type: application/json' -d '{"name":"happy"}'
curl http://localhost:7474/state
```

## How it finds the pet

On start (and every 5 s while disconnected) the server scans serial
ports, filters Espressif USB CDC ports (VID `303a`) and obvious
`usbmodem`/`ttyACM` paths, opens each, sends `PING`, and accepts the one
that replies `PONG` (or the `Tamagotchi ready …` boot banner) within
~800 ms.

## Layout

```
cli/
  bin/tamagotchi.js       Node wrapper — spawns `node tsx src/cli.ts ...`
  src/cli.ts              CLI dispatcher (commander)
  src/transport.ts        wraps a serial port with the pet's protocol
  src/discovery.ts        finds the pet via PING handshake
  src/server.ts           HTTP API (node:http), owns the serial port
  src/service.ts          launchd install/start/stop/status
  src/client.ts           CLI's HTTP client
```

## Notes

- macOS only for `server install` right now (launchd). Linux (systemd
  user units) and Windows are easy to add next.
- The server is the only thing that holds the serial port — running
  `arduino-cli monitor` or the Arduino IDE at the same time will fight
  for it. Stop one of them.
- Mood lives in firmware RAM (resets to `content` on reboot).
