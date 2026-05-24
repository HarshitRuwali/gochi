# DJ-Plan — synced "vibe" mode for a sundowner event

Goal: at a sundowner, every guest plugs their tamagotchi into a shared
breadboard/perfboard on the table. One "DJ" ESP32 detects beats from the music
playing on a nearby laptop and pulses a shared GPIO line; every tamagotchi
animates a dance frame on each pulse. They visibly dance in sync.

Wired bus, not Wi-Fi/ESP-NOW — simpler, deterministic, immune to 2.4 GHz
congestion at a crowded venue.

## Architecture

```
  laptop                                       breadboard / perfboard
  ──────                                       ─────────────────────
  music app  ──┐                                  5V rail ──┬──┬──┬──┬──
               │                                            │  │  │  │
  BlackHole    │                                           5V 5V 5V 5V
  loopback   ──┤                                          ┌──┐┌──┐┌──┐┌──┐
               │                                          │T1││T2││T3││Tn│  ← receivers
  beat       ──┘                                          └┬┬┘└┬┬┘└┬┬┘└┬┬┘    (C3 SuperMini)
  detector                                                 ││  ││  ││  ││
  (tamagotchi dj)                                          ├┼──┼┼──┼┼──┼┘
        │                                                  ││  ││  ││  ││
        │ USB serial                                       ││ GND GND GND GND
        │ "BEAT 178\n"                                     │└──┴┴──┴┴──┴┴── GND rail
        ▼                                                  │
   ┌────────┐         3.3V GPIO pulse (2 ms)               │
   │ DJ ESP │ ──────────────────────────────────────────── SYNC rail
   │ (kit)  │
   └────┬───┘
        │ 5V / GND
        └────────────────────────── 5V + GND rails (shared with receivers)
```

One signal wire on a breadboard row. Every device taps in. Done.

## Roles

- **Laptop** — plays music, runs `tamagotchi dj` which does beat detection on
  BlackHole audio and pushes `BEAT <intensity>` lines over USB serial to the DJ
  device.
- **DJ ESP** (a classic ESP32 dev kit — we already have one) — reads `BEAT`
  lines on its USB serial, pulses one GPIO high for ~2 ms on each beat.
  Headless: no display, no buzzer.
