#include <avr/io.h>

int main(void)
{
    /*
     * PB0 -> IN1
     * PB1 -> IN2
     * PB2 -> IN3
     * PB3 -> IN4
     *
     * PD5 -> ENA
     * PD4 -> ENB
     */

    DDRB |= (1 << PB0)
          | (1 << PB1)
          | (1 << PB2)
          | (1 << PB3);

    DDRD |= (1 << PD4)
          | (1 << PD5);


    /* Both motors forward */

    // Left motor
    PORTB |=  (1 << PB0);
    PORTB &= ~(1 << PB1);

    // Right motor
    PORTB |=  (1 << PB2);
    PORTB &= ~(1 << PB3);


    /*
     * Enable BOTH motor channels continuously.
     * No PWM for this test.
     */
    PORTD |= (1 << PD4);
    PORTD |= (1 << PD5);


    while (1)
    {
    }

    return 0;
}
