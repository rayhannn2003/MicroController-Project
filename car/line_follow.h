#ifndef LINE_FOLLOW_H
#define LINE_FOLLOW_H
#include <stdint.h>
void line_follow_init(uint32_t now);
void line_follow_update(uint32_t now);
/* Hold motor output and freeze recovery/startup elapsed time until resumed. */
void line_follow_set_paused(uint8_t paused, uint32_t now);
#endif
