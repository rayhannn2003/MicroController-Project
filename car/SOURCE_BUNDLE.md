# Complete modular source files

Generated with `make source-bundle`. See [INTEGRATION.md](INTEGRATION.md) for conflicts, timer ownership, commands and hardware checks. `lfr.c` and `lightTemSr.c` remain separate, unchanged references.

## main.c

```c
#include "config.h"
#include "motor.h"
#include "line_sensor.h"
#include "line_follow.h"
#include "timebase.h"
#if INTEGRATION_STAGE >= 2
#include "twi.h"
#include "oled.h"
#include <stdlib.h>
#include <string.h>
#endif
#if INTEGRATION_STAGE >= 6
#include "sample_cycle.h"
#include "uart.h"
#endif

#if INTEGRATION_STAGE >= 4
#include "dht11.h"
static uint8_t temperature, humidity, dht_status;
static uint32_t dht_sampled_at;
#endif
#if INTEGRATION_STAGE >= 3
#include "bh1750.h"
static uint16_t lux;
static uint8_t light_status; /* 0 = pending, 1 = valid, 2 = error */
static uint32_t light_attempt;
#if INTEGRATION_STAGE < 6
static uint32_t light_read;
#endif
#endif

#if INTEGRATION_STAGE >= 5
#include "hcsr04.h"
static uint16_t distance = HCSR04_INVALID_CM;
static uint8_t distance_status;
static uint32_t ping_started;

static uint8_t update_distance(uint32_t now)
{
#if INTEGRATION_STAGE >= 6
    if (sample_cycle_phase() != SAMPLE_DRIVING) return 0;
#endif
    if ((uint32_t)(now - ping_started) < HCSR04_INTERVAL_MS) return 0;
    ping_started = now;
    motor_stop();
    timebase_pause();
    distance = hcsr04_get_distance_cm();
    timebase_resume();
    distance_status = distance == HCSR04_INVALID_CM ? 2 : 1;
#if INTEGRATION_STAGE >= 6
    if (sample_cycle_observe(distance, timebase_millis())) {
        dht_status = light_status = 0; /* Require fresh readings for this object. */
    }
#endif
    return 1;
}
#endif

#if INTEGRATION_STAGE >= 3
static uint8_t update_environment(uint32_t now)
{
#if INTEGRATION_STAGE >= 4
    if (
#if INTEGRATION_STAGE >= 6
        sample_cycle_needs_dht() &&
#endif
        (uint32_t)(now - dht_sampled_at) >= DHT11_INTERVAL_MS) {
        dht_sampled_at = now;
        motor_stop();
        timebase_pause();
        dht_status = dht11_read(&temperature, &humidity) == 0 ? 1 : 2;
        timebase_resume();
#if INTEGRATION_STAGE >= 6
        sample_cycle_dht_done(dht_status == 1, temperature, humidity);
#endif
        return 1;
    }
#endif
    if (bh1750_service(now)) {
        if (bh1750_state() == BH1750_OFF) light_status = 2;
        return 1;
    }
    if (bh1750_state() == BH1750_OFF &&
        (uint32_t)(now - light_attempt) >= PERIPHERAL_RETRY_MS) {
        light_attempt = now;
        if (!bh1750_init()) light_status = 2;
        return 1;
    }
    if (bh1750_state() == BH1750_READY &&
#if INTEGRATION_STAGE >= 6
        sample_cycle_needs_light(now)) {
#else
        (uint32_t)(now - light_read) >= BH1750_INTERVAL_MS) {
        light_read = now;
#endif
        light_status = bh1750_read_lux(&lux) ? 1 : 2;
#if INTEGRATION_STAGE >= 6
        sample_cycle_light_done(light_status == 1, lux);
#endif
        if (light_status == 2) light_attempt = timebase_millis();
        return 1;
    }
    return 0;
}
#endif

#if INTEGRATION_STAGE >= 2
static uint32_t displayed_at;
#if INTEGRATION_STAGE >= 3
static void set_metric(uint8_t row, const char *prefix, uint16_t value,
                       const char *suffix, uint8_t status)
{
    char text[OLED_COLUMNS + 1];
    strcpy(text, prefix);
    if (status == 1) utoa(value, text + strlen(text), 10);
    else strcat(text, status == 2 ? "ERR" : "---");
    strcat(text, suffix);
    oled_set_line(row, text);
}
#endif

static void update_display(uint32_t now)
{
#if INTEGRATION_STAGE >= 6
    static sample_phase_t displayed_phase = SAMPLE_RESULT;
    sample_phase_t phase = sample_cycle_phase();
#endif
    if (
#if INTEGRATION_STAGE >= 6
        displayed_phase != phase ||
#endif
        (uint32_t)(now - displayed_at) >= DISPLAY_INTERVAL_MS) {
        displayed_at = now;
#if INTEGRATION_STAGE >= 6
        displayed_phase = phase;
        if (phase == SAMPLE_DRIVING) {
            oled_set_line(0, "Object detection");
            oled_set_line(1, sample_cycle_near_object() ? "Object sampled" : "No object");
            oled_set_line(2, motor_is_driving() ? "Car is moving" : "Car is stopped");
            oled_set_line(3, "");
        } else if (phase == SAMPLE_RESULT) {
            oled_set_line(0, sample_cycle_succeeded() ? "Sample detected" : "Sample failed");
            oled_set_line(1, sample_cycle_succeeded() ? "successfully" : "Check sensors");
            oled_set_line(2, "Car is stopped");
            oled_set_line(3, "");
        } else {
            uint8_t t_status = dht_status, l_status = light_status;
            if (phase == SAMPLE_READINGS) {
                if (!t_status) t_status = 2;
                if (!l_status) l_status = 2;
            }
            oled_set_line(0, "Object Detected");
            set_metric(1, "T:", temperature, "C", t_status);
            set_metric(2, "L:", lux, "LX", l_status);
            set_metric(3, "H:", humidity, "%", t_status);
        }
#else
#if INTEGRATION_STAGE >= 5
        set_metric(3, "D:", distance,
                   distance != HCSR04_INVALID_CM && distance <= OBSTACLE_DISTANCE_CM
                   ? "CM OBJECT" : "CM", distance_status);
#endif
#if INTEGRATION_STAGE >= 4
        set_metric(0, "T:", temperature, "C", dht_status);
        set_metric(1, "H:", humidity, "%", dht_status);
#endif
#if INTEGRATION_STAGE >= 3
        set_metric(2, "L:", lux, "LX", light_status);
#endif
#endif
    }
    oled_service(now);
}
#endif

int main(void)
{
    motor_init();
    line_sensor_init();
    timebase_init();
    line_follow_init(timebase_millis());
#if INTEGRATION_STAGE >= 6
    sample_cycle_init();
    uart_init();
#endif
#if INTEGRATION_STAGE >= 2
    twi_init();
    oled_init();
#if INTEGRATION_STAGE < 6
    oled_set_line(0, "T:---C");
    oled_set_line(1, "H:---%");
    oled_set_line(2, "L:---LX");
    oled_set_line(3, "D:---CM");
#endif
#endif
#if INTEGRATION_STAGE >= 3
    light_attempt = timebase_millis() - PERIPHERAL_RETRY_MS;
#endif
#if INTEGRATION_STAGE >= 4
    dht11_init();
    dht_sampled_at = timebase_millis();
#endif
#if INTEGRATION_STAGE >= 5
    hcsr04_init();
    ping_started = timebase_millis() - HCSR04_INTERVAL_MS;
#endif
    for (;;) {
        uint32_t now = timebase_millis();
#if INTEGRATION_STAGE >= 6
        sample_cycle_update(now);
#endif
        line_follow_update(now);
#if INTEGRATION_STAGE >= 5
        if (update_distance(now)) continue;
#endif
#if INTEGRATION_STAGE >= 3
        if (update_environment(now)) continue;
#endif
#if INTEGRATION_STAGE >= 2
        update_display(now);
#endif
    }
}
```

## oled_debug.c

```c
#include "config.h"
#include "timebase.h"
#include "twi.h"
#include "oled.h"

/* OLED-only hardware check. No motor or sensor code is linked. */
int main(void)
{
    timebase_init();
    twi_init();
    oled_init();
    oled_set_line(0, "HELLO");

    for (;;) {
        oled_service(timebase_millis());
    }
}
```

## config.h

