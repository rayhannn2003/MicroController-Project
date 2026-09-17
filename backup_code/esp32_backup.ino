#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>

#include "esp_camera.h"
#include "img_converters.h"

// =====================================================
// PROJECT SYLVAN
//
// ESP32-CAM responsibilities:
//
// 1. GC2145 camera
// 2. Receive sensor data from ATmega32A using UART
// 3. Create local Wi-Fi access point
// 4. Serve web dashboard
//
// ATmega packet format:
//
// <S,T=30,H=66,L=235>\n
//
// UART:
// ESP GPIO14 = RX from ATmega PD1/TX
// =====================================================


// =====================================================
// CAMERA PINOUT
// RoboticsBD RBD-1407 / AI-Thinker-compatible board
// =====================================================

#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0

#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27

#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5

#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

#define FLASH_LED_GPIO     4


// =====================================================
// ATMEGA UART
// =====================================================

#define ATMEGA_RX_PIN 14
#define ATMEGA_BAUD   9600

HardwareSerial AtmegaSerial(2);


// =====================================================
// WIFI ACCESS POINT
// =====================================================

const char *ap_ssid = "Sylvan-Camera";
const char *ap_password = "12345678";

WebServer server(80);


// =====================================================
// SENSOR DATA
// =====================================================

float sensorTemperature = 0;
float sensorHumidity = 0;
float sensorLux = 0;

bool sensorDataAvailable = false;

unsigned long lastAtmegaPacket = 0;


// UART receive buffer

char atmegaBuffer[100];
uint8_t atmegaBufferIndex = 0;


// =====================================================
// CAMERA INITIALIZATION
// =====================================================

bool initCamera()
{
    camera_config_t config = {};

    config.ledc_channel = LEDC_CHANNEL_0;
    config.ledc_timer   = LEDC_TIMER_0;

    config.pin_d0 = Y2_GPIO_NUM;
    config.pin_d1 = Y3_GPIO_NUM;
    config.pin_d2 = Y4_GPIO_NUM;
    config.pin_d3 = Y5_GPIO_NUM;

    config.pin_d4 = Y6_GPIO_NUM;
    config.pin_d5 = Y7_GPIO_NUM;
    config.pin_d6 = Y8_GPIO_NUM;
    config.pin_d7 = Y9_GPIO_NUM;

    config.pin_xclk  = XCLK_GPIO_NUM;
    config.pin_pclk  = PCLK_GPIO_NUM;

    config.pin_vsync = VSYNC_GPIO_NUM;
    config.pin_href  = HREF_GPIO_NUM;

    config.pin_sccb_sda = SIOD_GPIO_NUM;
    config.pin_sccb_scl = SIOC_GPIO_NUM;

    config.pin_pwdn  = PWDN_GPIO_NUM;
    config.pin_reset = RESET_GPIO_NUM;

    config.xclk_freq_hz = 20000000;


    // =================================================
    // GC2145 does not provide JPEG directly
    // =================================================

    config.pixel_format = PIXFORMAT_RGB565;


    if (psramFound())
    {
        Serial.println("PSRAM: FOUND");

        config.frame_size = FRAMESIZE_QVGA;     // 320 x 240

        config.fb_count = 1;

        config.fb_location =
            CAMERA_FB_IN_PSRAM;
    }
    else
    {
        Serial.println("PSRAM: NOT FOUND");

        config.frame_size =
            FRAMESIZE_QQVGA;                   // 160 x 120

        config.fb_count = 1;

        config.fb_location =
            CAMERA_FB_IN_DRAM;
    }


    config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;


    Serial.println("Initializing camera...");


    esp_err_t err =
        esp_camera_init(&config);


    if (err != ESP_OK)
    {
        Serial.printf(
            "Camera initialization FAILED: 0x%x\n",
            err
        );

        return false;
    }


    Serial.println(
        "Camera initialized successfully."
    );


    sensor_t *sensor =
        esp_camera_sensor_get();


    if (sensor != nullptr)
    {
        Serial.printf(
            "Detected camera PID: 0x%04X\n",
            sensor->id.PID
        );


        if (sensor->id.PID == 0x2145)
        {
            Serial.println(
                "Camera sensor = GC2145"
            );
        }
        else if (sensor->id.PID == 0x26)
        {
            Serial.println(
                "Camera sensor = OV2640"
            );
        }
        else
        {
            Serial.println(
                "Different camera sensor detected."
            );
        }
    }


    return true;
}


