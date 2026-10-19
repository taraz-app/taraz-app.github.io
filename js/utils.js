export const FA = '۰۱۲۳۴۵۶۷۸۹';
export const APP_VERSION = '2.38.22';

let faDigits = true;
export function setFaDigits(on) {
  faDigits = !!on;
}
// نام واحدهای بزرگ و جداکنندهٔ اعشار بر اساس زبان
const UNIT_NAMES = { fa: { b: 'میلیارد', m: 'میلیون', k: 'هزار' }, en: { b: 'billion', m: 'million', k: 'thousand' } };
export function unitName(k) {
  return (faDigits ? UNIT_NAMES.fa : UNIT_NAMES.en)[k];
}
export function decSep() {
  return faDigits ? '٫' : '.';
}
export function pctSign() {
  return faDigits ? '٪' : '%';
}
export function toFa(n) {
  return faDigits ? String(n).replace(/\d/g, (d) => FA[d]) : String(n);
}

let hideMoney = false;
try {
  hideMoney = localStorage.getItem('capital_hide_money') === '1';
} catch (e) {}

export function isMoneyHidden() {
  return hideMoney;
}

export function setMoneyHidden(on) {
  hideMoney = !!on;
  try {
    localStorage.setItem('capital_hide_money', hideMoney ? '1' : '0');
  } catch (e) {}
}

// عدد بدون مخفی‌سازی، با جداکنندهٔ هزارگان و اعشار در صورت نیاز (برای نرخ‌ها)
export function fmtPlain(n) {
  n = Number(n) || 0;
  const abs = Math.abs(n);
  const s = abs >= 1000 ? abs.toLocaleString('en-US', { maximumFractionDigits: 2 }) : abs >= 1 ? abs.toLocaleString('en-US', { maximumFractionDigits: 4 }) : abs.toLocaleString('en-US', { maximumFractionDigits: 8 });
  return (n < 0 ? '−' : '') + s.replace('.', decSep());
}
export function fmt(n) {
  if (hideMoney) return '••••';
  n = Number(n) || 0;
  const abs = Math.abs(n);
  let s;
  if (abs >= 1000) {
    // ارقام بزرگ (مثل تومان): بدون اعشار
    s = abs.toLocaleString('en-US', { maximumFractionDigits: 2 });
  } else if (abs >= 1) {
    // ارقام متوسط (مثل دلار): حداکثر ۲ رقم اعشار
    s = abs.toLocaleString('en-US', { maximumFractionDigits: 4 });
  } else if (abs > 0) {
    // ارقام کوچک (مثل بیت‌کوین): تا ۸ رقم اعشار
    s = abs.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
    if (parseFloat(s) === 0) s = '0';
  } else {
    s = '0';
  }
  if (faDigits) s = s.replace(/,/g, '٬').replace('.', '٫');
  return (n < 0 ? '−' : '') + toFa(s);
}

