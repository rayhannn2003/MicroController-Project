#include "config.h"
#include "hcsr04.h"
#include <avr/io.h>
#include <avr/interrupt.h>
#include <util/delay.h>

#define TIMEOUT_TICKS (HCSR04_TIMEOUT_US / 8UL)
static uint16_t upper_ticks;

/* Timer2 / 8 gives 8 us ticks; the tight polling loop services every overflow. */
static uint16_t timer_ticks(void)
{
    uint8_t low = TCNT2;
    if (TIFR & (1 << TOV2)) {
        low = TCNT2;
        TIFR = (1 << TOV2);
        upper_ticks += 256U;
    }
    return upper_ticks + low;
}

void hcsr04_init(void)
{
    DDRA |= (1 << HCSR04_TRIG_PIN);
    PORTA &= (uint8_t)~(1 << HCSR04_TRIG_PIN);
    DDRA &= (uint8_t)~(1 << HCSR04_ECHO_PIN);
    PORTA &= (uint8_t)~(1 << HCSR04_ECHO_PIN);
    TCCR2 = 0;
    TIMSK &= (uint8_t)~((1 << TOIE2) | (1 << OCIE2));
}

uint16_t hcsr04_get_distance_cm(void)
{
    uint16_t result = HCSR04_INVALID_CM;
    uint8_t saved = SREG;
    cli();
    /* A HIGH before triggering is not a new measurement. */
    if (PINA & (1 << HCSR04_ECHO_PIN)) goto done;

    /* Preserve the reference's 3 us LOW, 12 us HIGH trigger. */
    PORTA &= (uint8_t)~(1 << HCSR04_TRIG_PIN);
    _delay_us(3);
    PORTA |= (1 << HCSR04_TRIG_PIN);
    _delay_us(12);
    PORTA &= (uint8_t)~(1 << HCSR04_TRIG_PIN);

    TCCR2 = 0;
    TCNT2 = 0;
    TIFR = (1 << TOV2);
    upper_ticks = 0;
    TCCR2 = (1 << CS21);

    while (!(PINA & (1 << HCSR04_ECHO_PIN))) {
        if (timer_ticks() >= TIMEOUT_TICKS) goto done;
    }
    uint16_t rise = timer_ticks();
    while (PINA & (1 << HCSR04_ECHO_PIN)) {
        if ((uint16_t)(timer_ticks() - rise) >= TIMEOUT_TICKS) goto done;
    }
    uint16_t width = timer_ticks() - rise;
    if (width != 0 && width < TIMEOUT_TICKS)
        result = (width * 8U) / 58U;

done:
    TCCR2 = 0;
    SREG = saved;
    return result;
}
