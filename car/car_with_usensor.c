#include <avr/io.h>
#include <util/delay.h>
#include <stdint.h>

/*
 * Project Sylvan
 * Phase 1 - HC-SR04 Obstacle Detection
 *
 * Motor:
 * PB0 -> IN1
 * PB1 -> IN2
 * PB2 -> IN3
 * PB3 -> IN4
 *
 * PD5 / OC1A -> ENA
 * PD4 / OC1B -> ENB
 *
 * HC-SR04:
 * PA3 -> TRIG
 * PA4 -> ECHO
 */

#define MOTOR_SPEED 120

#define TRIG_PIN PA3
#define ECHO_PIN PA4

#define OBSTACLE_DISTANCE_CM 20

#define HC_TIMEOUT_US 30000UL

/* Timer0 prescaler */
#define TIMER0_PRESCALER 8UL


/* =========================================================
   MOTOR
   ========================================================= */

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
    OCR1A = left_speed;
    OCR1B = right_speed;
}


void rover_forward(uint8_t speed)
{
    /*
     * Physical forward direction based
     * on your current motor wiring.
     */

    /* Left motor forward */
    PORTB &= ~(1 << PB0);
    PORTB |=  (1 << PB1);

    /* Right motor forward */
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


/* =========================================================
   HC-SR04
   ========================================================= */

void ultrasonic_init(void)
{
    /* TRIG = output */
    DDRA |= (1 << TRIG_PIN);

    /* ECHO = input */
    DDRA &= ~(1 << ECHO_PIN);

    /* No pull-up on ECHO */
    PORTA &= ~(1 << ECHO_PIN);

    /* TRIG initially LOW */
    PORTA &= ~(1 << TRIG_PIN);
}


/*
 * Start Timer0.
 *
 * Timer0 is separate from Timer1,
 * so it will not disturb motor PWM.
 */
void timer0_start(void)
{
    TCNT0 = 0;

    /* Clear overflow flag */
    TIFR = (1 << TOV0);

    /*
     * Timer0 prescaler = 8
     */
    TCCR0 = (1 << CS01);
}


void timer0_stop(void)
{
    TCCR0 = 0;
}


/*
 * Returns distance in centimeters.
 *
 * 0xFFFF means timeout / no valid echo.
 */
uint16_t ultrasonic_get_distance_cm(void)
{
    uint32_t overflow_count = 0;
    uint32_t total_ticks;
    uint32_t timeout_ticks;
    uint32_t pulse_us;
    uint16_t distance_cm;

    /*
     * HC-SR04 trigger pulse
     */
    PORTA &= ~(1 << TRIG_PIN);
    _delay_us(2);

    PORTA |= (1 << TRIG_PIN);
    _delay_us(10);

    PORTA &= ~(1 << TRIG_PIN);


    /*
     * Maximum number of Timer0 ticks
     * corresponding to 30000 us.
     */
    timeout_ticks =
        (F_CPU / TIMER0_PRESCALER)
        * HC_TIMEOUT_US
        / 1000000UL;


    /* -----------------------------------------
       Wait for ECHO to become HIGH
       ----------------------------------------- */

    timer0_start();

    overflow_count = 0;

    while (!(PINA & (1 << ECHO_PIN)))
    {
        if (TIFR & (1 << TOV0))
        {
            overflow_count++;

            /* Clear overflow flag */
            TIFR = (1 << TOV0);
        }

        total_ticks =
            (overflow_count * 256UL)
            + TCNT0;

        if (total_ticks >= timeout_ticks)
        {
            timer0_stop();

            return 0xFFFF;
        }
    }


    /* -----------------------------------------
       ECHO became HIGH.

       Now measure how long it remains HIGH.
       ----------------------------------------- */

    timer0_start();

    overflow_count = 0;

    while (PINA & (1 << ECHO_PIN))
    {
        if (TIFR & (1 << TOV0))
        {
            overflow_count++;

            TIFR = (1 << TOV0);
        }

        total_ticks =
            (overflow_count * 256UL)
            + TCNT0;

        if (total_ticks >= timeout_ticks)
        {
            timer0_stop();

            return 0xFFFF;
        }
    }


    /* Echo finished */
    total_ticks =
        (overflow_count * 256UL)
        + TCNT0;

    timer0_stop();


    /*
     * Convert Timer0 ticks -> microseconds
     *
     * Timer frequency:
     *
     * F_CPU / 8
     */

    pulse_us =
        total_ticks
        * TIMER0_PRESCALER
        * 1000000UL
        / F_CPU;


    /*
     * HC-SR04:
     *
     * distance_cm ~= echo_time_us / 58
     */

    distance_cm = pulse_us / 58UL;

    return distance_cm;
}


/* =========================================================
   MAIN
   ========================================================= */

int main(void)
{
    uint16_t distance;

    motor_init();
    ultrasonic_init();

    /* Let HC-SR04 stabilize */
    _delay_ms(100);


    while (1)
    {
        distance = ultrasonic_get_distance_cm();


        /*
         * Valid measurement and obstacle
         * within 20 cm.
         */
        if (
            distance != 0xFFFF &&
            distance <= OBSTACLE_DISTANCE_CM
        )
        {
            rover_stop();
        }
        else
        {
            rover_forward(MOTOR_SPEED);
        }


        /*
         * Do not trigger HC-SR04 too rapidly.
         */
        _delay_ms(60);
    }

    return 0;
}
