'use strict';

const $ = id => document.getElementById(id);
const REPOSITORY = 'https://github.com/CjangCjengh/shanghainese-dictionary';
const BATCH_SIZE = 50;
const STORAGE_PREFIX = 'shanghainese-dictionary:';
let entries = [], references = [], byId = new Map(), categories = [];
let filtered = [], selected = null, reportTarget = null, timer, toastTimer;
let state = {view: 'dictionary', q: '', scope: 'all', match: 'contains', category: '', subcategory: '', batch: 0, entry: '', reference: ''};
const favorites = new Set(readStorage('favorites', []).filter(x => typeof x === 'string'));
let readingSize = Math.max(16, Math.min(26, Number(readStorage('reading-size', 19)) || 19));
document.documentElement.style.setProperty('--reading-size', `${readingSize}px`);

function readStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_PREFIX + key));
    return value === null || (Array.isArray(fallback) && !Array.isArray(value)) ? fallback : value;
  } catch { return fallback; }
}
function saveStorage(key, value) {
  try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); return true; }
  catch { toast('浏览器未允许保存；本次操作仅在当前页面有效。'); return false; }
}
function node(tag, text, className) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
}
function button(text, onClick, className) {
  const b = node('button', text, className); b.type = 'button'; b.addEventListener('click', onClick); return b;
}
function fold(text) { return (text || '').normalize('NFC').toLowerCase().replace(/\s+/gu, ''); }
function ipaFold(text) {
  const subs = '₀₁₂₃₄₅₆₇₈₉';
  return fold(text).replace(/[₀-₉]/gu, x => String(subs.indexOf(x))).replace(/g/gu, 'ɡ').replace(/[ˈ'’ʰ]/gu, '‘');
}
function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
}
function renderRuns(parent, runs) {
  for (const run of runs) {
    const tag = run.position === 'subscript' ? 'sub' : run.position === 'superscript' ? 'sup' : 'span';
    const span = node(tag, run.text);
    if (run.underline) {
      span.style.textDecorationLine = 'underline';
      span.style.textDecorationStyle = run.underline_style === 'wavy' ? 'wavy' : run.underline === 2 ? 'double' : 'solid';
      span.style.textUnderlineOffset = '.12em';
    }
    if (run.role === 'inline_gloss') span.classList.add('gloss');
    parent.append(span);
  }
}
function highlighted(parent, text, query) {
  const value = text || '', q = query.trim();
  if (!q) { parent.textContent = value; return; }
  const at = value.toLocaleLowerCase().indexOf(q.toLocaleLowerCase());
  if (at < 0) { parent.textContent = value; return; }
  parent.append(document.createTextNode(value.slice(0, at)), node('mark', value.slice(at, at + q.length)), document.createTextNode(value.slice(at + q.length)));
}
function readRoute() {
  const params = new URLSearchParams(location.hash.slice(1));
  state = {
    view: ['dictionary', 'favorites', 'references'].includes(params.get('view')) ? params.get('view') : 'dictionary',
    q: params.get('q') || '', scope: ['all', 'headword', 'ipa'].includes(params.get('scope')) ? params.get('scope') : 'all',
    match: ['contains', 'exact', 'prefix'].includes(params.get('match')) ? params.get('match') : 'contains',
    category: params.get('category') || '', subcategory: params.get('subcategory') || '',
    batch: Math.max(0, Number.parseInt(params.get('batch'), 10) || 0),
    entry: byId.has(params.get('entry')) ? params.get('entry') : '',
    reference: params.get('reference') || references[0]?.id || ''
  };
}
function route(push = false) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state)) {
    if (value && !(key === 'view' && value === 'dictionary') && !(key === 'scope' && value === 'all') && !(key === 'match' && value === 'contains') && !(key === 'reference' && state.view !== 'references')) params.set(key, value);
  }
  const hash = params.size ? '#' + params.toString() : '#';
  if (location.hash !== hash) history[push ? 'pushState' : 'replaceState'](null, '', hash);
}
function updateSubcategories() {
  const values = [...new Set(entries.filter(e => !state.category || e.categories[0] === state.category).map(e => e.categories[1]).filter(Boolean))];
  $('subcategory').replaceChildren(new Option('全部子类', ''));
  for (const v of values) $('subcategory').add(new Option(v, v));
  if (!values.includes(state.subcategory)) state.subcategory = '';
  $('subcategory').value = state.subcategory;
}
function syncControls() {
  for (const key of ['scope', 'match', 'category']) $(key).value = state[key];
  $('query').value = state.q;
  updateSubcategories();
  for (const b of document.querySelectorAll('[data-view]')) {
    if (b.dataset.view === state.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
}
function matches(haystack, needle) {
  return state.match === 'exact' ? haystack === needle : state.match === 'prefix' ? haystack.startsWith(needle) : haystack.includes(needle);
}
function runSearch() {
  const q = state.scope === 'ipa' ? ipaFold(state.q) : fold(state.q);
  filtered = entries.filter(e => {
    if (state.view === 'favorites' && !favorites.has(e.id)) return false;
    if (state.category && e.categories[0] !== state.category) return false;
    if (state.subcategory && e.categories[1] !== state.subcategory) return false;
    if (!q) return true;
    if (state.scope === 'ipa') return matches(e._ipa, q);
    if (state.scope === 'headword') return matches(e._headword, q);
    return matches(e._headword, q) || matches(e._text, q);
  });
  if (q && state.scope !== 'ipa') filtered.sort((a, b) => (b._headword === q) - (a._headword === q) || b._headword.startsWith(q) - a._headword.startsWith(q));
  state.batch = Math.min(state.batch, Math.max(0, Math.ceil(filtered.length / BATCH_SIZE) - 1));
}
function renderList() {
  $('list-heading').textContent = state.view === 'favorites' ? '我的收藏' : state.q || state.category || state.subcategory ? '查询结果' : '全部词条';
  $('favorites-hint').hidden = state.view !== 'favorites';
  $('result-count').textContent = `${filtered.length.toLocaleString('zh-CN')} 条`;
  const start = state.batch * BATCH_SIZE;
  const fragment = document.createDocumentFragment();
  if (!filtered.length) {
    const empty = node('div', undefined, 'empty');
    empty.append(node('h2', state.view === 'favorites' && favorites.size === 0 ? '还没有收藏' : '没有找到匹配的词条'), node('p', state.view === 'favorites' && favorites.size === 0 ? '打开一个词条，点“收藏”即可保存。' : '试试缩短搜索词，或重置分类与匹配方式。'));
    fragment.append(empty);
  }
  for (const entry of filtered.slice(start, start + BATCH_SIZE)) {
    const b = button('', () => selectEntry(entry.id, true), 'result');
    b.dataset.id = entry.id;
    if (selected?.id === entry.id) b.setAttribute('aria-current', 'true');
    const title = node('strong'); highlighted(title, entry.headword, state.scope === 'ipa' ? '' : state.q);
    const preview = node('span', undefined, 'snippet');
    let text = entry.text || entry.pronunciation.text || entry.categories.join(' · ');
    if (state.scope === 'ipa') text = entry.pronunciation.text || '未列读音';
    const matchAt = text.indexOf(state.q);
    if (state.q && matchAt > 35) text = '…' + text.slice(Math.max(0, matchAt - 18));
    if (text.length > 100) text = text.slice(0, 100) + '…';
    highlighted(preview, text, state.q);
    b.append(title, preview); fragment.append(b);
  }
  $('results').replaceChildren(fragment);
  const total = Math.ceil(filtered.length / BATCH_SIZE);
  $('page-count').textContent = total ? `${start + 1}–${Math.min(start + BATCH_SIZE, filtered.length)}` : '0 条';
  $('previous-page').disabled = state.batch === 0;
  $('next-page').disabled = state.batch + 1 >= total;
  $('pagination').hidden = filtered.length === 0;
}
function entryPlain(entry) {
  return [entry.headword, entry.pronunciation.text, entry.text].filter(Boolean).join('\n\n');
}
function publicEntry(entry) { return Object.fromEntries(Object.entries(entry).filter(([key]) => !key.startsWith('_'))); }
async function copy(text, message = '已复制') {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text); toast(message); return true;
  } catch {
    $('copy-text').value = text;
    if (!$('copy-dialog').open) $('copy-dialog').showModal();
    $('copy-text').focus(); $('copy-text').select(); return false;
  }
}
function permalink(entry) {
  const url = new URL(location.href); url.hash = new URLSearchParams({entry: entry.id}).toString(); return url.href;
}
function showEntry(entry) {
  selected = entry || null;
  const target = $('entry-content'); target.replaceChildren();
  if (!entry) {
    target.append(node('div', '从左侧选择词条，查看读音、释义和例句。', 'empty'));
    document.title = '上海话大词典'; return;
  }
  document.title = `${entry.headword} · 上海话大词典`;
  target.append(node('div', entry.categories.join(' / '), 'entry-category'));
  const heading = node('h2', undefined, 'entry-title'); heading.tabIndex = -1;
  if (entry.headword_runs) renderRuns(heading, entry.headword_runs); else heading.textContent = entry.headword;
  target.append(heading);
  if (entry.pronunciation.text) {
    const ipa = node('div', undefined, 'ipa'); ipa.setAttribute('aria-label', '读音');
    renderRuns(ipa, entry.pronunciation.runs); target.append(ipa);
  }
  if (entry.text) {
    const body = node('div', undefined, 'body-text');
    if (entry.body_runs) renderRuns(body, entry.body_runs); else body.textContent = entry.text;
    target.append(body);
  } else target.append(node('p', '此词条仅列读音。', 'hint'));
  const actions = node('div', undefined, 'entry-actions');
  const favorite = button(favorites.has(entry.id) ? '已收藏' : '收藏', () => {
    if (favorites.has(entry.id)) favorites.delete(entry.id); else favorites.add(entry.id);
    const saved = saveStorage('favorites', [...favorites]);
    favorite.textContent = favorites.has(entry.id) ? '已收藏' : '收藏'; favorite.setAttribute('aria-pressed', String(favorites.has(entry.id)));
    if (saved) toast(favorites.has(entry.id) ? '已加入收藏' : '已取消收藏');
    if (state.view === 'favorites') { runSearch(); renderList(); }
  }); favorite.setAttribute('aria-pressed', String(favorites.has(entry.id)));
  actions.append(favorite, button('复制词条', () => copy(entryPlain(entry))), button('复制 JSON', () => copy(JSON.stringify(publicEntry(entry), null, 2))), button('复制链接', () => copy(permalink(entry))), button('报告错误', () => openReport(entry)));
  const size = node('div', undefined, 'reading-controls');
  for (const [label, delta] of [['缩小字号', -1], ['放大字号', 1]]) size.append(button(label, () => {
    readingSize = Math.max(16, Math.min(26, readingSize + delta));
    document.documentElement.style.setProperty('--reading-size', `${readingSize}px`); saveStorage('reading-size', readingSize);
  }));
  actions.append(size); target.append(actions);
  if (entry.pronunciation.runs.some(r => r.underline)) {
    const p = node('p', '音标单下划线表示白读，双下划线表示文读。', 'hint'); p.style.marginTop = '16px'; target.append(p);
  }
}
function selectEntry(id, push = false) {
  const entry = byId.get(id); if (!entry) return;
  state.entry = id; route(push); showEntry(entry);
  for (const b of $('results').querySelectorAll('.result')) {
    if (b.dataset.id === id) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  }
  if (matchMedia('(max-width:700px)').matches) {
    document.body.classList.add('detail-open'); window.scrollTo({top: 0}); $('entry-content').querySelector('h2').focus({preventScroll: true});
  }
}
function renderReference() {
  const ref = references.find(r => r.id === state.reference) || references[0];
  state.reference = ref.id;
  $('reference-list').replaceChildren();
  for (const r of references) {
    const b = button(r.title.replace(/^附录（[一二三四]）/, ''), () => { state.reference = r.id; route(true); renderReference(); });
    if (ref.id === r.id) b.setAttribute('aria-current', 'page'); $('reference-list').append(b);
  }
  const target = $('reference-content'); target.replaceChildren(node('h1', ref.title));
  document.title = `${ref.title} · 上海话大词典`;
  for (let index = 0; index < ref.blocks.length; index++) {
    const block = ref.blocks[index];
    if (index === 0 && (block.text === ref.title || block.text === '附录' || /^（[一二三四]）/.test(block.text))) continue;
    if (block.table) {
      const wrap = node('div', undefined, 'table-wrap'); wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', ref.title + '表格，可横向滚动');
      const table = node('table');
      for (const row of block.table.rows) {
        const tr = node('tr');
        for (const cell of row) {
          const td = node('td'); td.rowSpan = cell.row_span || 1; td.colSpan = cell.column_span || 1;
          if (cell.runs) renderRuns(td, cell.runs); else td.textContent = cell.text;
          tr.append(td);
        }
        table.append(tr);
      }
      wrap.append(table); target.append(wrap);
    } else {
      const element = node(['title', 'heading'].includes(block.kind) ? 'h2' : 'p');
      if (block.runs) renderRuns(element, block.runs); else element.textContent = block.text;
      target.append(element);
    }
  }
  target.append(button('报告此处错误', () => openReport(ref), 'text-button'));
}
function render() {
  syncControls();
  const isReference = state.view === 'references';
  $('dictionary-view').hidden = isReference; $('references-view').hidden = !isReference;
  document.body.classList.toggle('detail-open', !isReference && !!state.entry);
  if (isReference) { renderReference(); return; }
  runSearch();
  showEntry(byId.get(state.entry) || filtered[state.batch * BATCH_SIZE]);
  renderList();
}
function searchChanged() {
  clearTimeout(timer);
  state.q = $('query').value; state.scope = $('scope').value; state.match = $('match').value;
  const categoryChanged = state.category !== $('category').value;
  state.category = $('category').value;
  state.subcategory = categoryChanged ? '' : $('subcategory').value;
  state.batch = 0; state.entry = '';
  route(); render(); $('results').scrollTop = 0;
}
function openReport(target) {
  reportTarget = target || {id: 'website', title: '网页问题'};
  $('report-target').textContent = reportTarget.headword || reportTarget.title;
  $('error-type').value = reportTarget.headword ? '词头' : reportTarget.blocks ? '附录' : '网页问题';
  $('error-description').value = readStorage('report:' + reportTarget.id, '');
  $('report-status').textContent = '';
  $('report-dialog').showModal(); $('error-description').focus();
}
function reportText() {
  return [
    `词条／资料：${reportTarget.headword || reportTarget.title}`,
    `标识：${reportTarget.id}`, `错误类型：${$('error-type').value}`,
    reportTarget.headword ? `当前内容：\n${entryPlain(reportTarget)}` : '',
    `错误与建议：\n${$('error-description').value.trim()}`,
    `链接：${reportTarget.headword ? permalink(reportTarget) : location.href}`
  ].filter(Boolean).join('\n\n');
}
function wireEvents() {
  $('search-form').addEventListener('submit', event => { event.preventDefault(); searchChanged(); });
  $('query').addEventListener('input', event => { if (!event.isComposing) { clearTimeout(timer); timer = setTimeout(searchChanged, 180); } });
  $('query').addEventListener('compositionend', () => { clearTimeout(timer); timer = setTimeout(searchChanged, 180); });
  for (const id of ['scope', 'match', 'category', 'subcategory']) $(id).addEventListener('change', searchChanged);
  $('clear-query').addEventListener('click', () => { $('query').value = ''; searchChanged(); $('query').focus(); });
  $('reset-filters').addEventListener('click', () => { state = {...state, scope: 'all', match: 'contains', category: '', subcategory: '', batch: 0, entry: ''}; route(); render(); });
  for (const [id, delta] of [['previous-page', -1], ['next-page', 1]]) $(id).addEventListener('click', () => {
    state.batch += delta; state.entry = ''; route(true); showEntry(filtered[state.batch * BATCH_SIZE]); renderList(); $('results').scrollTop = 0;
    if (matchMedia('(max-width:700px)').matches) $('result-pane').scrollIntoView();
  });
  for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => {
    clearTimeout(timer); state.view = b.dataset.view; state.entry = ''; state.batch = 0;
    if (state.view === 'favorites') { state.q = ''; state.category = ''; state.subcategory = ''; }
    route(true); render();
  });
  $('back-to-results').addEventListener('click', () => { const id = state.entry; state.entry = ''; route(true); document.body.classList.remove('detail-open'); const b = $('results').querySelector(`[data-id="${id}"]`); b?.focus(); });
  $('general-report').addEventListener('click', () => openReport(state.view === 'references' ? references.find(r => r.id === state.reference) : selected));
  $('close-report').addEventListener('click', () => $('report-dialog').close());
  $('error-description').addEventListener('input', () => { if (reportTarget) saveStorage('report:' + reportTarget.id, $('error-description').value); });
  $('copy-report').addEventListener('click', async () => {
    if (!$('report-form').reportValidity()) return;
    await copy(reportText(), '报告已复制，可发给维护者');
    $('report-status').textContent = '报告尚未提交。复制后可发送给维护者。';
  });
  $('report-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!$('report-form').reportValidity()) return;
    const title = `纠错：${reportTarget.headword || reportTarget.title}`;
    const body = reportText();
    const url = REPOSITORY + '/issues/new?' + new URLSearchParams({title, body, template: 'blank'});
    if (url.length > 7500) {
      copy(body, '完整报告已复制');
      $('report-status').replaceChildren(document.createTextNode('报告较长，请复制后在 GitHub 中粘贴。'));
      const link = node('a', '打开提交页'); link.href = REPOSITORY + '/issues/new?' + new URLSearchParams({title}); link.target = '_blank'; link.rel = 'noopener noreferrer'; $('report-status').append(link); return;
    }
    const opened = window.open(url, '_blank');
    if (opened) opened.opener = null;
    $('report-status').replaceChildren(document.createTextNode('请在 GitHub 页面确认并提交。若没有打开，'));
    const link = node('a', '点此继续'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; $('report-status').append(link);
  });
  window.addEventListener('popstate', () => { clearTimeout(timer); readRoute(); render(); });
  window.addEventListener('hashchange', () => { readRoute(); render(); });
  document.addEventListener('click', event => {
    const menu = document.querySelector('.downloads'); if (!menu.contains(event.target)) menu.open = false;
  });
}
async function start() {
  try {
    const responses = await Promise.all(['data/entries.jsonl', 'data/references.json'].map(path => fetch(path)));
    for (const response of responses) if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const [text, refs] = await Promise.all([responses[0].text(), responses[1].json()]);
    entries = text.trim().split('\n').map(line => JSON.parse(line)); references = refs;
    for (const entry of entries) {
      entry._headword = fold(entry.headword); entry._text = fold(entry.text); entry._ipa = ipaFold(entry.pronunciation.text);
    }
    byId = new Map(entries.map(e => [e.id, e]));
    categories = [...new Set(entries.map(e => e.categories[0]))];
    for (const c of categories) $('category').add(new Option(c, c));
    $('edition').textContent = `${entries.length.toLocaleString('zh-CN')} 条词条 · ${categories.length} 类 · 读音、释义与例句`;
    $('loading').hidden = true;
    readRoute(); wireEvents(); render();
  } catch {
    $('loading').replaceChildren(node('p', '词典暂时未能载入，请检查网络后重试。'), button('重新载入', () => location.reload()));
    $('loading').setAttribute('role', 'alert');
  }
}
start();
