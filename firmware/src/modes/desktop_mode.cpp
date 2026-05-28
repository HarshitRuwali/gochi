// desktop_mode.cpp — the Phase 1 desktop-pet mode (see desktop_mode.h).

#include "desktop_mode.h"

#include <Arduino.h>
#include <Wire.h>
#include <mbedtls/base64.h>
#include <stdio.h>

#include "../assets/expressions.h"
#include "../command.h"
#include "../imu/mpu6050.h"
#include "../renderer.h"
#include "../transport.h"
#include "../views/image_view.h"
#include "../views/view_manager.h"

namespace {

// Idle fallback: if no command arrives for this long, blink so the pet
// never looks frozen. The gate lets the behavior be disabled wholesale.
const bool IDLE_FALLBACK = true;
const uint32_t IDLE_TIMEOUT_MS = 30000;

}  // namespace

DesktopMode::DesktopMode(Transport& tx, Renderer& renderer, Mood& mood)
    : tx_(tx), renderer_(renderer), mood_(mood) {}

void DesktopMode::onEnter(ViewManager& vm) {
  // Keep whatever expression is showing (e.g. handed over from Free Mode);
  // just make sure the face view is the active one.
  vm.setView(&vm.face());
  lastCmdMs_ = millis();
}

void DesktopMode::update(uint32_t now, ViewManager& vm) {
  if (!IDLE_FALLBACK) return;
  // Only the face view needs this: the text view already scrolls and the
  // image view is intentionally static, so neither looks "frozen".
  if (!vm.isFaceActive()) return;
  if (now - lastCmdMs_ >= IDLE_TIMEOUT_MS) {
    vm.face().blinkOnce();  // subtle "still alive" cue
    lastCmdMs_ = now;       // schedule the next idle blink
  }
}

void DesktopMode::onCommand(const Command& cmd, ViewManager& vm) {
  lastCmdMs_ = millis();
  switch (cmd.type) {
    case CmdType::ShowFace: {
      const Expression* e = findExpressionByName(cmd.arg1);
      if (e == nullptr) {
        tx_.println("ERR unknown face");
        return;
      }
      vm.face().setExpression(e->id);
      vm.setView(&vm.face());
      tx_.println("OK");
      break;
    }
    case CmdType::ShowText:
      vm.text().setText(cmd.arg1);
      vm.setView(&vm.text());
      tx_.println("OK");
      break;
    case CmdType::ShowImage: {
      // Decode the base64 frame directly into a scratch buffer the size
      // of one screen, then hand it to ImageView (which copies it into
      // its own member buffer).
      static uint8_t scratch[ImageView::BITMAP_BYTES];
      size_t out = 0;
      int rc = mbedtls_base64_decode(scratch, sizeof(scratch), &out,
                                     reinterpret_cast<const unsigned char*>(cmd.payload),
                                     cmd.payloadLen);
      if (rc != 0 || out == 0) {
        tx_.println("ERR bad image base64");
        return;
      }
      vm.image().setBitmap(scratch, out);
      vm.setView(&vm.image());
      tx_.println("OK");
      break;
    }
    case CmdType::SetMood: {
      // Set the shared pet mood; Free Mode acts on it when it next runs.
      Mood mood;
      if (moodFromName(cmd.arg1, mood)) {
        mood_ = mood;
        tx_.println("OK");
      } else {
        tx_.println("ERR unknown mood");
      }
      break;
    }
    case CmdType::GetState:
      sendState_(vm);
      break;
    case CmdType::GetFps: {
      char buf[24];
      snprintf(buf, sizeof(buf), "fps %d", renderer_.fps());
      tx_.println(buf);
      break;
    }
    case CmdType::ListFaces:
      sendFaceList_();
      break;
    case CmdType::Ping:
      tx_.println("PONG");
      break;
    case CmdType::ScanI2c:
      sendI2cScan_();
      break;
    case CmdType::Unknown:
    default:
      tx_.println("ERR unknown command");
      break;
  }
}

void DesktopMode::sendState_(ViewManager& vm) {
  char buf[96];
  snprintf(buf, sizeof(buf), "{\"view\":\"%s\",\"expr\":\"%s\"}", vm.activeViewName(),
           expressionName(vm.face().expression()));
  tx_.println(buf);
}

void DesktopMode::sendI2cScan_() {
  // Scan both I2C buses and emit a single JSON line. Bus A is the
  // hardware I2C (Wire, GPIO5/6) — the OLED. Bus B is the bit-banged
  // bus the MPU lives on (GPIO7/8). Standard 7-bit range is 0x08..0x77.
  char buf[160];
  size_t n = 0;
  n += snprintf(buf + n, sizeof(buf) - n, "{\"A\":[");
  bool first = true;
  for (uint8_t addr = 0x08; addr < 0x78; ++addr) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() != 0) continue;
    n += snprintf(buf + n, sizeof(buf) - n, "%s\"0x%02X\"", first ? "" : ",", addr);
    first = false;
  }
  n += snprintf(buf + n, sizeof(buf) - n, "],\"B\":[");
  first = true;
  for (uint8_t addr = 0x08; addr < 0x78; ++addr) {
    if (!imu::probe(addr)) continue;
    n += snprintf(buf + n, sizeof(buf) - n, "%s\"0x%02X\"", first ? "" : ",", addr);
    first = false;
  }
  snprintf(buf + n, sizeof(buf) - n, "]}");
  tx_.println(buf);
}

void DesktopMode::sendFaceList_() {
  char buf[160];
  size_t n = 0;
  for (uint8_t i = 0; i < expressionCount(); i++) {
    const char* name = getExpression(static_cast<ExpressionId>(i)).name;
    if (i > 0 && n + 1 < sizeof(buf)) buf[n++] = ',';
    for (const char* s = name; *s != '\0' && n + 1 < sizeof(buf); s++) {
      buf[n++] = *s;
    }
  }
  buf[n] = '\0';
  tx_.println(buf);
}
