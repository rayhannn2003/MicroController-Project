#define F_CPU 1000000UL

#include <avr/io.h>
#include <avr/interrupt.h>
#include <util/delay.h>
#include <stdint.h>

/* =========================================================
   PROJECT SYLVAN
   ATmega32A @ 1 MHz

   OLED:
       SCL -> PC0
       SDA -> PC1

   BH1750:
       SCL  -> PC0
       SDA  -> PC1
       ADDR -> GND

   DHT11:
       DATA -> PA3
   ========================================================= */

#define OLED_ADDR       0x3C
#define BH1750_ADDR     0x5C

#define DHT_DDR         DDRA
#define DHT_PORT        PORTA
#define DHT_PIN         PINA
#define DHT_BIT         PA3


/* =========================================================
   I2C / TWI
   ========================================================= */

uint8_t twi_wait(void)
{
    uint16_t timeout = 5000;

    while (!(TWCR & (1 << TWINT)))
    {
        if (--timeout == 0)
            return 0;
    }

    return 1;
}


void twi_init(void)
{
    /*
       F_CPU = 1 MHz
       TWBR = 2

       SCL ≈ 50 kHz
    */

    TWSR = 0x00;
    TWBR = 2;

    TWCR = (1 << TWEN);
}


uint8_t twi_start(uint8_t address)
{
    /* Send START */

    TWCR =
        (1 << TWINT) |
        (1 << TWSTA) |
        (1 << TWEN);

    if (!twi_wait())
        return 0;


    uint8_t status = TWSR & 0xF8;

    if (status != 0x08 && status != 0x10)
        return 0;


    /* Send slave address */

    TWDR = address;

    TWCR =
        (1 << TWINT) |
        (1 << TWEN);

    if (!twi_wait())
        return 0;


    status = TWSR & 0xF8;


    if ((address & 1) == 0)
    {
        /* SLA+W ACK */

        if (status != 0x18)
            return 0;
    }
    else
    {
        /* SLA+R ACK */

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


    if ((TWSR & 0xF8) != 0x28)
        return 0;


    return 1;
}


uint8_t twi_read_ack(uint8_t *data)
{
    TWCR =
        (1 << TWINT) |
        (1 << TWEN) |
        (1 << TWEA);

    if (!twi_wait())
        return 0;


    *data = TWDR;

    return 1;
}


uint8_t twi_read_nack(uint8_t *data)
{
    TWCR =
        (1 << TWINT) |
        (1 << TWEN);

    if (!twi_wait())
        return 0;


    *data = TWDR;

    return 1;
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
    if (!twi_start(OLED_ADDR << 1))
        return;

    if (!twi_write(0x00))
    {
        twi_stop();
        return;
    }

    twi_write(command);

    twi_stop();
}


void oled_data(uint8_t data)
{
    if (!twi_start(OLED_ADDR << 1))
        return;

    if (!twi_write(0x40))
    {
        twi_stop();
        return;
    }

    twi_write(data);

    twi_stop();
}


void oled_init(void)
{
    _delay_ms(100);

    oled_command(0xAE);    // Display OFF

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
    oled_command(0x02);    // Page addressing mode

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

    oled_command(0xAF);    // Display ON
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
   SMALL FONT
   ========================================================= */

void oled_char(char c)
{
    uint8_t d[5] = {0,0,0,0,0};

    switch(c)
    {
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


        case 'T':
        {
            uint8_t a[] = {0x01,0x01,0x7F,0x01,0x01};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case 'H':
        {
            uint8_t a[] = {0x7F,0x08,0x08,0x08,0x7F};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case 'L':
        {
            uint8_t a[] = {0x7F,0x40,0x40,0x40,0x40};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case 'C':
        {
            uint8_t a[] = {0x3E,0x41,0x41,0x41,0x22};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case 'E':
        {
            uint8_t a[] = {0x7F,0x49,0x49,0x49,0x41};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case 'R':
        {
            uint8_t a[] = {0x7F,0x09,0x19,0x29,0x46};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case 'l':
        {
            uint8_t a[] = {0x00,0x41,0x7F,0x40,0x00};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case 'x':
        {
            uint8_t a[] = {0x44,0x28,0x10,0x28,0x44};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case ':':
        {
            uint8_t a[] = {0x00,0x36,0x36,0x00,0x00};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }

        case '%':
        {
            uint8_t a[] = {0x63,0x13,0x08,0x64,0x63};
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


    for(uint8_t i=0; i<5; i++)
        oled_data(d[i]);

    oled_data(0x00);
}


void oled_string(const char *s)
{
    while(*s)
        oled_char(*s++);
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
        buffer[i++] = '0' + (number % 10);

        number /= 10;
    }


    while(i > 0)
    {
        oled_char(buffer[--i]);
    }
}


/* =========================================================
   BH1750
   ========================================================= */

uint8_t bh1750_init(void)
{
    /* Power ON */

    if(!twi_start(BH1750_ADDR << 1))
    {
        twi_stop();
        return 0;
    }

    if(!twi_write(0x01))
    {
        twi_stop();
        return 0;
    }

    twi_stop();

    _delay_ms(10);


    /* Continuous High Resolution mode */

    if(!twi_start(BH1750_ADDR << 1))
    {
        twi_stop();
        return 0;
    }

    if(!twi_write(0x10))
    {
        twi_stop();
        return 0;
    }

    twi_stop();


    /*
       First high-resolution measurement
       requires roughly 120-180 ms.
    */

    _delay_ms(200);

    return 1;
}


uint8_t bh1750_read_lux(uint16_t *lux)
{
    uint8_t high;
    uint8_t low;


    if(!twi_start((BH1750_ADDR << 1) | 1))
    {
        twi_stop();
        return 0;
    }


    if(!twi_read_ack(&high))
    {
        twi_stop();
        return 0;
    }


    if(!twi_read_nack(&low))
    {
        twi_stop();
        return 0;
    }


    twi_stop();


    uint16_t raw =
        ((uint16_t)high << 8) | low;


    /*
       BH1750:
       lux = raw / 1.2

       raw / 1.2 == raw * 5 / 6
    */

    *lux = ((uint32_t)raw * 5UL) / 6UL;


    return 1;
}


/* =========================================================
   TIMER0 FOR DHT11
   ========================================================= */

void dht_timer_init(void)
{
    /*
       ATmega32A = 1 MHz

       Timer0 prescaler = 1

       1 timer count ≈ 1 microsecond
    */

    TCCR0 = (1 << CS00);

    TCNT0 = 0;
}


/* =========================================================
   DHT11
   ========================================================= */

/*
   Wait until DHT line becomes requested level.

   level = 0 -> LOW
   level = 1 -> HIGH

   timeout approximately in microseconds.
*/

uint8_t dht_wait_level(uint8_t level,
                       uint8_t timeout)
{
    TCNT0 = 0;


    while(1)
    {
        uint8_t current =
            (DHT_PIN & (1 << DHT_BIT)) ? 1 : 0;


        if(current == level)
            return 1;


        if(TCNT0 >= timeout)
            return 0;
    }
}


/*
   Return codes:

   0 = success
   1 = sensor did not respond
   2 = sensor LOW response problem
   3 = sensor HIGH response problem
   4 = data bit timing problem
   5 = checksum error
*/

uint8_t dht11_read(uint8_t *temperature,
                   uint8_t *humidity)
{
    uint8_t data[5] =
    {
        0,0,0,0,0
    };


    uint8_t old_sreg = SREG;


    /*
       Timing is critical.
       Disable interrupts temporarily.
    */

    cli();


    /* =====================================================
       HOST START SIGNAL
       ===================================================== */


    /*
       Set DATA pin as output.
    */

    DHT_DDR |= (1 << DHT_BIT);


    /*
       Pull DATA LOW for at least 18 ms.
    */

    DHT_PORT &= ~(1 << DHT_BIT);

    _delay_ms(20);


    /*
       Pull HIGH briefly.
    */

    DHT_PORT |= (1 << DHT_BIT);

    _delay_us(30);


    /*
       Release DATA line.

       Input mode.
    */

    DHT_DDR &= ~(1 << DHT_BIT);


    /*
       Enable internal pull-up.

       External 4.7k-10k pull-up
       is still recommended.
    */

    DHT_PORT |= (1 << DHT_BIT);


    /* =====================================================
       SENSOR RESPONSE
       ===================================================== */


    /*
       Sensor should pull LOW.
    */

    if(!dht_wait_level(0, 120))
    {
        SREG = old_sreg;
        return 1;
    }


    /*
       Sensor LOW ~80 us,
       then goes HIGH.
    */

    if(!dht_wait_level(1, 120))
    {
        SREG = old_sreg;
        return 2;
    }


    /*
       Sensor HIGH ~80 us,
       then starts first data bit LOW.
    */

    if(!dht_wait_level(0, 120))
    {
        SREG = old_sreg;
        return 3;
    }


    /* =====================================================
       RECEIVE 40 BITS
       ===================================================== */

    for(uint8_t i=0; i<40; i++)
    {
        /*
           Each data bit starts with
           approximately 50 us LOW.

           Wait until HIGH begins.
        */

        if(!dht_wait_level(1, 100))
        {
            SREG = old_sreg;
            return 4;
        }


        /*
           Measure duration of HIGH pulse.

           ~26-28 us = 0
           ~70 us    = 1
        */

        TCNT0 = 0;


        while(DHT_PIN & (1 << DHT_BIT))
        {
            if(TCNT0 >= 120)
            {
                SREG = old_sreg;
                return 4;
            }
        }


        uint8_t high_time = TCNT0;


        /*
           Prepare bit position.
        */

        data[i / 8] <<= 1;


        /*
           Anything well above 28 us
           should be logical 1.

           45 us provides a safe midpoint.
        */

        if(high_time > 45)
        {
            data[i / 8] |= 1;
        }
    }


    /* =====================================================
       CHECKSUM
       ===================================================== */

    uint8_t checksum =
        data[0] +
        data[1] +
        data[2] +
        data[3];


    if(checksum != data[4])
    {
        SREG = old_sreg;
        return 5;
    }


    /*
       DHT11:
       data[0] = humidity integer
       data[1] = humidity decimal
       data[2] = temperature integer
       data[3] = temperature decimal
    */

    *humidity    = data[0];
    *temperature = data[2];


    /*
       Restore interrupt state.
    */

    SREG = old_sreg;


    return 0;
}


/* =========================================================
   OLED ERROR DISPLAY
   ========================================================= */

void display_error(uint8_t error)
{
    oled_char('E');
    oled_number(error);

    oled_string("    ");
}


/* =========================================================
   MAIN
   ========================================================= */

int main(void)
{
    uint8_t temperature = 0;
    uint8_t humidity = 0;

    uint16_t lux = 0;


    /* Initialize I2C */

    twi_init();


    /* Timer0 used for DHT timing */

    dht_timer_init();


    /* OLED */

    oled_init();

    oled_clear();


    /* Static labels */

    oled_cursor(0, 0);
    oled_string("T:");


    oled_cursor(0, 2);
    oled_string("H:");


    oled_cursor(0, 4);
    oled_string("L:");


    /*
       Give DHT11 enough time
       after power-up.
    */

    _delay_ms(2000);


    /*
       Initialize BH1750.
    */

    uint8_t bh_ok = bh1750_init();


    /* =====================================================
       MAIN LOOP
       ===================================================== */

    while(1)
    {
        /* =============================================
           DHT11
           ============================================= */

        uint8_t dht_error =
            dht11_read(
                &temperature,
                &humidity
            );


        /* Temperature */

        oled_cursor(18, 0);


        if(dht_error == 0)
        {
            oled_number(temperature);

            oled_char('C');

            oled_string("    ");
        }
        else
        {
            display_error(dht_error);
        }


        /* Humidity */

        oled_cursor(18, 2);


        if(dht_error == 0)
        {
            oled_number(humidity);

            oled_char('%');

            oled_string("    ");
        }
        else
        {
            display_error(dht_error);
        }


        /* =============================================
           BH1750
           ============================================= */

        oled_cursor(18, 4);


        if(bh_ok)
        {
            if(bh1750_read_lux(&lux))
            {
                oled_number(lux);

                oled_char(' ');

                oled_char('l');

                oled_char('x');

                oled_string("    ");
            }
            else
            {
                oled_string("ERR   ");

                bh_ok = 0;
            }
        }
        else
        {
            oled_string("ERR   ");


            /*
               Retry initialization.
            */

            bh_ok = bh1750_init();
        }


        /*
           DHT11 should not be sampled rapidly.
        */

        _delay_ms(2000);
    }
}