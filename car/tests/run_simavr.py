#!/usr/bin/env python3
"""Optional AVR instruction tests; requires libsimavr development files."""
from pathlib import Path
import os
import shlex
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
include = os.environ.get('SIMAVR_INCLUDE_DIR')
library = os.environ.get('SIMAVR_LIB_DIR')
if include and library:
    flags = ['-I'+include, '-L'+library, '-Wl,-rpath,'+library, '-lsimavr']
else:
    try:
        flags = shlex.split(subprocess.check_output(
            ['pkg-config', '--cflags', '--libs', 'simavr'], text=True))
    except (OSError, subprocess.CalledProcessError):
        raise SystemExit('Install libsimavr-dev and pkg-config, or set '
                         'SIMAVR_INCLUDE_DIR and SIMAVR_LIB_DIR.')
with tempfile.TemporaryDirectory(prefix='sylvan-simavr-') as tmp:
    binary = str(Path(tmp)/'integration')
    subprocess.run(['cc', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
                    str(root/'tests/simavr_integration.c'), *flags,
                    '-o', binary], check=True)
    for args in [[], ['sweep'], ['sweep', 'nodht']]:
        subprocess.run([binary, str(root/'.build/stage6/main.elf'), *args], check=True)
