MCU := atmega32
F_CPU := 1000000UL
TARGET := car
SOURCE := car.c
PROGRAMMER := usbasp
PART := m32

CC := avr-gcc
OBJCOPY := avr-objcopy
AVRDUDE := avrdude

CPPFLAGS := -DF_CPU=$(F_CPU)
CFLAGS := -mmcu=$(MCU) -std=gnu11 -Os -Wall -Wextra

.PHONY: all flash clean

all: $(TARGET).hex

$(TARGET).elf: $(SOURCE) config.h Makefile
	$(CC) $(CPPFLAGS) $(CFLAGS) $< -o $@

$(TARGET).hex: $(TARGET).elf
	$(OBJCOPY) -O ihex -R .eeprom $< $@

flash: $(TARGET).hex
	$(AVRDUDE) -c $(PROGRAMMER) -p $(PART) -B 8 \
		-U flash:w:$(TARGET).hex:i

clean:
	rm -f $(TARGET).elf $(TARGET).hex
