#include <avr/io.h>
#include <util/delay.h>
#include <stdint.h>

/*
 * Project Sylvan - Square Movement Test
 *
 * ATmega32 -> L298N
 *
 * PB0 -> IN1
 * PB1 -> IN2
 * PB2 -> IN3
 * PB3 -> IN4
 *
 * PD5 / OC1A -> ENA
 * PD4 / OC1B -> ENB
 */

#define MOTOR_SPEED       120

/* Length of each side */
#define SIDE_TIME_MS      1500

/* Adjust this until rotation is approximately 90 degrees */
#define TURN_TIME_MS      500

/* Small pause after completing square */
#define PAUSE_TIME_MS     1000


void motor_init(void)
{
    /* Direction pins */
    DDRB |= (1 << PB0)
          | (1 << PB1)
          | (1 << PB2)
          | (1 << PB3);

    /* PWM output pins */
    DDRD |= (1 << PD5)
          | (1 << PD4);

    /*
     * Timer1
     * 8-bit Fast PWM
     * OC1A + OC1B non-inverting
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
    OCR1A = left_speed;    // PD5 -> ENA
    OCR1B = right_speed;   // PD4 -> ENB
}


void rover_forward(uint8_t speed)
{
    /*
     * This is the polarity that should physically
     * move your rover FORWARD based on your previous test.
     */

    /* Left motor forward */
    PORTB &= ~(1 << PB0);
    PORTB |=  (1 << PB1);

    /* Right motor forward */
    PORTB &= ~(1 << PB2);
    PORTB |=  (1 << PB3);

    motor_set_speed(speed, speed);
}


void rover_rotate_right(uint8_t speed)
{
    /*
     * Rotate in place:
     *
     * Left motor  -> forward
     * Right motor -> backward
     */

    /* Left forward */
    PORTB &= ~(1 << PB0);
    PORTB |=  (1 << PB1);

    /* Right backward */
    PORTB |=  (1 << PB2);
    PORTB &= ~(1 << PB3);

    motor_set_speed(speed, speed);
}


void rover_stop(void)
{
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
        /*
         * Four sides of the square
         */
        for (uint8_t side = 0; side < 4; side++)
        {
            /* Move straight */
            rover_forward(MOTOR_SPEED);
            _delay_ms(SIDE_TIME_MS);

            /* Brief stop before turning */
            rover_stop();
            _delay_ms(200);

            /* Approximately 90-degree right turn */
            rover_rotate_right(MOTOR_SPEED);
            _delay_ms(TURN_TIME_MS);

            /* Brief stop after turn */
            rover_stop();
            _delay_ms(200);
        }

        /* Square completed */
        rover_stop();
        _delay_ms(PAUSE_TIME_MS);
    }

    return 0;
}
