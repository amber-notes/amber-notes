#!/usr/bin/env python3
"""Checks the App Store field limits in docs/appstore/metadata.md."""
import re, sys
text = open('docs/appstore/metadata.md').read()
def field(label):
    m = re.search(r'\| ' + re.escape(label) + r' \| (.+?) \|', text)
    return m.group(1).strip() if m else ''
def block(title):
    m = re.search(r'\*\*' + re.escape(title) + r'\*\*[^\n]*\n\n```\n(.*?)\n```', text, re.S)
    return m.group(1) if m else ''
checks = [('Name', field('Name'), 30), ('Subtitle', field('Subtitle'), 30),
          ('Promotional text', block('Promotional text'), 170), ('Description', block('Description:'), 4000),
          ('Keywords', block('Keywords'), 100), ('Review notes', block('Notes for the reviewer:'), 4000)]
bad = False
for name, value, limit in checks:
    ok = 0 < len(value) <= limit
    bad |= not ok
    print(f"{'ok ' if ok else 'BAD'} {name}: {len(value)}/{limit}")
if ', ' in block('Keywords'): print('BAD Keywords: remove spaces after commas'); bad = True
sys.exit(1 if bad else 0)
