import { avatarHTML, syncStatusText, displayName } from './sync.js';
import { needsOnboarding, openOnboarding } from './onboard.js';
import { esc, store, toast, isMoneyHidden, setMoneyHidden, APP_VERSION, infoTip, toFa, fmtPlain, saveFile } from './utils.js';
import { fmtDate, curMonthKey } from './jalali.js';
import { t, t as tr, LANGS, langPref, lang, digitsPref, setDigitsPref } from './i18n.js';
import { remindSummary } from './remind.js';
import { icon, hasIcon } from './icons.js';
import { saveGeminiKey, clearGeminiKey } from './scan.js';
import { openModal, closeModal } from './modal.js';
import { render } from './view.js';
import { state, replaceState, save, allCurrencies, rateOf, baseCur, currencyInfo, changeBaseCurrency, CURRENCIES, curName, bookCal } from './state.js';
import { profileFor } from './state.js';
import { profileName, openProfileSettings } from './reflect.js';
import { scanHistOn, setScanHistOn } from './scanhist.js';
import { curIconHtml } from './cards.js';
import * as sec from './securestore.js';
import {
  newRecoveryPhrase,
  normalizePhrase,
  phraseValid,
  phraseUnknownWords,
  PHRASE_WORDS,
  randBytes,
  b64,
  unb64,
  importKekFromRaw,
  wrapDataKeyWithKek,
  unwrapDataKeyWithKek,
} from './crypto.js';

export { saveGeminiKey, clearGeminiKey };

function geminiHelpHref() {
  const base = location.pathname.indexOf('/test') >= 0 ? '../help-gemini.html' : 'help-gemini.html';
  return base + '?lang=' + (lang() === 'en' ? 'en' : 'fa');
}

const THEME_KEY = 'capital_theme';
const PIN_KEY = 'capital_pin_hash';
const BIO_KEY = 'capital_bio_id';
const LEGACY_DATA_KEY = 'capital_app_v1';

export const THEMES = [
  { id: 'night', name: tr('شب'), c1: '#0b0f17', c2: '#3d8bfd' },
  { id: 'black', name: tr('شب مطلق'), c1: '#000000', c2: '#4d94ff' },
  { id: 'light', name: tr('روشن'), c1: '#f4f6fb', c2: '#2563eb' },
  { id: 'ocean', name: tr('اقیانوس'), c1: '#07151c', c2: '#22d3ee' },
  { id: 'forest', name: tr('جنگل'), c1: '#0c1410', c2: '#34d399' },
  { id: 'sunset', name: tr('غروب'), c1: '#140e12', c2: '#fb7185' },
];

export function currentTheme() {
  return store.get(THEME_KEY) || 'light';
}

export function applyTheme(id) {
  const t = THEMES.find((x) => x.id === id) ? id : 'light';
  const prev = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme', t);
  store.set(THEME_KEY, t);
  const meta = document.querySelector('meta[name="theme-color"]');
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (meta && bg) meta.setAttribute('content', bg);
  // گذرِ ملایم هنگام عوض‌شدن تم (نه بار اول)
  const rm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prev && prev !== t && !rm) {
    document.documentElement.classList.add('theme-fade');
    clearTimeout(applyTheme._t);
    applyTheme._t = setTimeout(() => document.documentElement.classList.remove('theme-fade'), 420);
  }
}

export function togglePrivacy() {
  setMoneyHidden(!isMoneyHidden());
  syncPrivacyBtn();
  render();
}

export function syncPrivacyBtn() {
  const btn = document.getElementById('btnPrivacy');
  if (btn) btn.innerHTML = icon(isMoneyHidden() ? 'eyeOff' : 'eye');
}

// ─── پین: در حالت رمزشده «کلید» است، در حالت قدیمی فقط هش ─────────────────
export function hasPin() {
  if (sec.isEncrypted()) return false; // در حالت رمزنگاری پین وجود ندارد؛ فقط رمز عبور + اثر انگشت
  return !!store.get(PIN_KEY);
}

export function bioAvailable() {
  return !!(
    window.PublicKeyCredential &&
    (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  );
}

async function hashPin(pin) {
  const data = new TextEncoder().encode('capital:' + pin);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function readBioRecord() {
  const raw = store.get(BIO_KEY);
  if (!raw) return null;
  if (raw.charAt(0) === '{') {
    try {
      const rec = JSON.parse(raw);
      return rec && (rec.v === 2 || rec.v === 3) && rec.id ? rec : null;
    } catch (e) {
      return null;
    }
  }
  return { v: 1, id: raw };
}

export async function setPin(pin) {
  if (sec.isEncrypted()) return false;
  if (!/^\d{4,8}$/.test(pin)) {
    toast(tr('رمز باید ۴ تا ۸ رقم باشد'));
    return false;
  }
  store.set(PIN_KEY, await hashPin(pin));
  toast(tr('رمز ذخیره شد'));
  return true;
}

export function clearPin() {
  if (sec.isEncrypted()) return;
  store.set(PIN_KEY, '');
  store.set(BIO_KEY, '');
  toast(tr('قفل برداشته شد'));
}

export async function checkPin(pin) {
  const saved = store.get(PIN_KEY);
  if (!saved) return true;
  return (await hashPin(pin)) === saved;
}

export async function enableBiometric() {
  if (!bioAvailable() || !window.PublicKeyCredential) {
    toast(tr('اثر انگشت روی این دستگاه/آدرس در دسترس نیست'));
    return false;
  }
  const encrypted = sec.isEncrypted();
  if (encrypted && !sec.isUnlocked()) {
    toast(tr('اول با رمز عبور وارد شو، بعد اثر انگشت را فعال کن'));
    return false;
  }
  try {
    if (
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable &&
      !(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    ) {
      toast(tr('روی این دستگاه اثر انگشت/قفل صفحه برای مرورگر فعال نیست'));
      return false;
    }
  } catch (e) {}
  try {
    // فقط یک اعتبارنامهٔ سادهٔ پلتفرم برای «تأیید هویت با اثر انگشت» — نه passkey.
    // (residentKey/discoverable باعث می‌شد کروم بخواهد passkey در Google Password Manager بسازد)
    const publicKey = {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: tr('تراز'), id: location.hostname },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: 'capital-app',
        displayName: tr('تراز'),
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'discouraged',
        requireResidentKey: false,
      },
      attestation: 'none',
      timeout: 60000,
    };
    const cred = await navigator.credentials.create({ publicKey });
    if (!cred) return false;

    if (encrypted) {
      if (!sec.isUnlocked()) return false;
      // کلید داده با یک راز محلیِ تصادفی پیچیده می‌شود؛ اثر انگشت دروازهٔ استفاده از آن است
      const ds = randBytes(32);
      const dsKek = await importKekFromRaw(ds);
      const dsWrap = await wrapDataKeyWithKek(sec.getDataKey(), dsKek);
      store.set(BIO_KEY, JSON.stringify({ v: 3, id: b64(cred.rawId), dsWrap, ds: b64(ds) }));
      toast((tr('ورود با اثر انگشت فعال شد') + ' ✓'));
      return true;
    }
    store.set(BIO_KEY, b64(cred.rawId));
    toast(tr('ورود با اثر انگشت فعال شد'));
    return true;
  } catch (e) {
    if (window.__capLog) window.__capLog('enableBiometric', e);
    const name = (e && e.name) || '';
    if (name === 'NotAllowedError') toast(tr('اجازهٔ اثر انگشت داده نشد یا زمان تمام شد'));
    else if (name === 'NotSupportedError') toast(tr('این دستگاه این نوع اثر انگشت را پشتیبانی نمی‌کند'));
    else if (name === 'SecurityError') toast(tr('این آدرس اجازهٔ اثر انگشت ندارد (باید https باشد)'));
    else if (name === 'InvalidStateError') toast(tr('قبلاً روی این دستگاه ثبت شده؛ اول خاموشش کن و دوباره فعال کن'));
    else toast((tr('فعال‌سازی اثر انگشت انجام نشد') + ' (') + (name || (e && e.message) || '?') + ')');
    return false;
  }
}

export function disableBiometric() {
  store.set(BIO_KEY, '');
  toast(tr('اثر انگشت خاموش شد'));
}

// وقتی کلید داده عوض می‌شود (یکی‌کردن دو دستگاه) رکورد اثر انگشت بی‌اعتبار است
export function clearBioRecord() {
  store.set(BIO_KEY, '');
}

// تعویض کلید در جریان یکی‌کردن داده‌ها: رکورد را نگه می‌داریم اما «مرده» علامت می‌زنیم
// تا با اولین ورود موفقِ رمز عبور، خودکار با کلید جدید ترمیم شود (دوباره ثبت لازم نیست)
export function strikeBioRecord() {
  const rec = readBioRecord();
  if (!rec || !rec.id || rec.dead) return;
  try {
    store.set(BIO_KEY, JSON.stringify(Object.assign({}, rec, { dead: true })));
  } catch (e) {}
}

export function hasBiometric() {
  const rec = readBioRecord();
  return !!(rec && !rec.dead);
}

// نتیجه: {ok} در حالت قدیمی؛ {ok, state} در حالت رمزشده
export async function tryBiometric() {
  const rec = readBioRecord();
  if (!rec || !bioAvailable()) return { ok: false };
  if (rec.dead) return { ok: true, stale: true }; // نشان‌دار شده؛ با ورود رمز عبور ترمیم می‌شود
  try {
    const publicKey = {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: unb64(rec.id) }],
      userVerification: 'required',
      timeout: 45000,
    };
    if (rec.v === 2 && sec.isEncrypted()) {
      publicKey.extensions = { prf: { eval: { first: unb64(rec.prf) } } };
    }
    let cred;
    try {
      cred = await navigator.credentials.get({ publicKey });
    } catch (e) {
      if (window.__capLog) window.__capLog('tryBiometric:get', e);
      return { ok: false, err: (e && e.name) || 'get' };
    }
    if (!cred) return { ok: false };
    if (sec.isEncrypted() && rec.v >= 2) {
      // ۱) اتصال قوی با PRF
      if (rec.v === 2) {
        let ext = null;
        try {
          ext = cred.getClientExtensionResults();
        } catch (e) {}
        const first = ext && ext.prf && ext.prf.results && ext.prf.results.first;
        if (first) {
          try {
            const kek = await importKekFromRaw(new Uint8Array(first));
            const key = await unwrapDataKeyWithKek(rec.wrap, kek);
            return { ok: true, state: await sec.unlockWithKey(key) };
          } catch (e) {
            if (window.__capLog) window.__capLog('tryBiometric:prf', e);
          }
        }
      }
      // ۲) کلید پشتیبان محلی — ورود تک‌لمسی مثل بقیهٔ اپ‌ها
      if (rec.dsWrap && rec.ds) {
        try {
          const kek = await importKekFromRaw(unb64(rec.ds));
          const key = await unwrapDataKeyWithKek(rec.dsWrap, kek);
          return { ok: true, state: await sec.unlockWithKey(key) };
        } catch (e) {
          if (window.__capLog) window.__capLog('tryBiometric:ds', e);
          // رکورد با کلید قدیمی (بعد از بازیابی/ادغام) — پاکش نمی‌کنیم؛ با اولین ورود
          // موفق رمز عبور خودش با کلید جدید ترمیم می‌شود
          strikeBioRecord();
          return { ok: true, stale: true };
        }
      }
      return { ok: true, gateOnly: true };
    }
    if (sec.isEncrypted()) {
      // رکورد قدیمی: اولین فرصت که نشست باز بود ارتقا می‌دهیم
      if (sec.isUnlocked()) upgradeBioRecord();
      return { ok: true, gateOnly: true };
    }
    return { ok: !!cred };
  } catch (e) {
    if (window.__capLog) window.__capLog('tryBiometric', e);
    return { ok: false, err: (e && e.name) || 'unknown' };
  }
}

