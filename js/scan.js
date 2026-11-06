import { store, toast, uid } from './utils.js';
import { parseAppDate, jalaliNow } from './jalali.js';
import { luhnOk } from './cards.js';

const KEY = 'capital_gemini_key';
// عبوردهندهٔ ورسل: کلیدِ خودِ کاربر فوروارد می‌شود، چیزی ذخیره نمی‌شود.
// از طریق آن بدون فیلترشکن هم می‌توان به گوگل وصل شد؛ آن‌وقت پیام الکی «فیلترشکن روشن کن» نمی‌آید.
const GEMINI_PROXY = 'https://taraz-api.vercel.app/api/gemini';

// کشِ لیست مدل و مدلِ موفق — تا درخواست‌های سروری حداقل بماند (سهم ورسِل خفن)
const MODELS_CACHE_KEY = 'capital_gemini_models_v1';
const GOOD_MODEL_KEY = 'capital_gemini_model_ok';
const MODELS_CACHE_TTL = 7 * 24 * 3600 * 1000; // یک هفته

// ── انتخاب مسیر: اول پینگِ مسیرِ مستقیمِ گوگل؛ اگر باز بود از همان می‌رویم،
//    و اگر پینگ نداشت (فیلتر/DNS/تایم‌اوت) از پلِ ورسل. نتیجهٔ پینگ کش می‌شود
//    تا برای هر اسکن یک رفت‌وبرگشت اضافه نپردازیم.
const GAPI_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DIRECT_OK_KEY = 'capital_gemini_direct_ok';
const DIRECT_OK_TTL = 10 * 60 * 1000; // ده دقیقه
const REGION_BLOCKED = /user location is not supported|unavailable in your country|not supported in your (country|region)/i;

function readDirectOk() {
  try {
    const raw = store.get(DIRECT_OK_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || Date.now() - (o.at || 0) > DIRECT_OK_TTL) return null;
    return !!o.ok;
  } catch (e) { return null; }
}
export function saveDirectOk(ok) {
  try { store.set(DIRECT_OK_KEY, JSON.stringify({ at: Date.now(), ok: !!ok })); } catch (e) {}
}
// پینگِ بدون مصرف سهمیه: بدون کلید صدا می‌زنیم؛ هر جواب HTTP از گوگل یعنی مسیر باز است.
// اگر ۴۰۳ «در منطقهٔ شما در دسترس نیست» بدهد، مسیر مستقیم به درد نمی‌خورد (پل لازم است).
async function probeDirect(timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => { try { ctl.abort(); } catch (e) {} }, timeoutMs || 4000);
  try {
    const r = await fetch(GAPI_ROOT, { signal: ctl.signal });
    const body = await r.text().catch(() => '');
    if (r.status === 403 && REGION_BLOCKED.test(body)) return false;
    return true;
  } catch (e) {
    return false; // fetch شکست = مسیر مستقیم بسته است
  } finally {
    clearTimeout(timer);
  }
}
export async function directRouteOk(force) {
  if (!force) { const cached = readDirectOk(); if (cached !== null) return cached; }
  const ok = await probeDirect();
  saveDirectOk(ok);
  return ok;
}

function readModelsCache() {
  try {
    const raw = store.get(MODELS_CACHE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || !Array.isArray(o.list) || !o.list.length) return null;
    if (Date.now() - (o.at || 0) > MODELS_CACHE_TTL) return null;
    return o.list;
  } catch (e) {
    return null;
  }
}

async function geminiProxy(payload) {
  const resp = await fetch(GEMINI_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  // ۴۰۴ = پل نصب نیست؛ ۴۱۳ = بدنه از سقفِ سختِ ۴٫۵MB ورسل گذشته (پیش از اجرای تابع رد می‌شود)؛
  // ۴۰۸/۴۲۵ = تایم‌اوت؛ ۵xx = خودِ ورسل/تابع. همه یعنی «پل جواب نمی‌دهد» → مسیر دیگر امتحان شود.
  if (resp.status === 404 || resp.status === 408 || resp.status === 413 || resp.status === 425 || resp.status >= 500)
    throw Object.assign(new Error('proxy-down'), { proxyDown: true, status: resp.status });
  return resp;
}
const MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
];

export function hasGeminiKey() {
  return !!store.get(KEY);
}

export function getGeminiKey() {
  return (store.get(KEY) || '').trim();
}

export function saveGeminiKey() {
  const el = document.getElementById('geminiKey');
  const v = (el && el.value ? el.value : '').trim();
  if (!v) {
    toast('کلید را بچسبان');
    return;
  }
  store.set(KEY, v);
  toast('کلید ذخیره شد');
  if (typeof window.openSettingsScan === 'function') window.openSettingsScan();
}

export function clearGeminiKey() {
  store.set(KEY, '');
  toast('کلید پاک شد');
  if (typeof window.openSettingsScan === 'function') window.openSettingsScan();
}

function faToEn(s) {
  return String(s == null ? '' : s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
}

function num(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  const s = faToEn(v)
    .replace(/[,٬،\s]/g, '')
    .replace(/[^\d.-]/g, '');
  const n = parseFloat(s);
  return n > 0 ? n : 0;
}

function fileToJpeg(file, max, quality) {
  max = max || 1280;
  quality = quality || 0.72;
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > max || h > max) {
        const s = max / Math.max(w, h);
        w = Math.round(w * s);
        h = Math.round(h * s);
      }
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const data = c.toDataURL('image/jpeg', quality);
      resolve(data.split(',')[1]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('خواندن عکس نشد'));
    };
    img.src = url;
  });
}

const INVOICE_PROMPT = `این یک عکس فاکتور یا رسید خرید است.
فقط یک JSON معتبر برگردان، بدون متن اضافه.
مبالغ را به تومان بده (اگر روی فاکتور ریال بود تقسیم بر ۱۰ کن).
اگر مقدار یا قیمت واحد نبود، مقدار را ۱ و قیمت واحد را برابر مبلغ همان قلم بگذار.
تاریخ را اگر خواندی به صورت YYYY-MM-DD میلادی بده، وگرنه null.
ساعت را اگر روی فاکتور هست (چاپی یا دست‌نویس، مثل ۱۴:۳۵ یا ۲:۳۵ ب.ظ) به صورت ۲۴ساعته HH:MM در time بده، وگرنه null.
شکل JSON:
{"store":"نام فروشگاه یا خالی","total":0,"date":null,"time":null,"lines":[{"name":"نام کالا","qty":1,"unit":"عدد","unitPrice":0,"amount":0}]}`;

