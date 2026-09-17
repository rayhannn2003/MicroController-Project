#define F_CPU 1000000UL

#include <avr/io.h>
#include <avr/interrupt.h>
#include <util/delay.h>
#include <util/twi.h>
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

   UART to ESP32-CAM (9600 8N1, transmit only):
       PD1/TXD -> 1k -> GPIO14/RX, with 2k from GPIO14 to GND
       Common GND; PD0/RXD is unused
   ========================================================= */

/* Build this same standalone source for each diagnostic phase.
   1: scan only; 2: BH1750 + OLED; 3: DHT11 + BH1750 + OLED (default).
   BH1750 uses 0x23; OLED uses 0x3C. DHT11 stays on PA3.
   See BH1750_DEBUG.md for build/flash commands and screen explanations. */
#define MODE_SCANNER     1
#define MODE_BH1750      2
#define MODE_INTEGRATED  3
#ifndef APP_MODE
#define APP_MODE MODE_INTEGRATED
#endif
#if APP_MODE < MODE_SCANNER || APP_MODE > MODE_INTEGRATED
#error "APP_MODE must be 1 (scanner), 2 (BH1750), or 3 (integrated)"
#endif

/* Set to 1 (or build with -DUART_DEBUG=1) to send BOOT\n once.
   UART is used only in the integrated mode. */
#ifndef UART_DEBUG
#define UART_DEBUG 0
#endif
#if UART_DEBUG != 0 && UART_DEBUG != 1
#error "UART_DEBUG must be 0 or 1"
#endif

#define OLED_ADDR       0x3C
#define BH1750_ADDR_LOW 0x23
#define BH1750_ADDR_HIGH 0x5C
/* Scanner-confirmed address. Override with 0 to probe LOW, then HIGH. */
#ifndef BH1750_ADDR
#define BH1750_ADDR     0x23
#endif
#if BH1750_ADDR != 0 && BH1750_ADDR != 0x23 && BH1750_ADDR != 0x5C
#error "BH1750_ADDR must be 0 (auto), 0x23, or 0x5C"
#endif

#define DHT_DDR         DDRA
#define DHT_PORT        PORTA
#define DHT_PIN         PINA
#define DHT_BIT         PA3


/* =========================================================
   HARDWARE UART (PD1/TXD)
   ========================================================= */

void uart_init(void)
{
    UCSRB = 0;
    UCSRA = (1 << U2X);
    /* 1 MHz / (8 * (12 + 1)) = 9615 baud, nominal 9600. */
    UBRRH = 0;  /* URSEL = 0 selects UBRRH at the shared address. */
    UBRRL = 12;
    /* Asynchronous, 8 data bits, no parity, one stop bit. */
    UCSRC = (1 << URSEL) | (1 << UCSZ1) | (1 << UCSZ0);
    /* TXEN makes PD1 a UART output. RX and UART interrupts stay disabled. */
    UCSRB = (1 << TXEN);
}


void uart_send_char(char c)
{
    while (!(UCSRA & (1 << UDRE)))
    {
        /* Hardware UART runs independently of Timer0 and interrupts. */
    }
    UDR = (uint8_t)c;
}


void uart_send_string(const char *str)
{
    while (*str)
        uart_send_char(*str++);
}


void uart_send_uint(uint16_t value)
{
    char digits[5];  /* uint16_t needs at most five decimal digits. */
    uint8_t count = 0;

    do
    {
        digits[count++] = '0' + (value % 10);
        value /= 10;
    } while (value);

    while (count)
        uart_send_char(digits[--count]);
}


void send_sensor_packet(uint8_t temperature, uint8_t humidity, uint16_t lux)
{
    uart_send_string("<S,T=");
    uart_send_uint(temperature);
    uart_send_string(",H=");
    uart_send_uint(humidity);
    uart_send_string(",L=");
    uart_send_uint(lux);
    uart_send_string(">\n");
}


/* =========================================================
   I2C / TWI
   ========================================================= */

/* Software status values cannot collide with masked hardware TWSR codes.
   Bounded polling uses no timers, so Timer0 remains dedicated to DHT11. */
