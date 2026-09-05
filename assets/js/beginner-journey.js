/**
 * beginner-journey.js — Beginner Investment Journey v2（Task49 / Task49.1 / Task49.2 / Task49.3）
 *
 * Task49: 「読む教材」から「タップして気づく」インタラクティブ体験へ再設計。
 * 各 STEP は複数の小さな画面（カードキュー）で構成し、1画面につき
 * 1つの問い・最大4つの選択肢・即時フィードバックだけを見せる。
 * 詳しい説明は「もう少し詳しく」の accordion へ移し、必須では読ませない。
 *
 * Task49.2: STEP内部の画面移動に明示的な「戻る」「次へ」ナビゲーションを
 * 追加した。ブラウザの戻るボタン（history.back）に頼ると、STEP内部の
 * カード送りが history へ積まれていないため意図しないページ（前のSTEP
 * どころかbeginner.htmlより前のページ）へ飛んでしまう。history へ全画面を
 * push する対処はせず、画面内のボタンだけで完結する local state
 * （queueIndex）ベースの移動に統一した。戻った質問画面では、以前の回答が
 * selected表示され、選び直せば feedback も再計算される（回答内容は
 * ページを開いている間だけの in-memory state。保存・送信はしない）。
 *
 * Task49.3: 広告経由の初回タップ改善。実データで、広告→着地は機能するが
 * STEP0画面0（心理質問）から先へ進むセッションがほぼ無かった。原因は
 * 「なぜ答えるのか」の説明無しにいきなり3択を要求していたことと推定し、
 * STEP0の絶対的な最初に単一CTAのSTART画面を1枚だけ追加した
 * （step0StartScreen）。Journey本体（既存の質問・feedback・STEP1〜4）は
 * 一切変更しない。既存の beginner_progress の (step, screen) 計測が
 * そのままファネルの新しい意味（screen0=START到達・screen1=CTA押下）を
 * 持つよう、新しいscreenをキューの先頭に足すだけで新規イベントは追加していない。
 *
 * 設計（Task37B から継承・変更しない部分）:
 *   - hash route（#step0 … #step4）。reload・直リンクに対応。
 *     STEP 内部のカード送りは hash を変えない（module-level state のみ）。
 *   - data/beginner_journey.json を正本とし、解説本文はここに複製しない
 *     （canonical は data/lessons.json 側。lesson_ref でリンクするだけ）。
 *   - Visual は自前の HTML/CSS/inline SVG のみ。外部 chart library・外部画像は使わない。
 *   - 完全無料。auth wall・Premium gate・pricing CTA を置かない。
 *   - analytics は fire-and-forget、既存4イベントのみ（個々のタップ回答は送らない。
 *     回答を変更しても新しいイベントは発火しない）。
 *
 * 数値の扱い:
 *   複利図などの数値は仮定の計算例であり、実在の市場データでも
 *   将来の収益率でもない。図には必ずその旨を明示する。
 *
 * 心理質問 vs 知識質問:
 *   STEP0・STEP1・STEP3 の問いは「今の感覚」を聞くもので、正解／不正解を
 *   付けない（どの選択肢を押しても同じ短いフィードバックを返す）。
 *   STEP2・STEP4 の問いは金融の仕組みについての知識確認のため、
 *   穏やかな正誤フィードバック（is-correct / is-incorrect）を用いる。
 */

const DATA_URL = 'data/beginner_journey.json';
const LAST_STEP = 4;

/* 二重計上の防止。
   in-memory の Set だとページ再読込・再訪で初期化されてしまい、
   同一セッション内で beginner_start / step_complete が複数回記録される。
   ファネルの母数が水増しされるため、sessionStorage に記録して
   「セッション内で1回」を保証する（ストレージ不可の環境では
   in-memory へフォールバックし、計測のために UX を壊さない）。 */
const memoryFired = new Set();

function alreadyFired(key) {
  try {
    return sessionStorage.getItem('mcl_bj_' + key) === '1';
  } catch (_) {
    return memoryFired.has(key);
  }
}

function markFired(key) {
  try {
    sessionStorage.setItem('mcl_bj_' + key, '1');
  } catch (_) {
    memoryFired.add(key);
  }
}

/** セッション内で1回だけ計測する */
function trackOnce(key, name, props) {
  if (alreadyFired(key)) return;
  markFired(key);
  track(name, props);
}

/**
 * STEP内の画面到達を計測する（Task49.1）。
 *
 * beginner_start / beginner_step_complete / beginner_complete は STEP
 * 単位でしか進捗を捉えられないため、Task49 でカードキュー化された
 * STEP内部のどこで離脱したかが分からなくなっていた。この関数は
 * 「STEP n の画面 screen を表示できた」という到達位置のみを、
 * セッション内で同じ (n, screen) につき1回だけ記録する。
 *
 * 送るのは step / screen の2値のみ。選択した回答・正誤・資産選択・
 * 心理回答・自由文字列は絶対に含めない（呼び出し側にもその情報を
 * 渡していないため、構造的に送りようがない）。
 */
function trackProgressOnce(step, screen) {
  trackOnce('prog_' + step + '_' + screen, 'beginner_progress',
    { step: String(step), screen: String(screen) });
}

