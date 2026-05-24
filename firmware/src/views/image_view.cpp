// image_view.cpp — the host-pushed bitmap view (see image_view.h).

#include "image_view.h"

#include <string.h>

#include "../config.h"
#include "../renderer.h"

void ImageView::setBitmap(const uint8_t* data, size_t len) {
  if (data == nullptr) {
    memset(bitmap_, 0, BITMAP_BYTES);
    return;
  }
  size_t n = len < BITMAP_BYTES ? len : BITMAP_BYTES;
  memcpy(bitmap_, data, n);
  if (n < BITMAP_BYTES) memset(bitmap_ + n, 0, BITMAP_BYTES - n);
}

void ImageView::render(Renderer& r) { r.drawBitmap(0, 0, bitmap_, OLED_W, OLED_H); }
