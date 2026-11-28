/**
 * glossary-linker.js
 *
 * data/glossary_terms.json を参照し、本文中に出てくる用語を
 * glossary.html#term-xxx へ半自動でリンク化する。
 *
 * 対象ページ: lesson_detail / theme_detail / asset_detail / event_detail
 * （いずれも本文を #content 配下に描画する既存構造に合わせている）。
 *
 * 設計方針:
 *   - 過剰リンクを避ける。1用語につき本文内で最初の1回だけリンク化する
 *     （同じ用語の別表記＝aliasでの再マッチも含めて、用語IDごとに1回のみ）。
 *   - 長い用語・別表記を優先してマッチさせる（例: 「リスクオン」を先に確定させ、
 *     部分文字列の「リスク」が横取りしないようにする）。
 *   - 既存の <a> / <script> / <style> / <code> / <pre> / <button> / <footer> の中、
 *     および本モジュール以外が生成するUI（学習進捗・お気に入りボックス）の中は
 *     対象にしない。
 *   - JSON取得やDOM走査に失敗しても、ページ表示自体は壊さない（例外を投げない）。
 *   - 用語文字列は正規表現の特殊文字を含みうるため、必ずエスケープしてから使う。
 */

/**
 * リンク化の走査から除外する祖先要素（本文以外・自己生成UI）。
 *
 * a / script / style / code / pre / button / footer: 仕様で明示された除外対象。
 * h1,h2,h3 / .breadcrumb / .tag-block: 見出し・パンくず・原因結果タグの行。
 *   これらは本文プローズではなくラベル/ナビゲーションであり、かつ本文より先に
 *   DOM上へ出現するため、除外しないと用語の「最初の1回」がここに奪われてしまう
 *   （例: パンくず「トップ／分散投資とは何か」内の「分散投資」が先にリンク化され、
 *   本文中の用語が結果的にリンクされなくなる）。
 * .lp-box / .fav-box / #learning-progress / #favorite-toggle: 学習進捗・お気に入りUI。
 * .glossary-link: 二重処理防止（このモジュール自身が生成したリンク）。
 */
const SKIP_SELECTOR =
  'a, script, style, code, pre, button, footer, h1, h2, h3, ' +
  '.breadcrumb, .tag-block, .cat-badge, ' +
  '.lp-box, .fav-box, #learning-progress, #favorite-toggle, .glossary-link';

/** 誤マッチを避けるための最小マッチ長（1文字の代名詞的な語を除外）。 */
const MIN_MATCH_LENGTH = 2;

/** 正規表現の特殊文字をエスケープする。 */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * glossary_terms.json から、本文マッチ候補のフラットな配列を作る。
 * term.term と term.aliases の両方を候補にし、同じ term.id を指す。
 * 長い文字列から優先してマッチさせるため、長さ降順に並べる。
 *
 * @param {object} glossaryDoc data/glossary_terms.json の内容
 * @returns {Array<{text: string, termId: string}>}
 */
function buildCandidates(glossaryDoc) {
  const terms = Array.isArray(glossaryDoc && glossaryDoc.terms) ? glossaryDoc.terms : [];
  const candidates = [];
  const seenText = new Set();

  terms.forEach((t) => {
    if (!t || !t.id) return;
    const texts = [t.term, ...(Array.isArray(t.aliases) ? t.aliases : [])];
    texts.forEach((text) => {
      const s = String(text || '').trim();
      if (s.length < MIN_MATCH_LENGTH) return;
      if (seenText.has(s)) return; // 同一文字列の重複候補は避ける
      seenText.add(s);
      candidates.push({ text: s, termId: t.id });
    });
  });

  candidates.sort((a, b) => b.text.length - a.text.length);
  return candidates;
}

/**
 * 祖先方向に SKIP_SELECTOR に一致する要素があるかを判定する。
 * @param {Node} node
 * @param {Element} root 走査のルート（このルート自身は対象に含める）
 */
