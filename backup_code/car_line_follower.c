#ifndef F_CPU
#define F_CPU 1000000UL
#endif

#include <avr/io.h>
#include <stdint.h>
#include <util/delay.h>

/*
 * Project Sylvan
 * Two-sensor black-line follower
 *
 * Motor driver:
 * PB0 -> L298N IN1   Left side
 * PB1 -> L298N IN2   Left side
 * PB2 -> L298N IN3   Right side
 * PB4 -> L298N IN4   Right side
 *
 * PD5 / OC1A -> L298N ENA   Left-side PWM
 * PD4 / OC1B -> L298N ENB   Right-side PWM
 *
 * Sensors:
 * PD2 -> Left IR sensor OUT
 * PD3 -> Right IR sensor OUT
 */


/* =========================================================
   USER CONFIGURATION
   ========================================================= */

/*
 * Your latest test suggests that the sensor output is HIGH
 * when it detects the black line.
 *
 * Keep this as 1 for:
 *      Black = HIGH
 *      Floor = LOW
 *
 * Change it to 0 for:
 *      Black = LOW
 *      Floor = HIGH
 */
#define BLACK_IS_HIGH 1


/*
 * Change a value to 1 if that side moves backward when the
 * rover should move forward.
 */
#define LEFT_MOTOR_REVERSED  0
#define RIGHT_MOTOR_REVERSED 0


/*
 * PWM range:
 * 0   = motor disabled
 * 255 = maximum PWM
 *
 * High values are used because the L298N and four-motor
 * chassis can require considerable starting power.
 */
#define FORWARD_LEFT_PWM   230
#define FORWARD_RIGHT_PWM  230

/*
 * Initially stop the inner side during correction.
 *
 * After the rover works, increase INNER_TURN_PWM to around
 * 100-180 for smoother corrections.
 */
#define INNER_TURN_PWM  0
#define OUTER_TURN_PWM  230


/* =========================================================
   PIN DEFINITIONS
   ========================================================= */

#define LEFT_IN1   PB0
#define LEFT_IN2   PB1

#define RIGHT_IN1  PB2
#define RIGHT_IN2  PB4

#define LEFT_IR    PD2
#define RIGHT_IR   PD3

#define LEFT_MOTOR_MASK \
    ((1 << LEFT_IN1) | (1 << LEFT_IN2))

#define RIGHT_MOTOR_MASK \
    ((1 << RIGHT_IN1) | (1 << RIGHT_IN2))

#define ALL_MOTOR_DIRECTION_PINS \
    (LEFT_MOTOR_MASK | RIGHT_MOTOR_MASK)


/* =========================================================
   MOTOR DIRECTION
   ========================================================= */

static void left_motor_forward(void)
{
    /* Clear both left-side direction pins first. */
    PORTB &= ~LEFT_MOTOR_MASK;

#if LEFT_MOTOR_REVERSED
    PORTB |= (1 << LEFT_IN2);
#else
    PORTB |= (1 << LEFT_IN1);
#endif
}


static void right_motor_forward(void)
{
    /* Clear both right-side direction pins first. */
    PORTB &= ~RIGHT_MOTOR_MASK;

#if RIGHT_MOTOR_REVERSED
    PORTB |= (1 << RIGHT_IN2);
#else
    PORTB |= (1 << RIGHT_IN1);
#endif
}


/* =========================================================
   PWM SPEED CONTROL
   ========================================================= */

static void set_motor_speed(uint8_t left_speed,
                            uint8_t right_speed)
{
    /*
     * OC1A / PD5 controls ENA / left side.
     * OC1B / PD4 controls ENB / right side.
     */
    OCR1A = left_speed;
    OCR1B = right_speed;
}


static void pwm_init(void)
{
    /*
     * PD5 = OC1A
     * PD4 = OC1B
     */
    DDRD |= (1 << PD5) | (1 << PD4);

    /* Motors remain disabled during initialization. */
    OCR1A = 0;
    OCR1B = 0;

    /*
     * Timer1 Fast PWM, 8-bit mode
     *
     * WGM13:0 = 0101
     *
     * Non-inverting PWM:
     * COM1A1 = 1
     * COM1B1 = 1
     *
     * No prescaler:
     * CS10 = 1
     *
     * At 1 MHz:
     * PWM frequency = 1,000,000 / 256
     *               = approximately 3.9 kHz
     */
    TCCR1A =
        (1 << COM1A1) |
        (1 << COM1B1) |
        (1 << WGM10);

    TCCR1B =
        (1 << WGM12) |
        (1 << CS10);
}