#define TWI_TIMEOUT       0xFF
#define TWI_STOP_TIMEOUT  0xFE
#define TWI_BUS_STUCK     0xFD
#define TWI_WAIT_POLLS    1000U
#define TWI_PINS          ((1 << PC0) | (1 << PC1))

uint8_t twi_status = TW_NO_INFO;
uint8_t twi_cleanup_status = TW_NO_INFO;

uint8_t twi_wait(void)
{
    uint16_t timeout = TWI_WAIT_POLLS;

    while (!(TWCR & (1 << TWINT)))
    {
        if (--timeout == 0)
        {
            twi_status = TWI_TIMEOUT;
            return 0;
        }
        _delay_us(10);
    }

    twi_status = TW_STATUS;
    return 1;
}


void twi_init(void)
{
    /* Use the modules' external pull-ups; never drive either line HIGH. */
    DDRC &= ~TWI_PINS;
    PORTC &= ~TWI_PINS;
    TWSR = 0;
    TWBR = 2;            /* 1 MHz / (16 + 2*2) = 50 kHz. */
    TWCR = (1 << TWEN);
}


uint8_t twi_wait_high(uint8_t pins)
{
    uint16_t timeout = TWI_WAIT_POLLS;

    while ((PINC & pins) != pins)
    {
        if (--timeout == 0)
            return 0;
        _delay_us(10);
    }
    return 1;
}


uint8_t twi_recover(void)
{
    /* Single-master bus recovery only. Hardware TWI does all transfers.
       Release SDA, clock at most nine bits, then generate a STOP.
       DDR switching provides open-drain LOW/release, never push-pull HIGH. */
    uint8_t released = 0;
    TWCR = 0;
    DDRC &= ~TWI_PINS;
    PORTC &= ~TWI_PINS;

    if (!twi_wait_high(1 << PC0))
        goto done;

    for (uint8_t i = 0; i < 9 && !(PINC & (1 << PC1)); i++)
    {
        DDRC |= (1 << PC0);
        _delay_us(10);
        DDRC &= ~(1 << PC0);
        if (!twi_wait_high(1 << PC0))
            goto done;
        _delay_us(10);
    }

    DDRC |= (1 << PC0);
    DDRC |= (1 << PC1);
    _delay_us(10);
    DDRC &= ~(1 << PC0);
    if (!twi_wait_high(1 << PC0))
        goto done;
    _delay_us(10);
    DDRC &= ~(1 << PC1);
    _delay_us(10);
    released = twi_wait_high(TWI_PINS);

done:
    twi_init();
    return released;
}


uint8_t twi_stop(void)
{
    uint16_t timeout = TWI_WAIT_POLLS;
    TWCR = (1 << TWINT) | (1 << TWEN) | (1 << TWSTO);

    /* STOP clears TWSTO, not TWINT. Finish before the next transaction. */
    while (TWCR & (1 << TWSTO))
    {
        if (--timeout == 0)
        {
            twi_status = TWI_STOP_TIMEOUT;
            twi_recover();
            return 0;
        }
        _delay_us(10);
    }
    _delay_us(5);
    if (!twi_wait_high(TWI_PINS))
    {
        twi_status = TWI_BUS_STUCK;
        twi_recover();
        return 0;
    }
    return 1;
}


