The scanner now reports **`0x23` (35) and `0x3C` (60), with `N:2 E:0`**.
Both expected addresses respond without scanner bus faults. The next step is to
verify BH1750 measurements.

`car.c` is a complete standalone AVR C source with three build modes. The default
is now **mode 2, BH1750 + OLED**, using the confirmed BH1750 address `0x23`.
Use mode 3 only after this test responds to changes in light. There is no
automatic transition to integration. The scanner remains available as mode 1.

The initial likely causes, before the successful scanner result, were:

1. **Address mismatch:** the original source used `0x5C`, despite describing ADDR
   connected to GND. ADDR LOW selects `0x23`; HIGH selects `0x5C`.
2. **A connection or power problem on the BH1750 branch:** a working OLED proves
   that the MCU can communicate with the OLED, but does not prove continuity or
   power at the BH1750 header.
3. **TWI error handling:** the original reads did not inspect receive status,
   STOP completion was not checked, and failed OLED STARTs returned without bus
   cleanup. These could hide the actual failure or affect later transactions.
4. **A faulty module:** investigate after the scanner and connection checks.

The original address shifts, power/mode opcodes, 200 ms conversion delay, and
32-bit lux calculation were already correct. The updated driver adds address
detection, receive-status checks, bounded STOP completion, bus recovery, and
stage-specific errors. The DHT11 timer and read routines are unchanged.

