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
void sample_cycle_dht_done(uint8_t success);
void sample_cycle_light_done(uint8_t success);
uint8_t sample_cycle_succeeded(void);
#endif