void twi_abort(void)
{
    /* Preserve the failing stage's status across STOP/recovery/OLED work. */
    uint8_t failed_status = twi_status;
    uint8_t stopped = twi_stop();
    twi_cleanup_status = stopped ? TW_NO_INFO : twi_status;
    if (stopped && failed_status != TW_MT_SLA_NACK &&
        failed_status != TW_MR_SLA_NACK && failed_status != TW_MT_DATA_NACK)
    {
        if (!twi_recover())
            twi_cleanup_status = TWI_BUS_STUCK;
    }
    twi_status = failed_status;
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


    if (twi_status != TW_START && twi_status != TW_REP_START)
        return 0;


    /* Send slave address */

    TWDR = address;

    TWCR =
        (1 << TWINT) |
        (1 << TWEN);

    if (!twi_wait())
        return 0;


    if ((address & 1) == 0)
    {
        /* SLA+W ACK */

        if (twi_status != TW_MT_SLA_ACK)
            return 0;
    }
    else
    {
        /* SLA+R ACK */

        if (twi_status != TW_MR_SLA_ACK)
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


    if (twi_status != TW_MT_DATA_ACK)
        return 0;


    return 1;
}


uint8_t twi_read_ack(uint8_t *data)
{
    TWCR =
        (1 << TWINT) |
        (1 << TWEN) |
        (1 << TWEA);

    if (!twi_wait() || twi_status != TW_MR_DATA_ACK)
        return 0;


    *data = TWDR;

    return 1;
}


uint8_t twi_read_nack(uint8_t *data)
{
    TWCR =
        (1 << TWINT) |
        (1 << TWEN);

    if (!twi_wait() || twi_status != TW_MR_DATA_NACK)
        return 0;


    *data = TWDR;

    return 1;
}


/* =========================================================
   OLED
   ========================================================= */

/* Suppress the rest of a frame after an OLED fault. The next frame retries
   initialization, rather than spending one timeout on every font pixel. */
uint8_t oled_ready = 0;

uint8_t oled_begin(uint8_t control)
{
    if (!oled_ready)
        return 0;
    if (!twi_start(OLED_ADDR << 1) || !twi_write(control))
    {
        twi_abort();
        oled_ready = 0;
        return 0;
    }
    return 1;
}


void oled_send(uint8_t control, uint8_t data)
{
    if (!oled_begin(control))
        return;
    if (!twi_write(data))
    {
        twi_abort();
        oled_ready = 0;
        return;
    }
    oled_ready = twi_stop();
}


void oled_command(uint8_t command)
{
    oled_send(0x00, command);
}


void oled_data(uint8_t data)
{
    oled_send(0x40, data);
}


void oled_init(void)
{
    _delay_ms(100);
    oled_ready = 1;

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
        if (!oled_begin(0x40))
            return;
        for (uint8_t x = 0; x < 128; x++)
        {
            if (!twi_write(0x00))
            {
                twi_abort();
                oled_ready = 0;
                return;
            }
        }
        oled_ready = twi_stop();
    }
}


void oled_frame(void)
{
    if (!oled_ready)
        oled_init();
    oled_clear();
}


/* =========================================================
   SMALL FONT
   ========================================================= */