```c

#ifndef CONFIG_H
#define CONFIG_H

#ifndef F_CPU
#define F_CPU 1000000UL
#endif


/* Fixed hardware allocation for the modular build. */
#if F_CPU != 1000000UL
#error "Project Sylvan timing requires F_CPU = 1000000UL"
#endif
#ifndef INTEGRATION_STAGE
#define INTEGRATION_STAGE 6
#endif
#if INTEGRATION_STAGE < 1 || INTEGRATION_STAGE > 6
#error "INTEGRATION_STAGE must be from 1 to 6"
#endif
#define MOTOR_IN1 PB0
#define MOTOR_IN2 PB1
#define MOTOR_IN3 PB2
#define MOTOR_IN4 PB3
#define MOTOR_ENA PD5
#define MOTOR_ENB PD4
#define MOTOR_PWM_TOP 49U
#define HCSR04_TRIG_PIN PA0
#define HCSR04_ECHO_PIN PA4
#define DHT11_PIN PA3
#define TWI_SCL_PIN PC0
#define TWI_SDA_PIN PC1
#define OLED_ADDR 0x3C
#define BH1750_ADDR 0x23
/* ESP32-CAM link: PD1/TXD only, 8N1, U2X. Use 4800 if the RC oscillator drifts. */
#define UART_BAUD 9600UL
#define OBSTACLE_DISTANCE_CM 30U
#define OBJECT_CLEAR_DISTANCE_CM 35U
#define OBJECT_CLEAR_TIME_MS 500UL
#define SAMPLE_ACQUIRE_TIMEOUT_MS 3000UL
#define SAMPLE_LIGHT_SETTLE_MS 200UL
#define SAMPLE_READINGS_TIME_MS 2000UL
#define SAMPLE_RESULT_TIME_MS 2000UL
#define HCSR04_INTERVAL_MS 80U
#define HCSR04_TIMEOUT_US 30000UL
#define DHT11_INTERVAL_MS 2000UL
#define BH1750_INTERVAL_MS 500UL
#define DISPLAY_INTERVAL_MS 200UL
#define PERIPHERAL_RETRY_MS 1000UL
#define TWI_TIMEOUT_MS 2U

// =====================================================
// SENSOR CONFIGURATION
// =====================================================

#define LEFT_SENSOR_PIN   PA1
#define RIGHT_SENSOR_PIN  PA2

/*
 * Current calibrated sensor behavior:
 *
 * BLACK TAPE   -> OUT HIGH
 * NORMAL FLOOR -> OUT LOW
 */
#define SENSOR_BLACK_IS_HIGH 1


// =====================================================
// SPEED SETTINGS
// =====================================================

/*
 * Normal speed on straight track.
 *
 * Increase -> faster but more overshoot.
 * Decrease -> easier to follow curves.
 */
#define BASE_SPEED_PERCENT       80U


/*
 * Speed while pivoting left/right.
 *
 * Increase -> rotates faster.
 * Decrease -> gentler pivot.
 */
#define PIVOT_SPEED_PERCENT      75U


/*
 * Speed during the tiny reverse operation.
 */
#define REVERSE_SPEED_PERCENT    75U


// =====================================================
// RECOVERY TIMINGS
// =====================================================

/*
 * When BOTH sensors suddenly lose black:
 *
 * 1. Brake
 * 2. Reverse slightly
 * 3. Brake
 * 4. Pivot toward the last known line direction
 */


/*
 * Increase if the robot continues travelling
 * forward too much after losing the line.
 */
#define BRAKE_TIME_MS            25U


/*
 * How far the robot backs up.
 *
 * Increase -> backs farther.
 * Decrease -> smaller correction.
 */
#define REVERSE_TIME_MS          40U


/*
 * Small brake after reversing so reverse momentum
 * does not interfere with the pivot.
 */
#define REVERSE_BRAKE_TIME_MS    15U


/*
 * Maximum amount of time allowed to search for
 * the tape after losing it.
 *
 * Increase if it almost finds the line but stops.
 */
#define SEARCH_TIMEOUT_MS       300U


// =====================================================
// STARTUP
// =====================================================

#define START_DELAY_MS         1000U


#endif
```

## motor.c

```c
#include "config.h"
#include "motor.h"
#include <avr/io.h>
#include <stdint.h>

#define MOTOR_MASK ((1U << MOTOR_IN1) | (1U << MOTOR_IN2) | \
                    (1U << MOTOR_IN3) | (1U << MOTOR_IN4))
/* Same percent-to-OCR expression as lfr.c, folded at compile time. */
#define PWM_VALUE(percent) ((percent) >= 100U ? MOTOR_PWM_TOP : \
    (uint16_t)(((uint32_t)(percent) * MOTOR_PWM_TOP) / 100U))

static void set_pattern(uint8_t pattern)
{
    PORTB = (PORTB & (uint8_t)~MOTOR_MASK) | pattern;
}

void motor_init(void)
{
    DDRB |= MOTOR_MASK;
    DDRD |= (1 << MOTOR_ENA) | (1 << MOTOR_ENB);
    /* Original mode 14, no prescaler, TOP 49: 20 kHz at 1 MHz. */
    TCCR1A = (1 << COM1A1) | (1 << COM1B1) | (1 << WGM11);
    TCCR1B = (1 << WGM13) | (1 << WGM12) | (1 << CS10);
    ICR1 = MOTOR_PWM_TOP;
    motor_stop();
}

void motor_forward(void)
{
    set_pattern((1 << MOTOR_IN1) | (1 << MOTOR_IN3)); /* 0x05 */
    OCR1A = PWM_VALUE(BASE_SPEED_PERCENT);
    OCR1B = PWM_VALUE(BASE_SPEED_PERCENT);
}

void motor_backward(void)
{
    set_pattern((1 << MOTOR_IN2) | (1 << MOTOR_IN4)); /* 0x0A */
    OCR1A = PWM_VALUE(REVERSE_SPEED_PERCENT);
    OCR1B = PWM_VALUE(REVERSE_SPEED_PERCENT);
}

void motor_pivot_left(void)
{
    set_pattern((1 << MOTOR_IN2) | (1 << MOTOR_IN3)); /* 0x06 */
    OCR1A = PWM_VALUE(PIVOT_SPEED_PERCENT);
    OCR1B = PWM_VALUE(PIVOT_SPEED_PERCENT);
}

void motor_pivot_right(void)
{
    set_pattern((1 << MOTOR_IN1) | (1 << MOTOR_IN4)); /* 0x09 */
    OCR1A = PWM_VALUE(PIVOT_SPEED_PERCENT);
    OCR1B = PWM_VALUE(PIVOT_SPEED_PERCENT);
}

void motor_brake(void)
{
    set_pattern(MOTOR_MASK); /* 0x0F */
    OCR1A = MOTOR_PWM_TOP;
    OCR1B = MOTOR_PWM_TOP;
}

void motor_stop(void)
{
    OCR1A = 0;
    OCR1B = 0;
    set_pattern(0);
}

uint8_t motor_is_driving(void)
{
    uint8_t pattern = PORTB & MOTOR_MASK;
    return pattern != 0 && pattern != MOTOR_MASK && (OCR1A != 0 || OCR1B != 0);
}
```

## motor.h

```c
#ifndef MOTOR_H
#define MOTOR_H
#include <stdint.h>
void motor_init(void);
void motor_forward(void);
void motor_backward(void);
void motor_pivot_left(void);
void motor_pivot_right(void);
void motor_brake(void);
void motor_stop(void);
/* Reports commanded drive, excluding stop and dynamic brake. */
uint8_t motor_is_driving(void);
#endif
```

## line_sensor.c

```c
#include "config.h"
#include "line_sensor.h"
#include <avr/io.h>

void line_sensor_init(void)
{
    DDRA &= (uint8_t)~((1U << LEFT_SENSOR_PIN) | (1U << RIGHT_SENSOR_PIN));
    PORTA |= (1U << LEFT_SENSOR_PIN) | (1U << RIGHT_SENSOR_PIN);
}

static uint8_t on_black(uint8_t pin)
{
    uint8_t high = (PINA & (1U << pin)) != 0U;
#if SENSOR_BLACK_IS_HIGH
    return high;
#else
    return !high;
#endif
}
uint8_t line_left_on_black(void) { return on_black(LEFT_SENSOR_PIN); }
uint8_t line_right_on_black(void) { return on_black(RIGHT_SENSOR_PIN); }
```

## line_sensor.h

```c
#ifndef LINE_SENSOR_H
#define LINE_SENSOR_H
#include <stdint.h>
void line_sensor_init(void);
uint8_t line_left_on_black(void);
uint8_t line_right_on_black(void);
#endif
```

## line_follow.c

