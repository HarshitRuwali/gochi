// config.h — ESP32-C3 SuperMini pin map and panel geometry.
//
// Single source of truth for pins and display constants. Nothing else in
// the firmware should hard-code a GPIO number or panel dimension.
#pragma once

// --- I2C OLED (SSD1306, driven over software I2C by U8g2) --------------
#define PIN_SDA 5
#define PIN_SCL 6

// --- Push buttons (active-low, wired to GND, internal pull-ups) --------
// NOTE: GPIO2 is an ESP32-C3 strapping pin. With INPUT_PULLUP it idles
// HIGH, which is the level the bootloader expects, so BTN_A is safe as
// long as the button is not held down during power-up / flashing. Move it
// to a free GPIO if that ever causes boot trouble. GPIO3 and GPIO4 are not
// strapping pins. (Buttons are wired but unused in Phase 1.)
#define PIN_BTN_A 2
#define PIN_BTN_B 3
#define PIN_BTN_C 4

// --- On-board BOOT button (GPIO9) --------------------------------------
// GPIO9 is the ESP32-C3 strapping pin: holding it LOW during power-up
// enters flash-download mode. After boot it is just a normal input — used
// here as a "next expression" button. Don't hold it while powering on.
#define PIN_BTN_BOOT 9

// --- Passive piezo buzzer ----------------------------------------------
#define PIN_BUZZER 10

// --- OLED panel --------------------------------------------------------
// U8g2's NONAME constructor already targets I2C address 0x3C; OLED_ADDR is
// kept for reference and for any future driver swap.
#define OLED_ADDR 0x3C
#define OLED_W 128
#define OLED_H 64

// --- MPU-6050 IMU (3-axis accel + gyro, on its OWN I2C bus -------------
// We originally shared the OLED I2C bus (GPIO5/6) but with both devices'
// pull-ups in parallel the bus rise time blew past the 400 kHz fast-mode
// budget — address bytes got corrupted and the two devices alternated
// ACKs at random. Putting the MPU on the C3's second I2C peripheral
// (Wire1) with its own pins isolates the two completely.
//
// The C3 has only ONE hardware I2C controller (Wire), already used by
// the OLED — so the MPU bus is software bit-banged on two ordinary
// GPIOs. The MPU module's on-board pull-ups (to its VCC) hold the lines
// HIGH; we drive LOW by switching pinMode to OUTPUT+LOW and "release"
// by switching back to INPUT (lets the pull-up float the line HIGH).
//
// GPIO7 is unrestricted. GPIO8 is a strapping pin — must idle HIGH at
// boot, which the MPU's pull-up handles, so plug the MPU in *before*
// powering the board. If GPIO8 floats LOW at reset the chip enters
// flash-download mode and no firmware runs.
#define PIN_MPU_SDA 7
#define PIN_MPU_SCL 8

// AD0 floating / tied LOW → 0x68; AD0 tied HIGH → 0x69. Most GY-521-style
// breakouts default to 0x68 — flip this if your module pulls AD0 high.
#define MPU_ADDR 0x68
