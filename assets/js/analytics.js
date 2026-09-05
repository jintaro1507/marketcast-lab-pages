/**
 * analytics.js — first-party product analytics クライアント（Task36）
 *
 * 設計方針:
 *   - fire-and-forget。応答を待たず、失敗しても呼び出し元へ伝播させない。
 *   - analytics の失敗がページ表示 / Premium API / Checkout / Auth を
 *     絶対に壊さないこと。例外は全て内部で握りつぶす。
 *   - console へ大量の error を出さない（開発時のみ debug 出力）。
 *   - Cookie を使わない。session_id は sessionStorage 上のランダム値で、
 *     タブを閉じれば失われる。個人を特定しない。
 *   - user_id / email / token / URL クエリ文字列を送らない。
 *     送れるのは track-product-event 側の allowlist に載る key のみ。
 *
 * 読み込み方:
 *   membership-flag.js と同じく classic script として読み込み、
 *   window.trackProductEvent を公開する。module にすると module 側からしか
 *   使えず、既存の classic <script> 本体から呼べないため。
 *     <script src="assets/js/analytics.js"></script>
 */
(function () {

/*
 * 依存を持たない。supabase-client.js を import すると CDN 上の supabase-js
 * を巻き込み、CDN 障害時に import 側ページの module graph ごと壊れうる。
 * analytics が UX を壊さない要件を優先し、公開値のみをここに持つ。
 * （値は supabase-client.js と一致していることをテストで担保する）
 */
const SUPABASE_URL = 'https://lvsustmfqrxjnfgdtlna.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_IwyvwJjPybtcf1jYiBWPtg_XeMe7fdV';

const ENDPOINT = `${SUPABASE_URL}/functions/v1/track-product-event`;
const SESSION_KEY = 'mcl_session_id';

/**
 * ランダムなセッション識別子を返す（無ければ生成）。
 * sessionStorage が使えない環境（プライベートモード等）では null を返し、
 * session_id 無しでイベントを送る（計測は落とすが UX は壊さない）。
 */
function getSessionId() {
  try {
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (sid) return sid;
    // crypto.randomUUID が無い環境向けのフォールバックも用意する
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      sid = globalThis.crypto.randomUUID().replace(/-/g, '');
    } else {
      sid = Array.from({ length: 4 },
        () => Math.random().toString(36).slice(2, 10)).join('');
    }
    sid = sid.slice(0, 32);
    sessionStorage.setItem(SESSION_KEY, sid);
    return sid;
  } catch {
    return null;   // ストレージ不可 → 匿名のまま送る
  }
}

/**
 * 製品イベントを1件送信する。
 *
 * @param {string} eventName track-product-event の allowlist にある名前
 * @param {Object} [properties] allowlist にある key のみ（asset_key / event_id）
 * @returns {void} 常に即座に返る（Promise を返さない＝呼び出し側が await しない）
 */
function trackProductEvent(eventName, properties) {
  try {
    if (typeof eventName !== 'string' || !eventName) return;

    const body = JSON.stringify({
      event_name: eventName,
      session_id: getSessionId(),
      properties: properties && typeof properties === 'object' ? properties : {},
    });

    // keepalive: ページ遷移中（外部リンククリック等）でも送信を継続させる。
    fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Supabase Edge Function は publishable key を要求する。
        // これは公開値であり秘密情報ではない。
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
      body,
      keepalive: true,
      // 認証情報を送らない（Cookie ベースの追跡をしない）
      credentials: 'omit',
    }).catch(() => { /* 計測失敗は無視する */ });
  } catch {
    /* 計測は決して呼び出し元へ影響させない */
  }
}

/*
 * 広告キャンペーン属性の計測（Task48）。
 *
 * 目的: Instagram 広告（遷移先 beginner.html）からの流入を、既存の
 * first-party analytics だけで把握する。Meta Pixel 等の第三者トラッカーは
 * 使わない。URL の utm_* パラメータを読むだけで、外部へは何も送らない。
 *
 * 設計:
 *   - 任意文字列を無制限に保存しない。4つの utm_* キーそれぞれに
 *     strict allowlist（ALLOWED_UTM_* / track-product-event 側）があり、
 *     許可リスト外の値は 'unknown' へ正規化する（信号は残すが自由文字列は
 *     保存しない）。allowlist の正本はサーバー側（product_events.ts）。
 *     ここでの正規化はサーバーの二重チェックであり、
 *     クライアント側だけの制御に依存しない（サーバーが最終防御）。
 *   - URL に utm_* が1つも無ければ何も送らない（オーガニック流入では
 *     イベントを増やさない）。
 *   - セッション内で最初の1回だけ記録する（同一セッション内のページ遷移で
 *     何度も送ると「1セッション＝1件」というファネル集計が崩れる）。
 *   - location.search をそのまま送らない。個々の値を検証したうえで
 *     allowlist 済みの文字列だけを渡す。
 */
const AD_LANDING_SEEN_KEY = 'mcl_ad_landing_seen';

const ALLOWED_UTM = {
  utm_source: ['instagram'],
  utm_medium: ['paid_social'],
  utm_campaign: ['launch_2026_09'],
  // reels_beginner_01: 既存の Reels → beginner.html。
  // reels_intro_01: 同じ Reels 素材 → start.html（Task50・intent mismatch解消）。
  utm_content: ['reels_beginner_01', 'reels_intro_01'],
};

/**
 * 現在の URL の utm_* パラメータを検証・正規化する。
 * @returns {Object|null} 1つ以上 utm_* があれば allowlist 済みの
 *   property オブジェクト（未allowlist値は 'unknown'）。1つも無ければ null。
 */
function readAdAttribution() {
  let params;
  try {
    params = new URLSearchParams(location.search);
  } catch {
    return null;
  }
  const props = {};
  let any = false;
  for (const key of Object.keys(ALLOWED_UTM)) {
    const raw = params.get(key);
    if (raw === null || raw === '') continue;
    any = true;
    props[key] = ALLOWED_UTM[key].includes(raw) ? raw : 'unknown';
  }
  return any ? props : null;
}

function captureAdLanding() {
  try {
    // ストレージ不可、または既にこのセッションで記録済みなら何もしない
    // （二重計上防止。ストレージ不可の環境では判定できないため送らない）。
    if (sessionStorage.getItem(AD_LANDING_SEEN_KEY) === '1') return;
    const props = readAdAttribution();
    if (!props) return;   // utm_* パラメータが無いページ遷移では何も送らない
    sessionStorage.setItem(AD_LANDING_SEEN_KEY, '1');
    trackProductEvent('ad_landing', props);
  } catch {
    /* 計測は決して呼び出し元へ影響させない */
  }
}

  // グローバルへ公開する（classic / module どちらの呼び出し元からも使える）
  globalThis.trackProductEvent = trackProductEvent;

  // analytics.js が読み込まれた任意のページで、URL に utm_* パラメータが
  // あれば一度だけ ad_landing を記録する。ページ側で個別に呼び出す必要はない。
  captureAdLanding();
})();