/* =========================================================
   MOVEMENT FUNCTIONS
   ========================================================= */

static void motor_stop(void)
{
    /* Disable both L298N channels. */
    set_motor_speed(0, 0);

    /* Put all direction pins LOW. */
    PORTB &= ~ALL_MOTOR_DIRECTION_PINS;
}


static void motor_forward(void)
{
    left_motor_forward();
    right_motor_forward();

    set_motor_speed(
        FORWARD_LEFT_PWM,
        FORWARD_RIGHT_PWM
    );
}


static void steer_left(void)
{
    /*
     * Left sensor sees black and right sensor sees floor.
     *
     * Slow/stop the left side.
     * Continue driving the right side.
     */
    left_motor_forward();
    right_motor_forward();

    set_motor_speed(
        INNER_TURN_PWM,
        OUTER_TURN_PWM
    );
}


static void steer_right(void)
{
    /*
     * Right sensor sees black and left sensor sees floor.
     *
     * Continue driving the left side.
     * Slow/stop the right side.
     */
    left_motor_forward();
    right_motor_forward();

    set_motor_speed(
        OUTER_TURN_PWM,
        INNER_TURN_PWM
    );
}


/* =========================================================
   IR SENSOR READING
   ========================================================= */

/*
 * Read each sensor five times and use majority voting.
 *
 * This reduces rapid motor on/off switching if the sensor
 * output flickers near the edge of the black tape.
 */
static void read_ir_sensors(uint8_t *left_black,
                            uint8_t *right_black)
{
    uint8_t left_high_count = 0;
    uint8_t right_high_count = 0;

    for (uint8_t sample = 0; sample < 5; sample++)
    {
        uint8_t sensor_pins = PIND;

        if (sensor_pins & (1 << LEFT_IR))
        {
            left_high_count++;
        }

        if (sensor_pins & (1 << RIGHT_IR))
        {
            right_high_count++;
        }

        _delay_us(200);
    }

    uint8_t left_is_high =
        (left_high_count >= 3);

    uint8_t right_is_high =
        (right_high_count >= 3);

#if BLACK_IS_HIGH

    *left_black = left_is_high;
    *right_black = right_is_high;

#else

    *left_black = !left_is_high;
    *right_black = !right_is_high;

#endif
}


/* =========================================================
   HARDWARE INITIALIZATION
   ========================================================= */

static void hardware_init(void)
{
    /*
     * Motor direction pins are outputs.
     */
    DDRB |= ALL_MOTOR_DIRECTION_PINS;

    /*
     * Start with all motor direction pins LOW.
     */
    PORTB &= ~ALL_MOTOR_DIRECTION_PINS;

    /*
     * PD2 and PD3 are sensor inputs.
     */
    DDRD &= ~((1 << LEFT_IR) |
              (1 << RIGHT_IR));

    /*
     * Disable the ATmega32 internal pull-up resistors.
     * The IR modules actively drive their OUT pins.
     */
    PORTD &= ~((1 << LEFT_IR) |
               (1 << RIGHT_IR));

    pwm_init();
    motor_stop();
}


/* =========================================================
   MAIN PROGRAM
   ========================================================= */

int main(void)
{
    uint8_t left_black;
    uint8_t right_black;

    hardware_init();

    while (1)
    {
        read_ir_sensors(
            &left_black,
            &right_black
        );

        /*
         * BLACK + BLACK
         * Both sensors are on the desired path.
         */
        if (left_black && right_black)
        {
            motor_forward();
        }

        /*
         * BLACK + WHITE
         * Rover has moved toward the right.
         * Correct toward the left.
         */
        else if (left_black && !right_black)
        {
            steer_left();
        }

        /*
         * WHITE + BLACK
         * Rover has moved toward the left.
         * Correct toward the right.
         */
        else if (!left_black && right_black)
        {
            steer_right();
        }

        /*
         * WHITE + WHITE
         * The black line has been lost.
         */
        else
        {
            motor_stop();
        }

        _delay_ms(2);
    }
}
