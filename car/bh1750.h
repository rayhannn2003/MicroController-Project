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
