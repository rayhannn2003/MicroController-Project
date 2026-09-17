/* Execute the actual main loop with sensor/display/motor interfaces mocked. */
#include <assert.h>
#include <setjmp.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static char *utoa(unsigned value, char *buffer, int base)
{
    assert(base == 10);
    sprintf(buffer, "%u", value);
    return buffer;
}
#include <avr/io.h>
#define main rover_main
#include "../main.c"
#undef main

static jmp_buf finished;
static uint32_t test_clock, last_dht, hold_at, release_at, result_at;
static uint8_t held, driving, clock_paused, bad_dht, missing_light;
static unsigned stops, resumes, dht_reads, light_reads, successes, failures;
static uint8_t saw_readings, saw_moving, result_seen;
static char rows[4][22];
static unsigned tx_at_release;

static const char *expected_packet(void)
{
    return bad_dht || missing_light ? "<F>\n" : "<S,T=30,H=66,L=235>\n";
}

uint32_t timebase_millis(void)
{
    if (!clock_paused && ++test_clock >= 20000) longjmp(finished, 1);
    return test_clock;
}
void timebase_init(void) {}
void timebase_pause(void) { assert(!driving); clock_paused = 1; }
void timebase_resume(void) { clock_paused = 0; }
void motor_init(void) {}
void motor_stop(void) { driving = 0; }
uint8_t motor_is_driving(void) { return driving; }
void line_sensor_init(void) {}
void line_follow_init(uint32_t now) { (void)now; }
void line_follow_update(uint32_t now)
{
    driving = !held && now >= START_DELAY_MS;
    if (!held) assert(uart_tx_len == tx_at_release); /* No UART while line following. */
}
void line_follow_set_paused(uint8_t hold, uint32_t now)
{
    held = hold;
    if (hold) {
        assert(!driving);
        assert(uart_tx_len == tx_at_release);
        hold_at = now;
        stops++;
        result_seen = 0;
    } else {
        assert(saw_readings && result_seen);
        assert(now - result_at >= SAMPLE_RESULT_TIME_MS - 5);
        release_at = now;
        resumes++;
        tx_at_release = uart_tx_len;
    }
}
void hcsr04_init(void) {}
uint16_t hcsr04_get_distance_cm(void)
{
    assert(!driving && clock_paused && !held);
    if (test_clock < 1500 || (test_clock >= 10000 && test_clock < 11000) ||
        test_clock >= 19500) return HCSR04_INVALID_CM;
    return 18;
}
void dht11_init(void) {}
uint8_t dht11_read(uint8_t *temp, uint8_t *hum)
{
    assert(held && !driving && clock_paused);
    assert(test_clock - last_dht >= DHT11_INTERVAL_MS);
    last_dht = test_clock;
    dht_reads++;
    if (bad_dht) return 5;
    *temp = 30;
    *hum = 66;
    return 0;
}
uint8_t bh1750_init(void) { return !missing_light; }
bh1750_state_t bh1750_state(void) { return missing_light ? BH1750_OFF : BH1750_READY; }
uint8_t bh1750_service(uint32_t now) { (void)now; return 0; }
uint8_t bh1750_read_lux(uint16_t *value)
{
    assert(held && !driving && !clock_paused);
    assert(test_clock - hold_at >= SAMPLE_LIGHT_SETTLE_MS);
    light_reads++;
    *value = 235;
    return 1;
}
void twi_init(void) {}
void oled_init(void) {}
void oled_set_line(uint8_t row, const char *text)
{
    assert(row < 4 && strlen(text) < sizeof(rows[row]));
    strcpy(rows[row], text);
}
void oled_service(uint32_t now)
{
    sample_phase_t phase = sample_cycle_phase();
    if (phase != SAMPLE_DRIVING) assert(held && !driving);
    if (phase == SAMPLE_READINGS) {
        assert(!strcmp(rows[0], "Object Detected"));
        assert(!strcmp(rows[1], bad_dht ? "T:ERRC" : "T:30C"));
        assert(!strcmp(rows[2], missing_light ? "L:ERRLX" : "L:235LX"));
        assert(!strcmp(rows[3], bad_dht ? "H:ERR%" : "H:66%"));
        /* The packet was sent once, when the result became known. */
        const char *packet = expected_packet();
        assert(uart_tx_len == tx_at_release + strlen(packet));
        assert(!memcmp(uart_tx + tx_at_release, packet, strlen(packet)));
        saw_readings = 1;
    }
    if (phase == SAMPLE_RESULT && !result_seen) {
        assert(saw_readings);
        result_at = now;
        result_seen = 1;
        if (bad_dht || missing_light) {
            assert(!strcmp(rows[0], "Sample failed"));
            assert(!strcmp(rows[1], "Check sensors"));
            failures++;
        } else {
            assert(!strcmp(rows[0], "Sample detected"));
            assert(!strcmp(rows[1], "successfully"));
            successes++;
        }
    }
    if (phase == SAMPLE_DRIVING && driving && !strcmp(rows[1], "No object") &&
        !strcmp(rows[2], "Car is moving")) {
        assert(!strcmp(rows[0], "Object detection"));
        saw_moving = 1;
    }
}

int main(int argc, char **argv)
{
    bad_dht = argc > 1 && !strcmp(argv[1], "bad-dht");
    missing_light = argc > 1 && !strcmp(argv[1], "missing-light");
    if (!setjmp(finished)) rover_main();
    assert(stops == 2 && resumes == 2 && dht_reads == 2 && saw_moving);
    assert(light_reads == (missing_light ? 0U : 2U));
    assert(release_at > 15000 && release_at < 19000);
    assert(successes == ((bad_dht || missing_light) ? 0U : 2U));
    assert(failures == ((bad_dht || missing_light) ? 2U : 0U));
    assert(UBRRL == 12 && UCSRB == (1 << TXEN));
    const char *packet = expected_packet();
    size_t length = strlen(packet);
    assert(uart_tx_len == 2 * length && uart_udre_waits == uart_tx_len);
    assert(!memcmp(uart_tx, packet, length) && !memcmp(uart_tx + length, packet, length));
    printf("PASS: actual main loop completes two objects, %s, fresh samples and resume; UART sent %s twice.\n",
           bad_dht ? "DHT error" : missing_light ? "missing BH1750" : "success messages",
           bad_dht || missing_light ? "<F>" : "<S,T=30,H=66,L=235>");
}
