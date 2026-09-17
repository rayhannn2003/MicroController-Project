# MicroController-Project

## ESP32 camera portal

[`esp32_sketch.ino`](esp32_sketch.ino) contains both the ESP32 firmware and its
web portal. It uses the existing AI-Thinker-compatible pinout and GC2145 camera,
and receives ATmega32A sensor packets on GPIO14 at 9600 baud.

1. Open the sketch in Arduino IDE. If prompted, let the IDE put it in a folder
   named `esp32_sketch` (the file and sketch folder names must match).
2. Select **AI Thinker ESP32-CAM** with the Espressif ESP32 board package.
   The sketch was compiled with package **3.3.11**, with PSRAM enabled by the
   board definition. All required libraries ship with that package.
3. Upload the sketch and restart the board. Open Serial Monitor at **115200 baud**
   to see camera initialization and the portal address.
4. Connect your phone or computer to **Sylvan-Camera**, password **12345678**.
5. Open **http://192.168.4.1/**, or the address printed in Serial Monitor.

The **Live Camera** section starts automatically. **Stop Stream** closes the
video connection; **Start Stream** opens it again. Use one live viewer at a time.

The separate **Capture Image** section takes a fresh JPEG without stopping the
live viewer. The photo stays in its preview until another successful capture.
**Download JPEG** saves that exact photo to your device. Photos are held in the
browser and are not saved to an SD card or retained after a page reload.

| Endpoint | Purpose |
| --- | --- |
| `http://192.168.4.1/` | Portal with sensor readings, live video and snapshots |
| `http://192.168.4.1:81/stream` | MJPEG live stream, suitable for an HTML `<img>` |
| `http://192.168.4.1/capture` | One newly captured JPEG |
| `http://192.168.4.1/api/status` | Sensor data and camera/stream availability |

The stream runs in its own HTTP server task so the portal and sensor receiver
can continue working. Camera access and JPEG conversion are serialized between
streaming and snapshots; the lock is released before transmitting an image.
If camera initialization fails, the portal still starts and shows sensor data.

The sketch keeps RGB565 input and converts frames to JPEG in software, following
the non-JPEG path in Espressif's
[CameraWebServer example](https://github.com/espressif/arduino-esp32/blob/3.3.11/libraries/ESP32/examples/Camera/CameraWebServer/app_httpd.cpp).
It uses 320 × 240 with PSRAM, or 160 × 120 without it. Streaming is capped at
5 FPS; actual speed depends on capture, conversion and Wi-Fi performance.
`STREAM_FRAME_INTERVAL_MS`, `STREAM_JPEG_QUALITY`, and `CAPTURE_JPEG_QUALITY`
near the top of the sketch control frame pacing and JPEG quality.

This is a local Wi-Fi portal. Connect to the board's access point to use the
addresses above. After flashing, check that sensor values still update while
streaming, capture and download a photo, then stop and restart the stream.
Compilation and browser checks with simulated camera responses passed; physical
camera operation and frame rate still need verification on the board.