function paperPrompt(accountNames) {
  const accts = (accountNames || []).filter(Boolean).join('، ') || 'نامشخص';
  return `این عکس لیست تراکنش است: یا کاغذ دست‌نویس، یا اسکرین بانک با یادداشت دست‌نویس روی آن (مثل همراه بانک ملت).
فقط JSON معتبر برگردان.

واحد پول خیلی مهم است:
- مبلغ چاپی فیش بانک با برچسب ریال، ریال است. آن را در bankRial بگذار (عدد خام فیش، تقسیم نکن).
- اگر روی عکس دستی «تومان» نوشته شده، آن عدد تومان است. در writtenToman بگذار. این را ریال فرض نکن و ضرب یا تقسیم نکن.
- اگر فقط ریال فیش بود و تومان دستی نبود، برنامه خودش ریال را تقسیم بر ۱۰ می‌کند.
- موجودی حساب را تراکنش نکن.

اگر روی یک ردیف کلمه «فاکتور» آمده، یا چند قلم شماره‌دار (۱- ۲- …) زیر یک برداشت بانک است، kind را invoice بگذار و هر کالا را در lines بگذار.
نام فروشگاه را در store بگذار، نه در note. note برای فاکتور یا خالی است یا نام فروشگاه.
کلمهٔ پاکت (ضروری، تفریح، هدررفت، سرمایه، نیکوکاری) را هیچ‌وقت به جای نام کالا یا عنوان نگذار؛ فقط در cat بگذار.
اگر فاکتور ننوشته و فقط یک کالا است، kind: simple و note نام همان کالا.

qty و unit را از دست‌نویس بردار (بسته، لیتر، عدد، کیلو). اگر نبود خالی بگذار.
پاکت cat: ضروری/ضروریات=need ، سرمایه=invest ، تفریح=fun ، نیکوکاری=charity ، هدررفت=waste
type فقط in یا out. برداشت بانک = out. واریز = in.
date شمسی همان ردیف مثل 1405/06/17.
time ساعت همان ردیف اگر نوشته شده (چاپی فیش بانک یا دست‌نویس)، ۲۴ساعته HH:MM؛ وگرنه null.
account نام حساب؛ حساب‌های موجود: ${accts}

شکل JSON:
{"transactions":[{"type":"out","kind":"simple","note":"نان تست","account":"ملت 6395","date":"1405/06/17","time":"14:35","cat":"need","qty":2,"unit":"بسته","writtenToman":160000,"bankRial":1600000,"store":"","lines":[]},{"type":"out","kind":"invoice","note":"فاکتور","store":"نام فروشگاه","account":"ملت 6395","date":"1405/06/16","time":null,"cat":"fun","qty":0,"unit":"","writtenToman":0,"bankRial":10585000,"lines":[{"name":"بستنی","qty":1,"unit":"کیلو","writtenToman":248000,"cat":"fun"}]}]}`;
}

function parseModelJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const startObj = s.indexOf('{');
  const startArr = s.indexOf('[');
  if (startArr >= 0 && (startObj < 0 || startArr < startObj)) {
    const end = s.lastIndexOf(']');
    if (end > startArr) {
      try {
        const arr = JSON.parse(s.slice(startArr, end + 1));
        if (Array.isArray(arr)) return { transactions: arr };
      } catch (e) {}
    }
  }
  if (startObj >= 0) {
    const end = s.lastIndexOf('}');
    if (end > startObj) {
      try {
        return JSON.parse(s.slice(startObj, end + 1));
      } catch (e) {}
    }
  }
  return null;
}

function genBody(prompt, b64, jsonMode) {
  const generationConfig = { temperature: 0.1 };
  if (jsonMode) generationConfig.responseMimeType = 'application/json';
  const parts = [{ text: prompt }];
  if (b64) parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } }); // ورودیِ متنی عکس ندارد
  return JSON.stringify({ contents: [{ parts }], generationConfig });
}
async function directGenerate(model, key, prompt, b64, jsonMode) {
  const url = GAPI_ROOT + '/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: genBody(prompt, b64, jsonMode),
    });
  } catch (e) {
    return null; // مسیر مستقیم بسته است → پلِ ورسل
  }
}
async function proxyGenerate(key, model, prompt, b64, jsonMode) {
  try {
    return await geminiProxy({ key, model, prompt, imageB64: b64, jsonMode: !!jsonMode });
  } catch (e) {
    return null; // پل در دسترس نیست → مسیر مستقیم
  }
}
// از میان خطاهای دو مسیر، آنکه اطلاعاتِ بیشتری دارد (خطای واقعیِ گوگل بر نرسیدنِ مسیر)
function bestRouteError(errs) {
  if (!errs.length) return Object.assign(new Error('no-route'), { noRoute: true });
  const real = errs.filter((e) => e.status);
  const pick = real.length ? real[0] : errs[0];
  const err = new Error(pick.message || 'خطای ' + pick.status);
  err.status = pick.status;
  err.route = pick.route;
  err.errs = errs;
  if (!real.length) err.noRoute = true;
  // دیوارِ منطقه‌ایِ گوگل روی «آی‌پیِ خروجی» است: اگر از راهِ پل هم بخورد، یعنی گوگل
  // آی‌پیِ سرورِ پل را هم در منطقهٔ پشتیبانی‌نشده حساب می‌کند (آی‌پی‌های اشتراکی را گاهی
  // به منطقهٔ دیگری نسبت می‌دهد) — نه اینکه کلیدِ کاربر خراب باشد.
  if (errs.some((x) => x.route === 'proxy' && REGION_BLOCKED.test(x.message || ''))) err.regionViaProxy = true;
  if (errs.some((x) => x.route === 'direct' && REGION_BLOCKED.test(x.message || ''))) err.regionViaDirect = true;
  return err;
}

