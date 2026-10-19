import { icon } from './icons.js';
import { esc, store, toast, toFa } from './utils.js';
import { render } from './view.js';
import {
  fingerprint,
  hasLocalData,
  mergeStates,
  persistLocal,
  replaceState,
  state,
} from './state.js';
import * as sec from './securestore.js';
import { showLockForRemote, unlockApp, clearBioRecord, strikeBioRecord } from './prefs.js';
import { t as tr } from './i18n.js';

export const GOOGLE_CLIENT_ID = '802769209005-a06b9ksp00sbm22hslhdbsumk8j6hmhm.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FILENAME = 'capital-app-data.json';
const DRIVE_FILE_KEY = 'capital_app_drive_file_id';
const TOKEN_KEY = 'capital_app_g_token';
const TOKEN_SESSION = 'capital_app_g_token';
// ورود از طریق Worker (refresh token رمزشده روی همین دستگاه؛ تمدید بی‌صدا بدون کوکی/iframe)
const SYNC_WORKER = 'https://taraz-sync.taraz.workers.dev';
const SEALED_KEY = 'capital_app_g_sealed';
// مسیرهای سرویس ورود/تمدید (افزونگی): اگر یکی فیلتر/قطع بود، خودکار سراغ مسیر بعدی می‌رویم
const SYNC_ROUTES = [
  { id: 'cf', base: SYNC_WORKER, p: { ping: '/health', start: '/start', refresh: '/refresh', revoke: '/revoke' } },
  { id: 'vercel', base: 'https://taraz-api.vercel.app', p: { ping: '/ping', start: '/auth/start', refresh: '/token/refresh', revoke: '/token/revoke' } },
];
const ROUTE_KEY = 'capital_app_sync_route';
const routeHealthy = {}; // سلامت مسیرها در همین نشست

export let gUser = null;
const LASTSYNC_KEY = (SEALED_KEY.indexOf('t_') === 0 ? 't_' : '') + 'capital_app_g_lastsync';

function initials(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w[0][0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
}
function avatarBg(email) {
  let h = 0;
  for (const ch of String(email || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 'hsl(' + (h % 360) + ' 55% 45%)';
}
// آواتار: عکس گوگل، و اگر نیامد حرف اول اسم
export function avatarHTML(u, size) {
  size = size || 32;
  const bg = avatarBg(u && u.email);
  const ini = esc(initials((u === gUser ? displayName() : (u && u.name)) || (u && u.email)));
  const fb = '<span class="av-ini" style="background:' + bg + '">' + ini + '</span>';
  if (u && u.picture) {
    return (
      '<span class="av" style="width:' + size + 'px;height:' + size + 'px"><img src="' + esc(u.picture) + '" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">' + fb + '</span>'
    );
  }
  return '<span class="av" style="width:' + size + 'px;height:' + size + 'px">' + fb + '</span>';
}
function agoText(ms) {
  const d = Math.max(0, Date.now() - ms);
  const m = Math.round(d / 60000);
  if (m < 1) return tr('همین الان');
  if (m < 60) return toFa(m) + ' ' + tr('دقیقه پیش');
  const h = Math.round(m / 60);
  if (h < 24) return toFa(h) + ' ' + tr('ساعت پیش');
  return toFa(Math.round(h / 24)) + ' ' + tr('روز پیش');
}
export function syncStatusText() {
  if (!gUser) return tr('وارد نشده‌ای');
  const ls = Number(store.get(LASTSYNC_KEY) || 0);
  if (tokenRequesting) return tr('در حال تمدید اتصال…');
  if (!tokenAlive() && !store.get(SEALED_KEY)) return tr('اتصال قطع است؛ ورود دوباره لازم است');
  if (pendingLocalSave) return tr('تغییرات محلی هنوز ارسال نشده');
  return ls ? tr('آخرین همگام‌سازی') + ': ' + agoText(ls) : tr('هنوز همگام نشده');
}
// دکمهٔ پروفایل در هدر
export function updateAvatar() {
  if (typeof document === 'undefined') return;
  let b = document.getElementById('btnProfile');
  if (!b) {
    // اگر index.html قدیمی از کش آمده باشد، دکمه را خودمان می‌سازیم
    const acts = document.querySelector('.hdr-actions');
    if (!acts) return;
    b = document.createElement('button');
    b.type = 'button';
    b.className = 'hdr-btn av-btn';
    b.id = 'btnProfile';
    b.onclick = openProfileMenu;
    acts.insertBefore(b, acts.firstChild);
  }
  if (gUser) {
    b.innerHTML = avatarHTML(gUser, 30);
    b.title = (gUser.email || displayName());
    const bad = (!tokenAlive() && !store.get(SEALED_KEY)) || (!!lastTokenError && !tokenAlive());
    b.classList.toggle('has-alert', bad);
    b.classList.add('signed');
  } else {
    b.innerHTML = icon('user');
    b.title = tr('ورود با گوگل');
    b.classList.remove('has-alert', 'signed');
  }
}
if (typeof window !== 'undefined') window.updateAvatar = updateAvatar;
let gToken = null;
let tokenClient = null;
let tokenWaiters = [];
let tokenRequesting = false;
let lastRefreshTry = 0;
let lastNetDetail = '';
let workerReachable = null;
let syncTimer = null;
let pushInFlight = false;
let pullInFlight = false;
let pendingLocalSave = false;
let pendingRemoteEnv = null;
let legacyLocalSnapshot = null;
let lastPullAt = 0;

function decodeJWT(tok) {
  const b64 = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64 + '==='.slice((b64.length + 3) % 4);
  const bytes = Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function tokenAlive() {
  return !!(gToken && gToken.token && gToken.exp > Date.now() + 5000);
}

function rememberToken(tok) {
  gToken = tok;
  const raw = tok ? JSON.stringify(tok) : '';
  store.set(TOKEN_KEY, raw);
  try {
    if (raw) sessionStorage.setItem(TOKEN_SESSION, raw);
    else sessionStorage.removeItem(TOKEN_SESSION);
  } catch (e) {}
}

function loadSavedToken() {
  try {
    let raw = store.get(TOKEN_KEY);
    if (!raw) {
      try {
        raw = sessionStorage.getItem(TOKEN_SESSION);
      } catch (e) {}
    }
    if (!raw) return;
    const t = JSON.parse(raw);
    if (t && t.token && t.exp > Date.now() + 5000) {
      gToken = t;
      store.set(TOKEN_KEY, raw);
    } else {
      store.set(TOKEN_KEY, '');
      try {
        sessionStorage.removeItem(TOKEN_SESSION);
      } catch (e) {}
    }
  } catch (e) {
    store.set(TOKEN_KEY, '');
  }
}

function setSignedIn(u) {
  gUser = u;
  store.set('g_user', JSON.stringify(u));
  store.set('g_signed', '1');
  updateAvatar();
}

function clearSignedIn() {
  gUser = null;
  store.set(LASTSYNC_KEY, '');
  setTimeout(updateAvatar, 0);
  rememberToken(null);
  store.set('g_user', '');
  store.set('g_signed', '0');
}

export function handleCredential(resp) {
  try {
    const p = decodeJWT(resp.credential);
    setSignedIn({ name: p.name, email: p.email, picture: p.picture || '' });
  } catch (e) {}
  requestAccessToken(function (ok) {
    if (!ok) {
      toast(tr('نتوانستم به درایو دسترسی بگیرم'));
      render();
      return;
    }
    loadFromDrive(function () {
      render();
      toast((tr('ورود موفق') + ' ✓ ' + tr('همگام‌سازی فعال شد')));
    }, true);
  }, true);
}

let lastTokenError = '';
let tokenReqTimer = null;

export function requestAccessToken(cb, interactive) {
  const done = function (ok) {
    if (cb) cb(ok);
  };
  if (tokenAlive() && gToken.exp > Date.now() + 60000) {
    done(true);
    return;
  }
  // ۱) اگر کلید مهرشده داریم: تمدید بی‌صدا از Worker (روی هر مرورگر/PWA کار می‌کند)
  const sealed = store.get(SEALED_KEY);
  if (sealed) {
    if (tokenRequesting) {
      tokenWaiters.push(done);
      return;
    }
    tokenRequesting = true;
    tokenWaiters.push(done);
    const finish = function (ok) {
      tokenRequesting = false;
      const w = tokenWaiters.splice(0);
      w.forEach((fn) => fn(ok));
      render();
    };
    // ترمز: بعد از یک شکست موقت، تا ۳۰ ثانیه دوباره به Worker نزن (حلقهٔ باگ‌دار سهمیه را نسوزاند)
    if (!interactive && Date.now() - lastRefreshTry < 30000) {
      finish(false);
      return;
    }
    lastRefreshTry = Date.now();
    routeFetch('refresh', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ sealed }) })
      .then((r) => r.json().catch(() => ({})).then((j) => ({ status: r.status, j })))
      .then(({ status, j }) => {
        if (j && j.access_token) {
          lastTokenError = '';
          lastRefreshTry = 0;
          if (j.sealed) store.set(SEALED_KEY, j.sealed); // چرخش کلید
          rememberToken({ token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 });
          finish(true);
        } else {
          const err = (j && j.error) || 'refresh_failed';
          lastTokenError = err;
          // فقط وقتی گوگل صریحاً کلید را رد کرده یا کلید با مهر باز نمی‌شود، پاکش کن؛ خطاهای موقت (۵xx) کلید را نگه می‌دارند
          const dead = err === 'invalid_grant' || err === 'bad_sealed';
          if (dead) store.set(SEALED_KEY, '');
          if (interactive && dead) startWorkerLogin();
          else finish(false);
        }
      })
      .catch((e) => {
        lastTokenError = 'network';
        lastNetDetail = String((e && e.message) || e || '');
        // تشخیص: آیا حداقل یکی از مسیرهای ورود در دسترس است؟ (برای راهنمایی دقیق‌تر خطا)
        pingSyncRoutes(() => finish(false));
      });
    return;
  }
  // ۲) بدون کلید: فقط با اقدام کاربر → هدایت به صفحهٔ ورود گوگل (یک بار)
  if (interactive) {
    startWorkerLogin();
    return;
  }
  done(false);
  return;
  // (مسیر قدیمی GIS زیر، فقط برای مرجع؛ اجرا نمی‌شود)
  // eslint-disable-next-line no-unreachable
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
    lastTokenError = 'gsi-not-loaded';
    done(false);
    return;
  }
  // اگر یک درخواستِ بی‌صدا در جریان است و حالا کاربر خودش دکمه زده، منتظرش نمی‌مانیم؛
  // درخواست تعاملی جدید می‌فرستیم (وگرنه کلیک کاربر بی‌اثر می‌ماند)
  if (tokenRequesting && !interactive) {
    tokenWaiters.push(done);
    return;
  }
  tokenWaiters.push(done);

  if (!tokenClient) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: function () {},
      error_callback: function () {},
    });
  }

  const finishAll = function (ok) {
    tokenRequesting = false;
    clearTimeout(tokenReqTimer);
    const waiters = tokenWaiters.splice(0);
    waiters.forEach((fn) => fn(ok));
    render();
  };

  tokenRequesting = true;
  tokenClient.callback = function (resp) {
    const ok = !!(resp && !resp.error && resp.access_token);
    if (ok) {
      lastTokenError = '';
      rememberToken({
        token: resp.access_token,
        exp: Date.now() + (resp.expires_in || 3600) * 1000,
      });
    } else {
      lastTokenError = (resp && resp.error) || 'unknown';
    }
    finishAll(ok);
  };
  // اگر پنجرهٔ گوگل بسته شود یا بلاک شود، callback عادی صدا زده نمی‌شود
  tokenClient.error_callback = function (err) {
    lastTokenError = (err && err.type) || 'popup';
    finishAll(false);
  };
  // درخواست بی‌صدا گاهی هیچ جوابی نمی‌دهد؛ نباید برای همیشه «در حال درخواست» بمانیم
  clearTimeout(tokenReqTimer);
  tokenReqTimer = setTimeout(
    function () {
      if (!tokenRequesting) return;
      lastTokenError = 'timeout';
      finishAll(false);
    },
    interactive ? 120000 : 15000
  );
  try {
    tokenClient.requestAccessToken({ prompt: interactive ? '' : 'none' });
  } catch (e) {
    lastTokenError = 'exception';
    finishAll(false);
  }
}