// =====================================================
// PROCESS ATMEGA PACKET
// =====================================================

void processAtmegaPacket(const char *packet)
{
    String line = String(packet);

    line.trim();


    if (line.length() == 0)
        return;


    Serial.print("ATmega RX: ");
    Serial.println(line);


    /*
        Accepted format:

        <S,T=30,H=66,L=235>

        Also accepts:

        S,T=30,H=66,L=235

        or:

        T=30,H=66,L=235
    */


    if (line.startsWith("<S,"))
    {
        line.remove(0, 3);
    }
    else if (line.startsWith("S,"))
    {
        line.remove(0, 2);
    }


    if (line.endsWith(">"))
    {
        line.remove(
            line.length() - 1
        );
    }


    float t;
    float h;
    float l;


    int result = sscanf(
        line.c_str(),
        "T=%f,H=%f,L=%f",
        &t,
        &h,
        &l
    );


    if (result == 3)
    {
        sensorTemperature = t;
        sensorHumidity = h;
        sensorLux = l;

        sensorDataAvailable = true;

        lastAtmegaPacket = millis();


        Serial.println(
            "Valid sensor packet:"
        );

        Serial.printf(
            "Temperature: %.1f C\n",
            sensorTemperature
        );

        Serial.printf(
            "Humidity: %.1f %%\n",
            sensorHumidity
        );

        Serial.printf(
            "Light: %.0f lux\n",
            sensorLux
        );
    }
    else
    {
        Serial.println(
            "Invalid ATmega packet."
        );
    }
}


// =====================================================
// NON-BLOCKING UART RECEIVER
// =====================================================

void readAtmegaUART()
{
    while (AtmegaSerial.available())
    {
        char c =
            AtmegaSerial.read();


        /*
            Ignore carriage-return.
        */

        if (c == '\r')
            continue;


        /*
            End of packet.
        */

        if (c == '\n')
        {
            atmegaBuffer[
                atmegaBufferIndex
            ] = '\0';


            processAtmegaPacket(
                atmegaBuffer
            );


            atmegaBufferIndex = 0;

            continue;
        }


        /*
            Store character.
        */

        if (
            atmegaBufferIndex <
            sizeof(atmegaBuffer) - 1
        )
        {
            atmegaBuffer[
                atmegaBufferIndex++
            ] = c;
        }
        else
        {
            /*
                Invalid/oversized packet.
                Reset buffer.
            */

            atmegaBufferIndex = 0;
        }
    }
}


// =====================================================
// WEB PAGE
// =====================================================

const char INDEX_HTML[] PROGMEM =
R"rawliteral(

<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
>

<title>Project Sylvan</title>


<style>

* {
    box-sizing: border-box;
}


body {

    margin: 0;

    font-family:
        Inter,
        Arial,
        sans-serif;

    background:
        linear-gradient(
            135deg,
            #07110d,
            #0e2118,
            #102b1d
        );

    color: #eef7f1;

    min-height: 100vh;
}


.container {

    width: min(
        1100px,
        calc(100% - 30px)
    );

    margin: auto;

    padding:
        30px 0
        50px;
}


/* =============================
   Header
   ============================= */

.header {

    margin-bottom: 28px;
}


.title {

    font-size:
        clamp(
            32px,
            6vw,
            55px
        );

    font-weight: 700;

    margin: 0;
}


.subtitle {

    color: #9eb5a6;

    margin-top: 8px;

    font-size: 16px;
}


/* =============================
   Status
   ============================= */

.status-row {

    display: flex;

    align-items: center;

    gap: 10px;

    margin-top: 18px;
}


.status-dot {

    width: 11px;
    height: 11px;

    border-radius: 50%;

    background: #888;
}


.status-dot.online {

    background: #4ade80;

    box-shadow:
        0 0 12px
        rgba(
            74,
            222,
            128,
            .8
        );
}


.status-dot.offline {

    background: #ef4444;
}


#connectionText {

    color: #c5d4c9;

    font-size: 14px;
}


/* =============================
   Sensor grid
   ============================= */

