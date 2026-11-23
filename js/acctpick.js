// انتخابگر حساب — موزاییکِ همهٔ حساب‌ها (لوگوی بانک + موجودی) در یک نوارِ کشیدنی به
// چپ و راست، به‌همراه شیت کامل با گروه‌بندی و جست‌وجو. اندازهٔ هر کاشی همان چیپِ قبلی است؛
// فقط به‌جایِ «چند تا پرکاربرد + دکمهٔ همه»، همه‌شان در همان نوار می‌آیند و با کشیدن
// انگشت پیدا می‌شوند. با exclude می‌شود حساب‌هایی را از فهرست بیرون گذاشت (مثلاً در
// انتقال، حسابِ مبدأ در فهرستِ مقصد نمی‌آید).
//
// چرا select پنهان؟ همهٔ فرم‌های برنامه (تراکنش، انتقال، طلب/بدهی، اقساط) مقدار حساب را
// با document.getElementById(id).value می‌خوانند و بعضی‌ها onchange روی همان select دارند.
// با نگه‌داشتن همان <select> (فقط پنهان) هیچ‌کدام از آن کدها نمی‌شکنند: ویجت فقط
// value را ست می‌کند و رویداد change می‌فرستد تا onchange قبلی هم اجرا شود.
import {
  state,
  accountById,
  activeAccounts,
  accountGroups,
  accountOptGroups,
  accountCurrent,
  institutionOf,
  currencyInfo,
  curName,
} from './state.js';
import { bankOf, exchangeOf, exchangeIconHtml } from './cards.js';
import { icon } from './icons.js';
import { t as tr } from './i18n.js';
import { esc, fmt, fmtShort, toFa, store, haptic } from './utils.js';
import { openSubModal, closeSubModal } from './modal.js';

const LAST_ACCT_KEY = 'capital_last_account';
const TYPE_COLOR = {
  'کارت بانکی': '#0e7490',
  نقدی: '#16a34a',
  'ارز دیجیتال': '#b45309',
  'کیف پول آنلاین': '#7c3aed',
  سایر: '#475569',
};
// تنظیمات هر نمونهٔ ویجت (id → {allowNone, noneLabel, compact, title, max})
const REG = new Map();

// ── آیکن حساب: لوگوی واقعی بانک → لوگوی صرافی → مونوگرام رنگی بر اساس نوع ──
export function acctVisual(a) {
  const b = bankOf(a);
  if (b && b.logo) return { html: `<img class="aplogo" src="${b.logo}" alt="" loading="lazy">`, brand: b.dark, light: true };
  const ex = exchangeOf((a && (a.bank || a.name)) || '');
  if (ex) return { html: exchangeIconHtml(ex, 'aplogo-svg'), brand: ex.color, light: false };
  const type = (a && a.type) || '';
  const ic = type === 'نقدی' ? 'cash' : type === 'ارز دیجیتال' ? 'coin' : type === 'کیف پول آنلاین' ? 'phone' : type === 'سایر' ? 'wallet' : 'card';
  return { html: icon(ic), brand: (b && b.dark) || TYPE_COLOR[type] || '#475569', light: false };
}

// موجودی کوتاه برای چیپس/ردیف‌ها (در حالت حریم خصوصی همان «••••» می‌شود)
export function acctBalText(a) {
  return fmtShort(accountCurrent(a), currencyInfo(a.currency));
}

// ── حساب‌های پرکاربرد: تراکنش‌های اخیر وزن بیشتری دارند ──
function usageScore(a) {
  const now = Date.now();
  let s = 0;
  for (const t of state.transactions || []) {
    if (t.accountId !== a.id) continue;
    const age = now - (t.updatedAt || 0);
    s += age < 30 * 864e5 ? 3 : age < 90 * 864e5 ? 2 : 1;
  }
  return s;
}

