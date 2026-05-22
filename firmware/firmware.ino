// firmware.ino — Tamagotchi firmware entry point (ESP32-C3 SuperMini).
//
// The pet boots into Free Mode and lives on its own (see modes/free_mode):
// it wanders through moods and shows matching expressions. Any serial
// command hands control to Desktop Mode; ~60 s with no command returns it
// to Free Mode. The buzzer is synced to the face — every change jingles in
// Desktop Mode, only mood shifts jingle in Free Mode. See firmware/README.

#include "src/assets/expressions.h"
#include "src/assets/jingles.h"
#include "src/buzzer/buzzer.h"
#include "src/command.h"
#include "src/config.h"
#include "src/modes/desktop_mode.h"
#include "src/modes/free_mode.h"
#include "src/modes/mode.h"
#include "src/mood.h"
#include "src/renderer.h"
#include "src/transport.h"
#include "src/views/view_manager.h"

// The pet's mood — shared between the modes: SET mood writes it, Free Mode
// reads and slowly evolves it. RAM-only (a reboot resets it to content).
static Mood petMood = Mood::Content;

static Renderer renderer;
static Transport transport;
static ViewManager viewManager;
static DesktopMode desktopMode(transport, renderer, petMood);
static FreeMode freeMode(petMood);

// Free Mode is the default; a command switches to Desktop Mode.
static Mode* currentMode = &freeMode;
static uint32_t lastCmdMs = 0;  // time of the last command
static ExpressionId jingledExpr = ExpressionId::Count;

// No serial command for this long, while in Desktop Mode, drifts to Free.
static const uint32_t IDLE_TO_FREE_MS = 60000;

// Hand off between modes via the Mode onExit/onEnter hooks.
static void setMode(Mode& mode) {
  if (currentMode == &mode) return;
  currentMode->onExit();
  currentMode = &mode;
  currentMode->onEnter(viewManager);
}

void setup() {
  transport.begin(115200);
  renderer.init();
  buzzer::begin();

  // Buttons are wired but unused — configured so the pins start known.
  pinMode(PIN_BTN_A, INPUT_PULLUP);
  pinMode(PIN_BTN_B, INPUT_PULLUP);
  pinMode(PIN_BTN_C, INPUT_PULLUP);

  currentMode->onEnter(viewManager);  // boots into Free Mode
  transport.println("Tamagotchi ready (Free Mode). Send any command for Desktop Mode.");
}

void loop() {
  uint32_t now = millis();

  Command cmd;
  if (transport.poll(cmd)) {
    lastCmdMs = now;
    setMode(desktopMode);  // any command means a host is driving the pet
    currentMode->onCommand(cmd, viewManager);
  } else if (currentMode == &desktopMode && now - lastCmdMs >= IDLE_TO_FREE_MS) {
    setMode(freeMode);  // gone idle — let the pet live on its own
  }

  currentMode->update(now, viewManager);

  // Buzzer synced to the face. In Desktop Mode every expression change
  // jingles; Free Mode stays quieter and plays its own jingle only on
  // mood shifts, so it is not gated in here.
  ExpressionId expr = viewManager.face().expression();
  if (expr != jingledExpr) {
    jingledExpr = expr;
    if (currentMode == &desktopMode) {
      Jingle jingle = jingleFor(expr);
      buzzer::play(jingle.tones, jingle.count);
    }
  }
  buzzer::update(now);

  renderer.beginFrame();
  viewManager.tick(now, renderer);
  renderer.endFrame();
}
