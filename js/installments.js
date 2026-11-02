// ─── اقساط: وام بانکی و خرید قسطی ───────────────────────────────────────────
// هر «طرح» یک جدول اقساط آزاد دارد؛ فرم فقط جدول اولیه را می‌سازد و بعد
// هر ردیف (تاریخ، مبلغ، سود، جریمه) قابل ویرایش است — حتی بعد از پرداخت.
//
// اتصال به حساب‌ها:
//   • وام: واریز اصل → تراکنش «قرض/امانت» (خارج از بودجه) به حساب دریافت
//   • پرداخت هر قسط / پیش‌پرداخت → تراکنش خرج از حساب، در پاکت انتخابی (داخل بودجه)
//   • ویرایش/حذف ردیف پرداخت‌شده → تراکنشش هماهنگ می‌شود
import { icon } from './icons.js';
import { esc, fmt, fmtShort, toFa, toast, uid, todayISO, haptic, infoTip } from './utils.js';
import { fmtDate, monthOfISO, toJalali, toGregorian, monthLabel, curMonthKey } from './jalali.js';
import { addBookMonths } from './jalali.js';
import { closeModal, openModal, askConfirm } from './modal.js';
import { render } from './view.js';
import { save, state, accountById, CATS, LOAN_CAT, baseCur, curName } from './state.js';
import { t as tr } from './i18n.js';
import { apickHtml } from './acctpick.js';
import { subChipsHtml } from './subs.js';
import { pickSub } from './subsui.js';

export function allPlans() {
  const plans = state.installments || [];
  migrateTitles(plans);
  return plans;
}
// یک‌بار: عنوان تراکنش اقساط قدیمی («قسط ۳ وام بانک») → نام طرح + نشان
let migrated = false;
function migrateTitles(plans) {
  if (migrated || !plans.length || state.instTitlesV2) return;
  migrated = true;
  let changed = false;
  for (const p of plans) {
    for (const r of p.rows || []) {
      if (!r.txId) continue;
      const t = state.transactions.find((x) => x.id === r.txId);
      if (!t) continue;
      const tag = rowTag(p, r);
      if (t.note !== p.title || t.planTag !== tag) {
        t.note = p.title;
        t.planTag = tag;
        changed = true;
      }
    }
  }
  state.instTitlesV2 = true;
  if (changed) save();
}
export function findPlan(id) {
  return allPlans().find((p) => p.id === id);
}

const addJMonths = addBookMonths;

function daysUntil(iso) {
  if (!iso) return null;
  const a = new Date(todayISO() + 'T12:00:00');
  const b = new Date(iso + 'T12:00:00');
  return Math.round((b - a) / 86400000);
}

// ── محاسبات ──
export function rowTotal(r) {
  return (Number(r.amount) || 0) + (Number(r.interest) || 0) + (Number(r.penalty) || 0);
}
export function planStats(p) {
  const rows = p.rows || [];
  const paid = rows.filter((r) => r.paidISO);
  const unpaid = rows.filter((r) => !r.paidISO);
  const total = rows.reduce((s, r) => s + rowTotal(r), 0);
  const paidSum = paid.reduce((s, r) => s + rowTotal(r), 0);
  const remain = unpaid.reduce((s, r) => s + rowTotal(r), 0);
  const interestAll = rows.reduce((s, r) => s + (Number(r.interest) || 0), 0);
  const interestPaid = paid.reduce((s, r) => s + (Number(r.interest) || 0), 0);
  const penaltyPaid = paid.reduce((s, r) => s + (Number(r.penalty) || 0), 0);
  const next = unpaid.slice().sort((a, b) => a.dueISO.localeCompare(b.dueISO))[0] || null;
  const overdue = unpaid.filter((r) => daysUntil(r.dueISO) < 0).length;
  return { rows, paid, unpaid, total, paidSum, remain, interestAll, interestPaid, penaltyPaid, next, overdue, done: unpaid.length === 0 && rows.length > 0 };
}
// جمع ماندهٔ همهٔ طرح‌های باز (تعهدات)
export function totalRemaining() {
  return allPlans().reduce((s, p) => s + planStats(p).remain, 0);
}
// اقساطی که تا n روز آینده سررسید دارند یا عقب‌افتاده‌اند
export function dueRows(within = 3) {
  const out = [];
  for (const p of allPlans()) {
    for (const r of p.rows || []) {
      if (r.paidISO) continue;
      const n = daysUntil(r.dueISO);
      if (n !== null && n <= within) out.push({ plan: p, row: r, days: n });
    }
  }
  return out.sort((a, b) => a.row.dueISO.localeCompare(b.row.dueISO));
}
export function overdueInstallments() {
  return dueRows(0).length;
}
// جمع اقساط (پرداخت‌شده + نشده) سررسید در یک ماه جلالی
export function monthInstallments(mk) {
  let sum = 0;
  for (const p of allPlans()) for (const r of p.rows || []) if (monthOfISO(r.dueISO) === mk) sum += rowTotal(r);
  return sum;
}

// ── تراکنش‌های وصل‌شده ──
function removeTx(id) {
  if (!id) return;
  state.transactions = state.transactions.filter((t) => t.id !== id);
}
function upsertTx(existingId, payload) {
  let t = existingId ? state.transactions.find((x) => x.id === existingId) : null;
  if (t) Object.assign(t, payload);
  else {
    t = Object.assign({ id: uid() }, payload);
    state.transactions.push(t);
  }
  return t.id;
}
// برچسب کوتاه برای نشانِ تراکنش: «قسط ۳/۱۲»، «پیش‌پرداخت»، «سود»
export function rowTag(p, r) {
  if (r.kind === 'down') return tr('پیش‌پرداخت');
  if (r.kind === 'interest') return tr('سود');
  const inst = (p.rows || []).filter((x) => x.kind !== 'down' && x.kind !== 'interest');
  const n = inst.indexOf(r) + 1;
  return tr('قسط') + ' ' + toFa(n) + '/' + toFa(inst.length) + (r.penalty ? ' · ' + tr('با جریمه') : '');
}
function rowLabel(p, r) {
  if (r.kind === 'down') return (tr('پیش‌پرداخت') + ' ') + p.title;
  if (r.kind === 'interest') return (tr('سود') + ' ') + p.title;
  const list = (p.rows || []).filter((x) => x.kind !== 'down' && x.kind !== 'interest');
  const isRestOf = (i) => i > 0 && list[i].part && list[i - 1].part && list[i - 1].dueISO === list[i].dueISO;
  let n = 0, me = 0, isRest = false;
  for (let i = 0; i < list.length; i++) {
    if (!isRestOf(i)) n++;
    if (list[i] === r) { me = n; isRest = isRestOf(i); break; }
  }
  return (tr('قسط') + ' ') + toFa(me) + (isRest ? ' (' + tr('مانده') + ')' : '') + ' ' + p.title;
}
function syncRowTx(p, r) {
  const acc = accountById(r.accountId || p.accountId);
  if (!r.paidISO || r.noTx || !acc || rowTotal(r) <= 0) {
    removeTx(r.txId);
    r.txId = null;
    return;
  }
  const note = p.title; // عنوان یکسان برای همهٔ اقساط یک طرح؛ شمارهٔ قسط در نشان (badge) نمایش داده می‌شود
  r.txId = upsertTx(r.txId, {
    amount: rowTotal(r),
    accountId: acc.id,
    note,
    dateISO: r.paidISO,
    month: monthOfISO(r.paidISO),
    type: 'out',
    cat: p.cat || 'need',
    sub: p.sub || '',
    reflect: '',
    kind: 'simple',
    lines: null,
    updatedAt: Date.now(),
    planId: p.id,
    planRowId: r.id,
    planTag: rowTag(p, r),
  });
}
function syncDisburseTx(p) {
  const acc = accountById(p.disburseAccountId);
  if (p.kind !== 'loan' || !acc || !(p.principal > 0)) {
    removeTx(p.disburseTxId);
    p.disburseTxId = null;
    return;
  }
  p.disburseTxId = upsertTx(p.disburseTxId, {
    amount: p.principal,
    accountId: acc.id,
    note: (tr('دریافت وام') + ' ') + p.title,
    dateISO: p.startISO || todayISO(),
    month: monthOfISO(p.startISO || todayISO()),
    type: 'in',
    cat: LOAN_CAT,
    reflect: '',
    kind: 'simple',
    lines: null,
    updatedAt: Date.now(),
    planId: p.id,
  });
}
function syncAllTx(p) {
  syncDisburseTx(p);
  for (const r of p.rows || []) syncRowTx(p, r);
  p.updatedAt = Date.now();
}

