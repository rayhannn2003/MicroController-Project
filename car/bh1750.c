#include "config.h"
#include "bh1750.h"
#include "twi.h"
#include "timebase.h"

static bh1750_state_t phase;
static uint32_t phase_started;

static uint8_t command(uint8_t value)
{
    if (!twi_start(BH1750_ADDR << 1) || !twi_write(value)) {
        twi_stop();
        phase = BH1750_OFF;
        return 0;
    }
    if (!twi_stop()) { phase = BH1750_OFF; return 0; }
    return 1;
}

uint8_t bh1750_init(void)
{
    phase = BH1750_OFF;
    if (!command(0x01)) return 0;
    phase_started = timebase_millis();
    phase = BH1750_POWER_WAIT;
    return 1;
}

/* Same 0x01, 10 ms, 0x10, 200 ms sequence, with scheduled waits. */
uint8_t bh1750_service(uint32_t now)
{
    if (phase == BH1750_POWER_WAIT &&
        (uint32_t)(now - phase_started) >= 10U) {
        if (command(0x10)) {
            phase_started = timebase_millis();
            phase = BH1750_CONVERSION_WAIT;
        }
        return 1;
    }
    if (phase == BH1750_CONVERSION_WAIT &&
        (uint32_t)(now - phase_started) >= 200U)
        phase = BH1750_READY;
    return 0;
}

bh1750_state_t bh1750_state(void) { return phase; }

/* Read and lux conversion retained from lightTemSr.c. */
uint8_t bh1750_read_lux(
    uint16_t *lux
)
{
    if (phase != BH1750_READY) return 0;
    uint8_t high;
    uint8_t low;


    if(
        !twi_start(
            (BH1750_ADDR << 1)
            | 1
        )
    )
    {
        twi_stop();

        phase = BH1750_OFF;
        return 0;
    }


    if(
        !twi_read_ack(
            &high
        )
    )
    {
        twi_stop();

        phase = BH1750_OFF;
        return 0;
    }


    if(
        !twi_read_nack(
            &low
        )
    )
    {
        twi_stop();

        phase = BH1750_OFF;
        return 0;
    }


    if (!twi_stop()) { phase = BH1750_OFF; return 0; }

    uint16_t raw =
        ((uint16_t)high << 8)
        | low;


    /*
       lux ≈ raw / 1.2
    */

    *lux =
        ((uint32_t)raw * 5UL)
        / 6UL;


    return 1;
}