```c
#include "config.h"
#include "line_follow.h"
#include "line_sensor.h"
#include "motor.h"

typedef enum
{
    STATE_FOLLOW,

    STATE_BRAKE,

    STATE_REVERSE,

    STATE_REVERSE_BRAKE,

    STATE_SEARCH_LEFT,

    STATE_SEARCH_RIGHT,

    STATE_STOP

} RobotState;


#define TURN_NONE   0U
#define TURN_LEFT   1U
#define TURN_RIGHT  2U

#define SENSOR_NONE  0U
#define SENSOR_LEFT  1U
#define SENSOR_RIGHT 2U



static uint8_t previousLeftBlack, previousRightBlack;
static uint8_t firstOffSensor, lastTurn;
static RobotState state;
static uint32_t stateStartTime;
static uint8_t starting, paused;
static uint32_t pause_started;

void line_follow_init(uint32_t now)
{
    firstOffSensor = SENSOR_NONE;
    lastTurn = TURN_NONE;
    state = STATE_STOP;
    starting = 1;
    paused = 0;
    stateStartTime = now;
    motor_stop();
}

void line_follow_set_paused(uint8_t hold, uint32_t now)
{
    if (hold) {
        if (!paused) pause_started = now;
        paused = 1;
        motor_stop();
    } else if (paused) {
        stateStartTime += (uint32_t)(now - pause_started);
        paused = 0;
    }
}

void line_follow_update(uint32_t now)
{
    if (paused) { motor_stop(); return; }
    if (starting) {
        motor_stop();
        if ((uint32_t)(now - stateStartTime) < START_DELAY_MS) return;
        starting = 0;
        state = STATE_FOLLOW;
        previousLeftBlack = line_left_on_black();
        previousRightBlack = line_right_on_black();
    }
    uint8_t leftBlack = line_left_on_black();
    uint8_t rightBlack = line_right_on_black();

    // =================================================
    // NORMAL LINE FOLLOWING
    // =================================================

    if (state == STATE_FOLLOW)
    {
        uint8_t leftWentOff =
            previousLeftBlack && !leftBlack;

        uint8_t rightWentOff =
            previousRightBlack && !rightBlack;

        /*
         * Latch only the first unambiguous BLACK-to-FLOOR edge.
         * If both edges occur in one sample, retain the older turn.
         */
        if (firstOffSensor == SENSOR_NONE)
        {
            if (leftWentOff && !rightWentOff)
            {
                firstOffSensor = SENSOR_LEFT;
            }
            else if (rightWentOff && !leftWentOff)
            {
                firstOffSensor = SENSOR_RIGHT;
            }
        }

        /* Always turn opposite to the sensor that went off first. */
        if (firstOffSensor == SENSOR_LEFT)
        {
            lastTurn = TURN_RIGHT;
        }
        else if (firstOffSensor == SENSOR_RIGHT)
        {
            lastTurn = TURN_LEFT;
        }

        // ---------------------------------------------
        // BLACK + BLACK
        // ---------------------------------------------

        if (leftBlack && rightBlack)
        {
            /* A centered line starts a new detection cycle. */
            firstOffSensor = SENSOR_NONE;

            motor_forward();
        }


        // ---------------------------------------------
        // BLACK + FLOOR: right sensor went off first,
        // so turn in the opposite direction (LEFT).
        // ---------------------------------------------

        else if (leftBlack && !rightBlack)
        {
            if (firstOffSensor == SENSOR_NONE)
            {
                /* Fallback if the program started off the line. */
                firstOffSensor = SENSOR_RIGHT;
                lastTurn = TURN_LEFT;
            }

            if (firstOffSensor == SENSOR_RIGHT)
            {
                lastTurn = TURN_LEFT;

                motor_pivot_left();
            }
            else
            {
                lastTurn = TURN_RIGHT;

                motor_pivot_right();
            }
        }


        // ---------------------------------------------
        // FLOOR + BLACK: left sensor went off first,
        // so turn in the opposite direction (RIGHT).
        // ---------------------------------------------

        else if (!leftBlack && rightBlack)
        {
            if (firstOffSensor == SENSOR_NONE)
            {
                /* Fallback if the program started off the line. */
                firstOffSensor = SENSOR_LEFT;
                lastTurn = TURN_RIGHT;
            }

            if (firstOffSensor == SENSOR_LEFT)
            {
                lastTurn = TURN_RIGHT;

                motor_pivot_right();
            }
            else
            {
                lastTurn = TURN_LEFT;

                motor_pivot_left();
            }
        }


        // ---------------------------------------------
        // FLOOR + FLOOR
        //
        // Both sensors lost tape.
        //
        // Immediately start recovery.
        // ---------------------------------------------

        else
        {
            motor_brake();

            state = STATE_BRAKE;

            stateStartTime = now;
        }
    }


    // =================================================
    // BRAKING
    // =================================================

    else if (state == STATE_BRAKE)
    {
        motor_brake();


        if (
            (uint32_t)(now - stateStartTime)
            >= BRAKE_TIME_MS
        )
        {
            motor_backward();

            state = STATE_REVERSE;

            stateStartTime = now;
        }
    }


    // =================================================
    // SMALL REVERSE
    // =================================================

    else if (state == STATE_REVERSE)
    {
        motor_backward();


        if (
            (uint32_t)(now - stateStartTime)
            >= REVERSE_TIME_MS
        )
        {
            motor_brake();

            state = STATE_REVERSE_BRAKE;

            stateStartTime = now;
        }
    }


    // =================================================
    // BRAKE AFTER REVERSE
    // =================================================

    else if (state == STATE_REVERSE_BRAKE)
    {
        motor_brake();


        if (
            (uint32_t)(now - stateStartTime)
            >= REVERSE_BRAKE_TIME_MS
        )
        {
            if (lastTurn == TURN_LEFT)
            {
                motor_pivot_left();

                state = STATE_SEARCH_LEFT;
            }

            else if (lastTurn == TURN_RIGHT)
            {
                motor_pivot_right();

                state = STATE_SEARCH_RIGHT;
            }

            else
            {
                motor_stop();

                state = STATE_STOP;
            }


            stateStartTime = now;
        }
    }


    // =================================================
    // SEARCH LEFT
    // =================================================

    else if (state == STATE_SEARCH_LEFT)
    {
        /*
         * VERY IMPORTANT:
         *
         * We are still reading both sensors during
         * the search.
         *
         * As soon as EITHER sensor finds black,
         * recovery immediately ends.
         */

        if (leftBlack || rightBlack)
        {
            state = STATE_FOLLOW;

            previousLeftBlack = leftBlack;
            previousRightBlack = rightBlack;

            return;
        }


        motor_pivot_left();


        if (
            (uint32_t)(now - stateStartTime)
            >= SEARCH_TIMEOUT_MS
        )
        {
            motor_stop();

            state = STATE_STOP;
        }
    }


    // =================================================
    // SEARCH RIGHT
    // =================================================

    else if (state == STATE_SEARCH_RIGHT)
    {
        if (leftBlack || rightBlack)
        {
            state = STATE_FOLLOW;

            previousLeftBlack = leftBlack;
            previousRightBlack = rightBlack;

            return;
        }


        motor_pivot_right();


        if (
            (uint32_t)(now - stateStartTime)
            >= SEARCH_TIMEOUT_MS
        )
        {
            motor_stop();

            state = STATE_STOP;
        }
    }


    // =================================================
    // STOPPED / WAITING FOR THE LINE
    // =================================================

    else if (state == STATE_STOP)
    {
        motor_stop();

        /*
         * A stop is recoverable.  This is especially important at
         * startup, when both sensors may initially be off the tape and
         * lastTurn is not known yet.  Keep the motors safely disabled,
         * but resume line following as soon as either sensor sees black.
         */
        if (leftBlack || rightBlack)
        {
            firstOffSensor = SENSOR_NONE;
            state = STATE_FOLLOW;
        }
    }


    // Defensive fallback for an invalid state value.
    else
    {
        motor_stop();
        state = STATE_STOP;
    }


    /* Save this sample so the next loop can detect an off edge. */
    previousLeftBlack = leftBlack;
    previousRightBlack = rightBlack;
}
```

## line_follow.h

```c
#ifndef LINE_FOLLOW_H
#define LINE_FOLLOW_H
#include <stdint.h>
void line_follow_init(uint32_t now);
void line_follow_update(uint32_t now);
/* Hold motor output and freeze recovery/startup elapsed time until resumed. */
void line_follow_set_paused(uint8_t paused, uint32_t now);
#endif
```

## sample_cycle.c

```c
#include "config.h"
#include "sample_cycle.h"
#include "hcsr04.h"
#include "line_follow.h"
#include "uart.h"

static sample_phase_t cycle_phase;
static uint8_t armed, near_object, clearing, dht_done, light_done, succeeded;
static uint32_t phase_started, clear_started;
static int16_t sample_temp_c;
static uint8_t sample_humidity;
static uint16_t sample_lux;

void sample_cycle_init(void)
{
    cycle_phase = SAMPLE_DRIVING;
    armed = 1;
    near_object = clearing = dht_done = light_done = succeeded = 0;
}

uint8_t sample_cycle_observe(uint16_t distance_cm, uint32_t now)
{
    near_object = distance_cm != HCSR04_INVALID_CM && distance_cm <= OBSTACLE_DISTANCE_CM;
    if (cycle_phase != SAMPLE_DRIVING) return 0;
    if (!armed) {
        /* A side-looking sensor has no echo when it faces open space. Require
         * sustained clearance, with hysteresis, before accepting another object. */
        uint8_t clear = distance_cm == HCSR04_INVALID_CM ||
                        distance_cm > OBJECT_CLEAR_DISTANCE_CM;
        if (!clear) clearing = 0;
        else if (!clearing) { clear_started = now; clearing = 1; }
        else if ((uint32_t)(now - clear_started) >= OBJECT_CLEAR_TIME_MS) {
            armed = 1;
            clearing = 0;
        }
    }
    if (!armed || !near_object) return 0;
    armed = clearing = dht_done = light_done = 0;
    succeeded = 1;
    cycle_phase = SAMPLE_ACQUIRING;
    phase_started = now;
    line_follow_set_paused(1, now);
    return 1;
}

void sample_cycle_update(uint32_t now)
{
    if (cycle_phase == SAMPLE_ACQUIRING) {
        if ((!dht_done || !light_done) &&
            (uint32_t)(now - phase_started) < SAMPLE_ACQUIRE_TIMEOUT_MS) return;
        if (!dht_done || !light_done) succeeded = 0;
        /* Motors are held; this transition runs exactly once per sampling stop. */
        if (succeeded) uart_send_sample(sample_temp_c, sample_humidity, sample_lux);
        else uart_send_sample_failed();
        cycle_phase = SAMPLE_READINGS;
        phase_started = now;
    } else if (cycle_phase == SAMPLE_READINGS &&
               (uint32_t)(now - phase_started) >= SAMPLE_READINGS_TIME_MS) {
        cycle_phase = SAMPLE_RESULT;
        phase_started = now;
    } else if (cycle_phase == SAMPLE_RESULT &&
               (uint32_t)(now - phase_started) >= SAMPLE_RESULT_TIME_MS) {
        cycle_phase = SAMPLE_DRIVING;
        /* Keep the object disarmed until the rover has driven past it. */
        clearing = 0;
        line_follow_set_paused(0, now);
    }
}

sample_phase_t sample_cycle_phase(void) { return cycle_phase; }
uint8_t sample_cycle_near_object(void) { return near_object; }
uint8_t sample_cycle_needs_dht(void) { return cycle_phase == SAMPLE_ACQUIRING && !dht_done; }
uint8_t sample_cycle_needs_light(uint32_t now)
{
    return cycle_phase == SAMPLE_ACQUIRING && !light_done &&
           (uint32_t)(now - phase_started) >= SAMPLE_LIGHT_SETTLE_MS;
}
void sample_cycle_dht_done(uint8_t success, int16_t temp_c, uint8_t humidity)
{
    if (cycle_phase != SAMPLE_ACQUIRING || dht_done) return;
    dht_done = 1;
    sample_temp_c = temp_c;
    sample_humidity = humidity;
    succeeded &= success != 0;
}
void sample_cycle_light_done(uint8_t success, uint16_t lux)
{
    if (cycle_phase != SAMPLE_ACQUIRING || light_done) return;
    light_done = 1;
    sample_lux = lux;
    succeeded &= success != 0;
}
uint8_t sample_cycle_succeeded(void) { return succeeded; }
```

## sample_cycle.h

```c
#ifndef SAMPLE_CYCLE_H
#define SAMPLE_CYCLE_H
#include <stdint.h>
typedef enum { SAMPLE_DRIVING, SAMPLE_ACQUIRING, SAMPLE_READINGS,
               SAMPLE_RESULT } sample_phase_t;
void sample_cycle_init(void);
/* Returns 1 only when a new object starts a sampling stop. */
uint8_t sample_cycle_observe(uint16_t distance_cm, uint32_t now);
void sample_cycle_update(uint32_t now);
sample_phase_t sample_cycle_phase(void);
uint8_t sample_cycle_near_object(void);
uint8_t sample_cycle_needs_dht(void);
uint8_t sample_cycle_needs_light(uint32_t now);
/* Readings are kept for the UART packet sent once when the result is known. */
void sample_cycle_dht_done(uint8_t success, int16_t temp_c, uint8_t humidity);
void sample_cycle_light_done(uint8_t success, uint16_t lux);
uint8_t sample_cycle_succeeded(void);
#endif
```

