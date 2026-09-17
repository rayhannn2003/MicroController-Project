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
