/* Host checks for uart.c: register setup and exact integer-only packet text. */
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <avr/io.h>
#include "config.h"
#include "uart.h"

static void expect(const char *text)
{
    assert(uart_tx_len == strlen(text) && !memcmp(uart_tx, text, uart_tx_len));
    assert(uart_udre_waits == uart_tx_len);
    uart_tx_len = uart_udre_waits = 0;
}

int main(void)
{
    UCSRA = UCSRB = UCSRC = UBRRH = UBRRL = 0xff;
    uart_init();
    assert(UART_BAUD == 9600UL && UBRRH == 0 && UBRRL == 12);
    assert(UCSRA == (1 << U2X));
    assert(UCSRB == (1 << TXEN)); /* TX only: no RXEN, no interrupt enables. */
    assert(UCSRC == ((1 << URSEL) | (1 << UCSZ1) | (1 << UCSZ0)));
    assert(uart_tx_len == 0);

    uart_send_sample(30, 66, 235);
    expect("<S,T=30,H=66,L=235>\n");
    uart_send_sample(-5, 40, 0);
    expect("<S,T=-5,H=40,L=0>\n");
    uart_send_sample(0, 0, 10);
    expect("<S,T=0,H=0,L=10>\n");
    uart_send_sample(INT16_MIN, 255, UINT16_MAX);
    expect("<S,T=-32768,H=255,L=65535>\n");
    uart_send_sample(INT16_MAX, 100, 1000);
    expect("<S,T=32767,H=100,L=1000>\n");
    uart_send_sample_failed();
    expect("<F>\n");
    uart_putc('x');
    uart_puts("yz");
    expect("xyz");
    puts("PASS: UART 9600 8N1 U2X TX-only setup and exact integer packets.");
}