function tokenErrorHint() {
  switch (lastTokenError) {
    case 'gsi-not-loaded':
      return tr('فیلترشکن را روشن کن');
    case 'popup_closed':
    case 'popup':
      return tr('پنجرهٔ ورود گوگل بسته شد یا مرورگر آن را بلاک کرد؛ اجازهٔ پاپ‌آپ بده و دوباره بزن.');
    case 'popup_failed_to_open':
      return tr('مرورگر پنجرهٔ ورود را باز نکرد؛ پاپ‌آپ را برای این سایت آزاد کن.');
    case 'access_denied':
      return tr('دسترسی به درایو داده نشد؛ در پنجرهٔ گوگل تیک دسترسی به Drive را بزن.');
    case 'timeout':
      return tr('گوگل جواب نداد؛ اتصال اینترنت را چک کن.');
    case 'network':
      return workerReachable
        ? tr('سرور همگام‌سازی جواب نمی‌دهد ({d})؛ چند دقیقه بعد دوباره بزن.', { d: lastNetDetail || '—' })
        : tr('به سرور همگام‌سازی نرسیدم؛ اینترنت یا فیلتر شبکه (DNS/آنتی‌ویروس) را چک کن.') + ' ' + tr('آزمایش: {u}', { u: 'taraz-sync.taraz.workers.dev/health , ' + 'taraz-api.vercel.app/ping' });
    case 'google_down':
    case 'bad_response':
      return tr('گوگل موقتاً جواب نمی‌دهد؛ چند دقیقه بعد دوباره امتحان کن.');
    case 'bad_nonce':
      return tr('این بازگشت با درخواست ورود این دستگاه نمی‌خواند؛ دوباره «ورود» را بزن.');
    case 'exchange_failed':
    case 'invalid_request':
    case 'no_code':
      return tr('گوگل کد ورود را نپذیرفت؛ دوباره امتحان کن.');
    case 'bad_app':
    case 'state_expired':
      return tr('زمان صفحهٔ ورود گذشت؛ دوباره «ورود» را بزن.');
    case 'misconfigured':
      return tr('سرور همگام‌سازی درست تنظیم نشده است.');
    case 'invalid_grant':
    case 'refresh_failed':
    case 'bad_sealed':
      return tr('دسترسی این دستگاه از سمت گوگل باطل شده (قطع دسترسی یا تغییر رمز حساب)؛ یک بار دیگر وارد شو.');
    default:
      return tr('فیلترشکن را روشن کن');
  }
}

// ── ورود از طریق Worker ──
const NONCE_KEY = (SEALED_KEY.indexOf('t_') === 0 ? 't_' : '') + 'capital_app_g_nonce';

