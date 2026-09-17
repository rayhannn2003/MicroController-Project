# Project Sylvan modular integration

The modular project is in `sylvan/car/`, beside the working references. The actual
sensor reference filename on disk is **`lightTemSr.c`** (lowercase `l`). Both it and
`lfr.c` are unchanged. Their hashes are in `references/SHA256SUMS`; copies of the
previous configuration and Makefile are also in `references/`.

All six firmware stages compile and the automated checks pass. The user reports
the current setup working; the detailed staged hardware checklist below still
needs results recorded. No fuse bits were changed by these build instructions.

Complete contents of every new C/header file, the updated configuration and
Makefile, and test helpers are in [SOURCE_BUNDLE.md](SOURCE_BUNDLE.md).

**Default: Stage 6, repeated sampling beside the line.** The previous Stage 6
hold-until-clear behavior has been replaced by the requested timed sample cycle.

## Current sampling cycle

1. Follow the line. Display `Object detection`, `No object`, `Car is moving`.
   The motion row says `Car is stopped` during startup or a line-controller stop.
2. A valid left-front reading **<=30 cm** stops the motors immediately and pauses
   the existing line state. Display `Object Detected` and acquire fresh readings.
3. Show the three readings for **2 seconds**:

   ```text
   Object Detected
   T:30C
   L:235LX
   H:66%
   ```

