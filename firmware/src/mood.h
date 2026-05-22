// mood.h — the pet's mood.
//
// The mood is shared pet state: `SET mood` writes it, and Free Mode reads
// it (and slowly evolves it) to decide which expressions to show.
#pragma once

#include <stdint.h>

enum class Mood : uint8_t {
  Content,
  Playful,
  Grumpy,
  Sleepy,
  Affectionate,
  Count  // sentinel: number of moods, not a mood itself
};

// Lowercase name for a mood (used by the `SET mood <name>` command).
const char* moodName(Mood m);

// Parse a mood name (case-insensitive). Returns false if unrecognized.
bool moodFromName(const char* name, Mood& out);