.sensor-grid {

    display: grid;

    grid-template-columns:
        repeat(
            3,
            1fr
        );

    gap: 16px;

    margin-bottom: 25px;
}


.sensor-card {

    background:
        rgba(
            255,
            255,
            255,
            0.06
        );

    border:
        1px solid
        rgba(
            255,
            255,
            255,
            0.10
        );

    border-radius: 20px;

    padding: 24px;

    backdrop-filter:
        blur(12px);

    min-height: 150px;
}


.sensor-label {

    color: #95aa9c;

    font-size: 14px;

    margin-bottom: 14px;
}


.sensor-value {

    font-size: 38px;

    font-weight: 700;

    letter-spacing: -1px;
}


.sensor-unit {

    color: #9eb5a6;

    font-size: 16px;

    margin-left: 4px;
}


/* =============================
   Main panel
   ============================= */

.camera-card {

    background:
        rgba(
            255,
            255,
            255,
            0.06
        );

    border:
        1px solid
        rgba(
            255,
            255,
            255,
            0.1
        );

    border-radius: 24px;

    overflow: hidden;

    backdrop-filter:
        blur(12px);
}


.camera-header {

    display: flex;

    justify-content:
        space-between;

    align-items: center;

    gap: 20px;

    padding: 22px;
}


.camera-title {

    font-size: 20px;

    font-weight: 600;
}


.camera-subtitle {

    color: #93a79a;

    font-size: 13px;

    margin-top: 5px;
}


/* =============================
   Capture button
   ============================= */

button {

    border: none;

    background: #35b768;

    color: white;

    padding:
        12px
        20px;

    border-radius: 12px;

    font-size: 15px;

    font-weight: 600;

    cursor: pointer;

    transition:
        transform .15s,
        background .15s;
}


button:hover {

    background: #2ca35c;

    transform:
        translateY(-1px);
}


button:active {

    transform:
        translateY(0);
}


/* =============================
   Camera image
   ============================= */

.image-container {

    width: 100%;

    min-height: 300px;

    background: #050907;

    display: flex;

    align-items: center;

    justify-content: center;

    position: relative;
}


#photo {

    display: block;

    width: 100%;

    max-height: 650px;

    object-fit: contain;
}


.image-message {

    position: absolute;

    color: #718277;

    font-size: 15px;
}


/* =============================
   Footer
   ============================= */

.footer {

    text-align: center;

    color: #718277;

    font-size: 13px;

    margin-top: 25px;
}


/* =============================
   Responsive
   ============================= */

@media (
    max-width: 700px
) {

    .sensor-grid {

        grid-template-columns: 1fr;
    }


    .camera-header {

        flex-direction: column;

        align-items: flex-start;
    }


    button {

        width: 100%;
    }
}

</style>

</head>


<body>

<div class="container">


    <!-- HEADER -->

    <div class="header">

        <h1 class="title">
            Sylvan
        </h1>

        <div class="subtitle">
            Autonomous plant monitoring rover
        </div>


        <div class="status-row">

            <div
                id="statusDot"
                class="status-dot"
            ></div>

            <span id="connectionText">
                Waiting for ATmega32A...
            </span>

        </div>

    </div>


    <!-- SENSOR CARDS -->

    <div class="sensor-grid">


        <div class="sensor-card">

            <div class="sensor-label">
                AIR TEMPERATURE
            </div>

            <span
                id="temperature"
                class="sensor-value"
            >
                --
            </span>

            <span class="sensor-unit">
                °C
            </span>

        </div>


        <div class="sensor-card">

            <div class="sensor-label">
                RELATIVE HUMIDITY
            </div>

            <span
                id="humidity"
                class="sensor-value"
            >
                --
            </span>

            <span class="sensor-unit">
                %
            </span>

        </div>


        <div class="sensor-card">

            <div class="sensor-label">
                AMBIENT LIGHT
            </div>

            <span
                id="lux"
                class="sensor-value"
            >
                --
            </span>

            <span class="sensor-unit">
                lux
            </span>

        </div>


    </div>


    <!-- CAMERA -->

    <div class="camera-card">


        <div class="camera-header">


            <div>

                <div class="camera-title">
                    Plant Camera
                </div>

                <div class="camera-subtitle">
                    GC2145 · live capture
                </div>

            </div>


            <button
                onclick="capturePhoto()"
                id="captureButton"
            >
                Capture Image
            </button>


        </div>


        <div class="image-container">

            <div
                id="imageMessage"
                class="image-message"
            >
                Capturing image...
            </div>

            <img
                id="photo"
                alt="Latest plant image"
            >

        </div>


    </div>


    <div class="footer">

        Project Sylvan ·
        ATmega32A + ESP32-CAM

    </div>


