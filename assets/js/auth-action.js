/**
 * auth-action.js — メールリンクの prefetch 対策付き本人確認ページ
 *
 * 背景:
 *   Auth メールに {{ .ConfirmationURL }} を直接置くと、メールプロバイダや
 *   セキュリティスキャナがリンクを先読み（GET）した時点で one-time token が
 *   消費され、利用者がクリックする頃には otp_expired になる。
 *
 * 対策:
 *   メールのリンク先はこのページにし、token_hash をクエリで受け取るだけにする。
 *   ページを開いただけでは検証しない。利用者がボタンを押した時にのみ
 *   verifyOtp()（POST）を実行する。GET の先読みでは token は消費されない。
 *
 * セキュリティ:
 *   - token_hash を console / DOM / ログへ出さない
 *   - 検証の成否にかかわらず URL から token_hash を除去する
 *   - next は同一オリジンの許可済み相対パスのみ（open redirect 防止）
 */

import { supabase } from './supabase-client.js';

/* ─── 定数 ─────────────────────────────────────────────────────────────── */

/**
 * verifyOtp に渡す type。値は supabase-js の EmailOtpType と
 * 本番 GoTrue の実挙動で確認済み:
 *   signup 確認 → 'email'、パスワード再設定 → 'recovery'
 */
const ALLOWED_TYPES = new Set(['email', 'recovery']);

/** next に許可する遷移先。open redirect を防ぐため完全一致の相対パスのみ。 */
const ALLOWED_NEXT = new Set([
  '/account.html',
  '/reset-password.html',
  '/login.html',
  '/index.html',
]);

/** type ごとの既定遷移先と画面文言 */
const FLOW = {
  email: {
    title: 'メールアドレスの確認',
    lead: 'メールアドレスの確認を完了します。下のボタンを押してください。',
    button: 'メールアドレスを確認する',
    defaultNext: '/account.html',
    errorLinks: [
      { text: '新規登録に戻る', href: 'signup.html' },
      { text: 'ログイン', href: 'login.html' },
    ],
  },
  recovery: {
    title: 'パスワード再設定',
    lead: 'パスワードの再設定を続けます。下のボタンを押してください。',
    button: 'パスワード再設定を続ける',
    defaultNext: '/reset-password.html',
    errorLinks: [
      { text: 'パスワード再設定メールを再送する', href: 'forgot-password.html' },
    ],
  },
};

/* ─── DOM ヘルパー ──────────────────────────────────────────────────────── */

const el = (id) => document.getElementById(id);

function setState(state) {
  const ready = el('aa-ready');
  const working = el('aa-working');
  const error = el('aa-error');
  if (ready) ready.hidden = state !== 'ready';
  if (working) working.hidden = state !== 'working';
  if (error) error.hidden = state !== 'error';
}

/**
 * エラー表示。Supabase の生エラーは利用者へ出さない。
 * @param {string} msg 日本語の説明
 * @param {Array<{text:string, href:string}>} links
 */
function showError(msg, links) {
  const msgEl = el('aa-error-msg');
  if (msgEl) msgEl.textContent = msg;
  const linksEl = el('aa-error-links');
  if (linksEl) {
    linksEl.replaceChildren();
    for (const { text, href } of links || []) {
      const a = document.createElement('a');
      a.textContent = text;
      a.href = href;
      linksEl.appendChild(a);
      linksEl.appendChild(document.createTextNode('　'));
    }
  }
  setState('error');
}

/* ─── next の検証 ───────────────────────────────────────────────────────── */

/**
 * next パラメータを検証する。
 * 許可リストにある同一オリジンの相対パスのみ通す。
 * 絶対URL・プロトコル相対URL・未知のパスはすべて既定値へフォールバックする。
 */
export function safeNext(raw, defaultNext) {
  if (typeof raw !== 'string' || raw === '') return defaultNext;
  // 絶対URL（https://evil.example）やプロトコル相対（//evil.example）を除外
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return defaultNext;
  if (raw.startsWith('//')) return defaultNext;
  if (!raw.startsWith('/')) return defaultNext;
  // クエリ・フラグメントを落として純粋なパスだけを許可リストと突き合わせる
  const path = raw.split('?')[0].split('#')[0];
  return ALLOWED_NEXT.has(path) ? path : defaultNext;
}

/* ─── URL から token_hash を除去 ────────────────────────────────────────── */

function stripSensitiveParams() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('token_hash');
    url.searchParams.delete('token');
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  } catch (_) {
    /* URL 操作に失敗しても本処理は続行する */
  }
}

/* ─── 本体 ──────────────────────────────────────────────────────────────── */

function init() {
  const params = new URLSearchParams(window.location.search);
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  const flow = ALLOWED_TYPES.has(type) ? FLOW[type] : null;

  // type 不正・token 欠落は、この時点でエラー表示（検証は行わない）
  if (!flow || !tokenHash) {
    stripSensitiveParams();
    showError(
      'このリンクは無効または期限切れです。もう一度メールを送信してください。',
      (FLOW[type] && FLOW[type].errorLinks) || [
        { text: 'ログイン', href: 'login.html' },
      ],
    );
    return;
  }

  const next = safeNext(params.get('next'), flow.defaultNext);

  const titleEl = el('aa-title');
  const leadEl = el('aa-lead');
  const btn = el('aa-confirm');
  if (titleEl) titleEl.textContent = flow.title;
  if (leadEl) leadEl.textContent = flow.lead;
  if (btn) btn.textContent = flow.button;

  setState('ready');

  if (!btn) return;

  // ここが要点: ページロードでは検証しない。クリック時にのみ verifyOtp を呼ぶ。
  let submitted = false;
  btn.addEventListener('click', async () => {
    if (submitted) return;
    submitted = true;
    btn.disabled = true;
    setState('working');

    let result;
    try {
      result = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    } catch (_) {
      // 例外の中身は token を含みうるため出力しない
      stripSensitiveParams();
      submitted = false;
      btn.disabled = false;
      showError(
        '確認に失敗しました。通信環境をご確認のうえ、もう一度お試しください。',
        flow.errorLinks,
      );
      return;
    }

    // 成否にかかわらず URL から token_hash を消す
    stripSensitiveParams();

    if (result && result.error) {
      submitted = false;
      btn.disabled = false;
      showError(
        'このリンクは無効または期限切れです。もう一度メールを送信してください。',
        flow.errorLinks,
      );
      return;
    }

    window.location.replace(next);
  });
}

if (!window.MEMBERSHIP_SUSPENDED) {
  init();
} else {
  stripSensitiveParams();
  showError(
    '会員機能は現在提供を停止しています。公開コンテンツは引き続きご覧いただけます。',
    [{ text: 'トップへ戻る', href: 'index.html' }],
  );
}
