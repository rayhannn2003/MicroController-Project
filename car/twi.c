#include "config.h"
#include "twi.h"
#include "timebase.h"
#include <avr/io.h>

/* Transactions retained from lightTemSr.c. Call with interrupts enabled. */
static uint8_t twi_wait(void)
{
    uint32_t start = timebase_millis();
    while (!(TWCR & (1 << TWINT))) {
        if ((uint32_t)(timebase_millis() - start) >= TWI_TIMEOUT_MS)
            return 0;
    }
    return 1;
}


void twi_init(void)
{
    DDRC &= (uint8_t)~((1 << TWI_SCL_PIN) | (1 << TWI_SDA_PIN));
    PORTC &= (uint8_t)~((1 << TWI_SCL_PIN) | (1 << TWI_SDA_PIN));
    TWSR = 0x00;

    /*
       1 MHz CPU
       TWBR = 2
       about 50 kHz I2C
    */

    TWBR = 2;

    TWCR = (1 << TWEN);
}


uint8_t twi_start(uint8_t address)
{
    TWCR =
        (1 << TWINT) |
        (1 << TWSTA) |
        (1 << TWEN);

    if (!twi_wait())
        return 0;


    uint8_t status =
        TWSR & 0xF8;

    if (
        status != 0x08 &&
        status != 0x10
    )
        return 0;


    TWDR = address;

    TWCR =
        (1 << TWINT) |
        (1 << TWEN);

    if (!twi_wait())
        return 0;


    status =
        TWSR & 0xF8;


    if ((address & 1) == 0)
    {
        if (status != 0x18)
            return 0;
    }
    else
    {
        if (status != 0x40)
            return 0;
    }


    return 1;
}


uint8_t twi_write(uint8_t data)
{
    TWDR = data;

    TWCR =
        (1 << TWINT) |
        (1 << TWEN);

    if (!twi_wait())
        return 0;


    return (
        (TWSR & 0xF8) == 0x28
    );
}


uint8_t twi_read_ack(uint8_t *data)
{
    TWCR =
        (1 << TWINT) |
        (1 << TWEN) |
        (1 << TWEA);

    if (!twi_wait() || (TWSR & 0xF8) != 0x50)
        return 0;


    *data = TWDR;

    return 1;
}


uint8_t twi_read_nack(uint8_t *data)
{
    TWCR =
        (1 << TWINT) |
        (1 << TWEN);

    if (!twi_wait() || (TWSR & 0xF8) != 0x58)
        return 0;


    *data = TWDR;

    return 1;
}


uint8_t twi_stop(void)
{
    uint32_t start = timebase_millis();
    TWCR = (1 << TWINT) | (1 << TWEN) | (1 << TWSTO);
    while (TWCR & (1 << TWSTO)) {
        if ((uint32_t)(timebase_millis() - start) >= TWI_TIMEOUT_MS) {
            TWCR = 0; /* Release the peripheral after a stuck transaction. */
            TWCR = (1 << TWEN);
            return 0;
        }
    }
    return 1;
}
