// ─── شروع دفتر جدید با تقویم دیگر ───
// تقویم دفتر (state.calendar) بعد از ساخت ثابت است. برای تغییر، دفتر جدید ساخته می‌شود:
// ۱) آرشیو کامل دفتر فعلی (دانلود + کپی در درایو) ۲) انتقال گزینشی چیزهای مستقل از ماه ۳) جایگزینی.
import { esc, toast, uid, todayISO, fmtShort, toFa, saveFile } from './utils.js';
import { t as tr, langInfo } from './i18n.js';
import { state, replaceState, accountCurrent, defaultState, baseCur, save } from './state.js';
import { openModal, closeModal } from './modal.js';
import { icon } from './icons.js';
import { debtRemaining } from './debts.js';
import { archiveToDrive, isGoogleLinked } from './sync.js';
import * as sec from './securestore.js';
import { monthOfISO, curMonthKey, setBookCalendar } from './jalali.js';

const W = { target: 'gregorian', opts: { accounts: true, invest: true, debts: true, plans: true, rates: true, budget: true }, archived: false };

function summary() {
  const openDebts = (state.debts || []).filter((d) => debtRemaining(d) > 0);
  const openPlans = (state.installments || []).filter((p) => !p.cancelled && (p.rows || []).some((r) => !r.paidISO));
  const mk = curMonthKey();
  return {
    accounts: state.accounts.length,
    invest: state.investments.length,
    debts: openDebts.length,
    plans: openPlans.length,
    rates: Object.keys(state.rates || {}).length,
    budget: state.budgets[mk] && state.budgets[mk].amount ? state.budgets[mk].amount : 0,
    tx: state.transactions.length,
  };
}

