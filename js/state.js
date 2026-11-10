import { store, setBaseInfo, setBigUnits, setCurDisplay, hmOf } from './utils.js';
import { t, lang } from './i18n.js';
import { curMonthKey, setBookCalendar, monthOfISO, shiftMonth } from './jalali.js';
import { langInfo } from './i18n.js';
import { isEncrypted, isUnlocked, persist as persistEncrypted } from './securestore.js';

export const KEY = 'capital_app_v1';

// ── الگوهای سهم پاکت‌ها (جمع همیشه ۱۰۰) ──
// standard پیش‌فرض همه؛ بقیه پیشنهاد می‌شوند و هرگز خودکار اعمال نمی‌شوند
export const PROFILES = {
  standard: { need: 60, invest: 20, fun: 15, charity: 5 },
  limited: { need: 70, invest: 20, fun: 5, charity: 5 },
  abundant: { need: 60, invest: 25, fun: 10, charity: 5 },
  recovery: { need: 60, invest: 30, fun: 5, charity: 5 },
};
let targetMonth = null;
// ماهی که سهم‌ها برایش خوانده می‌شوند (گزارش ماه‌های قبل با الگوی همان ماه)
export function setTargetMonth(mk) {
  targetMonth = mk || null;
}
export function getTargetMonth() {
  return targetMonth;
}
// الگوی فعال برای یک ماه: آخرین رکورد با fromMK ≤ mk؛ «نقاهت» بعد از تاریخ پایانش به رکورد قبلی برمی‌گردد
export function profileFor(mk) {
  mk = mk || targetMonth || curMonthKey();
  const list = (state && state.profiles) || [];
  let pick = null;
  for (const pr of list) {
    if (!pr || !pr.fromMK || pr.fromMK > mk) continue;
    if (pr.endISO && monthOfISO(pr.endISO) < mk) continue;
    if (!pick || pr.fromMK >= pick.fromMK) pick = pr;
  }
  if (!pick) return { id: 'standard', targets: PROFILES.standard, fromMK: '' };
  const targets = pick.targets && typeof pick.targets === 'object' ? pick.targets : PROFILES[pick.id] || PROFILES.standard;
  return Object.assign({}, pick, { targets });
}
export function targetOf(catId, mk) {
  const pr = profileFor(mk);
  const v = pr.targets[catId];
  return typeof v === 'number' ? v : 0;
}
// ثبت الگو از یک ماه به بعد (ماه‌های قبل دست نمی‌خورند)
export function setProfile(id, fromMK, opts) {
  if (!state.profiles) state.profiles = [];
  fromMK = fromMK || curMonthKey();
  state.profiles = state.profiles.filter((p) => p.fromMK !== fromMK);
  const targets = (opts && opts.targets) || PROFILES[id] || PROFILES.standard;
  state.profiles.push({ id, fromMK, targets, funCap: (opts && opts.funCap) || 0, endISO: (opts && opts.endISO) || '', at: Date.now() });
  monthsCache = null;
}

export const CATS = [
  { id: 'need', get label() { return t('cat.need'); }, color: '#3d8bfd', get target() { return targetOf('need'); }, emoji: '🏠' },
  { id: 'invest', get label() { return t('cat.invest'); }, color: '#22c55e', get target() { return targetOf('invest'); }, emoji: '📈' },
  { id: 'fun', get label() { return t('cat.fun'); }, color: '#f59e0b', get target() { return targetOf('fun'); }, emoji: '🎮' },
  { id: 'charity', get label() { return t('cat.charity'); }, color: '#a78bfa', get target() { return targetOf('charity'); }, emoji: '🤲' },
  { id: 'waste', get label() { return t('cat.waste'); }, color: '#ef4444', target: 0, emoji: '🚨' },
  // پاکت قرض/امانت: جابه‌جایی پول است نه خرج/درآمد واقعی؛ سقف ندارد و در بودجهٔ ماه حساب نمی‌شود
  { id: 'loan', get label() { return t('cat.loan'); }, color: '#14b8a6', target: 0, emoji: '🤝', loan: true },
];

export const LOAN_CAT = 'loan';

// آیا این تراکنش (یا قلم فاکتور) مربوط به پاکت قرض است؟
export function isLoanTx(t) {
  return !!(t && t.cat === LOAN_CAT && !isTransfer(t));
}
// سهم سود روی تراکنشِ برگشت طلب (پاکت قرض، نوع in): درآمد واقعی است — به تومان
export function txInterestToman(t) {
  if (!t || t.type !== 'in' || !isLoanTx(t) || !(t.interest > 0)) return 0;
  const a = accountById(t.accountId);
  return Math.min(t.interest, t.amount || 0) * rateOf(a ? a.currency : baseCur());
}

