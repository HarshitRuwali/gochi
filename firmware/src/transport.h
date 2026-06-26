// transport.h — buffered serial line transport.
//
// Wraps the USB serial port: accumulates incoming bytes until a newline,
// then parses the completed line into a Command. Phase 2's host CLI will
// speak this same protocol over this same transport.
#pragma once

#include <stddef.h>

#include "command.h"

class BLETransport;  // Forward declaration for optional BLE broadcasting

class Transport {
 public:
  // Open the serial port at the given baud rate.
  void begin(unsigned long baud);

  // Non-blocking: if a complete newline-terminated line has arrived, parse
  // it into `out` and return true. Otherwise return false.
  bool poll(Command& out);

  // Send one response line (a newline is appended).
  void println(const char* s);
  
  // Register a BLE transport for response broadcasting. When set, println()
  // sends to both USB Serial and BLE.
  void setBLEBroadcast(BLETransport* ble);

 private:
  // Sized to hold `SHOW image <base64>` for a full 128x64 1bpp bitmap:
  // 1024 bytes encodes to 1368 chars + the 11-char verb prefix + NUL.
  static const size_t kLineCap = 1536;
  char buf_[kLineCap];
  size_t len_ = 0;
  bool overflow_ = false;
  BLETransport* ble_ = nullptr;
};