## timebase.c

```c
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
```

## timebase.h

```c
#ifndef TIMEBASE_H
#define TIMEBASE_H
#include <stdint.h>
void timebase_init(void);
uint32_t timebase_millis(void);
/* Explicitly freeze logical scheduler time while motors are stopped for sampling.
 * TCNT0 phase and the original CTC configuration are preserved. */
void timebase_pause(void);
void timebase_resume(void);
#endif
```

## twi.c

```c
#include "config.h"
#include "twi.h"
#include "timebase.h"
#include <avr/io.h>

/* Transactions retained from lightTemSr.c. Call with interrupts enabled. */
static uint8_t twi_wait(void)
{
    uint32_t start = timebase_millis();
    while (!(TWCR & (1 << TWINT))) {
        if ((uint32_t)(timebase_millis() - start) >= TWI_TIMEOUT_MS)
            return 0;
    }
    return 1;
}


void twi_init(void)
{
    DDRC &= (uint8_t)~((1 << TWI_SCL_PIN) | (1 << TWI_SDA_PIN));
    PORTC &= (uint8_t)~((1 << TWI_SCL_PIN) | (1 << TWI_SDA_PIN));
    TWSR = 0x00;

    /*
       1 MHz CPU
       TWBR = 2
       about 50 kHz I2C
    */

    TWBR = 2;

    TWCR = (1 << TWEN);
}


uint8_t twi_start(uint8_t address)
{
    TWCR =
        (1 << TWINT) |
        (1 << TWSTA) |
        (1 << TWEN);

    if (!twi_wait())
        return 0;


    uint8_t status =
        TWSR & 0xF8;

    if (
        status != 0x08 &&
        status != 0x10
    )
        return 0;


    TWDR = address;

    TWCR =
        (1 << TWINT) |
        (1 << TWEN);

    if (!twi_wait())
        return 0;


    status =
        TWSR & 0xF8;


    if ((address & 1) == 0)
    {
        if (status != 0x18)
            return 0;
    }
    else
    {
        if (status != 0x40)
            return 0;
    }


    return 1;
}


uint8_t twi_write(uint8_t data)
{
    TWDR = data;

    TWCR =
        (1 << TWINT) |
        (1 << TWEN);

    if (!twi_wait())
        return 0;


    return (
        (TWSR & 0xF8) == 0x28
    );
}


uint8_t twi_read_ack(uint8_t *data)
{
    TWCR =
        (1 << TWINT) |
        (1 << TWEN) |
        (1 << TWEA);

    if (!twi_wait() || (TWSR & 0xF8) != 0x50)
        return 0;


    *data = TWDR;

    return 1;
}


uint8_t twi_read_nack(uint8_t *data)
{
    TWCR =
        (1 << TWINT) |
        (1 << TWEN);

    if (!twi_wait() || (TWSR & 0xF8) != 0x58)
        return 0;


    *data = TWDR;

    return 1;
}


uint8_t twi_stop(void)
{
    uint32_t start = timebase_millis();
    TWCR = (1 << TWINT) | (1 << TWEN) | (1 << TWSTO);
    while (TWCR & (1 << TWSTO)) {
        if ((uint32_t)(timebase_millis() - start) >= TWI_TIMEOUT_MS) {
            TWCR = 0; /* Release the peripheral after a stuck transaction. */
            TWCR = (1 << TWEN);
            return 0;
        }
    }
    return 1;
}
```

## twi.h

```c
#ifndef TWI_H
#define TWI_H
#include <stdint.h>
void twi_init(void);
uint8_t twi_start(uint8_t address);
uint8_t twi_write(uint8_t data);
uint8_t twi_read_ack(uint8_t *data);
uint8_t twi_read_nack(uint8_t *data);
uint8_t twi_stop(void);
#endif
```

## oled.c

```c
#include "config.h"
#include "oled.h"
#include "twi.h"
#include "timebase.h"
#include <string.h>
#include <avr/pgmspace.h>

/* Additional lowercase glyphs for the sampling messages; original glyphs below
 * are retained byte for byte. Keep this table in flash, not the 2 KB SRAM. */
static const uint8_t lowercase_font[26][5] PROGMEM = {
    {0x20,0x54,0x54,0x54,0x78}, /* a */
    {0x7f,0x48,0x44,0x44,0x38}, /* b */
    {0x38,0x44,0x44,0x44,0x20}, /* c */
    {0x38,0x44,0x44,0x48,0x7f}, /* d */
    {0x38,0x54,0x54,0x54,0x18}, /* e */
    {0x08,0x7e,0x09,0x01,0x02}, /* f */
    {0x0c,0x52,0x52,0x52,0x3e}, /* g */
    {0x7f,0x08,0x04,0x04,0x78}, /* h */
    {0x00,0x44,0x7d,0x40,0x00}, /* i */
    {0x20,0x40,0x44,0x3d,0x00}, /* j */
    {0x7f,0x10,0x28,0x44,0x00}, /* k */
    {0x00,0x41,0x7f,0x40,0x00}, /* l */
    {0x7c,0x04,0x18,0x04,0x78}, /* m */
    {0x7c,0x08,0x04,0x04,0x78}, /* n */
    {0x38,0x44,0x44,0x44,0x38}, /* o */
    {0x7c,0x14,0x14,0x14,0x08}, /* p */
    {0x08,0x14,0x14,0x18,0x7c}, /* q */
    {0x7c,0x08,0x04,0x04,0x08}, /* r */
    {0x48,0x54,0x54,0x54,0x20}, /* s */
    {0x04,0x3f,0x44,0x40,0x20}, /* t */
    {0x3c,0x40,0x40,0x20,0x7c}, /* u */
    {0x1c,0x20,0x40,0x20,0x1c}, /* v */
    {0x3c,0x40,0x30,0x40,0x3c}, /* w */
    {0x44,0x28,0x10,0x28,0x44}, /* x */
    {0x0c,0x50,0x50,0x50,0x3c}, /* y */
    {0x44,0x64,0x54,0x4c,0x44}  /* z */
};

/* Original initialization, page mode and font from lightTemSr.c. */
static const uint8_t init_commands[] = {
    0xAE,0xD5,0x80,0xA8,0x3F,0xD3,0x00,0x40,0x8D,0x14,
    0x20,0x02,0xA1,0xC8,0xDA,0x12,0x81,0x7F,0xD9,0xF1,
    0xDB,0x40,0xA4,0xA6,0xAF
};
static char desired[OLED_ROWS][OLED_COLUMNS];
static char active[OLED_COLUMNS];
static uint8_t dirty, row, next_row, page, column, cursor_step, init_index;
static uint32_t retry_at;
static enum { OLED_WAIT, OLED_INIT, OLED_CLEAR_CURSOR, OLED_CLEAR_DATA,
              OLED_IDLE, OLED_TEXT_CURSOR, OLED_TEXT_DATA } state;

static uint8_t oled_begin(uint8_t control)
{
    if (!twi_start(OLED_ADDR << 1) || !twi_write(control)) {
        twi_stop();
        return 0;
    }
    return 1;
}

static uint8_t oled_command(uint8_t command)
{
    if (!oled_begin(0x00)) return 0;
    if (!twi_write(command)) { twi_stop(); return 0; }
    return twi_stop();
}

static uint8_t oled_bytes(const uint8_t *data, uint8_t length)
{
    if (!oled_begin(0x40)) return 0;
    for (uint8_t i = 0; i < length; i++) {
        if (!twi_write(data[i])) { twi_stop(); return 0; }
    }
    return twi_stop();
}

/* One of the three original page/column commands per service call. */
static uint8_t oled_cursor_part(uint8_t target_page)
{
    uint8_t command = cursor_step == 0 ? (0xB0 | target_page) :
                      cursor_step == 1 ? 0x00 : 0x10;
    return oled_command(command);
}

static void oled_glyph(char c, uint8_t d[5])
{
    memset(d, 0, 5);
    if (c >= 'a' && c <= 'z') {
        for (uint8_t i = 0; i < 5; i++) d[i] = pgm_read_byte(&lowercase_font[c - 'a'][i]);
        return;
    }
    switch(c)
    {
        case 'S':
        {
            uint8_t a[] = {0x46,0x49,0x49,0x49,0x31};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }
        /* Numbers */

        case '0':
        {
            uint8_t a[] =
                {0x3E,0x51,0x49,0x45,0x3E};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '1':
        {
            uint8_t a[] =
                {0x00,0x42,0x7F,0x40,0x00};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '2':
        {
            uint8_t a[] =
                {0x42,0x61,0x51,0x49,0x46};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '3':
        {
            uint8_t a[] =
                {0x21,0x41,0x45,0x4B,0x31};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '4':
        {
            uint8_t a[] =
                {0x18,0x14,0x12,0x7F,0x10};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '5':
        {
            uint8_t a[] =
                {0x27,0x45,0x45,0x45,0x39};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '6':
        {
            uint8_t a[] =
                {0x3C,0x4A,0x49,0x49,0x30};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '7':
        {
            uint8_t a[] =
                {0x01,0x71,0x09,0x05,0x03};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '8':
        {
            uint8_t a[] =
                {0x36,0x49,0x49,0x49,0x36};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '9':
        {
            uint8_t a[] =
                {0x06,0x49,0x49,0x29,0x1E};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }


        /* Letters */

        case 'T':
        {
            uint8_t a[] =
                {0x01,0x01,0x7F,0x01,0x01};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'H':
        {
            uint8_t a[] =
                {0x7F,0x08,0x08,0x08,0x7F};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'L':
        {
            uint8_t a[] =
                {0x7F,0x40,0x40,0x40,0x40};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'D':
        {
            uint8_t a[] =
                {0x7F,0x41,0x41,0x22,0x1C};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'O':
        {
            uint8_t a[] =
                {0x3E,0x41,0x41,0x41,0x3E};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'B':
        {
            uint8_t a[] =
                {0x7F,0x49,0x49,0x49,0x36};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'J':
        {
            uint8_t a[] =
                {0x20,0x40,0x41,0x3F,0x01};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'E':
        {
            uint8_t a[] =
                {0x7F,0x49,0x49,0x49,0x41};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'C':
        {
            uint8_t a[] =
                {0x3E,0x41,0x41,0x41,0x22};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'N':
        {
            uint8_t a[] =
                {0x7F,0x02,0x0C,0x10,0x7F};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'M':
        {
            uint8_t a[] =
                {0x7F,0x02,0x0C,0x02,0x7F};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'X':
        {
            uint8_t a[] =
                {0x63,0x14,0x08,0x14,0x63};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'R':
        {
            uint8_t a[] =
                {0x7F,0x09,0x19,0x29,0x46};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }


        /* Symbols */

        case ':':
        {
            uint8_t a[] =
                {0x00,0x36,0x36,0x00,0x00};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '%':
        {
            uint8_t a[] =
                {0x63,0x13,0x08,0x64,0x63};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '-':
        {
            uint8_t a[] =
                {0x08,0x08,0x08,0x08,0x08};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case ' ':
        default:
            break;
    }


}

void oled_init(void)
{
    memset(desired, ' ', sizeof(desired));
    dirty = 0x0f;
    next_row = 0;
    retry_at = timebase_millis() + 100U;
    state = OLED_WAIT;
}

void oled_set_line(uint8_t index, const char *text)
{
    if (index >= OLED_ROWS) return;
    char padded[OLED_COLUMNS];
    uint8_t i = 0;
    while (i < OLED_COLUMNS && *text) padded[i++] = *text++;
    while (i < OLED_COLUMNS) padded[i++] = ' ';
    if (memcmp(desired[index], padded, OLED_COLUMNS)) {
        memcpy(desired[index], padded, OLED_COLUMNS);
        dirty |= (1 << index);
    }
}

void oled_service(uint32_t now)
{
    uint8_t bytes[6] = {0,0,0,0,0,0};
    uint8_t length;
    switch (state) {
    case OLED_WAIT:
        if ((int32_t)(now - retry_at) < 0) return;
        init_index = 0;
        state = OLED_INIT;
        return;
    case OLED_INIT:
        if (!oled_command(init_commands[init_index])) goto failed;
        if (++init_index == sizeof(init_commands)) {
            page = column = cursor_step = 0;
            state = OLED_CLEAR_CURSOR;
        }
        return;
    case OLED_CLEAR_CURSOR:
        if (!oled_cursor_part(page)) goto failed;
        if (++cursor_step == 3) state = OLED_CLEAR_DATA;
        return;
    case OLED_CLEAR_DATA:
        length = (128U - column) < 6U ? (128U - column) : 6U;
        if (!oled_bytes(bytes, length)) goto failed;
        column += length;
        if (column == 128) {
            column = cursor_step = 0;
            state = ++page == 8 ? OLED_IDLE : OLED_CLEAR_CURSOR;
            if (state == OLED_IDLE) dirty = 0x0f;
        }
        return;
    case OLED_IDLE:
        if (!dirty) return;
        for (uint8_t i = 0; i < OLED_ROWS; i++) {
            row = (next_row + i) % OLED_ROWS;
            if (dirty & (1 << row)) break;
        }
        next_row = (row + 1) % OLED_ROWS;
        memcpy(active, desired[row], OLED_COLUMNS);
        dirty &= (uint8_t)~(1 << row);
        column = cursor_step = 0;
        state = OLED_TEXT_CURSOR;
        return;
    case OLED_TEXT_CURSOR:
        if (!oled_cursor_part(row * 2)) goto failed;
        if (++cursor_step == 3) state = OLED_TEXT_DATA;
        return;
    case OLED_TEXT_DATA:
        oled_glyph(active[column], bytes);
        if (!oled_bytes(bytes, 6)) goto failed;
        if (++column == OLED_COLUMNS) state = OLED_IDLE;
        return;
    }
    return;
failed:
    dirty = 0x0f;
    retry_at = timebase_millis() + PERIPHERAL_RETRY_MS;
    state = OLED_WAIT;
}
```