export const catById = (id) => CATS.find((c) => c.id === id);
export const ACCT_TYPES = ['کارت بانکی', 'نقدی', 'ارز دیجیتال', 'کیف پول آنلاین', 'سایر'];

// مؤسسه‌های پیشنهادی برای گروه‌بندی حساب‌ها (کاربر می‌تواند هر نام دیگری بنویسد)
export const KNOWN_BANKS = [
  'بانک ملت', 'بانک ملی', 'بانک صادرات', 'بانک تجارت', 'بانک سپه', 'بانک کشاورزی', 'بانک مسکن',
  'بانک رفاه', 'بانک پاسارگاد', 'بانک سامان', 'بانک پارسیان', 'بانک اقتصاد نوین', 'بانک آینده',
  'بانک شهر', 'بانک دی', 'بانک سینا', 'بانک گردشگری', 'بانک خاورمیانه', 'بانک ایران‌زمین',
  'بانک کارآفرین', 'بانک سرمایه', 'بانک توسعه تعاون', 'پست بانک', 'بانک قرض‌الحسنه رسالت', 'بانک قرض‌الحسنه مهر ایران',
  'بلوبانک', 'ویپاد', 'بانکینو',
  'نوبیتکس', 'والکس', 'تبدیل', 'رمزینکس', 'اکسیر', 'بیت‌پین', 'کوینکس', 'بایننس', 'اوکی‌اکس', 'کوکوین',
  'کیف پول سخت‌افزاری', 'تراست والت', 'متامسک',
  'نقد', 'صرافی', 'خانه',
];

// حساب‌ها گروه‌بندی‌شده بر اساس مؤسسه: [{key,label,accts}] (بدون مؤسسه در آخر)
// حساب‌های فعال (بایگانی‌نشده) — فهرست‌ها و انتخاب‌گرها فقط این‌ها را نشان می‌دهند
export function activeAccounts() {
  return state.accounts.filter((a) => !a.archived);
}
export function archivedAccounts() {
  return state.accounts.filter((a) => a.archived);
}

