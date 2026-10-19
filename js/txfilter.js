// ─── فیلتر و جست‌وجوی تراکنش‌ها ─────────────────────────────────────────────
// گروه‌ها با «و» ترکیب می‌شوند؛ داخل هر گروه «یا». بازهٔ زمانی پیش‌فرض همان ماهِ صفحه است.
import { esc, fmt, fmtShort, toFa, normNum } from './utils.js';
import { t as tr } from './i18n.js';
import { icon } from './icons.js';
import { CATS, state, isTransfer, isInvoice, accountById } from './state.js';
import { subsFor, subLabel } from './subs.js';
import { curMonthKey, shiftMonth, monthLabel } from './jalali.js';
import { openModal, closeModal } from './modal.js';

export const KINDS = [
  { id: 'out', label: 'خرج', color: 'var(--red)' },
  { id: 'in', label: 'درآمد', color: 'var(--green)' },
  { id: 'transfer', label: 'انتقال', color: 'var(--purple)' },
  { id: 'plan', label: 'اقساط', color: 'var(--orange)' },
  { id: 'debt', label: 'قرض', color: 'var(--teal, #14b8a6)' },
];
export const RANGES = [
  { id: 'month', label: 'همین ماه' },
  { id: '3m', label: '۳ ماه اخیر' },
  { id: 'year', label: 'امسال' },
  { id: 'all', label: 'همه' },
];

function fresh() {
  return { q: '', kinds: [], cats: [], subs: [], accounts: [], min: null, max: null, range: 'month' };
}
export let F = fresh();
let draft = null;

const BUDGET_CATS = () => CATS.filter((c) => !c.loan && c.id !== 'loan');

export function activeCount() {
  let n = 0;
  if (F.q.trim()) n++;
  if (F.kinds.length) n++;
  if (F.cats.length) n++;
  if (F.subs.length) n++;
  if (F.accounts.length) n++;
  if (F.min != null || F.max != null) n++;
  if (F.range !== 'month') n++;
  return n;
}
export function isActive() {
  return activeCount() > 0;
}
export function reset() {
  F = fresh();
}

function kindOf(t) {
  const k = [];
  if (isTransfer(t)) k.push('transfer');
  else if (t.type === 'in') k.push('in');
  else k.push('out');
  if (t.planId) k.push('plan');
  if (t.debtId || t.cat === 'loan') k.push('debt');
  return k;
}
function catsOf(t) {
  if (isInvoice(t)) return (t.lines || []).map((l) => l.cat).filter(Boolean);
  return t.cat ? [t.cat] : [];
}
function subsOf(t) {
  if (isInvoice(t)) return (t.lines || []).map((l) => l.sub).filter(Boolean);
  return t.sub ? [t.sub] : [];
}
function textOf(t) {
  const parts = [t.note, t.planTag];
  if (isInvoice(t)) for (const l of t.lines || []) parts.push(l.name, l.title);
  if (t.debtId) {
    const d = (state.debts || []).find((x) => x.id === t.debtId);
    if (d) parts.push(d.person, d.note);
  }
  if (t.planId) {
    const p = (state.installments || []).find((x) => x.id === t.planId);
    if (p) parts.push(p.title);
  }
  const a = accountById(t.accountId);
  if (a) parts.push(a.name);
  return parts.filter(Boolean).join(' ').toLowerCase();
}
function normQ(s) {
  return String(s || '').toLowerCase().replace(/[يك]/g, (c) => (c === 'ي' ? 'ی' : 'ک')).trim();
}

function monthSet(range, pageMonth) {
  if (range === 'month') return new Set([pageMonth]);
  if (range === '3m') {
    const s = new Set();
    let k = curMonthKey();
    for (let i = 0; i < 3; i++) { s.add(k); k = shiftMonth(k, -1); }
    return s;
  }
  return null;
}
export function matches(t, pageMonth) {
  if (F.range === 'year') {
    if (String(t.month || '').split('/')[0] !== curMonthKey().split('/')[0]) return false;
  } else if (F.range !== 'all') {
    const ms = monthSet(F.range, pageMonth);
    if (ms && !ms.has(t.month)) return false;
  }
  if (F.kinds.length) {
    const k = kindOf(t);
    if (!F.kinds.some((x) => k.includes(x))) return false;
  }
  if (F.cats.length) {
    const c = catsOf(t);
    if (!F.cats.some((x) => c.includes(x))) return false;
  }
  if (F.subs.length) {
    const s = subsOf(t);
    if (!F.subs.some((x) => s.includes(x))) return false;
  }
  if (F.accounts.length && !F.accounts.includes(t.accountId)) return false;
  const amt = Number(t.amount || 0);
  if (F.min != null && amt < F.min) return false;
  if (F.max != null && amt > F.max) return false;
  if (F.q.trim()) {
    const q = normQ(F.q);
    const digits = q.replace(/[^\d]/g, '');
    const txt = normQ(textOf(t));
    const amtStr = String(Math.round(amt));
    if (!txt.includes(q) && !(digits && digits.length >= 3 && amtStr.includes(digits))) return false;
  }
  return true;
}
export function apply(txs, pageMonth) {
  return txs.filter((t) => matches(t, pageMonth));
}

