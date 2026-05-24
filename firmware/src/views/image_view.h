// image_view.h — a View that displays a 128x64 1-bit bitmap from the host.
//
// The host (CLI) decodes a PNG/JPG, resizes it to 128x64, dithers to
// 1-bit, packs the rows MSB-first (16 bytes per row, 1024 bytes total),
// base64-encodes and sends `SHOW image <base64>` over serial. DesktopMode
// decodes the base64 and copies the bitmap in via setBitmap().
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "view.h"

class ImageView : public View {
 public:
  // Total bytes for a full-screen 128x64 1bpp bitmap (16 rows of 8 cols).
  static const size_t BITMAP_BYTES = 1024;

  // Copy `len` bytes from `data` into the internal buffer. If `len` is
  // smaller than BITMAP_BYTES, the remainder is zeroed. Larger inputs are
  // truncated. Safe to call from the command handler at any time.
  void setBitmap(const uint8_t* data, size_t len);

  void update(uint32_t /*now*/) override {}
  void render(Renderer& r) override;

 private:
  uint8_t bitmap_[BITMAP_BYTES] = {0};
};
