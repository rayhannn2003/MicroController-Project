MCU := atmega32
F_CPU := 1000000UL
PROGRAMMER := usbasp
PART := m32
BITCLOCK ?= 8
STAGE ?= 6

ifeq ($(filter $(STAGE),1 2 3 4 5 6),)
$(error STAGE must be 1, 2, 3, 4, 5, or 6)
endif

CC := avr-gcc
OBJCOPY := avr-objcopy
AVRDUDE := avrdude
BUILD := .build/stage$(STAGE)
SOURCES := main.c motor.c line_sensor.c line_follow.c timebase.c
ifneq ($(filter $(STAGE),2 3 4 5 6),)
SOURCES += twi.c oled.c
endif
ifneq ($(filter $(STAGE),3 4 5 6),)
SOURCES += bh1750.c
endif
ifneq ($(filter $(STAGE),4 5 6),)
SOURCES += dht11.c
endif
ifneq ($(filter $(STAGE),5 6),)
SOURCES += hcsr04.c
endif
ifeq ($(STAGE),6)
SOURCES += sample_cycle.c
endif
OBJECTS := $(SOURCES:%.c=$(BUILD)/%.o)
OLED_DEBUG_BUILD := .build/oled-debug
OLED_DEBUG_SOURCES := oled_debug.c twi.c oled.c timebase.c
OLED_DEBUG_OBJECTS := $(OLED_DEBUG_SOURCES:%.c=$(OLED_DEBUG_BUILD)/%.o)
CPPFLAGS := -DF_CPU=$(F_CPU) -DINTEGRATION_STAGE=$(STAGE)
OLED_DEBUG_CPPFLAGS := -DF_CPU=$(F_CPU) -DINTEGRATION_STAGE=2
CFLAGS := -mmcu=$(MCU) -std=gnu11 -Os -Wall -Wextra -Werror -ffunction-sections -fdata-sections
LDFLAGS := -mmcu=$(MCU) -Wl,--gc-sections,-Map,$(BUILD)/main.map
OLED_DEBUG_LDFLAGS := -mmcu=$(MCU) -Wl,--gc-sections,-Map,$(OLED_DEBUG_BUILD)/main.map

.DEFAULT_GOAL := all
.PHONY: all stage stages flash oled-debug oled-debug-flash clean test test-sim source-bundle
all: stage
	cp $(BUILD)/main.elf main.elf
	cp $(BUILD)/main.hex main.hex

stage: $(BUILD)/main.hex

oled-debug: $(OLED_DEBUG_BUILD)/main.hex

oled-debug-flash: oled-debug
	$(AVRDUDE) -c $(PROGRAMMER) -p $(PART) -B $(BITCLOCK) \
		-U flash:w:$(OLED_DEBUG_BUILD)/main.hex:i

stages:
	@for s in 1 2 3 4 5 6; do $(MAKE) --no-print-directory STAGE=$$s stage || exit $$?; done

test:
	python3 tests/run_tests.py

test-sim:
	$(MAKE) --no-print-directory STAGE=6 stage
	python3 tests/run_simavr.py

source-bundle:
	python3 tools/export_sources.py

$(BUILD)/%.o: %.c Makefile
	@mkdir -p $(BUILD)
	$(CC) $(CPPFLAGS) $(CFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/main.elf: $(OBJECTS)
	$(CC) $(LDFLAGS) $^ -o $@

$(BUILD)/main.hex: $(BUILD)/main.elf
	$(OBJCOPY) -O ihex -R .eeprom $< $@

$(OLED_DEBUG_BUILD)/%.o: %.c Makefile
	@mkdir -p $(OLED_DEBUG_BUILD)
	$(CC) $(OLED_DEBUG_CPPFLAGS) $(CFLAGS) -MMD -MP -c $< -o $@

$(OLED_DEBUG_BUILD)/main.elf: $(OLED_DEBUG_OBJECTS)
	$(CC) $(OLED_DEBUG_LDFLAGS) $^ -o $@

$(OLED_DEBUG_BUILD)/main.hex: $(OLED_DEBUG_BUILD)/main.elf
	$(OBJCOPY) -O ihex -R .eeprom $< $@

flash: stage
	$(AVRDUDE) -c $(PROGRAMMER) -p $(PART) -B $(BITCLOCK) \
		-U flash:w:$(BUILD)/main.hex:i

clean:
	rm -rf .build
	rm -f main.elf main.hex

-include $(OBJECTS:.o=.d) $(OLED_DEBUG_OBJECTS:.o=.d)
