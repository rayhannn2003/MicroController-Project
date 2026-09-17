#define F_CPU 1000000UL

#include <avr/io.h>
#include <avr/interrupt.h>
#include <util/delay.h>
#include <stdint.h>

/* =========================================================
   PROJECT SYLVAN
   Sensor integration test

   HC-SR04:
       TRIG -> PA0
       ECHO -> PA1

   DHT11:
       DATA -> PA3

   OLED + BH1750:
       SCL -> PC0
       SDA -> PC1

   ATmega32A @ 1 MHz
   ========================================================= */

#define OLED_ADDR       0x3C
#define BH1750_ADDR     0x23

#define TRIG            PA0
#define ECHO            PA1

#define DHT_DDR         DDRA
#define DHT_PORT        PORTA
#define DHT_PIN         PINA
#define DHT_BIT         PA3


/* =========================================================
   TWI / I2C
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

    twi_write(0x00);
    twi_write(command);

    twi_stop();
}


void oled_data(uint8_t data)
{
    if (!twi_start(OLED_ADDR << 1))
        return;

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


void oled_cursor(
    uint8_t x,
    uint8_t page
)
{
    oled_command(
        0xB0 | page
    );

    oled_command(
        0x00 | (x & 0x0F)
    );

    oled_command(
        0x10 | (x >> 4)
    );
}


void oled_clear(void)
{
    for (
        uint8_t page = 0;
        page < 8;
        page++
    )
    {
        oled_cursor(
            0,
            page
        );

        for (
            uint8_t x = 0;
            x < 128;
            x++
        )
        {
            oled_data(0x00);
        }
    }
}


/* =========================================================
   FONT
   ========================================================= */

