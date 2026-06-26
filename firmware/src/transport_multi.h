// transport_multi.h — transport multiplexer for dual USB+BLE.
//
// Wraps both Transport (USB Serial) and BLETransport and broadcasts
// println() calls to both. Used by DesktopMode so responses reach
// whichever transport the command came from (or both if needed).
#pragma once

#include "transport.h"
#include "transport_ble.h"

class MultiTransport {
 public:
  MultiTransport(Transport& serial, BLETransport& ble)
      : serial_(serial), ble_(ble) {}

  // Send response to both USB Serial and BLE (if connected).
  void println(const char* s) {
    serial_.println(s);
    if (ble_.isConnected()) {
      ble_.println(s);
    }
  }

 private:
  Transport& serial_;
  BLETransport& ble_;
};
