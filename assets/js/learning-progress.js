/**
 * learning-progress.js
 *
 * 学習進捗（learning_progress テーブル）の共通モジュール。
 * lesson_detail / theme_detail / asset_detail / event_detail の「学習完了」UI と、
 * learning_path / dashboard の進捗表示から使用する。
 *
 * 責務：
 *   - ログイン済みユーザーの進捗の取得・upsert・完了/取り消し
 *   - 未ログイン・会員機能停止中のフォールバック
 *
 * 禁止事項（このファイル内で行わないこと）：
 *   - 匿名ユーザーの進捗保存
 *   - MEMBERSHIP_SUSPENDED 中の Supabase 接続
 *   - 他ユーザーの進捗参照（RLS で保護済みだが、クエリ側でも user_id を明示する）
 *   - session / user / DBエラー全文の console 出力
 *
 * 設計方針：
 *   - Supabase client は動的 import する。MEMBERSHIP_SUSPENDED 中は import 自体を行わず、
 *     Supabase が停止・到達不能でもページが壊れないようにする（既存ページと同じ方針）。
 *   - 失敗は例外を投げず、呼び出し側が表示を継続できる戻り値を返す。
 */

/** 進捗が利用できない理由。UI の出し分けに使う。 */
export const UNAVAILABLE = {
  SUSPENDED: 'suspended',
  UNAUTHENTICATED: 'unauthenticated',
  CONSENT_REQUIRED: 'consent_required',
  ERROR: 'error',
};

const VALID_CONTENT_TYPES = new Set(['lesson', 'theme', 'asset', 'event', 'learning_path']);

/**
 * 進捗機能が使えるかを判定し、使える場合は supabase client と userId を返す。
 *
 * @returns {Promise<{ok: true, supabase: object, userId: string}
 *                  | {ok: false, reason: string}>}
 */