## oled.h

```c
#ifndef OLED_H
#define OLED_H
#include <stdint.h>
#define OLED_ROWS 4U
#define OLED_COLUMNS 21U
void oled_init(void);
void oled_set_line(uint8_t row, const char *text);
void oled_service(uint32_t now);
#endif
```

## bh1750.c

```c
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
```

## bh1750.h

```c
#ifndef BH1750_H
#define BH1750_H
#include <stdint.h>
typedef enum { BH1750_OFF, BH1750_POWER_WAIT, BH1750_CONVERSION_WAIT,
               BH1750_READY } bh1750_state_t;
/* Success starts initialization; service() must reach READY before reads. */
uint8_t bh1750_init(void);
uint8_t bh1750_service(uint32_t now);
bh1750_state_t bh1750_state(void);
uint8_t bh1750_read_lux(uint16_t *lux);
#endif
```

## dht11.c

```c
#include "config.h"
#include "dht11.h"
#include <avr/io.h>
#include <avr/interrupt.h>
#include <util/delay.h>

#define DHT_DDR DDRA
#define DHT_PORT PORTA
#define DHT_PIN PINA
#define DHT_BIT DHT11_PIN

/* The original transaction is retained; Timer2 replaces Timer0 at 1 us/tick. */
static void dht_timer_init(void)
{
    /*
       1 MHz
       prescaler = 1

       1 Timer2 count ≈ 1 us
    */

    TCCR2 =
        (1 << CS20);

    TCNT2 = 0;
}


static uint8_t dht_wait_level(
    uint8_t level,
    uint8_t timeout
)
{
    TCNT2 = 0;


    while(1)
    {
        uint8_t current =
            (DHT_PIN &
             (1 << DHT_BIT))
            ? 1
            : 0;


        if(current == level)
            return 1;


        if(TCNT2 >= timeout)
            return 0;
    }
}


/*
   Returns:

   0 = success
   1..5 = error
*/

static uint8_t read_sample(
    uint8_t *temperature,
    uint8_t *humidity
)
{
    uint8_t data[5] =
    {
        0,0,0,0,0
    };


    uint8_t oldSREG =
        SREG;


    cli();


    /* Start signal */

    DHT_DDR |=
        (1 << DHT_BIT);


    DHT_PORT &=
        ~(1 << DHT_BIT);


    _delay_ms(20);


    DHT_PORT |=
        (1 << DHT_BIT);


    _delay_us(30);


    /* Release bus */

    DHT_DDR &=
        ~(1 << DHT_BIT);


    DHT_PORT |=
        (1 << DHT_BIT);


    /* DHT response */

    if(!dht_wait_level(0,120))
    {
        SREG = oldSREG;
        return 1;
    }


    if(!dht_wait_level(1,120))
    {
        SREG = oldSREG;
        return 2;
    }


    if(!dht_wait_level(0,120))
    {
        SREG = oldSREG;
        return 3;
    }


    /* Read 40 bits */

    for(
        uint8_t i=0;
        i<40;
        i++
    )
    {
        if(
            !dht_wait_level(
                1,
                100
            )
        )
        {
            SREG = oldSREG;
            return 4;
        }


        TCNT2 = 0;


        while(
            DHT_PIN &
            (1 << DHT_BIT)
        )
        {
            if(
                TCNT2 >= 120
            )
            {
                SREG = oldSREG;
                return 4;
            }
        }


        uint8_t highTime =
            TCNT2;


        data[i / 8] <<= 1;


        if(highTime > 45)
        {
            data[i / 8] |= 1;
        }
    }


    uint8_t checksum =
          data[0]
        + data[1]
        + data[2]
        + data[3];


    if(
        checksum !=
        data[4]
    )
    {
        SREG = oldSREG;

        return 5;
    }


    *humidity =
        data[0];


    *temperature =
        data[2];


    SREG = oldSREG;


    return 0;
}



void dht11_init(void)
{
    DHT_DDR &= (uint8_t)~(1 << DHT_BIT);
    DHT_PORT |= (1 << DHT_BIT);
}

uint8_t dht11_read(uint8_t *temperature, uint8_t *humidity)
{
    dht_timer_init();
    uint8_t result = read_sample(temperature, humidity);
    TCCR2 = 0;
    return result;
}
```

## dht11.h

```c
#ifndef DHT11_H
#define DHT11_H
#include <stdint.h>
void dht11_init(void);
/* 0 success; 1..5 are the original response/bit/checksum error codes.
 * Caller must stop the motors, pause the timebase, and leave Timer2 idle. */
uint8_t dht11_read(uint8_t *temperature, uint8_t *humidity);
#endif
```

## hcsr04.c

```c
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
```

## hcsr04.h

```c
#ifndef HCSR04_H
#define HCSR04_H
#include <stdint.h>
#define HCSR04_INVALID_CM UINT16_MAX
void hcsr04_init(void);
/* Caller stops motors and pauses scheduler time. Uses only Timer2.
 * At most 30 ms waiting for rise plus 30 ms waiting for fall. */
uint16_t hcsr04_get_distance_cm(void);
#endif
```

## uart.c