// ── ژنراتور جدول ──
// mode: 'equal' (اقساط مساوی، سود داخل قسط) | 'periodic' (اصل ماهانه + سود هر n ماه) | 'purchase'
function buildRows(o) {
  const rows = [];
  const count = Math.max(1, Math.round(o.count || 1));
  if (o.mode === 'purchase' && o.down > 0) {
    // پیش‌پرداخت همیشه پرداخت‌شده است؛ فقط این‌که تراکنش بسازد (از حساب کم کند) یا نه
    rows.push({ id: uid(), kind: 'down', dueISO: o.startISO, amount: o.down, interest: 0, penalty: 0, paidISO: o.startISO, noTx: !o.downPaid });
  }
  const firstISO = o.firstISO || addJMonths(o.startISO, 1);
  const per = Number(o.per) || 0;
  const perInt = o.mode === 'equal' ? Number(o.perInterest) || 0 : 0;
  for (let i = 0; i < count; i++) {
    const due = addJMonths(firstISO, i);
    rows.push({ id: uid(), kind: 'pay', dueISO: due, amount: per, interest: perInt, penalty: 0, paidISO: null });
    if (o.mode === 'periodic' && o.every > 0 && (i + 1) % o.every === 0 && o.periodInterest > 0) {
      rows.push({ id: uid(), kind: 'interest', dueISO: due, amount: 0, interest: o.periodInterest, penalty: 0, paidISO: null });
    }
  }
  return rows;
}

// ── فرم ساخت / ویرایش مشخصات ──
let editingId = null;
const F = { kind: 'loan', mode: 'equal' };
window.plFirstTouched = false;
// با تغییر تاریخ دریافت/خرید، اولین قسط (اگر دستی عوض نشده) یک ماه بعد از آن می‌شود
export function plStartChanged(iso) {
  const f = document.getElementById('plFirst');
  if (!f || !iso || window.plFirstTouched) return;
  f.value = addJMonths(iso, 1);
}

// پاکت قسط پیش‌فرض ندارد: کاربر باید انتخاب کند. «بدهی بد» = پاکت آزادی مالی (بستن بدهی، پس‌انداز معکوس است)
function catOptions(sel) {
  const bad = sel === 'invest:bad';
  return `<option value="" ${!sel ? 'selected' : ''}>${tr('پاکت را انتخاب کن…')}</option>` + CATS.filter((c) => !c.loan)
    .map((c) => `<option value="${c.id}" ${c.id === sel && !bad ? 'selected' : ''}>${c.label}</option>`)
    .join('') + `<option value="invest:bad" ${bad ? 'selected' : ''}>${tr('بدهی بد → آزادی مالی')}</option>`;
}