export async function getProgressContext() {
  // Marketcast Pause Preflight: 会員機能停止中は Supabase に一切接続しない。
  if (typeof window !== 'undefined' && window.MEMBERSHIP_SUSPENDED) {
    return { ok: false, reason: UNAVAILABLE.SUSPENDED };
  }

  let supabase;
  try {
    ({ supabase } = await import('./supabase-client.js'));
  } catch (_) {
    return { ok: false, reason: UNAVAILABLE.ERROR };
  }

  let session;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return { ok: false, reason: UNAVAILABLE.ERROR };
    session = data.session;
  } catch (_) {
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
 * ログインユーザーの全進捗を取得する。
 *
 * @returns {Promise<Map<string, {status: string, completed_at: string|null}>>}
 *          キーは `${content_type}:${content_id}`。取得できない場合は空 Map。
 */
export async function fetchAllProgress(ctx) {
  if (!ctx || !ctx.ok) return new Map();
  try {
    const { data, error } = await ctx.supabase
      .from('learning_progress')
      .select('content_type,content_id,status,completed_at')
      .eq('user_id', ctx.userId);
    if (error || !Array.isArray(data)) return new Map();
    return new Map(
      data.map((r) => [`${r.content_type}:${r.content_id}`, {
        status: r.status,
        completed_at: r.completed_at,
      }]),
    );
  } catch (_) {
    return new Map();
  }
}

/**
 * 単一コンテンツの進捗を取得する。
 * @returns {Promise<{status: string, completed_at: string|null}|null>}
 */
export async function fetchProgress(ctx, contentType, contentId) {
  if (!ctx || !ctx.ok) return null;
  if (!VALID_CONTENT_TYPES.has(contentType) || !contentId) return null;
  try {
    const { data, error } = await ctx.supabase
      .from('learning_progress')
      .select('status,completed_at')
      .eq('user_id', ctx.userId)
      .eq('content_type', contentType)
      .eq('content_id', contentId)
      .maybeSingle();
    if (error) return null;
    return data ?? null;
  } catch (_) {
    return null;
  }
}

/**
 * 閲覧を記録する（status='viewed'）。
 * 既に completed の場合は上書きしない（完了状態を閲覧で巻き戻さない）。
 *
 * @returns {Promise<boolean>} 成功したか
 */
export async function markViewed(ctx, contentType, contentId, existing) {
  if (!ctx || !ctx.ok) return false;
  if (!VALID_CONTENT_TYPES.has(contentType) || !contentId) return false;
  // 既に完了済みなら何もしない
  if (existing && existing.status === 'completed') return false;
  try {
    const { error } = await ctx.supabase
      .from('learning_progress')
      .upsert(
        {
          user_id: ctx.userId,
          content_type: contentType,
          content_id: contentId,
          status: 'viewed',
          viewed_at: new Date().toISOString(),
          completed_at: null,
        },
        { onConflict: 'user_id,content_type,content_id' },
      );
    return !error;
  } catch (_) {
    return false;
  }
}

/**
 * 学習完了にする（status='completed'）。
 * @returns {Promise<boolean>} 成功したか
 */
export async function markCompleted(ctx, contentType, contentId) {
  if (!ctx || !ctx.ok) return false;
  if (!VALID_CONTENT_TYPES.has(contentType) || !contentId) return false;
  const now = new Date().toISOString();
  try {
    const { error } = await ctx.supabase
      .from('learning_progress')
      .upsert(
        {
          user_id: ctx.userId,
          content_type: contentType,
          content_id: contentId,
          status: 'completed',
          viewed_at: now,
          completed_at: now,
        },
        { onConflict: 'user_id,content_type,content_id' },
      );
    return !error;
  } catch (_) {
    return false;
  }
}

/**
 * 完了を取り消す（status='viewed' に戻し completed_at を NULL にする）。
 * @returns {Promise<boolean>} 成功したか
 */
export async function clearCompleted(ctx, contentType, contentId) {
  if (!ctx || !ctx.ok) return false;
  if (!VALID_CONTENT_TYPES.has(contentType) || !contentId) return false;
  try {
    const { error } = await ctx.supabase
      .from('learning_progress')
      .upsert(
        {
          user_id: ctx.userId,
          content_type: contentType,
          content_id: contentId,
          status: 'viewed',
          viewed_at: new Date().toISOString(),
          completed_at: null,
        },
        { onConflict: 'user_id,content_type,content_id' },
      );
    return !error;
  } catch (_) {
    return false;
  }
}

/**
 * 詳細ページ用の「学習完了」UI を組み立ててコンテナに描画する。
 *
 * 表示は4状態：
 *   会員機能停止中 … 保存停止の案内のみ
 *   未ログイン     … ログイン導線
 *   未完了         … 「このコンテンツを学習完了にする」ボタン
 *   完了済み       … 「学習完了済み」＋「完了を取り消す」
 *
 * @param {HTMLElement} container 描画先（既存DOMを置き換える）
 * @param {string} contentType
 * @param {string} contentId  空文字の場合は何もしない（存在しないIDページ対策）
 */
export async function renderProgressControl(container, contentType, contentId) {
  if (!container) return;
  if (!VALID_CONTENT_TYPES.has(contentType) || !contentId) return;

  const box = document.createElement('div');
  box.className = 'lp-box';

  const ctx = await getProgressContext();

  if (!ctx.ok) {
    const msg = document.createElement('span');
    msg.className = 'lp-msg';
    if (ctx.reason === UNAVAILABLE.SUSPENDED) {
      msg.textContent = '会員機能を停止しているため、学習進捗の保存は現在ご利用いただけません。';
      box.appendChild(msg);
    } else if (ctx.reason === UNAVAILABLE.UNAUTHENTICATED) {
      msg.textContent = 'ログインすると学習進捗を保存できます。';
      box.appendChild(msg);
      const a = document.createElement('a');
      a.className = 'lp-link';
      a.href = 'login.html';
      a.textContent = 'ログインする';
      box.appendChild(a);
    } else {
      msg.textContent = '学習進捗を読み込めませんでした。閲覧はそのまま続けられます。';
      box.appendChild(msg);
    }
    container.replaceChildren(box);
    return;
  }

  let current = await fetchProgress(ctx, contentType, contentId);
  // 閲覧記録（完了済みは巻き戻さない）
  await markViewed(ctx, contentType, contentId, current);

  const label = document.createElement('span');
  label.className = 'lp-msg';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lp-btn';

  function paint() {
    const done = current && current.status === 'completed';
    label.textContent = done ? '学習完了済み' : 'このコンテンツの学習が終わったら記録できます。';
    btn.textContent = done ? '完了を取り消す' : '学習完了にする';
    box.classList.toggle('is-done', !!done);
  }

  btn.addEventListener('click', async () => {
    const done = current && current.status === 'completed';
    btn.disabled = true;
    const ok = done
      ? await clearCompleted(ctx, contentType, contentId)
      : await markCompleted(ctx, contentType, contentId);
    if (ok) {
      current = done ? { status: 'viewed', completed_at: null }
                     : { status: 'completed', completed_at: new Date().toISOString() };
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
