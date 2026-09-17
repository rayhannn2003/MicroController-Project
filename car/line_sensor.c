#include "config.h"
#include "line_sensor.h"
#include <avr/io.h>

void line_sensor_init(void)
{
    DDRA &= (uint8_t)~((1U << LEFT_SENSOR_PIN) | (1U << RIGHT_SENSOR_PIN));
    PORTA |= (1U << LEFT_SENSOR_PIN) | (1U << RIGHT_SENSOR_PIN);
}

static uint8_t on_black(uint8_t pin)
{
    uint8_t high = (PINA & (1U << pin)) != 0U;
#if SENSOR_BLACK_IS_HIGH
    return high;
#else
    return !high;
#endif
}
uint8_t line_left_on_black(void) { return on_black(LEFT_SENSOR_PIN); }
uint8_t line_right_on_black(void) { return on_black(RIGHT_SENSOR_PIN); }