export function accountGroups(list) {
  const accts = list || activeAccounts();
  const groups = new Map();
  for (const a of accts) {
    const k = institutionOf(a) || '__none';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  const keys = [...groups.keys()].sort((x, y) => {
    if (x === '__none') return 1;
    if (y === '__none') return -1;
    return x.localeCompare(y, 'fa');
  });
  return keys.map((k) => ({ key: k, label: k === '__none' ? 'سایر' : k, accts: groups.get(k) }));
}

// <option>های select حساب، دسته‌بندی‌شده با <optgroup> بر اساس مؤسسه
export function accountOptGroups(selectedId, list) {
  const escq = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  // حساب بایگانی‌شده فقط اگر همین الان انتخاب‌شده باشد (ویرایش تراکنش قدیمی) در فهرست می‌ماند
  if (!list && selectedId) { const sel = accountById(selectedId); if (sel && sel.archived) list = [...activeAccounts(), sel]; }
  const gs = accountGroups(list);
  if (gs.length <= 1 && gs[0] && gs[0].key === '__none') {
    return gs[0].accts
      .map((a) => `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${escq(a.name)} · ${escq(curName(a.currency))}</option>`)
      .join('');
  }
  return gs
    .map(
      (g) =>
        `<optgroup label="${escq(g.label)}">` +
        g.accts
          .map((a) => `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${escq(a.name)} · ${escq(curName(a.currency))}</option>`)
          .join('') +
        `</optgroup>`
    )
    .join('');
}

export function institutionOf(a) {
  return (a && a.bank && String(a.bank).trim()) || '';
}

// آیکون گروه بر اساس نوع غالب حساب‌ها
export function institutionIcon(accts) {
  const types = accts.map((x) => x.type);
  if (types.every((t) => t === 'ارز دیجیتال')) return '🪙';
  if (types.every((t) => t === 'نقدی')) return '💵';
  if (types.every((t) => t === 'کیف پول آنلاین')) return '📱';
  return '🏦';
}
// کاتالوگ ارزها: نام فارسی (کلید ذخیره‌شده)، کد ISO، نماد، رقم اعشار، «بزرگ‌واحد» (هزار/میلیون به‌جای K/M)
export const CURRENCY_INFO = {
  'تومان': { code: 'TMN', symbol: 'ت', dec: 0, big: true },
  'ریال': { code: 'IRR', symbol: 'ریال', dec: 0, big: true },
  'دلار': { code: 'USD', symbol: '$', dec: 2 },
  'یورو': { code: 'EUR', symbol: '€', dec: 2 },
  'پوند': { code: 'GBP', symbol: '£', dec: 2 },
  'درهم': { code: 'AED', symbol: 'AED', dec: 2 },
  'لیر': { code: 'TRY', symbol: '₺', dec: 2 },
  'ین': { code: 'JPY', symbol: '¥', dec: 0 },
  'یوان': { code: 'CNY', symbol: '¥', dec: 2 },
  'روبل': { code: 'RUB', symbol: '₽', dec: 2 },
  'روپیه': { code: 'INR', symbol: '₹', dec: 2 },
  'دلار کانادا': { code: 'CAD', symbol: 'C$', dec: 2 },
  'دلار استرالیا': { code: 'AUD', symbol: 'A$', dec: 2 },
  'فرانک': { code: 'CHF', symbol: 'CHF', dec: 2 },
  'دینار عراق': { code: 'IQD', symbol: 'IQD', dec: 0, big: true },
  'افغانی': { code: 'AFN', symbol: '؋', dec: 2 },
  'منات': { code: 'AZN', symbol: '₼', dec: 2 },
  'درام': { code: 'AMD', symbol: '֏', dec: 0 },
  'ریال عمان': { code: 'OMR', symbol: 'OMR', dec: 3 },
  'ریال قطر': { code: 'QAR', symbol: 'QAR', dec: 2 },
  'ریال سعودی': { code: 'SAR', symbol: 'SAR', dec: 2 },
  'دینار کویت': { code: 'KWD', symbol: 'KWD', dec: 3 },
  'تتر': { code: 'USDT', symbol: '₮', dec: 2 },
  'بیت‌کوین': { code: 'BTC', symbol: '₿', dec: 8 },
  'اتریوم': { code: 'ETH', symbol: 'Ξ', dec: 6 },
  'طلا (گرم)': { code: 'XAU', symbol: 'گرم', dec: 3 },
};
export const CURRENCIES = [...Object.keys(CURRENCY_INFO), 'سایر'];
export function currencyInfo(cur) {
  return CURRENCY_INFO[cur] || { code: cur, symbol: cur, dec: 2 };
}
// نام نمایشی واحد پول: در فارسی همان نام؛ در زبان‌های دیگر کد (USD, TMN…)
export function curName(cur) {
  if (!cur) return '';
  if (lang() === 'fa') return cur;
  const i = CURRENCY_INFO[cur];
  return i ? i.code : cur;
}
setCurDisplay(curName);
export const DEFAULT_BASE = 'تومان';
export function baseCur() {
  return (state && state.baseCurrency) || DEFAULT_BASE;
}
// آیا این ارز از خانوادهٔ «بزرگ‌واحد» است (هزار/میلیون به‌جای K/M)
export function isBigUnit(cur) {
  return !!currencyInfo(cur || baseCur()).big;
}

export function defaultState() {
  return {
    accounts: [],
    transactions: [],
    investments: [],
    debts: [],
    installments: [],
    budgets: {},
    rates: {},
    baseCurrency: DEFAULT_BASE,
    calendar: 'jalali',
    bookId: '',
    titleMap: {},
    titleGroups: {},
    titleNo: [],
    titleGroupsAt: 0,
    health: {},
    customSubs: [],
    profiles: [],
    reflect: {},
    customCurrencies: [],
    updatedAt: 0,
    rev: 0,
  };
}

function loadState() {
  // حالت رمزشده: داده بعد از بازکردن قفل تزریق می‌شود
  if (isEncrypted()) return defaultState();
  try {
    const s = store.get(KEY);
    if (s) return Object.assign(defaultState(), JSON.parse(s));
  } catch (e) {}
  // کاربر تازه: تقویم دفتر از زبان دستگاه
  const fresh = defaultState();
  fresh.calendar = langInfo().cal === 'gregorian' ? 'gregorian' : 'jalali';
  return fresh;
}
export function bookCal() {
  return state.calendar || 'jalali';
}

export let state = loadState();
syncBase();
export function syncBase() {
  setBookCalendar(state.calendar || 'jalali');
  // کلید ماه تراکنش‌ها همیشه بر اساس تقویم همین دفتر (پس از تغییر دفتر/ادغام قدیمی)
  for (const t of state.transactions || []) {
    if (t.dateISO) {
      const mk = monthOfISO(t.dateISO);
      if (t.month !== mk) t.month = mk;
    }
  }
  backfillTxTime();
  setBaseInfo(baseCur(), currencyInfo(baseCur()));
  setBigUnits(new Set(Object.keys(CURRENCY_INFO).filter((c) => CURRENCY_INFO[c].big)));
}

let onSave = () => {};
export function setOnSave(fn) {
  onSave = fn;
}

export function persistLocal() {
  if (isEncrypted()) {
    if (isUnlocked()) persistEncrypted(state);
    return;
  }
  store.set(KEY, JSON.stringify(state));
}

export function touchMeta() {
  state.updatedAt = Date.now();
  state.rev = (state.rev || 0) + 1;
}

// ساعت تراکنش: اگر ثبت نشده، از زمان آخرین ذخیره‌اش ثابت می‌شود تا ترتیب داخل روز با ویرایش‌های بعدی جابه‌جا نشود
export function backfillTxTime() {
  for (const t of state.transactions || []) {
    if (!t.time) t.time = hmOf(t.updatedAt || Date.now());
  }
}

export function save() {
  backfillTxTime();
  touchMeta();
  monthsCache = null;
  clearRefundCache();
  persistLocal();
  onSave();
}

export function replaceState(next, { markDirty } = {}) {
  state = Object.assign(defaultState(), next);
  monthsCache = null;
  clearRefundCache();
  syncBase();
  if (markDirty) touchMeta();
  persistLocal();
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('cap:stateReplaced'));
}

