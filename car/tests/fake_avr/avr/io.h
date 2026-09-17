#ifndef FAKE_AVR_IO_H
#define FAKE_AVR_IO_H
#include <stdint.h>
extern uint8_t DDRA, DDRB, DDRC, DDRD, PORTA, PORTB, PORTC, PORTD, PINA;
extern uint8_t TCCR1A, TCCR1B, TCCR0, TCNT0, OCR0, TCCR2, TCNT2;
extern uint8_t TIFR, TIMSK, SREG, TWSR, TWBR, TWCR, TWDR, ASSR;
extern uint16_t ICR1, OCR1A, OCR1B;
#define PA0 0
#define PA1 1
#define PA2 2
#define PA3 3
#define PA4 4
#define PB0 0
#define PB1 1
#define PB2 2
#define PB3 3
#define PC0 0
#define PC1 1
#define PD4 4
#define PD5 5
#define COM1A1 7
#define COM1B1 5
#define WGM11 1
#define WGM12 3
#define WGM13 4
#define CS10 0
#define CS00 0
#define CS01 1
#define CS02 2
#define WGM01 3
#define OCF0 1
#define OCIE0 1
#define CS20 0
#define CS21 1
#define TOV2 6
#define TOIE2 6
#define OCIE2 7
#define AS2 3
#define TWINT 7
#define TWSTA 5
#define TWSTO 4
#define TWEN 2
#define TWEA 6
#endif