// همهٔ حساب‌ها به ترتیبِ کاربرد: حسابِ انتخاب‌شده اول (حتی اگر بایگانی باشد)، بعد
// پرکاربردها، بعد بقیه — تا اولین کاشیِ نوار همان باشد که احتمالاً می‌خواهی.
export function rankedAccounts(selectedId, excludeIds) {
  const ex = new Set((excludeIds || []).filter(Boolean));
  const out = [];
  const sel = selectedId && !ex.has(selectedId) ? accountById(selectedId) : null;
  if (sel) out.push(sel);
  const last = store.get(LAST_ACCT_KEY);
  const ranked = activeAccounts()
    .filter((a) => !ex.has(a.id))
    .sort(
      (x, y) =>
        usageScore(y) - usageScore(x) ||
        (y.id === last ? 1 : 0) - (x.id === last ? 1 : 0) ||
        (y.updatedAt || 0) - (x.updatedAt || 0)
    );
  for (const a of ranked) if (!out.some((z) => z.id === a.id)) out.push(a);
  return out;
}

export function favoriteAccounts(selectedId, n = 4) {
  return rankedAccounts(selectedId).slice(0, n);
}

// ── ویجت ──
function chipHtml(id, a, on) {
  const v = acctVisual(a);
  return `<button type="button" class="achip ${on ? 'on' : ''}" data-a="${esc(a.id)}" onclick="apickChoose('${id}','${a.id}')">
      <span class="achip-ic ${v.light ? 'logo' : ''}" style="--br:${v.brand}">${v.html}</span>
      <span class="achip-tx"><b>${esc(a.name)}</b><small>${esc(acctBalText(a))}</small></span>
    </button>`;
}

function noneChipHtml(id, cfg, on) {
  return `<button type="button" class="achip ${on ? 'on' : ''}" onclick="apickChoose('${id}','')">
      <span class="achip-ic" style="--br:#64748b">${icon('eyeOff')}</span>
      <span class="achip-tx"><b>${esc(cfg.noneLabel || tr('بدون حساب'))}</b></span>
    </button>`;
}

function btnInner(id, selected) {
  const cfg = REG.get(id) || {};
  const a = selected ? accountById(selected) : null;
  if (!a) {
    return `<span class="achip-ic" style="--br:#64748b">${icon('eyeOff')}</span>
      <span class="apbtn-tx"><b>${esc(cfg.noneLabel || tr('انتخاب حساب'))}</b></span>
      <span class="apbtn-ar">${icon('chevD')}</span>`;
  }
  const v = acctVisual(a);
  return `<span class="achip-ic ${v.light ? 'logo' : ''}" style="--br:${v.brand}">${v.html}</span>
    <span class="apbtn-tx"><b>${esc(a.name)}</b><small>${esc(acctBalText(a))}</small></span>
    <span class="apbtn-ar">${icon('chevD')}</span>`;
}

function widgetHtml(id, selected) {
  const cfg = REG.get(id) || {};
  const list = rankedAccounts(selected, cfg.exclude);
  // حسابی نمانده (یا هنوز حسابی نساخته‌ای): همان دکمهٔ فشرده که شیت را باز می‌کند
  if (!list.length) return `<button type="button" class="apbtn" id="${id}_btn" onclick="openAcctSheet('${id}')">${btnInner(id, selected)}</button>`;
  const parts = [];
  if (cfg.allowNone) parts.push(noneChipHtml(id, cfg, !selected));
  for (const a of list) parts.push(chipHtml(id, a, a.id === selected));
  parts.push(
    `<button type="button" class="achip more" onclick="openAcctSheet('${id}')">
      <span class="achip-ic" style="--br:var(--accent)">${icon('search')}</span>
      <span class="achip-tx"><b>${tr('همهٔ حساب‌ها')}</b><small>${toFa(activeAccounts().length)}</small></span>
    </button>`
  );
  return parts.join('');
}

