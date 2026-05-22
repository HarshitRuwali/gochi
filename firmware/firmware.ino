// firmware.ino — ESP32-C3 SuperMini firmware
//
// OLED smoke-test: shows "hello" centered on a 128x64 SSD1306 display.

#include <U8g2lib.h>

// SSD1306 0.96" 128x64 OLED, wired over I2C.
// SuperMini GPIO5 -> SDA, GPIO6 -> SCL (3V3 + GND for power).
constexpr uint8_t OLED_SDA = 5;
constexpr uint8_t OLED_SCL = 6;

// Software (bit-banged) I2C so the exact SDA/SCL pins above are honoured;
// _F_ = full frame buffer, giving the clearBuffer()/sendBuffer() API.
U8G2_SSD1306_128X64_NONAME_F_SW_I2C oled(U8G2_R0, OLED_SCL, OLED_SDA,
                                         U8X8_PIN_NONE);

void setup() {
  oled.begin();

  oled.clearBuffer();
  oled.setFont(u8g2_font_ncenB14_tr);
  oled.setFontPosCenter();

  const char *msg = "hello";
  int16_t x = (oled.getDisplayWidth() - oled.getStrWidth(msg)) / 2;
  oled.drawStr(x, oled.getDisplayHeight() / 2, msg);

  oled.sendBuffer();
}

void loop() {
}
