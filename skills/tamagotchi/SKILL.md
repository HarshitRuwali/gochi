---
name: tamagotchi
description: Drive a physical tamagotchi device via its locally installed `tamagotchi` CLI or the small HTTP server the CLI runs in the background (default http://localhost:7474, override with TAMAGOTCHI_URL). Use on explicit requests like "tamagotchi face happy", "set mood playful", "show text on the tamagotchi", or "ping the device". May also be used proactively to reflect task outcomes on the device — happy/excited on build or test success, sad/angry on failure, sleepy during long-running commands, surprised when waiting on user input.
user_invocable: true
---

# tamagotchi

The user owns a small physical tamagotchi (an ESP32-based device with a screen and a buzzer). They have installed the `tamagotchi` CLI on their machine, which also runs a tiny local HTTP server in the background that owns the serial connection to the device.

You can drive the tamagotchi two ways:

- **CLI** — invoke `tamagotchi …` as a shell command. Best when the user has granted Bash permissions.
- **HTTP** — `curl` (or any HTTP client) against `${TAMAGOTCHI_URL:-http://localhost:7474}`. Best when you're sandboxed to HTTP egress but not arbitrary shell.

Both paths talk to the same server and have identical effect on the device. Pick whichever your current permissions allow; if both are allowed, prefer the CLI — its output is friendlier.

## 1. Preflight

Confirm the server is reachable before issuing commands:

```sh
tamagotchi health
# or
curl -s http://localhost:7474/health
# {"ok":true,"connected":true,"port":"...","version":"..."}
```

- Connection refused → the background server isn't running. Tell the user to start it (`tamagotchi server start`, or `tamagotchi server install` the first time). **Do not try to start it yourself** — it's a managed background service.
- `{"connected": false}` → the device is unplugged or hasn't enumerated yet. Mention it once; the server will reconnect automatically when the device returns. Don't poll.

## 2. CLI

```sh
tamagotchi health                  # server + device status
tamagotchi face <name>             # switch face expression
tamagotchi text "<message>"        # show scrolling text
tamagotchi image <path>            # render a PNG/JPG on the OLED (128x64, 1-bit, dithered)
tamagotchi mood <name>             # set mood
tamagotchi get state               # current view + expression
tamagotchi get fps                 # display frame rate
tamagotchi list faces              # face names the device knows
tamagotchi ping                    # liveness check
```

If `command -v tamagotchi` returns nothing, the CLI isn't on PATH — fall back to HTTP.

## 3. HTTP API

All responses are JSON and always HTTP 200, even when the device is offline. Check the `connected` field.

| Method | Path     | Body                  | Purpose                                       |
|--------|----------|-----------------------|-----------------------------------------------|
| GET    | /health  | —                     | Server + device status                        |
| POST   | /face    | `{"name":"happy"}`    | Switch face expression                        |
| POST   | /text    | `{"text":"hello"}`    | Scrolling text view (keep it short)           |
| POST   | /image   | `{"data":"<base64>"}` | Push a 128×64 1bpp frame, MSB-first (1024 B)  |
| POST   | /mood    | `{"name":"playful"}`  | Set mood (resets on device reboot)            |
| GET    | /state   | —                     | Current view + expression                     |
| GET    | /fps     | —                     | Display frame rate                            |
| GET    | /faces   | —                     | List faces known to the device                |
| POST   | /ping    | —                     | Liveness check (device replies `PONG`)        |

Example:

```sh
curl -sX POST http://localhost:7474/face \
  -H 'content-type: application/json' \
  -d '{"name":"happy"}'
```

Response shape for command endpoints:

```json
{"ok": true, "connected": true, "response": "<device reply>"}
```

Offline:

```json
{"ok": true, "connected": false, "message": "device offline; request ignored"}
```

## 4. Valid values

**Faces:** `neutral`, `happy`, `sad`, `sleepy`, `excited`, `surprised`, `angry`, `blink`, `love`, `horny`, `shy`, `dead`

**Moods:** `content`, `playful`, `grumpy`, `sleepy`, `affectionate`

If the user asks for a name not in these lists, prefer `tamagotchi list faces` (or `GET /faces`) to confirm what the device actually supports, then ask them which they meant. Don't guess — the device rejects unknown names.

## 5. Proactive expressive use

You may change the face to mirror the *outcome* of work in the current session. Use sparingly, and only when it's clearly additive:

| Situation                                  | Action            |
|--------------------------------------------|-------------------|
| Build / tests pass                         | `face happy`      |
| Big milestone, feature shipped             | `face excited`    |
| Build / tests fail                         | `face sad`        |
| Crash, syntax error, hard failure          | `face angry`      |
| Kicking off a long-running command         | `face sleepy`     |
| Waiting on user clarification or input     | `face surprised`  |
| Session winding down / cleanup             | `face neutral`    |

Rules:

- At most **one** face change per logical step. Don't strobe the device.
- Never override a face the user explicitly set in the same turn.
- Don't react to trivia (a successful `ls`, an `echo`). Save it for real outcomes.
- Skip silently if the server is down — never block work on the device.
- Mention it briefly if at all; don't narrate ("I made it happy!" is too much).

## 6. Failure modes

- **Server not running** — Tell the user; suggest `tamagotchi server start`. Don't retry.
- **Device offline (`connected: false`)** — Mention once, continue. The server reconnects on its own when the device is plugged back in.
- **Unknown face/mood** — List the valid set and ask.
- **Timeout / non-PONG ping** — Treat as offline; one retry max.

## 7. Quick reference

```sh
# status
tamagotchi health
curl -s http://localhost:7474/health

# express
tamagotchi face excited
tamagotchi text "build passed"
tamagotchi mood playful

# inspect
tamagotchi get state
tamagotchi list faces
```