4. Show the result for **2 seconds**, as requested:

   ```text
   Sample detected
   successfully
   Car is stopped
   ```

   When acquisition finishes (both reads done, or the 3-second limit), before the
   readings screen, one packet is sent to the ESP32-CAM: `<S,T=30,H=66,L=235>\n`
   on success or `<F>\n` on failure. See [ESP32-CAM UART link](#esp32-cam-uart-link).

5. Resume the saved line-following state even if that same object remains near.
   The display says `Object sampled` while still near it, then `No object` when
   clear. After **500 ms of clear readings**, another object can trigger a stop.
   Clearance means no echo or a distance **>35 cm**, providing hysteresis around
   the 30 cm trigger. A brief gap does not immediately rearm detection.

Stage 6 reads DHT11 only during sampling, after its initial 2-second wait and
respecting the original minimum interval. It waits at least 200 ms after stopping
before reading BH1750 so a conversion can complete at the sampling position.
The two-second readings interval starts after both reads complete. Acquisition
has a 3-second limit; a failed or missing reading shows `ERR`, followed by
`Sample failed` / `Check sensors` for 2 seconds, then the rover resumes. It never
reports success for failed readings.

The side-looking ultrasonic sensor treats invalid/no echo as no detected object,
including open space; a disconnected echo line can therefore also look clear.
It is a sampling trigger in this mode. Ultrasonic measurements run only while
travelling, avoiding extra measurement pauses during the two timed screens.
The short motor pauses needed to measure echo at 1 MHz remain during travel.

Thresholds and intervals are in `config.h`: `OBSTACLE_DISTANCE_CM`,
`OBJECT_CLEAR_DISTANCE_CM`, `OBJECT_CLEAR_TIME_MS`, `SAMPLE_READINGS_TIME_MS`
and `SAMPLE_RESULT_TIME_MS`.

## Existing architecture and conflicts

| Resource | `lfr.c` | `lightTemSr.c` | Conflict |
| --- | --- | --- | --- |
| Timer0 | CTC, prescaler 8, OCR0=124; 1 ms interrupt | Normal mode, prescaler 1; DHT resets TCNT0 repeatedly | DHT destroys the scheduler configuration |
| Timer1 | Fast PWM mode 14, TOP=49, no prescaler; OC1A/OC1B motors | Normal counter, prescaler 1; HC-SR04 pulse timing | Ultrasonic initialization disables PWM |
| PA1 | Left line sensor | HC-SR04 echo | Two inputs cannot share the pin |
| Interrupts | Millisecond scheduler needs interrupts | DHT disables interrupts through its 20 ms start and data transaction | Simply changing the DHT timer would still lose scheduler ticks |
| TWI | Unused | OLED 0x3C and BH1750 0x23 on PC0/PC1 | One shared driver is needed; addresses do not conflict |
| Foreground loop | Continuous line decisions | Sensor waits and OLED full redraws | Unmodified waits would delay line control while driving |

The reference sensor program also uses PA0 for trigger and PA3 for DHT11. The
OLED and BH1750 already use the correct shared bus and addresses.

## Final wiring

| Function | ATmega32A port pin |
| --- | --- |
| L298N IN1, IN2, IN3, IN4 | PB0, PB1, PB2, PB3 |
| L298N ENA, ENB | PD5/OC1A, PD4/OC1B |
| Left IR, right IR | PA1, PA2; black HIGH, floor LOW |
| HC-SR04 TRIG, ECHO | PA0, **PA4** |
| DHT11 DATA | PA3 |
| Shared TWI SCL, SDA | PC0, PC1 |
| OLED address | 0x3C |
| BH1750 address | 0x23 |
| ESP32-CAM RX (GPIO14) | PD1/TXD via 1kΩ/2kΩ divider; common GND |

Move HC-SR04 ECHO from PA1 to PA4 before Stage 5. Keep the known-working sensor
power connections, common ground and I2C pull-ups. For the 40-pin DIP ATmega32A,
AVCC pin 30 must be connected to 5 V and GND pin 31 to ground, as specified in
your wiring. The firmware assumes a real 1 MHz CPU clock. Defining `F_CPU` does
not change the chip's clock or fuses.

## ESP32-CAM UART link

`uart.c` is a blocking, **transmit-only** USART driver linked into Stage 6 only.
`uart_init()` runs once at startup (in `main.c`, after `sample_cycle_init()`).
It sets `UBRR` from `F_CPU` and `UART_BAUD` (`config.h`, default `9600UL`) in
double-speed mode: `UBRR = F_CPU / (8 × baud) − 1`, rounded, giving 12 for 9600
(9615 baud, +0.2%) and 25 for 4800. Normal mode at 1 MHz would be about 7% off.
A compile-time check rejects any `UART_BAUD` with more than 2% error. Only
`TXEN` is set, with 8N1 through `UCSRC` (`URSEL` set); RX and all USART
interrupts stay disabled, so PD0 remains a free input.

Pins and resources: PD1/TXD and PD0/RXD were not used by any module (PORTD only
drives PD4/PD5 for the L298N enables). The USART has its own baud generator and
uses no timer, so Timer0/1/2 ownership is unchanged.

`sample_cycle_dht_done()` and `sample_cycle_light_done()` now also receive the
readings (`temperature`, `humidity` as the DHT11's `uint8_t` integer bytes, `lux`
as `uint16_t`). `sample_cycle_update()` sends exactly one packet at the single
`SAMPLE_ACQUIRING` → `SAMPLE_READINGS` transition, when `succeeded` becomes final:

```text
<S,T=30,H=66,L=235>\n    uart_send_sample(temp_c, humidity, lux)
<F>\n                    uart_send_sample_failed()
```

Numbers are formatted with integer division only (no `printf`). Temperature is
passed as `int16_t` and printed with a sign when negative, although the DHT11
driver itself reports 0–50 °C. The motors are held by the line pause at that
moment. A packet blocks the loop for about 1 ms per byte (up to ~21 ms for a
success line, ~4 ms for `<F>`); Timer0 keeps running and the readings screen
then lasts the unchanged 2 seconds. No bytes are sent during line following.

## Timer strategy

| Timer | Final owner | Configuration |
| --- | --- | --- |
| Timer0 | `timebase.c` | Original CTC /8, OCR0=124, 1 ms tick |
| Timer1 | `motor.c` only | Original mode 14, /1, ICR1=49, 20 kHz PWM |
| Timer2 | DHT11 or HC-SR04, sequentially | DHT: normal /1, 1 microsecond per tick. HC: normal /8, 8 microseconds per tick with overflow extension |

Timer register meanings and divisors were checked against the
[ATmega32A datasheet](https://ww1.microchip.com/downloads/en/devicedoc/atmega32a-datasheet-complete-ds40002072a.pdf).

The main loop intentionally stops the motors before either timing-sensitive
sensor transaction. It pauses Timer0 while preserving its CTC mode, counter
phase and any pending compare tick. The driver then owns Timer2 with interrupts
disabled, stops Timer2 on return, and restores the previous interrupt state.
Main resumes Timer0 and returns to line control. Timer1's configuration and TOP
are never changed by a sensor; its compare outputs are set to zero for the stop.

This makes the scheduler a **logical clock that excludes sampling stops**.
Recovery durations are preserved as active time. The 80 ms, 500 ms and 2 second
sampling intervals therefore take slightly longer in wall-clock time. The full
sample cycle uses a separate line pause that freezes the current line recovery
or startup deadline. Timer0 runs normally during the readings/result screens.

An initial experiment polling echo between complete line-control updates had
gaps up to 300 microseconds in the 1 MHz simulation. That was too coarse. The
final implementation uses a tight Timer2 polling loop while stopped. In the
tested simulations its maximum polling gap was 39 microseconds, and measured
distances differed from injected echoes by at most 1 cm. Physical accuracy still
requires measurement on this board.

### Deliberate timing changes

- DHT preserves the original 20 ms LOW start, 30 microsecond release sequence,
  response/bit timeouts, HIGH >45 microsecond bit threshold and checksum logic.
  It now uses Timer2: Stages 4–5 sample every 2 seconds of logical time; Stage 6
  samples once per object. A transaction takes roughly 20–30 ms, depending on
  its response or error, with the motors stopped.
- HC-SR04 preserves the 3 microsecond LOW / 12 microsecond HIGH trigger and
  microseconds/58 distance conversion. It samples every 80 ms of logical travel
  time; Stage 6 skips ultrasonic sampling during the full environmental stop.
  Drive stops for the measurement: typically a few milliseconds at short range,
  with bounds of 30 ms waiting for rising echo plus 30 ms waiting for falling echo.
  A pre-existing HIGH echo is rejected immediately. Invalid/no echo returns
  `HCSR04_INVALID_CM` (`UINT16_MAX`).
- BH1750 preserves `0x01`, a 10 ms wait, `0x10`, a 200 ms conversion wait,
  MSB with ACK, LSB with NACK and `(uint32_t)raw * 5 / 6`. The waits now yield to
  line control. `bh1750_init()` reports that initialization **started**; call
  `bh1750_service()` until `bh1750_state()` is `BH1750_READY` before reading.
- OLED retains the original initialization commands and all original font bitmaps.
  Lowercase letters and uppercase S were added for the sampling messages;
  the lowercase table lives in flash.
  It clears RAM once on initialization or reconnect, then writes only dirty
  rows. Each service call sends at most one command or six display bytes.
  Main refreshes text five times per logical second and on phase changes; completing
  a row takes multiple loop passes. Shorter text is padded to erase old digits.
- TWI retains TWBR=2 and prescaler 1 from the working source. Each wait is bounded
  by 2 ms of scheduler time; a failed transaction can also spend up to 2 ms on
  STOP. A STOP timeout resets the TWI peripheral. Failed clients retry after
  about one second. No bus transaction runs during a Timer0 sampling pause.

These sampling stops in Stages 4–6 are intentional changes to motion timing.
Verify their effect on the track before accepting the integrated build.

## Preserved motor and recovery behavior

| Setting | Preserved value |
| --- | --- |
| Forward, reverse, left pivot, right pivot patterns | 0x05, 0x0A, 0x06, 0x09 on PB0–PB3 |
| Brake, stop patterns | 0x0F, 0x00 |
| Forward speed | 80%; original OCR calculation gives 39 |
| Reverse and pivot speed | 75%; original OCR calculation gives 36 |
| Brake / reverse / reverse brake | 25 / 40 / 15 ms |
| Search timeout / startup delay | 300 / 1000 ms |

The first unambiguous BLACK-to-FLOOR edge is still latched, the turn remains
opposite the sensor that first went off, simultaneous loss retains the earlier
turn, and centering resets the latch. The original brake/reverse/brake/search
sequence, reacquisition behavior and recoverable STOP state are preserved.

Stage 6 uses `motor_stop()` throughout acquisition and both timed screens, then
resumes the saved line-following state automatically. The repeat suppression
described above prevents repeatedly sampling the same nearby object. Stage 5
has measurement pauses but no sampling cycle. No avoidance turns are added.

## Project tree

Existing unrelated files in `sylvan/`, `car/` and `backup_code/` are retained.
The modular project and its references are:

```text
sylvan/
└── car/
    ├── main.c
    ├── oled_debug.c
    ├── config.h
    ├── motor.c / motor.h
    ├── line_sensor.c / line_sensor.h
    ├── line_follow.c / line_follow.h
    ├── sample_cycle.c / sample_cycle.h
    ├── timebase.c / timebase.h
    ├── hcsr04.c / hcsr04.h
    ├── dht11.c / dht11.h
    ├── bh1750.c / bh1750.h
    ├── oled.c / oled.h
    ├── twi.c / twi.h
    ├── uart.c / uart.h           Stage 6 ESP32-CAM transmitter
    ├── Makefile
    ├── .gitignore
    ├── lfr.c                     unchanged reference
    ├── lightTemSr.c              unchanged reference
    ├── references/
    │   ├── config.h.original
    │   ├── Makefile.original
    │   └── SHA256SUMS
    ├── tests/
    │   ├── fake_avr/avr/io.h
    │   ├── fake_avr/avr/interrupt.h
    │   ├── fake_avr/avr/pgmspace.h
    │   ├── registers.c
    │   ├── test_line_follow.c
    │   ├── test_i2c_clients.c
    │   ├── test_sample_cycle.c
    │   ├── test_sampling_main.c
    │   ├── test_uart.c
    │   ├── run_tests.py
    │   ├── simavr_integration.c
    │   └── run_simavr.py
    ├── tools/export_sources.py
    ├── INTEGRATION.md
    ├── SOURCE_BUNDLE.md
    ├── .build/stage1/ … stage6/   generated objects, dependencies, ELF, HEX, map
    ├── main.elf                  copy of the selected build
    └── main.hex                  copy of the selected build
```

`line_follow` keeps the original recovery state machine out of `main.c`.
`sample_cycle` coordinates the timed stops and rearming. `timebase` gives the
scheduler one owner. Headers contain declarations,
configuration macros and enums; all function implementations are in C files.
The two original applications are deliberately excluded from the module link.

## Build and flash

Dependencies: GNU make, avr-gcc, avr-libc, avr-binutils; avrdude for flashing.

### OLED-only hardware check

To isolate the display, build and flash the small `oled_debug.c` program:

```bash
cd /home/rayhan/Desktop/Project/sylvan/car
make oled-debug
make oled-debug-flash
```

It links only `oled_debug.c`, `twi.c`, `oled.c` and `timebase.c`. With the OLED on
PC0 (SCL), PC1 (SDA), address 0x3C, the screen should show `HELLO` on its first
text row. Initialization and one full clear may take about a second. If it stays
blank, check display power and ground, SCL/SDA order, bus pull-ups, address and
AVCC/GND on the ATmega32A. `make flash` still builds the full Stage 6 rover.

Build and flash the default **Stage 6 sampling cycle**:

```bash
cd /home/rayhan/Desktop/Project/sylvan/car
make clean
make
make flash
```

`make` compiles `main.c` **and the modules enabled for the selected stage**
(`uart.c` only in Stage 6), links
them, and produces HEX. `make flash` rebuilds dependencies and programs that
stage's HEX with USBasp and `-p m32 -B 8`, including avrdude verification.

After each hardware stage passes, choose the next stage explicitly:

```bash
make STAGE=2
make STAGE=2 flash
```

Repeat with 3, 4 and 5 for isolated hardware checks. For line-only testing use
`make STAGE=1` and `make STAGE=1 flash`. The complete integrated build can also
be selected explicitly:

```bash
make STAGE=6
make STAGE=6 flash
```

**Pass the same STAGE when flashing a diagnostic build.** Plain `make flash`
selects Stage 6, even if `main.hex` was last copied from Stage 1. Flash uses
`.build/stage$(STAGE)/main.hex` directly, so it cannot accidentally use another
stage's copied `main.hex`. Object directories are separate for each stage.
`make clean` is not required when switching stages.

Verification mismatches must be resolved before rover testing; the Makefile
does not bypass verification or device-signature checks. It has no fuse target.

Additional commands:

```bash
make stages          # Build all six, without changing the main.hex copy
make test            # Host-side equivalence, sensor-client and reference checks
make source-bundle   # Refresh the full source document
make -n STAGE=6 flash # Preview commands without programming hardware
```

Optional instruction simulation requires libsimavr development files and
pkg-config, then `make test-sim`. Alternatively set `SIMAVR_INCLUDE_DIR` to the
directory containing `simavr/` and `SIMAVR_LIB_DIR` to the directory containing
`libsimavr.so`. The helper builds and exercises Stage 6.

## Automated verification completed

- All six stages build with avr-gcc 14.2.0, `-Os -Wall -Wextra -Werror`.
- The original and modular line controllers produce identical direction and
  PWM outputs for 320,448 updates, including timer wrap. Another 1,500 scenarios
  pause at successive points through startup and recovery and verify resumption
  against the original with stopped time excluded.
- Reference hashes, all previous configuration values, extracted DHT transaction
  bodies and original OLED font bitmaps are checked automatically.
- Mock-bus tests cover BH1750 conversion waits, command/read order, maximum raw
  value, bus failures and retry; OLED initial clear, bounded transfers, unchanged
  rows, shorter strings, reconnect, every new message glyph and clock wrap.
- Sample-cycle tests cover exact two-second readings/result intervals, resumption
  beside the same object, stable-clear rearming, failures, timeout and clock wrap.
  Tests of the actual `main.c` loop with mock interfaces complete two object
  cycles for successful sensors, bad DHT data and missing BH1750; they check
  displayed messages, fresh readings and motor stops.
- simavr 1.6 executes the actual Stage 6 ELF with simulated GPIO pulses. Three
  20-second runs cover two timed sample stops and resumption beside the same
  object, missing echo, long echo,
  a 2–400 cm distance sweep, valid DHT data (30 C / 66%), bad checksum and absent
  DHT. The disconnected TWI devices do not freeze control. Timer1 remains in
  its original mode and the motors are disabled while Timer2 measures a sensor.
  Successful OLED/BH1750 bus behavior is covered by the host tests, not this
  disconnected-bus simulation.
- UART host tests capture every `UDR` write through the fake AVR header. They
  check the 9600 8N1 U2X TX-only register setup, exact packets (including
  `T=-5`, zero and integer limits), `<F>\n` for failures and timeouts, and that
  each sampling stop sends exactly one packet regardless of loop passes. The
  actual `main.c` loop test checks both packets and that no byte is sent while
  the line follower is driving.
- `make test-sim` also checks the ELF's USART output (`<F>` per sample, since the
  simulated bus has no BH1750, with motors stopped). That UART addition has not
  yet been run, because simavr was not installed when it was written.
- Stage 6 uses 7,214 bytes of flash (`.text + .data`) and 567 bytes of static SRAM
  (`.data + .bss`); stack use is additional and has not been measured on hardware.
  Before the UART link it used 6,854 and 544 bytes.

The simavr 1.6 ATmega32 core shares a Timer0 model without CTC mode. The harness
adds the documented WGM bits and CTC entry **to the simulation model only**.
See [simavr's Timer0 definition](https://github.com/buserror/simavr/blob/v1.6/simavr/cores/sim_megax.h#L153).
Firmware uses the real ATmega32A registers unchanged. Simulation does not verify
electrical wiring, motor noise, supply stability or physical stopping distance.

## Staged hardware test checklist

The boxes below are not yet individually marked from hardware results. Use the
same track and wiring that made the reference implementations work. Advance one
stage at a time when diagnosing an individual subsystem.

### Stage 1 — modular line follower

- [ ] Flash `STAGE=1` and obtain successful avrdude verification.
- [ ] Confirm black HIGH/floor LOW on PA1/PA2 and the original startup delay.
- [ ] Confirm both black drives forward; each first-off sensor gives the original
      opposite pivot; centering resets the first-off latch.
- [ ] Test left-first, right-first and simultaneous line loss, then the complete
      brake/reverse/brake/search sequence, reacquisition and search timeout.
- [ ] Compare direction and speed with `lfr.c`; confirm motor PWM remains 20 kHz.

### Stage 2 — OLED

- [ ] Flash `STAGE=2`; confirm T/H/L/D placeholder rows and unchanged line behavior.
- [ ] Confirm stable text without continuous full-screen clearing or flicker.
- [ ] Verify an absent OLED does not freeze line control; reconnect and check redraw.

### Stage 3 — BH1750

- [ ] Flash `STAGE=3`; check `L:...LX`, shade/illuminate the sensor and compare with
      the working reference. Confirm address 0x23.
- [ ] Verify both shared-bus devices work together. An absent BH1750 should show
      `ERR`; reconnect should recover without resetting the rover.

### Stage 4 — DHT11

- [ ] Flash `STAGE=4`; allow at least 2 seconds before the first sample.
- [ ] Check temperature/humidity against the reference and observe the brief
      sampling stop. Confirm line recovery continues correctly after the stop.
- [ ] Test missing DHT DATA: the display should show `ERR`, the sample must time
      out, and line following must resume. Reconnect and wait for the next sample.

### Stage 5 — HC-SR04 measurement

- [ ] Move ECHO to PA4 and flash `STAGE=5`; verify TRIG stays on PA0.
- [ ] Compare displayed distances with measured target positions, especially
      near 30 cm, and test missing echo. Check that sensing pauses are bounded.
- [ ] Verify the rover resumes after each sample even with a near object; this
      stage has no obstacle hold. Confirm Timer1 PWM mode/frequency is unchanged.

### Stage 6 — sample and resume repeatedly

- [ ] Flash the default build with `make flash`; confirm the moving screen after
      the normal startup delay, including when the side sensor sees no echo.
- [ ] Put an object beside the line within 30 cm of the left-front sensor.
      Confirm immediate stop and `Object Detected` with temperature/light/humidity.
- [ ] Confirm readings remain for 2 seconds after acquisition, followed by
      `Sample detected` / `successfully` for 2 seconds. Motors stay stopped.
- [ ] Keep that same object near: confirm the car resumes without another stop.
- [ ] Give it at least 500 ms of clear readings, then another object; confirm the
      complete cycle repeats. Check spacing on the real track.
- [ ] Test an absent DHT11 and BH1750 separately: expect `ERR` and `Sample failed`,
      then resumption; reconnect and confirm the next object's sample succeeds.
- [ ] With the ESP32-CAM connected, confirm one `<S,T=..,H=..,L=..>` line per
      successful stop and one `<F>` per failed stop, and no data while driving.
      If lines are garbled, try `UART_BAUD 4800UL` on both sides.
- [ ] Trigger a sample during line recovery; confirm the remaining recovery time
      resumes afterward. Check short ultrasonic pauses and threshold jitter on
      the complete track.