// ارتقای رکوردهای قدیمی اثر انگشت به حالت تک‌لمسی (بدون نیاز به ثبت دوباره)
export async function upgradeBioRecord() {
  try {
    const rec = readBioRecord();
    if (!rec || !sec.isEncrypted() || !sec.isUnlocked()) return;
    if (rec.v === 1 || (rec.v === 2 && !rec.dsWrap)) {
      const ds = randBytes(32);
      const kek = await importKekFromRaw(ds);
      const dsWrap = await wrapDataKeyWithKek(sec.getDataKey(), kek);
      const next =
        rec.v === 2
          ? Object.assign({}, rec, { dsWrap, ds: b64(ds) })
          : { v: 3, id: rec.id, dsWrap, ds: b64(ds) };
      store.set(BIO_KEY, JSON.stringify(next));
    }
  } catch (e) {
    if (window.__capLog) window.__capLog('upgradeBioRecord', e);
  }
}

let bioBusy = false;
export async function bioUnlock(auto) {
  if (bioBusy) return;
  bioBusy = true;
  let res;
  try {
    res = await tryBiometric();
  } finally {
    bioBusy = false;
  }
  if (!res || !res.ok) {
    if (auto && res && res.err === 'NotAllowedError') {
      // کاربر لغو کرد؛ بی‌صدا به رمز عبور برمی‌گردیم
      const inp = document.getElementById('lockPin');
      if (inp) inp.focus();
      return;
    }
    if (res && res.sensorOk) {
      toast(tr('اثر انگشت تأیید شد ولی بازکردن داده ناموفق بود'));
    } else if (res && res.err === 'NotAllowedError') {
      toast(tr('اثر انگشت تأیید نشد'));
    } else {
      toast(tr('اثر انگشت تأیید نشد') + (res && res.err ? ' (' + res.err + ')' : ''));
    }
    return;
  }
  if (res.state) {
    finalizeUnlock(res.state);
    return;
  }
  if (res.stale) {
    setLockMode('pass');
    toast(tr('اثر انگشت با کلید قدیمی ثبت شده بود؛ با رمز عبور وارد شو و دوباره فعالش کن'));
    return;
  }
  if (res.gateOnly && sec.isEncrypted()) {
    if (sec.isUnlocked()) {
      // نشست هنوز کلید را در حافظه دارد؛ فقط صفحه باز می‌شود
      unlockApp();
      return;
    }
    openModal(`
      <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
      <div style="text-align:center;padding:6px 2px">
        <div style="font-size:34px;margin-bottom:8px">👆</div>
        <p style="margin:0 0 14px">${tr('اثر انگشت تأیید شد، ولی این مرورگر نمی‌تواند داده‌ها را مستقیم با آن باز کند.')}<br>${tr('پین یا رمز عبور را وارد کن.')}</p>
        <button class="btn primary block" onclick="closeModal();document.getElementById('lockPin').focus()">${tr('باشه')}</button>
      </div>`);
    return;
  }
  unlockApp();
}

// ─── صفحهٔ قفل: دو حالت پین / رمز عبور ─────────────────────────────────────
let lockMode = 'pin';
let pinFailCount = 0;

export function getLockMode() {
  return lockMode;
}

export function setLockMode(mode, sub) {
  lockMode = mode;
  const title = document.getElementById('lockTitle');
  const lbl = document.getElementById('lockSub');
  const inp = document.getElementById('lockPin');
  const bio = document.getElementById('lockBio');
  if (title) title.textContent = tr('ورود');
  if (lbl)
    lbl.textContent =
      sub ||
      (mode === 'pass'
        ? tr('رمز عبور')
        : tr('رمز ورود'));
  if (inp) {
    inp.value = '';
    inp.placeholder = mode === 'pass' ? tr('رمز عبور') : tr('پین');
    inp.maxLength = mode === 'pass' ? 64 : 8;
    inp.setAttribute('inputmode', mode === 'pass' ? 'text' : 'numeric');
    inp.setAttribute('pattern', mode === 'pass' ? '.*' : '[0-9]*');
  }
  if (bio) bio.style.display = hasBiometric() && (sec.isEncrypted() || hasPin()) ? '' : 'none';
  const forgot = document.getElementById('lockForgot');
  if (forgot) forgot.style.display = sec.isEncrypted() ? '' : 'none';
  const sw = document.getElementById('lockSwitch');
  if (sw) {
    sw.style.display = 'none';
  }
}

export function toggleLockMode() {
  pinFailCount = 0;
  if (lockMode === 'pin') setLockMode('pass');
  else if (hasPin()) setLockMode('pin');
  const inp = document.getElementById('lockPin');
  if (inp) inp.focus();
}

export function unlockApp() {
  const lock = document.getElementById('lockScreen');
  if (lock) lock.classList.remove('show');
  document.documentElement.classList.remove('needs-lock');
  document.body.classList.remove('locked');
  const pin = document.getElementById('lockPin');
  if (pin) pin.value = '';
}

export function lockApp() {
  if (sec.isEncrypted()) {
    // همیشه می‌توان قفل کرد؛ حالت از قبل تعیین شده
    // اگر به گوگل وصلیم، همان ابتدا کلیدهای احتمالاً جدید را می‌گیریم تا رمز جدید از اول قبول شود
    import('./sync.js')
      .then((sync) => {
        if (!sync.isGoogleLinked()) return;
        const dbg = document.getElementById('lockDebug');
        if (dbg) {
          dbg.style.color = 'var(--muted)';
          dbg.textContent = tr('در حال همگام‌سازی با گوگل…');
        }
        sync.pullRemoteWrapsNow((changed) => {
          if (dbg && dbg.textContent === 'در حال همگام‌سازی با گوگل…') dbg.textContent = '';
          if (changed) toast((tr('رمز عبور جدید از دستگاه دیگر دریافت شد') + ' ✓'));
        });
      })
      .catch(() => {});
  } else if (!hasPin()) {
    return;
  }
  const lock = document.getElementById('lockScreen');
  const pin = document.getElementById('lockPin');
  if (pin) pin.value = '';
  document.documentElement.classList.add('needs-lock');
  document.body.classList.add('locked');
  if (lock) lock.classList.add('show');
  const bioBtn = document.getElementById('lockBio');
  const bioOn = hasBiometric() && (sec.isEncrypted() || hasPin());
  if (bioBtn) bioBtn.style.display = bioOn ? '' : 'none';
  if (bioOn && document.visibilityState === 'visible') {
    // مثل بقیهٔ اپ‌ها: خودکار اثر انگشت را می‌پرسد؛ اگر کاربر لغو کند، رمز عبور می‌ماند
    autoBioPrompt();
  } else {
    setTimeout(() => {
      if (pin) pin.focus();
    }, 80);
  }
}

let autoBioAt = 0;
function autoBioPrompt() {
  if (Date.now() - autoBioAt < 1500) return;
  autoBioAt = Date.now();
  setTimeout(() => {
    if (!document.body.classList.contains('locked')) return;
    bioUnlock(true);
  }, 250);
}

export function showLockForRemote() {
  setLockMode('pass', tr('رمز عبور (همان رمز دستگاه‌های دیگر)'));
  lockApp();
}

