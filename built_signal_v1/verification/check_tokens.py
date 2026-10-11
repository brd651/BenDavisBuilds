#!/usr/bin/env python3
"""Built Signal color-pair checks. No third-party dependencies.

Runs checks only on declared semantic token pairs, not a complete WCAG audit.
"""
from __future__ import annotations
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / 'design/built-signal.tokens.json').read_text())
CSS = (ROOT / 'design/built-signal.tokens.css').read_text()


def luminance(value: str) -> float:
    if not re.fullmatch(r'#[0-9a-fA-F]{6}', value):
        raise ValueError(f'Invalid color: {value}')
    rgb = [int(value[n:n + 2], 16) / 255 for n in (1, 3, 5)]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]


def contrast(a: str, b: str) -> float:
    x, y = sorted((luminance(a), luminance(b)), reverse=True)
    return (x + .05) / (y + .05)


checks = []
for mode in ('light', 'dark'):
    tokens = DATA[mode]
    for bg in ('page', 'surface', 'raised'):
        for fg, target in (('text', 4.5), ('muted', 4.5), ('accentText', 4.5), ('border', 3), ('focus', 3)):
            ratio = contrast(tokens[fg], tokens[bg])
            checks.append((mode, f'{fg} on {bg}', ratio, target, ratio >= target))
            if f'--bs-{fg}: {tokens[fg]};' not in CSS or f'--bs-{bg}: {tokens[bg]};' not in CSS:
                raise RuntimeError(f'{mode} CSS values not found for {fg}/{bg}')
    ratio = contrast(tokens['text'], tokens['page'])
    checks.append((mode, 'body text on page (internal AAA target)', ratio, 7, ratio >= 7))
    ratio = contrast(tokens['onAction'], tokens['action'])
    checks.append((mode, 'primary button label', ratio, 4.5, ratio >= 4.5))
    for key, value in tokens.items():
        if f'--bs-{key}: {value};' not in CSS:
            raise RuntimeError(f'{mode}: missing CSS value for {key}={value}')

failed = [row for row in checks if not row[4]]
for mode, label, ratio, target, passed in checks:
    print(f'{"PASS" if passed else "FAIL"} {mode:5s} {label:38s} {ratio:5.2f}:1 (>= {target}:1)')
print(f'\n{sum(v[4] for v in checks)}/{len(checks)} declared checks pass')
if DATA['themeDefault'] != 'dark':
    raise RuntimeError('Built Signal MUST default to dark mode')
if DATA['logo']['internalSignalWire'] is not False or DATA['logo']['internalNodes'] is not False:
    raise RuntimeError('Logo must not have wires or nodes')
if failed:
    raise SystemExit(1)