```c
#include "config.h"
#include "uart.h"
#include <avr/io.h>

/* Double-speed mode: baud = F_CPU / (8 * (UBRR + 1)), rounded to nearest. */
#define UART_UBRR ((F_CPU + 4UL * UART_BAUD) / (8UL * UART_BAUD) - 1UL)
#define UART_ACTUAL_BAUD (F_CPU / (8UL * (UART_UBRR + 1UL)))
#if UART_UBRR > 4095UL
#error "UART_BAUD is too low for F_CPU"
#endif
#if (UART_ACTUAL_BAUD > UART_BAUD ? UART_ACTUAL_BAUD - UART_BAUD : \
     UART_BAUD - UART_ACTUAL_BAUD) * 1000UL > UART_BAUD * 20UL
#error "UART_BAUD has more than 2% error at F_CPU with U2X"
#endif

void uart_init(void)
{
    /* UBRRH shares its address with UCSRC; URSEL clear selects UBRRH. */
    UBRRH = (uint8_t)(UART_UBRR >> 8);
    UBRRL = (uint8_t)UART_UBRR;
    UCSRA = (1 << U2X);
    UCSRC = (1 << URSEL) | (1 << UCSZ1) | (1 << UCSZ0);
    UCSRB = (1 << TXEN);
}

void uart_putc(char c)
{
    loop_until_bit_is_set(UCSRA, UDRE);
    UDR = (uint8_t)c;
}

void uart_puts(const char *s)
{
    while (*s) uart_putc(*s++);
}

static void put_uint(uint16_t value)
{
    char digits[5];
    uint8_t count = 0;
    do {
        digits[count++] = (char)('0' + value % 10U);
        value /= 10U;
    } while (value);
    while (count) uart_putc(digits[--count]);
}

void uart_send_sample(int16_t temp_c, uint8_t humidity, uint16_t lux)
{
    uart_puts("<S,T=");
    if (temp_c < 0) {
        uart_putc('-');
        put_uint((uint16_t)(0U - (uint16_t)temp_c));
    } else {
        put_uint((uint16_t)temp_c);
    }
    uart_puts(",H=");
    put_uint(humidity);
    uart_puts(",L=");
    put_uint(lux);
    uart_puts(">\n");
}

void uart_send_sample_failed(void)
{
    uart_puts("<F>\n");
}
```

## uart.h

```c
#ifndef UART_H
#define UART_H
#include <stdint.h>
/* Blocking, transmit-only USART on PD1/TXD: UART_BAUD, 8N1, U2X, no interrupts. */
void uart_init(void);
void uart_putc(char c);
void uart_puts(const char *s);
/* Sends "<S,T=<temp_c>,H=<humidity>,L=<lux>>\n" using integer formatting only. */
void uart_send_sample(int16_t temp_c, uint8_t humidity, uint16_t lux);
/* Sends "<F>\n". */
void uart_send_sample_failed(void);
#endif
```

## Makefile

```makefile
MCU := atmega32
F_CPU := 1000000UL
PROGRAMMER := usbasp
PART := m32
BITCLOCK ?= 8
STAGE ?= 6

ifeq ($(filter $(STAGE),1 2 3 4 5 6),)
$(error STAGE must be 1, 2, 3, 4, 5, or 6)
endif

CC := avr-gcc
OBJCOPY := avr-objcopy
AVRDUDE := avrdude
BUILD := .build/stage$(STAGE)
SOURCES := main.c motor.c line_sensor.c line_follow.c timebase.c
ifneq ($(filter $(STAGE),2 3 4 5 6),)
SOURCES += twi.c oled.c
endif
ifneq ($(filter $(STAGE),3 4 5 6),)
SOURCES += bh1750.c
endif
ifneq ($(filter $(STAGE),4 5 6),)
SOURCES += dht11.c
endif
ifneq ($(filter $(STAGE),5 6),)
SOURCES += hcsr04.c
endif
ifeq ($(STAGE),6)
SOURCES += sample_cycle.c uart.c
endif
OBJECTS := $(SOURCES:%.c=$(BUILD)/%.o)
OLED_DEBUG_BUILD := .build/oled-debug
OLED_DEBUG_SOURCES := oled_debug.c twi.c oled.c timebase.c
OLED_DEBUG_OBJECTS := $(OLED_DEBUG_SOURCES:%.c=$(OLED_DEBUG_BUILD)/%.o)
CPPFLAGS := -DF_CPU=$(F_CPU) -DINTEGRATION_STAGE=$(STAGE)
OLED_DEBUG_CPPFLAGS := -DF_CPU=$(F_CPU) -DINTEGRATION_STAGE=2
CFLAGS := -mmcu=$(MCU) -std=gnu11 -Os -Wall -Wextra -Werror -ffunction-sections -fdata-sections
LDFLAGS := -mmcu=$(MCU) -Wl,--gc-sections,-Map,$(BUILD)/main.map
OLED_DEBUG_LDFLAGS := -mmcu=$(MCU) -Wl,--gc-sections,-Map,$(OLED_DEBUG_BUILD)/main.map

.DEFAULT_GOAL := all
.PHONY: all stage stages flash oled-debug oled-debug-flash clean test test-sim source-bundle
all: stage
	cp $(BUILD)/main.elf main.elf
	cp $(BUILD)/main.hex main.hex

stage: $(BUILD)/main.hex

oled-debug: $(OLED_DEBUG_BUILD)/main.hex

oled-debug-flash: oled-debug
	$(AVRDUDE) -c $(PROGRAMMER) -p $(PART) -B $(BITCLOCK) \
		-U flash:w:$(OLED_DEBUG_BUILD)/main.hex:i

stages:
	@for s in 1 2 3 4 5 6; do $(MAKE) --no-print-directory STAGE=$$s stage || exit $$?; done

test:
	python3 tests/run_tests.py

test-sim:
	$(MAKE) --no-print-directory STAGE=6 stage
	python3 tests/run_simavr.py

source-bundle:
	python3 tools/export_sources.py

$(BUILD)/%.o: %.c Makefile
	@mkdir -p $(BUILD)
	$(CC) $(CPPFLAGS) $(CFLAGS) -MMD -MP -c $< -o $@

$(BUILD)/main.elf: $(OBJECTS)
	$(CC) $(LDFLAGS) $^ -o $@

$(BUILD)/main.hex: $(BUILD)/main.elf
	$(OBJCOPY) -O ihex -R .eeprom $< $@

$(OLED_DEBUG_BUILD)/%.o: %.c Makefile
	@mkdir -p $(OLED_DEBUG_BUILD)
	$(CC) $(OLED_DEBUG_CPPFLAGS) $(CFLAGS) -MMD -MP -c $< -o $@

$(OLED_DEBUG_BUILD)/main.elf: $(OLED_DEBUG_OBJECTS)
	$(CC) $(OLED_DEBUG_LDFLAGS) $^ -o $@

$(OLED_DEBUG_BUILD)/main.hex: $(OLED_DEBUG_BUILD)/main.elf
	$(OBJCOPY) -O ihex -R .eeprom $< $@

flash: stage
	$(AVRDUDE) -c $(PROGRAMMER) -p $(PART) -B $(BITCLOCK) \
		-U flash:w:$(BUILD)/main.hex:i

clean:
	rm -rf .build
	rm -f main.elf main.hex

-include $(OBJECTS:.o=.d) $(OLED_DEBUG_OBJECTS:.o=.d)
```

## tests/fake_avr/avr/interrupt.h

```c
#ifndef FAKE_AVR_INTERRUPT_H
#define FAKE_AVR_INTERRUPT_H
#define cli() (SREG &= 0x7f)
#define sei() (SREG |= 0x80)
#define ISR(name) void name(void)
#endif
```

## tests/fake_avr/avr/io.h

```c
#ifndef FAKE_AVR_IO_H
#define FAKE_AVR_IO_H
#include <stdint.h>
extern uint8_t DDRA, DDRB, DDRC, DDRD, PORTA, PORTB, PORTC, PORTD, PINA;
extern uint8_t TCCR1A, TCCR1B, TCCR0, TCNT0, OCR0, TCCR2, TCNT2;
extern uint8_t TIFR, TIMSK, SREG, TWSR, TWBR, TWCR, TWDR, ASSR;
extern uint16_t ICR1, OCR1A, OCR1B;
extern uint8_t UCSRA, UCSRB, UCSRC, UBRRH, UBRRL;
/* Host capture: every write to UDR appends one byte; each UDRE wait is counted. */
extern char uart_tx[512];
extern unsigned uart_tx_len, uart_udre_waits;
#define UDR uart_tx[uart_tx_len++ % sizeof uart_tx]
#define loop_until_bit_is_set(sfr, bit) ((void)(sfr), (void)(bit), uart_udre_waits++)
#define PA0 0
#define PA1 1
#define PA2 2
#define PA3 3
#define PA4 4
#define PB0 0
#define PB1 1
#define PB2 2
#define PB3 3
#define PC0 0
#define PC1 1
#define PD4 4
#define PD5 5
#define COM1A1 7
#define COM1B1 5
#define WGM11 1
#define WGM12 3
#define WGM13 4
#define CS10 0
#define CS00 0
#define CS01 1
#define CS02 2
#define WGM01 3
#define OCF0 1
#define OCIE0 1
#define CS20 0
#define CS21 1
#define TOV2 6
#define TOIE2 6
#define OCIE2 7
#define AS2 3
#define TWINT 7
#define TWSTA 5
#define TWSTO 4
#define TWEN 2
#define TWEA 6
#define U2X 1
#define UDRE 5
#define TXEN 3
#define URSEL 7
#define UCSZ1 2
#define UCSZ0 1
#endif
```

## tests/fake_avr/avr/pgmspace.h

```c
#ifndef FAKE_AVR_PGMSPACE_H
#define FAKE_AVR_PGMSPACE_H
#define PROGMEM
#define pgm_read_byte(address) (*(const unsigned char *)(address))
#endif
```

## tests/registers.c

```c
#include <stdint.h>
uint8_t DDRA, DDRB, DDRC, DDRD, PORTA, PORTB, PORTC, PORTD, PINA;
uint8_t TCCR1A, TCCR1B, TCCR0, TCNT0, OCR0, TCCR2, TCNT2;
uint8_t TIFR, TIMSK, SREG, TWSR, TWBR, TWCR, TWDR, ASSR;
uint16_t ICR1, OCR1A, OCR1B;
uint8_t UCSRA, UCSRB, UCSRC, UBRRH, UBRRL;
char uart_tx[512];
unsigned uart_tx_len, uart_udre_waits;
```

## tests/run_simavr.py

```python
#!/usr/bin/env python3
"""Optional AVR instruction tests; requires libsimavr development files."""
from pathlib import Path
import os
import shlex
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
include = os.environ.get('SIMAVR_INCLUDE_DIR')
library = os.environ.get('SIMAVR_LIB_DIR')
if include and library:
    flags = ['-I'+include, '-L'+library, '-Wl,-rpath,'+library, '-lsimavr']
else:
    try:
        flags = shlex.split(subprocess.check_output(
            ['pkg-config', '--cflags', '--libs', 'simavr'], text=True))
    except (OSError, subprocess.CalledProcessError):
        raise SystemExit('Install libsimavr-dev and pkg-config, or set '
                         'SIMAVR_INCLUDE_DIR and SIMAVR_LIB_DIR.')
with tempfile.TemporaryDirectory(prefix='sylvan-simavr-') as tmp:
    binary = str(Path(tmp)/'integration')
    subprocess.run(['cc', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
                    str(root/'tests/simavr_integration.c'), *flags,
                    '-o', binary], check=True)
    for args in [[], ['sweep'], ['sweep', 'nodht']]:
        subprocess.run([binary, str(root/'.build/stage6/main.elf'), *args], check=True)
```

