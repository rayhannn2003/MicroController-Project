#include "config.h"
#include "dht11.h"
#include <avr/io.h>
#include <avr/interrupt.h>
#include <util/delay.h>

#define DHT_DDR DDRA
#define DHT_PORT PORTA
#define DHT_PIN PINA
#define DHT_BIT DHT11_PIN

/* The original transaction is retained; Timer2 replaces Timer0 at 1 us/tick. */
static void dht_timer_init(void)
{
    /*
       1 MHz
       prescaler = 1

       1 Timer2 count ≈ 1 us
    */

    TCCR2 =
        (1 << CS20);

    TCNT2 = 0;
}


static uint8_t dht_wait_level(
    uint8_t level,
    uint8_t timeout
)
{
    TCNT2 = 0;


    while(1)
    {
        uint8_t current =
            (DHT_PIN &
             (1 << DHT_BIT))
            ? 1
            : 0;


        if(current == level)
            return 1;


        if(TCNT2 >= timeout)
            return 0;
    }
}


/*
   Returns:

   0 = success
   1..5 = error
*/

static uint8_t read_sample(
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


        TCNT2 = 0;


        while(
            DHT_PIN &
            (1 << DHT_BIT)
        )
        {
            if(
                TCNT2 >= 120
            )
            {
                SREG = oldSREG;
                return 4;
            }
        }


        uint8_t highTime =
            TCNT2;


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



void dht11_init(void)
{
    DHT_DDR &= (uint8_t)~(1 << DHT_BIT);
    DHT_PORT |= (1 << DHT_BIT);
}

uint8_t dht11_read(uint8_t *temperature, uint8_t *humidity)
{
    dht_timer_init();
    uint8_t result = read_sample(temperature, humidity);
    TCCR2 = 0;
    return result;
}
