MCU = atmega32
F_CPU = 1000000UL
TARGET = car

all:
	avr-gcc -mmcu=$(MCU) -DF_CPU=$(F_CPU) -Os -Wall -o $(TARGET).elf $(TARGET).c
	avr-objcopy -O ihex -R .eeprom $(TARGET).elf $(TARGET).hex

flash: all
	avrdude -c usbasp -p m32 -B 8 -U flash:w:$(TARGET).hex:i

clean:
	rm -f *.elf *.hex