// ── نوار بالای لیست: جست‌وجو + دکمهٔ فیلتر + چیپ‌های فعال ──
// چیپ‌های «نوع» (خرج/درآمد/انتقال/اقساط/قرض) عمداً این‌جا نیستند: فقط داخل شیتِ فیلتر.
export function barHtml() {
  const n = activeCount();
  const chips = [];
  if (F.range !== 'month') chips.push(chip(tr((RANGES.find((r) => r.id === F.range) || {}).label || ''), "txfSet('range','month')"));
  for (const c of F.cats) { const cat = CATS.find((x) => x.id === c); if (cat) chips.push(chip(cat.label, `txfToggle('cats','${c}')`, cat.color)); }
  for (const s of F.subs) chips.push(chip(subLabel(s), `txfToggle('subs','${s}')`));
  for (const a of F.accounts) { const acc = accountById(a); if (acc) chips.push(chip(esc(acc.name), `txfToggle('accounts','${a}')`)); }
  if (F.min != null || F.max != null) {
    const lbl = F.min != null && F.max != null ? fmtShort(F.min) + ' – ' + fmtShort(F.max) : F.min != null ? tr('از {a}', { a: fmtShort(F.min) }) : tr('تا {a}', { a: fmtShort(F.max) });
    chips.push(chip(lbl, 'txfSet(\'min\',null);txfSet(\'max\',null)'));
  }
  return `<div class="txf">
    <div class="txf-row">
      <div class="txf-search">${icon('search')}<input id="txfQ" type="search" placeholder="${tr('جست‌وجو در عنوان، یادداشت، ردیف‌ها…')}" value="${esc(F.q)}" oninput="txfQuery(this.value)" autocomplete="off"></div>
      <button type="button" class="btn sm ${n ? 'primary' : ''}" onclick="txfOpen()">${icon('filter')} ${tr('فیلتر')}${n ? ' <b>' + toFa(n) + '</b>' : ''}</button>
    </div>
    ${chips.length ? `<div class="chips txf-active">${chips.join('')}<button type="button" class="chip clear" onclick="txfClear()">${tr('پاک کردن همه')}</button></div>` : ''}
  </div>`;
}
function chip(label, off, color) {
  return `<span class="chip on" style="background:${color || 'var(--text)'}">${label}<button type="button" class="x" onclick="${off}" aria-label="${tr('حذف')}">×</button></span>`;
}

export function summaryHtml(txs) {
  if (!isActive()) return '';
  let out = 0, inn = 0;
  for (const t of txs) {
    if (isTransfer(t)) continue;
    if (t.type === 'in') inn += t.amount || 0; else out += t.amount || 0;
  }
  return `<div class="txf-sum"><span>${tr('{n} تراکنش', { n: toFa(txs.length) })}</span>
    ${out ? `<span class="red">−${fmt(out)}</span>` : ''}${inn ? `<span class="green">+${fmt(inn)}</span>` : ''}</div>`;
}

