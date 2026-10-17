// Knorvic i18n — Penpot plugin that switches Knorvic designs between English and other languages.
//
// Translations are stored inside the file itself, in each text layer's shared plugin data
// (namespace "knorvic-i18n"), so this plugin only contains the switching logic:
//   src                  English text the translation was made from
//   <lang>               translated text (e.g. "es")
//   srcSpans/<lang>Spans JSON [[leaf, ...], ...] per paragraph, only for multi-style texts
//   shown                language the layer currently shows when it is not English
// Root boards store "src" and "<lang>" for their names, so view mode shows translated screen names.
// A switch applies to the selected screens or to the whole file.

const NS = 'knorvic-i18n';
const LANGS = { en: 'English', es: 'Español' };
const STYLE_KEYS = ['fontId', 'fontFamily', 'fontVariantId', 'fontSize', 'fontWeight', 'fontStyle',
  'lineHeight', 'letterSpacing', 'textTransform', 'textDecoration', 'fills'];
const BATCH = 150;

const pause = () => new Promise(resolve => setTimeout(resolve, 0));

function get(s, k) { return s.getSharedPluginData(NS, k) || ''; }

function textsIn(roots) {
  const out = [];
  const stack = [...roots];
  while (stack.length) {
    const s = stack.pop();
    if (s.type === 'text') out.push(s);
    if (s.children) for (const c of s.children) stack.push(c);
  }
  return out;
}

function pageBoards(page) { return page.root.children.filter(s => s.type === 'board'); }

// Top-level boards (screens) that contain the current selection.
function selectedScreens() {
  const rootId = penpot.currentPage.root.id;
  const screens = new Map();
  for (const s of penpot.selection) {
    let c = s;
    while (c.parent && c.parent.id !== rootId) c = c.parent;
    if (c.parent && c.type === 'board') screens.set(c.id, c);
  }
  return [...screens.values()];
}

function scopeBoards(scope) {
  return scope === 'selection' ? selectedScreens() : penpot.currentFile.pages.flatMap(pageBoards);
}

function shownLang(t) { return get(t, 'shown') || 'en'; }

function textIn(t, lang) { return lang === 'en' ? get(t, 'src') : get(t, lang); }

function spansIn(t, lang) {
  const raw = get(t, lang === 'en' ? 'srcSpans' : lang + 'Spans');
  return raw ? JSON.parse(raw) : null;
}

// Replace the text keeping per-leaf styles: read them at the old leaf ranges, write them at the new ones.
function writeSpans(t, fromSpans, toSpans) {
  const styles = [];
  let pos = 0;
  for (const p of fromSpans) {
    for (const leaf of p) {
      const st = {};
      if (leaf.length) {
        const r = t.getRange(pos, pos + leaf.length);
        for (const k of STYLE_KEYS) { const v = r[k]; if (v !== 'mixed' && v != null) st[k] = v; }
      }
      styles.push(st);
      pos += leaf.length;
    }
    pos += 1;
  }
  t.characters = toSpans.map(p => p.join('')).join('\n');
  let q = 0, j = 0;
  for (const p of toSpans) {
    for (const leaf of p) {
      const st = styles[j++] || {};
      if (leaf.length) {
        const r = t.getRange(q, q + leaf.length);
        for (const k of STYLE_KEYS) if (st[k] !== undefined) { try { r[k] = st[k]; } catch (e) { /* read-only key */ } }
      }
      q += leaf.length;
    }
    q += 1;
  }
}

function writeText(t, fromLang, toLang) {
  const a = spansIn(t, fromLang), b = spansIn(t, toLang);
  if (a && b && a.length === b.length && a.every((p, i) => p.length === b[i].length)) {
    writeSpans(t, a, b);
  } else {
    t.characters = textIn(t, toLang);
  }
}

function stats(scope) {
  const boards = scopeBoards(scope);
  const counts = { screens: boards.length, shown: {}, outdated: 0, missing: 0 };
  for (const code of Object.keys(LANGS)) counts.shown[code] = 0;
  for (const t of textsIn(boards)) {
    if (!/[A-Za-z]/.test(t.characters)) continue;
    if (!get(t, 'src')) { counts.missing++; continue; }
    const lang = shownLang(t);
    if (t.characters === textIn(t, lang)) counts.shown[lang] = (counts.shown[lang] || 0) + 1;
    else counts.outdated++;
  }
  return counts;
}

// Switches in batches and yields between them so Penpot stays responsive on big files.
async function setLang(lang, scope, onProgress) {
  const boards = scopeBoards(scope);
  const texts = textsIn(boards);
  let changed = 0, kept = 0;
  for (let i = 0; i < texts.length; i++) {
    if (i % BATCH === 0) { onProgress(i, texts.length); await pause(); }
    const t = texts[i];
    if (!get(t, 'src')) continue;
    const cur = shownLang(t);
    if (cur === lang) continue;
    if (t.characters !== textIn(t, cur)) {
      if (cur === 'en') { kept++; continue; }               // English changed since translating: keep it
      // Edited while showing a translation: keep the edit as the new translation.
      t.setSharedPluginData(NS, cur, t.characters);
      t.setSharedPluginData(NS, cur + 'Spans', '');
    }
    const target = textIn(t, lang);
    if (!target) { kept++; continue; }                       // no translation for this language yet
    if (t.characters !== target) { writeText(t, cur, lang); changed++; }
    t.setSharedPluginData(NS, 'shown', lang === 'en' ? '' : lang);
  }
  for (const b of boards) {
    const name = textIn(b, lang);
    if (name && b.name !== name && Object.keys(LANGS).some(l => textIn(b, l) === b.name)) b.name = name;
  }
  onProgress(texts.length, texts.length);
  return { lang, changed, kept };
}

let busy = false;
let fileStats = null;

function send(type, data) { penpot.ui.sendMessage({ type, ...data }); }

// Whole-file counts walk every text layer, so they are only recomputed on demand or after a switch.
function refresh(full) {
  if (busy) return;
  if (!penpot.currentFile) { send('state', { file: null }); return; }
  if (full || !fileStats) fileStats = stats('file');
  send('state', { file: penpot.currentFile.name, langs: LANGS, selection: stats('selection'), fileStats });
}

penpot.ui.open('Knorvic i18n', `ui.html?theme=${penpot.theme}`, { width: 320, height: 470 });

penpot.ui.onMessage(msg => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'ready' || msg.type === 'refresh') refresh(true);
  if (msg.type === 'set-lang' && LANGS[msg.lang] && !busy) {
    const scope = msg.scope === 'selection' ? 'selection' : 'file';
    busy = true;
    send('busy', { lang: msg.lang, scope });
    setLang(msg.lang, scope, (done, total) => send('progress', { done, total }))
      .then(result => send('done', { result }))
      .catch(e => send('error', { message: String(e && e.message || e) }))
      .finally(() => { busy = false; refresh(true); });
  }
});

penpot.on('filechange', () => refresh(true));
penpot.on('pagechange', () => refresh(false));
penpot.on('selectionchange', () => refresh(false));
penpot.on('themechange', theme => send('theme', { theme }));
