// transport_ble.h — BLE UART transport for wireless communication.
//
// Provides the same line-based protocol as transport.h but over BLE
// using the Nordic UART Service (NUS) UUID scheme. The device advertises
// as "Gochi-XXXX" where XXXX are the last 4 hex digits of the MAC address.
// Compatible with nRF Connect, LightBlue, and custom clients.
#pragma once

#include <stddef.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#include "command.h"

// Nordic UART Service UUIDs (widely supported standard)
#define SERVICE_UUID           "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_RX "6E400002-B5A3-F393-E0A9-E50E24DCCA9E" // Write
#define CHARACTERISTIC_UUID_TX "6E400003-B5A3-F393-E0A9-E50E24DCCA9E" // Notify

class BLETransport {
 public:
  // Initialize BLE with device name "Gochi-XXXX" and start advertising.
  // Returns true on success, false if BLE init fails.
  bool begin(const char* deviceNamePrefix = "Gochi");

  // Non-blocking: if a complete newline-terminated line has arrived via
  // BLE, parse it into `out` and return true. Otherwise return false.
  bool poll(Command& out);

  // Send one response line via BLE notification (newline is appended).
  // Does nothing if no client is connected.
  void println(const char* s);

  // Check if a BLE client is currently connected.
  bool isConnected() const { return connected_; }

  // Stop advertising and clean up BLE resources.
  void end();

 private:
  friend class GochiServerCallbacks;
  friend class GochiCharacteristicCallbacks;

  BLEServer* server_ = nullptr;
  BLECharacteristic* txChar_ = nullptr;
  BLECharacteristic* rxChar_ = nullptr;
  bool connected_ = false;
  bool advertising_ = false;

  // Incoming line buffer — same size as Transport to handle full SHOW image.
  static const size_t kLineCap = 1536;
  char buf_[kLineCap];
  size_t len_ = 0;
  bool overflow_ = false;
  bool lineReady_ = false;  // True when a complete line is waiting

  // Process one incoming character from BLE RX characteristic.
  void handleChar(char c);
};

// BLE callbacks to track connection state.
class GochiServerCallbacks : public BLEServerCallbacks {
 public:
  GochiServerCallbacks(BLETransport* transport) : transport_(transport) {}
  
  void onConnect(BLEServer* server) override {
    transport_->connected_ = true;
    transport_->advertising_ = false;
  }

  void onDisconnect(BLEServer* server) override {
    transport_->connected_ = false;
    // Restart advertising after disconnect so client can reconnect.
    server->startAdvertising();
    transport_->advertising_ = true;
  }

 private:
  BLETransport* transport_;
};

// RX characteristic callbacks to receive incoming data.
class GochiCharacteristicCallbacks : public BLECharacteristicCallbacks {
 public:
  GochiCharacteristicCallbacks(BLETransport* transport) : transport_(transport) {}

  void onWrite(BLECharacteristic* characteristic) override {
    String value = characteristic->getValue();
    for (size_t i = 0; i < value.length(); i++) {
      transport_->handleChar(value[i]);
    }
  }

 private:
  BLETransport* transport_;
};