export function openPlanForm(p) {
  editingId = p ? p.id : null;
  plSub = p ? p.sub || '' : '';
  window.plFirstTouched = false;
  const act = state.accounts.filter((x) => !x.archived);
  if (!act.length) {
    toast(tr('اول یک حساب بساز'));
    return;
  }
  F.kind = p ? p.kind : 'loan';
  F.mode = p ? p.mode || 'equal' : 'equal';
  const acc = p ? p.accountId : act[0].id;
  openModal(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>${p ? tr('ویرایش مشخصات') : tr('قسط جدید')}</h2>
    <div class="seg" id="plKind" style="margin-bottom:14px">
      <button type="button" class="${F.kind === 'loan' ? 'on' : ''}" data-k="loan" onclick="plSetKind('loan')">${tr('وام')}</button>
      <button type="button" class="${F.kind === 'purchase' ? 'on' : ''}" data-k="purchase" onclick="plSetKind('purchase')">${tr('خرید قسطی')}</button>
    </div>
    <div class="field"><label>${tr('عنوان')}</label>
      <input class="input" id="plTitle" placeholder="${F.kind === 'loan' ? tr('مثلاً وام مسکن') : tr('مثلاً گوشی')}" value="${p ? esc(p.title) : ''}"></div>

    <div id="plLoanBox" style="${F.kind === 'loan' ? '' : 'display:none'}">
      <div class="row">
        <div class="col field"><label>${tr('مبلغ دریافتی (اصل وام)')}</label>
          <input class="input" id="plPrincipal" type="number" inputmode="numeric" placeholder="${tr('مثلاً 100000000')}" value="${p && p.principal ? p.principal : ''}"></div>
        <div class="col field"><label>${tr('تاریخ دریافت')}</label>
          <input class="input" id="plStart" type="date" value="${p ? p.startISO : todayISO()}" onchange="plStartChanged(this.value)"></div>
      </div>
      <div class="field"><label>${tr('واریز اصل وام به حساب')} ${infoTip(tr('فقط اگر همین الان وام گرفته‌ای و هنوز موجودی‌اش را در حساب وارد نکرده‌ای، حساب را انتخاب کن. برای وام‌های قدیمی که پولش الان در حساب‌هایت هست «ثبت نشود» بماند وگرنه دوبار حساب می‌شود.'))}</label>
        ${apickHtml({ id: 'plDisburseAcc', selected: (p && p.disburseAccountId) || '', allowNone: true, noneLabel: tr('ثبت نشود — پول قبلاً در حسابم هست'), onchange: 'plRecalc()', title: tr('واریز اصل وام به کدام حساب؟') })}
        <div class="hint" id="plDisburseHint" style="margin-top:6px;display:none"></div>
      </div>
    </div>

    <div class="field"><label>${tr('هر قسط از کدام حساب و پاکت؟')} ${infoTip(tr('پرداخت قسط خرجِ واقعی ماه است و از بودجهٔ همان پاکت کم می‌شود.'))}</label>
      <div class="row">
        ${apickHtml({ id: 'plAcc', selected: acc, compact: true, wrapClass: 'col', title: tr('هر قسط از کدام حساب؟') })}
        <select class="input col" id="plCat" onchange="plCatChanged()">${catOptions(p ? (p.badDebt ? 'invest:bad' : p.cat) : '')}</select>
      </div>
      <div id="plSubWrap" style="margin-top:8px">${p && p.cat ? subChipsHtml(p.cat, p.sub || '', 'plPickSub') : ''}</div>
    </div>

    ${p ? '' : `
    <div class="divider"></div>
    <h3 style="margin-bottom:10px;display:flex;align-items:center">${tr('جدول اقساط')} ${infoTip(tr('این فقط نقطهٔ شروع است؛ بعداً هر ردیف را جدا می‌توانی عوض کنی (مبلغ، تاریخ، سود، جریمه).'))}</h3>
    <div id="plModeBox" style="${F.kind === 'loan' ? '' : 'display:none'}">
      <div class="seg" style="margin-bottom:12px">
        <button type="button" class="${F.mode === 'equal' ? 'on' : ''}" onclick="plSetMode('equal')">${tr('اقساط مساوی')}</button>
        <button type="button" class="${F.mode === 'periodic' ? 'on' : ''}" onclick="plSetMode('periodic')">${tr('اصل ماهانه + سود دوره‌ای')}</button>
      </div>
    </div>
    <div id="plPurchaseBox" style="${F.kind === 'purchase' ? '' : 'display:none'}">
      <div class="field"><label>${tr('قیمت نقدی (اختیاری، برای مقایسه)')}</label>
        <input class="input" id="plCash" type="number" inputmode="numeric" placeholder="${tr('مثلاً 40000000')}" oninput="plRecalc()"></div>
      <div class="row">
        <div class="col field"><label>${tr('پیش‌پرداخت')}</label>
          <input class="input" id="plDown" type="number" inputmode="numeric" placeholder="0"></div>
        <div class="col field"><label>${tr('تاریخ خرید')}</label>
          <input class="input" id="plBuyDate" type="date" value="${todayISO()}" onchange="plStartChanged(this.value)"></div>
      </div>
      <label class="row" style="gap:8px;align-items:center;margin:-4px 0 12px;font-size:var(--fs-sm)"><input type="checkbox" id="plDownPaid" checked> ${tr('پیش‌پرداخت را الان از حساب کم کن')} ${infoTip(tr('پیش‌پرداخت در هر حالت «پرداخت‌شده» ثبت می‌شود. اگر قبلاً پرداختش کرده‌ای و از موجودی فعلی‌ات رفته، تیک را بردار تا دوباره از حساب کم نشود.'))}</label>
    </div>
    <div class="row">
      <div class="col field"><label>${tr('مدت (ماه)')}</label>
        <input class="input" id="plCount" type="number" inputmode="numeric" placeholder="${tr('مثلاً 36')}" oninput="plRecalc()"></div>
      <div class="col field" id="plRateBox" style="${F.kind === 'loan' ? '' : 'display:none'}"><label>${tr('نرخ سود سالانه ٪ (اختیاری)')}</label>
        <input class="input" id="plRate" type="number" inputmode="decimal" step="any" placeholder="${tr('مثلاً 23')}" oninput="plRecalc(true)"></div>
    </div>
    <div class="field"><label><span id="plPerLbl">${F.kind === 'loan' && F.mode === 'periodic' ? tr('اصل هر ماه') : tr('مبلغ هر قسط')}</span>${F.kind === 'loan' ? infoTip(tr('با نرخ سود پیشنهاد می‌شود؛ عدد قرارداد بانک را هر وقت خواستی جایگزین کن.')) : ''}</label>
      <input class="input" id="plPer" type="number" inputmode="numeric" placeholder="${tr('مثلاً 15000000')}" oninput="plPerTouched=true;plRecalc()"></div>
    <div id="plEqualBox" style="${F.kind === 'loan' && F.mode === 'equal' ? '' : 'display:none'}">
      <div class="field"><label>${tr('سودِ داخل هر قسط')} ${infoTip(tr('با نرخ سود خودکار پر می‌شود (تقسیم ساده). مثلاً قسط ۱۵ میلیون که ۲ میلیونش سود است.'))}</label>
        <input class="input" id="plPerInt" type="number" inputmode="numeric" placeholder="${tr('مثلاً 2000000')}" oninput="plIntTouched=true;plRecalc()"></div>
    </div>
    <div id="plPeriodicBox" style="${F.kind === 'loan' && F.mode === 'periodic' ? '' : 'display:none'}">
      <div class="row">
        <div class="col field"><label>${tr('سود هر دوره')}</label>
          <input class="input" id="plPeriodInt" type="number" inputmode="numeric" placeholder="${tr('مثلاً 24000000')}" oninput="plIntTouched=true;plRecalc()"></div>
        <div class="col field"><label>${tr('هر چند ماه یک‌بار؟')}</label>
          <input class="input" id="plEvery" type="number" inputmode="numeric" value="12" oninput="plRecalc()"></div>
      </div>
    </div>
    <div class="field" id="plFirstBox"><label>${tr('تاریخ اولین قسط')} ${infoTip(tr('پیش‌فرض: همان روزِ ماه بعد از تاریخ دریافت/خرید. اگر قرارداد چیز دیگری می‌گوید عوضش کن؛ بقیهٔ قسط‌ها هر ماه همین روز می‌افتند.'))}</label>
      <input class="input" id="plFirst" type="date" value="${addJMonths(todayISO(), 1)}" onchange="plFirstTouched=true"></div>
    <div class="field"><label>${tr('قسط‌های پرداخت‌شدهٔ قبلی')} ${infoTip(tr('برای وام‌های در جریان. این‌ها فقط تیک می‌خورند؛ تراکنشی ساخته نمی‌شود و از حسابی کم نمی‌شود — چون آن پرداخت‌ها قبلاً از موجودی فعلی‌ات رفته‌اند.'))}</label>
      <input class="input" id="plPrepaid" type="number" inputmode="numeric" value="0" oninput="plRecalc()"></div>
    <div class="hint" id="plSummary" style="margin-bottom:12px"></div>`}

    <div class="field"><label>${tr('توضیح (اختیاری)')}</label>
      <input class="input" id="plNote" value="${p ? esc(p.note || '') : ''}"></div>
    <button class="btn primary block" onclick="savePlan()">${p ? tr('ذخیره') : tr('ساخت جدول اقساط')}</button>
    ${p ? `<button class="btn danger block" style="margin-top:8px" onclick="delPlan('${p.id}')">${tr('حذف کامل این طرح')}</button>` : ''}
  `);
  if (!p) plRecalc();
}

export function plSetKind(k) {
  F.kind = k;
  document.querySelectorAll('#plKind button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
  const show = (id, on) => {
    const el = document.getElementById(id);
    if (el) el.style.display = on ? '' : 'none';
  };
  show('plLoanBox', k === 'loan');
  show('plModeBox', k === 'loan');
  show('plPurchaseBox', k === 'purchase');
  show('plRateBox', k === 'loan');
  plPerTouched = false;
  plIntTouched = false;
  show('plEqualBox', k === 'loan' && F.mode === 'equal');
  show('plPeriodicBox', k === 'loan' && F.mode === 'periodic');
  const t = document.getElementById('plTitle');
  if (t) t.placeholder = k === 'loan' ? tr('مثلاً وام مسکن') : tr('مثلاً گوشی');
  plRecalc();
}
export function plSetMode(m) {
  F.mode = m;
  document.querySelectorAll('#plModeBox .seg button').forEach((b, i) => b.classList.toggle('on', (i === 0 && m === 'equal') || (i === 1 && m === 'periodic')));
  const eq = document.getElementById('plEqualBox');
  const pe = document.getElementById('plPeriodicBox');
  if (eq) eq.style.display = m === 'equal' ? '' : 'none';
  if (pe) pe.style.display = m === 'periodic' ? '' : 'none';
  const l = document.getElementById('plPerLbl');
  if (l) l.textContent = m === 'periodic' ? tr('اصل هر ماه') : tr('مبلغ هر قسط');
  plPerTouched = false;
  plIntTouched = false;
  plRecalc();
}
function v(id) {
  const el = document.getElementById(id);
  return el ? Number(el.value) || 0 : 0;
}
let plPerTouched = false;
let plIntTouched = false;
function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val ? String(Math.round(val / 1000) * 1000) : '';
}
// فرمول ساده: سود کل = اصل × نرخ سالانه × (ماه ÷ ۱۲)؛ قسط = (اصل + سود) ÷ ماه
export function plRecalc(fromRate) {
  const box = document.getElementById('plSummary');
  if (!box) return;
  const count = v('plCount');
  const rate = v('plRate');
  const principal0 = v('plPrincipal');
  // پیشنهاد خودکار از نرخ (تا وقتی کاربر دستی چیزی ننوشته)
  if (F.kind === 'loan' && count > 0 && principal0 > 0 && rate > 0) {
    const totalInt = principal0 * (rate / 100) * (count / 12);
    if (F.mode === 'equal') {
      if (!plPerTouched || fromRate) setVal('plPer', (principal0 + totalInt) / count);
      if (!plIntTouched || fromRate) setVal('plPerInt', totalInt / count);
    } else {
      const every = v('plEvery') || 12;
      if (!plPerTouched || fromRate) setVal('plPer', principal0 / count);
      if (!plIntTouched || fromRate) setVal('plPeriodInt', principal0 * (rate / 100) * (every / 12));
    }
  }
  const per = v('plPer');
  if (!count || !per) {
    box.textContent = tr('مدت و مبلغ قسط را بنویس تا خلاصه را ببینی.');
    return;
  }
  let principal = 0, interest = 0, extra = '', markup = 0;
  if (F.kind === 'purchase') {
    const down = v('plDown');
    principal = down + count * per; // کل بازپرداخت خرید قسطی = پیش‌پرداخت + اقساط
    extra = down ? ' (' + tr('پیش‌پرداخت') + ' ' + fmtShort(down) + ' + ' : ' (';
    extra += toFa(count) + ' × ' + fmtShort(per) + ')';
    const cash = v('plCash');
    if (cash > 0 && principal > cash) markup = principal - cash;
  } else if (F.mode === 'equal') {
    const pi = v('plPerInt');
    principal = count * (per - pi);
    interest = count * pi;
  } else {
    const every = v('plEvery') || 12;
    principal = count * per;
    interest = Math.floor(count / every) * v('plPeriodInt');
  }
  const pre = v('plPrepaid');
  const yrs = count / 12;
  const eff = F.kind === 'loan' && principal > 0 && yrs > 0 ? (interest / principal / yrs) * 100 : 0;
  const total = principal + interest;
  box.innerHTML =
    `${tr('کل بازپرداخت:')} <b>${fmt(total)}</b>${extra}` +
    (interest ? `<br>${tr('از این مبلغ {a} سود است', { a: '<b style="color:var(--orange)">' + fmt(interest) + '</b>' })}${eff ? ' (≈ ' + toFa(eff.toFixed(1).replace('.0', '')) + tr('٪ در سال') + ')' : ''}` : '') +
    (markup ? `<br>${tr('نسبت به نقدی {a} بیشتر می‌پردازی.', { a: '<b style="color:var(--orange)">' + fmt(markup) + '</b>' })}` : '') +
    (F.kind === 'loan' && principal0 > 0 && Math.abs(principal - principal0) > count ? `<br><span style="color:var(--orange)">${tr('جمع اصلِ اقساط ({a}) با مبلغ وام ({b}) یکی نیست؛ اگر عمدی نیست مبلغ قسط را چک کن.', { a: fmtShort(principal), b: fmtShort(principal0) })}</span>` : '') +
    (pre > 0 ? `<br>${toFa(pre)} ${tr('قسط اول پرداخت‌شده تیک می‌خورد؛ ماندهٔ فعلی')} ≈ <b>${fmt(Math.max(0, total - pre * per))}</b>.` : '');
  const dh = document.getElementById('plDisburseHint');
  const da = document.getElementById('plDisburseAcc');
  if (dh && da) {
    const old = pre > 0 || (document.getElementById('plStart') && document.getElementById('plStart').value < todayISO());
    const warn = !!da.value && old;
    dh.style.display = warn ? '' : 'none';
    dh.style.color = warn ? 'var(--red)' : '';
    dh.textContent = warn ? tr('توجه: این وام مربوط به گذشته است؛ با انتخاب حساب، مبلغ وام دوباره به موجودی اضافه می‌شود. اگر پول از قبل در حسابت هست «ثبت نشود» را انتخاب کن.') : '';
  }
}

let plSub = '';
export function plPickSub(btn) {
  const cat = (document.getElementById('plCat').value || 'need').split(':')[0];
  pickSub(btn, cat, (sub) => { plSub = sub; });
}
export function plCatChanged() {
  plSub = '';
  const wrap = document.getElementById('plSubWrap');
  const v = document.getElementById('plCat').value;
  if (v === 'invest:bad') plSub = 'prepay';
  if (wrap) wrap.innerHTML = v ? subChipsHtml(v.split(':')[0], plSub, 'plPickSub') : '';
}
export function savePlan() {
  const title = (document.getElementById('plTitle').value || '').trim();
  if (!title) return toast(tr('عنوان را بنویس'));
  const accountId = document.getElementById('plAcc').value;
  const catRaw = document.getElementById('plCat').value;
  if (!catRaw) return toast(tr('پاکت قسط را انتخاب کن'));
  const badDebt = catRaw === 'invest:bad';
  const cat = catRaw.split(':')[0];
  const note = (document.getElementById('plNote').value || '').trim();
  const stamp = Date.now();

  if (editingId) {
    const p = findPlan(editingId);
    if (!p) return;
    Object.assign(p, { title, accountId, cat, badDebt, sub: plSub || '', note, updatedAt: stamp });
    if (p.kind === 'loan') {
      p.principal = v('plPrincipal');
      p.startISO = document.getElementById('plStart').value || p.startISO;
      p.disburseAccountId = document.getElementById('plDisburseAcc').value || '';
    }
    syncAllTx(p);
    save();
    closeModal();
    render();
    toast(tr('ذخیره شد'));
    return;
  }

  const count = v('plCount');
  const per = v('plPer');
  if (!count || count > 600) return toast(tr('مدت را به ماه وارد کن'));
  if (!per) return toast(tr('مبلغ هر قسط را بنویس'));
  const kind = F.kind;
  const p = { id: uid(), kind, mode: F.mode, title, accountId, cat, badDebt, sub: plSub || '', note, createdISO: todayISO(), updatedAt: stamp, rows: [] };
  if (kind === 'loan') p.rate = v('plRate') || 0;
  else p.cashPrice = v('plCash') || 0;
  if (kind === 'loan') {
    p.principal = v('plPrincipal');
    p.startISO = document.getElementById('plStart').value || todayISO();
    p.disburseAccountId = document.getElementById('plDisburseAcc').value || '';
    const perInt = F.mode === 'equal' ? v('plPerInt') : 0;
    p.rows = buildRows({
      mode: F.mode,
      count,
      per: F.mode === 'equal' ? per - perInt : per,
      perInterest: perInt,
      periodInterest: v('plPeriodInt'),
      every: v('plEvery') || 12,
      firstISO: document.getElementById('plFirst').value || addJMonths(p.startISO, 1),
      startISO: p.startISO,
    });
  } else {
    p.startISO = document.getElementById('plBuyDate').value || todayISO();
    p.rows = buildRows({
      mode: 'purchase',
      count,
      per,
      down: v('plDown'),
      downPaid: document.getElementById('plDownPaid').checked,
      startISO: p.startISO,
      firstISO: document.getElementById('plFirst').value || addJMonths(p.startISO, 1),
    });
  }
  // اقساط از قبل پرداخت‌شده: فقط تیک، بدون تراکنش
  let pre = v('plPrepaid');
  for (const r of p.rows) {
    if (pre <= 0) break;
    if (r.kind === 'down') continue;
    r.paidISO = r.dueISO;
    r.noTx = true;
    pre--;
  }
  allPlans().push(p);
  syncAllTx(p);
  save();
  closeModal();
  render();
  haptic(10);
  toast((tr('طرح اقساط ساخته شد') + ' ✓'));
  openPlanDetail(p.id);
}

export function delPlan(id) {
  const p = findPlan(id);
  if (!p) return;
  const linked = (p.rows || []).some((r) => r.txId) || p.disburseTxId;
  askConfirm(linked ? tr('این طرح و همهٔ تراکنش‌های وصل‌شده (واریز و اقساط) حذف شود؟') : tr('این طرح حذف شود؟'), () => {
    removeTx(p.disburseTxId);
    for (const r of p.rows || []) removeTx(r.txId);
    state.installments = allPlans().filter((x) => x.id !== id);
    save();
    closeModal();
    render();
    toast(tr('حذف شد'));
  });
}

// ── پرداخت / لغو پرداخت یک ردیف ──
export function payRow(planId, rowId, opts) {
  const p = findPlan(planId);
  const r = p && (p.rows || []).find((x) => x.id === rowId);
  if (!r) return;
  r.paidISO = (opts && opts.dateISO) || todayISO();
  if (opts && opts.accountId) r.accountId = opts.accountId;
  r.noTx = false;
  syncRowTx(p, r);
  p.updatedAt = Date.now();
  save();
  render();
  haptic(10);
  toast(rowLabel(p, r) + (' ' + tr('پرداخت شد') + ' ✓'));
  if (document.getElementById('plDetail')) openPlanDetail(planId);
}
export function unpayRow(planId, rowId) {
  const p = findPlan(planId);
  const r = p && (p.rows || []).find((x) => x.id === rowId);
  if (!r) return;
  r.paidISO = null;
  r.noTx = false;
  syncRowTx(p, r);
  p.updatedAt = Date.now();
  save();
  render();
  toast(tr('پرداخت لغو شد'));
  openPlanDetail(planId);
}

// پرداخت با انتخاب حساب/تاریخ (شیت کوچک)
export function openPayRow(planId, rowId) {
  const p = findPlan(planId);
  const r = p && (p.rows || []).find((x) => x.id === rowId);
  if (!r) return;
  const acc = r.accountId || p.accountId;
  openModal(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>${rowLabel(p, r)}</h2>
    <div class="stat" style="margin-bottom:12px"><div class="lbl">${tr('مبلغ پرداخت')}</div><div class="val">${fmt(rowTotal(r))} <span class="small muted">${curName(baseCur())}</span></div>
      ${r.interest || r.penalty ? `<div class="sub">${tr('اصل')} ${fmt(r.amount)}${r.interest ? (' + ' + tr('سود') + ' ') + fmt(r.interest) : ''}${r.penalty ? (' + ' + tr('جریمه') + ' ') + fmt(r.penalty) : ''}</div>` : ''}</div>
    <div class="field"><label>${tr('از کدام حساب؟')}</label>${apickHtml({ id: 'prAcc', selected: acc, compact: true })}</div>
    <div class="field"><label>${tr('تاریخ پرداخت')}</label><input class="input" id="prDate" type="date" value="${todayISO()}"></div>
    <div class="field"><label>${tr('جریمهٔ دیرکرد (اختیاری)')}</label><input class="input" id="prPenalty" type="number" inputmode="numeric" value="${r.penalty || ''}" placeholder="0"></div>
    <div class="field"><label>${tr('مبلغ پرداختی')} ${infoTip(tr('اگر کمتر از کل قسط بنویسی، همین مقدار پرداخت‌شده ثبت می‌شود و باقی‌مانده به‌عنوان ردیفی جدا با همان سررسید می‌ماند تا بعداً بپردازی.'))}</label><input class="input" id="prAmount" type="number" inputmode="numeric" value="${rowTotal(r)}"></div>
    <button class="btn primary block" onclick="confirmPayRow('${p.id}','${r.id}')">${icon('check')} ${tr('ثبت پرداخت')}</button>
  `);
}
export function confirmPayRow(planId, rowId) {
  const p = findPlan(planId);
  const r = p && (p.rows || []).find((x) => x.id === rowId);
  if (!r) return;
  r.penalty = v('prPenalty');
  const total = rowTotal(r);
  const paid = v('prAmount');
  if (!(paid > 0)) return toast(tr('مبلغ پرداختی را وارد کن'));
  if (paid > total + 0.5) return toast(tr('بیشتر از مبلغ قسط است؛ اگر لازم است اول ردیف را ویرایش کن'));
  if (paid < total - 0.5) splitRow(p, r, paid);
  closeModal();
  payRow(planId, rowId, { accountId: document.getElementById('prAcc').value, dateISO: document.getElementById('prDate').value });
}

