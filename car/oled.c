#include "config.h"
#include "oled.h"
#include "twi.h"
#include "timebase.h"
#include <string.h>
#include <avr/pgmspace.h>

/* Additional lowercase glyphs for the sampling messages; original glyphs below
 * are retained byte for byte. Keep this table in flash, not the 2 KB SRAM. */
static const uint8_t lowercase_font[26][5] PROGMEM = {
    {0x20,0x54,0x54,0x54,0x78}, /* a */
    {0x7f,0x48,0x44,0x44,0x38}, /* b */
    {0x38,0x44,0x44,0x44,0x20}, /* c */
    {0x38,0x44,0x44,0x48,0x7f}, /* d */
    {0x38,0x54,0x54,0x54,0x18}, /* e */
    {0x08,0x7e,0x09,0x01,0x02}, /* f */
    {0x0c,0x52,0x52,0x52,0x3e}, /* g */
    {0x7f,0x08,0x04,0x04,0x78}, /* h */
    {0x00,0x44,0x7d,0x40,0x00}, /* i */
    {0x20,0x40,0x44,0x3d,0x00}, /* j */
    {0x7f,0x10,0x28,0x44,0x00}, /* k */
    {0x00,0x41,0x7f,0x40,0x00}, /* l */
    {0x7c,0x04,0x18,0x04,0x78}, /* m */
    {0x7c,0x08,0x04,0x04,0x78}, /* n */
    {0x38,0x44,0x44,0x44,0x38}, /* o */
    {0x7c,0x14,0x14,0x14,0x08}, /* p */
    {0x08,0x14,0x14,0x18,0x7c}, /* q */
    {0x7c,0x08,0x04,0x04,0x08}, /* r */
    {0x48,0x54,0x54,0x54,0x20}, /* s */
    {0x04,0x3f,0x44,0x40,0x20}, /* t */
    {0x3c,0x40,0x40,0x20,0x7c}, /* u */
    {0x1c,0x20,0x40,0x20,0x1c}, /* v */
    {0x3c,0x40,0x30,0x40,0x3c}, /* w */
    {0x44,0x28,0x10,0x28,0x44}, /* x */
    {0x0c,0x50,0x50,0x50,0x3c}, /* y */
    {0x44,0x64,0x54,0x4c,0x44}  /* z */
};

/* Original initialization, page mode and font from lightTemSr.c. */
static const uint8_t init_commands[] = {
    0xAE,0xD5,0x80,0xA8,0x3F,0xD3,0x00,0x40,0x8D,0x14,
    0x20,0x02,0xA1,0xC8,0xDA,0x12,0x81,0x7F,0xD9,0xF1,
    0xDB,0x40,0xA4,0xA6,0xAF
};
static char desired[OLED_ROWS][OLED_COLUMNS];
static char active[OLED_COLUMNS];
static uint8_t dirty, row, next_row, page, column, cursor_step, init_index;
static uint32_t retry_at;
static enum { OLED_WAIT, OLED_INIT, OLED_CLEAR_CURSOR, OLED_CLEAR_DATA,
              OLED_IDLE, OLED_TEXT_CURSOR, OLED_TEXT_DATA } state;

static uint8_t oled_begin(uint8_t control)
{
    if (!twi_start(OLED_ADDR << 1) || !twi_write(control)) {
        twi_stop();
        return 0;
    }
    return 1;
}

static uint8_t oled_command(uint8_t command)
{
    if (!oled_begin(0x00)) return 0;
    if (!twi_write(command)) { twi_stop(); return 0; }
    return twi_stop();
}

static uint8_t oled_bytes(const uint8_t *data, uint8_t length)
{
    if (!oled_begin(0x40)) return 0;
    for (uint8_t i = 0; i < length; i++) {
        if (!twi_write(data[i])) { twi_stop(); return 0; }
    }
    return twi_stop();
}

/* One of the three original page/column commands per service call. */
static uint8_t oled_cursor_part(uint8_t target_page)
{
    uint8_t command = cursor_step == 0 ? (0xB0 | target_page) :
                      cursor_step == 1 ? 0x00 : 0x10;
    return oled_command(command);
}

static void oled_glyph(char c, uint8_t d[5])
{
    memset(d, 0, 5);
    if (c >= 'a' && c <= 'z') {
        for (uint8_t i = 0; i < 5; i++) d[i] = pgm_read_byte(&lowercase_font[c - 'a'][i]);
        return;
    }
    switch(c)
    {
        case 'S':
        {
            uint8_t a[] = {0x46,0x49,0x49,0x49,0x31};
            for(uint8_t i=0;i<5;i++) d[i]=a[i];
            break;
        }
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


}

void oled_init(void)
{
    memset(desired, ' ', sizeof(desired));
    dirty = 0x0f;
    next_row = 0;
    retry_at = timebase_millis() + 100U;
    state = OLED_WAIT;
}

void oled_set_line(uint8_t index, const char *text)
{
    if (index >= OLED_ROWS) return;
    char padded[OLED_COLUMNS];
    uint8_t i = 0;
    while (i < OLED_COLUMNS && *text) padded[i++] = *text++;
    while (i < OLED_COLUMNS) padded[i++] = ' ';
    if (memcmp(desired[index], padded, OLED_COLUMNS)) {
        memcpy(desired[index], padded, OLED_COLUMNS);
        dirty |= (1 << index);
    }
}

void oled_service(uint32_t now)
{
    uint8_t bytes[6] = {0,0,0,0,0,0};
    uint8_t length;
    switch (state) {
    case OLED_WAIT:
        if ((int32_t)(now - retry_at) < 0) return;
        init_index = 0;
        state = OLED_INIT;
        return;
    case OLED_INIT:
        if (!oled_command(init_commands[init_index])) goto failed;
        if (++init_index == sizeof(init_commands)) {
            page = column = cursor_step = 0;
            state = OLED_CLEAR_CURSOR;
        }
        return;
    case OLED_CLEAR_CURSOR:
        if (!oled_cursor_part(page)) goto failed;
        if (++cursor_step == 3) state = OLED_CLEAR_DATA;
        return;
    case OLED_CLEAR_DATA:
        length = (128U - column) < 6U ? (128U - column) : 6U;
        if (!oled_bytes(bytes, length)) goto failed;
        column += length;
        if (column == 128) {
            column = cursor_step = 0;
            state = ++page == 8 ? OLED_IDLE : OLED_CLEAR_CURSOR;
            if (state == OLED_IDLE) dirty = 0x0f;
        }
        return;
    case OLED_IDLE:
        if (!dirty) return;
        for (uint8_t i = 0; i < OLED_ROWS; i++) {
            row = (next_row + i) % OLED_ROWS;
            if (dirty & (1 << row)) break;
        }
        next_row = (row + 1) % OLED_ROWS;
        memcpy(active, desired[row], OLED_COLUMNS);
        dirty &= (uint8_t)~(1 << row);
        column = cursor_step = 0;
        state = OLED_TEXT_CURSOR;
        return;
    case OLED_TEXT_CURSOR:
        if (!oled_cursor_part(row * 2)) goto failed;
        if (++cursor_step == 3) state = OLED_TEXT_DATA;
        return;
    case OLED_TEXT_DATA:
        oled_glyph(active[column], bytes);
        if (!oled_bytes(bytes, 6)) goto failed;
        if (++column == OLED_COLUMNS) state = OLED_IDLE;
        return;
    }
    return;
failed:
    dirty = 0x0f;
    retry_at = timebase_millis() + PERIPHERAL_RETRY_MS;
    state = OLED_WAIT;
}
