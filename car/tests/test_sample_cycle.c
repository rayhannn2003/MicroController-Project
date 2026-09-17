#include <assert.h>
#include <stdint.h>
#include <stdio.h>
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

static uint32_t finish_sample(uint32_t started, uint8_t success)
{
    assert(held && sample_cycle_phase() == SAMPLE_ACQUIRING);
    assert(sample_cycle_needs_dht());
    assert(!sample_cycle_needs_light(started + SAMPLE_LIGHT_SETTLE_MS - 1));
    assert(sample_cycle_needs_light(started + SAMPLE_LIGHT_SETTLE_MS));
    sample_cycle_dht_done(success);
    assert(!sample_cycle_needs_dht());
    sample_cycle_light_done(1);
    assert(!sample_cycle_needs_light(started + 200));
    uint32_t ready = started + 201;
    sample_cycle_update(ready);
    assert(sample_cycle_phase() == SAMPLE_READINGS && held);
    sample_cycle_update(ready + SAMPLE_READINGS_TIME_MS - 1);
    assert(sample_cycle_phase() == SAMPLE_READINGS && held);
    uint32_t result = ready + SAMPLE_READINGS_TIME_MS;
    sample_cycle_update(result);
    assert(sample_cycle_phase() == SAMPLE_RESULT && held);
    assert(sample_cycle_succeeded() == success);
    sample_cycle_update(result + SAMPLE_RESULT_TIME_MS - 1);
    assert(sample_cycle_phase() == SAMPLE_RESULT && held);
    sample_cycle_update(result + SAMPLE_RESULT_TIME_MS);
    assert(sample_cycle_phase() == SAMPLE_DRIVING && !held);
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
        uint32_t resumed = finish_sample(start, 1);
        assert(holds == 1 && releases == 1);
        /* Remaining beside the same object must not trap the rover in a loop. */
        for (unsigned i = 0; i < 10000; i += 80)
            assert(!sample_cycle_observe(18, resumed + i));
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
        finish_sample(start, 0);
        assert(holds == 2 && releases == 2);
    }
    sample_cycle_init();
    assert(sample_cycle_observe(18, 0));
    sample_cycle_dht_done(1);
    sample_cycle_update(SAMPLE_ACQUIRE_TIMEOUT_MS - 1);
    assert(sample_cycle_phase() == SAMPLE_ACQUIRING);
    sample_cycle_update(SAMPLE_ACQUIRE_TIMEOUT_MS);
    assert(sample_cycle_phase() == SAMPLE_READINGS && !sample_cycle_succeeded());
    sample_cycle_update(SAMPLE_ACQUIRE_TIMEOUT_MS + SAMPLE_READINGS_TIME_MS);
    assert(sample_cycle_phase() == SAMPLE_RESULT && held);
    sample_cycle_update(SAMPLE_ACQUIRE_TIMEOUT_MS + SAMPLE_READINGS_TIME_MS + SAMPLE_RESULT_TIME_MS);
    assert(sample_cycle_phase() == SAMPLE_DRIVING && !held);
    puts("PASS: sampling stop, two-second readings/result, automatic resume, same-object suppression, rearm, failure and clock wrap.");
}
