// پارسرِ محلیِ پیامک‌های بانکی — بدون اینترنت، بدون کلید، فوری.
//
// چرا این هست؟ مسیرِ اصلیِ «متن» همان هوش مصنوعی است (readSmsText در scan.js)، ولی
// پیامکِ بانک قالبِ خیلی منظمی دارد و کاربر ممکن است کلید نگذاشته باشد یا اینترنت
// نباشد. این پارسر همان کار را محلی می‌کند و اگر هوش مصنوعی هم نرسد، پشتیبان است.
//
// خروجی دقیقاً همان ردیف‌هایی است که normalizePaper() در scan.js می‌سازد، پس بدون
// هیچ تبدیلِ اضافه به applyPaperRows() و صفحهٔ بازبینی (همان صفحهٔ ویرایشِ عکس) می‌رود.
import { parseAppDate } from './jalali.js';
import { allBanks } from './cards.js';
import { todayISO } from './utils.js';

const SKIP_RE = /(رمز\s*(پویا|یکبار|ثانوی|عبور|اول)|کد\s*تایید|کد\s*اعتبار|otp|پیام\s*تست|برنده\s*شدید|قرعه\s*کشی|جهت\s*اطلاع|ناموفق|انجام\s*نشد|لغو\s*شد|قابل\s*مشتریان|نصب\s*(اپلیکیشن|برنامه)|ارتقای\s*سامانه)/i;
const IN_RE = /(واریز|افزایش|افزوده\s*شد|دریافت|برگشت\s*(وجه|پول)|تسویه\s*شد|سود\s*(سپرده|علی)|حقوق|یارانه|هدیه\s*شد|واریز\s*شد|مشتری\s*شد|گردش\s*بستانکار)/;
const OUT_RE = /(برداشت|خرید|پرداخت|کسر|انتقال\s*(به|وجه)|قبض|شارژ|کارمزد|جریمه|دیرکرد|اشتراک|قسط|بازپرداخت|خرید\s*شد)/;
// واحدِ پول: ریال پیش‌فرضِ پیامک‌های بانکی ایران است
const CUR_RE = /(میلیارد|میلیون|هزار)?\s*(ریال|تومان|تومن)/;

