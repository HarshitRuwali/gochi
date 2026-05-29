// motion.cpp — gesture detector (see motion.h).
//
// The math is deliberately cheap — this runs on every loop tick alongside
// the renderer. No FFTs, no allocations, no library deps.
//
// Pickup detector
//   At rest the accelerometer reads ~1.0 g on whichever axis is "down".
//   When the device is lifted, the upward acceleration adds to gravity
//   and |a| spikes above 1.0 g for as long as the lift is sustained.
//   We low-pass |a| with a single-pole IIR and fire once the smoothed
//   magnitude stays above PICKUP_G for PICKUP_HOLD_MS.
//
// Shake detector (Seismic-style energy window on linear acceleration)
//   Two-stage pipeline:
//
//   1. Gravity estimation — a *very slow* low-pass (alpha ≈ 0.02, ~1 s
//      time constant) on each axis tracks the gravity vector. Subtracting
//      gravity from the raw accel gives `linear` — the kinetic component
//      with the gravity offset removed. Works at any orientation
//      because the gravity estimate follows the device as it's tilted.
//
//   2. Sliding-window energy threshold — for each sample, mark it as
//      "accelerating" if |linear| > SHAKE_LIN_G. Maintain a circular
//      buffer of the last SHAKE_BUF_SIZE samples (~½ s at 60 Hz) and
//      count how many were "accelerating." Fire when that count crosses
//      SHAKE_MIN_HITS. A single desk bump produces 1–2 hits in the
//      window; a sustained shake produces 20+, so the discriminator is
//      naturally robust against transient impulses.
//
//   This algorithm is a direct port of Square's Seismic (Android,
//   Apache 2.0), which has been shipping in Cash App and friends for a
//   decade. Replacing the old per-axis sign-flip approach removes the
//   orientation problem (the old code subtracted a hardcoded 1.0 g
//   from z, which only worked when the device was flat) and the
//   bump-vs-shake ambiguity (the old code couldn't tell them apart).
//
// Refractory
//   Once any event fires, none fire again for REFRACTORY_MS — so a
//   vigorous shake reads as one Shake, not a burst, and a pickup
//   immediately followed by jostle reads as one Pickup.

#include "motion.h"

#include <math.h>

namespace {

// === Tuning =====================================================

// Pickup: smoothed |total accel| sustained above this for the hold
// time. Unchanged from before — pickup was working; only shake needed
// the rewrite.
constexpr float PICKUP_G = 1.25f;
constexpr uint32_t PICKUP_HOLD_MS = 250;

// Shake (Seismic-style energy window on linear acceleration).
// Tune SHAKE_LIN_G if shake fires too easily / not easily enough.
// SHAKE_MIN_HITS / SHAKE_BUF_SIZE controls *how sustained* the motion
// has to be — higher = stricter "this isn't a bump."
constexpr float SHAKE_LIN_G = 0.6f;      // kinetic accel threshold per sample
constexpr uint8_t SHAKE_BUF_SIZE = 32;   // ~½ s window at 60 Hz loop
constexpr uint8_t SHAKE_MIN_HITS = 18;   // ~56 % of the window must hit
constexpr uint8_t SHAKE_MIN_FILLED = 24; // don't fire until buffer is warm

// Gravity estimator: very slow low-pass on each accel axis. Time
// constant ≈ 1 / alpha samples ≈ 1 s at 60 Hz. Slow enough that real
// shake motion (lots of fast oscillation) doesn't drag the estimate;
// fast enough to follow re-orienting the device.
constexpr float GRAVITY_ALPHA = 0.02f;

// Shared refractory after any fire — same as before.
constexpr uint32_t REFRACTORY_MS = 1500;

// Startup grace: ignore any motion for the first N ms after begin().
// The MPU has just come out of its reset, the gravity low-pass hasn't
// converged, and the user is almost certainly handling the device
// (just plugged USB in / picked it up to look at the OLED). Without
// this window the detector reliably fires a false Shake at boot.
constexpr uint32_t STARTUP_GRACE_MS = 1500;

// Single-pole IIR for pickup magnitude smoothing — same as before.
constexpr float MAG_SMOOTH_ALPHA = 0.2f;

// === State =====================================================

float magSmoothed = 1.0f;      // low-passed |total a| in g (for pickup)
uint32_t pickupHighSince = 0;  // ms when |a| first crossed PICKUP_G
uint32_t lastEventMs = 0;      // for refractory
uint32_t startMs = 0;          // millis() of first update — 0 = not seen yet

// Running gravity vector estimate (one slow low-pass per axis). Lazily
// seeded from the first sample so we don't have to wait a full time
// constant for the estimate to settle from a wrong (0, 0, 1) prior.
float gravityX = 0.0f, gravityY = 0.0f, gravityZ = 1.0f;
bool gravitySeeded = false;

// Shake circular buffer — each slot stores whether |linear| at that
// sample crossed SHAKE_LIN_G. shakeHits is the running count of `true`
// entries in the buffer (O(1) update — we add/subtract as we rotate
// through, never scan the whole buffer).
bool shakeBuf[SHAKE_BUF_SIZE];
uint8_t shakeIdx = 0;
uint8_t shakeHits = 0;
uint8_t shakeFilled = 0;  // saturates at SHAKE_BUF_SIZE

void resetShake() {
  for (uint8_t i = 0; i < SHAKE_BUF_SIZE; ++i) shakeBuf[i] = false;
  shakeIdx = 0;
  shakeHits = 0;
  shakeFilled = 0;
}

// Push one sample's "is this accelerating?" verdict into the circular
// buffer, keeping shakeHits in sync.
void pushShakeSample(bool accelerating) {
  if (shakeBuf[shakeIdx]) shakeHits--;
  shakeBuf[shakeIdx] = accelerating;
  if (accelerating) shakeHits++;
  shakeIdx = (shakeIdx + 1) % SHAKE_BUF_SIZE;
  if (shakeFilled < SHAKE_BUF_SIZE) shakeFilled++;
}

}  // namespace