// پرداخت جزئی: ردیف فعلی به اندازهٔ مبلغ پرداختی کوچک می‌شود (اول اصل، بعد سود، بعد جریمه)
// و باقی‌مانده به‌عنوان ردیفی جدید با همان سررسید، درست بعد از آن می‌نشیند
function splitRow(p, r, paid) {
  let left = paid;
  const take = (x) => { const t = Math.min(x || 0, left); left -= t; return t; };
  const pa = take(r.amount), pi = take(r.interest), pp = take(r.penalty);
  const rest = { id: uid(), kind: r.kind, dueISO: r.dueISO, amount: (r.amount || 0) - pa, interest: (r.interest || 0) - pi, penalty: (r.penalty || 0) - pp, paidISO: null, part: true };
  r.amount = pa; r.interest = pi; r.penalty = pp; r.part = true;
  const i = p.rows.indexOf(r);
  p.rows.splice(i + 1, 0, rest);
}

// ── ویرایش یک ردیف ──
export function openRowEdit(planId, rowId) {
  const p = findPlan(planId);
  const r = rowId ? (p.rows || []).find((x) => x.id === rowId) : null;
  openModal(`
    <button class="x" onclick="openPlanDetail('${planId}')" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>${r ? tr('ویرایش ردیف') : tr('ردیف جدید')}</h2>
    <div class="field"><label>${tr('نوع')}</label>
      <select class="input" id="rwKind">
        <option value="pay" ${!r || r.kind === 'pay' ? 'selected' : ''}>${tr('قسط')}</option>
        <option value="interest" ${r && r.kind === 'interest' ? 'selected' : ''}>${tr('سود (جداگانه)')}</option>
        <option value="down" ${r && r.kind === 'down' ? 'selected' : ''}>${tr('پیش‌پرداخت')}</option>
      </select></div>
    <div class="row">
      <div class="col field"><label>${tr('اصل')}</label><input class="input" id="rwAmount" type="number" inputmode="numeric" value="${r ? r.amount || '' : ''}"></div>
      <div class="col field"><label>${tr('سود')}</label><input class="input" id="rwInterest" type="number" inputmode="numeric" value="${r ? r.interest || '' : ''}"></div>
      <div class="col field"><label>${tr('جریمه')}</label><input class="input" id="rwPenalty" type="number" inputmode="numeric" value="${r ? r.penalty || '' : ''}"></div>
    </div>
    <div class="field"><label>${tr('سررسید')}</label><input class="input" id="rwDue" type="date" value="${r ? r.dueISO : todayISO()}"></div>
    <div class="field"><label>${tr('تاریخ پرداخت (خالی = پرداخت نشده)')}</label><input class="input" id="rwPaid" type="date" value="${r && r.paidISO ? r.paidISO : ''}"></div>
    <div class="field"><label>${tr('حساب پرداخت')}</label>${apickHtml({ id: 'rwAcc', selected: (r ? r.accountId || p.accountId : p.accountId) || '', compact: true })}</div>
    <button class="btn primary block" onclick="saveRow('${planId}','${r ? r.id : ''}')">${tr('ذخیره')}</button>
    ${r ? `<button class="btn danger block" style="margin-top:8px" onclick="delRow('${planId}','${r.id}')">${tr('حذف این ردیف')}</button>` : ''}
  `);
}
export function saveRow(planId, rowId) {
  const p = findPlan(planId);
  if (!p) return;
  let r = rowId ? p.rows.find((x) => x.id === rowId) : null;
  if (!r) {
    r = { id: uid() };
    p.rows.push(r);
  }
  r.kind = document.getElementById('rwKind').value;
  r.amount = v('rwAmount');
  r.interest = v('rwInterest');
  r.penalty = v('rwPenalty');
  r.dueISO = document.getElementById('rwDue').value || r.dueISO || todayISO();
  r.paidISO = document.getElementById('rwPaid').value || null;
  r.accountId = document.getElementById('rwAcc').value;
  if (r.paidISO) r.noTx = false;
  p.rows.sort((a, b) => a.dueISO.localeCompare(b.dueISO));
  for (const x of p.rows) syncRowTx(p, x); // شماره‌گذاری نشان‌ها بعد از مرتب‌سازی درست بماند
  p.updatedAt = Date.now();
  save();
  render();
  toast(tr('ذخیره شد'));
  openPlanDetail(planId);
}
export function delRow(planId, rowId) {
  const p = findPlan(planId);
  if (!p) return;
  const r = p.rows.find((x) => x.id === rowId);
  if (r) removeTx(r.txId);
  p.rows = p.rows.filter((x) => x.id !== rowId);
  for (const x of p.rows) syncRowTx(p, x); // شماره‌ها بعد از حذف به‌روز شوند
  p.updatedAt = Date.now();
  save();
  render();
  openPlanDetail(planId);
}