// o: {id, selected, allowNone, noneLabel, compact, title, onchange, wrapClass, max}
export function apickHtml(o) {
  const id = o.id;
  REG.set(id, {
    allowNone: !!o.allowNone,
    noneLabel: o.noneLabel || '',
    compact: !!o.compact,
    title: o.title || '',
    max: o.max || 3,
    exclude: normExclude(o.exclude),
  });
  const selected = o.selected == null ? '' : String(o.selected);
  const opts = optionsHtml(id, selected);
  return `<select class="input apick-sel" id="${esc(id)}" style="display:none"${o.onchange ? ` onchange="${o.onchange}"` : ''}>${opts}</select>
    <div class="apick ${o.wrapClass || ''}" id="${esc(id)}_ap">${widgetHtml(id, selected)}</div>`;
}

function normExclude(x) {
  return (Array.isArray(x) ? x : x ? [x] : []).map(String).filter(Boolean);
}

// گزینه‌های همان <select> پنهان: بدونِ حساب‌های بیرون‌گذاشته‌شده
function optionsHtml(id, selected) {
  const cfg = REG.get(id) || {};
  const list = rankedAccounts(selected, cfg.exclude);
  const none = cfg.allowNone ? `<option value="" ${!selected ? 'selected' : ''}>${esc(cfg.noneLabel || tr('بدون حساب'))}</option>` : '';
  return none + accountOptGroups(selected, list);
}

function rebuildOptions(id) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const cur = sel.value || '';
  sel.innerHTML = optionsHtml(id, cur);
  sel.value = cur;
  if (sel.value !== cur && cur) {
    // حسابِ بایگانی/بیرون‌گذاشته‌شده‌ای که گزینه نداشت: اضافه شود تا انتخاب گم نشود
    const a = accountById(cur);
    if (a) {
      sel.insertAdjacentHTML('beforeend', `<option value="${esc(cur)}">${esc(a.name)}</option>`);
      sel.value = cur;
    }
  }
}

// بیرون گذاشتنِ حساب‌ها از یک ویجتِ ساخته‌شده (مثلاً حسابِ مبدأ از فهرستِ مقصدِ انتقال)
export function apickSetExclude(id, ids) {
  const cfg = REG.get(id);
  const sel = document.getElementById(id);
  if (!cfg || !sel) return;
  cfg.exclude = normExclude(ids);
  const cur = sel.value || '';
  if (cfg.exclude.includes(cur)) {
    // مقدارِ فعلی دیگر در فهرست نیست: اولین حسابِ ممکن جایش می‌نشیند
    const alt = rankedAccounts('', cfg.exclude)[0];
    const next = alt ? alt.id : (cfg.allowNone ? '' : '');
    if (next && next !== cur) {
      rebuildOptions(id);
      sel.value = next;
      haptic(4);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      apickPaint(id);
      return;
    }
  }
  rebuildOptions(id);
  apickPaint(id);
}

// بازسازی ویجت بعد از هر تغییری که بیرون از ویجت انجام شده (مثلاً ست‌شدن value در کد)
export function apickPaint(id) {
  const sel = document.getElementById(id);
  const box = document.getElementById(id + '_ap');
  if (!sel || !box) return;
  box.innerHTML = widgetHtml(id, sel.value || '');
}

export function apickChoose(id, acctId) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const cfg = REG.get(id) || {};
  if (acctId && (cfg.exclude || []).includes(String(acctId))) return; // مثلاً حسابِ مبدأ در مقصد
  const want = acctId || '';
  if (sel.value !== want) {
    sel.value = want;
    if (sel.value !== want && want) {
      // حساب بایگانی‌شده‌ای که در optionها نیست: اضافه‌اش کن تا انتخاب گم نشود
      const a = accountById(want);
      if (a) {
        sel.insertAdjacentHTML('beforeend', `<option value="${esc(want)}">${esc(a.name)}</option>`);
        sel.value = want;
      }
    }
    haptic(4);
    sel.dispatchEvent(new Event('change', { bubbles: true })); // onchange قبلیِ همان فیلد اجرا می‌شود
  }
  apickPaint(id);
  closeSubModal();
}

