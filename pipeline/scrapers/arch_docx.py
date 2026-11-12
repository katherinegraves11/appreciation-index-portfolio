#!/usr/bin/env python3
"""Rebuild the Word copy of ARCHITECTURE.md on Katie's Desktop (she reads .docx, not Markdown). Run after every edit."""
import re, docx
from docx.shared import Pt
src = open('/Users/katiegraves/Desktop/Fashion Data Lab/ARCHITECTURE.md').read().split('\n')
d = docx.Document(); st = d.styles['Normal']; st.font.name = 'Calibri'; st.font.size = Pt(11)
def runs(p, text):
    for part in re.split(r'(\*\*[^*]+\*\*)', text):
        if part.startswith('**') and part.endswith('**'): p.add_run(part[2:-2]).bold = True
        elif part: p.add_run(part)
i = 0
while i < len(src):
    l = src[i]
    if l.startswith('# '): d.add_heading(l[2:], 0)
    elif l.startswith('## '): d.add_heading(l[3:], 1)
    elif l.startswith('### '): d.add_heading(l[4:], 2)
    elif l.startswith('|'):
        rows = []
        while i < len(src) and src[i].startswith('|'):
            if not re.match(r'^\|[-| ]+\|$', src[i]): rows.append([c.strip() for c in src[i].strip('|').split('|')])
            i += 1
        t = d.add_table(rows=len(rows), cols=len(rows[0])); t.style = 'Light Grid Accent 1'
        for r, row in enumerate(rows):
            for c, val in enumerate(row):
                cell = t.cell(r, c); cell.text = ''; runs(cell.paragraphs[0], val)
        continue
    elif re.match(r'^\s*\d+\.\s', l):
        p = d.add_paragraph(style='List Number 2' if l.startswith('   ') else 'List Number'); runs(p, re.sub(r'^\s*\d+\.\s', '', l))
    elif re.match(r'^\s*-\s', l):
        p = d.add_paragraph(style='List Bullet 2' if l.startswith('   ') else 'List Bullet'); runs(p, re.sub(r'^\s*-\s', '', l))
    elif l.strip():
        p = d.add_paragraph(); runs(p, l)
    i += 1
d.save('/Users/katiegraves/Desktop/Appreciation Index Architecture.docx'); print('docx updated')