// ── جزئیات یک طرح ──
export function openPlanDetail(id) {
  const p = findPlan(id);
  if (!p) return;
  const st = planStats(p);
  const pct = st.total > 0 ? Math.round((st.paidSum / st.total) * 100) : 0;
  let payN = 0;
  const rows = st.rows
    .slice()
    .sort((a, b) => a.dueISO.localeCompare(b.dueISO))
    .map((r) => {
      if (r.kind === 'pay') payN++;
      const n = daysUntil(r.dueISO);
      const late = !r.paidISO && n < 0;
      const soon = !r.paidISO && n >= 0 && n <= 3;
      const lbl = r.kind === 'down' ? tr('پیش‌پرداخت') : r.kind === 'interest' ? tr('سود دوره') : (tr('قسط') + ' ') + toFa(payN);
      const sub = r.paidISO
        ? (tr('پرداخت شد') + ' ') + fmtDate(r.paidISO) + (r.noTx ? (' · ' + tr('بدون تراکنش')) : '')
        : late
          ? ('<span style="color:var(--red)">' + tr('عقب‌افتاده') + ' · ') + fmtDate(r.dueISO) + '</span>'
          : (soon ? '<span style="color:var(--orange)">' : '') + (tr('سررسید') + ' ') + fmtDate(r.dueISO) + (soon ? '</span>' : '');
      const parts = [];
      if (r.interest) parts.push((tr('سود') + ' ') + fmtShort(r.interest));
      if (r.penalty) parts.push((tr('جریمه') + ' ') + fmtShort(r.penalty));
      return `<div class="item" style="min-height:56px;${r.paidISO ? 'opacity:.7' : ''}">
        <div class="ic" style="background:${r.paidISO ? 'var(--green-soft)' : late ? 'var(--red-soft)' : 'var(--card2)'};color:${r.paidISO ? 'var(--green)' : late ? 'var(--red)' : 'var(--muted)'}">${icon(r.paidISO ? 'check' : r.kind === 'interest' ? 'coin' : 'calendar')}</div>
        <div class="mid" onclick="openRowEdit('${p.id}','${r.id}')">
          <div class="t1">${lbl}${parts.length ? ' <span class="badge">' + parts.join(' · ') + '</span>' : ''}</div>
          <div class="t2">${sub}</div>
        </div>
        <div class="amt-col">
          <div class="amt ${r.paidISO ? '' : 'out'}">${fmt(rowTotal(r))}</div>
          ${r.paidISO
            ? `<button class="btn sm" style="margin-top:4px" onclick="unpayRow('${p.id}','${r.id}')">${tr('لغو')}</button>`
            : `<button class="btn sm primary" style="margin-top:4px" onclick="openPayRow('${p.id}','${r.id}')">${tr('پرداخت')}</button>`}
        </div>
      </div>`;
    })
    .join('');
  openModal(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <div id="plDetail">
    <h2>${esc(p.title)} <span class="badge">${p.kind === 'loan' ? tr('وام') : tr('خرید قسطی')}</span></h2>
    <div class="grid2" style="margin-bottom:10px">
      <div class="stat"><div class="lbl">${tr('مانده')}</div><div class="val red">${fmtShort(st.remain)}</div></div>
      <div class="stat"><div class="lbl">${tr('پرداختی')}</div><div class="val green">${fmtShort(st.paidSum)}</div></div>
    </div>
    <div class="pbar" style="margin:4px 0 6px"><div style="width:${pct}%"></div></div>
    <div class="small muted" style="display:flex;justify-content:space-between;margin-bottom:12px"><span>${tr('{a} از {b} قسط', { a: toFa(st.paid.length), b: toFa(st.rows.length) })}</span>${st.interestAll ? `<span>${tr('سود')} ${fmtShort(st.interestPaid)} ${tr('از')} ${fmtShort(st.interestAll)}</span>` : ''}<span>${toFa(pct)}${'٪'}</span></div>
    <div class="row" style="margin-bottom:12px">
      <button class="btn sm" style="flex:1" onclick="openRowEdit('${p.id}','')">${icon('plus')} ${tr('ردیف')}</button>
      <button class="btn sm" style="flex:1" onclick="openPlanForm(findPlan('${p.id}'))">${icon('edit')} ${tr('مشخصات')}</button>
    </div>
    <div style="max-height:52vh;overflow:auto">${rows || ('<div class="empty">' + tr('ردیفی نیست.') + '</div>')}</div>
    </div>
  `);
}

// ── کارت هر طرح در صفحهٔ طلب و بدهی ──
function planCard(p) {
  const st = planStats(p);
  const pct = st.total > 0 ? Math.round((st.paidSum / st.total) * 100) : 0;
  const nxt = st.next;
  const n = nxt ? daysUntil(nxt.dueISO) : null;
  const late = !st.done && n !== null && n < 0;
  const soon = !st.done && n !== null && n >= 0 && n <= 7;
  const when = st.done
    ? tr('تسویه شد')
    : nxt
      ? n < 0 ? toFa(-n) + (' ' + tr('روز عقب‌افتاده')) : n === 0 ? tr('امروز') : n <= 7 ? toFa(n) + (' ' + tr('روز دیگر')) : fmtDate(nxt.dueISO)
      : '';
  const t2 = [p.kind === 'loan' ? tr('وام') : tr('خرید قسطی'), tr('{a} از {b}', { a: toFa(st.paid.length), b: toFa(st.rows.length) })]
    .concat(nxt && !st.done ? [(tr('قسط بعدی') + ' ') + fmtShort(rowTotal(nxt))] : [])
    .join(' · ');
  return `
    <div class="item" style="${st.done ? 'opacity:.62' : ''}">
      <div class="ic" style="background:${late ? 'var(--red-soft)' : st.done ? 'var(--green-soft)' : 'var(--orange-soft)'};color:${late ? 'var(--red)' : st.done ? 'var(--green)' : 'var(--orange)'}">${icon(p.kind === 'loan' ? 'bank' : 'gift')}</div>
      <div class="mid" onclick="openPlanDetail('${p.id}')">
        <div class="t1">${esc(p.title)}</div>
        <div class="t2">${t2}</div>
        <div class="pbar" style="height:4px;margin:8px 0 0"><div style="width:${pct}%;background:${late ? 'var(--red)' : 'var(--accent)'}"></div></div>
      </div>
      <div class="amt-col">
        <div class="amt ${st.done ? '' : 'out'}">${st.done ? fmtShort(st.total) : fmtShort(st.remain)}</div>
        <div class="bal">${st.done ? tr('پرداخت‌شده') : tr('مانده')}</div>
        ${nxt && !st.done && n <= 7 ? `<button class="btn sm ${late ? 'primary' : ''}" style="margin-top:6px" onclick="openPayRow('${p.id}','${nxt.id}')">${tr('پرداخت')}</button>` : `<button class="btn sm" style="margin-top:6px" onclick="openPlanDetail('${p.id}')">${tr('جزئیات')}</button>`}
      </div>
    </div>
    ${late ? '<div class="small" style="color:var(--red);margin:-4px 0 10px 52px">' + when + '</div>' : ''}
    ${soon ? ('<div class="small" style="color:var(--orange);margin:-4px 0 10px 52px">' + tr('سررسید') + ' ') + when + '</div>' : ''}`;
}

// ── برنامهٔ ماه‌به‌ماه اقساط پیش رو ──
export function upcomingByMonth() {
  const cur = curMonthKey();
  const map = new Map();
  for (const p of allPlans()) {
    for (const r of p.rows || []) {
      if (r.paidISO) continue;
      let mk = monthOfISO(r.dueISO);
      const late = mk < cur || (mk === cur && daysUntil(r.dueISO) < 0);
      if (mk < cur) mk = cur; // عقب‌افتاده‌ها در ماه جاری جمع می‌شوند
      if (!map.has(mk)) map.set(mk, { mk, sum: 0, items: [], late: 0 });
      const m = map.get(mk);
      const amt = rowTotal(r);
      m.sum += amt;
      if (late) m.late += amt;
      m.items.push({ plan: p, row: r, amt, late });
    }
  }
  const months = [...map.values()].sort((a, b) => a.mk.localeCompare(b.mk));
  months.forEach((m) => m.items.sort((a, b) => a.row.dueISO.localeCompare(b.row.dueISO)));
  return months;
}

export function openInstSchedule() {
  const months = upcomingByMonth();
  const remain = totalRemaining();
  const cur = curMonthKey();
  const max = Math.max(1, ...months.map((m) => m.sum));
  const body = months.length
    ? months
        .map((m, i) => {
          const w = Math.round((m.sum / max) * 100);
          const isCur = m.mk === cur;
          return `<details class="sched-m" ${i < 2 ? 'open' : ''}>
            <summary>
              <div class="sched-head">
                <div class="sched-t"><b>${monthLabel(m.mk)}</b>${isCur ? ` <span class="badge">${tr('این ماه')}</span>` : ''}<span class="small muted">${toFa(m.items.length)} ${tr('قسط')}</span></div>
                <div class="sched-sum ${m.late ? 'red' : ''}">${fmtShort(m.sum)}</div>
              </div>
              <div class="sched-bar"><i style="width:${w}%"></i>${m.late ? `<i class="late" style="width:${Math.round((m.late / max) * 100)}%"></i>` : ''}</div>
            </summary>
            ${m.items
              .map(
                (it) => `<div class="entry" onclick="closeModal();openPlanDetail('${it.plan.id}')">
                <span class="ib sm ${it.late ? 'red' : ''}">${icon(it.plan.kind === 'loan' ? 'bank' : 'receipt')}</span>
                <div style="flex:1;min-width:0"><div class="t1">${esc(rowLabel(it.plan, it.row))}</div>
                <div class="t2">${fmtDate(it.row.dueISO)}${it.late ? ` · <span style="color:var(--red)">${tr('عقب‌افتاده')}</span>` : ''}</div></div>
                <div class="amt">${fmt(it.amt)}</div>
              </div>`
              )
              .join('')}
          </details>`;
        })
        .join('')
    : `<div class="empty">${tr('قسط پرداخت‌نشده‌ای نداری.')}</div>`;
  const next3 = months.slice(0, 3).reduce((s, m) => s + m.sum, 0);
  openModal(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>${tr('اقساط پیش رو')}</h2>
    <div class="grid3" style="margin:8px 0 12px">
      <div class="stat"><div class="lbl">${tr('ماندهٔ کل')}</div><div class="val">${fmtShort(remain)}</div></div>
      <div class="stat"><div class="lbl">${tr('۳ ماه آینده')}</div><div class="val">${fmtShort(next3)}</div></div>
      <div class="stat"><div class="lbl">${tr('تا پایان')}</div><div class="val">${months.length ? toFa(months.length) + ' ' + tr('ماه') : '—'}</div></div>
    </div>
    ${body}
  `);
}

