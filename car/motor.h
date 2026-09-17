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