</div>


<script>

/* =====================================================
   SENSOR DATA
   ===================================================== */

async function updateSensors()
{
    try
    {
        const response =
            await fetch(
                "/api/status?t=" +
                Date.now()
            );


        const data =
            await response.json();


        const dot =
            document.getElementById(
                "statusDot"
            );


        const status =
            document.getElementById(
                "connectionText"
            );


        if (data.hasData)
        {
            document.getElementById(
                "temperature"
            ).textContent =
                Number(
                    data.temperature
                ).toFixed(1);


            document.getElementById(
                "humidity"
            ).textContent =
                Number(
                    data.humidity
                ).toFixed(1);


            document.getElementById(
                "lux"
            ).textContent =
                Math.round(
                    data.lux
                );
        }


        if (data.connected)
        {
            dot.className =
                "status-dot online";


            status.textContent =
                "ATmega32A connected · updated " +
                Math.round(
                    data.ageMs / 1000
                ) +
                "s ago";
        }
        else
        {
            dot.className =
                "status-dot offline";


            if (data.hasData)
            {
                status.textContent =
                    "ATmega32A data is stale";
            }
            else
            {
                status.textContent =
                    "Waiting for ATmega32A...";
            }
        }
    }
    catch (error)
    {
        console.log(error);
    }
}


/* =====================================================
   CAPTURE IMAGE
   ===================================================== */

function capturePhoto()
{
    const img =
        document.getElementById(
            "photo"
        );


    const message =
        document.getElementById(
            "imageMessage"
        );


    const button =
        document.getElementById(
            "captureButton"
        );


    message.style.display =
        "block";


    message.textContent =
        "Capturing image...";


    button.disabled = true;


    img.onload = function()
    {
        message.style.display =
            "none";

        button.disabled = false;
    };


    img.onerror = function()
    {
        message.style.display =
            "block";

        message.textContent =
            "Image capture failed";

        button.disabled = false;
    };


    img.src =
        "/capture?t=" +
        Date.now();
}


/* =====================================================
   START
   ===================================================== */

updateSensors();


setInterval(
    updateSensors,
    1000
);


/*
   Capture once automatically
   when portal opens.
*/

setTimeout(
    capturePhoto,
    800
);

</script>


</body>

</html>

)rawliteral";


// =====================================================
// HOME PAGE
// =====================================================

void handleHome()
{
    server.send_P(
        200,
        "text/html",
        INDEX_HTML
    );
}


// =====================================================
// SENSOR API
// =====================================================

void handleStatus()
{
    bool connected = false;

    unsigned long age = 0;


    if (sensorDataAvailable)
    {
        age =
            millis() -
            lastAtmegaPacket;


        /*
           If no packet for 5 seconds,
           consider ATmega link stale.
        */

        connected =
            (age < 5000);
    }


    String json = "{";


    json += "\"hasData\":";

    json +=
        sensorDataAvailable
        ? "true"
        : "false";


    json += ",";


    json += "\"connected\":";

    json +=
        connected
        ? "true"
        : "false";


    json += ",";


    json += "\"temperature\":";

    json += String(
        sensorTemperature,
        1
    );


    json += ",";


    json += "\"humidity\":";

    json += String(
        sensorHumidity,
        1
    );


    json += ",";


    json += "\"lux\":";

    json += String(
        sensorLux,
        0
    );


    json += ",";


    json += "\"ageMs\":";

    json += String(age);


    json += "}";


    server.sendHeader(
        "Cache-Control",
        "no-store"
    );


    server.send(
        200,
        "application/json",
        json
    );
}


// =====================================================
// CAPTURE IMAGE
// =====================================================

