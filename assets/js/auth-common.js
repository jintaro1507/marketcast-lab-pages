/**
 * [data-auth-link] 要素を認証状態に応じて切り替える
 * - 未ログイン: テキスト「ログイン」、href="login.html"
 * - ログイン済み: テキスト「アカウント」、href="account.html"
 */
function updateAuthLinks(session) {
  const links = document.querySelectorAll('[data-auth-link]');
  links.forEach(link => {
    if (session) {
      link.textContent = 'アカウント';
      link.href = 'account.html';
    } else {
      link.textContent = 'ログイン';
      link.href = 'login.html';
    }
  });
}

// Marketcast Pause Preflight: 会員機能停止中は Supabase に一切接続しない。
// ナビの認証リンクは静的に「停止中」表示へ固定し、遷移も無効化する。
function suspendAuthLinks() {
  const links = document.querySelectorAll('[data-auth-link]');
  links.forEach(link => {
    link.textContent = '会員機能停止中';
    link.removeAttribute('href');
    link.setAttribute('aria-disabled', 'true');
    link.style.pointerEvents = 'none';
    link.style.opacity = '0.6';
  });
}

if (window.MEMBERSHIP_SUSPENDED) {
  suspendAuthLinks();
} else {
  initAuthLinks();
}

async function initAuthLinks() {
  const { supabase } = await import('./supabase-client.js');
  // 初期セッション確認
  try {
    const { data } = await supabase.auth.getSession();
    updateAuthLinks(data.session);
  } catch (_) {
    updateAuthLinks(null);
  }

  // セッション変化を監視してナビゲーションをリアクティブに更新
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    updateAuthLinks(session);
  });

  // ページ離脱時に購読解除
  window.addEventListener('pagehide', () => {
    subscription.unsubscribe();
  }, { once: true });
}