async function callGemini(model, key, b64, prompt, jsonMode) {
  // ترتیب از روی پینگ: اول مسیری که باز بود؛ ولی اگر جواب نداد مسیرِ دیگر هم امتحان می‌شود
  const order = (await directRouteOk()) === true ? ['direct', 'proxy'] : ['proxy', 'direct'];
  const errs = [];
  let resp = null;
  let data = null;
  for (const route of order) {
    const r = route === 'direct'
      ? await directGenerate(model, key, prompt, b64, jsonMode)
      : await proxyGenerate(key, model, prompt, b64, jsonMode);
    if (!r) { errs.push({ route, status: 0, message: '' }); continue; }
    const d = await r.json().catch(() => ({}));
    if (r.ok) { resp = r; data = d; saveDirectOk(route === 'direct'); break; }
    const gmsg = String((d && d.error && d.error.message) || '');
    errs.push({ route, status: r.status, message: gmsg });
    // مسیرِ مستقیم جواب نداد → دفعهٔ بعد اول از پل برو
    if (route === 'direct') saveDirectOk(false);
  }
  if (!resp) throw bestRouteError(errs);
  const text =
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts &&
    data.candidates[0].content.parts.map((p) => p.text || '').join('\n');
  return parseModelJson(text);
}

async function fetchTimeout(url, init, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => { try { ctl.abort(); } catch (e) {} }, ms || 8000);
  try {
    return await fetch(url, Object.assign({}, init, { signal: ctl.signal }));
  } finally { clearTimeout(timer); }
}

// «آزمایشِ اتصال» در تنظیمات: دقیقاً می‌گوید کدام مسیر جواب داد و گوگل چه گفت
export async function testGeminiConnection() {
  const key = getGeminiKey();
  const rep = { key: !!key, direct: null, proxy: null, models: 0, verdict: '', hint: '' };
  if (!key) {
    rep.verdict = 'no-key';
    rep.hint = 'اول کلید را در همین بخش ذخیره کن.';
    return rep;
  }
  // ۱) گوگلِ مستقیم با کلید (لیستِ مدل‌ها = کم‌مصرف‌ترین درخواستِ معتبر)
  try {
    const r = await fetchTimeout(GAPI_ROOT + '?key=' + encodeURIComponent(key), null, 8000);
    const body = await r.text().catch(() => '');
    rep.direct = { status: r.status, ok: !!r.ok, region: REGION_BLOCKED.test(body), body: body.slice(0, 160) };
    if (r.ok) { try { rep.models = (JSON.parse(body).models || []).length; } catch (e) {} }
  } catch (e) {
    rep.direct = { status: 0, ok: false, region: false, error: String((e && e.message) || e).slice(0, 80) };
  }
  // ۲) پلِ ورسل با همان کلید
  try {
    const r = await fetchTimeout(GEMINI_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', key }),
    }, 20000);
    const data = await r.json().catch(() => ({}));
    const msg = String((data && data.error && data.error.message) || '');
    rep.proxy = { status: r.status, ok: !!r.ok, region: REGION_BLOCKED.test(msg), msg: (msg || (data && data.error ? JSON.stringify(data.error).slice(0, 120) : '')).slice(0, 160) };
    if (r.ok && data && data.models) rep.models = Math.max(rep.models, data.models.length);
  } catch (e) {
    rep.proxy = { status: 0, ok: false, region: false, error: String((e && e.message) || e).slice(0, 80) };
  }
  saveDirectOk(!!(rep.direct && rep.direct.ok));
  // ۳) نتیجهٔ قابلِ فهم
  if (rep.direct.ok || rep.proxy.ok) {
    rep.verdict = 'ok';
    rep.hint = rep.direct.ok
      ? 'هر دو مسیر کار می‌کند؛ از گوگلِ مستقیم می‌رویم.' + (rep.models ? ' (' + rep.models + ' مدل)' : '')
      : 'مسیرِ مستقیم بسته است ولی پلِ ورسل کار می‌کند؛ از پل می‌رویم.' + (rep.models ? ' (' + rep.models + ' مدل)' : '');
  } else if (rep.proxy.region || rep.direct.region) {
    rep.verdict = 'region';
    rep.hint = rep.proxy.region
      ? 'سرویسِ هوش مصنوعیِ گوگل این درخواست را به دلیلِ منطقه رد کرد — هم از اینترنتِ تو هم از سرورِ پل. فیلترشکن را با یک کشور/سرورِ دیگر عوض کن و دوباره آزمایش کن. (ورود به گوگل و همگام‌سازی درایو این محدودیت را ندارند.)'
      : 'مسیرِ مستقیمِ گوگل به دلیلِ منطقه بسته است و پل هم خطا داد؛ فیلترشکن را با یک کشور/سرورِ دیگر عوض کن.';
  } else if ([rep.direct.status, rep.proxy.status].indexOf(429) >= 0) {
    rep.verdict = 'quota';
    rep.hint = 'سهمیهٔ رایگانِ کلید تمام شده؛ فردا دوباره امتحان کن.';
  } else if ([rep.direct.status, rep.proxy.status].some((x) => x === 400 || x === 403)) {
    rep.verdict = 'key';
    rep.hint = 'کلید معتبر نیست یا اجازهٔ این کار را ندارد؛ دوباره کلید بساز و ذخیره کن.';
  } else {
    rep.verdict = 'net';
    rep.hint = 'نه گوگل جواب داد نه پلِ ورسل؛ اینترنت یا فیلترشکن را چک کن.';
  }
  rep.detail = 'direct=' + (rep.direct ? rep.direct.status + (rep.direct.region ? '/region' : '') : '-') +
    ' proxy=' + (rep.proxy ? rep.proxy.status + (rep.proxy.region ? '/region' : '') : '-') +
    ((rep.proxy && rep.proxy.msg) ? ' :: ' + rep.proxy.msg : ((rep.proxy && rep.proxy.error) ? ' :: ' + rep.proxy.error : ''));
  return rep;
}