function finalizeUnlock(st) {
  replaceState(st);
  pinFailCount = 0;
  render();
  unlockApp();
  upgradeBioRecord();
  healBioRecord();
  document.dispatchEvent(new CustomEvent('cap:unlocked'));
}

// ترمیم خودکار اثر انگشت بعد از ورود با رمز عبور: اگر رکورد «مرده» مانده (کلید داده
// هنگام یکی‌کردن دستگاه‌ها عوض شده بود)، با کلید فعلی دوباره می‌پیچیم تا همان اثر انگشت
// دفعهٔ بعد کار کند — بدون نیاز به ثبت دوباره در تنظیمات
async function healBioRecord() {
  try {
    const rec = readBioRecord();
    if (!rec || !rec.dead || !rec.id) return;
    if (!sec.isEncrypted() || !sec.isUnlocked()) return;
    const ds = randBytes(32);
    const kek = await importKekFromRaw(ds);
    const dsWrap = await wrapDataKeyWithKek(sec.getDataKey(), kek);
    store.set(BIO_KEY, JSON.stringify({ v: 3, id: rec.id, dsWrap, ds: b64(ds) }));
    toast((tr('اثر انگشت دوباره فعال شد') + ' ✓'));
  } catch (e) {
    if (window.__capLog) window.__capLog('healBioRecord', e);
  }
}

export async function submitLockPin() {
  const inp = document.getElementById('lockPin');
  const val = String((inp && inp.value) || '').trim();
  if (!val) {
    toast(lockMode === 'pass' ? tr('اول رمز عبور را بنویس') : tr('اول رمز را بنویس'));
    return;
  }
  if (sec.isEncrypted()) {
    const btn = document.querySelector('#lockScreen .btn.primary');
    const setBusy = (b, txt) => {
      if (btn) {
        btn.disabled = b;
        btn.textContent = txt || tr('ورود');
      }
    };
    try {
      const st = await sec.unlock(val, 'pass');
      finalizeUnlock(st);
      return;
    } catch (e) {}
    // رمز به پاکت محلی نخورد. شاید رمز روی دستگاه دیگر عوض شده و این دستگاه هنوز
    // کلیدهای جدید را از گوگل نگرفته؛ همین حالا می‌گیریم و دوباره امتحان می‌کنیم
    let retried = false;
    try {
      const sync = await import('./sync.js');
      if (sync.isGoogleLinked()) {
        setBusy(true, tr('بررسی رمز جدید از گوگل…'));
        const changed = await new Promise((res) => sync.pullRemoteWrapsNow(res));
        if (changed) {
          retried = true;
          const st = await sec.unlock(val, 'pass');
          setBusy(false);
          finalizeUnlock(st);
          toast((tr('رمز جدید از دستگاه دیگر دریافت شد') + ' ✓'));
          return;
        }
      }
    } catch (e) {
      if (window.__capLog) window.__capLog('lock:remoteRetry', e);
    }
    setBusy(false);
    // اگر نسخهٔ گوگل با کلید/رمز دیگری در انتظار یکی‌شدن است، همین‌جا مسیرش را باز کن
    // تا کاربر به‌جای «رمز اشتباه» تکراری، مستقیم وارد روند یکی‌کردن دستگاه‌ها شود
    try {
      const sync2 = await import('./sync.js');
      if (sync2.hasPendingRemote && sync2.hasPendingRemote()) {
        setBusy(false);
        sync2.openRemotePassModalNow && sync2.openRemotePassModalNow();
        return;
      }
    } catch (e) {}
    pinFailCount++;
    toast(retried ? tr('رمز عبور اشتباه است') : tr('رمز عبور اشتباه است') + (pinFailCount >= 2 ? (' — ' + tr('اگر تازه روی دستگاه دیگر عوضش کرده‌ای، چند ثانیه صبر کن و دوباره بزن')) : ''));
    if (inp) {
      inp.value = '';
      inp.focus();
    }
    return;
  }
  if (await checkPin(val)) unlockApp();
  else toast(tr('رمز اشتباه است'));
}

// ─── فراموشی رمز عبور: بازیابی با عبارت بازیابی ───────────────────────────
let recPhraseValue = '';

export function startPhraseRecovery() {
  recPhraseValue = '';
  openModal(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>${tr('بازیابی با عبارت بازیابی')}</h2>
    <p class="small muted">${tr('آن {n} کلمه را که روی کاغذ نوشتی به ترتیب وارد کن.', { n: PHRASE_WORDS })}</p>
    <div class="field"><label>${tr('عبارت بازیابی')}</label>
      <input class="input" id="recPhrase" dir="ltr" autocomplete="off" placeholder="word word word …" style="text-align:left">
    </div>
    <div id="recErr" class="hint" style="display:none;color:#fb7185"></div>
    <button class="btn primary block" style="margin-top:12px" onclick="recoveryStep2()">${tr('ادامه')}</button>
  `);
}

export async function recoveryStep2() {
  const inp = document.getElementById('recPhrase');
  const val = (inp && inp.value) || '';
  const unknown = phraseUnknownWords(val);
  const err = document.getElementById('recErr');
  if (!phraseValid(val)) {
    if (err) {
      err.style.display = '';
      err.textContent = unknown.length
        ? (tr('این کلمه‌ها در فهرست نیستند:') + ' ') + unknown.join('، ')
        : tr('باید دقیقاً {n} کلمهٔ درست وارد کنی.', { n: PHRASE_WORDS });
    }
    return;
  }
  // عبارت واقعاً با کلید داده امتحان می‌شود، نه فقط از نظر املایی
  try {
    await sec.verifyPhrase(val);
  } catch (e) {
    if (window.__capLog) window.__capLog('recoveryStep2', e);
    if (err) {
      err.style.display = '';
      err.textContent = tr('این عبارت به داده‌های این دستگاه نمی‌خورد؛ ترتیب و املای کلمه‌ها را دوباره چک کن.');
    }
    return;
  }
  // عبارت برای مرحلهٔ بعد نگه داشته می‌شود چون اینپوت از صفحه می‌رود
  recPhraseValue = normalizePhrase(val).join(' ');
  openModal(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>${tr('رمز عبور جدید')}</h2>
    <p class="small muted">${tr('عبارت درست است')} ✓ ${tr('حالا یک رمز عبور جدید انتخاب کن (حداقل ۸ نویسه).')}</p>
    <div class="field"><label>${tr('رمز عبور جدید')}</label>
      <input class="input" id="recPass" type="password" autocomplete="new-password" dir="ltr"></div>
    <div class="field"><label>${tr('تکرار رمز عبور')}</label>
      <input class="input" id="recPass2" type="password" autocomplete="new-password" dir="ltr"></div>
    <div id="recPassErr" class="hint" style="display:none;color:#fb7185"></div>
    <button class="btn primary block" id="recFinishBtn" style="margin-top:12px" onclick="recoveryFinish()">${tr('ورود')}</button>
  `);
  setTimeout(() => {
    const p1 = document.getElementById('recPass');
    if (p1) p1.focus();
  }, 60);
}

function recPassError(msg) {
  const err = document.getElementById('recPassErr');
  if (err) {
    err.style.display = '';
    err.textContent = msg;
  }
  toast(msg);
}

export async function recoveryFinish() {
  const phrase = recPhraseValue;
  const a = (document.getElementById('recPass') || {}).value || '';
  const b = (document.getElementById('recPass2') || {}).value || '';
  if (!phrase) {
    startPhraseRecovery();
    return;
  }
  if (a.length < 8) {
    recPassError(tr('رمز عبور حداقل ۸ نویسه باشد'));
    return;
  }
  if (a !== b) {
    recPassError(tr('رمزها یکی نیستند'));
    return;
  }
  const btn = document.getElementById('recFinishBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = tr('در حال ورود…');
  }
  try {
    const st = await sec.recoverWithPhrase(phrase, a);
    recPhraseValue = '';
    closeModal();
    finalizeUnlock(st);
    toast((tr('رمز عبور جدید ذخیره شد') + ' ✓'));
  } catch (e) {
    if (window.__capLog) window.__capLog('recoveryFinish', e);
    if (btn) {
      btn.disabled = false;
      btn.textContent = tr('ورود');
    }
    recPassError((tr('بازیابی انجام نشد:') + ' ') + ((e && e.message) || e));
  }
}

// ─── جادوگر فعال‌کردن رمزنگاری ─────────────────────────────────────────────
let wizPass = '';
let wizPhrase = '';
let wizCheckA = 0;
let wizCheckB = 0;