## tests/run_tests.py

```python
#!/usr/bin/env python3
"""Compare the modular controller with an oracle extracted from untouched lfr.c."""
from pathlib import Path
import hashlib
import re
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
source = (root / 'lfr.c').read_text()
for line in (root / 'references/SHA256SUMS').read_text().splitlines():
    digest, name = line.split()
    assert hashlib.sha256((root/name).read_bytes()).hexdigest() == digest, name + ' changed'

def function(name, source=source):
    start = source.index(name + '(')
    start = source.rfind('\n', 0, start) + 1
    brace = source.index('{', start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]

original_config = (root/'references/config.h.original').read_text()
new_config = (root/'config.h').read_text()
defines = lambda text: dict(re.findall(r'^#define\s+(\w+)[ \t]+([^\n]+)', text, re.M))
for name, value in defines(original_config).items():
    assert defines(new_config)[name] == value, name + ' tuning changed'
sensor_source = (root/'lightTemSr.c').read_text()
dht_source = (root/'dht11.c').read_text()
for original, extracted in [('dht_wait_level', 'dht_wait_level'), ('dht11_read', 'read_sample')]:
    old = function(original, sensor_source).split('{', 1)[1].replace('TCNT0', 'TCNT2')
    new = function(extracted, dht_source).split('{', 1)[1]
    assert old == new, original + ' transaction changed'
glyphs = lambda text: re.findall(r"case '(.)':\s*\{\s*uint8_t a\[\] =\s*\{([^}]+)\}", text)
current_glyphs = dict(glyphs((root/'oled.c').read_text()))
for char, bitmap in glyphs(sensor_source):
    assert current_glyphs[char] == bitmap, 'original font changed: ' + char

helpers = '\n'.join(function(n) for n in [
    'percentToPWM', 'setSpeed', 'setMotorPattern', 'moveForward', 'moveBackward',
    'pivotLeft', 'pivotRight', 'brakeMotors', 'stopMotors'])
for reg in ['PORTB', 'OCR1A', 'OCR1B']:
    helpers = helpers.replace(reg, 'ref_' + reg)
constants = '\n'.join(line for line in source.splitlines() if line.startswith('#define MOTOR_') or line.startswith('#define PWM_TOP'))
states = source[source.index('typedef enum'):source.index('// =====================================================\n// MAIN')]
body = source[source.index('        // =================================================\n        // NORMAL LINE FOLLOWING'):]
body = body[:body.rfind('\n    }\n}')].replace('continue;', 'return;')
oracle = '''#include <stdint.h>
#include "config.h"
uint8_t ref_PORTB;
uint16_t ref_OCR1A, ref_OCR1B;
''' + constants + '\n' + helpers + '\n' + states + '''
static uint8_t previousLeftBlack, previousRightBlack, firstOffSensor, lastTurn, starting;
static uint32_t stateStartTime;
static RobotState state;
void reference_init(uint32_t now) {
    ref_PORTB = 0xa0;
    stopMotors();
    firstOffSensor = SENSOR_NONE;
    lastTurn = TURN_NONE;
    state = STATE_STOP;
    stateStartTime = now;
    starting = 1;
}
void reference_step(uint32_t now, uint8_t leftBlack, uint8_t rightBlack) {
    if (starting) {
        stopMotors();
        if ((uint32_t)(now-stateStartTime) < START_DELAY_MS) return;
        starting = 0;
        state = STATE_FOLLOW;
        previousLeftBlack = leftBlack;
        previousRightBlack = rightBlack;
    }
''' + body + '\n}\n'
with tempfile.TemporaryDirectory(prefix='sylvan-tests-') as tmp:
    tmp = Path(tmp)
    (tmp/'reference.c').write_text(oracle)
    subprocess.run(['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-O2',
        '-I'+str(root/'tests/fake_avr'), '-I'+str(root), str(tmp/'reference.c'),
        *[str(root/n) for n in ['tests/registers.c','tests/test_line_follow.c',
                               'motor.c','line_sensor.c','line_follow.c']],
        '-o', str(tmp/'line_follow')], check=True)
    subprocess.run([str(tmp/'line_follow')], check=True)
    subprocess.run(['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-O2',
        '-I'+str(root/'tests/fake_avr'), '-I'+str(root), *[str(root/n) for n in
        ['tests/test_i2c_clients.c', 'bh1750.c', 'oled.c']],
        '-o', str(tmp/'i2c_clients')], check=True)
    subprocess.run([str(tmp/'i2c_clients')], check=True)
    subprocess.run(['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-O2',
        '-I'+str(root/'tests/fake_avr'), '-I'+str(root), *[str(root/n) for n in
        ['tests/test_uart.c', 'tests/registers.c', 'uart.c']],
        '-o', str(tmp/'uart')], check=True)
    subprocess.run([str(tmp/'uart')], check=True)
    subprocess.run(['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-O2',
        '-I'+str(root/'tests/fake_avr'), '-I'+str(root), str(root/'tests/test_sample_cycle.c'),
        str(root/'sample_cycle.c'), str(root/'uart.c'), str(root/'tests/registers.c'),
        '-o', str(tmp/'sample_cycle')], check=True)
    subprocess.run([str(tmp/'sample_cycle')], check=True)
    subprocess.run(['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-O2',
        '-DINTEGRATION_STAGE=6', '-I'+str(root/'tests/fake_avr'), '-I'+str(root),
        str(root/'tests/test_sampling_main.c'), str(root/'sample_cycle.c'),
        str(root/'uart.c'), str(root/'tests/registers.c'),
        '-o', str(tmp/'sampling_main')], check=True)
    for arguments in [[], ['bad-dht'], ['missing-light']]:
        subprocess.run([str(tmp/'sampling_main'), *arguments], check=True)
print('PASS: both reference source hashes unchanged.')
```

## tests/simavr_integration.c