function shortErr(e) {
  const raw = (e && e.message) || String(e || '');
  const s = raw.toLowerCase();
  if (e && e.noRoute) return 'نه گوگل جواب داد نه پلِ ورسل؛ اینترنت را چک کن و در تنظیمات «آزمایشِ اتصال» را بزن';
  if (e && e.regionViaProxy) return 'سرویسِ هوش مصنوعیِ گوگل از منطقهٔ تو و از سرورِ پل هم جواب نمی‌دهد؛ فیلترشکن را با یک کشور/سرورِ دیگر عوض کن (ورود به گوگل و همگام‌سازی با همین اینترنت کار می‌کنند)';
  if (s.includes('api key') || s.includes('api_key')) return 'کلید نامعتبر است؛ در تنظیمات دوباره ذخیره کن';
  if (s.includes('quota') || s.includes('resource exhausted')) return 'سهمیه رایگان گوگل تمام شده';
  if (REGION_BLOCKED.test(raw)) return 'سرویسِ هوش مصنوعیِ گوگل از این منطقه جواب نمی‌دهد؛ فیلترشکن را با یک کشور/سرورِ دیگر امتحان کن';
  if (s.includes('permission') || s.includes('403')) return 'کلید اجازه این کار را ندارد';
  if (s.includes('413') || s.includes('payload too large')) return 'عکس خیلی سنگین است؛ از نزدیک‌تر و با نور بهتر بگیر';
  if (s.includes('not found') || s.includes('supported methods') || s.includes('listmodels'))
    return 'مدل گوگل عوض شده؛ یک‌بار دیگر عکس را بفرست';
  if (s.includes('failed to fetch') || s.includes('network') || s.includes('aborted'))
    return 'اتصال برقرار نشد؛ اینترنت را چک کن (اگر فیلترشکن لازم داری، روشنش کن)';
  const cut = raw.replace(/\s+/g, ' ').trim();
  return cut.length > 80 ? cut.slice(0, 80) + '…' : cut || 'خواندن عکس نشد';
}

async function listModels(key) {
  // همان ترتیبِ پینگ: اول مسیر مستقیم اگر باز بود، وگرنه پلِ ورسل؛ و اگر اولی جواب نداد، دومی
  const directUrl = GAPI_ROOT + '?key=' + encodeURIComponent(key);
  const direct = () => fetch(directUrl).catch(() => null);
  const proxy = () => geminiProxy({ action: 'list', key }).catch(() => null);
  const routes = (await directRouteOk()) === true ? [direct, proxy] : [proxy, direct];
  let resp = null;
  for (const run of routes) {
    resp = await run();
    if (resp) break;
  }
  if (!resp) throw Object.assign(new Error('no-route'), { noRoute: true });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error((data.error && data.error.message) || 'لیست مدل نیامد');
    err.status = resp.status;
    throw err;
  }
  const names = [];
  for (const m of data.models || []) {
    const name = String(m.name || '').replace(/^models\//, '');
    const methods = m.supportedGenerationMethods || [];
    if (!name || methods.indexOf('generateContent') < 0) continue;
    if (/tts|image|live|embed|audio|imagen|veo|native/i.test(name)) continue;
    names.push(name);
  }
  names.sort((a, b) => {
    const score = (n) => {
      let s = 0;
      if (/flash/i.test(n)) s += 10;
      if (/lite/i.test(n)) s += 2;
      if (/^gemini-3/.test(n)) s += 30;
      if (/^gemini-2\.5/.test(n)) s += 20;
      return s;
    };
    return score(b) - score(a);
  });
  return names;
}

let lastB64 = '';
// همان عکس فشرده‌ای که به مدل رفت (برای ذخیره در تاریخچه)
export function lastJpegB64() {
  return lastB64;
}
async function readWithGemini(file, prompt, opts) {
  let b64 = await fileToJpeg(file, opts && opts.max, opts && opts.quality);
  // سقفِ بدنهٔ ورسل ۴٫۵MB و سخت است (۴۱۳ پیش از اجرای تابع). عکسِ سنگین را یک بار
  // کوچک‌تر فشرده می‌کنیم تا مسیرِ پل هم وقتی مسیر مستقیم بسته است کار کند.
  if (b64.length > 3400000) {
    try {
      const smaller = await fileToJpeg(file, 1600, 0.8);
      if (smaller && smaller.length < b64.length) b64 = smaller;
    } catch (e) {}
  }
  lastB64 = b64;
  return runGemini(prompt, b64, opts);
}

// همان مسیرِ عکس (پینگِ مسیر مستقیم/پل، لیستِ مدل‌ها، تلاش تا ۶ مدل) برای ورودیِ متنی هم استفاده می‌شود
async function runGemini(prompt, b64, opts) {
  const key = getGeminiKey();
  if (!key) throw new Error('NO_KEY');
  let models = MODELS.slice();
  const cachedList = readModelsCache();
  if (cachedList && cachedList.length) {
    models = cachedList; // لیستِ کش‌شده: یک فراخوانی کمتر در هر اسکن
  } else {
    try {
      const listed = await listModels(key);
      if (listed.length) {
        models = listed;
        store.set(MODELS_CACHE_KEY, JSON.stringify({ at: Date.now(), list: listed }));
      }
    } catch (e) {}
  }
  const good = String(store.get(GOOD_MODEL_KEY) || '');
  if (good && models.indexOf(good) >= 0) models = [good].concat(models.filter((m) => m !== good));
  let lastErr = null;
  const jsonMode = !!(opts && opts.jsonMode);
  for (const model of models.slice(0, 6)) {
    try {
      let raw = await callGemini(model, key, b64, prompt, jsonMode);
      if (!raw && jsonMode) raw = await callGemini(model, key, b64, prompt, false);
      if (raw) {
        store.set(GOOD_MODEL_KEY, model); // دفعهٔ بعد همان اول امتحان می‌شود
        return raw;
      }
      lastErr = new Error('جواب قابل فهم نبود');
    } catch (e) {
      lastErr = e;
      if (jsonMode) {
        try {
          const raw = await callGemini(model, key, b64, prompt, false);
          if (raw) {
            store.set(GOOD_MODEL_KEY, model);
            return raw;
          }
        } catch (e2) {
          lastErr = e2;
        }
      }
      const msg = ((lastErr && lastErr.message) || '').toLowerCase();
      const skip =
        lastErr.status === 404 || msg.includes('not found') || msg.includes('supported methods');
      if (skip) {
        // مدل مرده ذهن‌خوان: لیستِ کش را باطل کن تا اسکن بعدی تازه شود
        if (good === model) store.set(GOOD_MODEL_KEY, '');
        store.set(MODELS_CACHE_KEY, '');
      }
      if (lastErr.noRoute) break; // هر دو مسیر بسته‌اند؛ مدل بعدی هم فایده ندارد
      // سهمیه که تمام شده، مدل بعدی هم همان را می‌گوید؛ کاربر را معطل نکن
      if (lastErr.status === 429 || msg.includes('quota') || msg.includes('resource exhausted')) break;
      if (!skip && lastErr.status) break;
    }
  }
  throw new Error(shortErr(lastErr || new Error(b64 ? 'خواندن عکس نشد' : 'خواندن متن نشد')));
}

