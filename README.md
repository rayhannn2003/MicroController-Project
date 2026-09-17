# Project Sylvan

An ATmega32A line-following rover that stops beside an object, records temperature,
humidity and light, shows the result on an OLED, then continues along the line.
The firmware runs at **1 MHz** and is built from `car/`.

## Current progress

- The working line follower in [`car/lfr.c`](car/lfr.c) is preserved unchanged.
  Its motor control, sensor polarity and recovery decisions were extracted into
  modules. An automated comparison matched the original motor outputs for
  320,448 line-sensor updates.
- The OLED, DHT11, BH1750 and HC-SR04 drivers are integrated. The latest user
  report says the current setup is working. A separate OLED test displays
  `HELLO` when isolating the screen from the rover code.
- **Stage 6 is the default build.** Its timed sampling cycle is implemented and
  covered by host tests and AVR simulation. The full set of track and sensor
  failure checks has not yet been recorded on the physical rover.
- The two working references, [`car/lfr.c`](car/lfr.c) and
  [`car/lightTemSr.c`](car/lightTemSr.c), remain available for comparison.

## What the rover does

1. Follow the black line. The OLED shows `Object detection`, `No object` and
   `Car is moving`. Each line sensor reads **HIGH on black** and **LOW on floor**.
2. When the left-front HC-SR04 measures an object at **30 cm or less**, stop and
   show `Object Detected` with fresh temperature, light and humidity readings.
3. Keep the readings on screen for **2 seconds**.
4. Show `Sample detected` / `successfully` for **2 seconds**, then resume the
   saved line-following state. If a reading fails, show `Sample failed` /
   `Check sensors` instead, then resume.
5. Continue past that object. Detection rearms after **500 ms** of clear space
   (no echo or a reading above **35 cm**) so the same object does not cause
   repeated stops.

The original line decisions remain in use. Ultrasonic measurements briefly stop
the motors while travelling; sampling intentionally stops them for longer. This
can affect physical movement compared with running `lfr.c` alone.

## Wiring

| Device | ATmega32A pins |
| --- | --- |
| L298N IN1–IN4 | PB0–PB3 |
| L298N ENA, ENB | PD5/OC1A, PD4/OC1B |
| Left and right line sensors | PA1, PA2 |
| HC-SR04 TRIG, ECHO | PA0, PA4 |
| DHT11 DATA | PA3 |
| OLED and BH1750 SCL, SDA | PC0, PC1 |

OLED address: **0x3C**. BH1750 address: **0x23**. Keep a common ground, the I2C
pull-ups and the ATmega32A AVCC/GND connections. `F_CPU=1000000UL` assumes the
MCU is actually running at 1 MHz; the build does not change fuse bits.

## Build and flash

Run commands from the repository root:

```bash
cd car
make clean
make
make flash
```

`make flash` programs and verifies the default **Stage 6** rover image using
USBasp. `make clean` is needed only when you want to remove generated files.

For the simple OLED test, use:

```bash
make oled-debug-flash
```

That image displays `HELLO` and contains no motor or sensor code. Run
`make flash` afterward to return to the full rover program. To build the original
modular line follower alone, use `make STAGE=1` and `make STAGE=1 flash`.

## Code and checks

| Files | Purpose |
| --- | --- |
| `car/main.c`, `car/sample_cycle.c` | Main loop and timed object-sampling cycle |
| `car/line_follow.c`, `car/motor.c`, `car/line_sensor.c` | Logic and settings extracted from `lfr.c` |
| `car/hcsr04.c`, `car/dht11.c`, `car/bh1750.c` | Sensor drivers |
| `car/oled.c`, `car/twi.c` | OLED and shared I2C bus |
| `car/timebase.c`, `car/config.h` | Scheduler clock and hardware configuration |
| `car/oled_debug.c` | Isolated OLED check |

`make test` runs line-output comparisons and sampling/display tests. `make stages`
builds all six incremental stages. `make test-sim` runs the optional simavr
checks when its development files are installed.

See [`car/INTEGRATION.md`](car/INTEGRATION.md) for the timer-conflict report,
full build stages and hardware checklist. [`car/SOURCE_BUNDLE.md`](car/SOURCE_BUNDLE.md)
contains the complete modular source listings.
# sylvan