// واحد پایه (از state تزریق می‌شود تا وابستگی چرخه‌ای نباشد)
let baseInfo = { name: 'تومان', big: true, dec: 0 };
export function setBaseInfo(name, info) {
  baseInfo = Object.assign({ name }, info || {});
}
export function baseName() {
  return baseInfo.name;
}
// نمایش نام واحد (در انگلیسی کد ارز)
let curDisplay = (c) => c;
export function setCurDisplay(fn) {
  curDisplay = fn;
}
export function curLabel(c) {
  return curDisplay(c);
}
export function fmtT(n) {
  if (hideMoney) return '••••';
  return fmt(n) + ' ' + curDisplay(baseInfo.name);
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

// ساعت محلی «HH:MM» از یک زمان (پیش‌فرض: الان)
export function hmOf(ts) {
  const d = ts == null ? new Date() : new Date(ts);
  if (isNaN(d)) return '';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
export function nowHM() {
  return hmOf();
}
export function todayISO() {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

export const store = (() => {
  let mem = {};
  let ok = false;
  try {
    localStorage.setItem('__t', '1');
    localStorage.removeItem('__t');
    ok = true;
  } catch (e) {
    ok = false;
  }
  return {
    get(k) {
      const key = k;
      try {
        return ok ? localStorage.getItem(key) : mem[k] ?? null;
      } catch (e) {
        return mem[k] ?? null;
      }
    },
    set(k, v) {
      const key = k;
      try {
        if (ok) localStorage.setItem(key, v);
        else mem[k] = v;
      } catch (e) {
        mem[k] = v;
      }
    },
    // پاک‌کردن همهٔ کلیدهای این برنامه (نسخهٔ تست با پیشوند t_ دست نمی‌خورد)
    clearAll() {
      try {
        if (!ok) { for (const k of Object.keys(mem)) delete mem[k]; return; }
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
        keys.filter((k) => k && k.indexOf('t_') !== 0).forEach((k) => localStorage.removeItem(k));
      } catch (e) {}
    },
    persisted: ok,
  };
})();

export function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  // reflow تا انیمیشن هر بار اجرا شود
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

// بازخورد لمسی خفیف (اگر دستگاه پشتیبانی کند)
export function haptic(ms = 10) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch (e) {}
}

// عدد کوتاه برای کارت‌های خلاصه: ۲٫۴ میلیون / ۸۵۰ هزار (ارزهای بزرگ‌واحد) یا 1.2M / 850K (بقیه)
export function fmtShort(n, cur) {
  if (isMoneyHidden()) return '••••';
  n = Number(n) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  const big = cur ? !!(cur.big) : baseInfo.big;
  const digits = (v) => (v < 10 ? 2 : v < 100 ? 1 : 0);
  const fa = (t) => toFa(t.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '').replace('.', decSep()));
  const units = big ? [[1e9, ' ' + unitName('b')], [1e6, ' ' + unitName('m')], [1e3, ' ' + unitName('k')]] : [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (let i = 0; i < units.length; i++) {
    const [div, name] = units[i];
    if (abs < div) continue;
    const v = abs / div;
    const r = Number(v.toFixed(digits(v)));
    if (r >= 1000 && i > 0) {
      const [d2, n2] = units[i - 1];
      return sign + fa((abs / d2).toFixed(2)) + n2;
    }
    return sign + fa(r.toFixed(digits(v))) + name;
  }
  return fmt(n);
}

// دکمهٔ ⓘ که توضیح را فقط در صورت درخواست کاربر نشان می‌دهد (چند ثانیه یا تا ضربهٔ بعدی)
// ذخیرهٔ فایل روی گوشی: در موبایل/PWA دانلود مستقیم اغلب کار نمی‌کند → اول share sheet (ذخیره در Files/Drive)، بعد دانلود
export async function saveFile(name, text, mime) {
  mime = mime || 'application/json';
  try {
    if (typeof File !== 'undefined' && navigator.share && navigator.canShare) {
      // کروم اندروید فقط چند نوع فایل را اجازهٔ اشتراک می‌دهد (application/json نه) → به‌عنوان متن ساده می‌فرستیم
      const f = new File([text], name, { type: 'text/plain' });
      if (navigator.canShare({ files: [f] })) {
        await navigator.share({ files: [f], title: name });
        return 'shared';
      }
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancel';
  }
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  return 'download';
}
export function infoTip(text, cls) {
  return `<button type="button" class="info-btn ${cls || ''}" data-tip="${esc(text)}" onclick="event.stopPropagation();showTip(this)" aria-label="راهنما">i</button>`;
}
let tipEl = null, tipTimer = 0;
export function hideTip() {
  if (tipEl) tipEl.remove();
  tipEl = null;
  clearTimeout(tipTimer);
}
export function showTip(btn) {
  const same = tipEl && tipEl._for === btn;
  hideTip();
  if (same) return;
  const t = document.createElement('div');
  t.className = 'tip';
  t.textContent = btn.dataset.tip || '';
  t._for = btn;
  document.body.appendChild(t);
  const r = btn.getBoundingClientRect();
  const w = Math.min(300, window.innerWidth - 24);
  t.style.width = w + 'px';
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(12, Math.min(window.innerWidth - w - 12, left));
  t.style.left = left + 'px';
  const below = r.bottom + 8;
  t.style.top = below + 'px';
  requestAnimationFrame(() => {
    const th = t.offsetHeight;
    if (below + th > window.innerHeight - 12) t.style.top = Math.max(12, r.top - th - 8) + 'px';
    t.classList.add('show');
  });
  tipEl = t;
  tipTimer = setTimeout(hideTip, 6000);
}
document.addEventListener('pointerdown', (e) => {
  if (tipEl && !e.target.closest('.info-btn') && !e.target.closest('.tip')) hideTip();
}, true);
document.addEventListener('scroll', () => hideTip(), true);

// ── ورودی مبلغ: کاما هنگام تایپ + «به حروف» زیر فیلد ──
// همهٔ <input type="number"> که شمارش/درصد نیستند خودکار تبدیل می‌شوند؛
// el.value همچنان عدد خام (بدون کاما) برمی‌گرداند تا کدهای فعلی دست نخورند.
const PLAIN_IDS = /^(txQty|lnQty_|iQty|plCount|plRate|plEvery|plPrepaid)/;
const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
const AR = '٠١٢٣٤٥٦٧٨٩';
// ماشین‌حساب کوچک: + − × ÷ با اولویت، ارقام فارسی/عربی، درصد ساده (a+b% = a*(1+b/100))
export function calcEval(str) {
  let t = String(str || '')
    .replace(/[۰-۹]/g, (d) => FA.indexOf(d))
    .replace(/[٠-٩]/g, (d) => AR.indexOf(d))
    .replace(/[٫]/g, '.')
    .replace(/[،٬,'\s]/g, '')
    .replace(/[×xX*]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–]/g, '-');
  if (!/^[\d.+\-*/%()]+$/.test(t)) return NaN;
  let i = 0;
  const peek = () => t[i];
  const num = () => {
    let m = t.slice(i).match(/^\d*\.?\d+|^\d+\.?/);
    if (!m) return NaN;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const factor = () => {
    if (peek() === '(') { i++; const v = expr(); if (peek() === ')') i++; return v; }
    if (peek() === '-') { i++; return -factor(); }
    return num();
  };
  const term = () => {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = t[i++];
      let r = factor();
      if (peek() === '%') { i++; r = r / 100; }
      v = op === '*' ? v * r : r === 0 ? NaN : v / r;
    }
    return v;
  };
  const expr = () => {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = t[i++];
      let r = term();
      if (peek() === '%') { i++; r = (v * r) / 100; }
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const v = expr();
  if (i !== t.length || !isFinite(v)) return NaN;
  return Math.round(v * 1e8) / 1e8;
}
export function hasCalcOps(str) {
  return /[+\-*/×÷−]/.test(String(str || '').replace(/^\s*-/, ''));
}

export function normNum(str) {
  str = String(str == null ? '' : str)
    .replace(/[۰-۹]/g, (d) => FA.indexOf(d))
    .replace(/[٠-٩]/g, (d) => AR.indexOf(d))
    .replace(/[٫،,\s]/g, (c) => (c === '٫' ? '.' : ''));
  const neg = str.trim().startsWith('-');
  str = str.replace(/[^\d.]/g, '');
  const i = str.indexOf('.');
  if (i >= 0) str = str.slice(0, i + 1) + str.slice(i + 1).replace(/\./g, '');
  return (neg ? '-' : '') + str;
}
function groupNum(raw) {
  if (!raw) return '';
  const neg = raw.startsWith('-');
  if (neg) raw = raw.slice(1);
  const [int, dec] = raw.split('.');
  const g = (int || '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + g + (dec !== undefined ? '.' + dec : '');
}
export function amountWords(n, cur) {
  n = Math.abs(Number(n) || 0);
  if (!n) return '';
  const trim = (t) => (t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t);
  const u = curDisplay(cur || baseInfo.name);
  const big = cur ? cur === baseInfo.name ? baseInfo.big : !!(bigUnits && bigUnits.has(cur)) : baseInfo.big;
  if (big) {
    if (n >= 1e9) return toFa(trim((n / 1e9).toFixed(2)).replace('.', decSep())) + ' ' + unitName('b') + ' ' + u;
    if (n >= 1e6) return toFa(trim((n / 1e6).toFixed(2)).replace('.', decSep())) + ' ' + unitName('m') + ' ' + u;
    if (n >= 1e3) return toFa(trim((n / 1e3).toFixed(1)).replace('.', decSep())) + ' ' + unitName('k') + ' ' + u;
  } else if (n >= 1e6) {
    return toFa(trim((n / 1e6).toFixed(2)).replace('.', decSep())) + ' ' + unitName('m') + ' ' + u;
  }
  return fmt(n) + ' ' + u;
}
let bigUnits = null;
export function setBigUnits(set) {
  bigUnits = set;
}
function moneyize(el) {
  if (el.dataset.money) return;
  el.dataset.money = '1';
  const raw0 = normNum(nativeValue.get.call(el));
  el.type = 'text';
  el.inputMode = el.getAttribute('inputmode') === 'numeric' ? 'numeric' : 'decimal';
  el.setAttribute('dir', 'ltr');
  el.classList.add('money');
  const ph = el.getAttribute('placeholder') || '';
  if (ph) {
    const d = normNum(ph);
    el.setAttribute('placeholder', d ? groupNum(d) : '');
  }
  let words = null;
  const showWords = () => {
    const raw = normNum(nativeValue.get.call(el));
    const n = Number(raw) || 0;
    const txt = n >= 1000 ? amountWords(n, el.dataset.cur) : '';
    if (!txt) {
      if (words) words.textContent = '';
      return;
    }
    if (!words || !words.isConnected) {
      words = document.createElement('div');
      words.className = 'money-words';
      el.insertAdjacentElement('afterend', words);
    }
    words.textContent = txt;
  };
  const paint = (raw) => {
    nativeValue.set.call(el, groupNum(raw));
    showWords();
  };
  Object.defineProperty(el, 'value', {
    configurable: true,
    get() {
      return normNum(nativeValue.get.call(el));
    },
    set(v) {
      paint(normNum(v));
    },
  });
  paint(raw0);
  // حالت ماشین‌حساب: اگر عملگر تایپ شد، عبارت خام می‌ماند و نتیجه زیرش نمایش داده می‌شود؛ با Enter/خروج از فیلد جایگزین می‌شود
  let calcMode = false;
  const calcPreview = () => {
    const raw = nativeValue.get.call(el);
    const v = calcEval(raw);
    if (!words || !words.isConnected) {
      words = document.createElement('div');
      words.className = 'money-words';
      el.insertAdjacentElement('afterend', words);
    }
    words.textContent = isNaN(v) ? '…' : '= ' + fmt(v) + (v >= 1000 ? ' = ' + amountWords(v, el.dataset.cur) : '');
    words.classList.add('calc');
  };
  const calcCommit = () => {
    if (!calcMode) return;
    const v = calcEval(nativeValue.get.call(el));
    calcMode = false;
    el.classList.remove('calc');
    if (words) words.classList.remove('calc');
    paint(isNaN(v) ? '' : String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === '=') { if (calcMode) { e.preventDefault(); calcCommit(); } }
  });
  el.addEventListener('blur', calcCommit);
  el._calcCommit = calcCommit;
  el.addEventListener('focus', () => showCalcBar(el));
  el.addEventListener('blur', () => hideCalcBar(el));
  el.addEventListener('input', () => {
    const cur = nativeValue.get.call(el);
    if (hasCalcOps(cur)) {
      calcMode = true;
      el.classList.add('calc');
      // هر عدد داخل عبارت هم جداکنندهٔ هزارگان بگیرد؛ نشانگر بعد از همان تعداد کاراکترِ معنادار برگردد
      const caret0 = el.selectionStart == null ? cur.length : el.selectionStart;
      const sigBefore = cur.slice(0, caret0).replace(/[,\s]/g, '').length;
      const grouped = cur.replace(/[,\s]/g, '').replace(/\d[\d.]*/g, (n) => groupNum(normNum(n)));
      if (grouped !== cur) {
        nativeValue.set.call(el, grouped);
        let pos = 0, seen = 0;
        while (pos < grouped.length && seen < sigBefore) { if (grouped[pos] !== ',') seen++; pos++; }
        try { el.setSelectionRange(pos, pos); } catch (e) {}
      }
      calcPreview();
      return;
    }
    if (calcMode) { calcMode = false; el.classList.remove('calc'); if (words) words.classList.remove('calc'); }
    const caret = el.selectionStart || cur.length;
    const digitsBefore = cur.slice(0, caret).replace(/[^\d.-]/g, '').length;
    paint(normNum(cur));
    // بازگرداندن نشانگر بعد از همان تعداد رقم
    const out = nativeValue.get.call(el);
    let pos = 0, seen = 0;
    while (pos < out.length && seen < digitsBefore) {
      if (/[\d.-]/.test(out[pos])) seen++;
      pos++;
    }
    try {
      el.setSelectionRange(pos, pos);
    } catch (e) {}
  });
}
// ── نوار عملگر بالای کیبورد سیستم (فقط لمسی): پد عددی گوشی + − × ÷ ندارد ──
let calcBar = null;
let calcBarEl = null;
const isTouch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
function calcBarInsert(el, txt) {
  const cur = nativeValue.get.call(el);
  const a = el.selectionStart == null ? cur.length : el.selectionStart;
  const b = el.selectionEnd == null ? a : el.selectionEnd;
  nativeValue.set.call(el, cur.slice(0, a) + txt + cur.slice(b));
  const pos = a + txt.length;
  try { el.setSelectionRange(pos, pos); } catch (e) {}
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function calcBarBackspace(el) {
  const cur = nativeValue.get.call(el);
  let a = el.selectionStart == null ? cur.length : el.selectionStart;
  const b = el.selectionEnd == null ? a : el.selectionEnd;
  if (a === b) { if (a === 0) return; a -= 1; }
  nativeValue.set.call(el, cur.slice(0, a) + cur.slice(b));
  try { el.setSelectionRange(a, a); } catch (e) {}
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
// کیبورد باز است؟ (وقتی صفحهٔ دیدنی به‌اندازهٔ چشمگیری کوتاه‌تر از پنجره شده)
function keyboardOpen() {
  const vv = window.visualViewport;
  if (!vv) return true; // نمی‌دانیم → نوار را نشان بده
  const base = Math.max(window.innerHeight, screen.availHeight || 0, window.outerHeight || 0);
  return base - vv.height > 200;
}
function placeCalcBar() {
  if (!calcBar || !calcBarEl) return;
  const vv = window.visualViewport;
  // با پنهان‌کردن کیبورد (دکمهٔ برگشت اندروید) فیلد هنوز فوکوس دارد؛ نوار هم باید برود
  const open = keyboardOpen();
  calcBar.classList.toggle('show', open);
  if (!open) return;
  // در iOS صفحه با کیبورد کوچک نمی‌شود؛ نوار را روی لبهٔ بالای کیبورد می‌نشانیم
  const bottom = vv ? Math.max(0, window.innerHeight - (vv.height + vv.offsetTop)) : 0;
  calcBar.style.bottom = bottom + 'px';
}
function ensureCalcBar() {
  if (calcBar) return calcBar;
  calcBar = document.createElement('div');
  calcBar.className = 'calcbar';
  calcBar.setAttribute('dir', 'ltr');
  calcBar.setAttribute('role', 'toolbar');
  const keys = [
    ['(', '('], [')', ')'], ['÷', '/'], ['×', '*'], ['−', '-'], ['+', '+'], ['000', '000'], ['⌫', 'bs'], ['=', 'eq'],
  ];
  calcBar.innerHTML = keys
    .map(([lab, v]) => `<button type="button" data-k="${v}" class="${v === 'eq' ? 'eq' : v === 'bs' ? 'bs' : v === '000' ? 'k' : ''}">${lab}</button>`)
    .join('');
  // pointerdown + preventDefault: فوکوس از فیلد نمی‌پرد و کیبورد بسته نمی‌شود
  calcBar.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    e.preventDefault();
    const el = calcBarEl;
    if (!el || !el.isConnected) return;
    const k = b.dataset.k;
    if (k === 'bs') calcBarBackspace(el);
    else if (k === 'eq') { if (el._calcCommit) el._calcCommit(); }
    else calcBarInsert(el, k);
  });
  calcBar.addEventListener('click', (e) => e.preventDefault());
  document.body.appendChild(calcBar);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', placeCalcBar);
    window.visualViewport.addEventListener('scroll', placeCalcBar);
  }
  return calcBar;
}
function showCalcBar(el) {
  if (!isTouch() || el.dataset.nocalc != null) return;
  ensureCalcBar();
  calcBarEl = el;
  placeCalcBar();
  // کیبورد با تأخیر باز می‌شود؛ جای نوار را دوباره حساب کن
  setTimeout(placeCalcBar, 120);
  setTimeout(placeCalcBar, 400);
}
function hideCalcBar(el) {
  if (!calcBar || calcBarEl !== el) return;
  // اگر فوکوس مستقیم به فیلد مبلغ دیگری رفت، showCalcBar خودش نوار را نگه می‌دارد
  setTimeout(() => {
    if (calcBarEl === el && document.activeElement !== el) { calcBarEl = null; calcBar.classList.remove('show'); }
  }, 60);
}

export function enhanceMoneyInputs(root) {
  const scope = root && root.querySelectorAll ? root : document;
  scope.querySelectorAll('input[type="number"]').forEach((el) => {
    if (el.dataset.money || el.dataset.plain != null || PLAIN_IDS.test(el.id)) return;
    moneyize(el);
  });
}
if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) enhanceMoneyInputs(n.matches('input') ? n.parentNode : n);
  }).observe(document.documentElement, { childList: true, subtree: true });
}