export function accountById(id) {
  return state.accounts.find((a) => a.id === id);
}

// همه واحدهای پول قابل انتخاب: پیش‌فرض‌ها + واحدهای دستی + هر واحدی که قبلاً استفاده شده
export function allCurrencies() {
  const set = new Set([baseCur(), ...CURRENCIES.filter((c) => c !== 'سایر')]);
  for (const c of state.customCurrencies || []) if (c) set.add(c);
  for (const a of state.accounts) if (a.currency) set.add(a.currency);
  for (const i of state.investments) if (i.currency) set.add(i.currency);
  return [...set];
}

export function addCustomCurrency(name) {
  if (!name) return;
  if (!state.customCurrencies) state.customCurrencies = [];
  if (!allCurrencies().includes(name)) state.customCurrencies.push(name);
}

// نرخ یک ارز نسبت به واحد پایه (چند واحد پایه = ۱ واحد این ارز)
export function rateOf(cur) {
  return !cur || cur === baseCur() ? 1 : state.rates[cur] || 0;
}

// تغییر واحد پایه: همهٔ نرخ‌ها با نرخِ واحد جدید بازمحاسبه می‌شوند؛ بودجه‌ها تبدیل می‌شوند.
// newRate = چند واحدِ پایهٔ فعلی = ۱ واحدِ جدید (اگر قبلاً نرخ داشته باشد از همان استفاده می‌شود)
export function changeBaseCurrency(next, newRate) {
  const cur = baseCur();
  if (!next || next === cur) return false;
  const r = Number(newRate) || state.rates[next] || 0;
  if (!(r > 0)) return false;
  const rates = {};
  const tidy = (x) => Number(x.toPrecision(10));
  for (const [c, v] of Object.entries(state.rates || {})) if (c !== next && v > 0) rates[c] = tidy(v / r);
  rates[cur] = tidy(1 / r);
  delete rates[next];
  state.rates = rates;
  for (const mk of Object.keys(state.budgets || {})) {
    const b = state.budgets[mk];
    if (b && b.amount) b.amount = tidy(b.amount / r);
  }
  addCustomCurrency(next);
  state.baseCurrency = next;
  syncBase();
  return true;
}

export function isTransfer(t) {
  return t.type === 'transferIn' || t.type === 'transferOut';
}

// نمایشِ کاربر: هر انتقال فقط یک ردیف — طرف مقصد و تراکنش کارمزدِ متصل (nobal) در آن گرد می‌آیند
export function displayTxs(list) {
  const pairWithOut = new Set();
  for (const t of list) if (t.pair && t.type === 'transferOut') pairWithOut.add(t.pair);
  return list.filter((t) => !(t.pair && pairWithOut.has(t.pair) && t.type !== 'transferOut'));
}

export function isInvoice(t) {
  return !!(t && t.kind === 'invoice' && t.lines && t.lines.length);
}