```c
/* Optional instruction/timer simulation against the actual Stage 6 AVR ELF. */
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <simavr/sim_avr.h>
#include <simavr/sim_elf.h>
#include <simavr/sim_io.h>
#include <simavr/avr_ioport.h>
#include <simavr/avr_timer.h>
#include <simavr/avr_uart.h>
#include <simavr/sim_cycle_timers.h>

static avr_t *cpu;
static avr_irq_t *echo, *dht;
static unsigned triggers, width_us, previous_trigger, previous_ddr;
static unsigned latest_cm, distance_addr, sweep, readings, worst_error;
static unsigned dht_reads, dht_phase, bit_index, dht_disabled;
static uint8_t dht_data[5];
static uint64_t last_poll, max_poll_gap;
static char uart_line[64];
static unsigned uart_len, uart_packets;

/* ESP32-CAM link. BH1750 is absent on this simulated bus, so every sample fails. */
static void uart_output(avr_irq_t *irq, uint32_t value, void *unused)
{
    (void)irq; (void)unused;
    assert(cpu->data[0x4a]==0 && cpu->data[0x48]==0); /* Motors stopped. */
    assert(uart_len<sizeof uart_line);
    uart_line[uart_len++]=(char)value;
    if(value=='\n') {
        assert(uart_len==4 && !memcmp(uart_line,"<F>\n",4));
        uart_packets++;
        uart_len=0;
    }
}

static uint32_t symbol(elf_firmware_t *f, const char *name)
{
    for (unsigned i=0; i<f->symbolcount; i++)
        if (!strcmp(f->symbol[i]->symbol,name)) return f->symbol[i]->addr;
    fprintf(stderr,"Missing symbol: %s\n",name); exit(1);
}
static unsigned read16(unsigned address)
{
    return cpu->data[address] | (cpu->data[address+1]<<8);
}
static avr_cycle_count_t echo_low(avr_t *avr, avr_cycle_count_t when, void *unused)
{
    (void)avr; (void)when; (void)unused;
    avr_raise_irq(echo,0); return 0;
}
static avr_cycle_count_t echo_high(avr_t *avr, avr_cycle_count_t when, void *unused)
{
    (void)when; (void)unused;
    avr_raise_irq(echo,1);
    avr_cycle_timer_register_usec(avr,width_us,echo_low,NULL);
    return 0;
}
static void trigger_changed(avr_irq_t *irq, uint32_t value, void *unused)
{
    (void)irq; (void)unused;
    value &= 1;
    if (previous_trigger && !value) {
        if (triggers) {
            unsigned cm=read16(distance_addr);
            if (latest_cm==0 || latest_cm==999) assert(cm==65535);
            else {
                unsigned error=abs((int)cm-(int)latest_cm);
                if(error>worst_error) worst_error=error;
                assert(error<=1);
            }
            readings++;
        }
        triggers++;
        if (sweep) {
            static const unsigned distances[]={2,18,29,30,31,60,400,0,999};
            latest_cm=distances[(triggers-1) % 9];
        } else {
            /* First object stays present after the timed sample resumes;
             * a clear interval then permits a second sampling cycle. */
            latest_cm=cpu->cycle<1400000 ? 60 : cpu->cycle<10000000 ? 18 :
                      cpu->cycle<11000000 ? 0 : 18;
        }
        width_us=latest_cm==999 ? 35000 : latest_cm*58;
        if (width_us) avr_cycle_timer_register_usec(cpu,200,echo_high,NULL);
    }
    previous_trigger=value;
}

/* DHT response: 80 us low, 80 us high, then 40 bits, 50 us low each. */
static avr_cycle_count_t dht_edge(avr_t *avr, avr_cycle_count_t when, void *unused)
{
    (void)avr; (void)unused;
    switch(dht_phase) {
    case 0: avr_raise_irq(dht,0); dht_phase=1; return when+80;
    case 1: avr_raise_irq(dht,1); dht_phase=2; return when+80;
    case 2: avr_raise_irq(dht,0); dht_phase=3; return when+50;
    case 3:
        avr_raise_irq(dht,1); dht_phase=4;
        return when+((dht_data[bit_index/8] & (0x80>>(bit_index%8))) ? 70 : 26);
    case 4:
        avr_raise_irq(dht,0);
        dht_phase=++bit_index==40 ? 5 : 3;
        return when+50;
    default: avr_raise_irq(dht,1); return 0;
    }
}
static void direction_changed(avr_irq_t *irq, uint32_t value, void *unused)
{
    (void)irq; (void)unused;
    if ((previous_ddr & 8) && !(value & 8) && !dht_disabled) {
        dht_reads++;
        dht_data[0]=66; dht_data[1]=0; dht_data[2]=30; dht_data[3]=0;
        dht_data[4]=dht_reads==1 ? 96 : 97; /* Second read has bad checksum. */
        bit_index=dht_phase=0;
        avr_cycle_timer_register_usec(cpu,20,dht_edge,NULL);
    }
    previous_ddr=value;
}

int main(int argc, char **argv)
{
    assert(argc>=2 && argc<=4);
    sweep=argc>2;
    dht_disabled=argc>3;
    elf_firmware_t firmware={0};
    assert(elf_read_firmware(argv[1],&firmware)==0);
    cpu=avr_make_mcu_by_name("atmega32");
    assert(cpu && avr_init(cpu)==0);
    /* simavr 1.6 shares an ATmega8 model missing Timer0 CTC. Add the
     * ATmega32's documented WGM bits to the simulation model, not firmware. */
    for(avr_io_t *io=cpu->io_port; io; io=io->next) {
        if(strcmp(io->kind,"timer")) continue;
        avr_timer_t *timer=(avr_timer_t *)io;
        if(timer->name=='0' && timer->wgm_op[2].kind==avr_timer_wgm_none) {
            timer->wgm[0]=(avr_regbit_t){.reg=0x53,.bit=6,.mask=1};
            timer->wgm[1]=(avr_regbit_t){.reg=0x53,.bit=3,.mask=1};
            timer->wgm_op[2]=(avr_timer_wgm_t)AVR_TIMER_WGM_CTC();
        }
    }
    cpu->frequency=1000000;
    avr_load_firmware(cpu,&firmware);
    echo=avr_io_getirq(cpu,AVR_IOCTL_IOPORT_GETIRQ('A'),4);
    dht=avr_io_getirq(cpu,AVR_IOCTL_IOPORT_GETIRQ('A'),3);
    avr_irq_register_notify(avr_io_getirq(cpu,AVR_IOCTL_IOPORT_GETIRQ('A'),0),trigger_changed,NULL);
    avr_irq_register_notify(avr_io_getirq(cpu,AVR_IOCTL_IOPORT_GETIRQ('A'),IOPORT_IRQ_DIRECTION_ALL),direction_changed,NULL);
    avr_ioport_external_t external={.name='A',.mask=0x1e,.value=0x0e};
    avr_ioctl(cpu,AVR_IOCTL_IOPORT_SET_EXTERNAL('A'),&external);
    avr_raise_irq(echo,0);
    avr_irq_register_notify(avr_io_getirq(cpu,AVR_IOCTL_UART_GETIRQ('0'),UART_IRQ_OUTPUT),uart_output,NULL);
    uint32_t poll_pc=symbol(&firmware,"timer_ticks");
    distance_addr=symbol(&firmware,"distance") & 0xffff;
    uint32_t temp_addr=symbol(&firmware,"temperature") & 0xffff;
    uint32_t humid_addr=symbol(&firmware,"humidity") & 0xffff;
    uint32_t dht_status_addr=symbol(&firmware,"dht_status") & 0xffff;
    uint32_t ms_addr=symbol(&firmware,"system_millis") & 0xffff;
    uint32_t phase_addr=symbol(&firmware,"cycle_phase") & 0xffff;
    unsigned drove_before=0, drove_after=0, saw_valid_dht=0, saw_bad_dht=0;
    unsigned saw_result=0, cycle_stops=0, cycle_resumes=0, previous_phase=0, results=0;
    uint32_t old_ms=0;
    while(cpu->cycle<20000000) {
        assert(avr_run(cpu)!=cpu_Crashed);
        if(cpu->data[0x45]==2 && cpu->pc==poll_pc) {
            if(last_poll && cpu->cycle-last_poll>max_poll_gap)
                max_poll_gap=cpu->cycle-last_poll;
            last_poll=cpu->cycle;
        } else if(cpu->data[0x45]!=2) last_poll=0;
        unsigned pwm=cpu->data[0x4a];
        unsigned phase=read16(phase_addr);
        if (phase && cpu->cycle>10000) assert(pwm==0);
        if (phase==1 && previous_phase==0) cycle_stops++;
        if (phase==0 && previous_phase==3) cycle_resumes++;
        if (phase==2 && previous_phase==1) results++;
        if (phase==3) saw_result=1;
        previous_phase=phase;
        if(!sweep) {
            if(cpu->cycle>1150000 && cpu->cycle<1350000 && pwm==39) drove_before++;
            if(cpu->cycle>1600000 && cpu->cycle<2300000) assert(pwm==0);
            if(cpu->cycle>9000000 && cpu->cycle<9800000 && pwm==39) drove_after++;
        }
        if(cpu->data[dht_status_addr]==1) {
            assert(cpu->data[temp_addr]==30 && cpu->data[humid_addr]==66);
            saw_valid_dht=1;
        }
        if(cpu->data[dht_status_addr]==2) saw_bad_dht=1;
        /* Sampling must leave Timer1 intact and freeze Timer0 with motors off. */
        if(cpu->cycle>10000) {
            assert(cpu->data[0x4f]==0xa2 && cpu->data[0x4e]==0x19);
            assert(cpu->data[0x46]==49);
            if(cpu->data[0x45]!=0) assert(pwm==0 && (cpu->data[0x53]&7)==0);
        }
        old_ms=read16(ms_addr);
    }
    assert(max_poll_gap<100);
    assert(readings>40);
    assert(saw_result);
    /* One packet per sampling result; the run may end while one is in flight. */
    assert(uart_packets>=1 && (uart_packets==results || uart_packets+1==results));
    if(dht_disabled) assert(saw_bad_dht);
    else assert(saw_valid_dht && dht_reads>=1);
    if(!sweep) {
        assert(drove_before && drove_after && saw_bad_dht && dht_reads>=2);
        assert(cycle_stops==2 && cycle_resumes==2);
    }
    printf("PASS: %u readings, <=%u cm echo error, max polling gap %llu us; logical clock %u ms; %u UART packets.\n",
        readings,worst_error,(unsigned long long)max_poll_gap,old_ms,uart_packets);
    avr_terminate(cpu);
}
```

## tests/test_i2c_clients.c

```c
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
```

## tests/test_line_follow.c

```c
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
```

## tests/test_sample_cycle.c

```c
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
```

## tests/test_sampling_main.c

```c
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
```

## tests/test_uart.c

```c
/* Host checks for uart.c: register setup and exact integer-only packet text. */
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <avr/io.h>
#include "config.h"
#include "uart.h"

static void expect(const char *text)
{
    assert(uart_tx_len == strlen(text) && !memcmp(uart_tx, text, uart_tx_len));
    assert(uart_udre_waits == uart_tx_len);
    uart_tx_len = uart_udre_waits = 0;
}

int main(void)
{
    UCSRA = UCSRB = UCSRC = UBRRH = UBRRL = 0xff;
    uart_init();
    assert(UART_BAUD == 9600UL && UBRRH == 0 && UBRRL == 12);
    assert(UCSRA == (1 << U2X));
    assert(UCSRB == (1 << TXEN)); /* TX only: no RXEN, no interrupt enables. */
    assert(UCSRC == ((1 << URSEL) | (1 << UCSZ1) | (1 << UCSZ0)));
    assert(uart_tx_len == 0);

    uart_send_sample(30, 66, 235);
    expect("<S,T=30,H=66,L=235>\n");
    uart_send_sample(-5, 40, 0);
    expect("<S,T=-5,H=40,L=0>\n");
    uart_send_sample(0, 0, 10);
    expect("<S,T=0,H=0,L=10>\n");
    uart_send_sample(INT16_MIN, 255, UINT16_MAX);
    expect("<S,T=-32768,H=255,L=65535>\n");
    uart_send_sample(INT16_MAX, 100, 1000);
    expect("<S,T=32767,H=100,L=1000>\n");
    uart_send_sample_failed();
    expect("<F>\n");
    uart_putc('x');
    uart_puts("yz");
    expect("xyz");
    puts("PASS: UART 9600 8N1 U2X TX-only setup and exact integer packets.");
}
```

## tools/export_sources.py

```python
#!/usr/bin/env python3
"""Export complete modular sources without duplicating the two references."""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
modules = ['motor', 'line_sensor', 'line_follow', 'sample_cycle', 'timebase', 'twi', 'oled',
           'bh1750', 'dht11', 'hcsr04', 'uart']
files = ['main.c', 'oled_debug.c', 'config.h']
for module in modules:
    files.extend([module+'.c', module+'.h'])
files.append('Makefile')
files.extend(str(path.relative_to(root)) for path in sorted((root/'tests').rglob('*'))
             if path.suffix in {'.c', '.h', '.py'})
files.append('tools/export_sources.py')
parts = ['# Complete modular source files\n\n'
         'Generated with `make source-bundle`. See [INTEGRATION.md](INTEGRATION.md) '
         'for conflicts, timer ownership, commands and hardware checks. '
         '`lfr.c` and `lightTemSr.c` remain separate, unchanged references.\n']
for name in files:
    path = root/name
    language = 'makefile' if name == 'Makefile' else 'python' if path.suffix == '.py' else 'c'
    parts.append(f'\n## {name}\n\n```{language}\n{path.read_text().rstrip()}\n```\n')
destination = root/'SOURCE_BUNDLE.md'
destination.write_text(''.join(parts))
print(f'Wrote {destination.name}: {len(files)} complete files.')
```
