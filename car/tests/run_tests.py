#!/usr/bin/env python3
"""Compare the modular controller with an oracle extracted from untouched lfr.c."""
from pathlib import Path
import hashlib
import re
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
source = (root / 'lfr.c').read_text()
for line in (root / 'references/SHA256SUMS').read_text().splitlines():
    digest, name = line.split()
    assert hashlib.sha256((root/name).read_bytes()).hexdigest() == digest, name + ' changed'

def function(name, source=source):
    start = source.index(name + '(')
    start = source.rfind('\n', 0, start) + 1
    brace = source.index('{', start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]

original_config = (root/'references/config.h.original').read_text()
new_config = (root/'config.h').read_text()
defines = lambda text: dict(re.findall(r'^#define\s+(\w+)[ \t]+([^\n]+)', text, re.M))
for name, value in defines(original_config).items():
    assert defines(new_config)[name] == value, name + ' tuning changed'
sensor_source = (root/'lightTemSr.c').read_text()
dht_source = (root/'dht11.c').read_text()
for original, extracted in [('dht_wait_level', 'dht_wait_level'), ('dht11_read', 'read_sample')]:
    old = function(original, sensor_source).split('{', 1)[1].replace('TCNT0', 'TCNT2')
    new = function(extracted, dht_source).split('{', 1)[1]
    assert old == new, original + ' transaction changed'
glyphs = lambda text: re.findall(r"case '(.)':\s*\{\s*uint8_t a\[\] =\s*\{([^}]+)\}", text)
current_glyphs = dict(glyphs((root/'oled.c').read_text()))
for char, bitmap in glyphs(sensor_source):
    assert current_glyphs[char] == bitmap, 'original font changed: ' + char

helpers = '\n'.join(function(n) for n in [
    'percentToPWM', 'setSpeed', 'setMotorPattern', 'moveForward', 'moveBackward',
    'pivotLeft', 'pivotRight', 'brakeMotors', 'stopMotors'])
for reg in ['PORTB', 'OCR1A', 'OCR1B']:
    helpers = helpers.replace(reg, 'ref_' + reg)
constants = '\n'.join(line for line in source.splitlines() if line.startswith('#define MOTOR_') or line.startswith('#define PWM_TOP'))
states = source[source.index('typedef enum'):source.index('// =====================================================\n// MAIN')]
body = source[source.index('        // =================================================\n        // NORMAL LINE FOLLOWING'):]
body = body[:body.rfind('\n    }\n}')].replace('continue;', 'return;')
oracle = '''#include <stdint.h>
#include "config.h"
uint8_t ref_PORTB;
uint16_t ref_OCR1A, ref_OCR1B;
''' + constants + '\n' + helpers + '\n' + states + '''
static uint8_t previousLeftBlack, previousRightBlack, firstOffSensor, lastTurn, starting;
static uint32_t stateStartTime;
static RobotState state;
void reference_init(uint32_t now) {
    ref_PORTB = 0xa0;
    stopMotors();
    firstOffSensor = SENSOR_NONE;
    lastTurn = TURN_NONE;
    state = STATE_STOP;
    stateStartTime = now;
    starting = 1;
}
void reference_step(uint32_t now, uint8_t leftBlack, uint8_t rightBlack) {
    if (starting) {
        stopMotors();
        if ((uint32_t)(now-stateStartTime) < START_DELAY_MS) return;
        starting = 0;
        state = STATE_FOLLOW;
        previousLeftBlack = leftBlack;
        previousRightBlack = rightBlack;
    }
''' + body + '\n}\n'
with tempfile.TemporaryDirectory(prefix='sylvan-tests-') as tmp:
    tmp = Path(tmp)
    (tmp/'reference.c').write_text(oracle)
    subprocess.run(['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-O2',
        '-I'+str(root/'tests/fake_avr'), '-I'+str(root), str(tmp/'reference.c'),
        *[str(root/n) for n in ['tests/registers.c','tests/test_line_follow.c',
                               'motor.c','line_sensor.c','line_follow.c']],
        '-o', str(tmp/'line_follow')], check=True)
    subprocess.run([str(tmp/'line_follow')], check=True)
    subprocess.run(['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-O2',
        '-I'+str(root/'tests/fake_avr'), '-I'+str(root), *[str(root/n) for n in
        ['tests/test_i2c_clients.c', 'bh1750.c', 'oled.c']],
        '-o', str(tmp/'i2c_clients')], check=True)
    subprocess.run([str(tmp/'i2c_clients')], check=True)
    subprocess.run(['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-O2',
        '-I'+str(root), str(root/'tests/test_sample_cycle.c'),
        str(root/'sample_cycle.c'), '-o', str(tmp/'sample_cycle')], check=True)
    subprocess.run([str(tmp/'sample_cycle')], check=True)
    subprocess.run(['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-O2',
        '-DINTEGRATION_STAGE=6', '-I'+str(root),
        str(root/'tests/test_sampling_main.c'), str(root/'sample_cycle.c'),
        '-o', str(tmp/'sampling_main')], check=True)
    for arguments in [[], ['bad-dht'], ['missing-light']]:
        subprocess.run([str(tmp/'sampling_main'), *arguments], check=True)
print('PASS: both reference source hashes unchanged.')
