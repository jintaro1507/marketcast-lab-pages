/**
 * practical-guide.js — はじめての投資 実践ガイド（Task41）
 *
 * 役割:
 *   Beginner Journey で「仕組みが分かった」初心者に対して、
 *   実際に始めるときの操作の流れを説明する。
 *
 * 設計上の判断:
 *   - hash route（#index / #stocks / #funds / #gold / #crypto）。
 *     beginner-journey.js と同じ考え方で、reload・直リンク・戻るに対応。
 *   - 内容の正本は data/practical_guide.json。変わりやすい事実
 *     （最低金額・単位・注文方式）は facts として source と confirmed を
 *     持たせ、更新しやすくしている。ここに数値をハードコードしない。
 *   - 完全無料。auth wall・Premium gate を置かない。同意も要求しない。
 *   - 練習は純粋なクライアント内の計算のみ。金融機関へは一切接続しない。
 *   - 実在サービスは「例」として提示し、推奨表現を使わない。
 *     ロゴ・スクリーンショット等の外部素材は読み込まない。
 */

const DATA_URL = 'data/practical_guide.json';
const KEYS = ['stocks', 'funds', 'gold', 'crypto'];

let DATA = null;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* ─────────────────────────────────────────────────────────────
 * 部品
 * ───────────────────────────────────────────────────────────── */

/** 縦型のフロー。矢印だけに頼らず、番号と本文で読めるようにする。 */
function buildFlow(steps) {
  const wrap = el('ol', 'flow');
  steps.forEach((s, i) => {
    const li = el('li', 'flow-step');
    li.appendChild(el('span', 'flow-num', String(i + 1)));
    const body = el('div', 'flow-body');
    body.appendChild(el('b', null, s.title));
    body.appendChild(el('span', null, s.body));
    li.appendChild(body);
    wrap.appendChild(li);
  });
  return wrap;
}

function buildExample(ex) {
  const box = el('div', 'ex');
  box.appendChild(el('div', 'ex-label', ex.label));
  const lines = el('div', 'ex-lines');
  (ex.lines || []).forEach(t => lines.appendChild(el('div', 'ex-line', t)));
  box.appendChild(lines);
  box.appendChild(el('p', 'ex-note', ex.note));
  return box;
}

function buildConcepts(concepts) {
  const wrap = el('div', 'concepts');
  concepts.forEach(c => {
    const box = el('section', 'concept');
    box.appendChild(el('h3', null, c.title));
    box.appendChild(el('p', null, c.body));
    if (c.example) box.appendChild(buildExample(c.example));
    if (c.caution) box.appendChild(el('p', 'caution', c.caution));
    wrap.appendChild(box);
  });
  return wrap;
}

function buildMistakes(items) {
  const wrap = el('div', 'mistakes');
  const ul = document.createElement('ul');
  items.forEach(t => ul.appendChild(el('li', null, t)));
  wrap.appendChild(ul);
  return wrap;
}

/** 実在サービスは「例」。推奨ではないことを見出しと注記の両方で示す。 */
function buildServices(services, exampleNote) {
  const wrap = el('div', 'services');
  wrap.appendChild(el('p', 'services-note', exampleNote));
  services.forEach(s => {
    const box = el('div', 'service');
    box.appendChild(el('b', 'service-name', s.name));
    box.appendChild(el('p', 'service-desc', s.note));
    if ((s.facts || []).length) {
      const dl = el('dl', 'facts');
      s.facts.forEach(f => {
        dl.appendChild(el('dt', null, f.label));
        const dd = el('dd', null, f.value);
        dd.appendChild(el('span', 'fact-src', `（${f.source}／${f.confirmed}確認時点）`));
        dl.appendChild(dd);
      });
      box.appendChild(dl);
    }
    if (s.href) {
      const a = el('a', 'service-link');
      a.href = s.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.appendChild(el('span', null, '公式サイトで確認する ↗'));
      box.appendChild(a);
    }
    wrap.appendChild(box);
  });
  return wrap;
}

/**
 * 練習。実際の注文は行わない。
 * 選択結果はページ内だけで判定し、どこへも送信しない。
 */
function buildPractice(items, practiceNote, onComplete) {
  const wrap = el('div', 'practice');
  wrap.appendChild(el('p', 'practice-note', practiceNote));

  let answered = 0;
  items.forEach((p, qi) => {
    const box = el('div', 'q');
    box.appendChild(el('p', 'q-text', p.q));
    const opts = el('div', 'q-opts');
    const result = el('p', 'q-result');
    result.hidden = true;
    result.setAttribute('role', 'status');

    p.options.forEach((label, oi) => {
      const b = el('button', 'q-opt', label);
      b.type = 'button';
      b.addEventListener('click', () => {
        if (box.dataset.done === '1') return;
        box.dataset.done = '1';
        opts.querySelectorAll('.q-opt').forEach((n, ni) => {
          n.disabled = true;
          if (ni === p.answer) n.classList.add('is-correct');
          else if (ni === oi) n.classList.add('is-chosen');
        });
        result.hidden = false;
        result.textContent = (oi === p.answer ? '正解です。' : 'もう一度確認してみましょう。')
          + ' ' + p.explain;
        answered += 1;
        if (answered === items.length && typeof onComplete === 'function') onComplete();
      });
      opts.appendChild(b);
    });

    box.appendChild(opts);
    box.appendChild(result);
    wrap.appendChild(box);
  });
  return wrap;
}

