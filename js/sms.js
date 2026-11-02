// پارسرِ محلیِ پیامک‌های بانکی — بدون اینترنت، بدون کلید، فوری.
//
// چرا این هست؟ مسیرِ اصلیِ «متن» همان هوش مصنوعی است (readSmsText در scan.js)، ولی
// پیامکِ بانک قالبِ خیلی منظمی دارد و کاربر ممکن است کلید نگذاشته باشد یا اینترنت
// نباشد. این پارسر همان کار را محلی می‌کند و اگر هوش مصنوعی هم نرسد، پشتیبان است.
//
// خروجی دقیقاً همان ردیف‌هایی است که normalizePaper() در scan.js می‌سازد، پس بدون
// هیچ تبدیلِ اضافه به applyPaperRows() و صفحهٔ بازبینی (همان صفحهٔ ویرایشِ عکس) می‌رود.
import { parseAppDate, jalaliNow } from './jalali.js';
import { allBanks } from './cards.js';
import { todayISO } from './utils.js';

const SKIP_RE = /(رمز\s*(پویا|یکبار|ثانوی|عبور|اول)|کد\s*تایید|کد\s*اعتبار|otp|پیام\s*تست|برنده\s*شدید|قرعه\s*کشی|جهت\s*اطلاع|ناموفق|انجام\s*نشد|لغو\s*شد|قابل\s*مشتریان|نصب\s*(اپلیکیشن|برنامه)|ارتقای\s*سامانه)/i;
const IN_RE = /(واریز|افزایش\s*یافت|افزایش|افزوده\s*شد|اضافه\s*شد|زیاد\s*شد|دریافت|برگشت\s*(وجه|پول)|تسویه\s*شد|سود\s*(سپرده|علی)|حقوق|یارانه|هدیه\s*شد|واریز\s*شد|مشتری\s*شد|گردش\s*بستانکار|به\s*حساب\s*شما\s*(آمد|نشست))|به\s*حساب\s*شما\s*اضافه/;
const OUT_RE = /(برداشت|خرید|پرداخت|کسر\s*گردید|کسر|کاهش\s*یافت|کم\s*شد|انتقال\s*(به|وجه)|قبض|شارژ|کارمزد|جریمه|دیرکرد|اشتراک|قسط|بازپرداخت|خرید\s*شد|از\s*حساب\s*شما\s*(کم|کسر|برداشت))/;
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
  // منهاهای یونیکد (− U+2212 و ـ) و بعلاوهٔ تمام‌عرض: بعضی بانک‌ها این‌ها را می‌فرستند
  s = s.replace(/[\u2212\uFF0D]/g, '-').replace(/[\uFF0B]/g, '+');
  // «*بانک تجارت*» → «بانک تجارت» (فقط وقتی کلِ خط ستاره دارد؛ ماسکِ کارت دست نمی‌خورد)
  s = s.replace(/^[ \t]*\*+([^*\n]+?)\*+[ \t]*$/gm, '$1');
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

const GENERIC_BANK_WORD = /(حساب|کارت|شعبه|مشتری|گرامی|فروشگاه)/;