// ── برگشتِ پولِ یک خرید ───────────────────────────────────────────────────
// خریدی که فروشنده پولش را پس داده، خرجِ واقعی نبوده؛ ولی خودِ پولِ برگشتی یک حرکتِ
// واقعیِ حساب است. پس سندِ برگشت یک تراکنشِ «ورودی» با refundOf به خریدِ اصلی است:
//   • موجودیِ حسابِ مقصد را زیاد می‌کند (accountCurrent خودش جمع می‌زند)
//   • درآمد نیست (از incomeIn بیرون است) و به هیچ پاکتی نمی‌رود (cat ندارد)
//   • فقط به همان اندازه‌ای که پول برگشته، از اثرِ خریدِ اصلی کم می‌کند (spendRatio)
let refundCache = null;
let refundCacheKey = '';
export function clearRefundCache() { refundCache = null; refundCacheKey = ''; }
function refundIndex() {
  const key = state.updatedAt + ':' + state.transactions.length;
  if (refundCache && refundCacheKey === key) return refundCache;
  const m = new Map();
  for (const t of state.transactions) {
    if (!t || !t.refund || t.type !== 'in' || !t.refundOf) continue;
    const e = m.get(t.refundOf) || { toman: 0, txs: [] };
    const a = accountById(t.accountId);
    e.toman += (t.amount || 0) * rateOf(a ? a.currency : baseCur());
    e.txs.push(t);
    m.set(t.refundOf, e);
  }
  refundCache = m;
  refundCacheKey = key;
  return m;
}
// سندِ برگشتِ پول (نه درآمد، نه انتقال): با آیکن و برچسبِ خودش نشان داده می‌شود
export function isRefundTx(t) { return !!(t && t.refund && t.type === 'in'); }
// جمعِ برگشت‌های یک خرید (به تومان) به‌همراهِ سندشان
export function refundsOf(t) {
  return refundIndex().get(t && t.id) || { toman: 0, txs: [] };
}
export function refundedToman(t) { return refundsOf(t).toman; }
// مبلغِ برگشت‌خورده به پولِ خودِ تراکنش (برای نمایش کنارِ همان ردیف)
export function refundedInTxUnit(t) {
  const a = accountById(t && t.accountId);
  const rate = rateOf(a ? a.currency : baseCur());
  return rate ? refundedToman(t) / rate : 0;
}
// این خرید دیگر خرج حساب می‌شود؟ (کاملاً برگشت خورده = نه)
export function isReversed(t) {
  if (!t || t.type !== 'out' || isTransfer(t) || isLoanTx(t)) return false;
  const r = refundedToman(t);
  return r > 0 && r >= txAmountToman(t) - 0.5;
}
// چه کسری از این خرج هنوز سرِ جایش است (برگشتِ جزئی = کمتر از یک)
export function spendRatio(t) {
  if (!t || t.type !== 'out' || isTransfer(t) || isLoanTx(t)) return 1;
  const total = txAmountToman(t);
  if (!(total > 0)) return 1;
  const r = refundedToman(t);
  if (!(r > 0)) return 1;
  return Math.max(0, Math.min(1, 1 - r / total));
}

export function txAmountToman(t) {
  const a = accountById(t.accountId);
  return (t.amount || 0) * rateOf(a ? a.currency : baseCur());
}

export function accountCurrent(a) {
  let b = a.initial || 0;
  for (const t of state.transactions) {
    if (t.accountId !== a.id) continue;
    if (t.nobal) continue; // کارمزد انتقال: فقط در هزینه‌های جیب شمرده می‌شود، نه موجودی حساب
    b += t.type === 'in' || t.type === 'transferIn' ? t.amount : -t.amount;
  }
  return b;
}

export function accountCurrentToman(a) {
  return accountCurrent(a) * rateOf(a.currency);
}

export function cashTotal() {
  return activeAccounts().reduce((s, a) => s + accountCurrentToman(a), 0);
}

export function investValue(inv) {
  return (inv.qty || 0) * (inv.cur || 0);
}

export function investValueToman(inv) {
  return investValue(inv) * rateOf(inv.currency);
}

export function investTotal() {
  return state.investments.reduce((s, i) => s + investValueToman(i), 0);
}

export function investProfit(inv) {
  return investValue(inv) - (inv.qty || 0) * (inv.buy || 0);
}

export function sortTxs(txs) {
  return txs.slice().sort((a, b) => {
    const d = (b.dateISO || '').localeCompare(a.dateISO || '');
    if (d) return d;
    const h = String(b.time || hmOf(b.updatedAt || 0)).localeCompare(String(a.time || hmOf(a.updatedAt || 0)));
    if (h) return h;
    const ta = b.updatedAt || 0;
    const tb = a.updatedAt || 0;
    if (ta !== tb) return ta - tb;
    return String(b.id || '').localeCompare(String(a.id || ''));
  });
}

export function txDelta(t) {
  return (t.type === 'in' || t.type === 'transferIn' ? 1 : -1) * (t.amount || 0);
}

// موجودی هر حساب درست بعد از همان تراکنش (از قدیم به جدید)
export function runningBalanceByTxId() {
  const bal = {};
  for (const a of state.accounts) bal[a.id] = a.initial || 0;
  const after = {};
  const chrono = sortTxs(state.transactions).reverse();
  for (const t of chrono) {
    if (!t.accountId || t.nobal) continue;
    if (bal[t.accountId] == null) bal[t.accountId] = 0;
    bal[t.accountId] += txDelta(t);
    after[t.id] = bal[t.accountId];
  }
  return after;
}

