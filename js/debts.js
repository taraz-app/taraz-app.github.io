import { icon } from './icons.js';
import { esc, fmt, fmtShort, store, toast, uid, todayISO, infoTip } from './utils.js';
import { fmtDate, monthOfISO } from './jalali.js';
import { closeModal, openModal, askConfirm } from './modal.js';
import { render } from './view.js';
import { save, state, accountById, rateOf, LOAN_CAT, CATS, baseCur, curName } from './state.js';
import { subChipsHtml } from './subs.js';
import { pickSub } from './subsui.js';
import { overdueInstallments } from './installments.js';
import { t as tr } from './i18n.js';
import { apickHtml } from './acctpick.js';

const NOTIFY_DAY_KEY = 'capital_debt_notify_day';
let editingDebtId = null;

export function allDebts() {
  return (state.debts || []).map(migrateDebt);
}

// پرداخت‌های تسویه (جزئی یا کامل)
export function debtPaid(d) {
  return (d.payments || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
}
// سود/بهره = مبلغ بازپرداخت − اصل (اختیاری؛ اگر بازپرداخت ثبت نشده، صفر)
export function debtInterest(d) {
  const pb = Number(d.payback) || 0;
  return pb > (d.amount || 0) ? pb - (d.amount || 0) : 0;
}
// کل چیزی که باید رد و بدل شود = اصل + سود
export function debtTotal(d) {
  return (d.amount || 0) + debtInterest(d);
}
export function debtRemaining(d) {
  return Math.max(0, debtTotal(d) - debtPaid(d));
}
// تقسیم هر پرداخت به «اصل» و «سود»: اول اصل پر می‌شود، بعد سود
function splitPayments(d) {
  const out = new Map();
  let cum = 0;
  const principal = d.amount || 0;
  for (const pay of (d.payments || []).slice().sort((a, b) => String(a.dateISO).localeCompare(String(b.dateISO)))) {
    const amt = Number(pay.amount) || 0;
    const p = Math.max(0, Math.min(amt, principal - cum));
    out.set(pay.id, { principal: p, interest: amt - p });
    cum += amt;
  }
  return out;
}
export function paymentSplit(d, pay) {
  return splitPayments(d).get(pay.id) || { principal: Number(pay.amount) || 0, interest: 0 };
}
// مهاجرت رکورد قدیمی: settled + settleTxId → یک پرداخت کامل
function migrateDebt(d) {
  if (d.payments) return d;
  d.payments = [];
  if (d.settled) {
    d.payments.push({ id: uid(), amount: d.amount, dateISO: d.settledAt || todayISO(), accountId: d.accountId || '', txId: d.settleTxId || null });
  }
  d.settleTxId = null;
  return d;
}

export function openDebts() {
  return allDebts().filter((d) => !d.settled);
}

export function daysUntilDue(dueISO) {
  if (!dueISO) return null;
  const a = new Date(todayISO() + 'T12:00:00');
  const b = new Date(dueISO + 'T12:00:00');
  return Math.round((b - a) / 86400000);
}

export function dueSoonDebts(within = 3) {
  return openDebts().filter((d) => {
    if (!d.dueISO) return false;
    const n = daysUntilDue(d.dueISO);
    return n !== null && n <= within;
  });
}

export function overdueCount() {
  return dueSoonDebts(0).length + overdueInstallments();
}

function dueLabel(dueISO) {
  if (!dueISO) return tr('بدون سررسید');
  const n = daysUntilDue(dueISO);
  if (n === null) return fmtDate(dueISO);
  if (n < 0) return (tr('عقب‌افتاده') + ' · ') + fmtDate(dueISO);
  if (n === 0) return tr('امروز سررسید است');
  if (n === 1) return tr('فردا سررسید است');
  return fmtDate(dueISO);
}

function lastDebtAccountId() {
  const withAcc = allDebts().filter((x) => x.accountId).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (withAcc.length && accountById(withAcc[0].accountId)) return withAcc[0].accountId;
  const act = state.accounts.filter((x) => !x.archived);
  return act.length ? act[0].id : '';
}

// انتخابگر حساب با چیپس و لوگو؛ «بدون اتصال به حساب» هم یکی از گزینه‌هاست
function accountOptionsHtml(selectedId) {
  return apickHtml({
    id: 'dAccount',
    selected: selectedId || '',
    allowNone: true,
    noneLabel: tr('بدون اتصال به حساب'),
    onchange: 'syncDebtAmountLabel()',
    title: tr('از/به کدام حساب؟'),
  });
}

export function openDebtForm(d) {
  editingDebtId = d ? d.id : null;
  dInterestSub = d ? d.interestSub || '' : '';
  const kind = d ? d.kind : 'in';
  const accId = d ? d.accountId || '' : lastDebtAccountId();
  const acc = accountById(accId);
  const linked = !!(d && d.txId);
  openModal(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>${d ? tr('ویرایش مورد') : tr('طلب یا بدهی جدید')}</h2>
    <div class="seg" id="debtKindSeg" style="margin-bottom:14px">
      <button class="${kind === 'in' ? 'on' : ''}" data-k="in" onclick="setDebtKind(this)">${tr('طلب من از دیگران')}</button>
      <button class="${kind === 'out' ? 'on out' : ''}" data-k="out" onclick="setDebtKind(this)">${tr('بدهی من به دیگران')}</button>
    </div>
    <div class="field"><label>${tr('اسم طرف')}</label>
      <input class="input" id="dPerson" placeholder="${tr('مثلاً علی')}" value="${d ? esc(d.person || '') : ''}">
    </div>
    <div class="field"><label>${tr('شمارهٔ موبایل (اختیاری)')} ${infoTip(tr('برای فرستادن یادآوری با پیامک یا واتساپ؛ فقط روی همین گوشی می‌ماند.'))}</label>
      <div class="row" style="flex-wrap:nowrap">
        <input class="input col" id="dPhone" type="tel" inputmode="tel" dir="ltr" data-plain placeholder="0912…" value="${d ? esc(d.phone || '') : ''}" style="min-width:0">
        ${navigator.contacts && navigator.contacts.select ? `<button type="button" class="btn" onclick="debtPickContact()" aria-label="${tr('از مخاطبین')}">${icon('user')}</button>` : ''}
      </div>
    </div>
    <div class="field"><label>${tr('از/به کدام حساب؟')}</label>
      ${accountOptionsHtml(accId)}
      <div class="hint" style="margin-top:6px">${tr('با انتخاب حساب، مبلغ خودکار از حساب کم/به آن اضافه می‌شود و در پاکت «قرض / امانت» می‌نشیند — نه در خرج یا درآمد ماه. حساب تسویه را موقع تسویه جدا انتخاب می‌کنی (می‌تواند فرق کند).')}</div>
    </div>
    <div class="field"><label id="dAmountLbl">${tr('مبلغ')} (${curName(acc ? acc.currency : baseCur())})</label>
      <input class="input" id="dAmount" type="number" step="any" inputmode="decimal" min="0" placeholder="${tr('مثلاً 500000')}" value="${d ? d.amount : ''}" oninput="debtPaybackChanged()">
    </div>
    <div class="field"><label>${tr('مبلغ بازپرداخت (اختیاری)')} ${infoTip(tr('اگر قرار است بیشتر از اصل برگردد (سود/بهره)، کل مبلغ بازپرداخت را بنویس. خالی = همان اصل.'))}</label>
      <input class="input" id="dPayback" type="number" step="any" inputmode="decimal" min="0" placeholder="${tr('مثلاً 550000')}" value="${d && d.payback ? d.payback : ''}" oninput="debtPaybackChanged()">
      <div class="hint" id="dInterestHint" style="margin-top:6px"></div>
    </div>
    <div class="field" id="dInterestCatBox" style="display:none"><label>${tr('بهره به کدام پاکت؟')} ${infoTip(tr('سهم بهرهٔ هر پرداخت، خرج واقعی ماه است و از بودجهٔ همین پاکت کم می‌شود؛ اصل قرض همچنان در پاکت قرض می‌ماند.'))}</label>
      <select class="input" id="dInterestCat" onchange="debtInterestCatChanged()">${CATS.filter((c) => !c.loan).map((c) => `<option value="${c.id}" ${c.id === ((d && d.interestCat) || lastInterestCat()) ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
      <div id="dInterestSubWrap" style="margin-top:8px">${subChipsHtml((d && d.interestCat) || lastInterestCat(), (d && d.interestSub) || '', 'debtPickInterestSub')}</div>
    </div>
    <div class="field"><label>${tr('تاریخ ثبت')}</label>
      <input class="input" id="dDate" type="date" value="${d && d.createdISO ? d.createdISO : todayISO()}">
    </div>
    <div class="field"><label>${tr('تاریخ سررسید')}</label>
      <input class="input" id="dDue" type="date" value="${d && d.dueISO ? d.dueISO : todayISO()}">
    </div>
    <div class="field"><label>${tr('توضیح (اختیاری)')}</label>
      <input class="input" id="dNote" placeholder="${tr('مثلاً قرض برای اجاره')}" value="${d ? esc(d.note || '') : ''}">
    </div>
    <button class="btn primary block" onclick="saveDebt()">${d ? tr('ذخیره') : tr('ثبت')}</button>
    ${d ? `<button class="btn danger block" style="margin-top:8px" onclick="delDebt('${d.id}')">${tr('حذف')}</button>` : ''}
  `);
  debtPaybackChanged();
}

export function setDebtKind(btn) {
  document.querySelectorAll('#debtKindSeg button').forEach((b) => b.classList.remove('on', 'out'));
  btn.classList.add('on');
  if (btn.dataset.k === 'out') btn.classList.add('out');
  debtPaybackChanged();
}

let dInterestSub = '';
function lastInterestCat() {
  const withCat = allDebts().filter((x) => x.interestCat).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return withCat.length ? withCat[0].interestCat : 'need';
}
// نمایش سود و (برای بدهی) انتخاب پاکت بهره — فقط وقتی بازپرداخت > اصل
export function debtPaybackChanged() {
  const amt = parseFloat((document.getElementById('dAmount') || {}).value) || 0;
  const pb = parseFloat((document.getElementById('dPayback') || {}).value) || 0;
  const onBtn = document.querySelector('#debtKindSeg button.on');
  const kind = onBtn ? onBtn.dataset.k : 'in';
  const hint = document.getElementById('dInterestHint');
  const box = document.getElementById('dInterestCatBox');
  const extra = pb > amt && amt > 0 ? pb - amt : 0;
  if (hint) {
    hint.textContent = extra > 0 ? (kind === 'in' ? tr('سود من: {a}', { a: fmt(extra) }) : tr('بهره‌ای که می‌دهم: {a}', { a: fmt(extra) })) : '';
  }
  if (box) box.style.display = extra > 0 && kind === 'out' ? '' : 'none';
}
export function debtInterestCatChanged() {
  dInterestSub = '';
  const wrap = document.getElementById('dInterestSubWrap');
  if (wrap) wrap.innerHTML = subChipsHtml(document.getElementById('dInterestCat').value, '', 'debtPickInterestSub');
}
export function debtPickInterestSub(btn) {
  pickSub(btn, document.getElementById('dInterestCat').value, (sub) => { dInterestSub = sub; });
}

export function saveDebt() {
  const person = (document.getElementById('dPerson').value || '').trim();
  if (!person) {
    toast(tr('اسم طرف را بنویس'));
    return;
  }
  const amount = parseFloat(document.getElementById('dAmount').value);
  if (!amount || amount <= 0) {
    toast(tr('مبلغ را درست وارد کن'));
    return;
  }
  const onBtn = document.querySelector('#debtKindSeg button.on');
  const kind = onBtn ? onBtn.dataset.k : 'in';
  const pbRaw = parseFloat((document.getElementById('dPayback') || {}).value) || 0;
  if (pbRaw && pbRaw < amount) {
    toast(tr('مبلغ بازپرداخت نمی‌تواند کمتر از اصل باشد'));
    return;
  }
  const payback = pbRaw > amount ? pbRaw : 0;
  const hasInterest = payback > 0;
  const interestCat = hasInterest && kind === 'out' ? ((document.getElementById('dInterestCat') || {}).value || 'need') : '';
  const interestSub = interestCat ? dInterestSub : '';
  const phone = normPhone((document.getElementById('dPhone') || {}).value || '');
  const dueISO = document.getElementById('dDue').value || '';
  const createdISO = (document.getElementById('dDate') || {}).value || todayISO();
  const note = (document.getElementById('dNote').value || '').trim();
  const accSel = document.getElementById('dAccount');
  const accountId = accSel && accSel.value && accountById(accSel.value) ? accSel.value : '';
  const stamp = Date.now();
  if (editingDebtId) {
    const d = allDebts().find((x) => x.id === editingDebtId);
    if (!d) return;
    Object.assign(d, { person, amount, kind, dueISO, note, accountId, createdISO, payback, interestCat, interestSub, phone, updatedAt: stamp });
    syncDebtTxs(d);
    toast(tr('ویرایش شد'));
  } else {
    if (!state.debts) state.debts = [];
    const d = {
      id: uid(),
      person,
      amount,
      kind,
      dueISO,
      note,
      accountId,
      createdISO,
      payback,
      interestCat,
      interestSub,
      phone,
      settled: false,
      settledAt: null,
      updatedAt: stamp,
    };
    state.debts.push(d);
    syncDebtTxs(d);
    toast(accountId ? (tr('ثبت شد') + ' ✓ ' + tr('و از حساب اعمال شد')) : (tr('ثبت شد') + ' ✓'));
  }
  save();
  closeModal();
  render();
}

export function syncDebtAmountLabel() {
  const sel = document.getElementById('dAccount');
  const lbl = document.getElementById('dAmountLbl');
  if (!sel || !lbl) return;
  const a = accountById(sel.value);
  lbl.textContent = tr('مبلغ') + ' (' + curName(a ? a.currency : baseCur()) + ')';
  const inp = document.getElementById('dAmount');
  if (inp) {
    inp.dataset.cur = a ? a.currency : baseCur();
    inp.dispatchEvent(new Event('input'));
  }
}

// ─── اتصال طلب/بدهی به تراکنش‌های پاکت قرض ────────────────────────────────
// طلب من (kind=in): پول از حساب خارج شده → تراکنش out ؛ تسویه → in
// بدهی من (kind=out): پول وارد حساب شده → تراکنش in ؛ تسویه → out
function upsertLinkedTx(existingId, d, phase) {
  const isOpen = phase === 'open';
  const lent = d.kind === 'in';
  const type = (isOpen ? lent : !lent) ? 'out' : 'in';
  const dateISO = isOpen ? d.createdISO || todayISO() : d.settledAt || todayISO();
  const who = d.person || '';
  const note = isOpen
    ? lent
      ? (tr('قرض دادم به') + ' ') + who
      : (tr('قرض گرفتم از') + ' ') + who
    : lent
      ? (tr('برگشت طلب از') + ' ') + who
      : (tr('پس دادم به') + ' ') + who;
  const stamp = Date.now();
  let t = existingId ? state.transactions.find((x) => x.id === existingId) : null;
  const payload = {
    amount: d.amount,
    accountId: d.accountId,
    note: note + (d.note ? ' — ' + d.note : ''),
    dateISO,
    month: monthOfISO(dateISO),
    type,
    cat: LOAN_CAT,
    reflect: '',
    kind: 'simple',
    lines: null,
    updatedAt: stamp,
    debtId: d.id,
  };
  if (t) Object.assign(t, payload);
  else {
    t = Object.assign({ id: uid() }, payload);
    state.transactions.push(t);
  }
  return t.id;
}

function removeTx(id) {
  if (!id) return;
  state.transactions = state.transactions.filter((t) => t.id !== id);
}

function paymentTx(d, pay) {
  const acc = accountById(pay.accountId);
  if (!acc || !(pay.amount > 0)) {
    removeTx(pay.txId);
    pay.txId = null;
    return;
  }
  const lent = d.kind === 'in';
  const who = d.person || '';
  const note = (lent ? (tr('برگشت طلب از') + ' ') : (tr('پس دادم به') + ' ')) + who + (pay.note ? ' — ' + pay.note : '');
  let t = pay.txId ? state.transactions.find((x) => x.id === pay.txId) : null;
  const sp = paymentSplit(d, pay);
  const payload = {
    amount: pay.amount,
    accountId: acc.id,
    note,
    dateISO: pay.dateISO,
    month: monthOfISO(pay.dateISO),
    type: lent ? 'in' : 'out',
    cat: LOAN_CAT,
    reflect: '',
    kind: 'simple',
    lines: null,
    interest: 0,
    updatedAt: Date.now(),
    debtId: d.id,
  };
  if (sp.interest > 0) {
    if (lent) {
      // طلب من: سود = درآمد؛ همان یک تراکنش با سهم سود روی خودش
      payload.interest = sp.interest;
    } else {
      // بدهی من: یک تراکنش دو قلمی — اصل در پاکت قرض، بهره در پاکت انتخابی
      payload.kind = 'invoice';
      payload.cat = null;
      payload.lines = [];
      if (sp.principal > 0) payload.lines.push({ id: pay.id + '_p', name: tr('اصل قرض'), unitPrice: sp.principal, qty: 1, unit: '', amount: sp.principal, cat: LOAN_CAT, sub: '', reflect: '' });
      payload.lines.push({ id: pay.id + '_i', name: tr('بهرهٔ قرض'), unitPrice: sp.interest, qty: 1, unit: '', amount: sp.interest, cat: d.interestCat || 'need', sub: d.interestSub || '', reflect: '' });
    }
  }
  if (t) Object.assign(t, payload);
  else {
    t = Object.assign({ id: uid() }, payload);
    state.transactions.push(t);
  }
  pay.txId = t.id;
}

function syncDebtTxs(d) {
  migrateDebt(d);
  // تراکنش ایجاد (قرض دادن/گرفتن) فقط اگر حساب انتخاب شده
  if (!d.accountId || !accountById(d.accountId)) {
    removeTx(d.txId);
    d.txId = null;
  } else d.txId = upsertLinkedTx(d.txId, d, 'open');
  // هر پرداخت تسویه، حساب خودش را دارد
  for (const pay of d.payments) paymentTx(d, pay);
  d.settled = d.amount > 0 && debtPaid(d) >= debtTotal(d) - 0.000001;
  d.settledAt = d.settled ? (d.payments[d.payments.length - 1] || {}).dateISO || todayISO() : null;
}

export function delDebt(id) {
  const d = allDebts().find((x) => x.id === id);
  const linked = !!(d && (d.txId || (d.payments || []).some((x) => x.txId)));
  askConfirm(linked ? tr('این مورد و تراکنش‌های وصل‌شده به آن حذف شود؟') : tr('این مورد حذف شود؟'), () => {
    if (d) {
      removeTx(d.txId);
      for (const pay of d.payments || []) removeTx(pay.txId);
    }
    state.debts = allDebts().filter((d) => d.id !== id);
    save();
    render();
    toast(tr('حذف شد'));
  });
}

// حسابِ پیش‌فرض شیت تسویه: آخرین پرداختی که حساب داشته، وگرنه حسابِ خودِ مورد
function settlePreselect(d) {
  const withAcc = (d.payments || []).filter((p) => p.accountId && accountById(p.accountId));
  if (withAcc.length) return withAcc[withAcc.length - 1].accountId;
  return (d.accountId && accountById(d.accountId) ? d.accountId : '') || '';
}

let settlingDebtId = null;

// شیت تسویه: مبلغ (پیش‌فرض مانده)، حساب دریافت/پرداخت، تاریخ
export function settleDebt(id) {
  const d = allDebts().find((x) => x.id === id);
  if (!d) return;
  settlingDebtId = id;
  const lent = d.kind === 'in';
  const remain = debtRemaining(d);
  const cur = debtCurrency(d);
  const hist = (d.payments || [])
    .slice()
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO))
    .map((pay) => {
      const a = accountById(pay.accountId);
      const sp = paymentSplit(d, pay);
      const splitTxt = sp.interest > 0 ? ' · ' + tr('اصل {p} · سود {i}', { p: fmtShort(sp.principal), i: fmtShort(sp.interest) }) : '';
      return `<div class="item" style="min-height:48px">
        <div class="ic" style="background:var(--green-soft);color:var(--green)">${icon('check')}</div>
        <div class="mid"><div class="t1">${fmt(pay.amount)} ${esc(curName(cur))}</div><div class="t2">${fmtDate(pay.dateISO)}${a ? ' · ' + esc(a.name) : (' · ' + tr('بدون حساب'))}${splitTxt}</div></div>
        <button class="btn sm icon danger" onclick="delDebtPayment('${d.id}','${pay.id}')" aria-label="${tr('حذف')}">${icon('trash')}</button>
      </div>`;
    })
    .join('');
  openModal(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>${lent ? (tr('دریافت از') + ' ') : (tr('پرداخت به') + ' ')}${esc(d.person)}</h2>
    <div class="grid2" style="margin-bottom:12px">
      <div class="stat"><div class="lbl">${tr('کل')}</div><div class="val">${fmt(debtTotal(d))}</div>${debtInterest(d) > 0 ? `<div class="small muted">${tr('اصل {p} · سود {i}', { p: fmtShort(d.amount), i: fmtShort(debtInterest(d)) })}</div>` : ''}</div>
      <div class="stat"><div class="lbl">${tr('مانده')}</div><div class="val ${remain > 0 ? 'red' : 'green'}">${fmt(remain)}</div></div>
    </div>
    ${remain > 0 ? `
    <div class="field"><label>${tr('مبلغ این پرداخت')} (${esc(curName(cur))}) ${infoTip(tr('لازم نیست همهٔ مانده را یک‌جا بدهی؛ هر مبلغی بنویسی، بقیه سر جایش می‌ماند و دفعهٔ بعد ادامه می‌دهی.'))}</label>
      <input class="input" id="spAmount" type="number" step="any" inputmode="decimal" value="${remain}" onfocus="this.select()" oninput="debtPayPreview()">
      <div class="chips" style="margin-top:8px">
        <button type="button" class="chip" onclick="setSpAmount('${remain}')">${tr('همهٔ مانده')} · ${esc(fmtShort(remain))}</button>
        <button type="button" class="chip" onclick="setSpAmount('${Math.round((remain / 2) * 100) / 100}')">${tr('نصف مانده')} · ${esc(fmtShort(remain / 2))}</button>
        <button type="button" class="chip" onclick="setSpAmount('')">${icon('edit')} ${tr('مبلغ دلخواه')}</button>
      </div>
      <div class="hint" id="spHint" style="margin-top:8px">${tr('ماندهٔ فعلی: {r} — کمتر از این هم می‌شود داد.', { r: esc(fmt(remain)) })}</div></div>
    <div class="field"><label>${lent ? tr('به کدام حساب برگشت؟') : tr('از کدام حساب پرداخت شد؟')} ${infoTip(tr('می‌تواند با حساب اولیه فرق کند؛ مثلاً از ملت قرض داده‌ای و به ملی برگشته.'))}</label>
      ${apickHtml({ id: 'spAcc', selected: settlePreselect(d), allowNone: true, noneLabel: tr('بدون اتصال به حساب'), title: lent ? tr('به کدام حساب برگشت؟') : tr('از کدام حساب پرداخت شد؟') })}</div>
    <div class="field"><label>${tr('تاریخ')}</label><input class="input" id="spDate" type="date" value="${todayISO()}"></div>
    <button class="btn primary block" onclick="addDebtPayment('${d.id}')">${icon('check')} ${tr('ثبت')} ${lent ? tr('دریافت') : tr('پرداخت')}</button>` : ('<div class="hint" style="margin-bottom:12px;color:var(--green)">' + tr('کامل تسویه شده.') + '</div>')}
    ${hist ? `<div class="divider"></div><h3 class="muted" style="margin-bottom:8px">${tr('پرداخت‌ها')}</h3>${hist}` : ''}
  `);
  debtPayPreview();
}

// چیپس‌های مبلغِ سریع: همهٔ مانده / نصف / پاک کردن
export function setSpAmount(v) {
  const el = document.getElementById('spAmount');
  if (!el) return;
  el.value = v === '' || v == null ? '' : String(v);
  if (v === '' || v == null) { try { el.focus(); } catch (e) {} }
  debtPayPreview();
}

// «بعد از این پرداخت چقدر می‌ماند؟» — همان لحظه که تایپ می‌کنی، نه بعد از زدن دکمه
export function debtPayPreview() {
  const el = document.getElementById('spAmount');
  const box = document.getElementById('spHint');
  const d = allDebts().find((x) => x.id === settlingDebtId);
  if (!el || !box || !d) return;
  const remain = debtRemaining(d);
  const cur = debtCurrency(d);
  const v = parseFloat(el.value) || 0;
  if (!v) {
    box.innerHTML = tr('مبلغ این پرداخت را بنویس؛ می‌تواند کمتر از مانده باشد.');
    return;
  }
  if (v > remain + 1e-6) {
    box.innerHTML = `<span style="color:var(--red)">${tr('از مانده بیشتر است؛ حداکثر')} <b>${esc(fmt(remain))}</b> ${esc(curName(cur))}</span>`;
    return;
  }
  const left = remain - v;
  box.innerHTML = left <= 1e-6
    ? `<span style="color:var(--green)">${tr('با این پرداخت کامل تسویه می‌شود.')} ✓</span>`
    : tr('بعد از این پرداخت، {l} {c} مانده می‌ماند.', { l: '<b>' + esc(fmt(left)) + '</b>', c: esc(curName(cur)) });
}

export function addDebtPayment(id) {
  const d = allDebts().find((x) => x.id === id);
  if (!d) return;
  const amount = parseFloat(document.getElementById('spAmount').value);
  if (!amount || amount <= 0) return toast(tr('مبلغ را درست وارد کن'));
  if (amount > debtRemaining(d) + 0.000001) {
    debtPayPreview();
    return toast(tr('از مانده بیشتر است؛ ماندهٔ فعلی {r} — اگر می‌خواهی کمتر بدهی، مبلغ را کامل پاک کن و عدد دلخواه را بنویس.', { r: fmt(debtRemaining(d)) }));
  }
  d.payments.push({
    id: uid(),
    amount,
    dateISO: document.getElementById('spDate').value || todayISO(),
    accountId: document.getElementById('spAcc').value || '',
    txId: null,
  });
  d.updatedAt = Date.now();
  syncDebtTxs(d);
  save();
  closeModal();
  render();
  toast(d.settled ? (tr('تسویه کامل شد') + ' ✓') : (tr('ثبت شد') + ' · ' + tr('مانده') + ' ') + fmt(debtRemaining(d)));
}

export function delDebtPayment(id, payId) {
  const d = allDebts().find((x) => x.id === id);
  if (!d) return;
  const pay = d.payments.find((x) => x.id === payId);
  if (pay) removeTx(pay.txId);
  d.payments = d.payments.filter((x) => x.id !== payId);
  d.updatedAt = Date.now();
  syncDebtTxs(d);
  save();
  render();
  settleDebt(id);
}

export function findDebt(id) {
  return allDebts().find((d) => d.id === id);
}

function sortDebts(list) {
  return list.slice().sort((a, b) => {
    if (!!a.settled !== !!b.settled) return a.settled ? 1 : -1;
    const ad = a.dueISO || '9999';
    const bd = b.dueISO || '9999';
    if (ad !== bd) return ad.localeCompare(bd);
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

// واحد پول یک مورد = واحد حسابش (بدون حساب → تومان)
function debtCurrency(d) {
  const a = d.accountId && accountById(d.accountId);
  return (a && a.currency) || baseCur();
}
// معادل تومانی؛ اگر نرخ ثبت نشده باشد null
function debtToman(d) {
  const cur = debtCurrency(d);
  if (cur === baseCur()) return debtTotal(d);
  const r = rateOf(cur);
  return r ? debtTotal(d) * r : null;
}
function sumToman(list) {
  let sum = 0;
  const missing = new Set();
  for (const d of list) {
    const v = debtToman(d);
    if (v == null) missing.add(debtCurrency(d));
    else sum += v;
  }
  return { sum, missing: [...missing] };
}

function debtRow(d) {
  const mine = d.kind === 'in';
  const cur = debtCurrency(d);
  const foreign = cur !== baseCur();
  const tm = foreign ? debtToman(d) : null;
  const n = daysUntilDue(d.dueISO);
  const hot = !d.settled && n !== null && n <= 0;
  const soon = !d.settled && n !== null && n > 0 && n <= 3;
  return `
    <div class="item" style="${d.settled ? 'opacity:.62' : ''}">
      <div class="ic" style="background:${mine ? 'var(--green-soft)' : 'var(--red-soft)'};color:${mine ? 'var(--green)' : 'var(--red)'}">${icon(mine ? 'arrowIn' : 'arrowOut')}</div>
      <div class="mid" onclick="openDebtForm(findDebt('${d.id}'))">
        <div class="t1">${esc(d.person)}</div>
        <div class="t2">${mine ? tr('طلب من') : tr('بدهی من')} · ${dueLabel(d.dueISO)}${debtInterest(d) > 0 ? ' · ' + (mine ? tr('سود') : tr('بهره')) + ' ' + fmtShort(debtInterest(d)) : ''}${d.note ? ' · ' + esc(d.note) : ''}${
          d.accountId && accountById(d.accountId) ? ' · <span class="badge" style="color:#14b8a6">' + esc(accountById(d.accountId).name) + '</span>' : ''
        }</div>
      </div>
      <div style="text-align:left">
        <div class="amt ${mine ? 'in' : 'out'}">${mine ? '+' : '−'}${foreign ? fmt(debtRemaining(d)) : fmtShort(debtRemaining(d))}${foreign ? ' <span class="badge">' + esc(cur) + '</span>' : ''}</div>
        ${foreign ? `<div class="small muted">${tm == null ? (tr('نرخ') + ' ') + esc(curName(cur)) + (' ' + tr('ثبت نشده')) : '≈ ' + fmtShort(tm) + ' ' + baseCur()}</div>` : ''}
        ${!d.settled && debtPaid(d) > 0 ? `<div class="small muted">${tr('{a} از {b} تسویه شده', { a: fmtShort(debtPaid(d)), b: fmtShort(debtTotal(d)) })}</div>` : ''}
        <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:6px">${d.settled ? '' : `<button class="btn sm icon" onclick="openDebtRemind('${d.id}')" aria-label="${tr('یادآوری')}">${icon('bell')}</button>`}<button class="btn sm" onclick="settleDebt('${d.id}')">${d.settled ? tr('جزئیات') : tr('تسویه')}</button></div>
      </div>
    </div>
    ${hot ? ('<div class="small" style="color:var(--red);margin:-4px 0 10px 52px">' + tr('سررسید گذشته') + '</div>') : ''}
    ${soon ? ('<div class="small" style="color:var(--orange);margin:-4px 0 10px 52px">' + tr('نزدیک سررسید') + '</div>') : ''}`;
}

export function renderDebts() {
  const box = document.getElementById('debtsContent');
  if (!box) return;
  const list = sortDebts(allDebts());
  const open = list.filter((d) => !d.settled);
  const done = list.filter((d) => d.settled);
  const openRem = open.map((d) => Object.assign({}, d, { amount: debtRemaining(d), payback: 0 }));
  const recT = sumToman(openRem.filter((d) => d.kind === 'in'));
  const payT = sumToman(openRem.filter((d) => d.kind === 'out'));
  const rec = recT.sum;
  const pay = payT.sum;
  const missing = [...new Set([...recT.missing, ...payT.missing])];
  // ریز جمع به تفکیک واحد پول (فقط وقتی ارز خارجی هست)
  const byCur = {};
  for (const d of openRem) {
    const c = debtCurrency(d);
    byCur[c] = byCur[c] || { in: 0, out: 0 };
    byCur[c][d.kind === 'in' ? 'in' : 'out'] += d.amount || 0;
  }
  const curs = Object.keys(byCur);
  const breakdown =
    curs.length > 1 || (curs.length === 1 && curs[0] !== baseCur())
      ? `<div class="hint" style="margin:0 0 12px">${tr('به تفکیک واحد:')} ${curs
          .map((c) => `<b>${esc(curName(c))}</b> ${tr('طلب')} ${c === baseCur() ? fmtShort(byCur[c].in) : fmt(byCur[c].in)} / ${tr('بدهی')} ${c === baseCur() ? fmtShort(byCur[c].out) : fmt(byCur[c].out)}`)
          .join(' · ')}</div>`
      : '';
  const missingHint = missing.length
    ? `<div class="hint" style="color:var(--orange);margin:0 0 12px">${tr('نرخ')} ${missing.map(esc).join('، ')} ${tr('ثبت نشده؛ این موارد در جمع کل حساب نشده‌اند. نرخ را از تنظیمات')} ← ${tr('نرخ ارز وارد کن.')}</div>`
    : '';
  const notifyOn = typeof Notification !== 'undefined' && Notification.permission === 'granted';

  const net = rec - pay;
  let html = `
    <div class="hero">
      <div style="min-width:0"><div class="lbl">${icon('handshake')} ${tr('خالص طلب و بدهی')}</div>
      <div class="hero-num ${net < 0 ? 'val red' : ''}">${fmtShort(net)}</div>
      <div class="sub"><span style="color:var(--green)">${tr('طلب')} ${fmtShort(rec)}</span> · <span style="color:var(--red)">${tr('بدهی')} ${fmtShort(pay)}</span>${
        breakdown ? ` · <button type="button" class="link" style="padding:0 4px" onclick="document.getElementById('debtBreak').style.display=''">${tr('جزئیات')}</button>` : ''
      }</div></div>
      <span class="ib lg ${net < 0 ? 'red' : 'green'}">${icon(net < 0 ? 'arrowOut' : 'arrowIn')}</span>
    </div>
    <div id="debtBreak" style="display:none">${breakdown}</div>
    ${missingHint}`;

  if (!list.length) {
    html += `<div class="empty"><span class="ib lg muted">${icon('handshake')}</span>${tr('هنوز طلب یا بدهی ثبت نکرده‌ای.')}<br>${tr('مثلاً پولی که به دوستت دادی یا از کسی قرض گرفتی.')}<button type="button" class="btn sm primary" onclick="openDebtForm()">${icon('plus')} ${tr('ثبت طلب / بدهی')}</button></div>`;
  } else {
    if (open.length) html += open.map(debtRow).join('');
    if (done.length) {
      html += `<div class="divider"></div><h3 class="muted" style="margin-bottom:10px">${tr('تسویه‌شده')}</h3>`;
      html += done.map(debtRow).join('');
    }
  }
  box.innerHTML = html;
}

export function debtHomeBanner() {
  const due = dueSoonDebts(3);
  if (!due.length) return '';
  const late = due.filter((d) => daysUntilDue(d.dueISO) <= 0).length;
  const text = late
    ? toFaSafe(late) + (' ' + tr('مورد سررسید شده یا امروز است'))
    : toFaSafe(due.length) + (' ' + tr('مورد تا سه روز دیگر سررسید دارد'));
  return `<div class="banner warn">${icon('bell')}<span>${text}.</span>
    <button class="btn sm primary" style="margin-right:auto" onclick="switchTab('debts')">${tr('ببین')}</button></div>`;
}

function toFaSafe(n) {
  return String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

export async function enableDebtReminders() {
  if (typeof Notification === 'undefined') {
    toast(tr('این مرورگر یادآوری ندارد'));
    return;
  }
  const p = await Notification.requestPermission();
  if (p !== 'granted') {
    toast(tr('اجازه یادآوری داده نشد'));
    return;
  }
  toast(tr('یادآوری روشن شد'));
  notifyDueDebts(true);
  render();
}

export function notifyDueDebts(force) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const due = dueSoonDebts(0);
  if (!due.length) return;
  const day = todayISO();
  if (!force && store.get(NOTIFY_DAY_KEY) === day) return;
  store.set(NOTIFY_DAY_KEY, day);
  try {
    new Notification(tr('طلب و بدهی'), {
      body: due.length === 1
        ? due[0].person + ' — ' + dueLabel(due[0].dueISO)
        : due.length + (' ' + tr('مورد امروز یا عقب‌افتاده است')),
      tag: 'capital-debts',
    });
  } catch (e) {}
}


// ─── یادآوری به طرف مقابل: پیامک / واتساپ / اشتراک — متن آماده، ارسال با دست خودِ کاربر ────
export function normPhone(p) {
  p = String(p || '')
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[^\d+]/g, '');
  return p;
}
// شمارهٔ بین‌المللی برای واتساپ (پیش‌فرض ایران اگر با 0 شروع شود)
function intlPhone(p) {
  p = normPhone(p);
  if (!p) return '';
  if (p.startsWith('+')) return p.slice(1);
  if (p.startsWith('00')) return p.slice(2);
  if (p.startsWith('0')) return '98' + p.slice(1);
  return p;
}
function remindText(d) {
  const mine = d.kind === 'in';
  const remain = debtRemaining(d);
  const cur = debtCurrency(d);
  const amt = fmt(remain) + ' ' + curName(cur);
  const n = daysUntilDue(d.dueISO);
  let when = '';
  if (d.dueISO) {
    if (n === 0) when = tr('امروز');
    else if (n === 1) when = tr('فردا');
    else if (n !== null && n < 0) when = fmtDate(d.dueISO) + ' (' + tr('گذشته') + ')';
    else when = fmtDate(d.dueISO);
  }
  const name = d.person || '';
  if (mine) {
    return when
      ? tr('سلام {name}، یادآوری دوستانه: مبلغ {amt} که قرار بود {when} برگردانی. ممنون 🙏', { name, amt, when })
      : tr('سلام {name}، یادآوری دوستانه: مبلغ {amt} که از من قرض گرفتی. ممنون 🙏', { name, amt });
  }
  return when
    ? tr('سلام {name}، مبلغ {amt} را {when} برمی‌گردانم. ممنون از صبرت 🙏', { name, amt, when })
    : tr('سلام {name}، مبلغ {amt} را به‌زودی برمی‌گردانم. ممنون از صبرت 🙏', { name, amt });
}
export function openDebtRemind(id) {
  const d = findDebt(id);
  if (!d) return;
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  openModal(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>${tr('یادآوری به')} ${esc(d.person)}</h2>
    <div class="field"><label>${tr('شمارهٔ موبایل')}</label>
      <div class="row" style="flex-wrap:nowrap">
        <input class="input col" id="rmPhone" type="tel" inputmode="tel" dir="ltr" data-plain placeholder="0912…" value="${esc(d.phone || '')}" style="min-width:0">
        ${navigator.contacts && navigator.contacts.select ? `<button type="button" class="btn" onclick="debtPickContact('rmPhone')" aria-label="${tr('از مخاطبین')}">${icon('user')}</button>` : ''}
      </div>
    </div>
    <div class="field"><label>${tr('متن پیام')}</label>
      <textarea class="input" id="rmText" rows="4">${esc(remindText(d))}</textarea>
    </div>
    <div class="row">
      <button class="btn primary col" onclick="sendDebtRemind('${d.id}','sms')">${icon('phone')} ${tr('پیامک')}</button>
      <button class="btn col" onclick="sendDebtRemind('${d.id}','wa')">${tr('واتساپ')}</button>
      <button class="btn col" onclick="sendDebtRemind('${d.id}','${navigator.share ? 'share' : 'copy'}')">${icon(navigator.share ? 'upload' : 'copy')} ${navigator.share ? tr('اشتراک') : tr('کپی')}</button>
    </div>
    <div class="hint" style="margin-top:10px">${isIOS ? tr('پیام در برنامهٔ پیامک باز می‌شود؛ ارسال با خودت.') : tr('پیام در برنامهٔ پیامک/واتساپ باز می‌شود؛ ارسال با خودت.')}</div>
  `);
}
export async function debtPickContact(targetId) {
  try {
    const res = await navigator.contacts.select(['tel', 'name'], { multiple: false });
    const c = res && res[0];
    const tels = [...new Set(((c && c.tel) || []).map(normPhone).filter(Boolean))];
    if (!tels.length) return toast(tr('این مخاطب شماره ندارد'));
    if (!targetId) {
      const person = document.getElementById('dPerson');
      if (person && !person.value && c.name && c.name[0]) person.value = c.name[0];
    }
    const put = (tel) => {
      const el = document.getElementById(targetId || 'dPhone');
      if (el) el.value = tel;
    };
    if (tels.length === 1) return put(tels[0]);
    // چند شماره: انتخاب با یک ضربه، بدون بستن فرم زیرین
    const el = document.getElementById(targetId || 'dPhone');
    const old = document.getElementById('phonePick');
    if (old) old.remove();
    const box = document.createElement('div');
    box.id = 'phonePick';
    box.className = 'chips';
    box.style.marginTop = '8px';
    box.innerHTML = tels.map((t) => `<button type="button" class="chip" dir="ltr">${esc(t)}</button>`).join('');
    box.addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      put(b.textContent.trim());
      box.remove();
    });
    if (el && el.parentNode) el.parentNode.insertAdjacentElement('afterend', box);
  } catch (e) {}
}
export function sendDebtRemind(id, how) {
  const d = findDebt(id);
  if (!d) return;
  const phone = normPhone((document.getElementById('rmPhone') || {}).value || '');
  const text = ((document.getElementById('rmText') || {}).value || '').trim();
  if (!text) return toast(tr('متن پیام خالی است'));
  if (phone && phone !== d.phone) { d.phone = phone; d.updatedAt = Date.now(); save(); }
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  if (how === 'sms') {
    if (!phone) return toast(tr('شمارهٔ موبایل را بنویس'));
    // iOS جداکنندهٔ body را با & می‌خواهد، اندروید با ?
    window.location.href = 'sms:' + phone + (isIOS ? '&' : '?') + 'body=' + encodeURIComponent(text);
    return;
  }
  if (how === 'wa') {
    const u = phone ? 'https://wa.me/' + intlPhone(phone) + '?text=' + encodeURIComponent(text) : 'https://wa.me/?text=' + encodeURIComponent(text);
    window.open(u, '_blank', 'noopener');
    return;
  }
  if (how === 'share' && navigator.share) {
    navigator.share({ text }).catch(() => {});
    return;
  }
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(tr('کپی شد'))).catch(() => toast(tr('کپی نشد')));
}