// خطی که فقط نامِ بانک است (مثلاً «بانك ملي ايران» یا «*بانک تجارت*»)
export function isBankHeader(line) {
  const t = normText(line).replace(/\s+/g, ' ').trim();
  if (!t || t.length > 42 || /\d/.test(t)) return false;
  for (const b of allBanks()) {
    const short = b.name.replace(/^(بانک|مؤسسه)\s+/, '');
    const forms = [b.name, short, b.name + ' ایران', short + ' ایران'];
    if (forms.some((f) => t === f || t === f.replace(/\s+/g, ''))) return true;
    // سربرگ یعنی کلِ خط فقط نامِ بانک باشد (با «ایران» یا دونقطه)؛ «برداشت ناموفق - بانک ملی» سربرگ نیست
    const rest = t.replace(b.name, '').replace(/[\s:：.\-–—()]/g, '');
    if (rest === '' || rest === 'ایران') return true;
    // «بانک رسالت» = «بانک قرض‌الحسنه رسالت»: واژهٔ آخرِ نام با پیشوندِ بانک
    const words = short.split(/\s+/).filter((w) => w.length >= 3);
    const tail = words[words.length - 1] || '';
    if (tail && tail !== short && new RegExp('^(?:بانک|مؤسسه)\\s+' + tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$').test(t)) return true;
  }
  return false;
}

// خطی که تراکنشِ تازه‌ای را شروع می‌کند (نه خطِ اطلاعاتیِ همان پیامک)
function startsTxLine(l) {
  const t = String(l || '').trim();
  if (/^[+-]\s*[\d۰-۹٠-٩٬,]/.test(t)) return true;
  if (/[\d,]{4,}[+-]\s*(?![\d*])/.test(t) && /(برداشت|واریز|انتقال|خرید|پرداخت)/.test(t)) return true;
  if (!/\d/.test(t)) return false;
  if (/^مبلغ\s*[:：]\s*[+-]?\s*[\d۰-۹٠-٩٬,]/.test(t)) return true;
  return /^(برداشت|واریز|انتقال|خرید|پرداخت|کسر|افزایش|شارژ|قبض|کارت\s*به\s*کارت)(?=[\s:：]|$)/.test(t);
}

function lineHasAmount(l) {
  const t = String(l || '');
  return /\d/.test(t) && (CUR_RE.test(t) || /[\d,]{4,}\s*[+-]\s*(?![\d*])/.test(t) || /^[+-]\s*[\d۰-۹٬,]/.test(t.trim()));
}

// خط‌های «اطلاعاتی» همان پیامک: هیچ‌وقت پیامکِ تازه شروع نمی‌کنند
// «مانده/موجودی» همیشه اطلاعاتی است؛ بقیهٔ کلیدها فقط وقتی که دونقطه داشته باشند
// («حساب: 02000» اطلاعاتی است ولی «حساب شما به مبلغ … بستانکار شد» یک تراکنشِ کامل است)
const META_LINE = /^(?:از|به|طرف|در)?\s*(?:مانده|موجودی|balance)|^(?:از|به|طرف|در)?\s*(حساب|کارت|شماره|شبا|سپرده|پایانه|پذیرنده|پیگیری|شناسه|کد|تاریخ|ساعت|زمان|طریق|نوع|شرح|بابت)\S*(?:\s+\S+)?\s*[:：]/i;
function isMetaLine(l) {
  const t = String(l || '').trim();
  if (!t) return true;
  if (BAL_CHANGE.test(t) && /(?:مانده|موجودی|مبلغ)/.test(t)) return false; // «موجودی شما X افزایش یافت»
  if (!/\d/.test(t)) return true;                                  // نامِ بانک، «مشتری گرامی»، «کارت به کارت»
  if (/^\d{4}[-/.]\d{1,2}([-/.]\d{1,2})?/.test(t)) return true;     // تاریخِ کامل
  if (/^\d{1,2}:\d{2}/.test(t)) return true;                        // ساعت
  if (/^\d{2,4}-\d{1,2}:\d{2}/.test(t)) return true;                // مهرِ کوتاهِ ملی (0810-21:55)
  return META_LINE.test(t);
}

export function splitMessages(text) {
  const raw = String(text || '');
  const lines = raw.split(/\r?\n/);
  const msgs = [];
  let cur = [];
  let hasAmt = false;
  let hasSkip = false;
  let pendingBlank = false;
  const flush = () => {
    if (cur.length) { msgs.push(cur.join('\n')); cur = []; hasAmt = false; hasSkip = false; }
  };
  for (const rawLine of lines) {
    const l = rawLine.trim();
    if (!l) { if (cur.length) pendingBlank = true; continue; }
    // آزمون‌ها روی متنِ نرمال (رقمِ لاتین)؛ وگرنه «۷٬۷۰۰٬۰۰۰ ریال» بی‌عدد به نظر می‌رسد
    const t = normText(l);
    // نامِ بانک روی خطِ خودش = سربرگِ پیامکِ تازه (ملی، تجارت و بیشتر بانک‌ها)
    if (isBankHeader(l)) { flush(); cur.push(l); pendingBlank = false; continue; }
    // عنوانِ بی‌رقمِ پیامکِ تازه («کارت به کارت») بعد از پیامکی که مبلغش را گرفته
    const bareTitle = !/\d/.test(t) && !/[:：]/.test(t) && BARE_NOTE_RE.test(t);
    // وقتی پیامکِ جاری مبلغش را گرفته، خطِ غیراطلاعاتیِ بعدی پیامکِ تازه است
    // پیامکِ جاری «تمام» است اگر مبلغش را گرفته باشد یا کلاً پیامِ ردشدنی باشد (رمز پویا/ناموفق)
    if (cur.length && (hasAmt || hasSkip) && (!isMetaLine(t) || bareTitle) && (pendingBlank || bareTitle || startsTxLine(t) || lineHasAmount(t))) flush();
    cur.push(l);
    if (lineHasAmount(t)) hasAmt = true;
    if (SKIP_RE.test(t)) hasSkip = true;
    pendingBlank = false;
  }
  flush();
  // پیامکِ تک‌خطیِ به‌هم‌چسبیده هم از روی فعلِ پولی جدا می‌شود
  const out = [];
  for (const m of msgs) for (const part of (isStructured(m) ? [normText(m)] : splitRunOn(normText(m)))) out.push(part);
  return out.filter(Boolean);
}

// حساب/کارت: ۴ رقم آخر + نام بانک (همان چیزی که matchAccountId در forms.js می‌فهمد)
// نام‌های کوتاهی که در پیامک به‌جای نامِ کاملِ بانک می‌آیند
const ALIAS = {
  بلوبانک: /(?:^|[\s—\-:،])بلو(?:\s|کارت|$)/,
};

export function findAccount(m) {
  let last4 = '';
  // تاریخ و ساعت شمارهٔ کارت نیستند: مهرِ ملی «0810-21:55»، تاریخِ کامل و ساعت
  const probe = String(m || '')
    .replace(/\b\d{4}-\d{1,2}:\d{2}\b/g, ' ')
    .replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2})?/g, ' ')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ');
  // اول کارتِ ماسک‌شده («6395-****-****-1234»)؛ «از حساب 6395-…» را نباید ۶۳۹۵ گرفت
  let mm = probe.match(/\b\d{4}(?:[- \t]+\d{2,6}|[- \t]*\*{2,6}){1,6}\b|(?:^|[^\d*])\*{2,6}[- \t]*\d{4}(?!\d)/);
  if (mm) {
    const d = mm[0].replace(/\D/g, '');
    if (d.length >= 4) last4 = d.slice(-4);
  }
  // بعد شمارهٔ حسابِ صریح («حساب:02000» یا «حساب: 0377806172623»)
  if (!last4) {
    mm = probe.match(/(?:حساب|کارت|شماره|شبا|account)\s*[:\-]?\s*(\d{4,26})/);
    if (mm) last4 = mm[1].slice(-4);
  }
  let name = '';
  for (const b of allBanks()) {
    const short = b.name.replace(/^(بانک|مؤسسه)\s+/, '');
    // «رفاه» در «فروشگاه رفاه» بانک رفاه نیست: یا نامِ کامل، یا «بانک/نزدِ + نام»
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const bankish = new RegExp('(?:بانک|مؤسسه|نزد|by)\\s+' + esc(short));
    if (m.includes(b.name) || bankish.test(m)) { name = b.name; break; }
    // برندِ کوتاهِ نئوبانک‌ها: پیامکِ بلوبانک می‌نویسد «بلو کارت»
    if (ALIAS[b.name] && ALIAS[b.name].test(m)) { name = b.name; break; }
    // «بانک رسالت» باید به «بانک قرض‌الحسنه رسالت» بخورد: واژهٔ آخرِ نام با پیشوندِ بانک
    const words = short.split(/\s+/).filter((w) => w.length >= 3);
    const tail = words[words.length - 1] || '';
    if (tail && tail !== short && new RegExp('(?:بانک|مؤسسه|نزد)\\s+' + esc(tail) + '(?![\\u0600-\\u06FF])').test(m)) { name = b.name; break; }
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

let CHANNEL_HINT = '';

function extractNote(m) {
  const pats = [
    /خرید\s+(?:از|در|اینترنتی\s+از)\s*[:\-]?\s*([^;,:\d]{2,40})/,
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
  const chm = m.match(/(?:از\s*طریق|طریق|کانال|درگاه)\s*[:\-]?\s*([^;,:\d]{2,20})/);
  if (chm) { const ch = cleanChannel(chm[1]); if (ch) CHANNEL_HINT = ch; }
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
// «مانده/موجودی» با فعلِ تغییر = خودِ تراکنش است، نه اعلامِ مانده
const BAL_CHANGE = /(افزایش|کاهش|اضافه|کم|زیاد|تغییر|افزوده|کاسته|بیشتر|کمتر)\s*(یافت|شد|گردید|کرده|شده|می‌شود)/;

function extractAmount(m) {
  // مانده/موجودی تراکنش نیست؛ هر چقدر هم که بینش کلمه باشد پاک می‌شود
  // (مگر اینکه فعلِ تغییر داشته باشد: «موجودی شما 5,000,000 ریال افزایش یافت»)
  let s = m.replace(/(مانده|موجودی|قابل\s*برداشت|balance)([^\d]{0,24})([\d][\d,.]*)/g, (all, k, mid, num, off) => {
    const tail = String(m).slice(off + all.length, off + all.length + 34);
    return BAL_CHANGE.test(mid + ' ' + tail) ? ' ' + num + ' ' : ' ';
  });
  // تاریخ و ساعت و شمارهٔ کارت را کنار بگذار تا عددِ مبلغ اشتباه انتخاب نشود
  s = s.replace(/\b1[3-9]\d{2}[\/\-.]\d{1,2}[\/\-.]\d{1,2}\b/g, ' ');
  s = s.replace(/\b20\d{2}[\/\-.]\d{1,2}[\/\-.]\d{1,2}\b/g, ' ');
  s = s.replace(/\b\d{1,2}:\d{2}\b/g, ' ');
  s = s.replace(/\b\d{4}(?:[- \t]+\d{2,6}|[- \t]*\*{2,6}){1,6}\b|(?:^|[^\d*])\*{2,6}[- \t]*\d{4}(?!\d)/g, ' ');

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

// «0810-21:55» یعنی ۱۰ آبانِ سالِ شمسیِ جاری، ساعتِ ۲۱:۵۵ — قالبِ پیامکِ بانک ملی
function shortJalaliDate(month, day) {
  const mo = Number(month);
  const d = Number(day);
  if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return '';
  const [jy] = jalaliNow();
  const iso = parseAppDate(jy + '/' + mo + '/' + d);
  if (!iso) return '';
  // اگر از امروز جلوتر افتاد، حتماً سالِ قبل بوده (پیامکِ پارسال)
  const ahead = new Date();
  ahead.setDate(ahead.getDate() + 1);
  if (iso > ahead.toISOString().slice(0, 10)) return parseAppDate(jy - 1 + '/' + mo + '/' + d) || iso;
  return iso;
}

// «از طريق: شتاب» / «از طریق: پایانه فروش» → کانالِ تراکنش که در یادداشت می‌آید
function cleanChannel(v) {
  let s = String(v || '').trim();
  s = s.replace(/[\d].*$/, '').replace(/[\s:.,\-]+$/g, '').trim();
  if (!s || s.length > 24) return '';
  return s;
}

// بانک‌ها کلمه‌ها را می‌چسبانند: «خريداينترنتي» → «خرید اینترنتی»
function unglue(s) {
  return String(s || '')
    .replace(/کارتبهکارت/g, 'کارت به کارت')
    .replace(/(خرید|پرداخت|انتقال|برداشت|واریز|شارژ)(اینترنتی|اینترنت|آنلاین|حضوری|شتابی|نقدی)/g, '$1 $2')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const KV_LINE = /^([^:\n]{1,30})\s*[:：]\s*(.*)$/;
const KEY_BAL = /(مانده|موجودی|باقی\s*مانده|قابل\s*برداشت|balance)/;
const KEY_ACC = /^\s*(حساب|کارت|شماره|شبا|سپرده|پس\s*انداز|account)/;
const KEY_CH = /(از\s*طریق|طریق|کانال|درگاه|دستگاه|پایانه|ترمینال|پذیرنده|شعبه)/;
const KEY_AMT = /^\s*(مبلغ|amount)/;
const KEY_KIND = /^\s*(نوع|نوع\s*عملیات|عملیات)/;
const KEY_DESC = /^\s*(شرح|بابت|توضیحات|شرح\s*تراکنش|شرح\s*عملیات)/;
const BARE_NOTE_RE = /(کارت\s*به\s*کارت|انتقال|برداشت|واریز|خرید|پرداخت|شارژ|قبض|حقوق|سود|قسط)/;
const KEY_TX = /(برداشت|واریز|انتقال|خرید|پرداخت|شارژ|قبض|کسر|کاهش|افزایش|اضافه|زیاد|دریافت|برگشت|سود|حقوق|یارانه|کارمزد|جریمه|قسط|بستانکار|مدیون)/;
const KEY_IN = /(واریز|افزایش|دریافت|برگشت|سود|حقوق|یارانه|بستانکار)/;

// کلیدهایی که واقعاً در پیامکِ بانک می‌آیند (برای شمارشِ «کلید: مقدار»ها)
const KEY_ANY = /(?:^|[\s\n])(برداشت|واریز|انتقال|خرید|پرداخت|مبلغ|مانده|موجودی|حساب|کارت|شماره|شبا|سپرده|از طریق|طریق|تاریخ|ساعت|نوع)\s*[:：]/g;

// پیامکِ ساختاریافته: دو «کلید: مقدار» یا بیشتر (حتی در یک خط)
export function isStructured(m) {
  let n = 0;
  for (const l of String(m || '').split('\n')) if (KV_LINE.test(l.trim())) n++;
  if (n >= 2) return true;
  const hits = String(m || '').match(KEY_ANY);
  return !!hits && hits.length >= 2;
}

function parseValueAmount(val) {
  const v = String(val || '');
  const nm = v.match(/(\d[\d,]*(?:\.\d+)?)/);
  if (!nm) return null;
  const n = Number(nm[1].replace(/,/g, ''));
  if (!isFinite(n) || n <= 0) return null;
  const cm = v.slice(nm.index + nm[1].length).match(/^\s*(میلیارد|میلیون|هزار)?\s*(ریال|تومان|تومن)/);
  return toToman(n, cm && cm[2] ? cm[2] : '', cm && cm[1] ? cm[1] : '');
}

// علامتِ چسبیده به مبلغ: «2,362,500-» یعنی برداشت، «30,000,000+» یعنی واریز
function amountSign(m) {
  const t = String(m || '').trim();
  if (/[\d,]\+(?!\d)/.test(t)) return '+';
  if (/[\d,]-(?![\d*\s])/.test(t)) return '-';
  // بلوبانک و چند بانک دیگر علامت را اولِ پیامک می‌گذارند: «+۴٬۵۰۰٬۰۲۸ ریال»
  const lead = t.match(/^(?:[^\d\n]{0,12})?([+-])[ \t]*[\d۰-۹٠-٩٬,]/m);
  if (lead) return lead[1];
  return '';
}

// قالبِ «کلید: مقدار» (ملی، تجارت و…) → یک ردیف
function parseStructured(m) {
  const lines = String(m).split('\n').map((l) => l.trim()).filter(Boolean);
  let amount = 0, type = '', noteKey = '', acctDigits = '', channel = '', date = '', time = '';
  for (const l of lines) {
    // مهرِ کوتاهِ ملی («0810-21:55» = ماه/روز-ساعت) قبل از هر چیز: خودش «:» دارد و با کلید:مقدار قاطی می‌شود
    const short = l.match(/^(\d{2})(\d{2})\s*[-/]\s*(\d{1,2}):(\d{2})$/);
    if (short) {
      if (!date) date = shortJalaliDate(short[1], short[2]);
      if (!time) time = String(Number(short[3])).padStart(2, '0') + ':' + short[4];
      continue;
    }
    const mm = l.match(KV_LINE);
    // کلید باید حرف داشته باشد؛ «0810-21:55» یا «18:36» خطِ کلید:مقدار نیست
    if (!mm || !/[\u0600-\u06FFa-z]/i.test(mm[1])) {
      const d = extractDate(l);
      if (d && !date) date = d;
      const t = extractTime(l);
      if (t && !time) time = t;
      // خطِ بی‌رقمِ اولِ پیامک گاهی خودِ شرح است: «کارت به کارت»
      if (!date && !time && !noteKey && !/\d/.test(l) && BARE_NOTE_RE.test(l)) { noteKey = unglue(cleanChannel(l)); continue; }
      // خطِ «مبلغِ تنها»: «-500,000 ریال» یا «+4,500,028 ریال» (بلوبانک و بانک دی)
      if (!amount && /^[+-]?\s*[\d۰-۹٠-٩][\d۰-۹٠-٩٬,]*(\s*(ریال|تومان|تومن))?\s*$/.test(l)) {
        const p = parseValueAmount(l);
        if (p) {
          amount = p.amount;
          const sg = amountSign(l);
          type = sg === '+' ? 'in' : sg === '-' ? 'out' : type;
        }
      }
      continue;
    }
    const key = normText(mm[1]).replace(/\s+/g, ' ').trim();
    const val = mm[2].trim();
    if (KEY_BAL.test(key)) continue;                        // مانده/موجودی تراکنش نیست
    if (KEY_ACC.test(key)) {
      const d = val.replace(/\D/g, '');
      if (d.length >= 4) acctDigits = d.slice(-4);
      continue;
    }
    if (/تاریخ/.test(key)) { const d = extractDate(val); if (d && !date) date = d; const t2 = extractTime(val); if (t2 && !time) time = t2; continue; }
    if (/(ساعت|زمان)/.test(key)) { const t = extractTime(val); if (t && !time) time = t; continue; }
    if (KEY_DESC.test(key)) {
      const v = cleanChannel(val);
      if (v && !noteKey) noteKey = v;
      else if (v && !channel) channel = v;
      continue;
    }
    if (KEY_KIND.test(key)) {
      // «نوع عملیات: برداشت» → جهت و یادداشت؛ وگرنه همان کانال است
      if (KEY_TX.test(val)) {
        if (!noteKey) noteKey = unglue(cleanChannel(val) || val);
        if (!type) type = KEY_IN.test(val) ? 'in' : 'out';
      } else if (!channel) channel = cleanChannel(val);
      continue;
    }
    if (KEY_AMT.test(key)) {
      if (!amount) {
        const p = parseValueAmount(val);
        if (p) {
          amount = p.amount;
          const sign = amountSign(val);
          if (sign) type = sign === '+' ? 'in' : 'out';
        }
      }
      continue;
    }
    if (KEY_CH.test(key)) { if (!channel) channel = cleanChannel(val); continue; }
    if (KEY_TX.test(key) && !SKIP_RE.test(key)) {
      if (amount) continue;                                 // اولین خطِ پولی همان تراکنش است
      const p = parseValueAmount(val);
      if (!p) continue;
      amount = p.amount;
      const sign = amountSign(val);
      type = sign === '+' ? 'in' : sign === '-' ? 'out' : KEY_IN.test(key) ? 'in' : 'out';
      // «واریز به حساب: …» یا «برداشت از کارت: …» → همان «واریز»/«برداشت»
      noteKey = unglue(key).replace(/\s+(به|از)\s+(حساب|کارت|سپرده|شما)\s*$/, '');
      continue;
    }
    // «کدشعبه: 3001» و مانند آن: نه مبلغ است نه شرح
  }
  if (!(amount > 0)) return null;
  if (!type) type = amountSign(m) === '+' ? 'in' : KEY_IN.test(noteKey) ? 'in' : 'out';
  const acct = findAccount(m);
  const last4 = acctDigits || acct.last4;
  const bank = acct.name ? acct.name.replace(/^بانک\s+/, '') : '';
  let note = noteKey || (type === 'in' ? 'واریز' : 'برداشت');
  if (channel && !note.includes(channel)) note = note + ' (' + channel + ')';
  note = note.slice(0, 48);
  return {
    type: type || 'out',
    kind: '',
    amount,
    cat: guessCat(type || 'out', note),
    note,
    account: [bank, last4].filter(Boolean).join(' '),
    date: date || extractDate(m) || todayISO(),
    time: time || extractTime(m),
    qty: 0,
    unit: '',
    unitPrice: 0,
    lines: [],
  };
}

// چند پیامکِ «تراکنش‌دار» در متن هست؟ (برای تصمیمِ پارسرِ محلی یا هوش مصنوعی)
export function countTxBlocks(text) {
  let n = 0;
  for (const m of splitMessages(text)) {
    if (SKIP_RE.test(m) || !/\d/.test(m)) continue;
    if (/(مانده|موجودی)/.test(m) && !KEY_TX.test(m)) continue;
    if (CUR_RE.test(m) || /[\d,]{4,}\s*[+-](?!\d)/.test(m) || KEY_TX.test(m)) n++;
  }
  return n;
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
  // پیامک‌های «کلید: مقدار» بانک‌ها دقیق‌تر با پارسرِ ساختاریافته خوانده می‌شوند
  const structured = isStructured(m) ? parseStructured(m) : null;
  if (structured) return structured;
  // نه کلمهٔ پولی دارد نه علامتِ +/- → اطلاعیه است، نه تراکنش (مانده/شمارهٔ حساب و…)
  if (!KEY_TX.test(m) && !OUT_RE.test(m) && !IN_RE.test(m) && !amountSign(m) && !/\s(مبلغ|amount)\s*[:：]/.test(' ' + m)) return null;
  const amt = extractAmount(m);
  if (!amt || !(amt.amount > 0)) return null;
  const sign = amountSign(m);
  const type = sign === '+' ? 'in' : sign === '-' ? 'out' : OUT_RE.test(m) && !IN_RE.test(m) ? 'out' : IN_RE.test(m) ? 'in' : 'out';
  const acct = findAccount(m);
  CHANNEL_HINT = '';
  let note = extractNote(m) || (type === 'in' ? 'واریز' : 'برداشت');
  if (CHANNEL_HINT && !note.includes(CHANNEL_HINT)) note = (note + ' (' + CHANNEL_HINT + ')').slice(0, 48);
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
    // تکراری یعنی همان تراکنش با همان ساعت و حساب (دو خریدِ هم‌مبلغ در یک روز جدا هستند)
    const dup = out.some((r) => r.type === row.type && r.amount === row.amount && r.date === row.date && (r.time || '') === (row.time || '') && r.note === row.note && (r.account || '') === (row.account || ''));
    if (dup) continue;
    out.push(row);
  }
  return out;
}