export function renderInstallments() {
  const box = document.getElementById('installmentsContent');
  if (!box) return;
  const plans = allPlans().slice().sort((a, b) => {
    const sa = planStats(a), sb = planStats(b);
    if (sa.done !== sb.done) return sa.done ? 1 : -1;
    return (sa.next ? sa.next.dueISO : '9').localeCompare(sb.next ? sb.next.dueISO : '9');
  });
  const remain = totalRemaining();
  const paidAll = allPlans().reduce((s, p) => s + planStats(p).paidSum, 0);
  let html = '';
  if (plans.length) {
    html += `<div class="hero" role="button" tabindex="0" style="cursor:pointer" onclick="openInstSchedule()">
      <div style="min-width:0"><div class="lbl">${icon('calendar')} ${tr('ماندهٔ اقساط')}</div>
      <div class="hero-num">${fmtShort(remain)}</div>
      <div class="sub">${tr('پرداختی')} ${fmtShort(paidAll)} · <span style="text-decoration:underline dotted">${tr('ماه‌به‌ماه')}</span></div></div>
      <span class="ib lg ${overdueInstallments() ? 'red' : ''}">${icon('calendar')}</span>
    </div>`;
    html += plans.map(planCard).join('');
  } else {
    html += `<div class="empty"><span class="ib lg muted">${icon('calendar')}</span>${tr('وام یا خرید قسطی ثبت نکرده‌ای.')}<br>${tr('با دکمهٔ + بالا یا پایین صفحه شروع کن.')}<button type="button" class="btn sm primary" onclick="openPlanForm()">${icon('plus')} ${tr('ثبت وام / خرید قسطی')}</button></div>`;
  }
  box.innerHTML = html;
}