export function openEncryptSetup() {
  const legacyPin = !sec.isEncrypted() && !!store.get(PIN_KEY);
  openModal(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>🔐 ${tr('فعال‌کردن رمزنگاری')}</h2>
    <p class="small muted">${tr('از این پس داده‌ها چه روی گوشی چه در گوگل‌درایو فقط با کلید تو خوانده می‌شوند.')}
    ${tr('یک {a} انتخاب کن؛ کلید اصلی داده‌های توست.', { a: '<b>' + tr('رمز عبور') + '</b>' })}</p>
    <div class="field"><label>${tr('رمز عبور (حداقل ۸ نویسه)')}</label>
      <input class="input" id="encPass" type="password" autocomplete="new-password" dir="ltr"></div>
    <div class="field"><label>${tr('تکرار رمز عبور')}</label>
      <input class="input" id="encPass2" type="password" autocomplete="new-password" dir="ltr"></div>
    ${
      legacyPin
        ? ('<div class="field"><label>' + tr('پین فعلی‌ات (برای انتقال به سیستم جدید)') + '</label><input class="input" id="encOldPin" inputmode="numeric" dir="ltr"></div>')
        : ''
    }
    <div class="hint">⚠️ ${tr('اگر این رمز فراموش شود و عبارت بازیابی هم نباشد، داده‌ها قابل بازگشت نیستند.')}</div>
    <button class="btn primary block" style="margin-top:12px" onclick="encryptStep2()">${tr('ادامه')}</button>
  `);
}

export async function encryptStep2() {
  const a = (document.getElementById('encPass') || {}).value || '';
  const b = (document.getElementById('encPass2') || {}).value || '';
  if (a.length < 8) {
    toast(tr('رمز عبور حداقل ۸ نویسه باشد'));
    return;
  }
  if (a !== b) {
    toast(tr('رمزها یکی نیستند'));
    return;
  }
  wizPass = a;
  wizPhrase = newRecoveryPhrase();
  const words = wizPhrase.split(' ');
  const idxs = [...Array(words.length).keys()];
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }
  wizCheckA = idxs[0];
  wizCheckB = idxs[1];
  openModal(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>📜 ${tr('عبارت بازیابی')}</h2>
    <p class="small muted">${tr('این {n} کلمه را {b} و جای امن بگذار.', { n: PHRASE_WORDS, b: '<b>' + tr('روی کاغذ یادداشت کن') + '</b>' })}
    ${tr('اگر رمز عبور را فراموش کنی، فقط با این عبارت می‌توانی داده‌ها را پس بگیری.')}</p>
    <div class="phrase-grid" dir="ltr">
      ${words.map((w, i) => `<span class="phrase-w"><b>${i + 1}</b> ${esc(w)}</span>`).join('')}
    </div>
    <div class="field" style="margin-top:14px"><label>${tr('برای اطمینان: کلمهٔ شمارهٔ {n}؟', { n: wizCheckA + 1 })}</label>
      <input class="input" id="wizChkA" dir="ltr" autocomplete="off" style="text-align:left"></div>
    <div class="field"><label>${tr('کلمهٔ شمارهٔ {n}؟', { n: wizCheckB + 1 })}</label>
      <input class="input" id="wizChkB" dir="ltr" autocomplete="off" style="text-align:left"></div>
    <div class="hint">${tr('اسکرین‌شات نگیر؛ فقط کاغذ.')}</div>
    <button class="btn primary block" style="margin-top:12px" onclick="encryptStep3()">${tr('فعال کن')}</button>
  `);
}

export function encryptStep3() {
  const words = wizPhrase.split(' ');
  const ca = String((document.getElementById('wizChkA') || {}).value || '').trim().toLowerCase();
  const cb = String((document.getElementById('wizChkB') || {}).value || '').trim().toLowerCase();
  if (ca !== words[wizCheckA] || cb !== words[wizCheckB]) {
    toast(tr('کلمه‌ها را درست یادداشت نکردی؛ دوباره نگاه کن'));
    return;
  }
  return encryptFinish(true);
}

export async function encryptFinish() {
  const pin = null;
  try {
    // جلوگیری از تولد «کلید انشعابی»: اگر روی گوگل از قبل پاکت رمزشده هست،
    // همان پذیرفته شود؛ ساخت کلید جدید در این نقطه یعنی از دست‌رفتنِ رمز/پین/اثر انگشتِ این دستگاه در سینک بعدی
    try {
      const sync = await import('./sync.js');
      if (sync.isGoogleLinked()) {
        await new Promise((res) => sync.requestAccessToken(() => res(), false));
        const adopted = await new Promise((res) => {
          let done = false;
          const t = setTimeout(() => {
            if (!done) { done = true; res(false); }
          }, 8000);
          sync.adoptRemoteEncryptionIfAny((ok) => {
            if (!done) { done = true; clearTimeout(t); res(ok); }
          });
        });
        if (adopted) {
          wizPass = '';
          wizPhrase = '';
          closeModal();
          return; // پاکت دوردست آمد و قفلش نمایان است؛ با رمز همان وارد می‌شوی
        }
      }
    } catch (e) { /* آفلاین یا بدون گوگل → فعال‌سازی محلی معمول */ }
    await (delete state.encOff, sec.enableEncryption)(state, wizPass, wizPhrase, pin);
    store.set(LEGACY_DATA_KEY, '');
    store.set(PIN_KEY, '');
    wizPass = '';
    wizPhrase = '';
    closeModal();
    setLockMode('pass');
    render();
    toast((tr('رمزنگاری فعال شد') + ' 🔐'));
    document.dispatchEvent(new CustomEvent('cap:encrypt-on'));
  } catch (e) {
    if (window.__capLog) window.__capLog(tr('فعال‌سازی رمزنگاری'), e);
    toast(tr('مشکلی پیش آمد؛ دوباره تلاش کن'));
  }
}

// پین در حالت رمزنگاری حذف شده؛ این دو تابع برای سازگاری با app.js می‌مانند
export function openPinRestoreModal() {}
export async function savePinRestore() {}

// ─── تغییر رمز عبور / عبارت بازیابی جدید ───────────────────────────────────
export function disableEncPrompt() {
  openModal(`
    <button class="x" onclick="openSettingsSecurity()" aria-label="${tr('بازگشت')}">${icon('x')}</button>
    <h2>${tr('خاموش کردن رمزنگاری')}</h2>
    <p class="hint">${tr('بعد از این، داده‌ها روی این گوشی و در Google Drive بدون رمز ذخیره می‌شوند و دستگاه‌های دیگرت هم در همگام‌سازی بعدی از حالت رمز خارج می‌شوند. اثر انگشت و قفل ورود هم برداشته می‌شود.')}</p>
    <div class="hint" style="margin:0 0 12px">${tr('یادآوری: پشتیبان‌های رمزشدهٔ قبلی فقط با رمز عبور همان زمان باز می‌شوند؛ اگر ممکن است آن را فراموش کنی، بعد از خاموش‌کردن یک پشتیبان ساده هم بگیر.')}</div>
    <div class="field"><label>${tr('رمز عبور فعلی')}</label>
      <input class="input" id="deOld" type="password" autocomplete="off" dir="ltr"></div>
    <button class="btn danger block" style="margin-top:12px" onclick="disableEncDo()">${tr('بله، رمزنگاری را خاموش کن')}</button>
    <button class="btn block" style="margin-top:8px" onclick="openSettingsSecurity()">${tr('انصراف')}</button>
  `);
}
export async function disableEncDo() {
  const pass = String((document.getElementById('deOld') || {}).value || '');
  if (!pass) { toast(tr('رمز عبور را وارد کن')); return; }
  try {
    await sec.unlock(pass, 'pass');
  } catch (e) {
    toast(tr('رمز عبور درست نیست'));
    return;
  }
  // نشانه برای دستگاه‌های دیگر: از این زمان به بعد داده ساده است
  state.encOff = Date.now();
  sec.disableEncryption();
  clearPin();
  save();
  closeModal();
  toast(tr('رمزنگاری خاموش شد؛ داده‌ها ساده ذخیره می‌شوند'));
  render();
}

export function changePassPrompt() {
  openModal(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>${tr('تغییر رمز عبور')}</h2>
    <div class="field"><label>${tr('رمز عبور فعلی')}</label>
      <input class="input" id="cpOld" type="password" autocomplete="off" dir="ltr"></div>
    <div class="field"><label>${tr('رمز عبور جدید (حداقل ۸ نویسه)')}</label>
      <input class="input" id="cpNew" type="password" autocomplete="new-password" dir="ltr"></div>
    <div class="field"><label>${tr('تکرار رمز عبور جدید')}</label>
      <input class="input" id="cpNew2" type="password" autocomplete="new-password" dir="ltr"></div>
    <button class="btn primary block" style="margin-top:12px" onclick="changePassDo()">${tr('ذخیره')}</button>
  `);
}

export async function changePassDo() {
  const old = String((document.getElementById('cpOld') || {}).value || '');
  const a = String((document.getElementById('cpNew') || {}).value || '');
  const b = String((document.getElementById('cpNew2') || {}).value || '');
  if (a.length < 8) {
    toast(tr('رمز عبور حداقل ۸ نویسه باشد'));
    return;
  }
  if (a !== b) {
    toast(tr('رمزها یکی نیستند'));
    return;
  }
  try {
    await sec.changePassphrase(old, a);
    closeModal();
    openSettings();
    toast((tr('رمز عبور عوض شد') + ' ✓'));
  } catch (e) {
    toast(tr('رمز عبور فعلی اشتباه است'));
  }
}

export async function rotatePhrasePrompt() {
  const phrase = newRecoveryPhrase();
  const ok = await sec.replacePhraseWrap(phrase);
  if (!ok) return;
  const words = phrase.split(' ');
  openModal(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>📜 ${tr('عبارت بازیابی جدید')}</h2>
    <p class="small muted">${tr('عبارت قبلی باطل شد. این یکی را روی کاغذ بنویس و جای قبلی جایگزین کن.')}</p>
    <div class="phrase-grid" dir="ltr">
      ${words.map((w, i) => `<span class="phrase-w"><b>${i + 1}</b> ${esc(w)}</span>`).join('')}
    </div>
    <button class="btn primary block" style="margin-top:14px" onclick="closeModal()">${tr('نوشتم')} ✓</button>
  `);
}

