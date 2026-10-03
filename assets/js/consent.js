/**
 * consent.js — 外国第三者提供に関する同意（Task40.3）
 *
 * 役割:
 *   - 現行版の同意をユーザーが持っているかを判定する
 *   - 同意証跡を記録する（時刻はDB側トリガでサーバ時刻に固定される）
 *   - 同意が無い認証済みユーザーに対して、進行を止めるゲートを表示する
 *
 * 設計上の判断:
 *   - 同意の有無は「DBに行があるか」だけを正とする。
 *     signUp 時の user_metadata は本人が書き換え可能なため証跡にしない。
 *   - consented_at はクライアントから送らない。送っても
 *     BEFORE INSERT トリガがサーバ時刻へ上書きする。
 *   - 判定結果はページ内でのみキャッシュする。sessionStorage には保存しない
 *     （「同意した」という状態をクライアント側で偽装できる余地を作らないため）。
 *   - 無料の公開コンテンツはこのモジュールを読み込まない。同意は
 *     アカウントを作り個人データを保存する場面でのみ求める。
 */

export const CONSENT_TYPE = 'foreign_data_transfer';

/** 新しく同意を取得するときに記録する版 */
export const CONSENT_VERSION = 'foreign_transfer_2026-08-30_v4';

/* 現在も有効として受け入れる版。
   v3 で提供先そのものが増えた（メール配信のため Plus Five Five, Inc.
   （Resend・アメリカ合衆国）を追加）。これは記載の明確化ではなく
   提供範囲の実質的な拡大であるため、v1 / v2 は受け入れ版から外し、
   改めて同意をいただく。

   （参考: v2 は v1 の「パスワード（ハッシュ化されたもの）」という記載を
   正確化しただけで提供範囲が変わらなかったため、当時は v1 を
   受け入れ版に残していた。今回はその条件を満たさない。）

   v3 は説明文書のフッター版表記が v2 のままだったため、誰にも提示する前に
   v4 へ差し替えた。提供先・提供する情報は v3 と同一。
   consent_versions は不変マスタのため、v3 の行はそのまま残している。 */
export const ACCEPTED_VERSIONS = [
  'foreign_transfer_2026-08-30_v4',
];

/* v3 で何が変わったかを利用者へ簡潔に伝えるための説明。
   同意画面で「なぜまた同意を求められるのか」が分かるようにする。 */
export const REVISION_NOTE =
  '国外のメール配信事業者を利用するため、外国への情報提供に関する説明を更新しました。';

export const DISCLOSURE_URL = 'foreign_data_transfer.html';

/** ページ内キャッシュ。user_id ごとに判定結果を保持する。 */
const cache = new Map();

/**
 * 現行版の同意を持っているか。
 * 判定できなかった場合は null を返す（true と誤認させない）。
 */
export async function hasCurrentConsent(supabase, userId) {
  if (!userId) return null;
  if (cache.has(userId)) return cache.get(userId);
  try {
    const { data, error } = await supabase
      .from('user_consents')
      .select('id')
      .eq('user_id', userId)
      .eq('consent_type', CONSENT_TYPE)
      .in('consent_version', ACCEPTED_VERSIONS)
      .limit(1);
    if (error) return null;
    const ok = Array.isArray(data) && data.length > 0;
    cache.set(userId, ok);
    return ok;
  } catch (_) {
    return null;
  }
}

/**
 * 同意を記録する。
 * 同一版の再送信は UNIQUE 制約により重複行を作らない（23505 は成功扱い）。
 */