The addresses and measurement protocol follow the
[ROHM BH1750FVI datasheet](https://www.mouser.com/datasheet/2/348/bh1750fvi-e-186247.pdf).
TWI status handling follows the
[Microchip ATmega32A datasheet](https://ww1.microchip.com/downloads/en/devicedoc/atmega32a-datasheet-complete-ds40002072a.pdf),
section 21.

All modes use `F_CPU = 1000000UL`, PC0/SCL, PC1/SDA, and OLED address `0x3C`.
TWI uses prescaler 1 and `TWBR = 2`, giving nominal 50 kHz. Each hardware wait has
a finite poll count, including STOP and recovery waits. Recovery uses at most
nine open-drain SCL pulses and a STOP on this single-master bus. Normal transfers
use hardware TWI. Existing external bus pull-ups are required; firmware does not
enable MCU pull-ups to 5 V.

Run these commands from the project directory:

```sh
cd /home/rayhan/Desktop/Project/sylvan/car
```

**Phase 1: scanner**

```sh
avr-gcc -mmcu=atmega32 -std=gnu11 -Os -Wall -Wextra -Werror -ffunction-sections -fdata-sections -Wl,--gc-sections -DAPP_MODE=1 car.c -o i2c_scanner.elf
avr-objcopy -O ihex -R .eeprom i2c_scanner.elf i2c_scanner.hex
avrdude -c usbasp -p m32 -B 8 -U flash:w:i2c_scanner.hex:i
```

`make` now builds the BH1750 diagnostic as `car.hex`. Use the explicit mode 1
command above to rebuild the scanner.
The scanner probes all addresses `0x08` through `0x77`, stores every ACK, and
cycles through them with a one-second pause on each screen before rescanning:

```text
I2C FOUND
0x3C 60
N:2 E:0
```

`N` is the number of addresses that ACKed. `E` counts probes with bus errors,
timeouts, or STOP failures; an ordinary address NACK does not count as an error.
If `E` is nonzero, the last line shows the first fault's status and probe address,
for example `S:0xFF A:0x08`. A scan with bus errors is incomplete evidence about
which devices are present. `I2C NONE` means no ACKs were recorded. If the OLED is
absent, has a different address, or the shared bus is physically stuck, the OLED
cannot report the fault; the firmware still exits its waits and retries.

| Addresses displayed | Interpretation and next step |
| --- | --- |
| `0x3C` (60) only, `E:0` | OLED responds. Check BH1750 power at its header, common ground, SCL/SDA continuity, ADDR-to-GND continuity, jumpers, and header soldering. |
| `0x23` (35) and `0x3C` (60) | An address consistent with BH1750 ADDR LOW responds. Continue with mode 2. |
| `0x3C` (60) and `0x5C` (92) | The alternate BH1750 address responds. Check why ADDR reads HIGH; mode 2 can select it automatically. |
| Both `0x23` and `0x5C` | Identify the connected devices and explicitly select the intended address for mode 2. |

An ACK establishes a responding address, not the identity or measurement health
of the device. If only the OLED responds, check the exact GY-302 board's supply
and level-shifting arrangement: module VCC accepting 5 V does not establish that
the BH1750 chip's SDA/SCL tolerate 5 V. Measure the idle bus voltage and verify
the board's regulator and pull-ups against its schematic. The bare sensor's
voltage limits are in the ROHM datasheet; module designs vary.

**Phase 2: BH1750 + OLED only**

```sh
avr-gcc -mmcu=atmega32 -std=gnu11 -Os -Wall -Wextra -Werror -ffunction-sections -fdata-sections -Wl,--gc-sections -DAPP_MODE=2 car.c -o bh1750_diag.elf
avr-objcopy -O ihex -R .eeprom bh1750_diag.elf bh1750_diag.hex
avrdude -c usbasp -p m32 -B 8 -U flash:w:bh1750_diag.hex:i
```

By default, the driver uses the scanner-confirmed address `0x23`. To select the
alternate address, add `-DBH1750_ADDR=0x5C` to the compile command. To enable
automatic detection, add `-DBH1750_ADDR=0`; this probes `0x23`, then tries `0x5C`
only after a normal address NACK. The selected address appears as `A`. DHT11 is
not sampled in this mode.

Initialization sends `0x01`, STOP, a 10 ms pause, then `0x10`, STOP, and a 200 ms
conversion wait. Reads send SLA+R, receive MSB with ACK (`0x50`), receive LSB with
NACK (`0x58`), and finish with STOP. Lux is `(uint32_t)raw * 5 / 6`; even raw
`65535` fits the calculation and produces `54612` lux. No sample value is
hard-coded. The screen shows lux, raw counts (`R`), and the detected address:

```text
BH1750
L:184 lx
R:221
A:0x23
```

These numbers illustrate the layout. On an error, lux becomes `L:E...`, raw
becomes `R:--`, and `S` shows the saved failing status. OLED traffic cannot
overwrite this saved status. Initialization is retried on the next sample after
a failure; stale lux is not displayed as a new reading.

| Light error | Failure stage |
| --- | --- |
| `L:E1` | No selected BH1750 address ACKed, or START/address probing failed. |
| `L:E2` | Power-on transaction failed, including its write address or command ACK. |
| `L:E3` | Measurement-mode transaction failed, including its write address or command ACK. |
| `L:E4` | Read START/SLA+R failed. |
| `L:E5` | First byte timed out or status was not `0x50` (received, ACK sent). |
| `L:E6` | Final byte timed out or status was not `0x58` (received, NACK sent). |
| `L:E7` | STOP/bus release or address-probe cleanup failed. |

`S` distinguishes the cause within that stage:

| Status | Meaning |
| --- | --- |
| `0x20` | SLA+W NACK: no response at the write address. |
| `0x30` | Command/data NACK. |
| `0x48` | SLA+R NACK. |
| `0x38` | Arbitration lost. |
| `0x00` | Hardware bus error. |
| `0xFF` | Software timeout waiting for TWINT. |
| `0xFE` | Software timeout waiting for STOP to complete. |
| `0xFD` | Bus lines failed to return HIGH. |

Other values are the actual masked AVR status at the unexpected transition.
For example, `L:E1` with `S:0x20` indicates address NACK; `L:E1` with `S:0xFF`
indicates a timed-out transaction rather than proof of a missing sensor.

Cover the sensor and observe lux decrease, then uncover it and shine a phone
flashlight onto it to observe lux rise. Proceed to integration after these real
readings work. If another firmware changed the sensor's measurement-time
register, power-cycle the board before this test to restore its default scale.

**Phase 3: DHT11 + BH1750 + OLED**

```sh
avr-gcc -mmcu=atmega32 -std=gnu11 -Os -Wall -Wextra -Werror -ffunction-sections -fdata-sections -Wl,--gc-sections -DAPP_MODE=3 car.c -o integrated.elf
avr-objcopy -O ihex -R .eeprom integrated.elf integrated.hex
avrdude -c usbasp -p m32 -B 8 -U flash:w:integrated.hex:i
```

The screen displays `T:...C`, `H:...%`, `L:... lx`, plus the BH1750 address/status
on the last line. DHT11 stays on PA3 with its original Timer0 timing code and at
least two seconds between samples. Each sensor transaction completes before
OLED drawing starts. DHT errors remain on the T/H rows; light errors use E1-E7
on the L row. All flash commands write flash only; none changes fuse bits.

Compilation and software checks cannot establish that a physical sensor ACKs or
measures light correctly. Those checks require running phases 1 and 2 on the board.
