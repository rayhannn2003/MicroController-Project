#ifndef LINE_SENSOR_H
#define LINE_SENSOR_H
#include <stdint.h>
void line_sensor_init(void);
uint8_t line_left_on_black(void);
uint8_t line_right_on_black(void);
#endif