// ─── تنظیمات ───────────────────────────────────────────────────────────────
// ─── تنظیمات: منوی اصلی + زیرصفحه‌ها (سبک تلگرام) ──────────────────────────
function settingsRow(ic, color, title, sub, onclick, extra) {
  const glyph = hasIcon(ic) ? icon(ic) : ic;
  return `<button type="button" class="srow" onclick="${onclick}">
    <span class="sic" style="background:${color}">${glyph}</span>
    <span class="smid"><span class="st1">${title}</span>${sub ? `<span class="st2">${sub}</span>` : ''}</span>
    ${extra ? `<span class="sval">${extra}</span>` : ''}
    <span class="schev">${icon('chevL')}</span>
  </button>`;
}

function settingsHeader(title, back) {
  return back
    ? `<button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
       <button type="button" class="sback" onclick="${back}">${icon('chevR')} ${t('act.back')}</button>
       <h2 style="margin-top:6px">${title}</h2>`
    : `<button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button><h2>${title}</h2>`;
}

// تیترِ کوچکِ گروه — همان کاری که در تلگرام/iOS «بخش» را از ردیف‌ها جدا می‌کند
function settingsSection(label) {
  return `<div class="sttl">${label}</div>`;
}

// منوی اصلی: ۷ ردیف در ۴ گروهِ تیتردار (قبلاً ۱۱ ردیف بی‌تیتر بود).
// جزئیات هر گروه داخل زیرصفحهٔ خودش است؛ سبک ردیف‌ها همان تلگرامی مانده.
export function openSettings() {
  const enc = sec.isEncrypted();
  const bioOn = hasBiometric();
  const u = googleUserFromStore();
  const theme = THEMES.find((t) => t.id === currentTheme()) || THEMES[0];
  const gemini = !!store.get('capital_gemini_key');
  const digits = digitsPref() === 'auto' ? (lang() === 'fa' ? '۱۲۳' : '123') : digitsPref() === 'fa' ? '۱۲۳' : '123';
  openModal(`
    ${settingsHeader(tr('تنظیمات'))}
    ${settingsSection(tr('برنامه'))}
    <div class="sgroup">
      ${settingsRow(
        'palette',
        '#8b5cf6',
        tr('ظاهر، زبان و تقویم'),
        tr('تم و رنگ · زبان · تقویم دفتر'),
        'openSettingsDisplay()',
        theme.name + ' · ' + digits
      )}
    </div>
    ${settingsSection(tr('داده‌ها'))}
    <div class="sgroup">
      ${settingsRow(
        'shield',
        enc ? '#22c55e' : '#f59e0b',
        tr('امنیت و حریم خصوصی'),
        enc ? (tr('رمزنگاری فعال') + ' · ') + (bioOn ? tr('اثر انگشت روشن') : tr('اثر انگشت خاموش')) : tr('رمزنگاری غیرفعال'),
        'openSettingsSecurity()'
      )}
      ${settingsRow(
        'cloud',
        '#3d8bfd',
        tr('همگام‌سازی و پشتیبان'),
        u ? esc(u.email || u.name || tr('متصل')) : tr('گوگل درایو · فایل روی گوشی'),
        'openSettingsSync()',
        u ? esc(syncStatusText()) : tr('خاموش')
      )}
    </div>
    ${settingsSection(tr('پول'))}
    <div class="sgroup">
      ${settingsRow(
        'chart',
        '#a78bfa',
        tr('بودجه، پاکت‌ها و ارز'),
        profileName(profileFor(curMonthKey()).id) + ((state.reflect || {}).off ? ' · ' + tr('بازتاب ماه خاموش') : ''),
        'openSettingsMoney()',
        curName(baseCur())
      )}
      ${settingsRow('bell', '#f59e0b', tr('یادآوری سررسیدها'), remindSummary(), 'openRemindSettings()')}
    </div>
    ${settingsSection(tr('ابزار'))}
    <div class="sgroup">
      ${settingsRow('sparkle', '#f97316', tr('هوش مصنوعی'), gemini ? tr('خواندن فاکتور از عکس فعال است') : tr('خواندن فاکتور از عکس · تحلیل هوشمند'), 'openSettingsAI()', gemini ? tr('فعال') : tr('خاموش'))}
      ${settingsRow('info', '#64748b', tr('دربارهٔ برنامه'), (tr('نسخه') + ' ') + APP_VERSION + (window.__appUpdate === 'ready' ? ' · ' + tr('به‌روزرسانی آماده است') : ''), 'openSettingsAbout()')}
    </div>
  `);
}

// «ظاهر، زبان و تقویم»: سه بخشِ مرتبط در یک صفحه (جای سه ردیفِ جدا در منوی اصلی)
export function openSettingsDisplay() {
  const theme = currentTheme();
  const pref = langPref();
  const dp = digitsPref();
  const cal = bookCal();
  const opt = (name, on, click) => `<button type="button" class="srow" onclick="${click}">
      <span class="smid"><span class="st1">${name}</span></span>
      <span class="sval">${on ? icon('check') : ''}</span>
    </button>`;
  let first = '';
  for (const tx of state.transactions) if (tx.dateISO && (!first || tx.dateISO < first)) first = tx.dateISO;
  openModal(`
    ${settingsHeader(tr('ظاهر، زبان و تقویم'), 'openSettings()')}
    ${settingsSection(tr('تم'))}
    <div class="theme-grid">
      ${THEMES.map(
        (th) => `<button type="button" class="theme-swatch ${theme === th.id ? 'on' : ''}" onclick="applyTheme('${th.id}');openSettingsDisplay()">
        <span class="theme-dot" style="background:linear-gradient(135deg,${th.c1},${th.c2})"></span>
        ${th.name}
      </button>`
      ).join('')}
    </div>
    ${settingsSection(t('set.langOnly'))}
    <div class="sgroup">
      ${opt(t('set.auto'), pref === 'auto', "changeLanguage('auto')")}
      ${LANGS.map((l) => opt(l.name, pref === l.id, "changeLanguage('" + l.id + "')")).join('')}
    </div>
    ${settingsSection(t('set.digits'))}
    <div class="sgroup">
      ${opt(t('set.auto'), dp === 'auto', "changeDigits('auto')")}
      ${opt('۱۲۳۴۵۶ · ' + t('set.digits.fa'), dp === 'fa', "changeDigits('fa')")}
      ${opt('123456 · ' + t('set.digits.en'), dp === 'en', "changeDigits('en')")}
    </div>
    ${settingsSection(t('set.calendar'))}
    <div class="sgroup">
      ${settingsRow('calendar', '#0ea5e9', cal === 'gregorian' ? t('set.cal.greg') : t('set.cal.jalali'), tr('برای تغییر، دفتر جدید ساخته می‌شود'), 'openBookCalendar()')}
      ${settingsRow('list', '#64748b', t('nav.tx'), first ? tr('از {d}', { d: fmtDate(first) }) : tr('هنوز تراکنشی ثبت نشده'), '', toFa(state.transactions.length))}
    </div>
    <p class="small muted" style="margin-top:12px">${t('set.langNote')}</p>
  `);
}

// «همگام‌سازی و پشتیبان»: درایو + نسخهٔ پشتیبان روی گوشی در یک صفحه
export function openSettingsSync() {
  const u = googleUserFromStore();
  openModal(`
    ${settingsHeader(tr('همگام‌سازی و پشتیبان'), 'openSettings()')}
    ${settingsSection(tr('همگام‌سازی بین دستگاه‌ها'))}
    <div class="sgroup">
      ${settingsRow('cloud', '#3d8bfd', tr('گوگل درایو'), u ? esc(u.email || u.name || tr('متصل')) : tr('همگام‌سازی بین دستگاه‌ها'), 'openSettingsGoogle()', u ? esc(syncStatusText()) : tr('خاموش'))}
    </div>
    ${settingsSection(tr('نسخهٔ پشتیبان روی گوشی'))}
    <div class="sgroup">
      ${settingsRow('download', '#0d9488', tr('ذخیرهٔ یک نسخه از همهٔ داده‌ها روی گوشی'), sec.isEncrypted() ? tr('فایل رمزشده؛ برای روز مبادا یا انتقال به گوشی دیگر') : tr('فایل ساده؛ برای روز مبادا یا انتقال به گوشی دیگر'), 'exportBackup()')}
      ${settingsRow('upload', '#f59e0b', tr('برگرداندن داده‌ها از فایل ذخیره‌شده'), tr('همهٔ داده‌های فعلی با محتوای فایل جایگزین می‌شود'), "document.getElementById('bkFile').click()")}
    </div>
    <input type="file" id="bkFile" accept="application/json,.json" style="display:none" onchange="importBackup(this.files[0])">
    <p class="small muted" style="margin-top:12px">${(sec.isEncrypted() ? tr('فایل پشتیبان با همان رمز عبور برنامه رمز می‌شود؛ بدون رمز قابل باز شدن نیست.') : tr('فایل خروجی همهٔ داده‌های برنامه را بدون رمزنگاری دارد؛ آن را جای امن نگه دار.'))}</p>
  `);
}

// «بودجه، پاکت‌ها و ارز»: سه ردیفِ پولی در یک صفحه
export function openSettingsMoney() {
  openModal(`
    ${settingsHeader(tr('بودجه، پاکت‌ها و ارز'), 'openSettings()')}
    <div class="sgroup">
      ${settingsRow('chart', '#a78bfa', tr('الگوی پاکت‌ها'), profileName(profileFor(curMonthKey()).id) + ((state.reflect || {}).off ? ' · ' + tr('بازتاب ماه خاموش') : ''), 'openProfileSettingsFull()')}
      ${settingsRow('target', '#16a34a', t('hl.title'), t('hl.set.fun'), 'openHealthSettings()')}
      ${settingsRow('coin', '#0ea5e9', tr('ارز'), ratesSummary(), 'openSettingsRates()', curName(baseCur()))}
    </div>
  `);
}