void oled_char(char c)
{
    uint8_t d[5] = {0,0,0,0,0};

    switch(c)
    {
        case 'A':
        {
            uint8_t a[] = {0x7E,0x11,0x11,0x11,0x7E};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }
        case 'B':
        {
            uint8_t a[] = {0x7F,0x49,0x49,0x49,0x36};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }
        case 'D':
        {
            uint8_t a[] = {0x7F,0x41,0x41,0x22,0x1C};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }
        case 'F':
        {
            uint8_t a[] = {0x7F,0x09,0x09,0x09,0x01};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }
        case 'I':
        {
            uint8_t a[] = {0x00,0x41,0x7F,0x41,0x00};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }
        case 'N':
        {
            uint8_t a[] = {0x7F,0x02,0x04,0x08,0x7F};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }
        case 'O':
        {
            uint8_t a[] = {0x3E,0x41,0x41,0x41,0x3E};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }
        case 'S':
        {
            uint8_t a[] = {0x46,0x49,0x49,0x49,0x31};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }
        case 'U':
        {
            uint8_t a[] = {0x3F,0x40,0x40,0x40,0x3F};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }
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

enum
{
    BH_OK = 0,
    BH_ADDRESS = 1,
    BH_POWER = 2,
    BH_MODE = 3,
    BH_READ_ADDRESS = 4,
    BH_READ_HIGH = 5,
    BH_READ_LOW = 6,
    BH_STOP = 7
};

uint8_t bh1750_address = 0;
uint8_t bh1750_status = TW_NO_INFO;
uint16_t bh1750_raw = 0;

uint8_t bh1750_fail(uint8_t error)
{
    bh1750_status = twi_status;
    twi_abort();
    return error;
}


uint8_t bh1750_detect(void)
{
#if BH1750_ADDR == 0
    const uint8_t candidates[] = {BH1750_ADDR_LOW, BH1750_ADDR_HIGH};
#else
    const uint8_t candidates[] = {BH1750_ADDR};
#endif
    bh1750_address = 0;

    for (uint8_t i = 0; i < sizeof(candidates); i++)
    {
        if (twi_start(candidates[i] << 1))
        {
            bh1750_address = candidates[i];
            if (!twi_stop())
            {
                bh1750_status = twi_status;
                return BH_STOP;
            }
            return BH_OK;
        }

        uint8_t status = twi_status;
        bh1750_fail(BH_ADDRESS);
        if (twi_cleanup_status != TW_NO_INFO)
        {
            bh1750_status = twi_cleanup_status;
            return BH_STOP;
        }
        /* Only an address NACK justifies trying another address. Do not
           hide a timeout/START/bus fault behind a later probe's result. */
        if (status != TW_MT_SLA_NACK)
            return BH_ADDRESS;
    }
    return BH_ADDRESS;
}


uint8_t bh1750_command(uint8_t command, uint8_t error)
{
    if (!twi_start(bh1750_address << 1) || !twi_write(command))
        return bh1750_fail(error);
    /* The BH1750 requires a separate STOP after each command opcode. */
    if (!twi_stop())
    {
        bh1750_status = twi_status;
        return BH_STOP;
    }
    return BH_OK;
}


uint8_t bh1750_init(void)
{
    uint8_t error = bh1750_detect();
    if (error)
        return error;

    error = bh1750_command(0x01, BH_POWER);
    if (error)
        return error;
    _delay_ms(10);

    error = bh1750_command(0x10, BH_MODE);
    if (error)
        return error;

    /* Default measurement time: 120 ms typical, 180 ms maximum. */
    _delay_ms(200);
    return BH_OK;
}


uint8_t bh1750_read_lux(uint16_t *lux)
{
    uint8_t high;
    uint8_t low;

    if (!twi_start((bh1750_address << 1) | 1))
        return bh1750_fail(BH_READ_ADDRESS);
    if (!twi_read_ack(&high))
        return bh1750_fail(BH_READ_HIGH);
    if (!twi_read_nack(&low))
        return bh1750_fail(BH_READ_LOW);
    if (!twi_stop())
    {
        bh1750_status = twi_status;
        return BH_STOP;
    }

    bh1750_raw = ((uint16_t)high << 8) | low;
    *lux = ((uint32_t)bh1750_raw * 5UL) / 6UL;
    bh1750_status = TW_MR_DATA_NACK;
    return BH_OK;
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
   DIAGNOSTIC SCREENS / MAIN
   ========================================================= */

void oled_hex(uint8_t value)
{
    const char digits[] = "0123456789ABCDEF";
    oled_string("0x");
    oled_char(digits[value >> 4]);
    oled_char(digits[value & 0x0F]);
}


void scanner_run(void)
{
    /* All 112 normal addresses fit; no silently truncated results. */
    uint8_t found[0x77 - 0x08 + 1];

    while (1)
    {
        uint8_t count = 0;
        uint8_t errors = 0;
        uint8_t first_status = TW_NO_INFO;
        uint8_t first_address = 0;

        /* No OLED traffic while probing; each probe ends in STOP. */
        for (uint8_t address = 0x08; address <= 0x77; address++)
        {
            uint8_t ack = twi_start(address << 1);
            uint8_t status = twi_status;
            uint8_t fault = 0;

            if (ack)
            {
                found[count++] = address;
                if (!twi_stop())
                {
                    status = twi_status;
                    fault = 1;
                }
            }
            else
            {
                twi_abort();
                fault = (status != TW_MT_SLA_NACK);
                if (twi_cleanup_status != TW_NO_INFO)
                {
                    /* Keep the original fault unless it was just NACK. */
                    if (!fault)
                        status = twi_cleanup_status;
                    fault = 1;
                }
            }

            if (fault)
            {
                if (errors == 0)
                {
                    first_status = status;
                    first_address = address;
                }
                errors++;
            }
        }

        /* Cycle every ACK, then rescan so wiring changes need no reset.
           N = ACK count. E = bus-fault count (ordinary NACK is normal).
           On a fault, S and A show its first status and probe address. */
        uint8_t screens = count ? count : 1;
        for (uint8_t i = 0; i < screens; i++)
        {
            oled_frame();
            oled_cursor(0, 0);
            oled_string(count ? "I2C FOUND" : "I2C NONE");
            oled_cursor(0, 2);
            if (count)
            {
                oled_hex(found[i]);
                oled_char(' ');
                oled_number(found[i]);
            }
            oled_cursor(0, 4);
            oled_string("N:");
            oled_number(count);
            oled_string(" E:");
            oled_number(errors);
            if (errors)
            {
                oled_cursor(0, 6);
                oled_string("S:");
                oled_hex(first_status);
                oled_string(" A:");
                oled_hex(first_address);
            }
            _delay_ms(1000);
        }
    }
}


void display_light(uint16_t lux, uint8_t error, uint8_t page)
{
    oled_cursor(0, page);
    oled_string("L:");
    if (error)
        display_error(error);
    else
    {
        oled_number(lux);
        oled_string(" lx");
    }
}


void display_bh_status(uint8_t error, uint8_t page)
{
    oled_cursor(0, page);
    oled_string("A:");
    if (bh1750_address)
        oled_hex(bh1750_address);
    else
        oled_string("--");
    if (error)
    {
        oled_string(" S:");
        oled_hex(bh1750_status);
    }
}


int main(void)
{
#if APP_MODE == MODE_INTEGRATED
    uart_init();
#if UART_DEBUG
    uart_send_string("BOOT\n");
#endif
#endif

    twi_init();
    twi_recover();
    oled_init();
    oled_clear();

#if APP_MODE == MODE_SCANNER
    /* Phase 1 never sends BH1750 commands or samples DHT11. */
    scanner_run();
#else
    uint16_t lux = 0;
    uint8_t bh_ready = 0;

#if APP_MODE == MODE_INTEGRATED
    uint8_t temperature = 0;
    uint8_t humidity = 0;
    dht_timer_init();
    _delay_ms(2000);
#endif

    while (1)
    {
#if APP_MODE == MODE_INTEGRATED
        /* DHT timing completes before any I2C or UART transmission. */
        uint8_t dht_error = dht11_read(&temperature, &humidity);
#endif
        uint8_t bh_error = BH_OK;
        if (!bh_ready)
        {
            bh_error = bh1750_init();
            bh_ready = (bh_error == BH_OK);
        }
        if (bh_ready)
        {
            bh_error = bh1750_read_lux(&lux);
            if (bh_error)
                bh_ready = 0;  /* Probe and initialize again next sample. */
        }

#if APP_MODE == MODE_BH1750
        /* Phase 2 uses only the BH1750 and the OLED. */
        oled_frame();
        oled_cursor(0, 0);
        oled_string("BH1750");
        display_light(lux, bh_error, 2);
        oled_cursor(0, 4);
        oled_string("R:");
        if (bh_error)
            oled_string("--");
        else
            oled_number(bh1750_raw);
        display_bh_status(bh_error, 6);
        _delay_ms(1000);
#else
        /* Complete sensor transactions before drawing the next frame. */
        oled_frame();
        oled_cursor(0, 0);
        oled_string("T:");
        if (dht_error == 0)
        {
            oled_number(temperature);
            oled_char('C');
        }
        else
            display_error(dht_error);

        oled_cursor(0, 2);
        oled_string("H:");
        if (dht_error == 0)
        {
            oled_number(humidity);
            oled_char('%');
        }
        else
            display_error(dht_error);

        display_light(lux, bh_error, 4);
        if (bh_error)
            display_bh_status(bh_error, 6);

        /* Send the same fresh values shown on the OLED. Skip this sample
           if either sensor failed, even if previous values are retained. */
        if (dht_error == 0 && bh_error == BH_OK)
            send_sensor_packet(temperature, humidity, lux);

        _delay_ms(2000);
#endif
    }
#endif
}
