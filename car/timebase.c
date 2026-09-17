#include "config.h"
#include "timebase.h"
#include <avr/io.h>
#include <avr/interrupt.h>

static volatile uint32_t system_millis;
ISR(TIMER0_COMP_vect) { system_millis++; }

uint32_t timebase_millis(void)
{
    uint8_t saved = SREG;
    cli();
    uint32_t now = system_millis;
    SREG = saved;
    return now;
}

void timebase_init(void)
{
    cli();
    system_millis = 0;
    TCCR0 = (1 << WGM01) | (1 << CS01);
    OCR0 = 124;
    TCNT0 = 0;
    TIFR = (1 << OCF0);
    TIMSK |= (1 << OCIE0);
    sei();
}

static uint8_t paused, saved_control;

void timebase_pause(void)
{
    uint8_t saved = SREG;
    cli();
    if (!paused) {
        saved_control = TCCR0;
        TCCR0 &= (uint8_t)~((1 << CS00) | (1 << CS01) | (1 << CS02));
        if (TIFR & (1 << OCF0)) {
            TIFR = (1 << OCF0);
            system_millis++;
        }
        paused = 1;
    }
    SREG = saved;
}

void timebase_resume(void)
{
    uint8_t saved = SREG;
    cli();
    if (paused) {
        TCCR0 = saved_control;
        paused = 0;
    }
    SREG = saved;
}
