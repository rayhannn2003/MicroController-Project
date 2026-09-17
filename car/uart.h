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
