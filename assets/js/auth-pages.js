import { supabase } from './supabase-client.js';

// ベースURL（emailRedirectTo / redirectTo 用）
const BASE_URL = 'https://marketcast.oneshorejp.com/';

// ======================================================
// エラーメッセージ変換
// ======================================================
const ERROR_MAP = [
  // ログイン認証失敗
  { code: 'invalid_credentials',
    pattern: /invalid login credentials/i,
    msg: 'メールアドレスまたはパスワードが正しくありません。' },
  // メール未確認
  { code: 'email_not_confirmed',
    pattern: /email not confirmed/i,
    msg: 'メールアドレスの確認が完了していません。確認メールをご確認ください。' },
  // メール形式不正
  { code: 'invalid_email',
    pattern: /invalid email|unable to validate email/i,
    msg: '有効なメールアドレスを入力してください。' },
  // 弱いパスワード
  { code: 'weak_password',
    pattern: /weak password|password should be at least/i,
    msg: 'パスワードは8文字以上で入力してください。' },
  // レート制限
  { code: 'over_email_send_rate_limit',
    pattern: /rate limit|too many requests|email rate limit exceeded|over.*email.*limit|for security purposes.*only.*request/i,
    msg: 'しばらく時間をおいてから再度お試しください。' },
  // セッション不在
  { code: 'session_not_found',
    pattern: /auth session missing/i,
    msg: 'セッションが見つかりません。再度ログインしてください。' },
];

// 既存ユーザー登録エラーのパターン（signup 専用: 成功案内へ変換）
const ALREADY_REGISTERED_PATTERNS = [
  /user already registered/i,
  /email already in use/i,
  /already been registered/i,
];
const ALREADY_REGISTERED_CODES = ['user_already_exists', 'email_exists'];

function isAlreadyRegisteredError(err) {
  if (!err) return false;
  if (err.code && ALREADY_REGISTERED_CODES.includes(err.code)) return true;
  const raw = (err.message || '').toLowerCase();
  return ALREADY_REGISTERED_PATTERNS.some(p => p.test(raw));
}

function toJaMsg(err) {
  if (!err) return 'エラーが発生しました。時間をおいて再度お試しください。';
  // code が存在する場合は優先して判定
  if (err.code) {
    const byCode = ERROR_MAP.find(e => e.code === err.code);
    if (byCode) return byCode.msg;
  }
  // pattern フォールバック
  const raw = (err.message || err.msg || String(err)).toLowerCase();
  for (const { pattern, msg } of ERROR_MAP) {
    if (pattern.test(raw)) return msg;
  }
  return 'エラーが発生しました。時間をおいて再度お試しください。';
}

// ======================================================
// UI ヘルパー
// ======================================================
function showMsg(el, text, isError) {
  if (!el) return;
  el.textContent = text;
  el.className = isError ? 'auth-msg auth-msg--error' : 'auth-msg auth-msg--ok';
  el.hidden = false;
}

function setLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
  btn.textContent = loading ? '処理中…' : btn.dataset.originalText;
}

// メールアドレス形式検証（ブラウザの validity を利用）
function isEmailInvalid(inputEl) {
  return inputEl.validity.typeMismatch || inputEl.validity.valueMissing;
}