void handleCapture()
{
    Serial.println();

    Serial.println(
        "Taking image..."
    );


    camera_fb_t *fb =
        esp_camera_fb_get();


    if (!fb)
    {
        Serial.println(
            "ERROR: Camera capture failed!"
        );


        server.send(
            500,
            "text/plain",
            "Camera capture failed"
        );


        return;
    }


    Serial.printf(
        "Raw image: %d x %d | %u bytes\n",
        fb->width,
        fb->height,
        (unsigned int)fb->len
    );


    // =================================================
    // GC2145 RGB565 -> JPEG
    // =================================================

    uint8_t *jpgBuffer = nullptr;

    size_t jpgLength = 0;


    bool success =
        frame2jpg(
            fb,
            80,
            &jpgBuffer,
            &jpgLength
        );


    /*
       Camera framebuffer is no longer needed.
    */

    esp_camera_fb_return(fb);


    if (
        !success ||
        jpgBuffer == nullptr
    )
    {
        Serial.println(
            "ERROR: JPEG conversion failed!"
        );


        server.send(
            500,
            "text/plain",
            "JPEG conversion failed"
        );


        return;
    }


    Serial.printf(
        "JPEG image: %u bytes\n",
        (unsigned int)jpgLength
    );


    server.sendHeader(
        "Cache-Control",
        "no-store"
    );


    server.setContentLength(
        jpgLength
    );


    server.send(
        200,
        "image/jpeg",
        ""
    );


    WiFiClient client =
        server.client();


    client.write(
        jpgBuffer,
        jpgLength
    );


    free(jpgBuffer);


    Serial.println(
        "Image sent to browser!"
    );
}


// =====================================================
// SETUP
// =====================================================

void setup()
{
    /*
       USB/debug serial
    */

    Serial.begin(115200);


    delay(2000);


    Serial.println();

    Serial.println(
        "================================"
    );

    Serial.println(
        "       PROJECT SYLVAN"
    );

    Serial.println(
        "================================"
    );


    // =================================================
    // ATMEGA UART
    // =================================================

    Serial.println(
        "Starting ATmega UART..."
    );


    /*
       RX = GPIO14

       TX = -1 because ESP -> ATmega
       communication is not needed yet.
    */

    AtmegaSerial.begin(
        ATMEGA_BAUD,
        SERIAL_8N1,
        ATMEGA_RX_PIN,
        -1
    );


    Serial.printf(
        "ATmega UART RX = GPIO%d @ %d baud\n",
        ATMEGA_RX_PIN,
        ATMEGA_BAUD
    );


    // =================================================
    // FLASH LED
    // =================================================

    pinMode(
        FLASH_LED_GPIO,
        OUTPUT
    );


    digitalWrite(
        FLASH_LED_GPIO,
        LOW
    );


    // =================================================
    // CAMERA
    // =================================================

    if (!initCamera())
    {
        Serial.println();

        Serial.println(
            "Camera failed."
        );

        Serial.println(
            "Stopping."
        );


        while (true)
        {
            delay(1000);
        }
    }


    // =================================================
    // WIFI AP
    // =================================================

    Serial.println();

    Serial.println(
        "Creating Wi-Fi access point..."
    );


    WiFi.mode(
        WIFI_AP
    );


    WiFi.softAP(
        ap_ssid,
        ap_password
    );


    IPAddress IP =
        WiFi.softAPIP();


    Serial.println();

    Serial.println(
        "================================"
    );


    Serial.print(
        "Wi-Fi name: "
    );

    Serial.println(
        ap_ssid
    );


    Serial.print(
        "Password: "
    );

    Serial.println(
        ap_password
    );


    Serial.print(
        "Portal: http://"
    );

    Serial.println(IP);


    Serial.println(
        "================================"
    );


    // =================================================
    // WEB ROUTES
    // =================================================

    server.on(
        "/",
        handleHome
    );


    server.on(
        "/capture",
        handleCapture
    );


    server.on(
        "/api/status",
        handleStatus
    );


    server.begin();


    Serial.println(
        "Web server started."
    );
}


// =====================================================
// LOOP
// =====================================================

void loop()
{
    /*
       Continuously consume ATmega data.
    */

    readAtmegaUART();


    /*
       Process browser requests.
    */

    server.handleClient();


    /*
       Give background ESP tasks some time.
    */

    delay(2);
}