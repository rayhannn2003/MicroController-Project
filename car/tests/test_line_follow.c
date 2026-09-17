#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <avr/io.h>
#include "config.h"
#include "motor.h"
#include "line_sensor.h"
#include "line_follow.h"

void reference_init(uint32_t now);
void reference_step(uint32_t now, uint8_t leftBlack, uint8_t rightBlack);
extern uint8_t ref_PORTB;
extern uint16_t ref_OCR1A, ref_OCR1B;

static void step(uint32_t now, uint8_t left, uint8_t right)
{
    PINA = (left << PA1) | (right << PA2);
    reference_step(now, left, right);
    line_follow_update(now);
    assert(PORTB == ref_PORTB);
    assert(OCR1A == ref_OCR1A && OCR1B == ref_OCR1B);
    assert(ICR1 == 49 && TCCR1A == 0xa2 && TCCR1B == 0x19);
}

int main(void)
{
    uint32_t rng = 12345;
    for (unsigned run = 0; run < 32; run++) {
        uint32_t now = (run & 1) ? UINT32_MAX - 1500U : 0U;
        PORTB = 0xa0;
        PORTA = 0x18;
        line_sensor_init();
        assert((PORTA & 0x1e) == 0x1e); /* Preserve unrelated PA bits. */
        motor_init();
        line_follow_init(now);
        reference_init(now);
        /* Startup, simultaneous loss, braking boundaries, both turn histories. */
        static const uint16_t times[] = {0,999,1000,1001,1002,1026,1027,1066,1067,1081,1082,1381,1382,1383};
        for (unsigned i = 0; i < sizeof(times)/sizeof(times[0]); i++)
            step(now + times[i], i < 3 ? 1 : 0, i < 3 ? 1 : 0);
        now += 1400;
        for (unsigned i = 0; i < 10000; i++) {
            rng = rng * 1664525U + 1013904223U;
            now += (rng >> 24) % 50;
            step(now, (rng >> 12) & 1, (rng >> 13) & 1);
        }
    }
    puts("PASS: original lfr.c and modular outputs match for 320,448 updates, including clock wrap.");
    /* Freeze at every millisecond of startup and recovery; compare resumption
     * against the original controller with the stopped time excluded. */
    for (unsigned freeze_at = 0; freeze_at < 1500; freeze_at++) {
        uint32_t base = UINT32_MAX - 1200U, stopped = 0;
        PORTB = 0xa0;
        motor_init();
        line_follow_init(base);
        reference_init(base);
        for (unsigned i = 0; i < 1500; i++) {
            uint8_t left = i < 1010 || i >= 1450;
            uint8_t right = i < 1011 || i >= 1450;
            uint32_t now = base + i + stopped;
            if (i == freeze_at) {
                line_follow_set_paused(1, now);
                for (unsigned hold = 0; hold < 700; hold++) {
                    line_follow_set_paused(1, now + hold);
                    line_follow_update(now + hold);
                    assert((PORTB & 15) == 0 && OCR1A == 0 && OCR1B == 0);
                }
                stopped += 700;
                line_follow_set_paused(0, now + 700);
            }
            PINA = (left << PA1) | (right << PA2);
            reference_step(base + i, left, right);
            line_follow_update(base + i + stopped);
            assert(PORTB == ref_PORTB);
            assert(OCR1A == ref_OCR1A && OCR1B == ref_OCR1B);
        }
    }
    puts("PASS: pause/resume preserves startup and every recovery phase across clock wrap.");
}