// ======================================================
// ページ: login
// ======================================================
function initLogin() {
  const msgEl = document.getElementById('auth-message');
  const form  = document.getElementById('login-form');

  // ログイン済みなら account.html へ固定遷移
  (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        window.location.href = 'account.html';
        return;
      }
    } catch (_) { /* セッション取得失敗は無視してフォーム表示継続 */ }

    // 確認メールリンク後の表示判定
    // hash（#key=value&...）を URLSearchParams で安全に解析
    const params     = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));

    // query / hash のいずれかに error または error_code が存在するか
    const errorCode = params.get('error_code') || hashParams.get('error_code') || '';
    const hasError  = !!(params.get('error') || hashParams.get('error') || errorCode);

    if (hasError) {
      // 優先1: otp_expired
      if (errorCode === 'otp_expired') {
        showMsg(msgEl,
          '確認リンクが期限切れまたは使用済みです。すでに確認済みの場合は、そのままログインしてください。ログインできない場合は、確認メールを再送してください。',
          true
        );
      } else {
        // 優先2: その他の認証エラー
        showMsg(msgEl,
          'メールアドレスの確認に失敗しました。確認メールを再送して、もう一度お試しください。',
          true
        );
      }
    } else if (params.get('confirmed') === '1') {
      // 優先3: エラーなし confirmed=1
      showMsg(msgEl, 'メールアドレスの確認が完了しました。ログインしてください。', false);
    }
    // 優先4: 何も表示しない（通常ログイン画面）
  })();

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const emailInput = form.querySelector('[name="email"]');
    const email      = emailInput.value.trim();
    const password   = form.querySelector('[name="password"]').value;
    const btn        = form.querySelector('[type="submit"]');

    // クライアント検証
    if (!email || !password) {
      showMsg(msgEl, 'メールアドレスとパスワードを入力してください。', true);
      return;
    }
    if (isEmailInvalid(emailInput)) {
      showMsg(msgEl, '有効なメールアドレスを入力してください。', true);
      return;
    }

    setLoading(btn, true);
    msgEl && (msgEl.hidden = true);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        showMsg(msgEl, toJaMsg(error), true);
        return;
      }
      window.location.href = 'index.html';
    } catch (_) {
      showMsg(msgEl, 'エラーが発生しました。時間をおいて再度お試しください。', true);
    } finally {
      setLoading(btn, false);
    }
  });
}

// ======================================================
// ページ: signup
// ======================================================
function initSignup() {
  const form  = document.getElementById('signup-form');
  const msgEl = document.getElementById('auth-message');

  // ログイン済みなら account.html へ固定遷移
  (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        window.location.href = 'account.html';
        return;
      }
    } catch (_) { /* セッション取得失敗は無視してフォーム表示継続 */ }
  })();

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const emailInput   = form.querySelector('[name="email"]');
    const email        = emailInput.value.trim();
    const password     = form.querySelector('[name="password"]').value;
    const confirm      = form.querySelector('[name="confirm-password"]').value;
    const btn          = form.querySelector('[type="submit"]');

    // クライアント検証
    if (!email || !password || !confirm) {
      showMsg(msgEl, 'すべての項目を入力してください。', true);
      return;
    }
    if (isEmailInvalid(emailInput)) {
      showMsg(msgEl, '有効なメールアドレスを入力してください。', true);
      return;
    }
    if (password.length < 8) {
      showMsg(msgEl, 'パスワードは8文字以上で入力してください。', true);
      return;
    }
    if (password !== confirm) {
      showMsg(msgEl, 'パスワードが一致しません。', true);
      return;
    }
    // 外国第三者提供への明示同意（Task40.3）。
    // 既定は未チェックで、本人が操作しない限り登録へ進めない。
    const consentBox = form.querySelector('#foreign-transfer-consent');
    if (consentBox && !consentBox.checked) {
      showMsg(msgEl,
        '外国にある第三者への個人データの提供についてご確認のうえ、同意にチェックしてください。',
        true);
      consentBox.focus();
      return;
    }

    setLoading(btn, true);
    msgEl && (msgEl.hidden = true);

    try {
      // 同意した版を signUp リクエストへ載せる。auth.users への INSERT を
      // トリガが受けて、アカウント作成と同じタイミングでサーバ側に法29条の
      // 記録を作る。メール確認が有効でセッションが無い状態でも記録が残る。
      // metadata は本人が書き換えうるためトリガの入力に使うだけで、
      // 証跡の正本は user_consents の行とする。
      const { CONSENT_VERSION } = await import('./consent.js');
      const { data: signUpData, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: BASE_URL + 'login.html?confirmed=1',
          data: { foreign_transfer_consent_version: CONSENT_VERSION },
        },
      });

      // メール確認が有効な構成では、この時点でセッションが無い。
      // その場合は証跡を書けないため、初回ログイン時に account 側の
      // 同意ゲートが受け止める（そこでも書けなければ会員機能へ進めない）。
      if (!error && signUpData && signUpData.session && signUpData.user) {
        try {
          const { recordConsent } = await import('./consent.js');
          await recordConsent(supabase, signUpData.user.id);
        } catch (_) { /* 失敗しても同意ゲートが後段で担保する */ }
      }

      if (error) {
        // 既存ユーザー登録エラーのみ成功案内へ変換（ユーザー列挙防止）
        if (isAlreadyRegisteredError(error)) {
          form.hidden = true;
          showMsg(msgEl,
            '登録可能な場合は確認メールを送信しました。メールをご確認ください。',
            false
          );
          return;
        }
        // それ以外のエラー（通信障害・Rate Limit・無効メール・弱いパスワード等）
        showMsg(msgEl, toJaMsg(error), true);
        return;
      }

      // 正常登録成功
      form.hidden = true;
      showMsg(msgEl,
        '登録可能な場合は確認メールを送信しました。メールをご確認ください。',
        false
      );
    } catch (_) {
      showMsg(msgEl, 'エラーが発生しました。時間をおいて再度お試しください。', true);
    } finally {
      setLoading(btn, false);
    }
  });
}