// خواندن یکپارچه: مدل اول نوع عکس را تشخیص می‌دهد (فاکتور فروشگاهی یا لیست چند تراکنش) و بعد همان را می‌خواند
function anyPrompt(accountNames) {
  return `اول تشخیص بده این عکس چیست:
- "invoice": فاکتور/رسید یک فروشگاه با اقلام و جمع کل (چاپی یا دست‌نویس، یک خرید).
- "list": لیستی از چند تراکنش جدا (کاغذ دست‌نویس، دفترچه، یا اسکرین‌شات بانک/پیامک با چند ردیف).
فقط یک JSON معتبر برگردان به این شکل و فقط بخش مربوط به kind را پر کن:
{"kind":"invoice"|"list","invoice":<JSON_INVOICE|null>,"list":<JSON_LIST|null>}

JSON_INVOICE — ${INVOICE_PROMPT.replace(/^این یک عکس فاکتور یا رسید خرید است\.\n/, '').replace(/فقط یک JSON معتبر برگردان، بدون متن اضافه\.\n/, '')}

JSON_LIST — ${paperPrompt(accountNames).replace(/^این عکس لیست تراکنش است[^\n]*\n/, '').replace(/فقط JSON معتبر برگردان\.\n/, '')}`;
}
export async function readAnyImage(file, accountNames) {
  const raw = await readWithGemini(file, anyPrompt(accountNames), { max: 2048, quality: 0.9, jsonMode: true });
  if (!raw) throw new Error('خواندن عکس نشد');
  const kind = raw.kind === 'invoice' ? 'invoice' : raw.kind === 'list' ? 'list' : raw.lines ? 'invoice' : raw.transactions ? 'list' : '';
  if (kind === 'invoice') {
    const data = normalizeScan(raw.invoice || raw);
    if (data && data.lines.length) return { kind: 'invoice', invoice: data };
    const list = normalizePaper(raw.list);
    if (list.length) return { kind: 'list', list };
    throw new Error('در عکس فاکتوری پیدا نشد');
  }
  const list = normalizePaper(raw.list || raw);
  if (list.length) return { kind: 'list', list };
  const data = normalizeScan(raw.invoice || raw);
  if (data && data.lines.length) return { kind: 'invoice', invoice: data };
  throw new Error('در عکس تراکنش یا فاکتوری پیدا نشد');
}

// پیامکِ بانک قالبِ منظمی دارد؛ قاعده‌ها را صریح می‌گوییم تا مبلغ/واحد/مانده قاطی نشود
function smsPrompt(accountNames) {
  const accts = (accountNames || []).filter(Boolean).join('، ') || 'نامشخص';
  const jy = (jalaliNow() || [])[0] || 1405;
  return `این متنِ یک یا چند پیامک یا اعلان بانکی فارسی است. هر پیامک را به یک تراکنش تبدیل کن.
فقط JSON معتبر برگردان.

قاعده‌ها:
- «مانده» و «موجودی» تراکنش نیستند؛ فقط مبلغِ خودِ تراکنش را بردار. «حساب:»، «کارت:»، «سپرده:»، «کدشعبه:»، «شناسه/کد پیگیری:»، «پایانه:» و «پذیرنده:» هم مبلغ نیستند. «نوع عملیات: برداشت» یا «واریز» فقط جهت را می‌گوید؛ مبلغ را از خطِ «مبلغ:» بردار.
- پیامکِ غیرمالی را نادیده بگیر: رمز پویا/یکبارمصرف، کد تایید، تبلیغ، تراکنشِ ناموفق یا لغوشده، اطلاعیهٔ موجودی.
- اگر چند پیامک پشت هم چسبیده‌اند، برای هر کدام یک ردیفِ جدا بده. هر سربرگِ بانک (مثلاً «بانك ملي ايران» یا «*بانک تجارت*») شروعِ یک پیامکِ جدید است.
- واحدِ پول خیلی مهم است:
  - اگر «ریال» نوشته شده، عددِ خام را در bankRial بگذار (تقسیم نکن؛ برنامه خودش تقسیم بر ۱۰ می‌کند).
  - اگر «تومان»/«تومن»/«هزار تومان» نوشته شده، مبلغِ تومان را در writtenToman بگذار.
  - اگر واحد نوشته نشده، بانک‌های ایران ریال می‌نویسند → bankRial.
- علامتِ چسبیده به آخرِ مبلغ جهت را مشخص می‌کند و از کلمه مهم‌تر است: «2,362,500-» یعنی out و «30,000,000+» یعنی in (حتی اگر کلمه «انتقال» باشد). علامتِ اولِ خط هم همین‌طور: «+۴٬۵۰۰٬۰۲۸ ریال» = in و «−۱٬۲۰۰٬۰۰۰ ریال» = out (منها یونیکد U+2212 هم منفی است). اگر هیچ علامتی نبود، کلیدِ «نوع عملیات» یا فعلِ جمله جهت را می‌گوید.
- type: برداشت/خرید/پرداخت/کسر/انتقال به/قبض/شارژ/کارمزد/جریمه/قسط = out ؛ واریز/افزایش/دریافت/برگشت/بستانکار شد/سود/حقوق/یارانه = in
- note: شرحِ کوتاه و فارسی. کلمه‌های به‌هم‌چسبیده را جدا کن («خريداينترنتي» = «خرید اینترنتی»). اگر «از طریق: X» بود، کانال را داخلِ پرانتز بگذار: «برداشت (شتاب)»، «واریز (خودپرداز)»، «برداشت (پایانه فروش)». نام فروشگاه یا طرف حساب را هم داخل note بگذار.
- account: نامِ بانک بدونِ کلمهٔ «بانک» + ۴ رقم آخرِ حساب/کارتِ همان پیامک، مثلاً «ملت 4321» یا «تجارت 2623» یا «ملی 2000». حساب‌های موجود: ${accts}
- date: تاریخِ همان پیامک به شمسی، به شکل ${jy}/06/17 (اگر میلادی بود همان میلادی). قالبِ کوتاهِ «0810-21:55» یعنی ماهِ ۰۸ روزِ ۱۰ِ شمسیِ سالِ ${jy} با ساعتِ 21:55 → date = ${jy}/08/10 و time = 21:55. اگر تاریخ نداشت null.
- time: ساعتِ ۲۴ساعته HH:MM اگر در پیامک بود (گاهی روی خطِ جداگانه است)، وگرنه null.
- cat فقط وقتی type=out است: قبض/خورد/نان/بنزین/شارژ/اجاره/دارو/بیمه/خرید = need ، سهام/بورس/طلا/ارز/سپرده/صندوق = invest ، رستوران/کافه/سینما/سفر/بازی = fun ، هدیه/کمک/خیریه/نذری = charity ، جریمه/دیرکرد/کارمزد = waste
- kind همیشه "simple" و lines خالی. qty و unit هم صفر و خالی.

نمونهٔ ورودی (بانک ملی و تجارت):
بانك ملي ايران
خريداينترنتي:2,362,500-
حساب:02000
مانده:11,919,634
0810-21:55

*بانک تجارت*
حساب: 0377806172623
برداشت: 50,025,000 ریال
از طريق: شتاب
مانده: 30,925,720 ریال
${jy}/08/11
18:36

شکل JSON:
{"transactions":[{"type":"out","kind":"simple","note":"خرید اینترنتی","account":"ملی 2000","date":"${jy}/08/10","time":"21:55","cat":"need","qty":0,"unit":"","writtenToman":0,"bankRial":2362500,"store":"","lines":[]},{"type":"out","kind":"simple","note":"برداشت (شتاب)","account":"تجارت 2623","date":"${jy}/08/11","time":"18:36","cat":"need","qty":0,"unit":"","writtenToman":0,"bankRial":50025000,"store":"","lines":[]}]}`;
}