// ── لایهٔ چندمسیره: انتخاب سالم‌ترین سرور ──
function savedRoute() {
  const id = String(store.get(ROUTE_KEY) || '');
  return SYNC_ROUTES.find((r) => r.id === id) || SYNC_ROUTES[0];
}
function saveRoute(id) {
  try { store.set(ROUTE_KEY, id); } catch (e) {}
}
function fetchTimeout(url, opts, ms) {
  return new Promise((resolve, reject) => {
    let ctl = null;
    try { ctl = typeof AbortController !== 'undefined' ? new AbortController() : null; } catch (e) {}
    const t = setTimeout(() => {
      try { if (ctl) ctl.abort(); } catch (e) {}
      reject(new Error('timeout'));
    }, ms || 4500);
    fetch(url, Object.assign({}, opts || {}, ctl ? { signal: ctl.signal } : {}))
      .then((r) => { clearTimeout(t); resolve(r); })
      .catch((e) => { clearTimeout(t); reject(e); });
  });
}
function routeOrder() {
  const cur = savedRoute();
  return [cur].concat(SYNC_ROUTES.filter((r) => r.id !== cur.id));
}
// fetch چندمسیره: خطای شبکه یا پاسخ 5xx → مسیر بعدی (4xx یعنی سرور جواب داده؛ رد منطقی، نه قطعی مسیر)
function routeFetch(kind, opts, ms) {
  const order = routeOrder();
  let lastErr = null;
  return (function tryNext(i) {
    if (i >= order.length) return Promise.reject(lastErr || new Error('network'));
    const r = order[i];
    return fetchTimeout(r.base + r.p[kind], opts, ms).then((resp) => {
      if (resp.status >= 500) {
        routeHealthy[r.id] = false;
        lastErr = new Error('http ' + resp.status);
        return tryNext(i + 1);
      }
      routeHealthy[r.id] = true;
      saveRoute(r.id);
      return resp;
    }, (e) => {
      routeHealthy[r.id] = false;
      lastErr = e;
      return tryNext(i + 1);
    });
  })(0);
}
// ping موازی روی همهٔ مسیرها: آخرین مسیر سالم به‌خاطر سپرده می‌شود
// onlyId: فقط همان یک مسیر را احضار کن (صرفه‌جویی درخواست در بوت)
function pingSyncRoutes(done, onlyId) {
  const routes = onlyId ? SYNC_ROUTES.filter((r) => r.id === onlyId) : SYNC_ROUTES;
  let left = routes.length;
  const healthyIds = [];
  if (!routes.length) { if (done) done(workerReachable); return; }
  routes.forEach((r) => {
    fetchTimeout(r.base + r.p.ping, { cache: 'no-store' }, 4500)
      .then((resp) => {
        routeHealthy[r.id] = resp.ok;
        if (resp.ok) healthyIds.push(r.id);
      })
      .catch(() => { routeHealthy[r.id] = false; })
      .finally(() => {
        left -= 1;
        if (left === 0) {
          const cur = savedRoute();
          const firstHealthy = SYNC_ROUTES.find((r) => healthyIds.includes(r.id));
          if (firstHealthy && !healthyIds.includes(cur.id)) saveRoute(firstHealthy.id);
          if (!onlyId) workerReachable = healthyIds.length > 0;
          else if (healthyIds.length) workerReachable = true; // سنجش جزعی، ناسالم اعلام نکن
          if (done) done(workerReachable);
        }
      });
  });
}
// انتخاب مسیر برای ناوبری ورود (ناوبری ری‌ترای ندارد)
// بهینه: مسیرِ ذخیره‌شده را اول تک‌نیب چک کن (حالت معمول: یک رکوئست)؛
// فقط اگر ناسالم بود، رقابتِ موازی روی بقا.
function pickSyncRoute(cb) {
  const cur = savedRoute();
  if (routeHealthy[cur.id]) return cb(cur);
  const known = SYNC_ROUTES.find((r) => routeHealthy[r.id]);
  if (known) { saveRoute(known.id); return cb(known); }
  const rest = SYNC_ROUTES.filter((r) => r.id !== cur.id);
  let doneFlag = false;
  let pending = rest.length;
  const finish = (r) => {
    if (doneFlag) return;
    doneFlag = true;
    if (r) saveRoute(r.id);
    cb(r);
  };
  const raceRest = () => {
    if (!rest.length) {
      const g = SYNC_ROUTES.find((x) => routeHealthy[x.id]);
      if (!g) workerReachable = false;
      return finish(g || null);
    }
    rest.forEach((r) => {
      fetchTimeout(r.base + r.p.ping, { cache: 'no-store' }, 4000)
        .then((resp) => {
          routeHealthy[r.id] = resp.ok;
          if (resp.ok) finish(r);
        })
        .catch(() => { routeHealthy[r.id] = false; })
        .finally(() => {
          pending -= 1;
          if (pending === 0 && !doneFlag) {
            const g = SYNC_ROUTES.find((x) => routeHealthy[x.id]);
            if (!g) workerReachable = false;
            finish(g || null);
          }
        });
    });
  };
  fetchTimeout(cur.base + cur.p.ping, { cache: 'no-store' }, 4000)
    .then((resp) => {
      routeHealthy[cur.id] = resp.ok;
      if (resp.ok) { saveRoute(cur.id); return cb(cur); }
      raceRest();
    })
    .catch(() => {
      routeHealthy[cur.id] = false;
      raceRest();
    });
}
function startWorkerLogin() {
  const app = location.origin; // مبدأ اپ — Worker فقط همین را با مقدار مجاز مقایسه می‌کند
  let n = '';
  try {
    const a = crypto.getRandomValues(new Uint8Array(12));
    n = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    store.set(NONCE_KEY, n + ':' + Date.now());
  } catch (e) {}
  // اول مسیر سالم را انتخاب کن (ورود ناوبری دارد و ری‌ترای ندارد)
  pickSyncRoute((route) => {
    if (!route) {
      lastTokenError = 'network';
      toast(tr('ورود انجام نشد.') + ' ' + tokenErrorHint());
      return;
    }
    const u = route.base + route.p.start + '?app=' + encodeURIComponent(app) + '&n=' + n + (gUser && gUser.email ? '&login_hint=' + encodeURIComponent(gUser.email) : '');
    location.href = u;
  });
}
// بعد از برگشت از گوگل: توکن‌ها در #fragment هستند
// اگر نام/عکس در بازگشت نیامد، مستقیم از گوگل بگیر
function fetchProfile() {
  if (!tokenAlive()) return;
  fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + gToken.token } })
    .then((r) => (r.ok ? r.json() : null))
    .then((p) => {
      if (!p || !(p.name || p.email)) return;
      setSignedIn({ name: p.name || (gUser && gUser.name) || tr('حساب گوگل'), email: p.email || (gUser && gUser.email) || '', picture: p.picture || (gUser && gUser.picture) || '' });
      render();
    })
    .catch(() => {});
}

