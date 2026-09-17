#define F_CPU 1000000UL

#include <avr/io.h>
#include <util/delay.h>
#include <stdint.h>

#define OLED_ADDR 0x3C

#define TRIG PA0
#define ECHO PA1


/* =========================================================
   TWI / I2C
   ========================================================= */

void twi_init(void)
{
    TWSR = 0x00;
    TWBR = 2;          // ~50 kHz at 1 MHz
    TWCR = (1 << TWEN);
}

void twi_start(uint8_t address)
{
    TWCR =
        (1 << TWINT) |
        (1 << TWSTA) |
        (1 << TWEN);

    while (!(TWCR & (1 << TWINT)));

    TWDR = address;

    TWCR =
        (1 << TWINT) |
        (1 << TWEN);

    while (!(TWCR & (1 << TWINT)));
}

void twi_write(uint8_t data)
{
    TWDR = data;

    TWCR =
        (1 << TWINT) |
        (1 << TWEN);

    while (!(TWCR & (1 << TWINT)));
}

void twi_stop(void)
{
    TWCR =
        (1 << TWINT) |
        (1 << TWEN) |
        (1 << TWSTO);
}


/* =========================================================
   OLED
   ========================================================= */

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


/* =========================================================
   SIMPLE FONT
   ========================================================= */

void oled_char(char c)
{
    uint8_t d[5] = {0,0,0,0,0};

    switch(c)
    {
        /* ---------- Numbers ---------- */

        case '0':
        {
            uint8_t a[] = {0x3E,0x51,0x49,0x45,0x3E};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case '1':
        {
            uint8_t a[] = {0x00,0x42,0x7F,0x40,0x00};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case '2':
        {
            uint8_t a[] = {0x42,0x61,0x51,0x49,0x46};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case '3':
        {
            uint8_t a[] = {0x21,0x41,0x45,0x4B,0x31};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case '4':
        {
            uint8_t a[] = {0x18,0x14,0x12,0x7F,0x10};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case '5':
        {
            uint8_t a[] = {0x27,0x45,0x45,0x45,0x39};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case '6':
        {
            uint8_t a[] = {0x3C,0x4A,0x49,0x49,0x30};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case '7':
        {
            uint8_t a[] = {0x01,0x71,0x09,0x05,0x03};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case '8':
        {
            uint8_t a[] = {0x36,0x49,0x49,0x49,0x36};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case '9':
        {
            uint8_t a[] = {0x06,0x49,0x49,0x29,0x1E};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }


        /* ---------- Letters ---------- */

        case 'O':
        {
            uint8_t a[] = {0x3E,0x41,0x41,0x41,0x3E};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case 'B':
        {
            uint8_t a[] = {0x7F,0x49,0x49,0x49,0x36};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case 'J':
        {
            uint8_t a[] = {0x20,0x40,0x41,0x3F,0x01};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case 'E':
        {
            uint8_t a[] = {0x7F,0x49,0x49,0x49,0x41};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case 'C':
        {
            uint8_t a[] = {0x3E,0x41,0x41,0x41,0x22};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case 'T':
        {
            uint8_t a[] = {0x01,0x01,0x7F,0x01,0x01};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case 'D':
        {
            uint8_t a[] = {0x7F,0x41,0x41,0x22,0x1C};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case 'N':
        {
            uint8_t a[] = {0x7F,0x02,0x0C,0x10,0x7F};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case 'I':
        {
            uint8_t a[] = {0x00,0x41,0x7F,0x41,0x00};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case 'S':
        {
            uint8_t a[] = {0x46,0x49,0x49,0x49,0x31};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case 'M':
        {
            uint8_t a[] = {0x7F,0x02,0x0C,0x02,0x7F};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case ':':
        {
            uint8_t a[] = {0x00,0x36,0x36,0x00,0x00};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case '-':
        {
            uint8_t a[] = {0x08,0x08,0x08,0x08,0x08};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case ' ':
        default:
            break;
    }

    for(uint8_t i=0;i<5;i++)
    {
        oled_data(d[i]);
    }

    oled_data(0x00);
}


void oled_string(const char *text)
{
    while(*text)
    {
        oled_char(*text++);
    }
}


void oled_number(uint16_t number)
{
    char buffer[6];
    uint8_t i = 0;

    if(number == 0)
    {
        oled_char('0');
        return;
    }

    while(number > 0 && i < 5)
    {
        buffer[i++] =
            '0' + (number % 10);

        number /= 10;
    }

    while(i > 0)
    {
        oled_char(buffer[--i]);
    }
}


/* =========================================================
   HC-SR04
   ========================================================= */

void hcsr04_init(void)
{
    /* PA0 = TRIG output */
    DDRA |= (1 << TRIG);

    /* PA1 = ECHO input */
    DDRA &= ~(1 << ECHO);

    /* Initial TRIG LOW */
    PORTA &= ~(1 << TRIG);

    /* Disable ECHO pull-up */
    PORTA &= ~(1 << ECHO);


    /*
       Timer1

       CPU = 1 MHz
       prescaler = 1

       therefore:
       1 timer tick = 1 us
    */

    TCCR1A = 0;
    TCCR1B = (1 << CS10);

    TCNT1 = 0;
}


uint16_t get_distance_cm(void)
{
    /* =====================================
       Send trigger pulse
       ===================================== */

    PORTA &= ~(1 << TRIG);

    _delay_us(3);


    PORTA |= (1 << TRIG);

    _delay_us(12);


    PORTA &= ~(1 << TRIG);


    /* =====================================
       Wait for ECHO HIGH
       ===================================== */

    TCNT1 = 0;

    while (!(PINA & (1 << ECHO)))
    {
        if (TCNT1 >= 30000)
        {
            return 999;
        }
    }


    /* =====================================
       Measure HIGH pulse
       ===================================== */

    TCNT1 = 0;

    while (PINA & (1 << ECHO))
    {
        if (TCNT1 >= 30000)
        {
            return 999;
        }
    }


    uint16_t echo_us = TCNT1;


    /*
       HC-SR04:

       distance cm ≈ echo time / 58
    */

    return echo_us / 58;
}


/* =========================================================
   MAIN
   ========================================================= */

int main(void)
{
    twi_init();

    oled_init();

    oled_clear();

    hcsr04_init();


    /*
       Static labels.
       Write them only once.
    */

    oled_cursor(0, 1);
    oled_string("STATUS:");

    oled_cursor(0, 5);
    oled_string("DIST:");

    _delay_ms(500);


    uint8_t previousObjectState = 255;


    while (1)
    {
        uint16_t distance =
            get_distance_cm();


        uint8_t objectDetected = 0;


        if (
            distance >= 2 &&
            distance <= 50
        )
        {
            objectDetected = 1;
        }


        /* =====================================
           STATUS
           Only redraw if state changes
           ===================================== */

        if (
            objectDetected !=
            previousObjectState
        )
        {
            oled_cursor(0, 3);

            if (objectDetected)
            {
                oled_string(
                    "OBJECT DETECTED      "
                );
            }
            else
            {
                oled_string(
                    "NO OBJECT            "
                );
            }

            previousObjectState =
                objectDetected;
        }


        /* =====================================
           DISTANCE
           ===================================== */

        oled_cursor(36, 5);


        if (distance == 999)
        {
            oled_string(
                "--- CM     "
            );
        }
        else
        {
            oled_number(distance);

            oled_string(
                " CM       "
            );
        }


        /*
           Do not trigger HC-SR04 too rapidly.
        */

        _delay_ms(150);
    }
}