// ======================================================
// ページ: forgot-password
// ======================================================
function initForgotPassword() {
  const form  = document.getElementById('forgot-form');
  const msgEl = document.getElementById('auth-message');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const emailInput = form.querySelector('[name="email"]');
    const email      = emailInput.value.trim();
    const btn        = form.querySelector('[type="submit"]');

    // クライアント検証
    if (!email) {
      showMsg(msgEl, 'メールアドレスを入力してください。', true);
      return;
    }
    if (isEmailInvalid(emailInput)) {
      showMsg(msgEl, '有効なメールアドレスを入力してください。', true);
      return;
    }

    setLoading(btn, true);
    msgEl && (msgEl.hidden = true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: BASE_URL + 'reset-password.html',
      });

      if (error) {
        showMsg(msgEl, toJaMsg(error), true);
        return;
      }

      // 成功時: メールアドレス存在有無にかかわらず同一メッセージ
      form.hidden = true;
      showMsg(msgEl,
        '登録済みのメールアドレスの場合は、再設定メールを送信しました。',
        false
      );
    } catch (_) {
      showMsg(msgEl, 'エラーが発生しました。時間をおいて再度お試しください。', true);
    } finally {
      setLoading(btn, false);
    }
  });
}

// ======================================================
// ページ: reset-password
// ======================================================
function initResetPassword() {
  const formWrapper  = document.getElementById('reset-form-wrapper');
  const form         = document.getElementById('reset-form');
  const msgEl        = document.getElementById('auth-message');
  const checkingEl   = document.getElementById('reset-checking');
  const invalidEl    = document.getElementById('reset-invalid');

  // --- 状態管理（loading / invalid / ready の排他制御）---
  function setResetState(state) {
    if (checkingEl)  checkingEl.hidden  = (state !== 'loading');
    if (invalidEl)   invalidEl.hidden   = (state !== 'invalid');
    if (formWrapper) formWrapper.hidden = (state !== 'ready');
  }

  // 回復セッション確認フラグ
  let recoveryReady = false;

  // 初期状態: loading
  setResetState('loading');

  // タイマーを先に作成することで、PASSWORD_RECOVERY が購読登録直後に発火しても
  // clearTimeout(timerId) が有効な値を参照できる
  let timerId = setTimeout(() => {
    timerId = null;
    recoveryReady = false;
    setResetState('invalid');
  }, 10000);

  // 回復セッションが確認できた時点でフォームを開く共通処理
  function markRecoveryReady() {
    if (recoveryReady) return;
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    recoveryReady = true;
    setResetState('ready');
  }

  // PASSWORD_RECOVERY を onAuthStateChange で購読
  // （メールリンクのtokenをこのページ自身が処理する従来経路）
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, _session) => {
    if (event === 'PASSWORD_RECOVERY') {
      markRecoveryReady();
    }
  });

  // auth-action.html で verifyOtp 済みの場合、このページ到達時には既に
  // セッションが成立しており PASSWORD_RECOVERY は発火しない。
  // 既存セッションがあれば回復済みとして扱う。
  // （updateUser の認可はサーバ側セッション検証が担うため、ここでの判定は
  //   フォーム表示可否のみに用いる）
  supabase.auth.getSession()
    .then(({ data }) => {
      if (data && data.session) markRecoveryReady();
    })
    .catch(() => { /* 取得失敗時はタイマーによる invalid 表示に委ねる */ });

  // ページ離脱時: タイマーと購読の両方を解除
  window.addEventListener('pagehide', () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    subscription.unsubscribe();
  }, { once: true });

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // 回復セッションが確認できていない場合はフォーム送信を拒否
    if (!recoveryReady) {
      showMsg(
        msgEl,
        '再設定リンクが無効または期限切れです。再度パスワード再設定を行ってください。',
        true
      );
      return;
    }

    const newPass = form.querySelector('[name="new-password"]').value;
    const confirm = form.querySelector('[name="confirm-password"]').value;
    const btn     = form.querySelector('[type="submit"]');

    if (!newPass || !confirm) {
      showMsg(msgEl, '新しいパスワードを入力してください。', true);
      return;
    }
    if (newPass.length < 8) {
      showMsg(msgEl, 'パスワードは8文字以上で入力してください。', true);
      return;
    }
    if (newPass !== confirm) {
      showMsg(msgEl, 'パスワードが一致しません。', true);
      return;
    }

    setLoading(btn, true);
    msgEl && (msgEl.hidden = true);

    try {
      const { error } = await supabase.auth.updateUser({ password: newPass });
      if (error) {
        showMsg(msgEl, toJaMsg(error), true);
        return;
      }
      form.hidden = true;
      showMsg(msgEl, 'パスワードを更新しました。', false);
      // 3秒後にログインページへ誘導
      setTimeout(() => {
        window.location.href = 'login.html';
      }, 3000);
    } catch (_) {
      showMsg(msgEl, 'エラーが発生しました。時間をおいて再度お試しください。', true);
    } finally {
      setLoading(btn, false);
    }
  });
}