export async function recordConsent(supabase, userId) {
  if (!userId) return false;
  try {
    const { error } = await supabase
      .from('user_consents')
      .insert({
        user_id: userId,
        consent_type: CONSENT_TYPE,
        consent_version: CONSENT_VERSION,
        // consented_at は送らない。DB のトリガがサーバ時刻を入れる。
      });
    if (error && error.code !== '23505') return false;
    cache.set(userId, true);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 同意ゲートを描画する。
 *
 * signUp 直後にセッションが無い（メール確認が必要な）構成でも、
 * 部分的な失敗でDBへ記録できなかった場合でも、認証済みで最初に
 * 会員機能へ来た時点でここが受け止める。
 */
function renderGate(container, onAgree) {
  container.replaceChildren();

  const box = document.createElement('section');
  box.className = 'consent-gate';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-labelledby', 'consent-gate-title');

  const h = document.createElement('h2');
  h.id = 'consent-gate-title';
  h.className = 'consent-gate-title';
  h.textContent = '個人情報の取扱いについてのご確認';
  box.appendChild(h);

  const lead = document.createElement('p');
  lead.className = 'consent-gate-lead';
  lead.textContent =
    'Marketcast Lab では、アカウントの認証やデータの保存、'
    + 'およびお客様が受信設定をされたメールの配信のため、'
    + '国外に所在する事業者のサービスを利用しています。'
    + '会員機能をご利用いただくにあたり、外国にある第三者への個人データの提供について'
    + 'ご確認とご同意をお願いしています。';
  box.appendChild(lead);

  // 既に旧版へ同意済みの方に「なぜまた同意を求められるのか」が分かるようにする
  const revision = document.createElement('p');
  revision.className = 'consent-gate-lead';
  revision.textContent = REVISION_NOTE;
  box.appendChild(revision);

  const facts = document.createElement('ul');
  facts.className = 'consent-gate-facts';
  ['提供先の所在国：シンガポール／アメリカ合衆国',
   '目的：アカウントの認証と情報の保存、および受信設定をされたメールの配信',
   '対象：メールアドレス、認証に関する情報、学習の記録、契約状態、'
     + '配信するメールの件名・本文など',
  ].forEach(t => {
    const li = document.createElement('li');
    li.textContent = t;
    facts.appendChild(li);
  });
  box.appendChild(facts);

  const more = document.createElement('a');
  more.className = 'consent-gate-more';
  more.href = DISCLOSURE_URL;
  more.target = '_blank';
  more.rel = 'noopener noreferrer';
  more.textContent = '詳しい説明を確認する（国外での個人データの取扱いについて）↗';
  box.appendChild(more);

  const row = document.createElement('label');
  row.className = 'consent-gate-check';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.id = 'consent-gate-checkbox';
  /* 既定は未チェック。プリチェックはしない。 */
  cb.checked = false;
  const span = document.createElement('span');
  span.textContent =
    'プライバシーポリシーおよび国外での個人データの取扱いに関する説明を確認し、'
    + '外国にある第三者への個人データの提供に同意します。';
  row.appendChild(cb);
  row.appendChild(span);
  box.appendChild(row);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'consent-gate-btn';
  btn.textContent = '同意して続ける';
  btn.disabled = true;
  box.appendChild(btn);

  const msg = document.createElement('p');
  msg.className = 'consent-gate-msg';
  msg.hidden = true;
  msg.setAttribute('role', 'alert');
  box.appendChild(msg);

  const note = document.createElement('p');
  note.className = 'consent-gate-note';
  note.textContent =
    '同意されない場合、会員機能はご利用いただけません。'
    + 'アカウントなしでご覧いただける無料のコンテンツは、引き続きご利用いただけます。';
  box.appendChild(note);

  cb.addEventListener('change', () => { btn.disabled = !cb.checked; });

  btn.addEventListener('click', async () => {
    if (!cb.checked) return;
    btn.disabled = true;
    btn.textContent = '記録しています…';
    const ok = await onAgree();
    if (!ok) {
      btn.disabled = false;
      btn.textContent = '同意して続ける';
      msg.hidden = false;
      msg.textContent = '同意を記録できませんでした。通信環境をご確認のうえ、もう一度お試しください。';
    }
  });

  container.appendChild(box);
  cb.focus();
}

/**
 * 認証済みユーザーに現行同意が無ければゲートを表示し、false を返す。
 * 同意済みなら true。判定できない場合は安全側に倒してゲートを出す。
 *
 * @param {object} supabase
 * @param {HTMLElement} container ゲートを描画する要素（既存内容は置換される）
 * @returns {Promise<boolean>} 続行してよいか
 */
export async function requireConsent(supabase, container) {
  let session = null;
  try {
    const { data } = await supabase.auth.getSession();
    session = data.session;
  } catch (_) { /* セッション取得失敗時は未ログイン扱い */ }

  // 未ログインならこのゲートの対象外（ページ側の既存導線に任せる）
  if (!session || !session.user) return true;

  const userId = session.user.id;
  const has = await hasCurrentConsent(supabase, userId);
  if (has === true) return true;

  if (!container) return false;

  renderGate(container, async () => {
    const ok = await recordConsent(supabase, userId);
    if (ok) window.location.reload();
    return ok;
  });
  return false;
}
