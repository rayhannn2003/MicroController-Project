#include "config.h"
#include "timebase.h"
#include "twi.h"
#include "oled.h"

/* OLED-only hardware check. No motor or sensor code is linked. */
int main(void)
{
    timebase_init();
    twi_init();
    oled_init();
    oled_set_line(0, "HELLO");

    for (;;) {
        oled_service(timebase_millis());
    }
}
