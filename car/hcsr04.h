#ifndef HCSR04_H
#define HCSR04_H
#include <stdint.h>
#define HCSR04_INVALID_CM UINT16_MAX
void hcsr04_init(void);
/* Caller stops motors and pauses scheduler time. Uses only Timer2.
 * At most 30 ms waiting for rise plus 30 ms waiting for fall. */
uint16_t hcsr04_get_distance_cm(void);
#endif