// «ظاهر» دیگر صفحهٔ جدا نیست؛ رفته داخل «ظاهر، زبان و تقویم».
// این نام برای صدازننده‌های قدیمی (رنگ‌آمیزی دوباره بعد از عوض‌شدن تم) نگه داشته شده.
export function openSettingsAppearance() { openSettingsDisplay(); }

export function openSettingsSecurity() {
  const enc = sec.isEncrypted();
  const pinOn = hasPin();
  const bioOn = hasBiometric();
  const bioOk = bioAvailable();
  let body = '';
  if (enc) {
    body += `
    <div class="sgroup">
      ${settingsRow('key', '#3d8bfd', tr('تغییر رمز عبور'), tr('روی همهٔ دستگاه‌ها اعمال می‌شود'), 'changePassPrompt()')}
      ${settingsRow('scroll', '#a78bfa', tr('عبارت بازیابی جدید'), tr('اگر کاغذ قبلی گم شده'), 'rotatePhrasePrompt()')}
    </div>
    <div class="sgroup">
      ${
        bioOk
          ? settingsRow(
              'finger',
              bioOn ? '#22c55e' : '#64748b',
              tr('ورود با اثر انگشت'),
              bioOn ? (tr('روشن') + ' · ' + tr('فقط روی همین دستگاه')) : (tr('خاموش') + ' · ' + tr('ورود سریع بدون رمز')),
              bioOn ? 'disableBiometric();openSettingsSecurity()' : 'enableBiometric().then(()=>openSettingsSecurity())',
              bioOn ? tr('روشن') : tr('خاموش')
            )
          : '<div class="hint">' + tr('اثر انگشت روی این آدرس در دسترس نیست (https لازم است).') + '</div>'
      }
      ${settingsRow('lock', '#ef4444', tr('قفل کردن همین حالا'), tr('برای بازکردن رمز یا اثر انگشت لازم است'), 'closeModal();lockApp()')}
    </div>
    <div class="sgroup">
      ${settingsRow('shield', '#64748b', tr('خاموش کردن رمزنگاری'), tr('داده‌ها ساده ذخیره می‌شوند؛ روی همهٔ دستگاه‌ها'), 'disableEncPrompt()')}
    </div>`;
  } else {
    body += `
    <div class="sgroup">
      ${settingsRow('shield', '#f59e0b', tr('فعال‌کردن رمزنگاری'), tr('داده‌ها الان ساده ذخیره می‌شوند'), 'openEncryptSetup()')}
    </div>
    <div class="sgroup">
      ${
        pinOn
          ? settingsRow('key', '#3d8bfd', tr('تغییر رمز ورود'), '', 'changePinPrompt()') +
            settingsRow('trash', '#ef4444', tr('حذف قفل'), '', 'clearPin();openSettingsSecurity()')
          : settingsRow('key', '#3d8bfd', tr('فعال‌کردن رمز ورود'), tr('قفل ساده برای ورود'), 'changePinPrompt()')
      }
      ${
        pinOn && bioOk
          ? settingsRow(
              'finger',
              bioOn ? '#22c55e' : '#64748b',
              tr('ورود با اثر انگشت'),
              '',
              bioOn ? 'disableBiometric();openSettingsSecurity()' : 'enableBiometric().then(()=>openSettingsSecurity())',
              bioOn ? tr('روشن') : tr('خاموش')
            )
          : ''
      }
    </div>`;
  }
  openModal(`${settingsHeader(('🔐 ' + tr('امنیت و حریم خصوصی')), 'openSettings()')}${body}`);
}

export function openSettingsGoogle() {
  const u = googleUserFromStore();
  let body;
  if (!u) {
    body = `
    <div class="hint" style="margin:0 0 12px">${tr('با حساب گوگل وارد شو تا داده‌هایت خودکار در Google Drive ذخیره شود و از هر دستگاهی در دسترس باشد.')}${
      sec.isEncrypted() ? (' ' + tr('داده‌ها رمزشده می‌روند؛ گوگل نمی‌تواند بخواندشان.')) : ''
    }</div>
    <button class="btn primary block" onclick="closeModal();googleSignIn()">${tr('ورود با گوگل')}</button>`;
  } else {
    body = `
    <div class="sgroup">
      <div class="srow" style="cursor:default">
        ${avatarHTML(u, 36)}
        <span class="smid"><span class="st1">${esc(displayName())}</span><span class="st2">${u.email ? esc(u.email) + ' · ' : ''}${esc(syncStatusText())}</span></span>
      </div>
    </div>
    <div class="sgroup">
      ${settingsRow('edit', '#8b5cf6', tr('نام نمایشی'), esc(displayName()), 'editDisplayName()')}
    </div>
    <div class="sgroup">
      ${settingsRow('logout', '#ef4444', tr('خروج از حساب گوگل'), tr('فقط روی این دستگاه؛ همگام‌سازی متوقف می‌شود'), 'closeModal();googleSignOut()')}
    </div>`;
  }
  openModal(`${settingsHeader(('☁️ ' + tr('گوگل درایو')), 'openSettingsSync()')}${body}`);
}

// ─── نرخ ارز ───
function usedCurrencies() {
  const used = new Set();
  for (const a of state.accounts) if (a.currency && a.currency !== baseCur()) used.add(a.currency);
  for (const i of state.investments || []) if (i.currency && i.currency !== baseCur()) used.add(i.currency);
  for (const c of Object.keys(state.rates || {})) used.add(c);
  return [...used];
}
function ratesSummary() {
  const used = usedCurrencies();
  if (!used.length) return tr('برای حساب‌ها و دارایی‌های ارزی');
  const missing = used.filter((c) => !rateOf(c));
  return missing.length ? (tr('نرخ') + ' ') + missing.join('، ') + (' ' + tr('ثبت نشده')) : used.map((c) => curName(c) + ' ' + toFaNum(rateOf(c))).join(' · ');
}
function toFaNum(n) {
  return toFa(fmtPlain(n));
}
export function openSettingsRates() {
  const used = usedCurrencies();
  const others = allCurrencies().filter((c) => c !== baseCur() && !used.includes(c));
  const row = (c) => `<div class="srow" style="cursor:default">
      <span class="sic" style="background:#fff;padding:4px;${rateOf(c) ? '' : 'opacity:.6'}">${curIconHtml(c)}</span>
      <span class="smid"><span class="st1">${esc(curName(c))}</span><span class="st2">${rateOf(c) ? (tr('هر واحد') + ' ') + toFaNum(rateOf(c)) + ' ' + curName(baseCur()) : tr('ثبت نشده')}</span></span>
      <input class="input" style="width:130px;min-height:38px;text-align:left;direction:ltr" id="rate_${esc(c)}" type="number" step="any" inputmode="decimal" value="${state.rates[c] || ''}" placeholder="${curName(baseCur())}" onchange="saveRateFrom('${esc(c)}')">
    </div>`;
  openModal(`
    ${settingsHeader(tr('ارز'), 'openSettingsMoney()')}
    <div class="sgroup" style="margin-bottom:12px">${settingsRow('coin', '#0ea5e9', tr('واحد پایهٔ برنامه'), tr('همهٔ جمع‌ها و گزارش‌ها به این واحد'), 'openBaseCurrency()', curName(baseCur()))}</div>
    <p class="small muted">${curName(baseCur())} ${tr('به ازای هر واحد. فقط برای محاسبهٔ ارزش کلِ حساب‌ها، دارایی‌ها و طلب/بدهی‌های ارزی استفاده می‌شود؛ نرخ هر انتقال را موقع همان انتقال جدا وارد می‌کنی.')}</p>
    ${used.length ? `<div class="sgroup">${used.map(row).join('')}</div>` : ('<div class="hint">' + tr('هنوز حساب یا دارایی ارزی نداری.') + '</div>')}
    ${others.length ? `<h3 class="muted" style="margin:14px 0 6px">${tr('سایر واحدها')}</h3><div class="sgroup">${others.map(row).join('')}</div>` : ''}
  `);
}

export function openSettingsAI() {
  const gemini = !!store.get('capital_gemini_key');
  openModal(`
    ${settingsHeader(('✨ ' + tr('هوش مصنوعی')), 'openSettings()')}
    <div class="sgroup">
      ${settingsRow('receipt', '#f97316', tr('خواندن فاکتور از عکس'), tr('عکس رسید را می‌گیری، اقلام خودکار ثبت می‌شوند'), 'openSettingsScan()', gemini ? tr('فعال') : tr('خاموش'))}
      ${settingsRow('sparkle', '#8b5cf6', tr('تحلیل هوشمند خرج‌ها'), tr('به‌زودی · فقط درصدها فرستاده می‌شود، نه مبلغ‌ها'), '', tr('به‌زودی'))}
    </div>
    <p class="small muted" style="margin-top:12px">${tr('همهٔ قابلیت‌های هوش مصنوعی اختیاری‌اند و با کلید شخصی خودت کار می‌کنند.')}</p>
  `);
}

