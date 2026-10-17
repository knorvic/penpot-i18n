// Knorvic i18n — Penpot plugin that switches the open file between English and other languages.
//
// Translations are stored inside the file itself, in each text layer's shared plugin data
// (namespace "knorvic-i18n"), so this plugin only contains the switching logic:
//   src                  English text the translation was made from
//   <lang>               translated text (e.g. "es")
//   srcSpans/<lang>Spans JSON [[leaf, ...], ...] per paragraph, only for multi-style texts
// Root boards store "src" and "<lang>" for their names, so view mode shows translated screen names.
// The file-level key "lang" records the language currently shown ("en" by default).

const NS = 'knorvic-i18n';
const LANGS = { en: 'English', es: 'Español' };
const STYLE_KEYS = ['fontId', 'fontFamily', 'fontVariantId', 'fontSize', 'fontWeight', 'fontStyle',
  'lineHeight', 'letterSpacing', 'textTransform', 'textDecoration', 'fills'];

function allShapes(pred) {
  const out = [];
  for (const page of penpot.currentFile.pages) {
    const stack = [page.root];
    while (stack.length) {
      const s = stack.pop();
      if (pred(s)) out.push(s);
      if (s.children) for (const c of s.children) stack.push(c);
    }
  }
  return out;
}

function rootBoards() {
  return penpot.currentFile.pages.flatMap(p => p.root.children.filter(s => s.type === 'board'));
}

function get(s, k) { return s.getSharedPluginData(NS, k) || ''; }

function currentLang() { return penpot.currentFile.getSharedPluginData(NS, 'lang') || 'en'; }

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

function stats() {
  const lang = currentLang();
  const counts = { lang, translated: 0, outdated: 0, missing: 0 };
  for (const t of allShapes(s => s.type === 'text')) {
    if (!/[A-Za-z]/.test(t.characters)) continue;
    const src = get(t, 'src');
    if (!src) { counts.missing++; continue; }
    if (lang === 'en') {
      if (t.characters !== src) counts.outdated++;          // English edited after translating
      else if (!get(t, 'es')) counts.missing++;
      else counts.translated++;
    } else if (t.characters === textIn(t, lang)) counts.translated++;
    else counts.outdated++;
  }
  return counts;
}

function setLang(lang) {
  const cur = currentLang();
  if (cur === lang) return { lang, changed: 0, kept: 0 };
  let changed = 0, kept = 0;
  for (const t of allShapes(s => s.type === 'text')) {
    const src = get(t, 'src');
    if (!src) continue;
    const shownText = textIn(t, cur);
    if (t.characters !== shownText) {
      if (cur === 'en') { kept++; continue; }               // English changed since translating: keep it
      // Edited while showing a translation: keep the edit as the new translation.
      t.setSharedPluginData(NS, cur, t.characters);
      t.setSharedPluginData(NS, cur + 'Spans', '');
    }
    const target = textIn(t, lang);
    if (!target) { kept++; continue; }                       // no translation for this language yet
    if (t.characters !== target) { writeText(t, cur, lang); changed++; }
  }
  for (const b of rootBoards()) {
    const from = textIn(b, cur), to = textIn(b, lang);
    if (from && to && b.name === from) b.name = to;
  }
  penpot.currentFile.setSharedPluginData(NS, 'lang', lang);
  return { lang, changed, kept };
}

function send(type, data) { penpot.ui.sendMessage({ type, ...data }); }

function refresh() {
  if (!penpot.currentFile) { send('state', { file: null }); return; }
  send('state', { file: penpot.currentFile.name, langs: LANGS, stats: stats() });
}

penpot.ui.open('Knorvic i18n', `ui.html?theme=${penpot.theme}`, { width: 300, height: 380 });

penpot.ui.onMessage(msg => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'ready' || msg.type === 'refresh') refresh();
  if (msg.type === 'set-lang' && LANGS[msg.lang]) {
    send('busy', { lang: msg.lang });
    // Let the UI paint the busy state before the long synchronous switch.
    setTimeout(() => {
      try {
        const result = setLang(msg.lang);
        send('done', { result });
      } catch (e) {
        send('error', { message: String(e && e.message || e) });
      }
      refresh();
    }, 50);
  }
});

penpot.on('filechange', refresh);
penpot.on('themechange', theme => send('theme', { theme }));