export function openNewBook(target) {
  W.target = target || ((state.calendar || 'jalali') === 'jalali' ? 'gregorian' : 'jalali');
  W.archived = false;
  const s = summary();
  const cur = state.calendar || 'jalali';
  const name = (c) => (c === 'jalali' ? tr('شمسی') : tr('میلادی'));
  const row = (key, label, sub, on) => `<label class="srow" style="cursor:pointer">
      <span class="smid"><span class="st1">${label}</span>${sub ? `<span class="st2">${sub}</span>` : ''}</span>
      <span class="switch ${on ? 'on' : ''}" onclick="event.preventDefault();bookToggle('${key}', this)"></span>
    </label>`;
  openModal(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>${tr('دفتر جدید با تقویم {c}', { c: name(W.target) })}</h2>
    <p class="small muted" style="margin-top:-6px">${tr('تقویم هر دفتر ثابت است؛ دفتر فعلی ({c}) با همهٔ تاریخچه‌اش آرشیو می‌شود و می‌توانی هر وقت خواستی از «پشتیبان‌گیری» برش گردانی. چیزهایی را که می‌خواهی در دفتر جدید بیاید انتخاب کن:', { c: name(cur) })}</p>
    <div class="sgroup">
      ${row('accounts', tr('حساب‌ها با موجودی فعلی'), tr('{n} حساب — موجودی امروز به‌عنوان موجودی اولیه', { n: toFa(s.accounts) }), W.opts.accounts)}
      ${row('invest', tr('دارایی‌ها (سرمایه)'), tr('{n} مورد', { n: toFa(s.invest) }), W.opts.invest)}
      ${row('debts', tr('طلب و بدهی‌های باز'), tr('{n} مورد — فقط ماندهٔ تسویه‌نشده', { n: toFa(s.debts) }), W.opts.debts)}
      ${row('plans', tr('وام و اقساط در جریان'), tr('{n} طرح — اقساط پرداخت‌نشده', { n: toFa(s.plans) }), W.opts.plans)}
      ${row('rates', tr('نرخ ارزها و واحد پایه'), tr('{n} نرخ · {b}', { n: toFa(s.rates), b: baseCur() }), W.opts.rates)}
      ${row('budget', tr('مبلغ بودجهٔ ماه جاری'), s.budget ? tr('{amt} برای اولین ماه دفتر جدید', { amt: fmtShort(s.budget) }) : tr('ثبت نشده'), W.opts.budget && !!s.budget)}
    </div>
    <div class="hint" style="margin-top:12px">${tr('تراکنش‌های گذشته ({n} مورد) و گزارش‌های ماه‌های قبل منتقل نمی‌شوند؛ در آرشیو می‌مانند.', { n: toFa(s.tx) })}</div>
    <div class="hint" style="margin-top:8px">${isGoogleLinked() ? tr('قبل از ساخت، یک فایل آرشیو در Google Drive و یک نسخهٔ دانلودی ساخته می‌شود.') : tr('قبل از ساخت، یک فایل آرشیو دانلود می‌شود. (به گوگل وصل نیستی؛ فایل را جای امن نگه دار.)')}</div>
    <button class="btn primary block" style="margin-top:14px" onclick="bookCreate()">${tr('آرشیو کن و دفتر جدید بساز')}</button>
  `);
}

export function bookToggle(key, el) {
  W.opts[key] = !W.opts[key];
  el.classList.toggle('on', W.opts[key]);
}

function download(name, text) {
  return saveFile(name, text);
}

// ساخت state دفتر جدید از روی دفتر فعلی
export function buildNewBook(src, target, opts) {
  const n = defaultState();
  n.calendar = target;
  n.bookId = uid();
  n.baseCurrency = src.baseCurrency;
  n.customCurrencies = (src.customCurrencies || []).slice();
  if (opts.rates) n.rates = Object.assign({}, src.rates || {});
  const today = todayISO();
  if (opts.accounts) {
    n.accounts = src.accounts.map((a) => Object.assign({}, a, { initial: Math.round(accountCurrentIn(src, a) * 1e8) / 1e8, updatedAt: Date.now() }));
  }
  if (opts.invest) n.investments = src.investments.map((i) => Object.assign({}, i));
  if (opts.debts) {
    n.debts = (src.debts || [])
      .filter((d) => debtRemaining(d) > 0)
      .map((d) => Object.assign({}, d, { id: uid(), amount: debtRemaining(d), payments: [], settled: false, accountId: opts.accounts ? d.accountId : '', txId: null, note: [d.note, tr('منتقل‌شده از دفتر قبلی')].filter(Boolean).join(' · ') }));
  }
  if (opts.plans) {
    n.installments = (src.installments || [])
      .filter((p) => (p.rows || []).some((r) => !r.paidISO))
      .map((p) => Object.assign({}, p, {
        id: uid(),
        disburseTxId: null,
        rows: (p.rows || []).map((r) => Object.assign({}, r, { id: uid(), txId: null, noTx: r.paidISO ? true : r.noTx })),
      }));
  }
  if (opts.budget) {
    const cur = src.budgets[curMonthKey()];
    if (cur && cur.amount) {
      setBookCalendar(target);
      n.budgets[monthOfISO(today)] = { amount: cur.amount, updatedAt: Date.now() };
      setBookCalendar(src.calendar || 'jalali');
    }
  }
  n.updatedAt = Date.now();
  n.rev = 1;
  return n;
}
function accountCurrentIn(src, a) {
  let b = a.initial || 0;
  for (const t of src.transactions) {
    if (t.accountId !== a.id) continue;
    if (t.nobal) continue; // کارمزد انتقال در موجودی لحاظ نمی‌شود
    b += t.type === 'in' || t.type === 'transferIn' ? t.amount : -t.amount;
  }
  return b;
}

export async function bookCreate() {
  const btn = document.querySelector('#sheet .btn.primary');
  if (btn) btn.disabled = true;
  const stamp = todayISO();
  const plain = JSON.stringify(state, null, 1);
  const enc = sec.isEncrypted();
  if (enc && !sec.isUnlocked()) {
    if (btn) btn.disabled = false;
    toast(tr('اول قفل برنامه را باز کن'));
    return;
  }
  // آرشیو (گوشی و درایو) با همان کلید دادهٔ برنامه رمز می‌شود
  const archive = enc ? await sec.encryptStandalone(plain) : plain;
  const archName = 'capital-archive-' + (state.calendar || 'jalali') + '-' + stamp + (enc ? '.enc' : '') + '.json';
  try {
    download(archName, archive);
    if (isGoogleLinked()) {
      toast(tr('در حال ذخیرهٔ آرشیو در گوگل…'));
      await archiveToDrive(archName, archive, { raw: true });
    }
  } catch (e) {
    if (btn) btn.disabled = false;
    toast(tr('آرشیو در گوگل ذخیره نشد؛ اتصال را چک کن و دوباره بزن'));
    return;
  }
  const next = buildNewBook(state, W.target, W.opts);
  replaceState(next, { markDirty: true });
  save();
  closeModal();
  toast(tr('دفتر جدید ساخته شد') + ' ✓');
  if (window.onBookChanged) window.onBookChanged();
}