// متنِ پیامک → ردیف‌های تراکنش (دقیقاً همان خروجیِ عکسِ لیست، پس همان صفحهٔ بازبینی)
export async function readSmsText(text, accountNames) {
  const t = String(text || '').trim();
  if (!t) throw new Error('متنی برای خواندن نیست');
  const raw = await runGemini(smsPrompt(accountNames), null, { jsonMode: true });
  const list = normalizePaper(raw);
  if (!list.length) throw new Error('در متن تراکنشی پیدا نشد');
  return list;
}

// ── کارتِ بانکی: شمارهٔ ۱۶ رقمی از عکس ─────────────────────────────────
// ترتیب: اول متن‌یابِ خودِ دستگاه (آفلاین، بدون کلید)، بعد هوش مصنوعی اگر کلید بود،
// و اگر هیچ‌کدام نبود کاربر ۱۶ رقم را می‌نویسد (بانک از BIN و اعتبار از لون).
const FA_DIG = '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩';
function latinDigits(v) {
  return String(v == null ? '' : v).replace(/[۰-۹٠-٩]/g, (d) => String(FA_DIG.indexOf(d) % 10));
}
export function textDetectorOk() {
  try { return typeof TextDetector !== 'undefined'; } catch (e) { return false; }
}

// از هر متنی (خروجیِ متن‌یابِ گوشی، پاسخِ مدل، یا حتی متنِ کپی‌شده) شمارهٔ کارت را دربیاور.
// اول نامزدهایی که لونشان درست است؛ اگر هیچ‌کدام درست نبود، اولین نامزد با ok=false.
export function cardDigitsFromText(text) {
  const s = latinDigits(text).replace(/\r?\n/g, ' ');
  const out = [];
  let m;
  // ۱) چهار گروهِ ۴ رقمی با فاصله یا خط تیره (قالبِ معمولِ روی کارت)
  const grouped = /(?:^|[^\d])(\d{4})[ \-–—_.]+(\d{4})[ \-–—_.]+(\d{4})[ \-–—_.]+(\d{4})(?![\d])/g;
  while ((m = grouped.exec(s))) out.push(m[1] + m[2] + m[3] + m[4]);
  // ۲) ۱۶ رقمِ پیوسته
  const plain = /(?:^|[^\d])(\d{16})(?![\d])/g;
  while ((m = plain.exec(s))) out.push(m[1]);
  // ۳) گروه‌های ۴ رقمیِ پراکنده (وقتی OCR جداکننده را خراب کرده)
  if (!out.length) {
    const g = s.replace(/[^\d]/g, ' ').split(/ +/).filter((x) => x.length === 4);
    for (let i = 0; i + 4 <= g.length; i++) out.push(g.slice(i, i + 4).join(''));
  }
  const uniq = [...new Set(out)];
  const ok = uniq.filter((d) => luhnOk(d));
  return { digits: ok[0] || uniq[0] || '', ok: ok.length > 0, candidates: uniq };
}

async function imageSource(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch (e) {}
  }
  // مرورگرهای بدون createImageBitmap: یک <img> از URL موقت
  return await new Promise((resolve, reject) => {
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    } catch (e) { reject(e); }
  });
}

function cardPrompt() {
  return `این عکسِ یک کارتِ بانکی است. فقط شمارهٔ ۱۶ رقمیِ حک یا چاپ‌شدهٔ روی کارت را بخوان.
فقط JSON معتبر برگردان: {"number":"6037 9912 3456 7890","bank":""}
قاعده‌ها:
- رقم‌ها را دقیق بخوان؛ جداکردنِ گروه‌های ۴تایی با فاصله یا خط تیره اشکالی ندارد.
- شمارهٔ حساب، شبا/IBAN، تاریخِ انقضا، CVV2 و شمارهٔ سریال را با شمارهٔ کارت اشتباه نگیر.
- اگر عکس کارت نبود یا شماره ناخوانا بود، number را رشتهٔ خالی بگذار.
- bank را فقط اگر نامِ بانک روی کارت خوانا بود بنویس (مثلاً «بانک ملت») وگرنه خالی.`;
}