// ── شیت کامل ──
function rowHtml(id, a, cur) {
  const v = acctVisual(a);
  return `<button type="button" class="srow" onclick="apickChoose('${id}','${a.id}')">
      <span class="sic ${v.light ? 'logo' : ''}" style="background:${v.brand}">${v.html}</span>
      <span class="smid"><span class="st1">${esc(a.name)}${a.last4 ? ` <span class="ap-l4" dir="ltr">${toFa(a.last4)}</span>` : ''}${a.archived ? ` <span class="ap-arch">${tr('بایگانی')}</span>` : ''}</span>
        <span class="st2">${esc(tr(a.type || 'سایر'))} · ${esc(curName(a.currency))} · ${esc(acctBalText(a))}</span></span>
      <span class="sval">${a.id === cur ? icon('check') : ''}</span>
    </button>`;
}

export function sheetListHtml(id, q) {
  const sel = document.getElementById(id);
  const cur = sel ? sel.value || '' : '';
  const cfg = REG.get(id) || {};
  const needle = String(q || '').trim().toLowerCase();
  const ex = new Set(cfg.exclude || []);
  let list = activeAccounts().filter((a) => !ex.has(a.id));
  const selA = cur && !ex.has(cur) ? accountById(cur) : null;
  if (selA && !list.some((a) => a.id === selA.id)) list = [...list, selA];
  if (needle) {
    list = list.filter((a) =>
      [a.name, a.bank, a.last4, a.type, curName(a.currency), institutionOf(a) || ''].join(' ').toLowerCase().includes(needle)
    );
  }
  if (!list.length) return `<div class="hint">${needle ? tr('حسابی با این اسم پیدا نشد.') : tr('هنوز حسابی نساخته‌ای.')}</div>`;
  const gs = accountGroups(list);
  const grouped = gs.length > 1 || (gs[0] && gs[0].key !== '__none');
  const noneRow = cfg.allowNone
    ? `<div class="sgroup"><button type="button" class="srow" onclick="apickChoose('${id}','')">
        <span class="sic" style="background:#64748b">${icon('eyeOff')}</span>
        <span class="smid"><span class="st1">${esc(cfg.noneLabel || tr('بدون حساب'))}</span>
          <span class="st2">${tr('بدون تأثیر روی موجودی حساب‌ها')}</span></span>
        <span class="sval">${!cur ? icon('check') : ''}</span></button></div>`
    : '';
  return (
    noneRow +
    gs
      .map(
        (g) =>
          (grouped && !needle ? `<div class="apgrp">${icon('bank')} ${esc(g.label)}</div>` : '') +
          `<div class="sgroup">${g.accts.map((a) => rowHtml(id, a, cur)).join('')}</div>`
      )
      .join('')
  );
}

export function openAcctSheet(id) {
  const cfg = REG.get(id) || {};
  haptic(4);
  openSubModal(`
    <button class="x" onclick="closeSubModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>${esc(cfg.title || tr('کدام حساب؟'))}</h2>
    <div class="apsearch"><span class="apsearch-ic">${icon('search')}</span>
      <input class="input" id="apQ" placeholder="${tr('جست‌وجوی حساب، بانک یا ۴ رقم آخر…')}" autocomplete="off" oninput="apickQuery('${id}', this.value)">
    </div>
    <div class="aplist" id="apList">${sheetListHtml(id, '')}</div>
  `);
  const q = document.getElementById('apQ');
  if (q) setTimeout(() => { try { q.focus(); } catch (e) {} }, 60);
}

export function apickQuery(id, q) {
  const box = document.getElementById('apList');
  if (box) box.innerHTML = sheetListHtml(id, q);
}