/* ═══ لذت‌های بصری v2.38.22 ═══ */

// شمارشِ نرمِ اعداد: از مقدار قبلی به مقدار جدید (المنت‌هایی با data-count)
// حافظهٔ آخرینِ مقدارِ نمایش‌یافتهٔ هر عدد — برای این‌که در رندرهای پشت‌سرهم،
// انیمیشنِ ورود دوباره پخش نشود (منشأ چشمک‌زدن)
const numStore = new Map();

// ورودِ نرمِ اعداد: محو + بالاآمدنِ خفیف، فقط وقتی مقدار عوض شده.
// (شمارشِ رقمیِ راه‌راه، چون واحد/تعداد رقم‌ها وسط انیمیشن عوض می‌شد، چشمک می‌زد.)
export function animateNums(root, fmtFn) {
  const rm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (rm) return;
  (root || document).querySelectorAll('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count) || 0;
    const key = el.dataset.ckey || '';
    const prev = numStore.has(key) ? numStore.get(key) : null;
    numStore.set(key, target);
    if (prev !== null && prev === target) return; // بدون تغییر → بدون حرکت
    if (el.classList) {
      el.classList.remove('num-rise');
      void el.offsetWidth; // شروعِ تازهٔ انیمیشن
      el.classList.add('num-rise');
    }
  });
}