export function openSettingsScan() {
  const has = !!store.get('capital_gemini_key');
  openModal(`
    ${settingsHeader(('🧾 ' + tr('خواندن فاکتور از عکس')), 'openSettingsAI()')}
    <p class="small muted">${tr('کلید')} Google AI Studio ${tr('را این‌جا بگذار. به کسی نشان نده. عکس برای خواندن به گوگل فرستاده می‌شود.')}</p>
    <p><a class="btn block" href="${geminiHelpHref()}" target="_blank" rel="noopener">${tr('چطور کلید بگیرم؟')}</a></p>
    <label class="srow" style="cursor:pointer;margin-bottom:10px"><span class="smid"><span class="st1">${tr('نگه‌داشتن آخرین خوانده‌شده‌ها')}</span><span class="st2">${tr('۵ مورد آخر، فقط روی همین دستگاه؛ برای پر کردن دوباره بدون عکس جدید')}</span></span><input type="checkbox" ${scanHistOn() ? 'checked' : ''} onchange="setScanHistOn(this.checked)"></label>
    ${
      has
        ? `<div class="hint" style="margin:10px 0">✅ ${tr('کلید ذخیره شده است.')}</div>
           <button class="btn danger block" onclick="clearGeminiKey()">${tr('حذف کلید')}</button>`
        : `<div class="field" style="margin-top:12px"><label>${tr('کلید')} API</label>
           <input class="input" id="geminiKey" type="password" autocomplete="off" placeholder="AIza...">
           </div>
           <button class="btn primary block" onclick="saveGeminiKey()">${tr('ذخیره کلید')}</button>`
    }
  `);
}

// وضعیت به‌روزرسانی (ریل: سرویس‌ورکر؛ تست: مقایسهٔ نسخه با سرور)
function updateStateHTML() {
  const st = window.__appUpdate;
  if (!window.__checkUpdate) return '';
  if (st === 'ready')
    return `<div class="upd ready"><span>${tr('نسخهٔ جدید آماده است')}</span><button class="btn primary sm" onclick="window.__applyUpdate()">${tr('اعمال و بازنشانی')}</button></div>`;
  if (st === 'installing' || st === 'checking') return `<div class="upd busy">${tr('در حال بررسی به‌روزرسانی…')}</div>`;
  if (st === 'offline') return `<div class="upd"><span>${tr('بررسی ممکن نشد (آفلاین؟)')}</span><button class="btn sm" onclick="checkAppUpdate()">${tr('دوباره')}</button></div>`;
  return `<div class="upd ok"><span>✓ ${tr('آخرین نسخه را داری')}</span><button class="btn sm" onclick="checkAppUpdate()">${tr('بررسی دوباره')}</button></div>`;
}
export function checkAppUpdate() {
  if (!window.__checkUpdate) return;
  window.__appUpdate = 'checking';
  const el = document.getElementById('updState');
  if (el) el.innerHTML = updateStateHTML();
  window.__checkUpdate().then(() => {
    const e2 = document.getElementById('updState');
    if (e2) e2.innerHTML = updateStateHTML();
  });
}
if (typeof document !== 'undefined')
  document.addEventListener('appupdate', () => {
    const el = document.getElementById('updState');
    if (el) el.innerHTML = updateStateHTML();
  });
if (typeof window !== 'undefined') window.checkAppUpdate = checkAppUpdate;

export function resetGuidesUI() {
  window.resetGuides();
  closeModal();
  toast(tr('راهنماها دوباره فعال شد') + ' ✓');
}
export function openSettingsAbout() {
  openModal(`
    ${settingsHeader(('ℹ️ ' + tr('دربارهٔ برنامه')), 'openSettings()')}
    <div style="text-align:center;padding:10px 0 4px">
      <div class="logo" style="margin:0 auto 10px">${icon('wallet')}</div>
      <div style="font-weight:800;font-size:16px">${tr('تراز')}</div>
      <div class="small muted" style="margin-top:4px">${tr('نسخه')} ${APP_VERSION}</div>
      <div id="updState" class="upd-state" style="margin-top:10px">${updateStateHTML()}</div>
    </div>
    <div class="sgroup" style="margin-top:14px">
      <div class="hint">${tr('روش پاکت‌ها: ضروریات ۶۰٪')} · ${tr('سرمایه‌گذاری ۲۰٪')} · ${tr('تفریح ۱۵٪')} · ${tr('نیکوکاری ۵٪ — به‌علاوهٔ «هدررفت» برای صداقت با خودت و «قرض / امانت» که خارج از بودجه است.')}</div>
    </div>
    <div class="sgroup" style="margin-top:12px">
      ${settingsRow('shield', '#64748b', tr('سیاست حریم خصوصی'), '', "window.open('" + legalUrl('privacy') + "','_blank')")}
      ${settingsRow('doc', '#64748b', tr('شرایط استفاده'), '', "window.open('" + legalUrl('terms') + "','_blank')")}
    </div>
    <div class="sgroup" style="margin-top:12px">
      ${settingsRow('sparkle', '#f59e0b', tr('راهنماها را دوباره نشان بده'), tr('نکته‌های کوتاه روی صفحه، هر جا لازم شد'), "resetGuidesUI()")}
    </div>
  `);
}

function legalUrl(kind) {
  const base = location.pathname.includes('/test/') ? '../' : './';
  return base + kind + (lang() === 'fa' ? '-fa' : '') + '.html';
}

// ─── پشتیبان‌گیری: خروجی / بازیابی JSON ───
// صفحهٔ جداگانهٔ پشتیبان‌گیری هیچ‌جا لینک نشده بود (از UI غیرقابل دسترسی بود)؛
// همان ردیف‌ها حالا داخل «همگام‌سازی و پشتیبان» هستند.
export function openSettingsBackup() { openSettingsSync(); }

export async function exportBackup() {
  try {
    await exportBackupInner();
  } catch (e) {
    console.error('exportBackup', e);
    toast(tr('ذخیره نشد') + ': ' + ((e && (e.message || e.name)) || e));
  }
}
async function exportBackupInner() {
  const enc = sec.isEncrypted();
  const plain = JSON.stringify(state, null, enc ? 0 : 1);
  if (enc && !sec.isUnlocked()) {
    toast(tr('اول قفل برنامه را باز کن'));
    return;
  }
  const data = enc ? await sec.encryptStandalone(plain) : plain;
  const d = new Date();
  const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const name = 'capital-backup-' + stamp + (enc ? '.enc' : '') + '.json';
  if (pendingBackup && pendingBackup.url) { try { URL.revokeObjectURL(pendingBackup.url); } catch (e) {} }
  const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
  pendingBackup = { name, data, enc, url };
  // لینک واقعی با download: مطمئن‌ترین راه در کروم اندروید؛ اشتراک‌گذاری برای iOS/انتقال به Drive و تلگرام
  const canShare = !!(navigator.share && navigator.canShare && typeof File !== 'undefined' && navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] }));
  openModal(`
    <h2>${tr('نسخهٔ پشتیبان آماده است')}</h2>
    <div class="hint" style="margin:0 0 12px">${esc(name)}${enc ? ' · ' + tr('رمزشده') : ''}</div>
    <a class="btn primary block" href="${url}" download="${esc(name)}" onclick="backupSaved()">${tr('ذخیره روی گوشی')}</a>
    ${canShare ? `<button class="btn block" style="margin-top:8px" onclick="saveBackupNow()">${tr('اشتراک‌گذاری (Drive، تلگرام…)')}</button>` : ''}
    <button class="btn block" style="margin-top:8px" onclick="copyBackupText()">${tr('کپی متن پشتیبان')}</button>
    <button class="btn block" style="margin-top:8px" onclick="closeModal()">${tr('بستن')}</button>`);
}
let pendingBackup = null;
export function backupSaved() {
  const b = pendingBackup;
  setTimeout(() => { closeModal(); toast(b && b.enc ? tr('فایل پشتیبان رمزشده ساخته شد') : tr('فایل پشتیبان ساخته شد')); }, 300);
}
export async function copyBackupText() {
  const b = pendingBackup;
  if (!b) return;
  try { await navigator.clipboard.writeText(b.data); toast(tr('کپی شد؛ در یک یادداشت یا پیام بچسبان')); } catch (e) { toast(tr('ذخیره نشد') + ': ' + ((e && e.message) || e)); }
}
export async function saveBackupNow() {
  const b = pendingBackup;
  if (!b) return;
  let how;
  try { how = await saveFile(b.name, b.data); } catch (e) { toast(tr('ذخیره نشد') + ': ' + ((e && e.message) || e)); return; }
  if (how === 'cancel') return;
  closeModal();
  toast(b.enc ? tr('فایل پشتیبان رمزشده ساخته شد') : tr('فایل پشتیبان ساخته شد'));
}

let pendingImportEnv = null;
function isEnvelope(o) {
  return !!(o && typeof o === 'object' && o.v && Array.isArray(o.wraps) && o.data && o.data.ct);
}
function validBackup(obj) {
  return !!(obj && typeof obj === 'object' && Array.isArray(obj.transactions) && Array.isArray(obj.accounts));
}

export async function importBackup(file) {
  if (!file) return;
  let obj;
  try {
    obj = JSON.parse(await file.text());
  } catch (e) {
    toast(tr('فایل معتبر نیست'));
    return;
  }
  if (isEnvelope(obj)) {
    // پشتیبان رمزشده: اول با کلید همین نشست، وگرنه رمز عبور پرسیده می‌شود
    try {
      const got = await sec.decryptRemote(obj);
      return applyImport(got.state);
    } catch (e) {
      pendingImportEnv = obj;
      return openImportPassModal();
    }
  }
  return applyImport(obj);
}

