import { store, toast, uid } from './utils.js';
import { parseAppDate } from './jalali.js';

const KEY = 'capital_gemini_key';
// عبوردهندهٔ ورسل: کلیدِ خودِ کاربر فوروارد می‌شود، چیزی ذخیره نمی‌شود.
// از طریق آن بدون فیلترشکن هم می‌توان به گوگل وصل شد؛ آن‌وقت پیام الکی «فیلترشکن روشن کن» نمی‌آید.
const GEMINI_PROXY = 'https://taraz-api.vercel.app/api/gemini';

async function geminiProxy(payload) {
  const resp = await fetch(GEMINI_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (resp.status === 404 || resp.status >= 500) throw Object.assign(new Error('proxy-down'), { proxyDown: true, status: resp.status });
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

async function callGemini(model, key, b64, prompt, jsonMode) {
  let resp = null;
  try {
    resp = await geminiProxy({ key, model, prompt, imageB64: b64, jsonMode: !!jsonMode });
  } catch (e) {
    /* پراکسی در دسترس نیست یا هنوز نصب نشده → مسیر مستقیم گوگل */
  }
  if (!resp) {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) +
      ':generateContent?key=' +
      encodeURIComponent(key);
    const gen = { temperature: 0.1 };
    if (jsonMode) gen.responseMimeType = 'application/json';
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inlineData: { mimeType: 'image/jpeg', data: b64 } },
            ],
          },
        ],
        generationConfig: gen,
      }),
    });
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = (data.error && data.error.message) || 'خطای ' + resp.status;
    const err = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  const text =
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts &&
    data.candidates[0].content.parts.map((p) => p.text || '').join('\n');
  return parseModelJson(text);
}

function shortErr(e) {
  const raw = (e && e.message) || String(e || '');
  const s = raw.toLowerCase();
  if (s.includes('api key') || s.includes('api_key')) return 'کلید نامعتبر است؛ در تنظیمات دوباره ذخیره کن';
  if (s.includes('permission') || s.includes('403')) return 'کلید اجازه این کار را ندارد';
  if (s.includes('quota') || s.includes('resource exhausted')) return 'سهمیه رایگان گوگل تمام شده';
  if (s.includes('not found') || s.includes('supported methods') || s.includes('listmodels'))
    return 'مدل گوگل عوض شده؛ یک‌بار دیگر عکس را بفرست';
  if (s.includes('location') || s.includes('not supported') || s.includes('unavailable in your country')) return 'فیلترشکن را روشن کن';
  if (s.includes('failed to fetch') || s.includes('network')) return 'فیلترشکن را روشن کن';
  const cut = raw.replace(/\s+/g, ' ').trim();
  return cut.length > 80 ? cut.slice(0, 80) + '…' : cut || 'خواندن عکس نشد';
}

async function listModels(key) {
  let resp = null;
  try {
    resp = await geminiProxy({ action: 'list', key });
  } catch (e) {
    /* پراکسی نیست → مستقیم */
  }
  if (!resp) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key);
    resp = await fetch(url);
  }
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
  const key = getGeminiKey();
  if (!key) throw new Error('NO_KEY');
  const b64 = await fileToJpeg(file, opts && opts.max, opts && opts.quality);
  lastB64 = b64;
  let models = MODELS.slice();
  try {
    const listed = await listModels(key);
    if (listed.length) models = listed;
  } catch (e) {}
  let lastErr = null;
  const jsonMode = !!(opts && opts.jsonMode);
  for (const model of models.slice(0, 6)) {
    try {
      let raw = await callGemini(model, key, b64, prompt, jsonMode);
      if (!raw && jsonMode) raw = await callGemini(model, key, b64, prompt, false);
      if (raw) return raw;
      lastErr = new Error('جواب قابل فهم نبود');
    } catch (e) {
      lastErr = e;
      if (jsonMode) {
        try {
          const raw = await callGemini(model, key, b64, prompt, false);
          if (raw) return raw;
        } catch (e2) {
          lastErr = e2;
        }
      }
      const msg = ((lastErr && lastErr.message) || '').toLowerCase();
      const skip =
        lastErr.status === 404 || msg.includes('not found') || msg.includes('supported methods');
      if (!skip && lastErr.status && lastErr.status !== 429) break;
    }
  }
  throw new Error(shortErr(lastErr || new Error('خواندن عکس نشد')));
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
