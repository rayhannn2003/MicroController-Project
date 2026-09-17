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