// ======================================================
// ページ: account
// ======================================================

// status → 表示ラベルのマッピング
const PLAN_LABEL_MAP = {
  trialing:           'トライアル中',
  active:             '有料プラン',
  past_due:           'お支払い確認中',
  canceled:           '解約済み',
  unpaid:             'お支払い未完了',
  paused:             '一時停止中',
  incomplete:         'お申し込み手続き中',
  incomplete_expired: 'お申し込み手続き期限切れ',
};

// current_period_end を「〇〇年〇〇月〇〇日」形式に変換
// 変換失敗時は null を返す
function formatPeriodEnd(value) {
  if (value == null) return null;
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('ja-JP', {
      year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo',
    });
  } catch (_) {
    return null;
  }
}

// プラン表示要素の排他制御
// state: 'loading' | 'ok' | 'error'
function setPlanState(state, planLabel, periodLabel, cancelNotice = null) {
  const loadingEl = document.getElementById('plan-loading');
  const nameEl    = document.getElementById('plan-name');
  const periodEl  = document.getElementById('plan-period');
  const cancelEl  = document.getElementById('plan-cancel-notice');
  const errorEl   = document.getElementById('plan-error');

  if (loadingEl) loadingEl.hidden = (state !== 'loading');
  if (nameEl)    nameEl.hidden    = (state !== 'ok');
  if (periodEl)  periodEl.hidden  = (state !== 'ok') || !periodLabel;
  if (cancelEl)  cancelEl.hidden  = (state !== 'ok') || !cancelNotice;
  if (errorEl)   errorEl.hidden   = (state !== 'error');

  if (state === 'ok') {
    if (nameEl)   nameEl.textContent   = planLabel  || '';
    if (periodEl && periodLabel) periodEl.textContent = '現在の契約期間：' + periodLabel + 'まで';
    if (cancelEl && cancelNotice) cancelEl.textContent = cancelNotice;
  }
  if (state === 'error' && errorEl) {
    errorEl.textContent = 'プラン情報を取得できませんでした。時間をおいて再度お試しください。';
  }
}