// انفجارِ کوچکِ ذرات رنگی — مبدأ: وسط دکمهٔ + (یا هر نقطه‌ای که داده شود)
export function celebrate(x, y) {
  const rm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (rm) return;
  const fab = document.getElementById('fab');
  const r = fab && fab.getBoundingClientRect ? fab.getBoundingClientRect() : null;
  const cx = typeof x === 'number' ? x : r ? r.left + r.width / 2 : window.innerWidth / 2;
  const cy = typeof y === 'number' ? y : r ? r.top + r.height / 2 : window.innerHeight - 90;
  const box = document.createElement('div');
  box.className = 'burst';
  box.style.left = cx + 'px';
  box.style.top = cy + 'px';
  for (let i = 0; i < 12; i++) {
    const s = document.createElement('span');
    const a = Math.random() * Math.PI * 2;
    const d = 36 + Math.random() * 44;
    s.style.setProperty('--dx', (Math.cos(a) * d).toFixed(1) + 'px');
    s.style.setProperty('--dy', (Math.sin(a) * d - 28).toFixed(1) + 'px');
    s.style.background = i % 3 === 0 ? 'var(--accent)' : i % 3 === 1 ? 'var(--green)' : 'var(--orange)';
    box.appendChild(s);
  }
  (document.body || document.documentElement).appendChild(box);
  setTimeout(() => box.remove(), 800);
}
