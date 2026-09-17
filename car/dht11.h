#ifndef DHT11_H
#define DHT11_H
#include <stdint.h>
void dht11_init(void);
/* 0 success; 1..5 are the original response/bit/checksum error codes.
 * Caller must stop the motors, pause the timebase, and leave Timer2 idle. */
uint8_t dht11_read(uint8_t *temperature, uint8_t *humidity);
#endif
