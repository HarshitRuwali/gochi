# How to build a gochi

A wiring walkthrough that goes one component at a time and verifies
each before moving on. Mistakes are much easier to debug when you only
just added one wire.

The pet runs on an **ESP32-C3 SuperMini** breakout, a **0.96" SSD1306
OLED**, a **passive piezo buzzer**, and a **GY-521 (MPU-6050) IMU
module**. Everything lives on a half-size breadboard with dupont
jumpers — no soldering required.

This guide stops at "all components wired and individually verified."
Flashing the firmware and installing the `gochi` CLI is covered
separately (see the project README until a dedicated install guide
lands).

## Prerequisites

Before you start wiring, you'll want the firmware flashed and the CLI
working — otherwise the test commands at each step won't do anything.
Specifically:

- The latest firmware is on the board (`make flash` from the project
  root).
- The `gochi` CLI is installed and the daemon is running
  (`gochi daemon status` should print "loaded").
- `gochi ping` returns `PONG`. This confirms the host can talk to the
  board over USB before you add anything else.

If `gochi ping` fails, fix that first — none of the hardware tests
below will work without it.

## Bill of materials

| #   | Part                                        | Notes                                                        |
| --- | ------------------------------------------- | ------------------------------------------------------------ |
| 1   | ESP32-C3 SuperMini board                    | Native USB-C, RISC-V                                         |
| 1   | SSD1306 OLED, 0.96", 128×64, I²C, 4-pin     | Address `0x3C`                                               |
| 1   | GY-521 / MPU-6050 IMU module, 8-pin         | Address `0x68`                                               |
| 1   | Passive piezo buzzer                        | **Passive**, not active — active buzzers ignore tone signals |
| 1   | Half-size (or larger) solderless breadboard | 400 tie-points is plenty                                     |
| ~14 | Male-to-male dupont jumper wires            | Short jumpers (5–10 cm) keep I²C edges clean                 |
| 1   | USB-C cable                                 | Data, not power-only                                         |

If you happen to have a different size buzzer or a 5-pin OLED with a
RST pin: the RST line is left unconnected on this build.

## Pin map (what we're working toward)

The full final wiring — useful as a reference, but don't try to do it
all at once.

| ESP32-C3 pin | Goes to             | Notes                            |
| ------------ | ------------------- | -------------------------------- |
| `3V3`        | breadboard `+` rail | Powers OLED and MPU              |
| `GND`        | breadboard `−` rail | Common ground                    |
| `GPIO5`      | OLED `SDA`          | Hardware I²C bus A               |
| `GPIO6`      | OLED `SCL`          | Hardware I²C bus A               |
| `GPIO7`      | MPU `SDA`           | Software I²C bus B               |
| `GPIO8`      | MPU `SCL`           | ⚠️ strapping pin — see step 4    |
| `GPIO10`     | Buzzer signal       | Buzzer GND → breadboard `−` rail |

> **Why two separate I²C buses?** The C3 has only one hardware I²C
> controller, and stacking OLED + MPU on the same bus made the parallel
> pull-up resistance too low for 400 kHz fast-mode — address bytes got
> corrupted and the two devices alternated ACKs at random. We moved
> the MPU to a bit-banged software bus on GPIO7/8 to isolate them.

## Step 1 — Power rails

Goal: get `3V3` and `GND` from the SuperMini onto the breadboard rails
so subsequent components can pull power from either side.

```
ESP32-C3 SuperMini                              Breadboard
                                        ┌───────────────────────────┐
              3V3 ●───── red jumper ───►│ + rail (top)              │
              GND ●───── black jumper ─►│ − rail (top)              │
                                        ├───────────────────────────┤
                                        │   (rows for components)   │
                                        ├───────────────────────────┤
                                        │ + rail (bottom)           │
                                        │ − rail (bottom)           │
                                        └───────────────────────────┘
```

1. Plug the SuperMini into one end of the breadboard so its pins sit
   in two columns across the centre gap.
2. Run a jumper from the `3V3` pin to the breadboard's `+` (red) rail.
3. Run a jumper from any `GND` pin to the breadboard's `−` (blue)
   rail.
4. Optional but recommended: bridge the top and bottom power rails
   with two more short jumpers (one for `+`, one for `−`). Half-size
   breadboards usually have a gap in the middle of each rail — this
   gives you power on every row regardless of which side you wire to.

> **Note on voltage.** The SuperMini exposes both `5V` (raw USB VBUS)
> and `3V3` (regulated). **Use `3V3`.** All three components here are
> 3.3 V devices. Feeding 5 V to the OLED works on most modules but
> isn't required, and the MPU-6050 register block runs at 3.3 V — the
> module's on-board regulator drops 5 V if you feed it, but the I²C
> level translation gets sketchy.

