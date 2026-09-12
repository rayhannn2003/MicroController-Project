
#ifndef CONFIG_H
#define CONFIG_H

#ifndef F_CPU
#define F_CPU 1000000UL
#endif


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
