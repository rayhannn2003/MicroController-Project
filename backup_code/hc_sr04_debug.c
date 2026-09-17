/*
 * Standalone HC-SR04 test for ATmega32A at 1 MHz.
 * PB2 -> TRIG, PD6 <- ECHO, PD7 -> optional status LED.
 * PD1 (TXD) -> USB-to-TTL adapter RX; connect grounds together.
 * Read the serial output at 9600 baud, 8 data bits, no parity, 1 stop bit.
 * Build with: make -C car debug
 * Flash with USBasp: make -C car flash-debug
 */
#ifndef F_CPU
#define F_CPU 1000000UL
#endif

#if F_CPU != 1000000UL
#error "This debug program expects the ATmega32A to run at 1 MHz"
#endif

#include <avr/io.h>
#include <stdint.h>
#include <util/delay.h>

#define BAUD_RATE 9600UL
#define UART_UBRR ((F_CPU + 4UL * BAUD_RATE) / (8UL * BAUD_RATE) - 1UL)
#define ECHO_TIMEOUT_TICKS ((F_CPU / 8UL) * 30000UL / 1000000UL)

enum echo_status {
    ECHO_OK,
    ECHO_STUCK_HIGH,
    ECHO_NO_RISE,
    ECHO_TOO_LONG
};

static void uart_init(void)
{
    /* Double speed gives an accurate 9600 baud rate at 1 MHz. */
    UCSRA = (1 << U2X);
    UBRRH = (uint8_t)(UART_UBRR >> 8);
    UBRRL = (uint8_t)UART_UBRR;
    UCSRB = (1 << TXEN);
    UCSRC = (1 << URSEL) | (1 << UCSZ1) | (1 << UCSZ0);
}

static void uart_putc(char c)
{
    while (!(UCSRA & (1 << UDRE))) { }
    UDR = c;
}

static void uart_print(const char *text)
{
    while (*text) uart_putc(*text++);
}

static void uart_print_u16(uint16_t value)
{
    char digits[5];
    uint8_t count = 0;

    do {
        digits[count++] = '0' + value % 10;
        value /= 10;
    } while (value);

    while (count) uart_putc(digits[--count]);
}

static enum echo_status read_echo(uint16_t *pulse_us)
{
    if (PIND & (1 << PD6)) return ECHO_STUCK_HIGH;

    PORTB &= ~(1 << PB2);
    _delay_us(2);
    PORTB |= (1 << PB2);
    _delay_us(10);
    PORTB &= ~(1 << PB2);

    TCNT1 = 0;
    TCCR1B = (1 << CS11);  /* Timer1 tick = 8 us at 1 MHz. */
    while (!(PIND & (1 << PD6))) {
        if (TCNT1 >= ECHO_TIMEOUT_TICKS) {
            TCCR1B = 0;
            return ECHO_NO_RISE;
        }
    }

    TCNT1 = 0;
    while (PIND & (1 << PD6)) {
        if (TCNT1 >= ECHO_TIMEOUT_TICKS) {
            TCCR1B = 0;
            return ECHO_TOO_LONG;
        }
    }

    uint16_t ticks = TCNT1;
    TCCR1B = 0;
    *pulse_us = ticks * 8U;
    return ECHO_OK;
}

int main(void)
{
    uint16_t pulse_us;
    enum echo_status status;

    DDRB |= (1 << PB2);
    PORTB &= ~(1 << PB2);
    DDRD &= ~(1 << PD6);
    PORTD &= ~(1 << PD6); /* No internal pull-up on ECHO. */
    DDRD |= (1 << PD7);
    PORTD &= ~(1 << PD7);

    uart_init();
    uart_print("HC-SR04 debug ready\r\n");
    _delay_ms(100);

    while (1) {
        status = read_echo(&pulse_us);
        if (status == ECHO_OK) {
            PORTD |= (1 << PD7);
            uart_print("Echo: ");
            uart_print_u16(pulse_us);
            uart_print(" us, distance: ");
            uart_print_u16(pulse_us / 58U);
            uart_print(" cm\r\n");
        } else {
            PORTD &= ~(1 << PD7);
            if (status == ECHO_STUCK_HIGH) uart_print("Error: ECHO stuck HIGH\r\n");
            if (status == ECHO_NO_RISE) uart_print("Error: no ECHO pulse\r\n");
            if (status == ECHO_TOO_LONG) uart_print("Error: ECHO pulse too long\r\n");
        }

        _delay_ms(200);
    }
}