// خرج واقعی ماه — بدون تراکنش‌های قرض (و بدون اقلامِ قرض در فاکتورها) و بدون
// بخشی از خرید که پولش برگشته است
export function spentIn(mk) {
  let s = 0;
  for (const t of state.transactions) {
    if (t.month !== mk || t.type !== 'out') continue;
    const keep = spendRatio(t);
    if (!keep) continue;
    if (isInvoice(t)) {
      const rate = rateOf(accountById(t.accountId)?.currency);
      for (const line of t.lines) if (line.cat !== LOAN_CAT) s += (line.amount || 0) * rate * keep;
    } else if (!isLoanTx(t)) {
      s += txAmountToman(t) * keep;
    }
  }
  return s;
}

// گردش پاکت قرض در ماه: داده‌شده (out) و گرفته‌شده/برگشتی (in)
export function loanFlow(mk) {
  let out = 0;
  let inn = 0;
  for (const t of state.transactions) {
    if (t.month !== mk || isTransfer(t)) continue;
    if (t.type === 'out') {
      if (isInvoice(t)) {
        const rate = rateOf(accountById(t.accountId)?.currency);
        for (const line of t.lines) if (line.cat === LOAN_CAT) out += (line.amount || 0) * rate;
      } else if (isLoanTx(t)) out += txAmountToman(t);
    } else if (t.type === 'in' && isLoanTx(t)) {
      inn += txAmountToman(t) - txInterestToman(t);
    }
  }
  return { out, in: inn, net: inn - out };
}

export function budgetOf(mk) {
  return (state.budgets[mk] && state.budgets[mk].amount) || 0;
}

export function catSpent(mk, catId) {
  let s = 0;
  for (const t of state.transactions) {
    if (t.month !== mk || t.type !== 'out') continue;
    const keep = spendRatio(t);
    if (!keep) continue;
    if (isInvoice(t)) {
      for (const line of t.lines) {
        if (line.cat === catId) s += (line.amount || 0) * rateOf(accountById(t.accountId)?.currency) * keep;
      }
    } else if (t.cat === catId) {
      s += txAmountToman(t) * keep;
    }
  }
  return s;
}

export function pocketItems(mk, catId) {
  const items = [];
  for (const t of state.transactions) {
    if (t.month !== mk || isTransfer(t)) continue;
    if (t.type === 'in') {
      if (catId === LOAN_CAT && isLoanTx(t))
        items.push({
          txId: t.id,
          amount: (t.amount || 0) - Math.min(t.interest > 0 ? t.interest : 0, t.amount || 0),
          title: t.note || 'قرض گرفته/برگشت طلب',
          dateISO: t.dateISO,
          accountId: t.accountId,
          invoice: false,
          inflow: true,
        });
      continue;
    }
    if (t.type !== 'out') continue;
    const keep = spendRatio(t);
    if (isInvoice(t)) {
      for (const line of t.lines) {
        if (line.cat !== catId) continue;
        items.push({
          txId: t.id,
          amount: (line.amount || 0) * keep,
          title: line.name || 'قلم فاکتور',
          dateISO: t.dateISO,
          accountId: t.accountId,
          invoice: true,
          gross: line.amount || 0,
          refunded: keep < 1 ? (line.amount || 0) * (1 - keep) : 0,
          reversed: keep === 0,
        });
      }
    } else if (t.cat === catId) {
      items.push({
        txId: t.id,
        amount: (t.amount || 0) * keep,
        title: t.note || (catById(catId) ? catById(catId).label : 'خرج'),
        dateISO: t.dateISO,
        accountId: t.accountId,
        invoice: false,
        gross: t.amount || 0,
        refunded: keep < 1 ? (t.amount || 0) * (1 - keep) : 0,
        reversed: keep === 0,
      });
    }
  }
  return items.sort((a, b) => String(b.dateISO || '').localeCompare(String(a.dateISO || '')));
}

// سهم پایهٔ پاکت از بودجهٔ همین ماه (بدون ماندهٔ قبلی)
export function catShare(mk, catId) {
  const target = targetOf(catId, mk);
  let share = Math.round((budgetOf(mk) * target) / 100);
  // سقف تومانیِ تفریح (الگوی «فراوان»)
  if (catId === 'fun') {
    const cap = profileFor(mk).funCap || 0;
    if (cap > 0 && share > cap) share = cap;
  }
  return share;
}
// سقف انباشت تفریح: حداکثر ۳ برابر سهم ماه (بیشتر از آن دیگر تفریح نیست)
export const FUN_CARRY_MONTHS = 3;
// سقف پاکت = سهم این ماه + ماندهٔ همان پاکت از ماه‌های قبل
export function catCeiling(mk, catId) {
  const m = computeMonths()[mk];
  const carried = (m && m.carriedCats && m.carriedCats[catId]) || 0;
  return catShare(mk, catId) + carried;
}
export function catCarried(mk, catId) {
  const m = computeMonths()[mk];
  return (m && m.carriedCats && m.carriedCats[catId]) || 0;
}