**Verify:** plug in USB. The SuperMini's tiny red power LED should
light up. There's nothing to test in `gochi` yet — we'll start running
tests once the OLED is in.

## Step 2 — OLED (display)

The display talks to the C3 over the hardware I²C bus on `GPIO5` /
`GPIO6`. It draws ~10 mA and has on-board 4.7 kΩ pull-ups on SDA/SCL —
no external resistors needed.

```
                ┌──────────────────────────┐
                │   SSD1306 OLED (0.96")   │
                │                          │
                │  GND  VCC  SCL  SDA      │
                └───┬────┬────┬────┬───────┘
                    │    │    │    │
                    │    │    │    └──── GPIO5 (SDA)
                    │    │    └───────── GPIO6 (SCL)
                    │    └────────────── + rail (3V3)
                    └─────────────────── − rail (GND)
```

1. Place the OLED on a free row of the breadboard.
2. Wire `GND` → `−` rail.
3. Wire `VCC` → `+` rail.
4. Wire `SCL` → `GPIO6` on the SuperMini.
5. Wire `SDA` → `GPIO5` on the SuperMini.

> ⚠️ **Watch the pin order.** Some OLED modules are labelled
> `GND-VCC-SCL-SDA`, others `VCC-GND-SCL-SDA`, and a few have SDA
> and SCL swapped. Always read the silkscreen — don't go by which side
> is left.

**Verify:**

```sh
gochi i2c
```

Expected output:

```
Bus A (hardware I2C, GPIO5/6):
  0x3C  SSD1306 OLED
Bus B (software I2C, GPIO7/8):
  (no devices)
```

Bus A listing `0x3C` means the OLED is ACKing — wiring is correct
electrically. Bus B is still empty; we'll fill it in step 4.

For a full panel-level check (does the screen actually light up?):

```sh
gochi test oled
```

It first repeats the `0x3C` check, then writes "Hello" and asks you
if you can see it. If you get `0x3C is present` but no pixels light
up, the panel itself is dead (wrong VCC, blown driver IC) — address
ACK happens at the bus level before any pixels are drawn.

## Step 3 — Buzzer

The buzzer is the simplest part: two wires, one to `GPIO10`, one to
`GND`. There's no real polarity for passive piezos, but some modules
label one pin `+` — connect that to the signal wire.

```
                ┌─────────────────────┐
                │   Passive piezo     │
                │                     │
                │   +     −           │
                └───┬─────┬───────────┘
                    │     │
                    │     └──── − rail (GND)
                    └────────── GPIO10 (signal)
```

1. Place the buzzer on the breadboard.
2. Wire the `+` (signal) pin → `GPIO10` on the SuperMini.
3. Wire the `−` pin → `−` rail.

**Verify:**

```sh
gochi test buzzer
```

The CLI sends two `face` commands back-to-back to force a transition
(the firmware only jingles on a _change_), so you'll hear a short
musical phrase. Then it asks "Did you hear a tone?".

If you hear nothing:

- Confirm it's a _passive_ piezo. Active buzzers ignore tone signals
  and only beep at their own fixed pitch when fed DC; they will not
  reproduce the firmware's jingles.
- Try swapping the two leads (some modules are polarity-sensitive).
- Hold it close to your ear — in a quiet room the tone is faint.

## Step 4 — MPU-6050 IMU