export function consumeWorkerCallback() {
  if (!location.hash || location.hash.length < 2) return false;
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.get('access_token') && !h.get('gerr')) return false;
  history.replaceState(null, '', location.pathname + location.search);
  // بازگشت باید جواب درخواستِ همین دستگاه باشد (login-CSRF)
  const saved = String(store.get(NONCE_KEY) || '').split(':');
  store.set(NONCE_KEY, '');
  const fresh = saved[0] && Date.now() - Number(saved[1] || 0) < 20 * 60000;
  // Worker قدیمی n برنمی‌گرداند؛ فقط وقتی n آمده و نمی‌خواند (یا nonce محلی نداریم) رد کن
  const n = h.get('n');
  if ((n && (!fresh || n !== saved[0])) || (!n && !saved[0] && !h.get('gerr'))) {
    lastTokenError = 'bad_nonce';
    toast(tr('ورود انجام نشد.') + ' ' + tokenErrorHint());
    return true;
  }
  const err = h.get('gerr');
  if (err && !h.get('access_token')) {
    lastTokenError = err;
    toast(tr('ورود انجام نشد.') + ' ' + tokenErrorHint());
    return true;
  }
  rememberToken({ token: h.get('access_token'), exp: Date.now() + (parseInt(h.get('expires_in'), 10) || 3600) * 1000 });
  if (h.get('sealed')) store.set(SEALED_KEY, h.get('sealed'));
  else if (err === 'no_refresh_token') toast(tr('گوگل کلید تمدید نداد؛ اگر باز هم ورود خواست، در myaccount.google.com دسترسی «تراز» را حذف و دوباره وارد شو'));
  setSignedIn({ name: h.get('name') || tr('حساب گوگل'), email: h.get('email') || '', picture: h.get('picture') || '' });
  if (!h.get('name') || !h.get('picture')) fetchProfile();
  loadFromDrive(function () {
    render();
    toast(tr('ورود موفق') + ' ✓ ' + tr('همگام‌سازی فعال شد'));
  }, true);
  return true;
}
export function googleSignIn() {
  if (store.get(SEALED_KEY)) requestDriveSignIn();
  else startWorkerLogin();
}

function requestDriveSignIn() {
  toast(tr('در حال اتصال به گوگل…'));
  requestAccessToken(function (ok) {
    if (!ok) {
      toast((tr('ورود انجام نشد.') + ' ') + tokenErrorHint());
      render();
      return;
    }
    if (!gUser) {
      setSignedIn({ name: tr('حساب گوگل'), email: '', picture: '' });
    }
    loadFromDrive(function () {
      render();
      toast((tr('ورود موفق') + ' ✓ ' + tr('همگام‌سازی فعال شد')));
    }, true);
  }, true);
}

export function openProfileMenu() {
  if (!gUser) {
    googleSignIn();
    return;
  }
  const ok = tokenAlive() || !!store.get(SEALED_KEY);
  const shown = displayName();
  openModalSafe(
    ('<button class="x" onclick="closeModal()" aria-label="' + tr('بستن') + '">') + icon('x') + ('</button><h2>' + tr('حساب کاربری') + '</h2>') +
      '<div class="profile-card">' + avatarHTML(gUser, 64) +
      '<button type="button" class="pc-name" onclick="editDisplayName()" title="' + tr('ویرایش نام') + '">' + esc(shown) + ' <span class="pc-edit">' + icon('edit') + '</span></button>' +
      (gUser.email ? '<div class="pc-mail">' + esc(gUser.email) + '</div>' : '') +
      '<div class="pc-status ' + (ok ? 'ok' : 'bad') + '"><span class="dot"></span>' + esc(syncStatusText()) + '</div>' +
      '<div class="pc-hint">' + tr('داده‌ها خودکار در Google Drive همین حساب ذخیره می‌شوند.') + '</div></div>' +
      (ok ? '' : ('<button class="btn primary block" onclick="closeModal();googleSignIn()">' + tr('اتصال دوباره') + '</button>')) +
      '<button class="btn danger block" style="margin-top:8px" onclick="closeModal();googleSignOut()">' + tr('خروج از حساب گوگل') + '</button>' +
      '<div class="small muted" style="text-align:center;margin-top:10px">' + tr('فقط این دستگاه خارج می‌شود.') + ' <a href="#" onclick="event.preventDefault();googleRevokeAll()">' + tr('قطع دسترسی از همهٔ دستگاه‌ها') + '</a></div>'
  );
}

// نام نمایشی: کاربر می‌تواند نام گوگل را با نام دلخواه جایگزین کند (فقط روی همین دستگاه‌ها همگام می‌شود)
const NICK_KEY = (SEALED_KEY.indexOf('t_') === 0 ? 't_' : '') + 'capital_app_nick';
export function displayName() {
  return store.get(NICK_KEY) || (gUser && gUser.name) || tr('حساب گوگل');
}
export function editDisplayName() {
  const cur = displayName();
  openModalSafe(
    ('<button class="x" onclick="openProfileMenu()" aria-label="' + tr('بازگشت') + '">') + icon('x') + ('</button><h2>' + tr('نام نمایشی') + '</h2>') +
      '<div class="field"><label>' + tr('این نام به‌جای نام گوگل نشان داده می‌شود') + '</label>' +
      '<input class="input" id="nickInp" type="text" maxlength="40" value="' + esc(cur) + '" autocomplete="nickname"></div>' +
      '<button class="btn primary block" style="margin-top:12px" onclick="saveDisplayName()">' + tr('ذخیره') + '</button>' +
      (store.get(NICK_KEY) ? '<button class="btn block" style="margin-top:8px" onclick="saveDisplayName(true)">' + tr('برگشت به نام گوگل') + '</button>' : '')
  );
  setTimeout(function () {
    const i = document.getElementById('nickInp');
    if (i) {
      i.focus();
      i.select();
    }
  }, 60);
}
export function saveDisplayName(reset) {
  const i = document.getElementById('nickInp');
  const v = reset ? '' : String((i && i.value) || '').trim();
  store.set(NICK_KEY, v);
  updateAvatar();
  render();
  toast(tr('ذخیره شد') + ' ✓');
  openProfileMenu();
}
if (typeof window !== 'undefined') {
  window.editDisplayName = editDisplayName;
  window.saveDisplayName = saveDisplayName;
}

function openModalSafe(html) {
  import('./modal.js').then((m) => m.openModal(html));
}

// خروج فقط روی همین دستگاه؛ کلید نزد گوگل باطل نمی‌شود تا دستگاه‌های دیگر نیفتند
export function googleSignOut() {
  openModalSafe(
    ('<button class="x" onclick="openProfileMenu()" aria-label="' + tr('بازگشت') + '">') + icon('x') + ('</button><h2>' + tr('خروج از حساب گوگل') + '</h2>') +
      '<p class="hint">' + tr('داده‌های روی این گوشی چه شوند؟ اگر می‌خواهی با حساب دیگری وارد شوی، پاک‌کردن لازم است.') + '</p>' +
      '<button class="btn block" onclick="closeModal();googleSignOutDo(false)">' + tr('فقط خروج؛ داده‌ها بمانند') + '</button>' +
      '<button class="btn danger block" style="margin-top:8px" onclick="closeModal();googleSignOutDo(true)">' + tr('خروج و پاک‌کردن داده‌های این گوشی') + '</button>' +
      '<button class="btn block" style="margin-top:8px" onclick="openProfileMenu()">' + tr('انصراف') + '</button>'
  );
}
export function googleSignOutDo(wipe) {
  store.set(SEALED_KEY, '');
  clearSignedIn();
  if (wipe) {
    // همهٔ کلیدهای برنامه (وضعیت، پاکت رمز، پین، اثر انگشت، تنظیمات) پاک می‌شود و برنامه از نو بالا می‌آید
    try { store.clearAll(); } catch (e) {}
    try { indexedDB.deleteDatabase('cap_scans'); } catch (e) {}
    location.reload();
    return;
  }
  render();
  toast(tr('از حساب خارج شدی'));
}