// ── شیت فیلتر کامل ──
export function openSheet() {
  draft = JSON.parse(JSON.stringify(F));
  paintSheet();
}
function paintSheet() {
  const d = draft;
  const seg = (items, cur, fn) => `<div class="seg">${items.map((x) => `<button type="button" class="${x.id === cur ? 'on' : ''}" onclick="${fn}('${x.id}')">${tr(x.label)}</button>`).join('')}</div>`;
  const toggleChip = (arr, id, label, color, key) =>
    `<button type="button" class="chip ${arr.includes(id) ? 'on' : ''}" style="${arr.includes(id) ? 'background:' + (color || 'var(--text)') : ''}" onclick="txfDraft('${key}','${id}')">${color ? '<span class="dot" style="color:' + (arr.includes(id) ? '#fff' : color) + '"></span>' : ''}${label}</button>`;
  const cats = BUDGET_CATS().map((c) => toggleChip(d.cats, c.id, c.label, c.color, 'cats')).join('');
  const subCats = d.cats.length ? d.cats : [];
  let subs = '';
  for (const cid of subCats) {
    const list = subsFor(cid) || [];
    if (!list.length) continue;
    subs += `<div class="small muted" style="margin:8px 0 4px">${(CATS.find((c) => c.id === cid) || {}).label || ''}</div><div class="chips">${list.map((s) => toggleChip(d.subs, s.id, subLabel(s.id), null, 'subs')).join('')}</div>`;
  }
  const accs = state.accounts.map((a) => toggleChip(d.accounts, a.id, esc(a.name), null, 'accounts')).join('');
  const kinds = KINDS.map((k) => toggleChip(d.kinds, k.id, tr(k.label), k.color, 'kinds')).join('');
  openModal(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>${tr('فیلتر تراکنش‌ها')}</h2>
    <div class="small muted" style="margin-bottom:6px">${tr('بازهٔ زمانی')}</div>
    ${seg(RANGES, d.range, 'txfDraftRange')}
    <div class="small muted" style="margin:14px 0 6px">${tr('نوع')}</div>
    <div class="chips">${kinds}</div>
    <div class="small muted" style="margin:14px 0 6px">${tr('پاکت')}</div>
    <div class="chips">${cats}</div>
    ${subs}
    ${state.accounts.length > 1 ? `<div class="small muted" style="margin:14px 0 6px">${tr('حساب')}</div><div class="chips">${accs}</div>` : ''}
    <div class="small muted" style="margin:14px 0 6px">${tr('مبلغ')}</div>
    <div class="row">
      <div class="field" style="flex:1;margin:0"><input class="input money" id="txfMin" inputmode="decimal" placeholder="${tr('از')}" value="${d.min != null ? d.min : ''}" oninput="txfDraftAmt()"></div>
      <div class="field" style="flex:1;margin:0"><input class="input money" id="txfMax" inputmode="decimal" placeholder="${tr('تا')}" value="${d.max != null ? d.max : ''}" oninput="txfDraftAmt()"></div>
    </div>
    <div class="row" style="margin-top:16px">
      <button type="button" class="btn" style="flex:1" onclick="txfDraftClear()">${tr('پاک کردن')}</button>
      <button type="button" class="btn primary" style="flex:2" onclick="txfApply()">${tr('نمایش نتایج')}</button>
    </div>
  `);
}

// ── هندلرهای سراسری (روی window) ──
let rerender = () => {};
export function onChange(fn) { rerender = fn; }

export function txfQuery(v) {
  F.q = v || '';
  rerender({ keepFocus: true });
}
// چیپ‌های «نوع» دیگر در نوارِ بالای لیست رندر نمی‌شوند (فقط داخل شیتِ فیلتر)؛
// این هندلر برای صدا زدنِ برنامه‌ای/دیباگ نگه داشته شده است.
export function txfKind(id) {
  const i = F.kinds.indexOf(id);
  if (i >= 0) F.kinds.splice(i, 1); else F.kinds.push(id);
  rerender();
}
export function txfToggle(key, id) {
  const arr = F[key];
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1); else arr.push(id);
  if (key === 'cats') F.subs = F.subs.filter((s) => F.cats.some((c) => (subsFor(c) || []).some((x) => x.id === s)));
  rerender();
}
export function txfSet(key, val) {
  F[key] = val;
  rerender();
}
export function txfClear() {
  reset();
  rerender();
}
export function txfOpen() { openSheet(); }
export function txfDraft(key, id) {
  const arr = draft[key];
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1); else arr.push(id);
  if (key === 'cats') draft.subs = draft.subs.filter((s) => draft.cats.some((c) => (subsFor(c) || []).some((x) => x.id === s)));
  txfDraftAmt();
  paintSheet();
}
export function txfDraftRange(id) { draft.range = id; txfDraftAmt(); paintSheet(); }
export function txfDraftAmt() {
  const g = (id) => { const el = document.getElementById(id); if (!el) return undefined; const v = normNum(el.value); return v ? Number(v) : null; };
  const mn = g('txfMin'), mx = g('txfMax');
  if (mn !== undefined) draft.min = mn;
  if (mx !== undefined) draft.max = mx;
}
export function txfDraftClear() { draft = fresh(); paintSheet(); }
export function txfApply() {
  txfDraftAmt();
  F = draft; draft = null;
  closeModal();
  rerender();
}

// ورود از گزارش: فیلتر آماده
export function presetFilter(patch) {
  reset();
  Object.assign(F, patch || {});
}
