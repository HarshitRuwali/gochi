// command.h — the device command model.
//
// This is the seam shared with future host tooling: Phase 2's CLI and
// server will emit this exact line protocol, so nothing here changes.
//
// Line protocol (newline-terminated, typeable in a serial monitor):
//   SHOW face <name>      switch to a face expression
//   SHOW text <string>    switch to the text view ("<string>" = rest of line)
//   SHOW image <base64>   push a 128x64 1bpp bitmap (1024 bytes, MSB-first)
//   SET mood <name>       Phase 1: accepted and acked, no behavior yet
//   GET state             query the current view + expression
//   GET fps               query the current display frame rate
//   LIST faces            list all expression names
//   PING                  liveness check
//   SCAN i2c              enumerate devices on both I2C buses; replies
//                         {"A":["0x3C"],"B":["0x68"]}
#pragma once

#include <stddef.h>

enum class CmdType {
  ShowFace,
  ShowText,
  ShowImage,
  SetMood,
  GetState,
  GetFps,
  ListFaces,
  Ping,
  ScanI2c,
  Unknown,
};

struct Command {
  CmdType type;
  char arg1[64];  // face name, mood name, or text payload
  int arg2;       // optional numeric argument (e.g. duration ms); -1 if unset

  // For ShowImage: pointer into the transport's line buffer at the start
  // of the base64 payload, with `payloadLen` bytes. The pointer is valid
  // only until the next Transport::poll() — DesktopMode consumes it
  // synchronously, so this is safe in practice.
  const char* payload;
  size_t payloadLen;
};

// Parse one protocol line into a Command. Never fails: an unrecognized
// line yields CmdType::Unknown. The input string is not modified.
Command parseLine(const char* line);