// قطع دسترسی از همهٔ دستگاه‌ها (گوگل همهٔ کلیدهای این حساب را باطل می‌کند)
export function googleRevokeAll() {
  openModalSafe(
    ('<button class="x" onclick="openProfileMenu()" aria-label="' + tr('بازگشت') + '">') + icon('x') + ('</button><h2>' + tr('قطع دسترسی از همهٔ دستگاه‌ها') + '</h2>') +
      '<p class="hint">' + tr('دسترسی «تراز» به این حساب گوگل به‌طور کامل برداشته می‌شود. روی همهٔ دستگاه‌هایت باید دوباره وارد شوی. برای وقتی مناسب است که گوشی‌ای گم شده یا دست کسی دیگر است.') + '</p>' +
      '<button class="btn danger block" onclick="closeModal();googleRevokeAllDo()">' + tr('بله، همه را قطع کن') + '</button>' +
      '<button class="btn block" style="margin-top:8px" onclick="openProfileMenu()">' + tr('انصراف') + '</button>'
  );
}
export function googleRevokeAllDo() {
  const sealed = store.get(SEALED_KEY);
  const done = function () {
    googleSignOutDo(false);
    toast(tr('دسترسی از همهٔ دستگاه‌ها قطع شد'));
  };
  if (!sealed) return done();
  routeFetch('revoke', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ sealed }) })
    .then((r) => r.json().catch(() => ({})))
    .then((j) => {
      if (j && j.ok) return done();
      toast(tr('قطع دسترسی انجام نشد (گوگل در دسترس نیست)؛ دوباره امتحان کن یا در myaccount.google.com دسترسی «تراز» را حذف کن.'));
    })
    .catch(() => toast(tr('فیلترشکن را روشن کن')));
}
if (typeof window !== 'undefined') {
  window.googleRevokeAll = googleRevokeAll;
  window.googleRevokeAllDo = googleRevokeAllDo;
}

function driveFetch(url, opts) {
  opts = opts || {};
  opts.headers = opts.headers || {};
  if (!gToken || !gToken.token) {
    // توکن در همین لحظه پاک شده (درخواست همزمان)؛ اول تمدید، بعد درخواست
    return new Promise(function (res) {
      requestAccessToken(function (ok) {
        if (!ok || !gToken) return res(new Response('', { status: 401 }));
        opts.headers.Authorization = 'Bearer ' + gToken.token;
        res(fetch(url, opts));
      }, false);
    });
  }
  opts.headers.Authorization = 'Bearer ' + gToken.token;
  return fetch(url, opts).then(function (r) {
    if (r.status === 401) {
      rememberToken(null);
      return new Promise(function (res) {
        requestAccessToken(function (ok) {
          if (!ok) {
            res(r);
            return;
          }
          opts.headers.Authorization = 'Bearer ' + (gToken ? gToken.token : '');
          res(fetch(url, opts));
        }, false);
      });
    }
    return r;
  });
}

function driveFindFile() {
  const savedId = store.get(DRIVE_FILE_KEY);
  if (savedId) {
    return driveFetch(
      'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(savedId) + '?fields=id,name,trashed'
    )
      .then(function (r) {
        if (r.ok) return r.json();
        store.set(DRIVE_FILE_KEY, '');
        return null;
      })
      .then(function (f) {
        if (f && !f.trashed) return f;
        return driveFindFileByName();
      });
  }
  return driveFindFileByName();
}

function driveFindFileByName() {
  const q = "name='" + DRIVE_FILENAME + "' and trashed=false";
  return driveFetch(
    'https://www.googleapis.com/drive/v3/files?q=' +
      encodeURIComponent(q) +
      '&spaces=drive&corpora=user&orderBy=modifiedTime%20desc&pageSize=100&fields=files(id,name,modifiedTime)'
  )
    .then(function (r) {
      if (!r.ok) throw new Error('Drive list ' + r.status);
      return r.json();
    })
    .then(function (d) {
      const f = (d.files && d.files[0]) || null;
      if (f) store.set(DRIVE_FILE_KEY, f.id);
      return f;
    });
}

function driveRead(id) {
  return driveFetch('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media').then(function (r) {
    if (!r.ok) throw new Error('Drive read ' + r.status);
    return r.text();
  });
}

function driveCreate(content) {
  const fd = new FormData();
  fd.append(
    'metadata',
    new Blob([JSON.stringify({ name: DRIVE_FILENAME, mimeType: 'application/json' })], {
      type: 'application/json',
    })
  );
  fd.append('file', new Blob([content], { type: 'application/json' }));
  return driveFetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
    { method: 'POST', body: fd }
  )
    .then(function (r) {
      if (!r.ok) throw new Error('Drive create ' + r.status);
      return r.json();
    })
    .then(function (d) {
      if (d.id) store.set(DRIVE_FILE_KEY, d.id);
      return d;
    });
}

function driveUpdate(id, content) {
  const fd = new FormData();
  fd.append(
    'metadata',
    new Blob([JSON.stringify({ name: DRIVE_FILENAME, mimeType: 'application/json' })], {
      type: 'application/json',
    })
  );
  fd.append('file', new Blob([content], { type: 'application/json' }));
  return driveFetch(
    'https://www.googleapis.com/upload/drive/v3/files/' + id + '?uploadType=multipart&fields=id,name',
    { method: 'PATCH', body: fd }
  ).then(function (r) {
    if (r.ok) return r;
    return driveCreate(content);
  });
}

function hasRemoteData(r) {
  return (
    !!r.bookId ||
    (r.accounts && r.accounts.length) ||
    (r.transactions && r.transactions.length) ||
    (r.investments && r.investments.length) ||
    (r.debts && r.debts.length) ||
    Object.keys(r.budgets || {}).length
  );
}

function decideSync(local, remote) {
  const localHas = hasLocalData(local);
  const remoteHas = hasRemoteData(remote);
  if (localHas && !remoteHas) return { action: 'push', next: local };
  if (remoteHas && !localHas) return { action: 'pull', next: remote };
  const lAt = local.updatedAt || 0;
  const rAt = remote.updatedAt || 0;
  if (lAt > rAt) return { action: 'push', next: local };
  if (rAt > lAt) return { action: 'pull', next: remote };
  const merged = mergeStates(local, remote);
  if (fingerprint(merged) !== fingerprint(local)) return { action: 'push', next: merged };
  return { action: 'noop', next: local };
}

export function loadFromDrive(cb, interactive, quiet) {
  cb = cb || function () {};
  if (pushInFlight || pendingLocalSave) {
    cb();
    return;
  }
  if (pullInFlight) {
    cb();
    return;
  }
  const run = function () {
    pullInFlight = true;
    driveFindFile()
      .then(function (f) {
        if (!f) {
          if (sec.isEncrypted() && !sec.isUnlocked()) return; // هنوز قفل است
          return driveCreate(syncContent()).then(function () {
            pendingLocalSave = false;
            if (!quiet) toast(tr('اطلاعات در Google Drive ذخیره شد') + ' ✓');
          });
        }
        return driveRead(f.id).then(function (text) {
          let remote;
          try {
            remote = JSON.parse(text);
          } catch (e) {
            return;
          }
          // پاکت رمزشدهٔ نسخهٔ ۲؟
          if (remote && remote.v === 2 && remote.wraps && remote.data) {
            return handleRemoteEnvelope(remote, f.id);
          }
          // فایل متن‌ساده
          if (sec.isEncrypted() && remote && remote.encOff && remote.encOff > sec.metaUpdatedAt()) {
            // روی دستگاه دیگری رمزنگاری خاموش شده؛ این‌جا هم دنبالش می‌رویم
            sec.disableEncryption();
            clearBioRecord();
            replaceState(remote);
            persistLocal();
            render();
            toast(tr('رمزنگاری از دستگاه دیگر خاموش شد؛ داده‌ها ساده ذخیره می‌شوند'));
            return;
          }
          if (sec.isEncrypted()) {
            if (!sec.isUnlocked()) return; // بعد از باز شدن قفل رسیدگی می‌شود
            const d2 = decideSync(state, remote);
            if (d2.action === 'pull') {
              replaceState(d2.next);
              render();
              pendingLocalSave = true;
            } else if (d2.action === 'push') {
              replaceState(d2.next);
              persistLocal();
              return driveUpdate(f.id, syncContent());
            }
            return;
          }
          const decision = decideSync(state, remote);
          if (decision.action === 'pull') {
            replaceState(decision.next);
          } else if (decision.action === 'push') {
            replaceState(decision.next);
            persistLocal();
            return driveUpdate(f.id, syncContent());
          }
        });
      })
      .then(function () {
        lastPullAt = Date.now();
      })
      .catch(function () {
        if (!quiet && interactive) toast(tr('خطا در دریافت از درایو؛ دوباره مجوز را تأیید کن'));
      })
      .then(function () {
        pullInFlight = false;
        cb();
      });
  };

  if (!tokenAlive()) {
    requestAccessToken(function (ok) {
      if (ok) run();
      else {
        if (!quiet && interactive) toast(tr('مجوز Google Drive داده نشد'));
        cb();
      }
    }, !!interactive);
    return;
  }
  run();
}

