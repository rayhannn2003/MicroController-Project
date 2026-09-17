#include <avr/io.h>
#include <util/delay.h>
#include <stdint.h>

/*
 * Project Sylvan - Phase 1 Loop Test
 *
 * ATmega32 -> L298N
 *
 * PB0 -> IN1  Left motor
 * PB1 -> IN2  Left motor
 * PB2 -> IN3  Right motor
 * PB3 -> IN4  Right motor
 *
 * PD5 / OC1A -> ENA  Left motor PWM
 * PD4 / OC1B -> ENB  Right motor PWM
 */

#define MOTOR_SPEED      120
#define FORWARD_TIME_MS  1000
#define TURN_TIME_MS     500
#define STOP_TIME_MS     1000


void motor_init(void)
{
    /* Motor direction pins */
    DDRB |= (1 << PB0)
          | (1 << PB1)
          | (1 << PB2)
          | (1 << PB3);

    /* PWM pins */
    DDRD |= (1 << PD5)
          | (1 << PD4);

    /*
     * Timer1
     * 8-bit Fast PWM
     * Non-inverting PWM
     * Prescaler = 8
     */
    TCCR1A = (1 << WGM10)
           | (1 << COM1A1)
           | (1 << COM1B1);

    TCCR1B = (1 << WGM12)
           | (1 << CS11);

    OCR1A = 0;
    OCR1B = 0;
}


void motor_set_speed(uint8_t left_speed, uint8_t right_speed)
{
    OCR1A = left_speed;   /* PD5 -> ENA */
    OCR1B = right_speed;  /* PD4 -> ENB */
}


void rover_forward(uint8_t speed)
{
    /* Left motor forward */
    PORTB |=  (1 << PB0);
    PORTB &= ~(1 << PB1);

    /* Right motor forward */
    PORTB |=  (1 << PB2);
    PORTB &= ~(1 << PB3);

    motor_set_speed(speed, speed);
}


void rover_rotate_left(uint8_t speed)
{
    /*
     * Rotate left in place:
     *
     * Left motor  -> backward
     * Right motor -> forward
     */

    /* Left backward */
    PORTB &= ~(1 << PB0);
    PORTB |=  (1 << PB1);

    /* Right forward */
    PORTB |=  (1 << PB2);
    PORTB &= ~(1 << PB3);

    motor_set_speed(speed, speed);
}


void rover_stop(void)
{
    /* Disable both motors */
    OCR1A = 0;
    OCR1B = 0;

    PORTB &= ~(
          (1 << PB0)
        | (1 << PB1)
        | (1 << PB2)
        | (1 << PB3)
    );
}


int main(void)
{
    motor_init();

    while (1)
    {
        /* Forward for 1000 ms */
        rover_forward(MOTOR_SPEED);
        _delay_ms(FORWARD_TIME_MS);


        /* Turn left for 500 ms */
        rover_rotate_left(MOTOR_SPEED);
        _delay_ms(TURN_TIME_MS);


        /* Stop for 1000 ms */
        rover_stop();
        _delay_ms(STOP_TIME_MS);
    }

    return 0;
}