namespace motion {

void begin() {
  magSmoothed = 1.0f;
  pickupHighSince = 0;
  lastEventMs = 0;
  startMs = 0;  // re-armed on the first update() call
  gravityX = 0.0f;
  gravityY = 0.0f;
  gravityZ = 1.0f;
  gravitySeeded = false;
  resetShake();
}

Event update(const imu::Sample& s, uint32_t now) {
  if (startMs == 0) startMs = now;
  bool inStartupGrace = (now - startMs) < STARTUP_GRACE_MS;

  // Seed the gravity estimate from the very first sample. Without this
  // the estimate would take ~1 s to converge from the (0,0,1) prior and
  // every gesture in that window would look like garbage.
  if (!gravitySeeded) {
    gravityX = s.accel.x;
    gravityY = s.accel.y;
    gravityZ = s.accel.z;
    gravitySeeded = true;
  } else {
    gravityX += GRAVITY_ALPHA * (s.accel.x - gravityX);
    gravityY += GRAVITY_ALPHA * (s.accel.y - gravityY);
    gravityZ += GRAVITY_ALPHA * (s.accel.z - gravityZ);
  }

  // Linear (kinetic) accel — what's left after pulling gravity out.
  // At rest this is ≈ (0, 0, 0) regardless of orientation; under
  // motion it's the actual force you're applying to the device.
  float lx = s.accel.x - gravityX;
  float ly = s.accel.y - gravityY;
  float lz = s.accel.z - gravityZ;
  float linMag = sqrtf(lx * lx + ly * ly + lz * lz);

  // Pickup uses total |a| (gravity contributes there — being lifted
  // means the *total* magnitude crosses 1 g while it's accelerating).
  float mag = sqrtf(s.accel.x * s.accel.x + s.accel.y * s.accel.y + s.accel.z * s.accel.z);
  magSmoothed += MAG_SMOOTH_ALPHA * (mag - magSmoothed);

  // Feed the shake window — but only after the startup grace, so boot
  // handling doesn't load it with phantom hits. During grace we still
  // let gravity converge above; we just don't accumulate shake history.
  if (!inStartupGrace) {
    pushShakeSample(linMag > SHAKE_LIN_G);
  }

  // Startup grace: gravity is still settling and the MPU just woke up.
  // Suppress all firing so we don't ship a Shake the moment imu::isReady
  // flips true.
  if (inStartupGrace) {
    pickupHighSince = 0;
    return Event::None;
  }

  // Refractory: hold quiet for a bit so one gesture = one event.
  if (lastEventMs != 0 && now - lastEventMs < REFRACTORY_MS) {
    pickupHighSince = 0;
    return Event::None;
  }

  // Shake first — a vigorous shake also satisfies the pickup criterion,
  // so checking pickup first would always win and shake would never
  // fire (the same ordering quirk as in the old detector).
  if (shakeFilled >= SHAKE_MIN_FILLED && shakeHits >= SHAKE_MIN_HITS) {
    lastEventMs = now;
    // Clear the window so we don't immediately re-fire on the same
    // motion the moment refractory ends.
    resetShake();
    pickupHighSince = 0;
    return Event::Shake;
  }

  // Pickup: smoothed total |a| above 1.25 g for 250 ms continuously.
  if (magSmoothed > PICKUP_G) {
    if (pickupHighSince == 0) pickupHighSince = now;
    if (now - pickupHighSince >= PICKUP_HOLD_MS) {
      pickupHighSince = 0;
      lastEventMs = now;
      return Event::Pickup;
    }
  } else {
    pickupHighSince = 0;
  }

  return Event::None;
}

}  // namespace motion
