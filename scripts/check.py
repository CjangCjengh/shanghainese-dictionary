#!/usr/bin/env python3
"""Validate dictionary data without network access or third-party dependencies."""
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PROHIBITED = {'source', 'additional_sources', 'pdf_page', 'printed_page', 'bbox', 'crop', 'review', 'issues', 'editorial_notes', 'source_crop'}


def validate_tree(value):
    if isinstance(value, dict):
        assert not PROHIBITED.intersection(value), f'Unexpected internal fields: {PROHIBITED.intersection(value)}'
        for child in value.values():
            validate_tree(child)
    elif isinstance(value, list):
        for child in value:
            validate_tree(child)
    elif isinstance(value, str):
        assert not re.search(r'shh-p\d{4}|source/(?:pages|entries)/|/home/|gh[pousr]_[A-Za-z0-9]{20,}', value), 'Unexpected internal reference'


def check_runs(runs, text):
    assert ''.join(r['text'] for r in runs) == (text or '')
    for run in runs:
        assert run['position'] in ['baseline', 'subscript', 'superscript']
        assert run['underline'] in [0, 1, 2]


def main():
    entries = [json.loads(line) for line in (ROOT / 'data/entries.jsonl').read_text().splitlines()]
    refs = json.loads((ROOT / 'data/references.json').read_text())
    metadata = json.loads((ROOT / 'data/metadata.json').read_text())
    assert len(entries) == metadata['entry_count']
    assert len(refs) == metadata['reference_count']
    assert len({e['id'] for e in entries}) == len(entries)
    assert len({r['id'] for r in refs}) == len(refs)
    for entry in entries:
        validate_tree(entry)
        assert re.fullmatch(r'e[0-9a-f]{12}', entry['id'])
        assert entry['headword'] and entry['categories']
        check_runs(entry['pronunciation']['runs'], entry['pronunciation']['text'])
        for runs, text in [('headword_runs', 'headword'), ('body_runs', 'text')]:
            if runs in entry:
                check_runs(entry[runs], entry[text])
    for ref in refs:
        validate_tree(ref)
        for block in ref['blocks']:
            if 'runs' in block:
                check_runs(block['runs'], block['text'])
            if 'table' in block:
                for row in block['table']['rows']:
                    for cell in row:
                        if 'runs' in cell:
                            check_runs(cell['runs'], cell['text'])
                        assert cell.get('row_span', 1) >= 1 and cell.get('column_span', 1) >= 1
    validate_tree(metadata)
    print(f'通过：{len(entries):,} 条词条、{len(refs)} 篇资料，标识、分段与字段检查。')


if __name__ == '__main__':
    main()