// ─── دریافت فوریِ کلیدهای جدید از درایو (برای صفحهٔ قفل) ──────────────────
// وقتی رمز روی صفحهٔ قفل رد می‌شود، شاید رمز روی دستگاه دیگر عوض شده و هنوز
// این دستگاه کلیدهای جدید را نگرفته؛ همین‌جا پاکت را می‌خوانیم و اگر هم‌کلید و
// جدیدتر بود، کلیدهایش را می‌پذیریم. cb(changed:boolean)
let wrapsPullInFlight = false;
export function pullRemoteWrapsNow(cb) {
  cb = cb || function () {};
  if (!gUser && !tokenAlive()) return cb(false);
  if (wrapsPullInFlight) return cb(false);
  wrapsPullInFlight = true;
  const finish = function (changed) {
    wrapsPullInFlight = false;
    cb(!!changed);
  };
  const run = function () {
    driveFindFile()
      .then(function (f) {
        if (!f) return false;
        return driveRead(f.id).then(function (text) {
          let remote;
          try {
            remote = JSON.parse(text);
          } catch (e) {
            return false;
          }
          if (!(remote && remote.v === 2 && remote.wraps && remote.data)) return false;
          if (!sec.isEncrypted()) {
            sec.adoptRemoteEnvelope(remote);
            return true;
          }
          if (sec.sameKeyAs(remote)) {
            const changed = sec.adoptRemoteWraps(remote);
            // اگر دادهٔ دوردست هم جدیدتر است، همان‌جا کل پاکت را می‌پذیریم (پین/اثر انگشت می‌ماند)
            const remoteAt = (remote.meta && remote.meta.updatedAt) || 0;
            if (remoteAt > sec.metaUpdatedAt()) sec.adoptRemoteEnvelope(remote);
            return changed;
          }
          // کلید متفاوت: بعد از بازشدن قفل، مسیر «یکی‌کردن» اجرا می‌شود
          pendingRemoteEnv = remote;
          return false;
        });
      })
      .then(finish)
      .catch(function () {
        finish(false);
      });
  };
  if (!tokenAlive()) {
    requestAccessToken(function (ok) {
      if (ok) run();
      else finish(false);
    }, false);
    return;
  }
  run();
}

export function isGoogleLinked() {
  return !!(gUser || tokenAlive());
}

// ─── پردازش پاکت رمزشدهٔ دوردست ────────────────────────────────────────────
async function handleRemoteEnvelope(env, fileId) {
  // دستگاه تازه یا بدون رمزنگاری محلی: پاکت را «قفل‌شده» می‌پذیریم تا
  // جریان عادیِ ورود با رمز عبور اجرا شود — هیچ داده‌ای قبلش دیده نمی‌شود
  if (!sec.isEncrypted()) {
    if (hasLocalData(state)) {
      legacyLocalSnapshot = JSON.parse(JSON.stringify(state));
      pendingRemoteEnv = env;
    }
    sec.adoptRemoteEnvelope(env);
    showLockForRemote();
    render();
    return;
  }
  const localAt = sec.metaUpdatedAt();
  const remoteAt = (env.meta && env.meta.updatedAt) || 0;
  const remoteKid = env.meta && env.meta.kid;
  const localKid = sec.metaKid();
  const diverged = !!(remoteKid && localKid && remoteKid !== localKid);
  const sameKey = sec.sameKeyAs(env);

  // دو دستگاه جداگانه رمزنگاری فعال کرده‌اند: باید یکی شوند
  if (diverged) {
    return tryRepairMerge(env);
  }

  // کلید داده یکی است → فقط باید ببینیم «کلیدها» (رمز عبور/عبارت) و «داده» کدام جدیدتر است.
  // این دو مستقل از هم‌اند: مثلاً دستگاه دیگر رمز را عوض کرده ولی این دستگاه تراکنش جدید دارد.
  let wrapsChanged = false;
  if (sameKey) {
    const rW = sec.wrapsAtOf(env);
    const lW = sec.metaWrapsAt();
    if (rW > lW) {
      // رمز عبور روی دستگاه دیگر عوض شده؛ کلیدهای جدید را می‌گیریم (پین این گوشی می‌ماند)
      wrapsChanged = sec.adoptRemoteWraps(env);
      if (wrapsChanged) toast((tr('رمز عبور از دستگاه دیگر به‌روز شد') + ' ✓'));
    } else if (lW > rW) {
      // رمز این دستگاه جدیدتر است؛ باید به گوگل برود
      pendingLocalSave = true;
    }
  }

  if (remoteAt > localAt) {
    if (!sec.isUnlocked()) {
      if (sameKey) {
        // همان کلید است؛ پاکت جدید را همین حالا می‌پذیریم — پین/اثر انگشت این گوشی معتبر می‌ماند
        // و بعد از بازشدن قفل، دادهٔ جدید بارگذاری می‌شود
        sec.adoptRemoteEnvelope(env);
        return;
      }
      pendingRemoteEnv = env;
      showLockForRemote();
      return;
    }
    try {
      const got = await sec.decryptRemote(env);
      const keptLocalWraps = sec.adoptRemoteEnvelope(env);
      sec.setSessionKey(got.dk);
      replaceState(got.state);
      render();
      if (keptLocalWraps || pendingLocalSave) {
        // کلیدهای محلی جدیدترند؛ پاکت ادغام‌شده باید دوباره پوش شود
        pendingLocalSave = true;
        pushToDrive(false);
      } else {
        pendingLocalSave = false;
      }
      store.set(LASTSYNC_KEY, String(Date.now()));
      updateAvatar();
      toast((tr('داده‌های جدیدتر از گوگل دریافت شد') + ' ✓'));
    } catch (e) {
      pendingRemoteEnv = env;
      openRemotePassModal();
    }
    return;
  }

  if (localAt > remoteAt) {
    // محلی جدیدتر است؛ پاکت محلی پوش می‌شود
    if (sec.isUnlocked()) return driveUpdate(fileId, syncContent()).then(() => (pendingLocalSave = false));
    pendingLocalSave = true;
    return;
  }

  // هم‌زمان: ادغام در صورت تفاوت
  if (!sec.isUnlocked()) {
    if (!sameKey) pendingRemoteEnv = env;
    return;
  }
  try {
    const got = await sec.decryptRemote(env);
    const merged = mergeStates(state, got.state);
    if (fingerprint(merged) !== fingerprint(state)) {
      replaceState(merged);
      render();
      pendingLocalSave = true;
    }
    if (pendingLocalSave) pushToDrive(false);
  } catch (e) {
    pendingRemoteEnv = env;
    openRemotePassModal();
  }
}

