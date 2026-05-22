// mood.cpp — the pet's mood (see mood.h).

#include "mood.h"

#include <strings.h>  // strcasecmp

namespace {

// Indexed by Mood; order must match the Mood enum.
const char* const NAMES[] = {"content", "playful", "grumpy", "sleepy", "affectionate"};

}  // namespace

const char* moodName(Mood m) {
  uint8_t i = static_cast<uint8_t>(m);
  if (i >= static_cast<uint8_t>(Mood::Count)) return NAMES[0];
  return NAMES[i];
}

bool moodFromName(const char* name, Mood& out) {
  if (name == nullptr) return false;
  for (uint8_t i = 0; i < static_cast<uint8_t>(Mood::Count); i++) {
    if (strcasecmp(NAMES[i], name) == 0) {
      out = static_cast<Mood>(i);
      return true;
    }
  }
  return false;
}
