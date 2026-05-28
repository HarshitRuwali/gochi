// desktop_mode.h — the Phase 1 mode: a passive, command-driven desktop pet.
#pragma once

#include <stdint.h>

#include "../mood.h"
#include "mode.h"

class Transport;
class Renderer;

// DesktopMode is the command-driven mode: it shows whatever view and
// expression it is told to over the serial protocol, and blinks every so
// often while idle so the display never looks frozen. It is the sibling
// of FreeMode; the main sketch switches between them.
class DesktopMode : public Mode {
 public:
  // The transport sends command responses (OK / ERR / payloads); the
  // renderer is queried for GET fps; mood is the shared pet mood that
  // `SET mood` writes (Free Mode reads it).
  DesktopMode(Transport& tx, Renderer& renderer, Mood& mood);

  void onEnter(ViewManager& vm) override;
  void update(uint32_t now, ViewManager& vm) override;
  void onCommand(const Command& cmd, ViewManager& vm) override;

 private:
  void sendState_(ViewManager& vm);
  void sendFaceList_();
  void sendI2cScan_();

  Transport& tx_;
  Renderer& renderer_;
  Mood& mood_;
  uint32_t lastCmdMs_ = 0;  // time of the last received command
};