// آیا نسخهٔ گوگل با کلید/رمز دیگری در انتظار یکی‌شدن است؟ (برای هدایت ورود از قفل)
export function hasPendingRemote() {
  return !!pendingRemoteEnv;
}
export function openRemotePassModalNow() {
  if (pendingRemoteEnv) openRemotePassModal();
}

// اگر روی درایو پاکت رمزشده‌ای هست و این دستگاه هنوز رمزنگاری ندارد: همان را بپذیر
// تا کلید انشعابی تازه ساخته نشود. اگر چیزی نبود یا خطا بود → cb(false)
export async function adoptRemoteEncryptionIfAny(cb) {
  try {
    if (sec.isEncrypted()) return cb(false);
    const f = await driveFindFile();
    if (!f) return cb(false);
    const text = await driveRead(f.id);
    let remote;
    try {
      remote = JSON.parse(text);
    } catch (e) {
      return cb(false);
    }
    if (!(remote && remote.v === 2 && remote.wraps && remote.data)) return cb(false);
    await handleRemoteEnvelope(remote, f.id); // مسیر بدون رمزنگاری محلی: پذیرش پاکت + نمایش قفل دوردست
    cb(true);
  } catch (e) {
    cb(false);
  }
}

// ─── یکی‌کردن دو دستگاهی که جداگانه رمزنگاری فعال کرده‌اند ───────────────
async function tryRepairMerge(env) {
  if (!sec.isUnlocked()) {
    // اول با رمز همین دستگاه باز کن، بعد رمز آن یکی را می‌پرسیم
    pendingRemoteEnv = env;
    showLockForRemote();
    return;
  }
  try {
    const got = await sec.decryptRemote(env);
    return applyRemoteMerge(env, got);
  } catch (e) {
    // رمز این دستگاه به پاکت گوگل نمی‌خورد
  }
  pendingRemoteEnv = env;
  openRemotePassModal();
}