// درآمد واقعی ماه — بدون پول قرضی/برگشتی و بدون سندِ برگشتِ خرید
export function incomeIn(mk) {
  return state.transactions
    .filter((t) => t.month === mk && t.type === 'in' && !isTransfer(t) && !isRefundTx(t))
    .reduce((s, t) => s + (isLoanTx(t) ? txInterestToman(t) : txAmountToman(t)), 0);
}

export function allMonthKeys() {
  const set = new Set([curMonthKey()]);
  for (const t of state.transactions) if (t.month) set.add(t.month);
  for (const k of Object.keys(state.budgets)) set.add(k);
  // ماه‌های خالیِ بین اولین و آخرین کلید هم وارد زنجیره می‌شوند تا ماندهٔ پاکت‌ها ماهی را نپَرد
  const sorted = [...set].sort();
  const out = [];
  for (let k = sorted[0], i = 0; k <= sorted[sorted.length - 1] && i < 240; k = shiftMonth(k, 1), i++) out.push(k);
  return out;
}

// ماندهٔ هر ماه به تفکیک پاکت به ماه بعد می‌رود: ماندهٔ «آزادی مالی» فقط سقف
// «آزادی مالی» ماه بعد را بالا می‌برد، نه کل بودجه. جمع مانده‌ها همان «مانده قبلی» است.
let monthsCache = null;
let monthsCacheKey = '';
export function invalidateMonths() {
  monthsCache = null;
}
// توزیع کسری به تناسب درصد سهم روی پاکت‌های دارای مانده؛ سهمِ پاکتی که مانده‌اش
// تمام شد، به تناسب بین بقیه بازتوزیع می‌شود (Σ خروجی = max(0, Σ مانده − کسری)).
function absorbDeficit(left, deficit, cats) {
  const out = Object.assign({}, left);
  let rest = Math.round(deficit);
  for (let guard = 0; rest > 0 && guard < 10; guard++) {
    const alive = cats.filter((c) => (out[c.id] || 0) > 0);
    if (!alive.length) break;
    const shareSum = alive.reduce((a, c) => a + c.target, 0) || 1;
    let taken = 0;
    for (const c of alive) {
      const want = Math.round((rest * c.target) / shareSum);
      const take = Math.min(out[c.id], want);
      out[c.id] -= take;
      taken += take;
      if (out[c.id] <= 0) delete out[c.id];
    }
    if (!taken) break;
    rest -= taken;
  }
  return out;
}
function mergeProfiles(a, b) {
  const m = {};
  for (const p of [...(a || []), ...(b || [])]) {
    if (!p || !p.fromMK) continue;
    if (!m[p.fromMK] || (p.at || 0) > (m[p.fromMK].at || 0)) m[p.fromMK] = p;
  }
  return Object.values(m).sort((x, y) => (x.fromMK < y.fromMK ? -1 : 1));
}
export function computeMonths() {
  const key = state.updatedAt + ':' + state.transactions.length + ':' + Object.keys(state.budgets).length + ':' + ((state.profiles || []).length);
  if (monthsCache && monthsCacheKey === key) return monthsCache;
  const keys = allMonthKeys();
  const cats = CATS.filter((c) => !c.loan && c.id !== 'waste');
  let carriedCats = {};
  const res = {};
  const prevTM = targetMonth;
  for (const k of keys) {
    targetMonth = k;
    const budget = (state.budgets[k] && state.budgets[k].amount) || 0;
    const spent = spentIn(k);
    const income = incomeIn(k);
    let carried = 0;
    for (const c of cats) carried += carriedCats[c.id] || 0;
    const available = budget + carried;
    const remaining = available - spent;
    res[k] = { budget, carriedIn: carried, carriedCats, spent, income, available, remaining };
    // ماندهٔ هر پاکت؛ کسری پاکت‌های ردشده + هدررفت (سقف صفر) به تناسب سهم از همهٔ
    // مانده‌های مثبت کم می‌شود تا جمعِ منتقل‌شده هرگز از باقیماندهٔ واقعی ماه بیشتر نشود.
    const next = {};
    let deficit = 0;
    for (const c of cats) {
      const ceil = catShare(k, c.id) + (carriedCats[c.id] || 0);
      const left = ceil - catSpent(k, c.id);
      if (left > 0) next[c.id] = left;
      else deficit += -left;
    }
    deficit += catSpent(k, 'waste');
    carriedCats = absorbDeficit(next, deficit, cats);
    // سقف انباشت تفریح
    const funCap = catShare(k, 'fun') * FUN_CARRY_MONTHS;
    if (budget > 0 && carriedCats.fun > funCap) carriedCats.fun = funCap;
  }
  targetMonth = prevTM;
  monthsCache = res;
  monthsCacheKey = key;
  return res;
}

