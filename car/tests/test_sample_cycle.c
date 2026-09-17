#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <avr/io.h>
#include "config.h"
#include "hcsr04.h"
#include "sample_cycle.h"

static uint8_t held;
static unsigned holds, releases;
void line_follow_set_paused(uint8_t hold, uint32_t now)
{
    (void)now;
    held = hold;
    if (hold) holds++;
    else releases++;
}

static void expect_tx(const char *text)
{
    assert(uart_tx_len == strlen(text) && !memcmp(uart_tx, text, uart_tx_len));
}

static uint32_t finish_sample(uint32_t started, uint8_t success, int16_t temp_c,
                              const char *packet)
{
    uart_tx_len = 0;
    assert(held && sample_cycle_phase() == SAMPLE_ACQUIRING);
    assert(sample_cycle_needs_dht());
    assert(!sample_cycle_needs_light(started + SAMPLE_LIGHT_SETTLE_MS - 1));
    assert(sample_cycle_needs_light(started + SAMPLE_LIGHT_SETTLE_MS));
    sample_cycle_dht_done(success, temp_c, 66);
    assert(!sample_cycle_needs_dht());
    /* Late duplicate reports cannot replace the recorded readings. */
    sample_cycle_dht_done(1, 99, 99);
    sample_cycle_update(started + 200);
    assert(sample_cycle_phase() == SAMPLE_ACQUIRING);
    assert(uart_tx_len == 0); /* Nothing is sent before the result is known. */
    sample_cycle_light_done(1, 235);
    sample_cycle_light_done(1, 999);
    assert(!sample_cycle_needs_light(started + 200));
    uint32_t ready = started + 201;
    sample_cycle_update(ready);
    assert(sample_cycle_phase() == SAMPLE_READINGS && held);
    expect_tx(packet);
    /* Exactly one packet, however many loop passes the timed screens take. */
    for (uint32_t i = 0; i < SAMPLE_READINGS_TIME_MS; i += 7)
        sample_cycle_update(ready + i);
    expect_tx(packet);
    sample_cycle_update(ready + SAMPLE_READINGS_TIME_MS - 1);
    assert(sample_cycle_phase() == SAMPLE_READINGS && held);
    uint32_t result = ready + SAMPLE_READINGS_TIME_MS;
    sample_cycle_update(result);
    assert(sample_cycle_phase() == SAMPLE_RESULT && held);
    assert(sample_cycle_succeeded() == success);
    sample_cycle_update(result + SAMPLE_RESULT_TIME_MS - 1);
    assert(sample_cycle_phase() == SAMPLE_RESULT && held);
    for (uint32_t i = 0; i < SAMPLE_RESULT_TIME_MS; i += 7)
        sample_cycle_update(result + i);
    sample_cycle_update(result + SAMPLE_RESULT_TIME_MS);
    assert(sample_cycle_phase() == SAMPLE_DRIVING && !held);
    sample_cycle_update(result + SAMPLE_RESULT_TIME_MS + 5000);
    expect_tx(packet);
    return result + SAMPLE_RESULT_TIME_MS;
}

int main(void)
{
    for (unsigned wrap = 0; wrap < 2; wrap++) {
        uint32_t start = wrap ? UINT32_MAX - 100U : 100U;
        sample_cycle_init();
        holds = releases = 0;
        assert(!sample_cycle_observe(HCSR04_INVALID_CM, start));
        assert(!sample_cycle_observe(31, start));
        assert(sample_cycle_observe(30, start));
        assert(holds == 1);
        assert(!sample_cycle_observe(10, start + 1));
        uint32_t resumed = finish_sample(start, 1, 30, "<S,T=30,H=66,L=235>\n");
        assert(holds == 1 && releases == 1);
        /* Remaining beside the same object must not trap the rover in a loop. */
        uart_tx_len = 0;
        for (unsigned i = 0; i < 10000; i += 80) {
            assert(!sample_cycle_observe(18, resumed + i));
            sample_cycle_update(resumed + i);
        }
        assert(uart_tx_len == 0); /* No UART traffic while driving. */
        resumed += 10000;
        assert(!sample_cycle_observe(36, resumed));
        assert(!sample_cycle_observe(36, resumed + OBJECT_CLEAR_TIME_MS - 1));
        assert(!sample_cycle_observe(18, resumed + OBJECT_CLEAR_TIME_MS));
        /* A brief gap or noisy reading does not rearm; sustained no echo does. */
        resumed += 1000;
        assert(!sample_cycle_observe(HCSR04_INVALID_CM, resumed));
        assert(!sample_cycle_observe(HCSR04_INVALID_CM, resumed + OBJECT_CLEAR_TIME_MS));
        start = resumed + OBJECT_CLEAR_TIME_MS + 80;
        assert(sample_cycle_observe(18, start));
        resumed = finish_sample(start, 0, 30, "<F>\n");
        assert(holds == 2 && releases == 2);
        /* A sub-zero temperature is formatted with its sign. */
        resumed += 10000;
        assert(!sample_cycle_observe(HCSR04_INVALID_CM, resumed));
        assert(!sample_cycle_observe(HCSR04_INVALID_CM, resumed + OBJECT_CLEAR_TIME_MS));
        start = resumed + OBJECT_CLEAR_TIME_MS + 80;
        assert(sample_cycle_observe(20, start));
        finish_sample(start, 1, -5, "<S,T=-5,H=66,L=235>\n");
        assert(holds == 3 && releases == 3);
    }
    sample_cycle_init();
    uart_tx_len = 0;
    assert(sample_cycle_observe(18, 0));
    sample_cycle_dht_done(1, 30, 66);
    sample_cycle_update(SAMPLE_ACQUIRE_TIMEOUT_MS - 1);
    assert(sample_cycle_phase() == SAMPLE_ACQUIRING && uart_tx_len == 0);
    sample_cycle_update(SAMPLE_ACQUIRE_TIMEOUT_MS);
    assert(sample_cycle_phase() == SAMPLE_READINGS && !sample_cycle_succeeded());
    expect_tx("<F>\n"); /* Light timed out: valid DHT alone is still a failure. */
    sample_cycle_update(SAMPLE_ACQUIRE_TIMEOUT_MS + SAMPLE_READINGS_TIME_MS);
    assert(sample_cycle_phase() == SAMPLE_RESULT && held);
    sample_cycle_update(SAMPLE_ACQUIRE_TIMEOUT_MS + SAMPLE_READINGS_TIME_MS + SAMPLE_RESULT_TIME_MS);
    assert(sample_cycle_phase() == SAMPLE_DRIVING && !held);
    expect_tx("<F>\n");
    puts("PASS: sampling stop, two-second readings/result, automatic resume, same-object suppression, rearm, failure and clock wrap.");
    puts("PASS: one UART packet per sampling stop: success, negative temperature, failure and timeout.");
}
