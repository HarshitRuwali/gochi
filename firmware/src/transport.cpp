// transport.cpp — buffered serial line transport (see transport.h).

#include "transport.h"

#include <Arduino.h>

void Transport::begin(unsigned long baud) {
  // Default HWCDC RX FIFO on the C3 is only 256 bytes — small enough that
  // a full-frame `SHOW image` payload (~1380 chars) overruns it before
  // the loop can drain it between renders. Grow the FIFO to fit one full
  // line with headroom.
  Serial.setRxBufferSize(2048);
  Serial.begin(baud);
}

bool Transport::poll(Command& out) {
  while (Serial.available() > 0) {
    char c = static_cast<char>(Serial.read());

    if (c == '\n' || c == '\r') {
      if (len_ == 0 && !overflow_) continue;  // blank line / stray CR or LF
      buf_[len_] = '\0';
      bool complete = !overflow_;
      len_ = 0;
      overflow_ = false;
      if (complete) {
        out = parseLine(buf_);
        return true;
      }
      continue;  // oversized line discarded
    }

    if (len_ + 1 < kLineCap) {
      buf_[len_++] = c;
    } else {
      overflow_ = true;  // line too long — drop the rest until newline
    }
  }
  return false;
}

void Transport::println(const char* s) { Serial.println(s); }