This is the trickiest one because of two things: the GPIO8 strapping
behaviour, and the fact that the MPU lives on its own software I²C
bus (not the OLED's bus).

The GY-521 module has eight pins. We use exactly four: `VCC`, `GND`,
`SDA`, `SCL`. Leave `XDA`, `XCL`, `AD0`, and `INT` unconnected.

```
                ┌──────────────────────────────────────────┐
                │             GY-521 / MPU-6050            │
                │                                          │
                │  VCC  GND  SCL  SDA  XDA  XCL  AD0  INT  │
                └───┬────┬────┬────┬────┬────┬────┬────┬───┘
                    │    │    │    │    │    │    │    │
                    │    │    │    │    └────┴────┴────┴── leave floating
                    │    │    │    └──── GPIO7 (SDA)
                    │    │    └───────── GPIO8 (SCL)  ⚠️
                    │    └────────────── − rail (GND)
                    └─────────────────── + rail (3V3)
```

1. Place the MPU module on a free row of the breadboard.
2. Wire `VCC` → `+` rail (3V3).
3. Wire `GND` → `−` rail.
4. Wire `SCL` → `GPIO8` on the SuperMini.
5. Wire `SDA` → `GPIO7` on the SuperMini.
6. **Leave the other four pins (`XDA`, `XCL`, `AD0`, `INT`)
   unconnected.**

> ⚠️ **GPIO8 is a strapping pin.** The ESP32-C3 samples it at reset to
> decide whether to enter normal-boot mode (HIGH) or flash-download
> mode (LOW). The MPU module's on-board pull-up holds the line HIGH
> when the module is connected — that's fine. But if you ever power
> the board with the MPU **unplugged or unpowered**, GPIO8 floats,
> the chip enters flash-download mode, and the firmware never runs.
>
> Practical rule: **plug the MPU in before you plug in USB**, and
> never reset the board with the MPU disconnected.

**Verify:**

```sh
gochi i2c
```

Expected output now:

```
Bus A (hardware I2C, GPIO5/6):
  0x3C  SSD1306 OLED
Bus B (software I2C, GPIO7/8):
  0x68  MPU-6050 IMU
```

Both buses populated. Bus A still has only the OLED, Bus B now has
the MPU at `0x68`.

If `0x68` doesn't appear on Bus B:

- Check that `SDA` and `SCL` aren't swapped on the MPU side (the
  module's silkscreen is small).
- Try the other I²C address: if you see `0x69` instead, the `AD0`
  pin is being pulled HIGH somehow. Edit `MPU_ADDR` in
  `firmware/src/config.h` to `0x69` and reflash.
- Press the breadboard jumpers firmly — loose dupont crimps are the
  single most common failure on these modules.

Once `gochi i2c` shows both addresses, run the gesture test:

```sh
gochi test imu
```

The CLI asks you to **lift the device** (face should become
`surprised`), then **shake it firmly** (face should become `angry` —
shaking three times in a minute escalates to `sad`).

## Final wiring summary

Once all three steps are done, the breadboard should look roughly
like this — power rails on the outside, three modules wired into the
inner rows, the SuperMini straddling the centre gap.

```
                              ┌──────────────────────────┐
                              │   SSD1306 OLED           │
                              └──┬───┬───┬───┬───────────┘
       ┌─ + (3V3) ────●──────────●───┼───┼───┼───●──────────●───────► to MPU VCC
       │                            G   S   S   V
                                    N   C   D   C
                                    D   L   A   C
       │                            ●───●───●───●
       │                            │   │   │   │
       ●─ − (GND) ──●────────────●──┼───┼───┼───┼────●─────────●────► to MPU GND
                                    │   │   │   │
                                    │   │   │   │  ┌──────────────┐
                                    │   GPIO6  │  │  buzzer       │
                                    │       GPIO5 │  + ─── GPIO10 │
                                    │            │  − ─── GND     │
                                    │            │  └────────────┘
                                    │            │
                              ┌─────┴───────┐    │
                              │  ESP32-C3   │    │
                              │  SuperMini  │────┘
                              │             │
                              │  GPIO7  ────┼─────────► to MPU SDA
                              │  GPIO8  ────┼─────────► to MPU SCL
                              │  GPIO10 ────┼─────────► to buzzer +
                              │  3V3    ────┼─────────► + rail
                              │  GND    ────┼─────────► − rail
                              └─────────────┘
```

Run the full self-test to confirm:

```sh
gochi test all
```

It'll walk through serial → OLED → buzzer → IMU in order, asking a
yes/no question after each. If everything passes, you're done with
the hardware.

## Troubleshooting cheat sheet

| Symptom                                        | First thing to check                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| `gochi ping` doesn't return `PONG`             | USB cable (data, not power); `gochi daemon status`                       |
| OLED is dark but `gochi i2c` shows `0x3C`      | Panel is dead — try a different OLED                                     |
| OLED + `0x3C` both missing                     | SDA/SCL swapped; VCC on wrong rail                                       |
| Buzzer is silent during `gochi test buzzer`    | It's an active buzzer, not passive                                       |
| MPU `0x68` missing on Bus B                    | SDA/SCL swapped on MPU side, or AD0 pulled HIGH (try `0x69`)             |
| MPU `0x68` shows up but gestures don't fire    | Lift more briskly (>1.25 g for 250 ms); shake more vigorously and longer |
| Board enters flash-download mode at boot       | GPIO8 (MPU SCL) floated LOW because MPU was unplugged — plug it back in  |
| Both OLED and MPU stop ACKing at the same time | I²C bus shorted — unplug everything and rebuild one component at a time  |

For anything not on this list, the fastest tool is `gochi i2c` — it
tells you immediately whether a device is electrically alive on the
bus, which separates "wiring problem" from "code problem" in one
command.
