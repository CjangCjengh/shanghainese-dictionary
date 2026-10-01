#!/usr/bin/env python3
"""Build human-readable text and a standalone static website from this repository."""
import html
import json
from pathlib import Path
import re
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def styled(runs):
    result = []
    for run in runs:
        text = run['text']
        if run.get('underline') == 2 or run.get('underline_style') == 'wavy':
            mark = '\u0330' if run.get('underline_style') == 'wavy' else '\u0333'
            text = ''.join(c + mark if not c.isspace() else c for c in text)
        value = html.escape(text).replace('\n', '<br>')
        if run.get('underline') == 1 and run.get('underline_style') != 'wavy':
            value = '<u>' + value + '</u>'
        if run.get('position') == 'subscript':
            value = '<sub>' + value + '</sub>'
        elif run.get('position') == 'superscript':
            value = '<sup>' + value + '</sup>'
        if run.get('role') == 'inline_gloss':
            value = '<small>' + value + '</small>'
        result.append(value)
    return ''.join(result)


def md_text(text):
    return html.escape(text).replace('\n', '<br>')


def render_block(block):
    if 'table' in block:
        rows = []
        for row in block['table']['rows']:
            cells = []
            for cell in row:
                attrs = ''.join(f' {key}="{cell[field]}"' for key, field in [('rowspan', 'row_span'), ('colspan', 'column_span')] if cell.get(field, 1) > 1)
                content = styled(cell['runs']) if 'runs' in cell else md_text(cell['text'])
                cells.append(f'<td{attrs}>{content}</td>')
            rows.append('<tr>' + ''.join(cells) + '</tr>')
        return '<table>\n' + '\n'.join(rows) + '\n</table>'
    content = styled(block['runs']) if 'runs' in block else md_text(block['text'])
    return ('## ' if block['kind'] in ['heading', 'title'] else '') + content


def main():
    entries = [json.loads(line) for line in (ROOT / 'data/entries.jsonl').read_text().splitlines()]
    refs = json.loads((ROOT / 'data/references.json').read_text())
    assert len({e['id'] for e in entries}) == len(entries)
    categories = list(dict.fromkeys(e['categories'][0] for e in entries))
    docs = ROOT / 'docs'
    directory = ['# 分类目录', '## 词典']
    for number, category in enumerate(categories, 1):
        filename = f'{number:02d}-{category.replace(" ", "")}.md'
        selected = [e for e in entries if e['categories'][0] == category]
        directory.append(f'- [{category}]({filename}) · {len(selected):,} 条')
        parts, subcategory = ['# ' + category], None
        for entry in selected:
            next_sub = entry['categories'][1] if len(entry['categories']) > 1 else ''
            if next_sub != subcategory:
                subcategory = next_sub
                parts.append('## ' + subcategory)
            parts.append(f'<a id="{entry["id"]}"></a>\n\n### ' + html.escape(entry['headword']))
            if entry['pronunciation']['text']:
                parts.append(styled(entry['pronunciation']['runs']))
            if entry['text']:
                parts.append(styled(entry['body_runs']) if 'body_runs' in entry else md_text(entry['text']))
        (docs / filename).write_text('\n\n'.join(parts) + '\n')
    directory.append('\n## 说明与附录')
    for ref in refs:
        filename = ref['title'] + '.md'
        directory.append(f'- [{ref["title"]}]({filename})')
        blocks = ref['blocks']
        if blocks and blocks[0]['text'] == ref['title']:
            blocks = blocks[1:]
        (docs / filename).write_text('# ' + ref['title'] + '\n\n' + '\n\n'.join(map(render_block, blocks)) + '\n')
    (docs / '目录.md').write_text('\n\n'.join(directory) + '\n')
    site = ROOT / '_site'
    if site.exists():
        shutil.rmtree(site)
    shutil.copytree(ROOT / 'site', site)
    shutil.copytree(ROOT / 'data', site / 'data')
    shutil.copytree(docs, site / 'docs')
    (site / '.nojekyll').touch()
    with zipfile.ZipFile(site / '上海话大词典.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for directory in ['data', 'docs']:
            for path in sorted((ROOT / directory).iterdir()):
                if path.is_file():
                    archive.write(path, path.relative_to(ROOT))
    print(f'已生成 {len(entries):,} 条词条、{len(refs)} 篇资料与网站。')


if __name__ == '__main__':
    main()