- **Receiver ESPs** (every guest's C3 SuperMini) — `INPUT_PULLDOWN` on the SYNC
  pin, rising-edge interrupt advances one dance frame.

Fallback if no laptop: the DJ runs a fixed-BPM metronome (100 BPM) and just
pulses on its own. Still in sync, just not music-reactive.

## Bill of materials

For a 10–15-device event:

| Item                                  | Qty | Notes                                          |
|---------------------------------------|-----|------------------------------------------------|
| Half- or full-size breadboard         | 1   | Prototype only. Perfboard for the real event.  |
| MB102 breadboard power module         | 1   | 6.5–12 V in → 5 V / 3.3 V rails. ~$2.          |
| 9–12 V barrel-jack wall adapter, ≥2 A | 1   | Feeds the MB102.                               |
| 100 µF electrolytic capacitor         | 1   | Across 5 V/GND on the rail to absorb inrush.   |
| Dupont female–female jumpers          | 3×N | One trio (5V / GND / SYNC) per tamagotchi.     |
| ESP32 dev kit (classic)               | 1   | DJ device. Already on hand.                    |
| USB-A → micro-USB cable for DJ        | 1   | Connects DJ to the laptop.                     |
| LED + 1 kΩ resistor                   | 1   | Hangs off SYNC line so you can *see* beats.    |

For the event-day version, swap the breadboard for a ~10×15 cm perfboard with:

- 2× screw terminals (5 V in, GND in)
- N× 3-pin male headers (5V / GND / SYNC) — one per guest
- 100 µF cap soldered across the rails
- Heartbeat LED on SYNC

Roughly 30 minutes of soldering, looks intentional on the table.

## Wiring rules

- **Bridge both ends** of the 5 V rail (and the GND rail) — full-size
  breadboards split the rails in the middle. Classic gotcha.
- **Bridge across to both sides** of the board (top rail ↔ bottom rail) for
  both 5 V and GND, so devices on either edge get power.
- **Common GND is mandatory** — the SYNC GPIO is referenced to ground. Every
  device's GND must reach the rail.
- **5 V into each tamagotchi's `5V` pin** (not `3V3`). The C3 SuperMini's
  onboard LDO handles regulation.
- **Don't dual-feed**: when plugged into the breadboard, devices should *not*
  also be on USB. Pick one supply.

## Power math

- ~150–250 mA per C3 SuperMini @ 5 V (OLED + radio idle + occasional buzzer).
- 10 devices ≈ 2 A on the 5 V rail. MB102 is rated 700 mA continuous; a 9 V/2 A
  wall adapter into the MB102 in **5 V mode** comfortably hits 1.5–2 A.
- For >10 devices, replace the MB102 with a proper 5 V/5 A buck module (e.g.
  LM2596-based, ~$3) or a 5 V/3 A bench supply.
- A single breadboard rail handles ~1 A before warming. Tap power onto the rail
  at *both ends* to halve per-contact current.

## Firmware — DJ device (classic ESP32 dev kit)

New mode (or build flag): reads `BEAT [intensity]\n` on `Serial`, pulses
`SYNC_PIN` high for 2 ms.

```cpp
// dj_mode.cpp (sketch)
constexpr int SYNC_PIN = 2;  // pick any free GPIO

void setup() {
  Serial.begin(115200);
  pinMode(SYNC_PIN, OUTPUT);
  digitalWrite(SYNC_PIN, LOW);
}

void loop() {
  static unsigned long last_beat_ms = 0;
  const unsigned long now = millis();

  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    if (line.startsWith("BEAT")) pulse();
    last_beat_ms = now;
  }

  // Fallback metronome at 100 BPM if no BEAT for 2 s.
  if (now - last_beat_ms > 2000 && (now % 600) < 5) pulse();
}

void pulse() {
  digitalWrite(SYNC_PIN, HIGH);
  delayMicroseconds(2000);
  digitalWrite(SYNC_PIN, LOW);
}
```

Build with `arduino-cli` against `esp32:esp32:esp32` (not `esp32c3`). Serial
port pattern is `/dev/cu.usbserial-*` or `/dev/cu.SLAB_USBtoUART`. Verify the
existing `discovery.ts` matches both before the event.

## Firmware — receivers (C3 SuperMini)

Add a `vibe` mode that:

1. Picks a `SYNC_PIN` (any free GPIO) on the SuperMini's header. Configure
   `pinMode(SYNC_PIN, INPUT_PULLDOWN)`. Internal pulldown is essential — the
   line floats high while the DJ boots and you'll fire spurious beats
   otherwise.
2. `attachInterrupt(SYNC_PIN, onBeat, RISING)` — sets a `volatile bool` flag.
3. Main loop checks the flag and advances one dance frame.
4. Pick a **random phase offset** (0–3 frames) at boot so 15 devices don't all
   show the same frame in lockstep — looks like a crowd, not the Borg.
5. If no beat for >2 s, fall back to `neutral`.

Dance frames: use new dedicated faces (per earlier preference), not just
cycling existing happy/excited/love. Procedural face primitives already exist
in `firmware/src/views/procedural_face.cpp` — add 4–8 dance poses there.

Activation: enter vibe mode via `tamagotchi face vibe` (treat it as a face),
or add a dedicated `SHOW vibe` verb to firmware/command.cpp. Probably the
latter — it's a mode, not a still frame.

## CLI / laptop side

New subcommand: `tamagotchi dj`

- Opens BlackHole input device via `ffmpeg -f avfoundation -i ":N" -ac 1 -ar 22050 -f s16le -`.
- Streams PCM to a small Node onset detector (windowed RMS + adaptive
  threshold). ~80–150 LoC.
- On each detected onset, writes `BEAT <intensity>\n` to the DJ device's serial
  port.
- Flags: `--bpm <n>` for fixed-tempo override, `--device <path>` to override
  serial port, `--listen` to print detected beats without sending.

Prerequisites: user has `brew install --cask blackhole-2ch` and configured a
Multi-Output Device combining their speakers + BlackHole. One-time setup,
document it in the `tamagotchi dj` help text.

If we don't want to ship BlackHole DSP at all for v1: skip the laptop side and
let the DJ device run pure metronome mode. Still a fun result.

## Build order

1. **Single-device GPIO pulse round-trip.** DJ ESP pulses GPIO at 100 BPM; one
   receiver toggles its on-board LED on each beat. Verifies wiring, pulldown,
   interrupt latency. No display, no audio.
2. **Multi-device on the breadboard.** 3–5 receivers tied to the same SYNC
   rail. All LEDs blink together. Verifies rail current and fan-out.
3. **Dance frames on receivers.** Replace LED toggle with face frame advance.
   Use procedural-face primitives. Add the random phase offset.
4. **Laptop-side beat detector.** `tamagotchi dj` subcommand, BlackHole input,
   onset detection, `BEAT` lines over serial. Test with one upbeat track.
5. **Migrate to perfboard.** Solder the event version: screw terminals, header
   strips, bulk cap, heartbeat LED.
6. **Full rehearsal with 5+ devices** before event day. Plug in one at a time
   to avoid inrush trip. Check that wiggling cables doesn't kill the bus.

## Risks / things to verify before event day

- **Breadboard contact heat at 2+ A** — measure rail temperature after 30 min
  with 10 devices connected. If anything is warm, move to perfboard now, not
  the day of.
- **Inrush trips the supply** — if plugging the 8th device crashes the rail,
  the 100 µF cap isn't enough; bump to 470 µF or 1000 µF.
- **Beat detection on the actual playlist** — onset detection on house/EDM is
  reliable; lo-fi / acoustic is hit-or-miss. Have a fixed-BPM fallback ready.
- **Serial port name on event-day laptop** — the DJ device's port may differ
  on a different machine. Verify `tamagotchi dj` auto-discovers it.
- **Spare DJ device** — one DJ failure kills the whole table. Bring a flashed
  spare ESP32 dev kit and a pre-cut USB cable.
- **Common GND between laptop and bus** — when the DJ is USB-connected to the
  laptop, the laptop's USB ground is on the bus too. Usually fine, but if the
  laptop is also plugged into mains with a 3-prong adapter and the bus power
  brick is 2-prong, hum loops are possible. Test the actual setup ahead of
  time.

## Out of scope for v1

- Per-track BPM from Spotify Web API.
- Multiple DJ devices on the same bus (would need bus arbitration).
- ESP-NOW wireless fallback — possible later if guests want to wander.
- Per-device intensity from the beat payload — GPIO single-wire only carries
  "beat now". To pass intensity, upgrade to 2 GPIO lines (clock + 4-bit data
  burst) or move to RS-485 / UART-on-bus.