/* ─────────────────────────────────────────────────────────────
 * 画面
 * ───────────────────────────────────────────────────────────── */

function renderIndex(main) {
  main.appendChild(el('div', 'eyebrow', 'PRACTICAL GUIDE'));
  main.appendChild(el('h1', null, 'はじめての投資 実践ガイド'));
  main.appendChild(el('p', 'lead',
    '口座をつくるところから、買って売るところまで。'
    + '「実際に始めるとき、何をどう指定するのか」を、資産ごとに順番に確認できます。'));

  const grid = el('div', 'guide-grid');
  DATA.guides.forEach(g => {
    const a = el('a', 'guide-card');
    a.href = '#' + g.key;
    a.appendChild(el('b', null, g.label));
    a.appendChild(el('span', 'guide-sub', g.subtitle));
    a.appendChild(el('span', 'guide-sum', g.summary));
    grid.appendChild(a);
  });
  main.appendChild(grid);

  main.appendChild(el('div', 'sec-label', 'あわせて見る'));
  const links = el('div', 'links-list');
  [['beginner.html#step0', '投資の基本から学ぶ', '「投資とは何か」から順番に確認できます。'],
   ['current_context.html?cause=war', 'いまの市場を見る', 'ニュースが資産にどう影響したかを確認できます。'],
  ].forEach(([href, label, note]) => {
    const a = el('a', 'link-card');
    a.href = href;
    a.appendChild(el('b', null, label));
    a.appendChild(el('span', null, note));
    links.appendChild(a);
  });
  main.appendChild(links);
}

function renderGuide(g, main) {
  const back = el('a', 'back-link', '← 実践ガイドの一覧へ');
  back.href = '#index';
  main.appendChild(back);

  main.appendChild(el('div', 'eyebrow', g.label));
  main.appendChild(el('h1', null, g.subtitle));
  main.appendChild(el('p', 'lead', g.summary));

  main.appendChild(el('div', 'sec-label', '始めてから売るまでの流れ'));
  main.appendChild(buildFlow(g.flow));

  main.appendChild(el('div', 'sec-label', '知っておきたい考え方'));
  main.appendChild(buildConcepts(g.concepts));

  main.appendChild(el('div', 'sec-label', '初心者がつまずきやすいところ'));
  main.appendChild(buildMistakes(g.mistakes));

  main.appendChild(el('div', 'sec-label', '実際のサービス例'));
  main.appendChild(buildServices(g.services, DATA.example_note));

  main.appendChild(el('div', 'sec-label', '練習してみる'));
  main.appendChild(buildPractice(g.practice, DATA.practice_note, () => {
    track('practical_practice_complete', { asset_type: g.key });
  }));

  /* 次のガイドへ回遊できるようにする（孤立させない） */
  const others = DATA.guides.filter(x => x.key !== g.key);
  main.appendChild(el('div', 'sec-label', 'ほかの資産も見る'));
  const nav = el('div', 'links-list');
  others.forEach(o => {
    const a = el('a', 'link-card');
    a.href = '#' + o.key;
    a.appendChild(el('b', null, o.label));
    a.appendChild(el('span', null, o.subtitle));
    nav.appendChild(a);
  });
  main.appendChild(nav);
}

function track(name, props) {
  try {
    if (typeof trackProductEvent === 'function') trackProductEvent(name, props);
  } catch (_) { /* 計測失敗は無視する */ }
}

function currentKey() {
  const m = /^#([a-z]+)$/.exec(location.hash || '');
  const k = m ? m[1] : 'index';
  return (k === 'index' || KEYS.includes(k)) ? k : 'index';
}

function render() {
  const main = document.getElementById('app');
  if (!main || !DATA) return;
  main.replaceChildren();

  const key = currentKey();
  if (key === 'index') {
    renderIndex(main);
    track('practical_guide_view');
  } else {
    const g = DATA.guides.find(x => x.key === key);
    if (!g) { renderIndex(main); return; }
    renderGuide(g, main);
    track('practical_asset_open', { asset_type: g.key });
  }

  /* 共通の免責。どの画面からでも読めるようにする。 */
  const f = el('footer', null, DATA.disclaimer);
  main.appendChild(f);

  window.scrollTo(0, 0);
}

(async function init() {
  try {
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    DATA = await res.json();
  } catch (_) {
    const main = document.getElementById('app');
    if (main) main.replaceChildren(
      el('p', 'lead', 'コンテンツを読み込めませんでした。時間をおいて再度お試しください。'));
    return;
  }

  if (!location.hash) location.replace('#index');
  render();
  window.addEventListener('hashchange', render);
})();