function toLatinDigits(s) {
  return String(s == null ? '' : s)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

function normText(raw) {
  let s = toLatinDigits(raw);
  s = s.replace(/\u200c/g, ' ').replace(/[ي]/g, 'ی').replace(/[ك]/g, 'ک').replace(/[ة]/g, 'ه');
  s = s.replace(/[٬]/g, ',').replace(/[؛]/g, ';').replace(/[،]/g, ',');
  s = s.replace(/[ \t]+/g, ' ');
  return s.trim();
}

// هر پیامک با یک فعلِ پولی شروع می‌شود؛ اگر چند پیامک پشت هم چسبیده باشند از همان‌جا جدا می‌شوند
function splitRunOn(m) {
  const starts = [];
  const re = /(برداشت|واریز|خرید|پرداخت|انتقال|افزایش|کسر|شارژ|قبض)/g;
  let mm;
  while ((mm = re.exec(m))) {
    if (mm.index === 0) { starts.push(0); continue; }
    const before = m.slice(0, mm.index);
    if (CUR_RE.test(before) && /\d/.test(before)) starts.push(mm.index);
  }
  if (starts.length <= 1) return [m];
  const out = [];
  for (let i = 0; i < starts.length; i++) out.push(m.slice(starts[i], starts[i + 1] || m.length).trim());
  return out.filter((x) => x);
}

export function splitMessages(text) {
  const raw = String(text || '');
  // جداکننده فقط وقتی خطِ کامل باشد: «****» در کارتِ ماسک‌شده نباید پیامک را نصف کند
  const blocks = raw
    .split(/\n{2,}|\n\s*[-*=_]{3,}\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  let msgs = blocks.length > 1 ? blocks : raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (msgs.length === 1) msgs = splitRunOn(msgs[0]);
  // خطِ بی‌عدد، ادامهٔ پیامکِ قبلی است (شکستنِ متن در بعضی پیام‌رسان‌ها)
  const merged = [];
  for (const m of msgs) {
    const prev = merged[merged.length - 1];
    // خطِ بی‌عدد ادامهٔ پیامکِ قبلی است، اما فقط اگر قبلی هنوز واحدِ پول/مبلغ نداشته باشد
    if (prev && !/\d/.test(m) && !CUR_RE.test(prev)) merged[merged.length - 1] = prev + ' ' + m;
    else merged.push(m);
  }
  const out = [];
  for (const m of merged) for (const part of splitRunOn(normText(m))) out.push(part);
  return out.filter(Boolean);
}

// حساب/کارت: ۴ رقم آخر + نام بانک (همان چیزی که matchAccountId در forms.js می‌فهمد)
export function findAccount(m) {
  let last4 = '';
  let mm = m.match(/\b\d{4}(?:[-\s]+\d{2,6}|[-\s]*\*{2,6}){1,6}\b|(?:^|[^\d*])\*{2,6}[-\s]*\d{4}(?!\d)/);
  if (mm) {
    const d = mm[0].replace(/\D/g, '');
    if (d.length >= 4) last4 = d.slice(-4);
  }
  if (!last4) {
    mm = m.match(/(?:حساب|کارت|شماره|شبا|account)\s*[:\-]?\s*(\d{4,26})/);
    if (mm) last4 = mm[1].slice(-4);
  }
  let name = '';
  for (const b of allBanks()) {
    const short = b.name.replace(/^(بانک|مؤسسه)\s+/, '');
    // «رفاه» در «فروشگاه رفاه» بانک رفاه نیست: یا نامِ کامل، یا «بانک/نزدِ + نام»
    const bankish = new RegExp('(?:بانک|مؤسسه|نزد|by)\\s+' + short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (m.includes(b.name) || bankish.test(m)) { name = b.name; break; }
  }
  const parts = [];
  if (name) parts.push(name.replace(/^بانک\s+/, ''));
  if (last4) parts.push(last4);
  return { last4, name, label: parts.join(' ') };
}

const NOTE_CUT = /(به\s*مبلغ|مبلغ|با\s*کارت|در\s*تاریخ|تاریخ|ساعت|به\s*نام|شناسه|از\s*حساب|به\s*حساب|با\s*موفقیت|انجام\s*شد|صورت\s*گرفت|از\s*کارت|شماره|کد|مانده|موجودی|ریال|تومان|تومن)/;

function cleanNote(s) {
  let v = String(s || '').trim();
  const cut = v.search(NOTE_CUT);
  if (cut > 0) v = v.slice(0, cut);
  v = v.replace(/^[:\-\s]+|[:\-\s]+$/g, '');
  v = v.replace(/\b(ریال|تومان|تومن|هزار|میلیون)\b/g, ' ').replace(/\s{2,}/g, ' ').trim();
  v = v.replace(/^[,;.\s]+/, '');
  return v.slice(0, 48);
}

function extractNote(m) {
  const pats = [
    /خرید\s+از\s*[:\-]?\s*([^;,:\d]{2,40})/,
    [/پرداخت\s+قبض\s*[:\-]?\s*([^;,:\d]{2,32})/, 'قبض'],
    /پرداخت\s+(?:به|بابت)\s*[:\-]?\s*([^;,:\d]{2,32})/,
    /انتقال\s+(?:وجه\s+)?(?:به|از)\s*[:\-]?\s*([^;,:\d]{2,32})/,
    /واریز\s+(?:از|به|توسط)\s*[:\-]?\s*([^;,:\d]{2,32})/,
    /برداشت\s+(?:از|توسط)\s*[:\-]?\s*([^;,:\d]{2,32})/,
    /بابت\s*[:\-]?\s*([^;,:\d]{2,32})/,
    /شرح\s*[:\-]\s*([^;,:\d]{2,40})/,
    /صرافی\s*[:\-]?\s*([^;,:\d]{2,32})/,
  ];
  for (const entry of pats) {
    const [p, tag] = Array.isArray(entry) ? entry : [entry, ''];
    const mm = m.match(p);
    if (mm && mm[1]) {
      const v = cleanNote(mm[1]);
      if (v.length >= 2) return tag === 'قبض' ? 'قبض ' + v : v;
    }
  }
  // انتقال به نامِ کسی: طرفِ حساب در یادداشت بماند
  const named = m.match(/به\s*نام\s*([^;,:\d]{2,25})/);
  if (named) {
    const v = cleanNote(named[1]);
    if (v.length >= 2) return (/انتقال/.test(m) ? 'انتقال به ' : '') + v;
  }
  if (/خودپرداز|عابر\s*بانک|atm/i.test(m)) return 'برداشت نقدی از خودپرداز';
  if (/پوز|کارتخوان|pos/i.test(m)) return 'خرید با کارتخوان';
  if (/قبض/.test(m)) return 'پرداخت قبض';
  if (/شارژ/.test(m)) return 'شارژ';
  if (/کارمزد/.test(m)) return 'کارمزد';
  if (/جریمه|دیرکرد/.test(m)) return 'جریمه دیرکرد';
  if (/قسط|بازپرداخت/.test(m)) return 'قسط';
  if (/حقوق/.test(m)) return 'حقوق';
  if (/سود/.test(m)) return 'سود';
  if (/یارانه/.test(m)) return 'یارانه';
  if (/انتقال/.test(m)) return 'انتقال وجه';
  if (/واریز/.test(m)) return 'واریز';
  if (/برداشت/.test(m)) return 'برداشت';
  if (/خرید/.test(m)) return 'خرید';
  return '';
}

function guessCat(type, note) {
  if (type === 'in') return null;
  const n = note || '';
  if (/(جریمه|دیرکرد|کارمزد|ضرر)/.test(n)) return 'waste';
  if (/(هدیه|کمک|خیریه|نذری|نیکوکاری)/.test(n)) return 'charity';
  if (/(رستوران|کافه|سینما|سفر|بازی|تفریح|کتاب|کنسرت|گردش)/.test(n)) return 'fun';
  if (/(سهم|بورس|طلا|سکه|ارز|دلار|صندوق|سرمایه|سپرده|ودیعه)/.test(n)) return 'invest';
  return 'need';
}

// مبلغ: عددی که واحدِ پول جلویش آمده؛ «مانده/موجودی» هرگز تراکنش نیست
function extractAmount(m) {
  // مانده/موجودی تراکنش نیست؛ هر چقدر هم که بینش کلمه باشد پاک می‌شود
  let s = m.replace(/(مانده|موجودی|قابل\s*برداشت|balance)[^\d]{0,24}[\d][\d,.]*/g, ' ');
  // تاریخ و ساعت و شمارهٔ کارت را کنار بگذار تا عددِ مبلغ اشتباه انتخاب نشود
  s = s.replace(/\b1[3-9]\d{2}[\/\-.]\d{1,2}[\/\-.]\d{1,2}\b/g, ' ');
  s = s.replace(/\b20\d{2}[\/\-.]\d{1,2}[\/\-.]\d{1,2}\b/g, ' ');
  s = s.replace(/\b\d{1,2}:\d{2}\b/g, ' ');
  s = s.replace(/\b\d{4}(?:[-\s]+\d{2,6}|[-\s]*\*{2,6}){1,6}\b|(?:^|[^\d*])\*{2,6}[-\s]*\d{4}(?!\d)/g, ' ');

  const nums = [];
  const re = /(\d[\d,]*(?:\.\d+)?)/g;
  let mm;
  while ((mm = re.exec(s))) {
    const raw = mm[1].replace(/,/g, '');
    const n = Number(raw);
    if (!isFinite(n) || n <= 0) continue;
    nums.push({ n, raw, at: mm.index, end: mm.index + mm[1].length });
  }
  if (!nums.length) return null;

  // اول عددی که واحدِ پول دارد
  for (const c of nums) {
    const after = s.slice(c.end, c.end + 18);
    const cm = after.match(/^\s*(میلیارد|میلیون|هزار)?\s*(ریال|تومان|تومن)/);
    if (cm) return toToman(c.n, cm[2], cm[1]);
  }
  // بعد عددی که واحد پیش از آن آمده («۵۰۰ هزار تومان واریز شد»)
  for (const c of nums) {
    const before = s.slice(Math.max(0, c.at - 18), c.at);
    const cm = /(میلیارد|میلیون|هزار)?\s*(ریال|تومان|تومن)\s*[:\-]?\s*$/.exec(before);
    if (cm) return toToman(c.n, cm[2], cm[1]);
  }
  // بی‌واحد: بزرگ‌ترین عدد (معمولاً خودِ مبلغ است، نه شمارهٔ حساب)
  const big = nums.slice().sort((a, b) => b.n - a.n)[0];
  return { amount: Math.round(big.n / 10), rial: true, unit: '' };
}

function toToman(n, unit, scale) {
  const mult = scale === 'میلیارد' ? 1e9 : scale === 'میلیون' ? 1e6 : scale === 'هزار' ? 1e3 : 1;
  const v = n * mult;
  const isToman = /تومان|تومن/.test(unit || '');
  return { amount: isToman ? Math.round(v) : Math.round(v / 10), rial: !isToman, unit: isToman ? 'تومان' : 'ریال' };
}

function extractDate(m) {
  const jm = m.match(/\b(1[3-9]\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/);
  if (jm) return parseAppDate(jm[1] + '/' + jm[2] + '/' + jm[3]) || '';
  const gm = m.match(/\b(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/);
  if (gm) return parseAppDate(gm[1] + '/' + gm[2] + '/' + gm[3]) || '';
  if (/(امروز|today)/.test(m)) return todayISO();
  if (/(دیروز|yesterday)/.test(m)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  return '';
}

function extractTime(m) {
  const mm = m.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!mm) return '';
  const h = Number(mm[1]);
  const mi = Number(mm[2]);
  if (h > 23 || mi > 59) return '';
  return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}

// یک پیامک → یک ردیف (یا null اگر تراکنش نیست)
export function parseOneSms(msg) {
  const m = normText(msg);
  if (!m || SKIP_RE.test(m)) return null;
  const amt = extractAmount(m);
  if (!amt || !(amt.amount > 0)) return null;
  const type = OUT_RE.test(m) && !IN_RE.test(m) ? 'out' : IN_RE.test(m) ? 'in' : 'out';
  const acct = findAccount(m);
  const note = extractNote(m) || (type === 'in' ? 'واریز' : 'برداشت');
  return {
    type,
    kind: '',
    amount: amt.amount,
    cat: guessCat(type, note),
    note,
    account: acct.label,
    date: extractDate(m) || todayISO(),
    time: extractTime(m),
    qty: 0,
    unit: '',
    unitPrice: 0,
    lines: [],
  };
}

// کلِ متن چسبانده‌شده → ردیف‌های آمادهٔ بازبینی
export function parseBankSms(text) {
  const out = [];
  for (const msg of splitMessages(text)) {
    const row = parseOneSms(msg);
    if (!row) continue;
    // پیامکِ تکراریِ یک تراکنش (بعضی بانک‌ها دو بار می‌فرستند)
    const dup = out.some((r) => r.type === row.type && r.amount === row.amount && r.date === row.date && r.note === row.note);
    if (dup) continue;
    out.push(row);
  }
  return out;
}
