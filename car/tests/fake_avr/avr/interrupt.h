#ifndef FAKE_AVR_INTERRUPT_H
#define FAKE_AVR_INTERRUPT_H
#define cli() (SREG &= 0x7f)
#define sei() (SREG |= 0x80)
#define ISR(name) void name(void)
#endif
