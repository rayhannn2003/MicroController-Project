#include "config.h"
#include "motor.h"
#include <avr/io.h>
#include <stdint.h>

#define MOTOR_MASK ((1U << MOTOR_IN1) | (1U << MOTOR_IN2) | \
                    (1U << MOTOR_IN3) | (1U << MOTOR_IN4))
/* Same percent-to-OCR expression as lfr.c, folded at compile time. */
#define PWM_VALUE(percent) ((percent) >= 100U ? MOTOR_PWM_TOP : \
    (uint16_t)(((uint32_t)(percent) * MOTOR_PWM_TOP) / 100U))

static void set_pattern(uint8_t pattern)
{
    PORTB = (PORTB & (uint8_t)~MOTOR_MASK) | pattern;
}

void motor_init(void)
{
    DDRB |= MOTOR_MASK;
    DDRD |= (1 << MOTOR_ENA) | (1 << MOTOR_ENB);
    /* Original mode 14, no prescaler, TOP 49: 20 kHz at 1 MHz. */
    TCCR1A = (1 << COM1A1) | (1 << COM1B1) | (1 << WGM11);
    TCCR1B = (1 << WGM13) | (1 << WGM12) | (1 << CS10);
    ICR1 = MOTOR_PWM_TOP;
    motor_stop();
}

void motor_forward(void)
{
    set_pattern((1 << MOTOR_IN1) | (1 << MOTOR_IN3)); /* 0x05 */
    OCR1A = PWM_VALUE(BASE_SPEED_PERCENT);
    OCR1B = PWM_VALUE(BASE_SPEED_PERCENT);
}

void motor_backward(void)
{
    set_pattern((1 << MOTOR_IN2) | (1 << MOTOR_IN4)); /* 0x0A */
    OCR1A = PWM_VALUE(REVERSE_SPEED_PERCENT);
    OCR1B = PWM_VALUE(REVERSE_SPEED_PERCENT);
}

void motor_pivot_left(void)
{
    set_pattern((1 << MOTOR_IN2) | (1 << MOTOR_IN3)); /* 0x06 */
    OCR1A = PWM_VALUE(PIVOT_SPEED_PERCENT);
    OCR1B = PWM_VALUE(PIVOT_SPEED_PERCENT);
}

void motor_pivot_right(void)
{
    set_pattern((1 << MOTOR_IN1) | (1 << MOTOR_IN4)); /* 0x09 */
    OCR1A = PWM_VALUE(PIVOT_SPEED_PERCENT);
    OCR1B = PWM_VALUE(PIVOT_SPEED_PERCENT);
}

void motor_brake(void)
{
    set_pattern(MOTOR_MASK); /* 0x0F */
    OCR1A = MOTOR_PWM_TOP;
    OCR1B = MOTOR_PWM_TOP;
}

void motor_stop(void)
{
    OCR1A = 0;
    OCR1B = 0;
    set_pattern(0);
}

uint8_t motor_is_driving(void)
{
    uint8_t pattern = PORTB & MOTOR_MASK;
    return pattern != 0 && pattern != MOTOR_MASK && (OCR1A != 0 || OCR1B != 0);
}
