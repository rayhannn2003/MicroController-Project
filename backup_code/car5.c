#include <avr/io.h>
#include <util/delay.h>
#include <stdint.h>

#define MOTOR_SPEED      120
#define MOVE_TIME_MS     1000
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

    /* Timer1 - 8-bit Fast PWM */
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
    OCR1A = left_speed;   // PD5 -> ENA
    OCR1B = right_speed;  // PD4 -> ENB
}


/*
 * REVERSED direction compared with your previous code.
 */
void rover_move(uint8_t speed)
{
    /* Left motor */
    PORTB &= ~(1 << PB0);
    PORTB |=  (1 << PB1);

    /* Right motor */
    PORTB &= ~(1 << PB2);
    PORTB |=  (1 << PB3);

    motor_set_speed(speed, speed);
}


void rover_rotate_left(uint8_t speed)
{
    /* Left motor: original direction */
    PORTB |=  (1 << PB0);
    PORTB &= ~(1 << PB1);

    /* Right motor: reversed direction */
    PORTB &= ~(1 << PB2);
    PORTB |=  (1 << PB3);

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
        /* Move in opposite direction for 1000 ms */
        rover_move(MOTOR_SPEED);
        _delay_ms(MOVE_TIME_MS);

        /* Turn left for 500 ms */
        rover_rotate_left(MOTOR_SPEED);
        _delay_ms(TURN_TIME_MS);

        /* Stop for 1000 ms */
        rover_stop();
        _delay_ms(STOP_TIME_MS);
    }

    return 0;
}
