# Bluetooth LE Setup Guide

Your Gochi device now supports wireless communication via Bluetooth Low Energy (BLE)!

## Firmware Setup

### Enable BLE in Firmware

The firmware supports both USB Serial and BLE simultaneously. BLE is enabled by default.

In `firmware/firmware.ino`, ensure this line is set to 1:
```cpp
#define BLE_ENABLED 1
```

### How it Works

When BLE is enabled:
- The device advertises as `Gochi-XXXX` (where XXXX are the last 4 hex digits of the MAC address)
- Both USB Serial and BLE transports work simultaneously
- Commands received from either transport get responses sent to both

### Flash the Firmware

```bash
make flash
```

## Using BLE to Control Your Device

You have two excellent options for wireless control:

### Option 1: Web Browser Controller (Recommended)

The easiest way to control your Gochi device is through the included web page:

1. **Open the web controller:**
   ```bash
   open web-ble-controller.html
   ```
   
2. **Click "Connect to Gochi"** - Your browser will scan for devices

3. **Select your device** from the list (e.g., "Gochi-EE74")

4. **Start controlling!** 
   - Switch faces with one click
   - Set moods
   - Send custom text
   - Run commands like PING, GET state
   - See all device responses in real-time

**Requirements:**
- Chrome, Edge, or any Chromium-based browser
- macOS, Windows, Linux, or Android (iOS Safari doesn't support Web Bluetooth)

### Option 2: Mobile Apps

Use professional BLE debugging apps on your phone or tablet:

### Option 2: Mobile Apps

Use professional BLE debugging apps on your phone or tablet:

#### nRF Connect (iOS/Android)
1. Download "nRF Connect" from the App Store or Google Play
2. Scan for "Gochi-XXXX"
3. Connect to the device
4. Find the Nordic UART Service
5. Enable notifications on the TX characteristic (to see responses)
6. Write commands to the RX characteristic:
   - Write as UTF-8 text
   - Include newline: `SHOW face happy\n`
7. Responses appear in TX notifications

#### LightBlue (iOS/macOS)
1. Download "LightBlue" from the App Store
2. Scan and connect to "Gochi-XXXX"
3. Find the Nordic UART Service
4. Subscribe to TX characteristic for responses
5. Write UTF-8 strings to RX characteristic with newline

## Troubleshooting

### Web controller can't find device

Make sure:
- You're using Chrome, Edge, or a Chromium-based browser
- Bluetooth is enabled on your computer
- Your Gochi device is powered on and nearby
- The firmware has been flashed with BLE enabled (`BLE_ENABLED 1`)

### "No devices found" when scanning

- Power cycle the Gochi device
- Check that the firmware compiled successfully with BLE support
- Try moving closer to the device (BLE range is ~10 meters)
- Refresh the web page and try again

### Connection fails or drops

- Make sure no other device is connected to the Gochi
- Close other BLE applications
- Restart Bluetooth on your computer/phone
- Power cycle the Gochi device

### macOS Bluetooth Permissions

On macOS, you may need to grant Bluetooth permissions to your browser in:

System Settings → Privacy & Security → Bluetooth

## Available Commands

Send these commands via the web controller or mobile apps:

### Display Commands
- `SHOW face <name>` - Switch expressions (neutral, happy, sad, sleepy, excited, surprised, angry, love, shy)
- `SHOW text <message>` - Display scrolling text
- `SET mood <name>` - Set mood (content, playful, grumpy, sleepy, affectionate)

### Query Commands
- `PING` - Check connection (returns "PONG")
- `GET state` - Get current view and expression
- `GET fps` - Get display frame rate
- `LIST faces` - List all available expressions
- `SCAN i2c` - Scan I2C buses for devices

## Advanced Features: Spotify & Status

### Spotify "Now Playing" Integration

Your Gochi can display the currently playing song from Spotify! This feature requires the daemon running on your laptop/desktop, but once set up, your Gochi automatically updates with song info.

**How it works:**
1. The daemon polls Spotify's API and caches the current song info
2. It automatically displays "Artist - Song Name" on your Gochi
3. The daemon handles OAuth tokens, image conversion, etc.
4. Updates happen every 5 seconds while Spotify is playing

**Initial Setup (One-time, from laptop/desktop):**

First, get a Spotify Client ID:
1. Go to https://developer.spotify.com/dashboard
2. Create an app (name it "Gochi" or whatever you like)
3. Copy the Client ID
4. In "Edit Settings", add `http://127.0.0.1:8765/callback` to "Redirect URIs"
5. Click "Save"

Then set up the CLI:
```bash
# Make sure daemon is running
gochi setup

# Login to Spotify (opens browser for OAuth)
gochi spotify login YOUR_SPOTIFY_CLIENT_ID

# Start watching Spotify (this runs continuously)
gochi spotify watch
```

The `spotify watch` command will:
- Poll Spotify every 5 seconds
- Display "Artist - Song Name" as scrolling text on your Gochi
- Continue until you press Ctrl-C

**Alternative: One-shot updates**

Instead of continuous watching, you can manually trigger updates:
```bash
gochi spotify now
```

This displays the current song once and exits.

**While Spotify is running:**

Your Gochi will automatically update with song info. You can still use BLE to override the display temporarily:

```
SHOW face happy\n
```

This overrides the Spotify display until the next poll (5 seconds).

**Pro tip:** Keep `gochi spotify watch` running in a terminal on your laptop, and use BLE from your phone to change faces/status throughout the day!

### Office Status Profiles

Set your availability status! Perfect for displaying your work state to colleagues.

**Note:** Status profiles are a daemon-level convenience. When using BLE directly, you need to send the individual commands. The web controller handles this automatically!

**Via Web Controller:**
Just click the status button! The web page sends the right commands automatically.

**Via BLE directly (LightBlue app):**
Send the commands in sequence. For example, for "In Meeting" status:

1. Write to RX: `SET mood content\n`
2. Write to RX: `SHOW text In Meeting\n`

**Status Profile Commands:**

| Status | Commands to Send |
|--------|------------------|
| **Available** | `SET mood content` → `SHOW face happy` |
| **Busy** | `SET mood grumpy` → `SHOW face neutral` |
| **In Meeting** | `SET mood content` → `SHOW text In Meeting` |
| **Deep Focus** | `SET mood sleepy` → `SHOW text Deep Focus` |
| **On Break** | `SET mood playful` → `SHOW text On Break!` |
| **Away** | `SET mood sleepy` → `SHOW text Away` |
| **Do Not Disturb** | `SET mood grumpy` → `SHOW text DND` |
| **Frustrated** | `SET mood grumpy` → `SHOW face angry` |
| **Reviewing** | `SET mood content` → `SHOW text Reviewing` |
| **Thinking** | `SET mood playful` → `SHOW face surprised` |

**Example in LightBlue ("In Meeting" status):**
1. Connect to your Gochi device
2. Find the Nordic UART Service
3. Select the RX Characteristic (Write)
4. Write first command: `SET mood content` (as UTF-8 text with `\n`)
5. Write second command: `SHOW text In Meeting` (as UTF-8 text with `\n`)
6. Your device now shows "In Meeting" with content mood

**Pro Tip:** Use the web controller instead! It handles multi-command sequences automatically with one click.

## BLE Protocol Details

The device uses the **Nordic UART Service (NUS)** UUIDs:
- Service: `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- RX (Write): `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` (client → device)
- TX (Notify): `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` (device → client)

This makes the device compatible with any NUS-compatible BLE terminal or app.

### Protocol Format
- Commands are newline-terminated ASCII strings
- Write to RX characteristic: `<COMMAND>\n`
- Responses come via TX characteristic notifications
- All commands follow the same format as the USB Serial protocol

### Example Command Flow
1. **Connect** to the device's GATT server
2. **Discover** the Nordic UART Service
3. **Subscribe** to TX characteristic for notifications
4. **Write** to RX characteristic: `SHOW face happy\n`
5. **Receive** notification on TX: `OK\n`

## What's Next?

Once you have BLE working, you can:

1. **Build custom apps** - Use the NUS protocol to create your own mobile or web apps
2. **Automate control** - Use Home Assistant, Node-RED, or other automation tools
3. **Extend the firmware** - Add custom BLE characteristics for additional features

The Web Bluetooth API documentation: https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API

