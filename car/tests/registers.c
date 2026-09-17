#include <stdint.h>
uint8_t DDRA, DDRB, DDRC, DDRD, PORTA, PORTB, PORTC, PORTD, PINA;
uint8_t TCCR1A, TCCR1B, TCCR0, TCNT0, OCR0, TCCR2, TCNT2;
uint8_t TIFR, TIMSK, SREG, TWSR, TWBR, TWCR, TWDR, ASSR;
uint16_t ICR1, OCR1A, OCR1B;
uint8_t UCSRA, UCSRB, UCSRC, UBRRH, UBRRL;
char uart_tx[512];
unsigned uart_tx_len, uart_udre_waits;
