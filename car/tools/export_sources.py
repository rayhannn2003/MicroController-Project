#!/usr/bin/env python3
"""Export complete modular sources without duplicating the two references."""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
modules = ['motor', 'line_sensor', 'line_follow', 'sample_cycle', 'timebase', 'twi', 'oled',
           'bh1750', 'dht11', 'hcsr04', 'uart']
files = ['main.c', 'oled_debug.c', 'config.h']
for module in modules:
    files.extend([module+'.c', module+'.h'])
files.append('Makefile')
files.extend(str(path.relative_to(root)) for path in sorted((root/'tests').rglob('*'))
             if path.suffix in {'.c', '.h', '.py'})
files.append('tools/export_sources.py')
parts = ['# Complete modular source files\n\n'
         'Generated with `make source-bundle`. See [INTEGRATION.md](INTEGRATION.md) '
         'for conflicts, timer ownership, commands and hardware checks. '
         '`lfr.c` and `lightTemSr.c` remain separate, unchanged references.\n']
for name in files:
    path = root/name
    language = 'makefile' if name == 'Makefile' else 'python' if path.suffix == '.py' else 'c'
    parts.append(f'\n## {name}\n\n```{language}\n{path.read_text().rstrip()}\n```\n')
destination = root/'SOURCE_BUNDLE.md'
destination.write_text(''.join(parts))
print(f'Wrote {destination.name}: {len(files)} complete files.')