// خروجی: {digits, ok, source:'device'|'ai', bank?, text?}
export async function readCardImage(file) {
  if (!file) throw new Error('عکسی برای خواندن نیست');
  // ۱) بدون هوش مصنوعی: متن‌یابِ خودِ گوشی (Shape Detection API)
  if (textDetectorOk()) {
    try {
      const src = await imageSource(file);
      const det = new TextDetector();
      const found = (await det.detect(src)) || [];
      const text = found.map((t) => t.rawValue || t.text || '').join('\n');
      const hit = cardDigitsFromText(text);
      if (hit.digits) return { digits: hit.digits, ok: hit.ok, source: 'device', text };
    } catch (e) { /* متن‌یاب نبود یا خطا داد → مسیرِ بعدی */ }
  }
  // ۲) با کلیدِ کاربر: هوش مصنوعی (مسیرِ مستقیم، بعد پل)
  if (!hasGeminiKey()) {
    const err = new Error('NO_CARD_READER');
    err.code = 'NO_CARD_READER';
    throw err;
  }
  const raw = await readWithGemini(file, cardPrompt(), { max: 1600, quality: 0.85, jsonMode: true });
  const text = String((raw && (raw.number || raw.card || raw.text)) || '');
  const hit = cardDigitsFromText(text);
  if (!hit.digits) {
    const err = new Error('شمارهٔ کارت در عکس پیدا نشد');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return { digits: hit.digits, ok: hit.ok, source: 'ai', bank: String((raw && raw.bank) || ''), text };
}

export async function readInvoiceImage(file) {
  const raw = await readWithGemini(file, INVOICE_PROMPT, { max: 1280, quality: 0.72 });
  const data = normalizeScan(raw);
  if (!data || !data.lines.length) throw new Error('در عکس فاکتوری پیدا نشد');
  return data;
}

export async function readPaperTxImage(file, accountNames) {
  const raw = await readWithGemini(file, paperPrompt(accountNames), {
    max: 2048,
    quality: 0.9,
    jsonMode: true,
  });
  const list = normalizePaper(raw);
  if (!list.length) throw new Error('در عکس تراکنشی پیدا نشد');
  return list;
}

function normalizeScan(raw) {
  const linesIn = Array.isArray(raw.lines) ? raw.lines : [];
  const lines = [];
  for (const row of linesIn) {
    const name = String(row.name || row.title || '').trim();
    let qty = num(row.qty != null ? row.qty : row.quantity);
    let unitPrice = num(row.unitPrice != null ? row.unitPrice : row.price);
    let amount = num(row.amount != null ? row.amount : row.total);
    if (!qty) qty = 1;
    if (!amount && unitPrice) amount = unitPrice * qty;
    if (!unitPrice && amount && qty) unitPrice = amount / qty;
    if (!name || !amount) continue;
    // تخفیف قلم: درصد یا مبلغ (مبلغ → درصد نسبت به ناخالص)
    let disc = num(row.discountPct != null ? row.discountPct : row.discount_pct);
    const dAmt = num(row.discountAmount != null ? row.discountAmount : row.discount);
    if (!disc && dAmt > 0 && dAmt < amount) disc = (dAmt / amount) * 100;
    if (disc > 100 || disc < 0) disc = 0;
    lines.push({
      id: uid(),
      name,
      qty,
      unit: String(row.unit || 'عدد').trim() || 'عدد',
      unitPrice,
      amount,
      disc: disc ? Math.round(disc * 100) / 100 : 0,
      cat: 'need',
    });
  }
  // تخفیف سرجمع پای فاکتور: به‌نسبت ناخالص بین اقلامِ بدون تخفیف پخش می‌شود
  const dTot = num(raw.discountTotal);
  const gross = lines.reduce((s, l) => s + l.amount, 0);
  if (dTot > 0 && gross > dTot) {
    const open = lines.filter((l) => !l.disc);
    const base = open.reduce((s, l) => s + l.amount, 0) || gross;
    for (const l of open.length ? open : lines) l.disc = Math.round((dTot / base) * 10000) / 100;
  }
  let total = num(raw.total);
  const net = lines.reduce((s, l) => s + (l.disc ? l.amount * (1 - l.disc / 100) : l.amount), 0);
  if (!total && net) total = Math.round(net);
  let date = raw.date ? String(raw.date).slice(0, 10) : '';
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) date = '';
  return {
    store: String(raw.store || raw.shop || '').trim(),
    total,
    date,
    time: parseTimeHM(raw.time),
    lines,
  };
}

// ساعت از خروجی مدل: «14:35»، «۱۴:۳۵»، «2:35 PM»، «۲:۳۵ ب.ظ»، «1435» → «HH:MM» یا ''
export function parseTimeHM(v) {
  if (v == null || v === '') return '';
  let s = String(v).trim().replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const pm = /pm|p\.m|ب\.?\s?ظ|عصر|شب|بعدازظهر|بعد از ظهر/i.test(s);
  const am = /am|a\.m|ق\.?\s?ظ|صبح/i.test(s);
  let m = s.match(/(\d{1,2})\s*[:：٫.]\s*(\d{2})/);
  if (!m) m = s.match(/^(\d{2})(\d{2})$/);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (isNaN(h) || isNaN(mi) || mi > 59 || h > 24) return '';
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  if (h === 24) h = 0;
  return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}

function pick(row, keys) {
  if (!row || typeof row !== 'object') return '';
  for (const k of keys) {
    if (row[k] != null && row[k] !== '') return row[k];
  }
  const map = {};
  for (const k of Object.keys(row)) map[String(k).trim().toLowerCase()] = row[k];
  for (const k of keys) {
    const v = map[String(k).toLowerCase()];
    if (v != null && v !== '') return v;
  }
  return '';
}

function mapCat(v) {
  const s = String(v || '')
    .trim()
    .toLowerCase();
  if (/invest|سرمایه/.test(s)) return 'invest';
  if (/fun|تفریح|سرگرم/.test(s)) return 'fun';
  if (/charity|نیکو|خیرات|صدقه/.test(s)) return 'charity';
  if (/waste|هدر|اسراف/.test(s)) return 'waste';
  return 'need';
}

function mapType(v) {
  const s = String(v || '')
    .trim()
    .toLowerCase();
  if (s === 'in' || /درآمد|واریز|حقوق/.test(s)) return 'in';
  return 'out';
}

function isTotalRow(note) {
  const s = String(note || '').replace(/\s+/g, '');
  return /^(جمع|جمعکل|موجودی|total)$/i.test(s);
}

function isRialHint(v) {
  return /rial|ریال/i.test(String(v || ''));
}

function isTomanHint(v) {
  return /toman|تومان/i.test(String(v || ''));
}

function toToman(row, extra) {
  const written = num(pick(row, ['writtenToman', 'toman', 'amountToman']));
  if (written) return written;
  const rial = num(pick(row, ['bankRial', 'rial', 'amountRial']));
  if (rial) return rial / 10;
  const amt = num(pick(row, ['amount', 'total', 'مبلغ', 'price']));
  if (!amt) return 0;
  const cur = pick(row, ['currency', 'unitMoney', 'واحدپول']);
  if (isRialHint(cur) || isRialHint(extra)) return amt / 10;
  if (isTomanHint(cur) || isTomanHint(extra)) return amt;
  return amt;
}

