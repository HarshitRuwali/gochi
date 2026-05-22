// free_mode.h — the autonomous mode: the pet lives on its own.
//
// Free Mode is the device's default state — it boots into it. The pet
// wanders through moods (see mood.h) and the current mood drives which
// expressions it shows. Any serial command hands control to DesktopMode;
// going idle returns here. Sibling to DesktopMode under the Mode interface.
#pragma once

#include <stdint.h>

#include "../mood.h"
#include "mode.h"

class FreeMode : public Mode {
 public:
  // `mood` is the shared pet mood — SET mood writes it, the drift evolves it.
  explicit FreeMode(Mood& mood);

  void onEnter(ViewManager& vm) override;
  void update(uint32_t now, ViewManager& vm) override;

 private:
  // Pick a fresh expression from the current mood's pool. `sound` plays a
  // (quiet) jingle — used for mood shifts, not routine ticks.
  void pickExpression_(uint32_t now, ViewManager& vm, bool sound);
  void scheduleExpr_(uint32_t now);
  void scheduleMood_(uint32_t now);

  Mood& mood_;
  uint32_t nextExprMs_ = 0;  // when to pick the next expression
  uint32_t nextMoodMs_ = 0;  // when the mood may next drift
};