function isInsideSkippedAncestor(node, root) {
  let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (el && el !== root.parentElement) {
    if (el !== root && el.matches && el.matches(SKIP_SELECTOR)) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * 1つのテキストノードに対して、未使用の候補の中から
 * 「最も左（最速）に出現し、同着なら最長」の一致を1件探す。
 *
 * @returns {{index: number, length: number, termId: string}|null}
 */
function findBestMatch(text, candidates, usedTermIds) {
  let best = null;
  for (const c of candidates) {
    if (usedTermIds.has(c.termId)) continue;
    const idx = text.indexOf(c.text);
    if (idx === -1) continue;
    if (!best || idx < best.index || (idx === best.index && c.text.length > best.length)) {
      best = { index: idx, length: c.text.length, termId: c.termId };
    }
  }
  return best;
}

/**
 * root 配下のテキストノードを走査し、用語を glossary.html#term-xxx へ半自動リンク化する。
 * 副作用として DOM を書き換える。例外は投げない。
 *
 * @param {Element} root リンク化の対象範囲（例: #content）
 * @param {object} glossaryDoc data/glossary_terms.json の内容
 * @returns {number} リンク化した用語数
 */
export function linkGlossaryTerms(root, glossaryDoc) {
  if (!root || !glossaryDoc) return 0;

  const candidates = buildCandidates(glossaryDoc);
  if (candidates.length === 0) return 0;

  const usedTermIds = new Set();
  let linkedCount = 0;

  try {
    // 走査対象のテキストノードを先に確定してから処理する
    // （TreeWalker中にDOMを書き換えると走査が壊れるため）。
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (isInsideSkippedAncestor(node, root)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes = [];
    let n;
    // eslint-disable-next-line no-cond-assign
    while ((n = walker.nextNode())) textNodes.push(n);

    for (const textNode of textNodes) {
      if (usedTermIds.size >= candidates.length) break;

      let node = textNode;
      // 1つのテキストノード内に複数の未使用用語が含まれる場合に対応するため、
      // マッチ→分割→残り部分で再検索、を繰り返す。
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const text = node.nodeValue;
        const match = findBestMatch(text, candidates, usedTermIds);
        if (!match) break;

        const before = text.slice(0, match.index);
        const matched = text.slice(match.index, match.index + match.length);
        const after = text.slice(match.index + match.length);

        const a = document.createElement('a');
        a.className = 'glossary-link';
        a.href = `glossary.html#term-${encodeURIComponent(match.termId)}`;
        a.title = '用語解説を見る';
        a.textContent = matched;

        const afterNode = document.createTextNode(after);
        const parent = node.parentNode;
        if (!parent) break;

        if (before) {
          const beforeNode = document.createTextNode(before);
          parent.insertBefore(beforeNode, node);
        }
        parent.insertBefore(a, node);
        parent.insertBefore(afterNode, node);
        parent.removeChild(node);

        usedTermIds.add(match.termId);
        linkedCount += 1;

        // 残りテキストの中にまだ未使用用語がありうるので継続する
        node = afterNode;
      }
    }
  } catch (_) {
    // DOM操作で想定外の例外が起きても、ページ表示は継続させる。
  }

  return linkedCount;
}

/**
 * glossary_terms.json を取得し、root 配下に半自動リンクを適用する便利関数。
 * fetch 失敗時は何もしない（ページ表示を壊さない）。
 *
 * @param {Element|string} rootOrId Element または要素ID
 */
export async function autoLinkGlossaryTerms(rootOrId) {
  const root = typeof rootOrId === 'string' ? document.getElementById(rootOrId) : rootOrId;
  if (!root) return 0;

  let glossaryDoc;
  try {
    const res = await fetch('data/glossary_terms.json', { cache: 'no-store' });
    glossaryDoc = await res.json();
  } catch (_) {
    return 0;
  }

  return linkGlossaryTerms(root, glossaryDoc);
}

// escapeRegExp は将来的に正規表現ベースの一括置換へ切り替える際のために公開しておく
// （現在の実装は indexOf ベースで正規表現を使わないため未使用だが、意図的に残す）。
export { escapeRegExp };