function initAccount() {
  const emailEl   = document.getElementById('account-email');
  const logoutBtn = document.getElementById('logout-btn');

  (async () => {
    // 1. セッション取得
    let session;
    try {
      const { data } = await supabase.auth.getSession();
      session = data.session;
    } catch (_) {
      window.location.href = 'login.html';
      return;
    }

    // 2. 未ログインなら login.html へ固定遷移
    if (!session) {
      window.location.href = 'login.html';
      return;
    }

    // 2.5 外国第三者提供の同意ゲート（Task40.3）
    //     現行版の同意が無い場合はここで止める。signUp 直後にセッションが
    //     無い構成でも、証跡の保存に失敗した場合でも、最初に会員機能へ来た
    //     時点でここが受け止める。会員機能ブロックは表示しない。
    {
      const { requireConsent } = await import('./consent.js');
      const slot = document.getElementById('consent-gate-slot');
      const ok = await requireConsent(supabase, slot);
      if (!ok) {
        document.querySelectorAll('.account-section, #logout-btn')
          .forEach(el => { el.hidden = true; });
        return;
      }
    }

    // 3. メールアドレス表示
    if (emailEl) emailEl.textContent = session.user.email;

    // 4. user_id 取得
    const userId = session.user.id;

    // 5. subscriptions SELECT
    try {
      const { data: sub, error } = await supabase
        .from('subscriptions')
        .select('user_id,status,current_period_end,cancel_at_period_end')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        // SELECTエラー → 一般的な文言のみ表示
        setPlanState('error');
        return;
      }

      // 6. 行なし／行あり を表示
      if (sub === null) {
        // 行なし = 無料プラン
        setPlanState('ok', '無料プラン', null);
        return;
      }

      let label = PLAN_LABEL_MAP[sub.status];

      if (!label) {
        setPlanState('error');
        return;
      }

      const period = formatPeriodEnd(sub.current_period_end);
      let cancelNotice = null;
      if (sub.cancel_at_period_end && (sub.status === 'active' || sub.status === 'trialing')) {
        label += '（解約予約中）';
        const dateStr = formatPeriodEnd(sub.current_period_end);
        const datePart = dateStr ? dateStr + 'に解約されます。' : '期末に解約されます。';
        cancelNotice = datePart + 'それまでは有料機能をご利用いただけます。';
      }
      setPlanState('ok', label, period, cancelNotice);

    } catch (_) {
      setPlanState('error');
    }
  })();

  // 7. ログアウト処理（既存機能を維持）
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      setLoading(logoutBtn, true);
      try {
        await supabase.auth.signOut();
        window.location.href = 'index.html';
      } catch (_) {
        setLoading(logoutBtn, false);
      }
    });
  }
}

// ======================================================
// エントリポイント：data-auth-page で分岐
// ======================================================
// Marketcast Pause Preflight: 会員機能停止中は Supabase Auth に一切接続しない。
// 停止バナー・導線無効化は各ページの静的マークアップが担う。
if (!window.MEMBERSHIP_SUSPENDED) {
  const page = document.body.dataset.authPage;
  switch (page) {
    case 'login':           initLogin();           break;
    case 'signup':          initSignup();          break;
    case 'forgot-password': initForgotPassword();  break;
    case 'reset-password':  initResetPassword();   break;
    case 'account':         initAccount();         break;
  }
}