function track(name, props) {
  try {
    if (typeof trackProductEvent === 'function') trackProductEvent(name, props);
  } catch (_) { /* 計測失敗は無視する */ }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* ─────────────────────────────────────────────────────────────
 * Visuals — すべて自前実装（外部依存なし）。Task37B から内容は変更しない。
 * detail accordion の中身として使う。
 * ───────────────────────────────────────────────────────────── */

function visGamble() {
  const wrap = el('div', 'vis');
  const grid = el('div', 'cmp');

  const inv = el('div', 'cmp-col cmp-invest');
  inv.appendChild(el('h3', null, '投資'));
  const ul1 = document.createElement('ul');
  ['企業や国などの経済活動にお金を振り向ける',
   'その活動が生む収益を分け合うことを期待する',
   '時間をかけて成果を見ることが多い',
   '値下がりの可能性は常にある'].forEach(t => ul1.appendChild(el('li', null, t)));
  inv.appendChild(ul1);

  const gam = el('div', 'cmp-col cmp-gamble');
  gam.appendChild(el('h3', null, 'ギャンブル'));
  const ul2 = document.createElement('ul');
  ['偶然性のある結果にお金を賭ける',
   '賭けの勝ち負けで金銭が移動する',
   '結果が出るまでの時間は短いことが多い',
   '賭け金を失う可能性がある'].forEach(t => ul2.appendChild(el('li', null, t)));
  gam.appendChild(ul2);

  grid.appendChild(inv);
  grid.appendChild(gam);
  wrap.appendChild(grid);
  wrap.appendChild(el('div', 'vis-cap',
    '性質の違いを整理したものです。投資であっても、短期売買や一点集中など投機的な行動になり得ます。「投資だから安全」という意味ではありません。'));
  return wrap;
}

function visWhere(assets) {
  /* 値動きの大きさの「イメージ」を示す。実データではない。 */
  const wrap = el('div', 'vis');
  const bars = el('div', 'bars');
  const spec = [
    { label: '預金',     w: 6,  color: 'var(--bond)' },
    { label: '債券',     w: 30, color: 'var(--fx)' },
    { label: '投資信託', w: 55, color: 'var(--gold)' },
    { label: '金',       w: 70, color: 'var(--oil)' },
    { label: '株式',     w: 88, color: 'var(--equity)' },
  ];
  spec.forEach(s => {
    const row = el('div', 'bar-row');
    row.appendChild(el('div', 'bar-lab', s.label));
    const bar = el('div', 'bar');
    bar.style.width = s.w + '%';
    bar.style.background = s.color;
    row.appendChild(bar);
    bars.appendChild(row);
  });
  wrap.appendChild(bars);
  wrap.appendChild(el('div', 'vis-cap',
    '値動きの大きさの傾向を、相対的なイメージとして示した図です。実際の価格データや過去の実績を示すものではありません。順位や大きさが常にこの通りになるわけではありません。'));
  return wrap;
}

/* 「今」「数年後」バーの構成。
   以前は既存の .bar-row / .bar 共有コンポーネント（幅を % で指定）を使っていたが、
   その % は .bar-row 全体の幅に対して解決されるため、ラベル分の固定幅を
   差し引いた「バーが実際に描画できる領域」とはズレる。結果として
   しきい値（ラベル幅 / 行幅で決まる、モバイルでは約77%）以上の指定値は
   すべて同じ最大幅に収縮し、100% と 88% の見た目が区別できなくなっていた
   （Task40.1 で発見）。この図だけは自前の SVG にして、バー幅を
   viewBox 座標で直接指定することで、コンテナ幅に依存せず
   「数年後のバーが今より短い」ことを保証する。 */
function visInflation() {
  const wrap = el('div', 'vis');
  wrap.innerHTML = `
    <svg viewBox="0 0 320 128" role="img" aria-label="物価が上がると、同じ金額で買えるものの量が減る可能性があることを示すイメージ図">
      <text x="0" y="13" font-family="monospace" font-size="10" fill="#5B564B">今</text>
      <rect x="0" y="20" width="280" height="24" rx="3" fill="#7A6A55"/>
      <text x="10" y="36.5" font-family="monospace" font-size="10.5" fill="#fff">100万円で買えるもの</text>

      <text x="0" y="85" font-family="monospace" font-size="10" fill="#5B564B">数年後</text>
      <rect x="0" y="92" width="176" height="24" rx="3" fill="#7A6A55"/>
      <text x="10" y="108.5" font-family="monospace" font-size="10.5" fill="#fff">同じ100万円で</text>
      <text x="186" y="108.5" font-family="monospace" font-size="10.5" fill="#5B564B">買えるもの</text>
    </svg>`;
  wrap.appendChild(el('div', 'vis-cap',
    '物価上昇による購買力の変化を説明するためのイメージ図です。実際の物価上昇率を示すものではありません。'));
  return wrap;
}

function visRisk() {
  /* 「リスク＝振れ幅」を示す。上下どちらにも振れることを明示する。 */
  const wrap = el('div', 'vis');
  wrap.innerHTML = `
    <svg viewBox="0 0 320 120" role="img" aria-label="値動きの振れ幅が小さい資産と大きい資産の比較イメージ">
      <line x1="10" y1="60" x2="310" y2="60" stroke="#cfc7b6" stroke-width="1" stroke-dasharray="3 3"/>
      <text x="10" y="16" font-family="monospace" font-size="9" fill="#5B564B">振れ幅が小さい</text>
      <polyline points="10,60 40,55 70,63 100,57 130,61 150,58"
                fill="none" stroke="#4A6B5A" stroke-width="2"/>
      <text x="170" y="16" font-family="monospace" font-size="9" fill="#5B564B">振れ幅が大きい</text>
      <polyline points="170,60 195,30 220,80 245,38 270,88 300,52"
                fill="none" stroke="#38456B" stroke-width="2"/>
      <text x="10" y="112" font-family="monospace" font-size="9" fill="#5B564B">上にも下にも振れる</text>
    </svg>`;
  wrap.appendChild(el('div', 'vis-cap',
    '値動きの振れ幅のイメージ図です。実在の資産や実際の価格を示すものではありません。振れ幅は上方向にも下方向にも生じます。'));
  return wrap;
}

function visCompound() {
  const wrap = el('div', 'vis');
  const bars = el('div', 'bars');
  [
    { label: '開始時', v: '100.00万円',  w: 58 },
    { label: '1年後',  v: '105.00万円',  w: 64 },
    { label: '2年後',  v: '110.25万円',  w: 71 },
    { label: '3年後',  v: '115.76万円',  w: 78 },
  ].forEach(s => {
    const row = el('div', 'bar-row');
    row.appendChild(el('div', 'bar-lab', s.label));
    const bar = el('div', 'bar');
    bar.style.width = s.w + '%';
    bar.style.background = 'var(--gold)';
    bar.textContent = s.v;
    row.appendChild(bar);
    bars.appendChild(row);
  });
  wrap.appendChild(bars);
  wrap.appendChild(el('div', 'vis-cap',
    '毎年5%増えたと仮定した場合の計算例です。実際の収益率を示すものではありません。実際には値下がりする年もあり、増え続けることを示すものではありません。'));
  return wrap;
}

function visDiversification() {
  const wrap = el('div', 'vis');
  wrap.innerHTML = `
    <svg viewBox="0 0 320 110" role="img" aria-label="一つの資産に集中した場合と複数に分けた場合のイメージ">
      <text x="8" y="14" font-family="monospace" font-size="9" fill="#5B564B">1つに集中</text>
      <rect x="8" y="24" width="120" height="60" fill="#38456B" rx="2"/>
      <text x="40" y="60" font-family="monospace" font-size="10" fill="#fff">1つの資産</text>
      <text x="188" y="14" font-family="monospace" font-size="9" fill="#5B564B">分けて持つ</text>
      <rect x="188" y="24" width="57" height="28" fill="#38456B" rx="2"/>
      <rect x="251" y="24" width="57" height="28" fill="#9C7A2E" rx="2"/>
      <rect x="188" y="56" width="57" height="28" fill="#4A6B5A" rx="2"/>
      <rect x="251" y="56" width="57" height="28" fill="#7A6A55" rx="2"/>
      <text x="8" y="102" font-family="monospace" font-size="9" fill="#5B564B">値動きの性質が違うものを組み合わせる</text>
    </svg>`;
  wrap.appendChild(el('div', 'vis-cap',
    '考え方を示した概念図です。分散すれば損をしないという意味ではありません。市場全体が下落する局面では、多くの資産が同時に下がることもあります。'));
  return wrap;
}

function visFlow(flow) {
  const wrap = el('div', 'vis');
  const steps = el('div', 'flow-steps');
  flow.forEach((f, i) => {
    const item = el('div', 'flow-item');
    item.appendChild(el('b', null, f.label));
    item.appendChild(el('span', null, f.note));
    steps.appendChild(item);
    if (i < flow.length - 1) steps.appendChild(el('div', 'flow-arrow', '↓'));
  });
  wrap.appendChild(steps);
  wrap.appendChild(el('div', 'vis-cap',
    'Marketcast Lab での見方の流れです。将来の値動きを予測するものではありません。'));
  return wrap;
}

function visRangeExample() {
  const wrap = el('div', 'vis');
  wrap.innerHTML = `
    <svg viewBox="0 0 320 150" role="img" aria-label="10万円を投資した場合に、減ることも増えることもあるという値動きの幅のイメージ">
      <rect x="118" y="8" width="84" height="26" rx="4" fill="#1C1A16"/>
      <text x="160" y="26" text-anchor="middle" font-family="monospace" font-size="12" fill="#F2EFE8">10万円</text>
      <path d="M150,36 C120,60 80,66 55,86" fill="none" stroke="#cfc7b6" stroke-width="1.5"/>
      <path d="M160,36 L160,86" fill="none" stroke="#cfc7b6" stroke-width="1.5"/>
      <path d="M170,36 C200,60 240,66 265,86" fill="none" stroke="#cfc7b6" stroke-width="1.5"/>
      <rect x="14" y="88" width="82" height="26" rx="4" fill="#fff" stroke="#2F5D4E"/>
      <text x="55" y="106" text-anchor="middle" font-family="monospace" font-size="12" fill="#2F5D4E">3万円</text>
      <rect x="119" y="88" width="82" height="26" rx="4" fill="#fff" stroke="#5B564B"/>
      <text x="160" y="106" text-anchor="middle" font-family="monospace" font-size="12" fill="#5B564B">10万円</text>
      <rect x="224" y="88" width="82" height="26" rx="4" fill="#fff" stroke="#8A3B2E"/>
      <text x="265" y="106" text-anchor="middle" font-family="monospace" font-size="12" fill="#8A3B2E">20万円</text>
      <text x="160" y="136" text-anchor="middle" font-family="monospace" font-size="9.5" fill="#5B564B">減ることも、変わらないことも、増えることもある</text>
    </svg>`;
  wrap.appendChild(el('div', 'vis-cap',
    '値動きの幅を説明するための仮の例です。実際の運用結果や将来の見通しを示すものではありません。'
    + 'どのくらい動くかは商品や期間によって大きく異なります。'));
  return wrap;
}

const VISUALS = {
  range_example: visRangeExample,
  comparison_gamble: visGamble,
  comparison_where: visWhere,
  diagram_inflation: visInflation,
  diagram_risk: visRisk,
  diagram_compound: visCompound,
  diagram_diversification: visDiversification,
  flow_news: visFlow,
};

/* ─────────────────────────────────────────────────────────────
 * 共通コンポーネント
 * ───────────────────────────────────────────────────────────── */

function lessonLink(id, label) {
  const a = el('a', 'asset-more');
  a.href = 'lesson_detail.html?id=' + encodeURIComponent(id);
  /* 下線は内側の span に付け、リンク自体は 44px のタップ領域を保つ */
  a.appendChild(el('span', null, label || 'もっと詳しく見る →'));
  return a;
}

/* スクリーンリーダー向けの永続 live region（main.replaceChildren() の
   対象外に置く。新規挿入した要素に aria-live を付けても読み上げが
   保証されないブラウザがあるため、常設の領域のテキストを書き換える）。 */
function announce(text) {
  const sr = document.getElementById('sr-status');
  if (sr) sr.textContent = text;
}

/* accordion トグル。押すまで内容を構築しない（遅延構築）ことで、
   使わないユーザーには余分な DOM を作らない。 */
function accordionToggle(label, buildContent) {
  const frag = document.createDocumentFragment();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'detail-toggle';
  btn.setAttribute('aria-expanded', 'false');
  btn.appendChild(document.createTextNode(label + ' '));
  btn.appendChild(el('span', 'chev', '▾'));

  const panel = el('div', 'detail-panel');
  panel.hidden = true;
  let built = false;

  btn.addEventListener('click', () => {
    const willOpen = panel.hidden;
    if (willOpen && !built) {
      buildContent(panel);
      built = true;
    }
    panel.hidden = !willOpen;
    btn.setAttribute('aria-expanded', String(willOpen));
  });

  frag.appendChild(btn);
  frag.appendChild(panel);
  return frag;
}

/* フィードバック表示。tone: null(中立) | 'positive' | 'gentle'。
   色だけに依存しないよう、必ず短いテキストで結果を伝える。 */
function feedbackBox(text, tone, detail) {
  const box = el('div', 'feedback-box' + (tone ? ' is-' + tone : ''));
  box.appendChild(el('p', null, text));
  if (detail) box.appendChild(accordionToggle(detail.label || 'もう少し詳しく', detail.build));
  announce(text);
  return box;
}

/* ミクロ進捗（STEP内のカード送り）。マクロ進捗（STEP 0〜4のドット）とは別。 */
function microProg(index, total) {
  const wrap = el('div', 'micro-prog');
  const track = el('div', 'micro-prog-track');
  const fill = el('div', 'micro-prog-fill');
  fill.style.width = Math.round(((index + 1) / total) * 100) + '%';
  track.appendChild(fill);
  wrap.appendChild(track);
  wrap.appendChild(el('span', 'micro-prog-count', (index + 1) + ' / ' + total));
  return wrap;
}

/* ─────────────────────────────────────────────────────────────
 * STEP内の回答state（Task49.2）
 *
 * ページを開いている間だけ有効な in-memory state。sessionStorage /
 * localStorage / cookie には一切保存しない（reloadでリセットされてよい、
 * という今回の要件どおり）。STEPを離れて（Back/次のSTEPへ進んで）
 * 戻ってきても選択を復元できるよう、各STEPのカードキュー構築関数の
 * ローカル変数ではなく module-level に置く。
 *   { [step]: { [screenIndex]: selectedOptionIndex } }
 * ───────────────────────────────────────────────────────────── */

const answerState = {};

function getSelected(step, screenIndex) {
  return (answerState[step] && screenIndex in answerState[step])
    ? answerState[step][screenIndex] : null;
}

function setSelected(step, screenIndex, index) {
  if (!answerState[step]) answerState[step] = {};
  answerState[step][screenIndex] = index;
}

/* STEP内の「戻る」「次へ」ナビゲーション（Task49.2）。
   history.back() やブラウザ履歴には一切依存せず、呼び出し元が渡す
   onBack/onNext（実体は prevScreen/nextScreen）だけで完結する。
   「次へ」は回答前は disabled、回答後に有効化される（自動遷移はしない）。 */
function navRow({ backHidden, onBack, nextDisabled, nextLabel, onNext }) {
  const wrap = el('div', 'step-nav');
  let backBtn = null;
  if (!backHidden) {
    backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'nav-back';
    backBtn.textContent = '← 戻る';
    backBtn.addEventListener('click', onBack);
    wrap.appendChild(backBtn);
  } else {
    wrap.classList.add('no-back');
  }
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'nav-next';
  nextBtn.textContent = nextLabel || '次へ →';
  nextBtn.disabled = !!nextDisabled;
  nextBtn.addEventListener('click', onNext);
  wrap.appendChild(nextBtn);
  return { wrap, nextBtn, backBtn };
}

/**
 * 選択式の1問カード（1画面1メッセージ）。
 *
 * 一度回答した後も選択肢を無効化しない。何度でも選び直せて、選び直す
 * たびに selected 表示とフィードバック（正誤問題なら correct/incorrect
 * 表示も）を再計算する（Task49.2 の回答revision）。
 *
 * @param {Object}   opt
 * @param {number}   opt.step         STEP番号（answerStateのキー）
 * @param {number}   opt.screenIndex  STEP内の画面インデックス（answerStateのキー）
 * @param {string}   opt.question     問い（複数行は \n）
 * @param {string}  [opt.sub]         補足（最大2〜4行）
 * @param {string}  [opt.eyebrow]     小見出し
 * @param {Array}    opt.options      [{label, correct?}]
 * @param {boolean} [opt.graded]      true なら正誤フィードバックを出す（知識問題）
 * @param {Function} opt.onAnswer     (picked, index) => {text, detail?}
 * @param {Object}  [opt.micro]       {index, total} でミクロ進捗を表示
 * @param {boolean} [opt.backHidden]  「戻る」を出さない（Journey全体の最初の画面用）
 * @param {Function} opt.onBack       「戻る」押下時（prevScreen）
 * @param {Function} opt.onNext       「次へ」押下時（nextScreen）。回答するまでdisabled
 */
function questionCard(opt) {
  const wrap = el('div', 'screen');
  if (opt.eyebrow) wrap.appendChild(el('div', 'card-eyebrow', opt.eyebrow));
  wrap.appendChild(el('h2', 'card-q', opt.question));
  if (opt.sub) wrap.appendChild(el('p', 'card-sub', opt.sub));
  if (opt.micro) wrap.appendChild(microProg(opt.micro.index, opt.micro.total));

  const grid = el('div', 'choice-grid');
  const feedbackSlot = el('div', 'feedback-slot');
  const buttons = [];
  let selectedIndex = getSelected(opt.step, opt.screenIndex);

  function applyButtonStates() {
    buttons.forEach((btn, i) => {
      const isSelected = i === selectedIndex;
      btn.setAttribute('aria-pressed', String(isSelected));
      btn.classList.toggle('is-picked', isSelected);
      const mark = btn.querySelector('.choice-mark');
      if (opt.graded) {
        const o = opt.options[i];
        const decided = selectedIndex !== null;
        btn.classList.toggle('is-correct', decided && !!o.correct);
        btn.classList.toggle('is-incorrect', isSelected && !o.correct);
        if (mark) mark.textContent = !decided ? '' : (o.correct ? '○' : (isSelected ? '×' : ''));
      } else if (mark) {
        /* 正誤の無い質問でも、選択状態を色だけに依存させない
           （Task49.2 §6）。選んだ選択肢にだけチェックを示す。 */
        mark.textContent = isSelected ? '✓' : '';
      }
    });
  }

  opt.options.forEach((o, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice-btn';
    btn.setAttribute('aria-pressed', 'false');
    btn.appendChild(document.createTextNode(o.label));
    btn.appendChild(el('span', 'choice-mark', ''));
    btn.addEventListener('click', () => {
      selectedIndex = i;
      setSelected(opt.step, opt.screenIndex, i);
      applyButtonStates();
      renderFeedback();
      nav.nextBtn.disabled = false;
    });
    buttons.push(btn);
    grid.appendChild(btn);
  });

  function renderFeedback() {
    feedbackSlot.replaceChildren();
    if (selectedIndex === null) return;
    const picked = opt.options[selectedIndex];
    const result = opt.onAnswer(picked, selectedIndex) || {};
    const tone = opt.graded ? (picked.correct ? 'positive' : 'gentle') : null;
    feedbackSlot.appendChild(feedbackBox(result.text || '', tone, result.detail));
  }

  wrap.appendChild(grid);
  wrap.appendChild(feedbackSlot);

  const nav = navRow({
    backHidden: opt.backHidden,
    onBack: opt.onBack,
    nextDisabled: selectedIndex === null,
    onNext: opt.onNext,
  });
  wrap.appendChild(nav.wrap);

  /* 戻ってきた画面（既に answerState に選択が残っている）なら、
     選択状態とフィードバックを最初から復元する。 */
  if (selectedIndex !== null) {
    applyButtonStates();
    renderFeedback();
  }

  return wrap;
}

/* STEP0 の絶対的な最初の画面（Task49.3・first-tap activation）。
 *
 * 背景: Instagram広告 → beginner.html 到達までは機能している
 * （production analyticsで確認済み）が、旧STEP0 screen0（現在の
 * 「投資って、ちょっと怖い？」心理質問）から screen1 以降への到達が
 * ほぼ観測できていなかった。広告から初めて来たユーザーに、
 * 「なぜ答えるのか」「何が始まるのか」「どれくらいかかるのか」を
 * 示さないまま、いきなり3択の回答を要求していたことが friction の
 * 原因である可能性が高い。
 *
 * 対処: 心理質問の前に、単一のCTAだけを持つ導入画面を1枚だけ挟む。
 * 「答えてください」ではなく「この短い体験を始めてみよう」という
 * 心理状態を作ることが目的のため、選択肢・Back・進捗表示は出さない
 * （ファーストビューのprimary actionを1つだけにする）。
 *
 * 既存の質問内容・feedback・STEP1〜4は一切変更しない。コピーは
 * data/beginner_journey.json 化せず、STEP0の他の導入用画面と同じく
 * 「STEP0固有の枠組み用テキスト」としてここへ直接持たせる。
 */
function step0StartScreen(onNext) {
  const wrap = el('div', 'screen');
  wrap.appendChild(el('h2', 'card-q', '投資、3分だけ体験してみませんか？'));
  wrap.appendChild(el('p', 'card-sub',
    'いくつか選ぶだけで、投資の考え方が少しずつ分かります。正解を競うテストではありません。'));
  const ctas = el('div', 'cta-wrap');
  const cta = document.createElement('button');
  cta.type = 'button';
  cta.className = 'cta';
  cta.textContent = 'まずはやってみる →';
  cta.addEventListener('click', onNext);
  ctas.appendChild(cta);
  ctas.appendChild(el('p', 'cta-note', '登録不要・無料'));
  wrap.appendChild(ctas);
  return wrap;
}

/* STEP0 導入動画。
   自前ホスティングの <video> のみを使う（HeyGen iframe 等の外部 player
   は使わない）。Task49: ファーストビューを占有しないよう、既定では
   折りたたまれた「動画で見たい？」トグルとして表示し、タップして
   初めて <video> 要素を組み立てる。読み込み・再生に失敗しても
   Journey は質問カードだけで継続できる。Task49.2: この画面へ「戻る」で
   再訪しても自動再生はしない（トグルは既定で閉じた状態に戻る）。 */
function renderStep0Video(main) {
  const wrap = el('div', 'video-toggle-wrap');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'video-toggle';
  btn.setAttribute('aria-expanded', 'false');
  btn.appendChild(el('span', 'play', '▶ 51秒'));
  btn.appendChild(document.createTextNode('読むより動画派？ ざっくり動画で見る'));

  const box = el('div', 'video-box');
  box.hidden = true;
  box.appendChild(el('p', 'video-intro',
    '投資が少し怖いと感じる方へ。まずは51秒の動画からご覧ください（見なくても続けられます）。'));
  const video = document.createElement('video');
  video.className = 'step0-video';
  video.controls = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.poster = 'assets/video/beginner-step0-poster.jpg';
  const source = document.createElement('source');
  source.src = 'assets/video/beginner-step0.mp4';
  source.type = 'video/mp4';
  video.appendChild(source);
  video.appendChild(document.createTextNode(
    'お使いの環境では動画を再生できません。下の質問で同じ内容をご確認いただけます。'));
  video.addEventListener('error', () => { wrap.hidden = true; });
  box.appendChild(video);

  btn.addEventListener('click', () => {
    const willOpen = box.hidden;
    box.hidden = !willOpen;
    btn.setAttribute('aria-expanded', String(willOpen));
  });

  wrap.appendChild(btn);
  wrap.appendChild(box);
  main.appendChild(wrap);
}

/* 具体例ブロック。
   「価格変動があります」という抽象表現だけでは初心者に伝わらないため、
   金額で示す。ただし例示は将来予測ではないので、note を必ず添えて
   仮の例であることをブロック内で完結して示す（Task39）。 */
function exampleBlock(ex) {
  const box = el('div', 'ex');
  box.appendChild(el('div', 'ex-label', ex.label));
  const list = el('div', 'ex-lines');
  (ex.lines || []).forEach(t => list.appendChild(el('div', 'ex-line', t)));
  box.appendChild(list);
  box.appendChild(el('p', 'ex-note', ex.note));
  return box;
}

/* 外部公式ページへの参照。数値・図版は転載せず、テキストのリンクのみ。 */
function externalLink(x) {
  const wrap = el('div', 'ext-wrap');
  const a = el('a', 'ext-link');
  a.href = x.href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.appendChild(el('span', null, x.label + ' ↗'));
  wrap.appendChild(a);
  if (x.note) wrap.appendChild(el('div', 'ext-note', x.note));
  return wrap;
}

/* 操作サポート導線。投資助言ではなく操作・利用支援であることを
   ボタンの周囲で明示する。新しい backend は作らず、既存の連絡先へ
   件名付きの mailto を開くだけにとどめる。 */
function supportBlock(sp) {
  const box = el('div', 'support');
  box.appendChild(el('h3', 'support-title', sp.title));
  box.appendChild(el('p', 'support-body', sp.body));
  const a = el('a', 'support-cta');
  a.href = 'mailto:' + sp.mailto + '?subject=' + encodeURIComponent(sp.subject);
  a.textContent = sp.cta_label;
  box.appendChild(a);
  box.appendChild(el('p', 'support-note', sp.boundary));
  box.appendChild(el('p', 'support-note', sp.free_note));
  return box;
}

/* 資産1件の詳細カード（Task37Bの表現をそのまま流用）。 */
function assetCard(a) {
  const box = el('div', 'asset');
  const head = el('div', 'asset-head');
  head.appendChild(el('span', 'asset-name', a.label));
  head.appendChild(el('span', 'asset-what', a.what));
  box.appendChild(head);

  const rows = el('div', 'asset-rows');
  [['収益の源', a.income_source], ['値動き', a.movement],
   ['元本', a.principal], ['主な役割', a.role], ['主なリスク', a.risk]]
    .forEach(([k, v]) => {
      rows.appendChild(el('div', 'asset-k', k));
      rows.appendChild(el('div', null, v));
    });
  box.appendChild(rows);
  if (a.lesson_ref) box.appendChild(lessonLink(a.lesson_ref));
  return box;
}

/* STEP完了・区切りの「戻る」ボタン。質問画面のペア型ナビ（navRow）とは別に、
   大きなCTAボタンの上へ小さく添える（Task49.2）。 */
function backLink(onBack) {
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'cta-back';
  back.textContent = '← 戻る';
  back.addEventListener('click', onBack);
  return back;
}

/* ─────────────────────────────────────────────────────────────
 * STEP ごとのカードキュー構築
 *
 * 各 buildXxxQueue(step) は「画面を1枚返す関数」の配列を返す。
 * render 側はこの配列の queueIndex 番目だけを main へ描画する。
 * 最後の要素は必ず「STEP のまとめ + 次のSTEPへ」の画面にする。
 * ───────────────────────────────────────────────────────────── */

function closingScreen({ eyebrow, note, extras, ctaLabel, onCta, secondary, onBack }) {
  return () => {
    const wrap = el('div', 'screen');
    const badge = el('div', 'step-badge');
    badge.appendChild(el('span', 'check', '✓'));
    badge.appendChild(document.createTextNode(eyebrow || 'ここまでOK'));
    wrap.appendChild(badge);
    if (note) wrap.appendChild(el('p', 'note-box', note));
    (extras || []).forEach(node => wrap.appendChild(node));

    if (onBack) wrap.appendChild(backLink(onBack));

    const ctas = el('div', 'cta-wrap');
    const primary = document.createElement('button');
    primary.type = 'button';
    primary.className = 'cta';
    primary.textContent = ctaLabel;
    primary.addEventListener('click', onCta);
    ctas.appendChild(primary);
    if (secondary) {
      const s = el('a', 'cta-sub', secondary.label);
      s.href = secondary.href;
      ctas.appendChild(s);
      if (secondary.note) ctas.appendChild(el('p', 'cta-note', secondary.note));
    }
    wrap.appendChild(ctas);
    return wrap;
  };
}

/* Task49: STEP0 は元の renderStep0(step, main) という関数名・シグネチャを
   維持する（他タスクの回帰テストが「renderStep0Video(main) が
   renderStep0 の中で呼ばれていること」を検査しているため）。
   中身は「1画面1メッセージ」のカードキューを構築して返す形へ変えたが、
   関数名・呼び出し規約は変えていない。 */
function renderStep0(step, main) {
  const queue = [];
  const total = step.cards.length + 1;

  /* 0: START画面（Task49.3）。Journey全体の絶対的な最初の画面のため
     「戻る」を出さない。CTAは1つだけ。 */
  queue.push(() => step0StartScreen(() => nextScreen()));

  /* 1: フィーリングチェック（正解無し・今の感覚）。START画面から
     進んできた画面のため、ここでは「戻る」を出す（→START画面へ戻る、
     Task49.3 §8）。micro progress の分母・番号は既存のまま変更しない
     （START画面はファネルの「問い」ではないためカウントしない）。 */
  queue.push(() => questionCard({
    step: 0,
    screenIndex: 0,
    question: step.warmup.question,
    sub: step.warmup.note,
    options: step.warmup.options,
    onAnswer: (picked) => ({ text: picked.response }),
    micro: { index: 0, total },
    onBack: () => prevScreen(),
    onNext: () => nextScreen(),
  }));

  /* 1〜N: 既存6カードを1問ずつ */
  step.cards.forEach((card, i) => {
    const screenIndex = i + 1;
    queue.push(() => questionCard({
      step: 0,
      screenIndex,
      question: card.question,
      options: card.options,
      micro: { index: screenIndex, total },
      onAnswer: () => ({
        text: card.short_feedback,
        detail: {
          label: 'もう少し詳しく',
          build: (panel) => {
            panel.appendChild(el('p', 'qa-a', card.answer));
            panel.appendChild(el('p', 'qa-c', card.caution));
            if (card.example) panel.appendChild(exampleBlock(card.example));
            if (card.visual && VISUALS[card.visual]) panel.appendChild(VISUALS[card.visual]());
            if (card.external) panel.appendChild(externalLink(card.external));
          },
        },
      }),
      onBack: () => prevScreen(),
      onNext: () => nextScreen(),
    }));

    /* 最初のカードの直後にだけ、任意の動画トグルを挟む
       （ファーストビューを占有せず、かつ埋もれない位置）。
       ローカル変数名を main にしているのは renderStep0Video(main) という
       呼び出し規約（他タスクの回帰テストが検査する文字列）を保つため。 */
    if (i === 0) {
      queue.push(() => {
        const main = el('div', 'screen');
        main.appendChild(el('div', 'card-eyebrow', 'OPTIONAL'));
        main.appendChild(el('h2', 'card-q', '読むより動画派？'));
        main.appendChild(el('p', 'card-sub', '見なくても、このまま進められます。'));
        renderStep0Video(main);
        const nav = navRow({
          onBack: () => prevScreen(),
          nextDisabled: false,
          onNext: () => nextScreen(),
        });
        main.appendChild(nav.wrap);
        return main;
      });
    }
  });

  /* 最終: comparison_gamble の図 + lesson_ref + support + secondary_cta + 次へ */
  queue.push(closingScreen({
    eyebrow: 'STEP 0 完了',
    extras: [
      (() => {
        const box = el('div', 'screen');
        box.appendChild(el('div', 'sec-label', '投資とギャンブルの違い'));
        box.appendChild(VISUALS.comparison_gamble());
        step.lesson_refs.forEach(id => box.appendChild(lessonLink(id, '「投資とは何か」を読む →')));
        if (step.support) box.appendChild(supportBlock(step.support));
        return box;
      })(),
    ],
    ctaLabel: step.cta.label,
    onCta: () => {
      trackOnce('step' + step.step, 'beginner_step_complete', { step: String(step.step) });
      goto(step.cta.step);
    },
    secondary: step.secondary_cta,
    onBack: () => prevScreen(),
  }));

  return queue;
}

function buildStep1Queue(step) {
  const queue = [];

  queue.push(() => questionCard({
    step: 1,
    screenIndex: 0,
    question: step.prompt,
    options: step.assets.map(a => ({ label: a.label, key: a.key })),
    micro: { index: 0, total: 3 },
    onAnswer: () => ({ text: 'なるほど。理由も聞かせてください。' }),
    onBack: () => prevScreen(),
    onNext: () => nextScreen(),
  }));

  queue.push(() => questionCard({
    step: 1,
    screenIndex: 1,
    question: 'なぜそれを選んだ？',
    options: step.reasons,
    micro: { index: 1, total: 3 },
    onAnswer: () => ({ text: 'そう考える人は多いです。実際の性質を見てみましょう。' }),
    onBack: () => prevScreen(),
    onNext: () => nextScreen(),
  }));

  queue.push(() => {
    const wrap = el('div', 'screen');
    wrap.appendChild(el('div', 'card-eyebrow', '3 / 3'));
    /* 選んだ資産は answerState から都度読み直す（STEPを離れて戻っても
       正しい資産を再表示するため。ローカル変数へキャッシュしない）。 */
    const pickedIdx = getSelected(1, 0);
    const chosen = (pickedIdx !== null ? step.assets[pickedIdx] : null) || step.assets[0];
    wrap.appendChild(el('h2', 'card-q', chosen.label + 'の性質'));
    wrap.appendChild(assetCard(chosen));
    wrap.appendChild(accordionToggle('ほかの資産も見る', (panel) => {
      step.assets.filter(a => a.key !== chosen.key).forEach(a => panel.appendChild(assetCard(a)));
    }));
    wrap.appendChild(el('p', 'note-box', step.closing_note));

    wrap.appendChild(backLink(() => prevScreen()));

    const nextWrap = el('div', 'cta-wrap');
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'cta';
    nextBtn.textContent = step.cta.label;
    nextBtn.addEventListener('click', () => {
      trackOnce('step' + step.step, 'beginner_step_complete', { step: String(step.step) });
      goto(step.cta.step);
    });
    nextWrap.appendChild(nextBtn);
    wrap.appendChild(nextWrap);
    return wrap;
  });

  return queue;
}

function buildStep2Queue(step) {
  const queue = [];

  step.concepts.forEach((c, i) => {
    queue.push(() => questionCard({
      step: 2,
      screenIndex: i,
      eyebrow: c.title,
      question: c.quiz.question,
      options: c.quiz.options,
      graded: true,
      micro: { index: i, total: step.concepts.length },
      onAnswer: (picked) => ({
        text: picked.correct ? c.quiz.feedback_correct : c.quiz.feedback_incorrect,
        detail: {
          label: 'もう少し詳しく',
          build: (panel) => {
            panel.appendChild(el('p', null, c.summary));
            panel.appendChild(el('p', 'caution', c.caution));
            if (c.visual && VISUALS[c.visual]) panel.appendChild(VISUALS[c.visual]());
            if (c.lesson_ref) panel.appendChild(lessonLink(c.lesson_ref));
          },
        },
      }),
      onBack: () => prevScreen(),
      onNext: () => nextScreen(),
    }));
  });

  queue.push(closingScreen({
    eyebrow: 'STEP 2 完了',
    ctaLabel: step.cta.label,
    onCta: () => {
      trackOnce('step' + step.step, 'beginner_step_complete', { step: String(step.step) });
      goto(step.cta.step);
    },
    secondary: step.secondary_cta,
    onBack: () => prevScreen(),
  }));

  return queue;
}

function buildStep3Queue(step) {
  return [
    () => {
      const wrap = el('div', 'screen');
      wrap.appendChild(el('h2', 'card-q', step.intro || step.title));
      wrap.appendChild(el('p', 'card-sub', step.lead));
      const list = el('div', 'links-list');
      step.links.forEach(l => {
        const a = el('a', 'link-card');
        a.href = l.href;
        a.appendChild(el('b', null, l.label));
        a.appendChild(el('span', null, l.note));
        list.appendChild(a);
      });
      wrap.appendChild(list);

      wrap.appendChild(backLink(() => prevScreen()));

      const ctas = el('div', 'cta-wrap');
      const skip = document.createElement('button');
      skip.type = 'button';
      skip.className = 'cta-sub';
      skip.textContent = step.cta.label;
      skip.addEventListener('click', () => {
        trackOnce('step' + step.step, 'beginner_step_complete', { step: String(step.step) });
        goto(step.cta.step);
      });
      ctas.appendChild(skip);
      wrap.appendChild(ctas);
      return wrap;
    },
  ];
}

function buildStep4Queue(step) {
  const queue = [];

  queue.push(() => questionCard({
    step: 4,
    screenIndex: 0,
    question: step.opening_question.question,
    options: step.opening_question.options,
    graded: true,
    micro: { index: 0, total: 2 },
    onAnswer: (picked) => ({
      text: picked.correct ? step.opening_question.feedback_correct
                            : step.opening_question.feedback_incorrect,
    }),
    onBack: () => prevScreen(),
    onNext: () => nextScreen(),
  }));

  queue.push(() => {
    const wrap = el('div', 'screen');
    wrap.appendChild(el('div', 'card-eyebrow', '2 / 2'));
    wrap.appendChild(el('h2', 'card-q', 'ニュースを、資産ごとの追い風・逆風で整理する'));
    wrap.appendChild(el('p', 'card-sub',
      'Marketcast Lab では、ニュースを資産ごとに「追い風／逆風」という観点で整理できます。'));
    wrap.appendChild(VISUALS.flow_news(step.flow));

    wrap.appendChild(el('div', 'sec-label', 'Marketcast Lab でできること'));
    const list = el('div', 'links-list');
    step.features.forEach(f => {
      const a = el('a', 'link-card');
      a.href = f.href;
      a.appendChild(el('b', null, f.label));
      a.appendChild(el('span', null, f.note));
      list.appendChild(a);
    });
    wrap.appendChild(list);
    step.lesson_refs.forEach(id => wrap.appendChild(lessonLink(id, '「ニュースの見出しをどう読み解くか」を読む →')));

    const badge = el('div', 'step-badge');
    badge.appendChild(el('span', 'check', '✓'));
    badge.appendChild(document.createTextNode('はじめての投資 完了'));
    wrap.appendChild(badge);

    wrap.appendChild(backLink(() => prevScreen()));

    const ctas = el('div', 'cta-wrap');
    const p = el('a', 'cta', step.cta_primary.label);
    p.href = step.cta_primary.href;
    p.addEventListener('click', () => trackOnce('complete', 'beginner_complete'));
    ctas.appendChild(p);
    const s = el('a', 'cta-sub', step.cta_secondary.label);
    s.href = step.cta_secondary.href;
    ctas.appendChild(s);
    wrap.appendChild(ctas);
    return wrap;
  });

  return queue;
}

/* ─────────────────────────────────────────────────────────────
 * ルーティング / カードキュー制御
 *
 * hash（#step0…#step4）は STEP 間の移動のみに使う。STEP 内部の
 * カード送り（nextScreen/prevScreen）は hash を変えない module-level
 * state（queueIndex）で管理する。reload・直リンクでは常に各 STEP の
 * 最初のカードから始まる（queueIndex は保存しない）。
 *
 * STEP境界の「戻る」（Task49.2 §9）:
 *   STEP1〜4の画面0で「戻る」を押すと、前のSTEPの最終画面へ移動する
 *   （推奨どおり）。hashを前STEPへ更新し、enterAtLastScreen フラグで
 *   「そのSTEPの最後の画面から始める」ことを render() に伝える。
 *   STEP0の画面0（Journey全体の最初）だけは「戻る」を出さない。
 * ───────────────────────────────────────────────────────────── */

let DATA = null;
let queueIndex = 0;
let lastStepNum = null;
let currentQueue = null;
let enterAtLastScreen = false;

function currentStep() {
  const m = /^#step([0-4])$/.exec(location.hash || '');
  return m ? Number(m[1]) : 0;
}

function updateProgress(n) {
  const dots = document.getElementById('prog-dots');
  const label = document.getElementById('prog-label');
  if (!dots || !label) return;
  dots.replaceChildren();
  for (let i = 0; i <= LAST_STEP; i++) {
    const d = el('div', 'prog-dot' + (i === n ? ' is-current' : (i < n ? ' is-done' : '')));
    dots.appendChild(d);
  }
  label.textContent = `STEP ${n} / ${LAST_STEP}`;
}

function goto(n) {
  location.hash = '#step' + n;
}

/* STEP 内のカードキューを1つ戻す。screen0 では前STEPの最終画面へ移動する
   （STEP0の画面0では戻り先が無いため何もしない。呼び出し元はここへ
   backHidden:true でボタン自体を出さない）。 */
function prevScreen() {
  if (queueIndex > 0) {
    queueIndex -= 1;
    render();
    return;
  }
  const n = currentStep();
  if (n === 0) return;
  enterAtLastScreen = true;
  goto(n - 1);
}

/* STEP 内のカードキューを1つ進める（hash は変えない）。 */
function nextScreen() {
  queueIndex += 1;
  render();
}

function buildQueueForStep(step, main) {
  if (step.step === 0) return renderStep0(step, main);
  if (step.step === 1) return buildStep1Queue(step);
  if (step.step === 2) return buildStep2Queue(step);
  if (step.step === 3) return buildStep3Queue(step);
  return buildStep4Queue(step);
}

function render() {
  const n = currentStep();
  const main = document.getElementById('app');
  if (!main || !DATA) return;
  const step = DATA.steps.find(s => s.step === n) || DATA.steps[0];

  if (n !== lastStepNum) {
    lastStepNum = n;
    currentQueue = buildQueueForStep(step, main);
    queueIndex = enterAtLastScreen ? currentQueue.length - 1 : 0;
    enterAtLastScreen = false;
  }
  if (queueIndex >= currentQueue.length) {
    queueIndex = currentQueue.length - 1;
  }

  updateProgress(n);
  trackProgressOnce(n, queueIndex);

  main.replaceChildren();
  const screenNode = currentQueue[queueIndex]();
  if (screenNode) main.appendChild(screenNode);

  /* legal 導線は毎回 footer に表示する（既存の設置場所を変えない） */
  const f = el('footer', null,
    'このページは情報提供・教育目的のコンテンツです。個別の投資助言ではなく、'
    + '特定の金融商品の購入を勧めるものではありません。'
    + '図中の数値は仕組みを説明するための仮定の例であり、実際の市場データや将来の収益率を示すものではありません。'
    + '投資判断はご自身の責任で行ってください。');
  const legal = el('nav', 'legal-links');
  legal.setAttribute('aria-label', 'ご利用にあたって');
  [['tokushoho.html', '特定商取引法に基づく表記'],
   ['privacy.html', 'プライバシーポリシー'],
   ['disclaimer.html', '免責事項']].forEach(([href, label]) => {
    const a = el('a', null, label);
    a.href = href;
    legal.appendChild(a);
  });
  f.appendChild(legal);
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

  if (!location.hash) location.replace('#step0');
  trackOnce('start', 'beginner_start');
  render();
  window.addEventListener('hashchange', render);
})();