export function installmentsSection() {
  const plans = allPlans().slice().sort((a, b) => {
    const sa = planStats(a), sb = planStats(b);
    if (sa.done !== sb.done) return sa.done ? 1 : -1;
    return (sa.next ? sa.next.dueISO : '9') .localeCompare(sb.next ? sb.next.dueISO : '9');
  });
  const remain = totalRemaining();
  return `<div class="divider"></div>
    <div class="card-head"><h3>${icon('calendar')} ${tr('اقساط')}</h3>${plans.length ? `<button type="button" class="small muted" style="background:none;border:0;font:inherit;color:inherit;text-decoration:underline dotted" onclick="openInstSchedule()">${tr('ماندهٔ کل')} ${fmtShort(remain)}</button>` : ''}</div>
    ${plans.length ? plans.map(planCard).join('') : `<div class="empty" style="padding:var(--sp-4)">${tr('وام یا خرید قسطی نداری.')}</div>`}
    <button class="btn block" style="margin-bottom:12px" onclick="openPlanForm()">${icon('plus')} ${tr('وام / خرید قسطی جدید')}</button>`;
}

// ── کارت یادآوری خانه ──
export function installmentHomeCard() {
  const due = dueRows(3);
  if (!due.length) return '';
  const first = due[0];
  const more = due.length - 1;
  const lateN = due.filter((x) => x.days < 0).length;
  return `<div class="card" style="border-color:${lateN ? 'var(--red-soft)' : 'var(--orange-soft)'}">
    <div class="row" style="align-items:center;gap:var(--sp-3)">
      <span class="ib ${lateN ? 'red' : 'orange'}">${icon('bell')}</span>
      <div style="flex:1;min-width:0">
        <div class="t1">${rowLabel(first.plan, first.row)} · ${fmtShort(rowTotal(first.row))}</div>
        <div class="t2">${first.days < 0 ? '<span style="color:var(--red)">' + toFa(-first.days) + (' ' + tr('روز عقب‌افتاده') + '</span>') : first.days === 0 ? tr('امروز سررسید است') : toFa(first.days) + (' ' + tr('روز دیگر'))}${more ? ' · ' + toFa(more) + (' ' + tr('مورد دیگر')) : ''}</div>
      </div>
    </div>
    <div class="row" style="margin-top:var(--sp-3)">
      <button class="btn sm primary" style="flex:1" onclick="openPayRow('${first.plan.id}','${first.row.id}')">${icon('check')} ${tr('پرداخت شد')}</button>
      <button class="btn sm" style="flex:1" onclick="${more ? "switchTab('installments')" : `openPlanDetail('${first.plan.id}')`}">${more ? tr('همه') : tr('جزئیات')}</button>
    </div>
  </div>`;
}
