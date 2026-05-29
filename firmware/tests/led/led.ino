// led.ino — on-board LED blink test.
//
// Smallest possible "is the board alive and flashed correctly?" sketch.
// Toggles LED_BUILTIN at 1 Hz. The ESP32-C3 SuperMini's on-board LED is
// active-LOW (GPIO8 idles HIGH = off), which Arduino's digitalWrite()
// handles transparently as long as you trust the polarity below.
//
// Build:  arduino-cli compile --profile c3
// Flash:  arduino-cli upload  --profile c3 --port /dev/cu.usbmodem<…>

#include <Arduino.h>

static const uint32_t BLINK_MS = 500;  // half-period, so 1 Hz overall

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  // SuperMini LED is active-low: start it off.
  digitalWrite(LED_BUILTIN, HIGH);
  Serial.println("led_blink: blinking LED_BUILTIN at 1 Hz");
}

void loop() {
  static uint32_t lastMs = 0;
  static bool on = false;
  uint32_t now = millis();
  if (now - lastMs >= BLINK_MS) {
    lastMs = now;
    on = !on;
    // Active-low LED: LOW = on, HIGH = off.
    digitalWrite(LED_BUILTIN, on ? LOW : HIGH);
  }
}
