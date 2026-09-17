#ifndef FAKE_AVR_PGMSPACE_H
#define FAKE_AVR_PGMSPACE_H
#define PROGMEM
#define pgm_read_byte(address) (*(const unsigned char *)(address))
#endif
