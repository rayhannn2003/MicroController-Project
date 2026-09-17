#ifndef OLED_H
#define OLED_H
#include <stdint.h>
#define OLED_ROWS 4U
#define OLED_COLUMNS 21U
void oled_init(void);
void oled_set_line(uint8_t row, const char *text);
void oled_service(uint32_t now);
#endif