function qtyUnitPrice(row, amount) {
  let qty = num(pick(row, ['qty', 'quantity', 'مقدار', 'تعداد']));
  let unit = String(pick(row, ['unit', 'واحد']) || '').trim();
  let unitPrice = num(pick(row, ['unitPrice', 'price', 'قیمتواحد']));
  if (qty > 0 && amount) {
    if (!unitPrice) unitPrice = amount / qty;
    if (!unit) unit = 'عدد';
    return { qty, unit, unitPrice };
  }
  return { qty: 0, unit: '', unitPrice: 0 };
}

function normalizeLine(row, fallbackCat) {
  let name = cleanTitle(pick(row, ['name', 'note', 'title', 'شرح']));
  if (!name || /^(ضروریات|ضروری|تفریح|هدررفت|سرمایه|نیکوکاری)$/.test(name)) name = '';
  const amount = toToman(row);
  if (!amount) return null;
  if (!name) name = 'قلم';
  const qu = qtyUnitPrice(row, amount);
  let qty = qu.qty;
  let unit = qu.unit;
  let unitPrice = qu.unitPrice;
  if (!qty) {
    qty = 1;
    unit = unit || 'عدد';
    unitPrice = amount;
  }
  return {
    id: uid(),
    name,
    qty,
    unit,
    unitPrice,
    amount: unitPrice * qty,
    cat: mapCat(pick(row, ['cat', 'category', 'پاکت', 'دسته']) || fallbackCat),
  };
}

function rowBlob(row) {
  try {
    return JSON.stringify(row);
  } catch (e) {
    return String(pick(row, ['note', 'name', 'title']) || '');
  }
}

function hasInvoiceWord(s) {
  return /فاکتور|فاكتور|فاکنور/i.test(String(s || ''));
}

function hasNumberedItems(s) {
  const t = faToEn(s);
  return /(?:^|[^\d])1\s*[-–.:)]/.test(t) && /(?:^|[^\d])2\s*[-–.:)]/.test(t);
}

function isInvoiceRow(row, note) {
  const kind = String(pick(row, ['kind', 'mode']) || '').toLowerCase();
  if (kind === 'invoice' || kind === 'فاکتور') return true;
  if (row && row.invoice === true) return true;
  if (hasInvoiceWord(note) || hasInvoiceWord(rowBlob(row))) return true;
  if (Array.isArray(row.lines) && row.lines.length >= 2) return true;
  if (hasNumberedItems(note)) return true;
  return false;
}

function cleanTitle(s) {
  let t = String(s || '')
    .replace(/فاکتور|فاكتور|فاکنور/g, ' ')
    .replace(/[:：]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/^(ضروریات|ضروری|تفریح|هدررفت|سرمایه‌گذاری|سرمایه|نیکوکاری)$/g, '');
  t = t.replace(/\s+(ضروریات|ضروری|تفریح|هدررفت|سرمایه‌گذاری|سرمایه|نیکوکاری)$/g, '');
  return t.trim();
}

function normalizePaper(raw) {
  if (!raw) return [];
  let rows = [];
  if (Array.isArray(raw)) rows = raw;
  else if (Array.isArray(raw.transactions)) rows = raw.transactions;
  else if (Array.isArray(raw.items)) rows = raw.items;
  else if (Array.isArray(raw.lines) && !raw.transactions) rows = raw.lines;
  const out = [];
  let lastDate = '';
  let lastAccount = '';
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const note = String(pick(row, ['note', 'name', 'title', 'شرح', 'توضیح'])).trim();
    if (isTotalRow(note)) continue;
    const type = mapType(pick(row, ['type', 'نوع']));
    const dateRaw = pick(row, ['date', 'تاریخ']);
    const parsed = parseAppDate(dateRaw);
    const date = parsed || lastDate;
    if (parsed) lastDate = parsed;
    const time = parseTimeHM(pick(row, ['time', 'ساعت']));
    const account = String(pick(row, ['account', 'accountName', 'حساب'])).trim() || lastAccount;
    if (account) lastAccount = account;
    const cat = type === 'in' ? null : mapCat(pick(row, ['cat', 'category', 'پاکت', 'دسته']) || note);
    const store = cleanTitle(pick(row, ['store', 'shop', 'فروشگاه']));
    const rawLines = Array.isArray(row.lines) ? row.lines : [];
    const invoice = type === 'out' && isInvoiceRow(row, note);

    if (invoice) {
      const lines = [];
      for (const ln of rawLines) {
        const one = normalizeLine(ln, cat || 'need');
        if (one) lines.push(one);
      }
      if (!lines.length) {
        const one = normalizeLine(Object.assign({}, row, { name: cleanTitle(note) || 'قلم فاکتور' }), cat || 'need');
        if (one) lines.push(one);
      }
      let amount = lines.reduce((s, l) => s + l.amount, 0);
      const bankToman = toToman(row);
      if (!amount && bankToman) {
        lines.push({
          id: uid(),
          name: cleanTitle(note) || 'قلم فاکتور',
          qty: 1,
          unit: 'قلم',
          unitPrice: bankToman,
          amount: bankToman,
          cat: cat || 'need',
        });
        amount = bankToman;
      }
      if (!amount) continue;
      if (bankToman && Math.abs(bankToman - amount) > 1) {
        const rem = bankToman - amount;
        if (rem > 0) {
          lines.push({
            id: uid(),
            name: 'سایر',
            qty: 1,
            unit: 'قلم',
            unitPrice: rem,
            amount: rem,
            cat: cat || 'need',
          });
          amount = bankToman;
        }
      }
      out.push({
        type: 'out',
        kind: 'invoice',
        amount,
        cat: null,
        note: store || cleanTitle(note) || 'فاکتور',
        account,
        date,
        time,
        qty: 0,
        unit: '',
        unitPrice: 0,
        lines,
      });
      continue;
    }

    const amount = toToman(row);
    if (!amount) continue;
    const qu = qtyUnitPrice(row, amount);
    out.push({
      type,
      kind: '',
      amount,
      cat,
      note: cleanTitle(note) || store || 'خرج',
      account,
      date,
      time,
      qty: qu.qty,
      unit: qu.unit,
      unitPrice: qu.unitPrice,
      lines: [],
    });
  }
  return out;
}
