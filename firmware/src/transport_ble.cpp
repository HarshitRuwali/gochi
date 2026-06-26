// transport_ble.cpp — BLE UART transport implementation.

#include "transport_ble.h"
#include <Arduino.h>
#include <esp_bt.h>

bool BLETransport::begin(const char* deviceNamePrefix) {
  // Generate device name with last 4 hex digits of MAC address.
  uint64_t macInt = ESP.getEfuseMac();
  uint8_t mac[6];
  for (int i = 0; i < 6; i++) {
    mac[i] = (macInt >> (8 * i)) & 0xFF;
  }
  char deviceName[32];
  snprintf(deviceName, sizeof(deviceName), "%s-%02X%02X", 
           deviceNamePrefix, mac[4], mac[5]);

  // Initialize BLE.
  BLEDevice::init(deviceName);
  
  // Create BLE server and set callbacks.
  server_ = BLEDevice::createServer();
  server_->setCallbacks(new GochiServerCallbacks(this));

  // Create service with Nordic UART Service UUID.
  BLEService* service = server_->createService(SERVICE_UUID);

  // TX characteristic (device → client notifications).
  txChar_ = service->createCharacteristic(
    CHARACTERISTIC_UUID_TX,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  txChar_->addDescriptor(new BLE2902());

  // RX characteristic (client → device writes).
  rxChar_ = service->createCharacteristic(
    CHARACTERISTIC_UUID_RX,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  rxChar_->setCallbacks(new GochiCharacteristicCallbacks(this));

  // Start service and advertising.
  service->start();
  
  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  // Faster connection with iPhone (workaround for iOS connection issues).
  advertising->setMinPreferred(0x06);
  advertising->setMaxPreferred(0x12);
  
  BLEDevice::startAdvertising();
  advertising_ = true;

  return true;
}

void BLETransport::handleChar(char c) {
  if (c == '\n' || c == '\r') {
    if (len_ == 0 && !overflow_) return;  // blank line / stray CR or LF
    buf_[len_] = '\0';
    
    // Mark line as ready if it wasn't an overflow.
    if (!overflow_) {
      lineReady_ = true;
    }
    
    // Reset overflow state.
    if (overflow_) {
      len_ = 0;
      overflow_ = false;
    }
    return;
  }

  if (len_ + 1 < kLineCap) {
    buf_[len_++] = c;
  } else {
    overflow_ = true;  // line too long — drop the rest until newline
  }
}

bool BLETransport::poll(Command& out) {
  // Check if we have a complete line ready.
  if (lineReady_) {
    out = parseLine(buf_);
    len_ = 0;
    lineReady_ = false;
    return true;
  }
  
  return false;
}

void BLETransport::println(const char* s) {
  if (!connected_ || !txChar_) return;
  
  // BLE characteristics have a max size (typically 512 bytes, but safer
  // to chunk). We'll send in chunks of 512 bytes max.
  size_t len = strlen(s);
  const size_t chunkSize = 512;
  
  // Send the string in chunks if needed.
  for (size_t i = 0; i < len; i += chunkSize) {
    size_t remaining = len - i;
    size_t toSend = remaining < chunkSize ? remaining : chunkSize;
    txChar_->setValue((uint8_t*)(s + i), toSend);
    txChar_->notify();
    delay(10);  // Small delay between chunks for reliability
  }
  
  // Send newline.
  txChar_->setValue((uint8_t*)"\n", 1);
  txChar_->notify();
}

void BLETransport::end() {
  if (advertising_) {
    BLEDevice::getAdvertising()->stop();
    advertising_ = false;
  }
  if (server_) {
    // BLE library handles cleanup
  }
  BLEDevice::deinit();
}
