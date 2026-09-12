/* ============================================================
   Project Sylvan — ATmega32 timed drive sequence (demo/test)

   Sequence:
     0-5s   drive forward, fast
     5-10s  stop
     10-15s drive forward, slow
     15-20s drive forward, even slower
     20s+   stop (holds)

   Same pin map as sylvan_atmega32.c:
     Left motor  (L298N A): IN1=PB0, IN2=PB1, PWM=PD5 (OC1A/ENA)
     Right motor (L298N B): IN3=PB2, IN4=PB3, PWM=PD4 (OC1B/ENB)
   ============================================================ */

#define F_CPU 16000000UL
#include <avr/io.h>
#include <util/delay.h>

#define SPEED_FAST  255
#define SPEED_SLOW  140
#define SPEED_LOWER  80
#define SPEED_STOP    0

static void pwm_init(void) {
    TCCR1A = (1 << COM1A1) | (1 << COM1B1) | (1 << WGM10);
    TCCR1B = (1 << WGM12) | (1 << CS11); /* prescaler /8 */
    DDRD |= (1 << PD5) | (1 << PD4);
}

static void set_left_speed(uint8_t pwm)  { OCR1A = pwm; }
static void set_right_speed(uint8_t pwm) { OCR1B = pwm; }

static void drive_forward(void) {
    PORTB |=  (1 << PB0); PORTB &= ~(1 << PB1); /* left forward */
    PORTB |=  (1 << PB2); PORTB &= ~(1 << PB3); /* right forward */
}

static void set_speed(uint8_t pwm) {
    set_left_speed(pwm);
    set_right_speed(pwm);
}

/* _delay_ms needs a compile-time constant, so 5 seconds is
   five separate 1-second calls in a loop rather than one call */
static void delay_seconds(uint8_t s) {
    for (uint8_t i = 0; i < s; i++) {
        _delay_ms(1000);
    }
}

int main(void) {
    DDRB |= (1 << PB0) | (1 << PB1) | (1 << PB2) | (1 << PB3);

    pwm_init();
    drive_forward(); /* direction fixed forward for this whole sequence */

    set_speed(SPEED_FAST);
    delay_seconds(5);

    set_speed(SPEED_STOP);
    delay_seconds(5);

    set_speed(SPEED_SLOW);
    delay_seconds(5);

    set_speed(SPEED_LOWER);
    delay_seconds(5);

    set_speed(SPEED_STOP);
    while (1) {
        /* stay stopped */
    }
}