function openImportPassModal(err) {
  openModal(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>${tr('پشتیبان رمزشده')}</h2>
    <p class="small muted">${tr('رمز عبوری که موقع ساخت این فایل فعال بوده را وارد کن.')}</p>
    <div class="field"><label>${tr('رمز عبور')}</label>
      <input class="input" id="impPass" type="password" autocomplete="off" style="text-align:center">
    </div>
    ${err ? `<p class="small" style="color:#ef4444">${err}</p>` : ''}
    <button class="btn primary block" onclick="submitImportPass()">${tr('باز کردن فایل')}</button>
  `);
  setTimeout(() => {
    const i = document.getElementById('impPass');
    if (i) i.focus();
  }, 50);
}

export async function submitImportPass() {
  const inp = document.getElementById('impPass');
  const pass = inp ? inp.value : '';
  if (!pass || !pendingImportEnv) return;
  try {
    const got = await sec.decryptRemoteWith(pendingImportEnv, pass);
    pendingImportEnv = null;
    await applyImport(got.state);
  } catch (e) {
    openImportPassModal(tr('رمز درست نیست'));
  }
}

async function applyImport(obj) {
  if (!validBackup(obj)) {
    toast(tr('فایل معتبر نیست'));
    return;
  }
  const n = obj.transactions.length;
  const ok = window.confirm(tr('همهٔ داده‌های فعلی با {n} تراکنش داخل فایل جایگزین شود؟', { n }));
  if (!ok) return;
  replaceState(obj, { markDirty: true });
  save();
  toast(tr('بازیابی انجام شد'));
  closeModal();
  if (window.onBookChanged) window.onBookChanged();
  else if (window.render) window.render();
}

function googleUserFromStore() {
  try {
    const raw = store.get('g_user');
    if (!raw) return null;
    const u = JSON.parse(raw);
    return u && (u.name || u.email) ? u : null;
  } catch (e) {
    return null;
  }
}

export function changePinPrompt() {
  const digits = sec.isEncrypted() ? tr('۶ تا ۸ رقم') : tr('۴ تا ۸ رقم');
  openModal(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>${sec.isEncrypted() ? tr('پین') : tr('رمز')} ${tr('جدید')}</h2>
    <div class="field"><label>${tr('پین جدید')} (${digits})</label>
      <input class="input" id="pinNew" inputmode="numeric" maxlength="8" dir="ltr" style="text-align:center"></div>
    <div class="field"><label>${tr('تکرار پین')}</label>
      <input class="input" id="pinNew2" inputmode="numeric" maxlength="8" dir="ltr" style="text-align:center"></div>
    <button class="btn primary block" style="margin-top:12px" onclick="changePinDo()">${tr('ذخیره')}</button>
  `);
}

export async function changePinDo() {
  const a = String((document.getElementById('pinNew') || {}).value || '').trim();
  const b = String((document.getElementById('pinNew2') || {}).value || '').trim();
  if (a !== b) {
    toast(tr('پین‌ها یکی نیستند'));
    return;
  }
  if (await setPin(a)) {
    closeModal();
    openSettings();
  }
}

export function initPrefs() {
  applyTheme(currentTheme());
  syncPrivacyBtn();
  const priv = document.getElementById('btnPrivacy');
  const set = document.getElementById('btnSettings');
  if (priv) priv.onclick = togglePrivacy;
  if (set) set.onclick = openSettings;
  const pinInp = document.getElementById('lockPin');
  if (pinInp)
    pinInp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitLockPin();
    });
  const forgot = document.getElementById('lockForgot');
  if (forgot) forgot.onclick = () => startPhraseRecovery();
  const sw = document.getElementById('lockSwitch');
  if (sw) sw.onclick = () => toggleLockMode();
  if (sec.isEncrypted()) {
    sec.removePinWrap(); // پاک‌سازی پین‌های قدیمی
    setLockMode('pass');
    lockApp();
  } else if (hasPin()) {
    setLockMode('pin');
    lockApp();
  } else {
    unlockApp();
    if (needsOnboarding()) openOnboarding();
  }
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if ((sec.isEncrypted() || hasPin()) && hiddenAt && Date.now() - hiddenAt > 45000)
      lockApp();
  });
}

// ─── تغییر واحد پایه ───
export function openBaseCurrency() {
  const cur = baseCur();
  const opts = allCurrencies()
    .map((c) => `<option value="${esc(c)}" ${c === cur ? 'selected' : ''}>${esc(curName(c))}${curName(c) !== c ? ' · ' + esc(c) : ' (' + esc(currencyInfo(c).code) + ')'}</option>`)
    .join('');
  openModal(`
    ${settingsHeader(tr('واحد پایه'), 'openSettingsRates()')}
    <p class="small muted">${tr('واحدی که جمع‌ها، بودجه و گزارش‌ها با آن نمایش داده می‌شود. حساب‌ها و تراکنش‌ها به واحد خودشان می‌مانند؛ فقط نرخ‌ها و بودجه‌ها به واحد جدید تبدیل می‌شوند.')}</p>
    <div class="field"><label>${tr('واحد جدید')}</label>
      <select class="input" id="bcSel" onchange="bcSync()">${opts}</select></div>
    <div class="field" id="bcRateWrap"><label id="bcRateLbl"></label>
      <input class="input" id="bcRate" type="number" step="any" inputmode="decimal" placeholder="${tr('نرخ')}"></div>
    <button class="btn primary block" onclick="applyBaseCurrency()">${tr('تغییر واحد پایه')}</button>
  `);
  bcSync();
}
export function bcSync() {
  const sel = document.getElementById('bcSel');
  const wrap = document.getElementById('bcRateWrap');
  const lbl = document.getElementById('bcRateLbl');
  const inp = document.getElementById('bcRate');
  if (!sel || !wrap) return;
  const next = sel.value;
  const cur = baseCur();
  if (next === cur) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  lbl.textContent = tr('هر ۱ {a} چند {b} است؟', { a: curName(next), b: curName(cur) });
  inp.dataset.cur = cur;
  if (state.rates[next]) inp.value = state.rates[next];
}
export function applyBaseCurrency() {
  const next = document.getElementById('bcSel').value;
  const rate = parseFloat(document.getElementById('bcRate').value);
  if (next === baseCur()) return closeModal();
  if (!(rate > 0)) return toast(tr('نرخ تبدیل را وارد کن'));
  if (!changeBaseCurrency(next, rate)) return toast(tr('تغییر انجام نشد'));
  save();
  closeModal();
  render();
  if (window.setTodayLabel) window.setTodayLabel();
  toast((tr('واحد پایه شد:') + ' ') + next);
}

// ─── زبان و تقویم ───
// «زبان و اعداد» هم رفته داخل «ظاهر، زبان و تقویم»؛ این نام برای
// changeLanguage/changeDigits می‌ماند تا بعد از تغییر، همان صفحه رنگ‌آمیزی دوباره شود.
export function openSettingsLanguage() { openSettingsDisplay(); }

export function changeDigits(p) {
  setDigitsPref(p);
  import('./render.js').then((m) => m.renderAll());
  openSettingsLanguage();
}

export function openBookCalendar() {
  const cal = bookCal();
  const opt = (id, name, sub) => `<button type="button" class="srow" onclick="${id === cal ? 'openSettingsDisplay()' : "openNewBook('" + id + "')"}">
      <span class="smid"><span class="st1">${name}</span>${sub ? `<span class="st2">${sub}</span>` : ''}</span>
      <span class="sval">${id === cal ? icon('check') : icon('chevL')}</span>
    </button>`;
  openModal(`
    ${settingsHeader(t('set.calendar'), 'openSettingsDisplay()')}
    <div class="sgroup">
      ${opt('jalali', t('set.cal.jalali'), cal === 'jalali' ? tr('تقویم فعلی این دفتر') : tr('دفتر جدید با آرشیو دفتر فعلی'))}
      ${opt('gregorian', t('set.cal.greg'), cal === 'gregorian' ? tr('تقویم فعلی این دفتر') : tr('دفتر جدید با آرشیو دفتر فعلی'))}
    </div>
    <p class="small muted" style="margin-top:12px">${tr('تقویم هر دفتر ثابت است. با انتخاب تقویم دیگر، از دفتر فعلی آرشیو گرفته می‌شود و دفتر جدیدی با انتقال گزینشی ساخته می‌شود.')}</p>
  `);
}

// «دفتر» دیگر ردیفِ جدا ندارد: تقویمش رفته داخل «ظاهر، زبان و تقویم» و
// نسخهٔ پشتیبانش داخل «همگام‌سازی و پشتیبان». این نام برای سازگاری می‌ماند.
export function openSettingsBook() { openSettingsDisplay(); }

// الگوی پاکت‌ها + روشن/خاموش بازتاب ماه
export function openProfileSettingsFull() {
  openProfileSettings();
  const off = !!(state.reflect || {}).off;
  const host = document.getElementById('pf_end');
  const card = host ? host.closest('.card') : null;
  if (card) card.insertAdjacentHTML('afterend', `<label class="srow" style="margin-top:10px;cursor:pointer"><span class="smid"><span class="st1">${tr('بازتاب ماه در گزارش')}</span><span class="st2">${tr('چند یادداشت از جریان پاکت‌ها؛ هیچ‌وقت خودش بالا نمی‌آید')}</span></span><input type="checkbox" ${off ? '' : 'checked'} onchange="setReflectOn(this.checked)"></label>`);
}
if (typeof window !== 'undefined') Object.assign(window, { openProfileSettingsFull, setScanHistOn });