export function curStats() {
  return (
    computeMonths()[curMonthKey()] || {
      budget: 0,
      carriedIn: 0,
      carriedCats: {},
      spent: 0,
      income: 0,
      available: 0,
      remaining: 0,
    }
  );
}

export function hasLocalData(s = state) {
  return (
    !!s.bookId ||
    (s.accounts && s.accounts.length) ||
    (s.transactions && s.transactions.length) ||
    (s.investments && s.investments.length) ||
    (s.debts && s.debts.length) ||
    (s.installments && s.installments.length) ||
    Object.keys(s.budgets || {}).length
  );
}

function mergeById(a, b) {
  const map = new Map();
  for (const item of b || []) if (item && item.id) map.set(item.id, item);
  for (const item of a || []) {
    if (!item || !item.id) continue;
    const other = map.get(item.id);
    if (!other) map.set(item.id, item);
    else {
      const lt = item.updatedAt || 0;
      const rt = other.updatedAt || 0;
      map.set(item.id, lt >= rt ? item : other);
    }
  }
  return [...map.values()];
}

function mergeTitleMap(a, b) {
  const out = Object.assign({}, b || {});
  for (const k of Object.keys(a || {})) {
    const x = a[k];
    const y = out[k];
    out[k] = !y || (x.at || 0) >= (y.at || 0) ? x : y;
  }
  return out;
}
export function mergeStates(local, remote) {
  // دفترهای متفاوت (تقویم متفاوت یا شناسهٔ دفتر متفاوت) با هم ادغام نمی‌شوند؛
  // نسخهٔ جدیدتر به‌طور کامل برنده است (مثلاً بعد از «دفتر جدید» روی دستگاه دیگر)
  const lc = local.calendar || 'jalali';
  const rc = remote.calendar || 'jalali';
  const lb = local.bookId || '';
  const rb = remote.bookId || '';
  if (lc !== rc || (lb && rb && lb !== rb)) {
    const win = (local.updatedAt || 0) >= (remote.updatedAt || 0) ? local : remote;
    return Object.assign(defaultState(), JSON.parse(JSON.stringify(win)), {
      rev: Math.max(local.rev || 0, remote.rev || 0),
    });
  }
  return {
    calendar: lc,
    bookId: lb || rb,
    accounts: mergeById(local.accounts, remote.accounts),
    transactions: mergeById(local.transactions, remote.transactions),
    investments: mergeById(local.investments, remote.investments),
    debts: mergeById(local.debts, remote.debts),
    installments: mergeById(local.installments, remote.installments),
    budgets: Object.assign({}, remote.budgets || {}, local.budgets || {}),
    rates: Object.assign({}, remote.rates || {}, local.rates || {}),
    cheers: Object.assign({}, remote.cheers || {}, local.cheers || {}),
    titleMap: mergeTitleMap(local.titleMap, remote.titleMap),
    ...((local.titleGroupsAt || 0) >= (remote.titleGroupsAt || 0) ? { titleGroups: local.titleGroups || {}, titleNo: local.titleNo || [], titleGroupsAt: local.titleGroupsAt || 0 } : { titleGroups: remote.titleGroups || {}, titleNo: remote.titleNo || [], titleGroupsAt: remote.titleGroupsAt || 0 }),
    customSubs: mergeById(local.customSubs, remote.customSubs),
    profiles: mergeProfiles(local.profiles, remote.profiles),
    reflect: ((local.reflect || {}).at || 0) >= ((remote.reflect || {}).at || 0) ? local.reflect || {} : remote.reflect || {},
    health: ((local.health || {}).updatedAt || 0) >= ((remote.health || {}).updatedAt || 0) ? local.health || {} : remote.health || {},
    baseCurrency: local.baseCurrency || remote.baseCurrency || DEFAULT_BASE,
    customCurrencies: [
      ...new Set([...(remote.customCurrencies || []), ...(local.customCurrencies || [])]),
    ],
    updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0),
    rev: Math.max(local.rev || 0, remote.rev || 0),
  };
}

export function fingerprint(s) {
  const copy = Object.assign({}, s);
  delete copy.updatedAt;
  delete copy.rev;
  return JSON.stringify(copy);
}
