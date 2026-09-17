#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "config.h"
#include "bh1750.h"
#include "oled.h"

static uint32_t now;
static unsigned calls, fail_at, stops, starts, read_index;
static uint8_t address, writes[16], count, sample[2];
static uint8_t screen[8][128], page, column;
static unsigned data_bytes, commands;

uint32_t timebase_millis(void) { return now; }
static uint8_t accepted(void) { return ++calls != fail_at; }
uint8_t twi_start(uint8_t addr)
{
    starts++;
    address = addr;
    count = read_index = 0;
    return accepted();
}
uint8_t twi_write(uint8_t value)
{
    assert(count < sizeof(writes));
    writes[count++] = value;
    return accepted();
}
uint8_t twi_read_ack(uint8_t *value)
{
    assert(address == ((BH1750_ADDR << 1) | 1) && read_index++ == 0);
    *value = sample[0];
    return accepted();
}
uint8_t twi_read_nack(uint8_t *value)
{
    assert(address == ((BH1750_ADDR << 1) | 1) && read_index++ == 1);
    *value = sample[1];
    return accepted();
}
uint8_t twi_stop(void)
{
    stops++;
    if (!accepted()) return 0;
    if (address == (OLED_ADDR << 1) && count >= 2) {
        if (writes[0] == 0x40) {
            for (unsigned i = 1; i < count; i++) {
                screen[page][column] = writes[i];
                column = (column + 1) % 128;
                data_bytes++;
            }
        } else {
            assert(writes[0] == 0 && count == 2);
            uint8_t cmd = writes[1];
            commands++;
            /* Only cursor commands affect this page-memory test model. */
            if ((cmd & 0xf8) == 0xb0) page = cmd & 7;
            else if ((cmd & 0xf0) == 0x00) column = (column & 0x70) | (cmd & 15);
            else if ((cmd & 0xf0) == 0x10) column = ((cmd & 7) << 4) | (column & 15);
        }
    }
    return 1;
}

static void light_ready(void)
{
    assert(bh1750_init());
    assert(address == (BH1750_ADDR << 1) && count == 1 && writes[0] == 1);
    unsigned before = calls;
    uint16_t lux = 123;
    assert(!bh1750_read_lux(&lux) && lux == 123 && calls == before);
    now += 9;
    assert(!bh1750_service(now) && calls == before);
    now++;
    assert(bh1750_service(now));
    assert(count == 1 && writes[0] == 0x10);
    now += 199;
    assert(!bh1750_service(now) && bh1750_state() == BH1750_CONVERSION_WAIT);
    now++;
    assert(!bh1750_service(now) && bh1750_state() == BH1750_READY);
}

static void test_light(void)
{
    now = UINT32_MAX - 5U;
    light_ready();
    sample[0] = 0x01; sample[1] = 0x1a;
    uint16_t lux = 0;
    assert(bh1750_read_lux(&lux) && lux == 235);
    sample[0] = sample[1] = 0xff;
    assert(bh1750_read_lux(&lux) && lux == 54612);
    sample[0] = sample[1] = 0;
    assert(bh1750_read_lux(&lux) && lux == 0);
    for (unsigned operation = 1; operation <= 4; operation++) {
        fail_at = calls + operation; /* START, MSB, LSB, or STOP fails. */
        unsigned old_stops = stops;
        lux = 789;
        assert(!bh1750_read_lux(&lux) && lux == 789);
        assert(bh1750_state() == BH1750_OFF && stops == old_stops + 1);
        fail_at = 0;
        light_ready();
    }
    for (unsigned operation = 1; operation <= 3; operation++) {
        fail_at = calls + operation;
        assert(!bh1750_init() && bh1750_state() == BH1750_OFF);
        fail_at = 0;
    }
    puts("PASS: BH1750 command order, conversion waits, lux conversion, errors, recovery and clock wrap.");
}

static void drain_display(unsigned iterations)
{
    while (iterations--) {
        unsigned old_starts = starts, old_bytes = data_bytes;
        oled_service(now);
        assert(starts - old_starts <= 1 && data_bytes - old_bytes <= 6);
    }
}

static void test_display(void)
{
    static const uint8_t t_glyph[] = {1,1,0x7f,1,1,0};
    memset(screen, 0xff, sizeof(screen));
    now = UINT32_MAX - 50U;
    oled_init();
    oled_set_line(0, "T:30C");
    unsigned before = calls;
    now += 99;
    drain_display(10);
    assert(calls == before);
    now++;
    drain_display(500);
    assert(data_bytes == 1024 + 4 * 126);
    assert(!memcmp(screen[0], t_glyph, sizeof(t_glyph)));
    for (unsigned p = 1; p < 8; p++)
        for (unsigned c = 0; c < 128; c++) assert(screen[p][c] == 0);
    for (unsigned c = 30; c < 128; c++) assert(screen[0][c] == 0);
    before = calls;
    oled_set_line(0, "T:30C");
    drain_display(500);
    assert(calls == before);
    unsigned old_bytes = data_bytes, old_commands = commands;
    oled_set_line(0, "T:1C");
    drain_display(100);
    assert(data_bytes - old_bytes == 126 && commands - old_commands == 3);
    for (unsigned c = 24; c < 128; c++) assert(screen[0][c] == 0);

    /* A bus failure backs off, reinitializes and redraws the desired contents. */
    oled_set_line(0, "T:30C");
    oled_service(now); /* Select dirty row. */
    fail_at = calls + 1;
    oled_service(now);
    fail_at = 0;
    before = calls;
    now += PERIPHERAL_RETRY_MS - 1;
    drain_display(100);
    assert(calls == before);
    now++;
    drain_display(500);
    assert(!memcmp(screen[0], t_glyph, sizeof(t_glyph)));
    before = calls;
    drain_display(500);
    assert(calls == before);
    /* Every character in the new messages must produce a visible glyph. */
    static const char *messages[] = {
        "Object detection", "No object", "Car is moving", "Car is stopped",
        "Object Detected", "Sample detected", "successfully", "Sample failed",
        "Check sensors", "Object sampled"
    };
    for (unsigned m = 0; m < sizeof(messages)/sizeof(messages[0]); m++) {
        assert(strlen(messages[m]) <= OLED_COLUMNS);
        oled_set_line(0, messages[m]);
        drain_display(100);
        for (unsigned c = 0; messages[m][c]; c++) {
            uint8_t pixels = 0;
            for (unsigned x = 0; x < 5; x++) pixels |= screen[0][c * 6 + x];
            assert((pixels != 0) == (messages[m][c] != ' '));
        }
    }
    puts("PASS: OLED bounded transfers, dirty rows, shorter text erasure, retry and clock wrap.");
}

int main(void)
{
    test_light();
    test_display();
}
