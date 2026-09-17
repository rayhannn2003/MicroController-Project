#define F_CPU 1000000UL

#include <avr/io.h>
#include <util/delay.h>
#include <stdint.h>

#define OLED_ADDR 0x3C


/* =========================
   I2C / TWI
   ========================= */

void twi_init(void)
{
    TWSR = 0x00;
    TWBR = 2;              // ~50 kHz I2C at 1 MHz
    TWCR = (1 << TWEN);
}

void twi_start(uint8_t address)
{
    TWCR = (1 << TWINT) |
           (1 << TWSTA) |
           (1 << TWEN);

    while (!(TWCR & (1 << TWINT)));

    TWDR = address;

    TWCR = (1 << TWINT) |
           (1 << TWEN);

    while (!(TWCR & (1 << TWINT)));
}

void twi_write(uint8_t data)
{
    TWDR = data;

    TWCR = (1 << TWINT) |
           (1 << TWEN);

    while (!(TWCR & (1 << TWINT)));
}

void twi_stop(void)
{
    TWCR = (1 << TWINT) |
           (1 << TWEN) |
           (1 << TWSTO);
}


/* =========================
   OLED
   ========================= */

void oled_command(uint8_t command)
{
    twi_start(OLED_ADDR << 1);

    twi_write(0x00);
    twi_write(command);

    twi_stop();
}

void oled_data(uint8_t data)
{
    twi_start(OLED_ADDR << 1);

    twi_write(0x40);
    twi_write(data);

    twi_stop();
}

void oled_init(void)
{
    _delay_ms(100);

    oled_command(0xAE);

    oled_command(0xD5);
    oled_command(0x80);

    oled_command(0xA8);
    oled_command(0x3F);

    oled_command(0xD3);
    oled_command(0x00);

    oled_command(0x40);

    oled_command(0x8D);
    oled_command(0x14);

    oled_command(0x20);
    oled_command(0x02);

    oled_command(0xA1);
    oled_command(0xC8);

    oled_command(0xDA);
    oled_command(0x12);

    oled_command(0x81);
    oled_command(0x7F);

    oled_command(0xD9);
    oled_command(0xF1);

    oled_command(0xDB);
    oled_command(0x40);

    oled_command(0xA4);
    oled_command(0xA6);

    oled_command(0xAF);
}

void oled_cursor(uint8_t x, uint8_t page)
{
    oled_command(0xB0 | page);

    oled_command(0x00 | (x & 0x0F));
    oled_command(0x10 | (x >> 4));
}

void oled_clear(void)
{
    for (uint8_t page = 0; page < 8; page++)
    {
        oled_cursor(0, page);

        for (uint8_t x = 0; x < 128; x++)
        {
            oled_data(0x00);
        }
    }
}


/* =========================
   Simple font
   HELLO
   ========================= */

void oled_char(char c)
{
    uint8_t d[5] = {0,0,0,0,0};

    switch (c)
    {
        case 'H':
        {
            uint8_t a[] =
                {0x7F,0x08,0x08,0x08,0x7F};

            for (uint8_t i=0; i<5; i++)
                d[i] = a[i];

            break;
        }

        case 'E':
        {
            uint8_t a[] =
                {0x7F,0x49,0x49,0x49,0x41};

            for (uint8_t i=0; i<5; i++)
                d[i] = a[i];

            break;
        }

        case 'L':
        {
            uint8_t a[] =
                {0x7F,0x40,0x40,0x40,0x40};

            for (uint8_t i=0; i<5; i++)
                d[i] = a[i];

            break;
        }

        case 'O':
        {
            uint8_t a[] =
                {0x3E,0x41,0x41,0x41,0x3E};

            for (uint8_t i=0; i<5; i++)
                d[i] = a[i];

            break;
        }

        case '!':
        {
            uint8_t a[] =
                {0x00,0x00,0x5F,0x00,0x00};

            for (uint8_t i=0; i<5; i++)
                d[i] = a[i];

            break;
        }

        case ' ':
        default:
            break;
    }

    for (uint8_t i=0; i<5; i++)
    {
        oled_data(d[i]);
    }

    oled_data(0x00);
}

void oled_string(const char *text)
{
    while (*text)
    {
        oled_char(*text++);
    }
}


/* =========================
   MAIN
   ========================= */

int main(void)
{
    twi_init();

    oled_init();

    oled_clear();

    oled_cursor(35, 3);

    oled_string("HELLO!");

    while (1)
    {
    }
}