void oled_char(char c)
{
    uint8_t d[5] =
    {
        0,0,0,0,0
    };


    switch(c)
    {
        /* Numbers */

        case '0':
        {
            uint8_t a[] =
                {0x3E,0x51,0x49,0x45,0x3E};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '1':
        {
            uint8_t a[] =
                {0x00,0x42,0x7F,0x40,0x00};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '2':
        {
            uint8_t a[] =
                {0x42,0x61,0x51,0x49,0x46};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '3':
        {
            uint8_t a[] =
                {0x21,0x41,0x45,0x4B,0x31};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '4':
        {
            uint8_t a[] =
                {0x18,0x14,0x12,0x7F,0x10};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '5':
        {
            uint8_t a[] =
                {0x27,0x45,0x45,0x45,0x39};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '6':
        {
            uint8_t a[] =
                {0x3C,0x4A,0x49,0x49,0x30};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '7':
        {
            uint8_t a[] =
                {0x01,0x71,0x09,0x05,0x03};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '8':
        {
            uint8_t a[] =
                {0x36,0x49,0x49,0x49,0x36};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '9':
        {
            uint8_t a[] =
                {0x06,0x49,0x49,0x29,0x1E};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }


        /* Letters */

        case 'T':
        {
            uint8_t a[] =
                {0x01,0x01,0x7F,0x01,0x01};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'H':
        {
            uint8_t a[] =
                {0x7F,0x08,0x08,0x08,0x7F};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'L':
        {
            uint8_t a[] =
                {0x7F,0x40,0x40,0x40,0x40};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'D':
        {
            uint8_t a[] =
                {0x7F,0x41,0x41,0x22,0x1C};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'O':
        {
            uint8_t a[] =
                {0x3E,0x41,0x41,0x41,0x3E};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'B':
        {
            uint8_t a[] =
                {0x7F,0x49,0x49,0x49,0x36};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'J':
        {
            uint8_t a[] =
                {0x20,0x40,0x41,0x3F,0x01};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'E':
        {
            uint8_t a[] =
                {0x7F,0x49,0x49,0x49,0x41};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'C':
        {
            uint8_t a[] =
                {0x3E,0x41,0x41,0x41,0x22};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'N':
        {
            uint8_t a[] =
                {0x7F,0x02,0x0C,0x10,0x7F};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'M':
        {
            uint8_t a[] =
                {0x7F,0x02,0x0C,0x02,0x7F};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'X':
        {
            uint8_t a[] =
                {0x63,0x14,0x08,0x14,0x63};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case 'R':
        {
            uint8_t a[] =
                {0x7F,0x09,0x19,0x29,0x46};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }


        /* Symbols */

        case ':':
        {
            uint8_t a[] =
                {0x00,0x36,0x36,0x00,0x00};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '%':
        {
            uint8_t a[] =
                {0x63,0x13,0x08,0x64,0x63};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

            break;
        }

        case '-':
        {
            uint8_t a[] =
                {0x08,0x08,0x08,0x08,0x08};

            for(uint8_t i=0;i<5;i++)
                d[i]=a[i];

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


void oled_string(
    const char *text
)
{
    while(*text)
    {
        oled_char(
            *text++
        );
    }
}


void oled_number(
    uint16_t number
)
{
    char buffer[6];

    uint8_t i = 0;


    if(number == 0)
    {
        oled_char('0');

        return;
    }


    while(
        number > 0 &&
        i < 5
    )
    {
        buffer[i++] =
            '0' +
            (number % 10);

        number /= 10;
    }


    while(i > 0)
    {
        oled_char(
            buffer[--i]
        );
    }
}


/* =========================================================
   DHT11 TIMER0
   ========================================================= */

void dht_timer_init(void)
{
    /*
       1 MHz
       prescaler = 1

       1 Timer0 count ≈ 1 us
    */

    TCCR0 =
        (1 << CS00);

    TCNT0 = 0;
}


uint8_t dht_wait_level(
    uint8_t level,
    uint8_t timeout
)
{
    TCNT0 = 0;


    while(1)
    {
        uint8_t current =
            (DHT_PIN &
             (1 << DHT_BIT))
            ? 1
            : 0;


        if(current == level)
            return 1;


        if(TCNT0 >= timeout)
            return 0;
    }
}


/*
   Returns:

   0 = success
   1..5 = error
*/

uint8_t dht11_read(
    uint8_t *temperature,
    uint8_t *humidity
)
{
    uint8_t data[5] =
    {
        0,0,0,0,0
    };


    uint8_t oldSREG =
        SREG;


    cli();


    /* Start signal */

    DHT_DDR |=
        (1 << DHT_BIT);


    DHT_PORT &=
        ~(1 << DHT_BIT);


    _delay_ms(20);


    DHT_PORT |=
        (1 << DHT_BIT);


    _delay_us(30);


    /* Release bus */

    DHT_DDR &=
        ~(1 << DHT_BIT);


    DHT_PORT |=
        (1 << DHT_BIT);


    /* DHT response */

    if(!dht_wait_level(0,120))
    {
        SREG = oldSREG;
        return 1;
    }


    if(!dht_wait_level(1,120))
    {
        SREG = oldSREG;
        return 2;
    }


    if(!dht_wait_level(0,120))
    {
        SREG = oldSREG;
        return 3;
    }


    /* Read 40 bits */

    for(
        uint8_t i=0;
        i<40;
        i++
    )
    {
        if(
            !dht_wait_level(
                1,
                100
            )
        )
        {
            SREG = oldSREG;
            return 4;
        }


        TCNT0 = 0;


        while(
            DHT_PIN &
            (1 << DHT_BIT)
        )
        {
            if(
                TCNT0 >= 120
            )
            {
                SREG = oldSREG;
                return 4;
            }
        }


        uint8_t highTime =
            TCNT0;


        data[i / 8] <<= 1;


        if(highTime > 45)
        {
            data[i / 8] |= 1;
        }
    }


    uint8_t checksum =
          data[0]
        + data[1]
        + data[2]
        + data[3];


    if(
        checksum !=
        data[4]
    )
    {
        SREG = oldSREG;

        return 5;
    }


    *humidity =
        data[0];


    *temperature =
        data[2];


    SREG = oldSREG;


    return 0;
}


/* =========================================================
   BH1750
   ========================================================= */

uint8_t bh1750_init(void)
{
    /* Power ON */

    if(
        !twi_start(
            BH1750_ADDR << 1
        )
    )
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


    /*
       Continuous High Resolution mode
    */

    if(
        !twi_start(
            BH1750_ADDR << 1
        )
    )
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


    _delay_ms(200);


    return 1;
}


uint8_t bh1750_read_lux(
    uint16_t *lux
)
{
    uint8_t high;
    uint8_t low;


    if(
        !twi_start(
            (BH1750_ADDR << 1)
            | 1
        )
    )
    {
        twi_stop();

        return 0;
    }


    if(
        !twi_read_ack(
            &high
        )
    )
    {
        twi_stop();

        return 0;
    }


    if(
        !twi_read_nack(
            &low
        )
    )
    {
        twi_stop();

        return 0;
    }


    twi_stop();


    uint16_t raw =
        ((uint16_t)high << 8)
        | low;


    /*
       lux ≈ raw / 1.2
    */

    *lux =
        ((uint32_t)raw * 5UL)
        / 6UL;


    return 1;
}


/* =========================================================
   HC-SR04
   ========================================================= */

void hcsr04_init(void)
{
    /* PA0 = TRIG */

    DDRA |=
        (1 << TRIG);


    PORTA &=
        ~(1 << TRIG);


    /* PA1 = ECHO */

    DDRA &=
        ~(1 << ECHO);


    PORTA &=
        ~(1 << ECHO);


    /*
       Timer1
       1 MHz, prescaler 1
       1 tick = 1 us
    */

    TCCR1A = 0;

    TCCR1B =
        (1 << CS10);

    TCNT1 = 0;
}


uint16_t get_distance_cm(void)
{
    /* Trigger */

    PORTA &=
        ~(1 << TRIG);


    _delay_us(3);


    PORTA |=
        (1 << TRIG);


    _delay_us(12);


    PORTA &=
        ~(1 << TRIG);


    /* Wait for ECHO */

    TCNT1 = 0;


    while(
        !(PINA & (1 << ECHO))
    )
    {
        if(TCNT1 >= 30000)
        {
            return 999;
        }
    }


    /* Measure HIGH */

    TCNT1 = 0;


    while(
        PINA & (1 << ECHO)
    )
    {
        if(TCNT1 >= 30000)
        {
            return 999;
        }
    }


    uint16_t echo_us =
        TCNT1;


    return echo_us / 58;
}


/* =========================================================
   MAIN
   ========================================================= */

int main(void)
{
    uint8_t temperature = 0;
    uint8_t humidity = 0;

    uint16_t lux = 0;
    uint16_t distance = 999;


    /* I2C */

    twi_init();


    /* OLED */

    oled_init();

    oled_clear();


    /* DHT11 timing */

    dht_timer_init();


    /* HC-SR04 */

    hcsr04_init();


    /*
       Give DHT11 time after power-up.
    */

    _delay_ms(2000);


    uint8_t bh_ok =
        bh1750_init();


    while(1)
    {
        /* =====================================
           DHT11
           ===================================== */

        uint8_t dht_error =
            dht11_read(
                &temperature,
                &humidity
            );


        /* =====================================
           BH1750
           ===================================== */

        uint8_t light_ok = 0;


        if(bh_ok)
        {
            light_ok =
                bh1750_read_lux(
                    &lux
                );
        }


        if(!light_ok)
        {
            bh_ok =
                bh1750_init();
        }


        /* =====================================
           HC-SR04
           ===================================== */

        distance =
            get_distance_cm();


        /* =====================================
           TEMPERATURE
           ===================================== */

        oled_cursor(
            0,
            0
        );


        oled_string("T:");


        if(dht_error == 0)
        {
            oled_number(
                temperature
            );

            oled_string(
                "C       "
            );
        }
        else
        {
            oled_string(
                "ERR     "
            );
        }


        /* =====================================
           HUMIDITY
           ===================================== */

        oled_cursor(
            0,
            2
        );


        oled_string("H:");


        if(dht_error == 0)
        {
            oled_number(
                humidity
            );

            oled_string(
                "%       "
            );
        }
        else
        {
            oled_string(
                "ERR     "
            );
        }


        /* =====================================
           LIGHT
           ===================================== */

        oled_cursor(
            0,
            4
        );


        oled_string("L:");


        if(light_ok)
        {
            oled_number(
                lux
            );

            oled_string(
                "LX      "
            );
        }
        else
        {
            oled_string(
                "ERR     "
            );
        }


        /* =====================================
           DISTANCE + OBJECT
           ===================================== */

        oled_cursor(
            0,
            6
        );


        oled_string("D:");


        if(distance == 999)
        {
            oled_string(
                "---CM NO OBJECT   "
            );
        }
        else
        {
            oled_number(
                distance
            );

            oled_string(
                "CM "
            );


            if(
                distance >= 2 &&
                distance <= 30
            )
            {
                oled_string(
                    "OBJECT   "
                );
            }
            else
            {
                oled_string(
                    "NO OBJECT"
                );
            }
        }


        /*
           DHT11 is deliberately sampled slowly.
        */

        _delay_ms(2000);
    }
}