function openRemotePassModal() {
  openModalSafe(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>🔑 ${tr('یکی‌کردن دستگاه‌ها')}</h2>
    <p class="small muted">${tr('نسخهٔ داخل گوگل با رمز عبور دیگری ساخته شده — احتمالاً رمزنگاری را روی دستگاه دیگر جداگانه فعال کرده‌ای.')}
    ${tr('برای یکی‌کردن داده‌ها،')} <b>${tr('رمز عبوری که روی آن دستگاه ساختی')}</b> ${tr('را وارد کن. بعد از یکی‌شدن، همان رمز روی همهٔ دستگاه‌ها معتبر می‌شود.')}</p>
    <div class="field"><label>${tr('رمز عبورِ دستگاه دیگر')}</label>
      <input class="input" id="remotePass" type="password" dir="ltr" autocomplete="off"></div>
    <div id="remotePassErr" class="hint" style="display:none;color:#fb7185"></div>
    <button class="btn primary block" style="margin-top:12px" onclick="submitRemotePass()">${tr('یکی‌کردن داده‌ها')}</button>
    <button class="btn block" style="margin-top:8px" onclick="closeModal()">${tr('بعداً')}</button>
  `);
}

export async function submitRemotePass() {
  const env = pendingRemoteEnv;
  if (!env) {
    closeModalSafe();
    return;
  }
  const val = String((document.getElementById('remotePass') || {}).value || '');
  if (!val) {
    toast(tr('رمز عبور را وارد کن'));
    return;
  }
  try {
    const got = await sec.decryptRemoteWith(env, val);
    await applyRemoteMerge(env, got);
    closeModalSafe();
  } catch (e) {
    const err = document.getElementById('remotePassErr');
    if (err) {
      err.style.display = '';
      err.textContent = tr('این رمز به داده‌های گوگل نخورد؛ رمز همان دستگاه دیگر را وارد کن.');
    }
  }
}

async function applyRemoteMerge(env, got) {
  pendingRemoteEnv = null;
  const merged = mergeStates(state, got.state);
  // پاکت گوگل (کلید و رمزهایش) معتبر می‌شود؛ پین قدیمی این دستگاه با کلید قبلی
  // پیچیده شده بود و دیگر باز نمی‌کند → پاک می‌شود. اثر انگشت «مرده» علامت می‌خورد تا
  // با اولین ورود موفق رمز عبور خودش ترمیم شود (بدون ثبت دوباره)
  sec.adoptRemoteEnvelope(env, { dropPin: true });
  sec.setSessionKey(got.dk);
  strikeBioRecord();
  replaceState(merged);
  if (document.body.classList.contains('locked')) unlockApp();
  render();
  pendingLocalSave = true;
  toast((tr('داده‌ها یکی شد') + ' ✓ ' + tr('از این پس با این رمز باز می‌شود') + ' — ' + tr('پین این دستگاه پاک شد (از تنظیمات دوباره بساز)؛ اثر انگشت با اولین ورودِ رمز عبور خودش ترمیم می‌شود')));
  pushToDrive(false);
}

function closeModalSafe() {
  import('./modal.js').then((m) => m.closeModal());
}

async function processPendingRemote() {
  const env = pendingRemoteEnv;
  if (!env) return;
  if (!sec.isUnlocked()) return; // هنوز باز نشده
  try {
    const got = await sec.decryptRemote(env);
    pendingRemoteEnv = null;
    // اگر پاکت دوردست همان کلید است، کلیدهای جدیدترش (مثلاً رمز تازه) را هم می‌گیریم
    if (sec.sameKeyAs(env)) sec.adoptRemoteWraps(env);
    let next = got.state;
    if (legacyLocalSnapshot) {
      next = mergeStates(legacyLocalSnapshot, next);
      legacyLocalSnapshot = null;
    }
    if (hasLocalData(state)) next = mergeStates(state, next);
    replaceState(next);
    render();
    toast((tr('داده‌ها از گوگل باز شد') + ' ✓'));
  } catch (e) {
    // رمز این دستگاه به نسخهٔ گوگل نمی‌خورد → پرسیدن رمز دستگاه دیگر
    openRemotePassModal();
  }
}

// بعد از باز شدن قفل: رسیدگی به دوردستِ معطل، پوش‌های مانده و پیشنهاد پین
document.addEventListener('cap:unlocked', function () {
  if (pendingRemoteEnv) processPendingRemote();
  else if (pendingLocalSave) pushToDrive(false);
});

// بعد از فعال‌شدن رمزنگاری: پوش فوری پاکت رمزشده به درایو
document.addEventListener('cap:encrypt-on', function () {
  if (gUser || tokenAlive()) pushToDrive(false);
});

// بعد از تغییر رمز عبور / عبارت بازیابی: کلیدهای جدید باید فوراً به گوگل بروند
// وگرنه دستگاه دیگر با رمز قدیمی روی آن می‌نویسد و رمز جدید از بین می‌رود
document.addEventListener('cap:wraps-changed', function () {
  if (!gUser && !tokenAlive()) return;
  pendingLocalSave = true;
  pushToDrive(false, function (ok) {
    if (ok) toast((tr('رمز جدید در گوگل ذخیره شد') + ' ✓ ' + tr('دستگاه‌های دیگر هم به‌روز می‌شوند')));
    else toast(tr('رمز جدید هنوز به گوگل نرفته؛ از منوی حساب «الان در گوگل ذخیره کن» را بزن'));
  });
});

// محتوایی که در درایو ذخیره می‌شود: پاکت رمزشده یا حالت ساده
function syncContent() {
  if (sec.isEncrypted()) {
    const env = sec.remoteEnvelopeJson();
    if (env) return env;
  }
  return JSON.stringify(state);
}

export function scheduleSync() {
  if (!gUser && !tokenAlive()) return;
  pendingLocalSave = true;
  // فقط تلاش بی‌صدا — هیچ پنجرهٔ لاگینی باز نمی‌شود
  pushToDrive(false);
}

// آرشیو: یک فایل جداگانه با نام داده‌شده در درایو (رمزشده اگر رمزنگاری فعال باشد)
export function archiveToDrive(name, plainJson, opts) {
  return new Promise(function (resolve, reject) {
    const go = function () {
      const build = opts && opts.raw ? Promise.resolve(plainJson) : sec.isEncrypted() && sec.isUnlocked() ? sec.encryptStandalone(plainJson) : Promise.resolve(plainJson);
      build
        .then(function (content) {
          const fd = new FormData();
          fd.append('metadata', new Blob([JSON.stringify({ name: name, mimeType: 'application/json' })], { type: 'application/json' }));
          fd.append('file', new Blob([content], { type: 'application/json' }));
          return driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', { method: 'POST', body: fd });
        })
        .then(function (r) {
          if (!r.ok) throw new Error('Drive archive ' + r.status);
          resolve(true);
        })
        .catch(reject);
    };
    if (tokenAlive()) go();
    else requestAccessToken(function (ok) { if (ok) go(); else reject(new Error('no token')); }, true);
  });
}

export function pushToDrive(interactive, onDone) {
  if (sec.isEncrypted() && !sec.isUnlocked()) {
    if (onDone) onDone(false);
    return;
  }
  let pushOk = false;
  const finish = function () {
    pushInFlight = false;
    if (onDone) onDone(pushOk);
  };
  const run = function () {
    pushInFlight = true;
    // اول صبر می‌کنیم آخرین رمزکردن محلی تمام شود، بعد محتوا را می‌سازیم
    return sec.whenPersisted().then(startPush);
  };
  const startPush = function () {
    const content = syncContent();
    return driveFindFile()
      .then(function (f) {
        if (f) return driveUpdate(f.id, content);
        return driveCreate(content);
      })
      .then(function () {
        pendingLocalSave = false;
        pushOk = true;
        store.set(LASTSYNC_KEY, String(Date.now()));
        updateAvatar();
        if (interactive) toast(tr('در Google Drive ذخیره شد') + ' ✓');
      })
      .catch(function () {
        if (interactive) toast(tr('ذخیره در گوگل نشد؛ یک‌بار دیگر ثبت را بزن'));
      })
      .then(finish);
  };

  if (!tokenAlive()) {
    requestAccessToken(function (ok) {
      if (ok) run();
      else {
        // ذخیرهٔ محلی انجام شده؛ بعداً بی‌صدا دوباره تلاش می‌شود
        if (interactive) toast(tr('برای ذخیره در گوگل دوباره ثبت را بزن'));
        finish();
      }
    }, interactive === true);
    return;
  }
  run();
}

export function googleSyncOk() {
  return tokenAlive();
}

export function renderSyncCard() {
  if (gUser && tokenAlive()) return '';
  if (gUser) {
    if (tokenRequesting) {
      return (
        '<div class="card"><h3>' + icon('cloud') + (' ' + tr('اتصال به گوگل') + '</h3>') +
        ('<div class="small muted">' + tr('در حال تمدید اتصال…') + '</div></div>')
      );
    }
    const hint = tokenErrorHint();
    return (
      '<div class="card"><h3>' + icon('cloud') + (' ' + tr('اتصال به گوگل') + '</h3>') +
      ('<div class="small muted" style="margin-bottom:12px">' + tr('اتصال به گوگل درایو برقرار نیست.') + ' ') +
      (hint ? hint : tr('برای ادامهٔ همگام‌سازی یک بار دیگر وارد شو.')) +
      '</div>' +
      ('<button class="btn primary block" onclick="googleSignIn()">' + tr('اتصال دوباره') + '</button></div>')
    );
  }
  return (
    '<div class="card"><h3>' + icon('cloud') + (' ' + tr('همگام‌سازی ابری') + '</h3>') +
    ('<div class="small muted" style="margin-bottom:12px">' + tr('با حساب گوگل وارد شو تا داده‌هایت خودکار در Google Drive ذخیره شود و از هر دستگاهی در دسترس باشد.') + '</div>') +
    ('<button class="btn primary block" onclick="googleSignIn()">' + tr('ورود با گوگل') + '</button></div>')
  );
}

let initDone = false;
export function initGoogleOnLoad() {
  if (initDone) return;
  initDone = true;
  setTimeout(updateAvatar, 0);
  pingSyncRoutes(null, savedRoute().id); // فقط مسیرِ ذخیره‌شده: یک پینگ در هر بوت، نه دو تا
  const u = store.get('g_user');
  if (u) {
    try {
      gUser = JSON.parse(u);
    } catch (e) {}
  }
  loadSavedToken();
  if (consumeWorkerCallback()) return;
  // پروفایل ناقص از ورودهای قبلی: اگر توکن زنده است، بی‌هزینه تکمیل کن
  if (gUser && tokenAlive() && (!gUser.picture || !gUser.email || gUser.name === tr('حساب گوگل'))) setTimeout(fetchProfile, 1500);
  if (store.get('g_signed') === '1') {
    // اول تلاشِ بی‌صدا؛ اگر سشن گوگل زنده باشد کاربر هیچ صفحهٔ لاگینی نمی‌بیند
    requestAccessToken(function (ok) {
      if (ok) {
        loadFromDrive(function () {
          render();
        }, false, true);
      } else {
        render();
      }
    }, false);
  }
  render();
}

loadSavedToken();

// تمدید پیشگیرانهٔ توکن (چند دقیقه قبل از انقضا) تا کاربر اصلاً قطع‌شدن را نبیند
setInterval(function () {
  if (!gUser || tokenRequesting) return;
  if (document.visibilityState !== 'visible') return;
  if (!gToken || !gToken.token) return;
  if (gToken.exp - Date.now() < 5 * 60000) requestAccessToken(function () {}, false);
}, 60000);

export function refreshFromDrive() {
  if (!gUser) return;
  if (!tokenAlive() && !tokenRequesting) {
    // توکن تمام شده؛ بی‌صدا تمدید کن تا کارت «اتصال دوباره» بی‌دلیل نماند
    requestAccessToken(function (ok) {
      if (ok && !pullInFlight && !pushInFlight) {
        if (pendingLocalSave) pushToDrive(false);
        else loadFromDrive(function () { render(); }, false, true);
      }
    }, false);
    return;
  }
  if (pullInFlight || pushInFlight || pendingLocalSave) return;
  if (Date.now() - lastPullAt < 30000) return;
  const done = function () {
    render();
  };
  requestAccessToken(function (ok) {
    if (ok) loadFromDrive(done, false, true);
  }, false);
}

let pageSyncTimer = null;
export function syncOnPageChange() {
  if (!gUser) return;
  if (pushInFlight || pullInFlight) return;
  clearTimeout(pageSyncTimer);
  pageSyncTimer = setTimeout(function () {
    if (pushInFlight || pullInFlight) return;
    if (pendingLocalSave) {
      pushToDrive(false);
      return;
    }
    loadFromDrive(
      function () {
        render();
      },
      false,
      true
    );
  }, 350);
}
