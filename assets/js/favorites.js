/**
 * favorites.js
 *
 * お気に入り（favorites テーブル）の共通モジュール。
 * lesson_detail / theme_detail / asset_detail / event_detail の「お気に入り」UI と、
 * dashboard の最近のお気に入り表示から使用する。
 *
 * learning-progress.js と同じ設計方針を踏襲する：
 *   - Supabase client は動的 import する。MEMBERSHIP_SUSPENDED 中は import 自体を行わず、
 *     Supabase が停止・到達不能でもページが壊れないようにする。
 *   - 失敗は例外を投げず、呼び出し側が表示を継続できる戻り値を返す。
 *   - 匿名ユーザーの書き込みは行わない。
 *
 * learning-progress.js との違い：
 *   - お気に入りは完全に opt-in。ページ閲覧だけで自動登録はしない
 *     （learning_progress の viewed 自動記録に相当する処理は行わない）。
 *   - エラー時は console にも残す（呼び出し元での原因追跡のため）。
 *     ただし session・トークン等の機微情報は出力しない。
 */

/** お気に入りが利用できない理由。UI の出し分けに使う。 */
export const UNAVAILABLE = {
  SUSPENDED: 'suspended',
  UNAUTHENTICATED: 'unauthenticated',
  CONSENT_REQUIRED: 'consent_required',
  ERROR: 'error',
};

const VALID_CONTENT_TYPES = new Set(['lesson', 'theme', 'asset', 'event']);

/**
 * お気に入り機能が使えるかを判定し、使える場合は supabase client と userId を返す。
 *
 * @returns {Promise<{ok: true, supabase: object, userId: string}
 *                  | {ok: false, reason: string}>}
 */
export async function getFavoritesContext() {
  // Marketcast Pause Preflight: 会員機能停止中は Supabase に一切接続しない。
  if (typeof window !== 'undefined' && window.MEMBERSHIP_SUSPENDED) {
    return { ok: false, reason: UNAVAILABLE.SUSPENDED };
  }

  let supabase;
  try {
    ({ supabase } = await import('./supabase-client.js'));
  } catch (_) {
    console.error('[favorites] supabase client を読み込めませんでした');
    return { ok: false, reason: UNAVAILABLE.ERROR };
  }

  let session;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error('[favorites] getSession でエラーが発生しました');
      return { ok: false, reason: UNAVAILABLE.ERROR };
    }
    session = data.session;
  } catch (_) {
    console.error('[favorites] getSession で例外が発生しました');
    return { ok: false, reason: UNAVAILABLE.ERROR };
  }

  if (!session) return { ok: false, reason: UNAVAILABLE.UNAUTHENTICATED };

  // 外国第三者提供への同意が無い状態では個人データを保存・取得しない（Task40.3）。
  // 表示の抑制ではなくデータ処理そのものを止める。同意はアカウントページの
  // ゲートで取得する。
  try {
    const { hasCurrentConsent } = await import('./consent.js');
    const consented = await hasCurrentConsent(supabase, session.user.id);
    if (consented !== true) {
      return { ok: false, reason: UNAVAILABLE.CONSENT_REQUIRED };
    }
  } catch (_) {
    return { ok: false, reason: UNAVAILABLE.ERROR };
  }

  return { ok: true, supabase, userId: session.user.id };
}

/**
 * 単一コンテンツがお気に入り登録済みかを取得する。
 * @returns {Promise<{id: string}|null>}
 */
export async function fetchFavorite(ctx, contentType, contentId) {
  if (!ctx || !ctx.ok) return null;
  if (!VALID_CONTENT_TYPES.has(contentType) || !contentId) return null;
  try {
    const { data, error } = await ctx.supabase
      .from('favorites')
      .select('id')
      .eq('user_id', ctx.userId)
      .eq('content_type', contentType)
      .eq('content_id', contentId)
      .maybeSingle();
    if (error) {
      console.error('[favorites] fetchFavorite でエラーが発生しました');
      return null;
    }
    return data ?? null;
  } catch (_) {
    console.error('[favorites] fetchFavorite で例外が発生しました');
    return null;
  }
}

/**
 * ログインユーザーの最近のお気に入りを取得する（dashboard 表示用）。
 * @returns {Promise<Array<{content_type: string, content_id: string, title: string, url: string, created_at: string}>>}
 */
export async function fetchRecentFavorites(ctx, limit = 5) {
  if (!ctx || !ctx.ok) return [];
  try {
    const { data, error } = await ctx.supabase
      .from('favorites')
      .select('content_type,content_id,title,url,created_at')
      .eq('user_id', ctx.userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !Array.isArray(data)) {
      if (error) console.error('[favorites] fetchRecentFavorites でエラーが発生しました');
      return [];
    }
    return data;
  } catch (_) {
    console.error('[favorites] fetchRecentFavorites で例外が発生しました');
    return [];
  }
}

/**
 * お気に入りに追加する。
 * @returns {Promise<boolean>} 成功したか
 */
export async function addFavorite(ctx, contentType, contentId, title, url) {
  if (!ctx || !ctx.ok) return false;
  if (!VALID_CONTENT_TYPES.has(contentType) || !contentId) return false;
  try {
    const { error } = await ctx.supabase
      .from('favorites')
      .upsert(
        {
          user_id: ctx.userId,
          content_type: contentType,
          content_id: contentId,
          title: String(title || '').slice(0, 200),
          url: String(url || '').slice(0, 300),
        },
        { onConflict: 'user_id,content_type,content_id' },
      );
    if (error) console.error('[favorites] addFavorite でエラーが発生しました');
    return !error;
  } catch (_) {
    console.error('[favorites] addFavorite で例外が発生しました');
    return false;
  }
}

/**
 * お気に入りを解除する。
 * @returns {Promise<boolean>} 成功したか
 */
export async function removeFavorite(ctx, contentType, contentId) {
  if (!ctx || !ctx.ok) return false;
  if (!VALID_CONTENT_TYPES.has(contentType) || !contentId) return false;
  try {
    const { error } = await ctx.supabase
      .from('favorites')
      .delete()
      .eq('user_id', ctx.userId)
      .eq('content_type', contentType)
      .eq('content_id', contentId);
    if (error) console.error('[favorites] removeFavorite でエラーが発生しました');
    return !error;
  } catch (_) {
    console.error('[favorites] removeFavorite で例外が発生しました');
    return false;
  }
}

/**
 * 詳細ページ用の「お気に入り」UI を組み立ててコンテナに描画する。
 * ページ閲覧だけでは登録しない（完全に opt-in）。
 *
 * 表示は4状態：
 *   会員機能停止中 … 保存停止の案内のみ
 *   未ログイン     … ログイン導線
 *   未登録         … 「お気に入りに追加」ボタン
 *   登録済み       … 「お気に入り済み」＋「お気に入りを解除」
 *
 * @param {HTMLElement} container 描画先（既存DOMを置き換える）
 * @param {string} contentType
 * @param {string} contentId  空文字の場合は何もしない（存在しないIDページ対策）
 * @param {string} title      お気に入り登録時に保存するタイトル
 * @param {string} url        お気に入り登録時に保存する相対URL
 */
export async function renderFavoriteControl(container, contentType, contentId, title, url) {
  if (!container) return;
  if (!VALID_CONTENT_TYPES.has(contentType) || !contentId) return;

  const box = document.createElement('div');
  box.className = 'fav-box';

  const ctx = await getFavoritesContext();

  if (!ctx.ok) {
    const msg = document.createElement('span');
    msg.className = 'fav-msg';
    if (ctx.reason === UNAVAILABLE.SUSPENDED) {
      msg.textContent = '会員機能を停止しているため、お気に入りの保存は現在ご利用いただけません。';
      box.appendChild(msg);
    } else if (ctx.reason === UNAVAILABLE.UNAUTHENTICATED) {
      msg.textContent = 'ログインするとお気に入りに追加できます。';
      box.appendChild(msg);
      const a = document.createElement('a');
      a.className = 'fav-link';
      a.href = 'login.html';
      a.textContent = 'ログインする';
      box.appendChild(a);
    } else {
      msg.textContent = 'お気に入りを読み込めませんでした。閲覧はそのまま続けられます。';
      box.appendChild(msg);
    }
    container.replaceChildren(box);
    return;
  }

  let current = await fetchFavorite(ctx, contentType, contentId);

  const label = document.createElement('span');
  label.className = 'fav-msg';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fav-btn';

  function paint() {
    const done = !!current;
    label.textContent = done ? 'お気に入り済み' : '後で見返したい場合はお気に入りに追加できます。';
    btn.textContent = done ? 'お気に入りを解除' : 'お気に入りに追加';
    box.classList.toggle('is-done', done);
  }

  btn.addEventListener('click', async () => {
    const done = !!current;
    btn.disabled = true;
    const ok = done
      ? await removeFavorite(ctx, contentType, contentId)
      : await addFavorite(ctx, contentType, contentId, title, url);
    if (ok) {
      current = done ? null : { id: 'local' };
      paint();
    } else {
      label.textContent = '保存できませんでした。時間をおいて再度お試しください。';
    }
    btn.disabled = false;
  });

  paint();
  box.appendChild(label);
  box.appendChild(btn);
  container.replaceChildren(box);
}
