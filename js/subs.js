// ─── زیرشاخه‌ها: طبقه‌بندی زیر پاکت‌ها + یادگیری از عنوان + گزارش سه‌سطحی ─────────
// مدل داده:
//   tx.sub / line.sub  → کلید زیرشاخه (اختیاری)
//   state.titleMap[norm(title)] = { cat, sub, amt, n, at }   ← یادگیری از ثبت‌های قبلی
import { t as tr } from './i18n.js';
import { state, CATS, catById, isTransfer, isInvoice, isLoanTx, txAmountToman, spendRatio, catShare, catCarried } from './state.js';
import { toFa, fmt, fmtShort, esc, pctSign } from './utils.js';
import { curMonthKey, shiftMonth, monthLabel } from './jalali.js';
import { icon } from './icons.js';
import { lockedReportHtml } from './clarity.js';

// ── فهرست زیرشاخه‌ها (کلید ثابت؛ برچسب از دیکشنری) ──
export const SUBS = [
  // ضروریات
  { id: 'grocery', cat: 'need', fa: 'خوراکی و سوپرمارکت', en: 'Groceries' },
  { id: 'housing', cat: 'need', fa: 'مسکن و اجاره', en: 'Housing & rent' },
  { id: 'bills', cat: 'need', fa: 'قبوض و اینترنت', en: 'Bills & internet' },
  { id: 'transport', cat: 'need', fa: 'حمل‌ونقل و بنزین', en: 'Transport & fuel' },
  { id: 'health', cat: 'need', fa: 'سلامت و درمان', en: 'Health' },
  { id: 'insurance', cat: 'need', fa: 'بیمه', en: 'Insurance' },
  { id: 'clothing', cat: 'need', fa: 'پوشاک', en: 'Clothing' },
  { id: 'kids', cat: 'need', fa: 'فرزند و نگه‌داری', en: 'Kids & childcare' },
  { id: 'home', cat: 'need', fa: 'لوازم خانه و تعمیرات', en: 'Home & repairs' },
  { id: 'education', cat: 'need', fa: 'تحصیل و مدرسه', en: 'Education' },
  // آزادی مالی
  { id: 'emergency', cat: 'invest', fa: 'صندوق اضطراری', en: 'Emergency fund' },
  { id: 'invest', cat: 'invest', fa: 'سرمایه‌گذاری', en: 'Investing' },
  { id: 'retire', cat: 'invest', fa: 'بازنشستگی و آینده', en: 'Retirement' },
  { id: 'self', cat: 'invest', fa: 'سرمایه‌گذاری روی خودت', en: 'Self-investment' },
  { id: 'prepay', cat: 'invest', fa: 'بازپرداخت زودتر از موعد', en: 'Extra debt payoff' },
  // تفریح
  { id: 'eatout', cat: 'fun', fa: 'رستوران و کافه', en: 'Eating out' },
  { id: 'travel', cat: 'fun', fa: 'سفر', en: 'Travel' },
  { id: 'subscribe', cat: 'fun', fa: 'اشتراک و سرگرمی دیجیتال', en: 'Subscriptions' },
  { id: 'sport', cat: 'fun', fa: 'ورزش و باشگاه', en: 'Sports & gym' },
  { id: 'beauty', cat: 'fun', fa: 'زیبایی و آرایشگاه', en: 'Beauty' },
  { id: 'shopping', cat: 'fun', fa: 'خرید دلخواه', en: 'Shopping' },
  { id: 'hobby', cat: 'fun', fa: 'سرگرمی', en: 'Hobbies' },
  // نیکوکاری
  { id: 'family', cat: 'charity', fa: 'کمک مالی به خانواده', en: 'Family support' },
  { id: 'charity', cat: 'charity', fa: 'خیریه', en: 'Charity' },
  { id: 'gift', cat: 'charity', fa: 'هدیه', en: 'Gifts' },
  { id: 'religious', cat: 'charity', fa: 'نذر و مذهبی', en: 'Religious' },
  // هدررفت — «دلیل»
  { id: 'impulse', cat: 'waste', fa: 'خرید احساسی', en: 'Impulse buy' },
  { id: 'unused', cat: 'waste', fa: 'استفاده نشد', en: 'Went unused' },
  { id: 'fee', cat: 'waste', fa: 'کارمزد و جریمهٔ قابل‌اجتناب', en: 'Avoidable fee' },
  { id: 'duplicate', cat: 'waste', fa: 'تکراری / فراموش‌شده', en: 'Duplicate / forgotten' },
  { id: 'spoiled', cat: 'waste', fa: 'خراب یا ضایع شد', en: 'Spoiled / wasted' },
];
const SUB_BY_ID = Object.fromEntries(SUBS.map((s) => [s.id, s]));

function isFa() {
  return (document.documentElement.lang || 'fa') !== 'en';
}
export function subLabel(id) {
  if (!id) return tr('دسته‌بندی‌نشده');
  const s = SUB_BY_ID[id];
  if (s) return isFa() ? s.fa : s.en;
  const c = (state.customSubs || []).find((x) => x.id === id);
  return c ? c.label : id;
}
export function subOf(id) {
  return SUB_BY_ID[id] || (state.customSubs || []).find((x) => x.id === id) || null;
}
export function subsFor(catId) {
  return SUBS.filter((s) => s.cat === catId).concat((state.customSubs || []).filter((s) => s.cat === catId));
}
export function countSubUse(id) {
  let n = 0;
  for (const tx of state.transactions) {
    if (tx.sub === id) n++;
    for (const l of tx.lines || []) if (l.sub === id) n++;
  }
  return n;
}
export function renameCustomSub(id, label) {
  const x = (state.customSubs || []).find((s) => s.id === id);
  if (x) x.label = label;
}
export function removeCustomSub(id) {
  state.customSubs = (state.customSubs || []).filter((s) => s.id !== id);
  const now = Date.now();
  for (const tx of state.transactions) {
    let hit = false;
    if (tx.sub === id) { tx.sub = ''; hit = true; }
    for (const l of tx.lines || []) if (l.sub === id) { l.sub = ''; hit = true; }
    if (hit) tx.updatedAt = now;
  }
  for (const k of Object.keys(state.titleMap || {})) if (state.titleMap[k].sub === id) state.titleMap[k].sub = '';
}
export function addCustomSub(catId, label) {
  label = String(label || '').trim();
  if (!label) return null;
  if (!state.customSubs) state.customSubs = [];
  const found = state.customSubs.find((s) => s.cat === catId && s.label === label);
  if (found) return found.id;
  const id = 'c_' + normTitle(label).replace(/\s+/g, '_').slice(0, 24) + '_' + Math.random().toString(36).slice(2, 6);
  state.customSubs.push({ id, cat: catId, label });
  return id;
}

// ── نرمال‌سازی عنوان: فاصله/نیم‌فاصله، ی/ک عربی، اعداد، علائم ──
export function normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[ي]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/[ۀة]/g, 'ه')
    .replace(/[\u200c\u200f\u200e]/g, ' ')
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/\p{M}/gu, '') // اعراب (کِتاب → کتاب)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── گروه‌بندی عنوان‌ها: «نان تست سحر» و «نان تست سه نان» زیر «نان تست» ──
// state.titleGroups = { کلیدِ نرمالِ عضو: کلیدِ نرمالِ سرگروه } ؛ تراکنش‌ها دست نمی‌خورند.
// state.titleNo = ['k1|k2', ...] پیشنهادهای ردشده (تا دوباره پرسیده نشود)
export function groupOf(key) {
  const g = state.titleGroups || {};
  let k = key;
  for (let i = 0; i < 5 && g[k] && g[k] !== k; i++) k = g[k];
  return k;
}
export function titleKey(title) {
  return groupOf(normTitle(title) || '—');
}
export function groupMembers(key) {
  const g = state.titleGroups || {};
  return Object.keys(g).filter((k) => g[k] === key);
}
export function groupTitle(key) {
  const tm = state.titleMap && state.titleMap[key];
  return (tm && tm.title) || key;
}
export function mergeTitles(keys, canonKey) {
  if (!state.titleGroups) state.titleGroups = {};
  for (const k of keys) {
    if (k === canonKey) continue;
    for (const m of groupMembers(k)) state.titleGroups[m] = canonKey; // اعضای قبلی هم منتقل شوند
    state.titleGroups[k] = canonKey;
  }
  delete state.titleGroups[canonKey];
  state.titleGroupsAt = Date.now();
}
export function ungroupTitle(key) {
  if (!state.titleGroups) return;
  delete state.titleGroups[key];
  state.titleGroupsAt = Date.now();
}
export function rejectGroup(keys) {
  if (!state.titleNo) state.titleNo = [];
  const id = [...keys].sort().join('|');
  if (!state.titleNo.includes(id)) state.titleNo.push(id);
  state.titleGroupsAt = Date.now();
}
function allItems() {
  const items = [];
  for (const tx of state.transactions) {
    if (tx.type !== 'out' || isTransfer(tx) || isLoanTx(tx)) continue;
    if (isInvoice(tx)) for (const l of tx.lines || []) { if (l.cat !== 'loan') items.push({ cat: l.cat, sub: l.sub || '', title: l.name || '' }); }
    else items.push({ cat: tx.cat, sub: tx.sub || '', title: tx.note || '' });
  }
  return items;
}
// پیشنهاد محافظه‌کارانه: هم‌پاکت، کلمهٔ اول ≥ ۳ حرف یکی، و کوتاه‌ترین «پیشوندِ کلمه‌کاملِ» بقیه باشد
export function suggestGroups(catId, sub) {
  const seen = new Map();
  for (const it of allItems()) {
    if (catId && it.cat !== catId) continue;
    if (sub != null && (it.sub || '') !== (sub || '')) continue;
    const k = normTitle(it.title);
    if (!k || k === '—') continue;
    if (groupOf(k) !== k) continue; // قبلاً عضو گروهی است
    const e = seen.get(k) || { key: k, title: it.title, n: 0, cat: it.cat };
    e.n++;
    seen.set(k, e);
  }
  const byFirst = new Map();
  for (const k of seen.keys()) {
    const w = k.split(' ')[0];
    if (w.length < 3) continue;
    if (!byFirst.has(w)) byFirst.set(w, []);
    byFirst.get(w).push(k);
  }
  const no = new Set(state.titleNo || []);
  const out = [];
  for (const [, ks] of byFirst) {
    if (ks.length < 2) continue;
    const sorted = ks.slice().sort((a, b) => a.length - b.length);
    const head = sorted[0];
    const members = sorted.filter((k) => k === head || k.startsWith(head + ' '));
    if (members.length < 2) continue;
    if (no.has(members.slice().sort().join('|'))) continue;
    out.push({ canon: head, keys: members, titles: members.map((k) => seen.get(k).title), cat: seen.get(head).cat, n: members.reduce((a, k) => a + seen.get(k).n, 0) });
  }
  return out.sort((a, b) => b.n - a.n);
}

// ── یادگیری: هر ثبت با عنوان → نگاشت عنوان به (پاکت، زیرشاخه، آخرین مبلغ) ──
export function learnTitle(title, cat, sub, amt, tags) {
  const k = normTitle(title);
  if (!k || k.length < 2) return;
  if (!state.titleMap) state.titleMap = {};
  const prev = state.titleMap[k] || { n: 0 };
  state.titleMap[k] = { cat: cat || prev.cat || 'need', sub: sub || prev.sub || '', tags: Array.isArray(tags) ? tags.slice() : prev.tags || [], amt: amt || prev.amt || 0, n: (prev.n || 0) + 1, at: Date.now(), title: String(title).trim() };
}
export function lookupTitle(title) {
  const k = normTitle(title);
  if (!k || !state.titleMap) return null;
  return state.titleMap[k] || state.titleMap[groupOf(k)] || null;
}

// ── پیشنهاد عنوان: پرتکرارترین‌های ۹۰ روز اخیر با وزن تازگی و ساعت روز ──
const SEED = {
  need: ['نان', 'شیر', 'میوه', 'تاکسی', 'بنزین', 'دارو', 'قبض برق', 'اینترنت'],
  invest: ['طلا', 'صندوق', 'سهام', 'پس‌انداز'],
  fun: ['کافه', 'رستوران', 'سینما', 'اشتراک'],
  charity: ['خیریه', 'هدیه', 'نذری'],
  waste: [],
};
export function suggestTitles(catId, limit) {
  limit = limit || 8;
  const now = Date.now();
  const hour = new Date().getHours();
  const since = now - 90 * 864e5;
  const score = new Map();
  const bump = (title, cat, sub, amt, at, hourAt) => {
    const k0 = normTitle(title);
    if (!k0) return;
    const k = groupOf(k0);
    if (k !== k0) title = groupTitle(k); // چیپ با نام سرگروه
    let w = 1;
    if (at) w += Math.max(0, 1 - (now - at) / (90 * 864e5)); // تازگی
    if (hourAt != null && Math.abs(hourAt - hour) <= 2) w += 0.5; // ساعت روز
    const e = score.get(k) || { title: String(title).trim(), cat, sub: sub || '', amt: amt || 0, w: 0, n: 0 };
    e.w += w;
    e.n++;
    if (amt) e.amt = amt;
    if (sub) e.sub = sub;
    score.set(k, e);
  };
  for (const tx of state.transactions) {
    if (tx.type !== 'out' || isTransfer(tx) || isLoanTx(tx)) continue;
    if ((tx.updatedAt || 0) < since) continue;
    const h = tx.updatedAt ? new Date(tx.updatedAt).getHours() : null;
    if (isInvoice(tx)) {
      for (const l of tx.lines || []) if (!catId || l.cat === catId) bump(l.name, l.cat, l.sub, l.amount, tx.updatedAt, h);
    } else if (tx.note && (!catId || tx.cat === catId)) bump(tx.note, tx.cat, tx.sub, tx.amount, tx.updatedAt, h);
  }
  const out = [...score.values()].sort((a, b) => b.w - a.w).slice(0, limit);
  if (out.length < 4 && catId && SEED[catId]) {
    for (const s of SEED[catId]) {
      if (out.length >= limit) break;
      if (!out.some((o) => normTitle(o.title) === normTitle(s))) {
        const m = lookupTitle(s);
        out.push({ title: s, cat: catId, sub: (m && m.sub) || '', amt: (m && m.amt) || 0, w: 0, n: 0, seed: true });
      }
    }
  }
  return out;
}

// ── HTML چیپ‌های عنوان + زیرشاخه (برای فرم‌ها) ──
export function titleChipsHtml(catId, onPick) {
  const list = suggestTitles(catId, 8);
  if (!list.length) return '';
  return `<div class="tchips">${list
    .map((s) => `<button type="button" class="tchip ${s.seed ? 'seed' : ''}" data-title="${esc(s.title)}" data-sub="${esc(s.sub || '')}" data-amt="${s.amt || 0}" onclick="${onPick}(this)">${esc(s.title)}${s.amt ? `<small>${fmtShort(s.amt)}</small>` : ''}</button>`)
    .join('')}</div>`;
}
export function subChipsHtml(catId, selected, onPick, extra) {
  const list = subsFor(catId);
  const ex = extra ? ",'" + extra + "'" : '';
  return `<div class="chips subchips">${list
    .map((s) => `<button type="button" class="chip sub ${s.id === selected ? 'on' : ''}" data-sub="${s.id}" onclick="${onPick}(this${ex})">${subLabel(s.id)}</button>`)
    .join('')}<button type="button" class="chip sub add" data-sub="__add" onclick="${onPick}(this${ex})">+ ${tr('دلخواه')}</button>${(state.customSubs || []).some((s) => s.cat === catId) ? `<button type="button" class="chip sub add" title="${tr('زیرشاخه‌های دلخواه')}" onclick="openCustomSubs('${catId}')">${icon('settings')}</button>` : ''}</div>`;
}

// ── تجمیع برای گزارش ──
// اقلام خرج یک ماه (تراکنش ساده = یک قلم؛ فاکتور = هر خط)
export function spendItems(mk, catId) {
  const items = [];
  for (const tx of state.transactions) {
    if (tx.month !== mk || tx.type !== 'out' || isTransfer(tx) || isLoanTx(tx)) continue;
    const keep = spendRatio(tx); // بخشی که پولش برنگشته
    if (!keep) continue;
    if (isInvoice(tx)) {
      for (const l of tx.lines || []) {
        if (catId && l.cat !== catId) continue;
        items.push({ txId: tx.id, cat: l.cat, sub: l.sub || '', title: l.name || '', amount: (l.amount || 0) * (txAmountToman(tx) / (tx.amount || 1)) * keep, qty: parseFloat(l.qty) || 0, unit: l.unit || '', dateISO: tx.dateISO });
      }
    } else {
      if (catId && tx.cat !== catId) continue;
      items.push({ txId: tx.id, cat: tx.cat, sub: tx.sub || '', title: tx.note || '', amount: txAmountToman(tx) * keep, qty: parseFloat(tx.qty) || 0, unit: tx.unit || '', dateISO: tx.dateISO });
    }
  }
  return items;
}
export function subTotals(mk, catId) {
  const m = new Map();
  let total = 0;
  for (const it of spendItems(mk, catId)) {
    const e = m.get(it.sub) || { sub: it.sub, amount: 0, n: 0 };
    e.amount += it.amount;
    e.n++;
    m.set(it.sub, e);
    total += it.amount;
  }
  return { total, rows: [...m.values()].sort((a, b) => b.amount - a.amount) };
}
// میانگین وزنی: اگر همهٔ خریدها «تعداد/مقدار» دارند، میانگینِ هر واحد = کل مبلغ ÷ کل مقدار
// (۱۰ نان ۱۰ هزار + ۲۰ نان ۲۰ هزار → هر نان ۱ هزار، نه میانگین خرید ۱۵ هزار)
export function avgLabel(r) {
  if (r.allQty && r.qty > 0) return tr('میانگین هر {u}', { u: r.unit || tr('واحد') }) + ' ' + fmtShort(r.amount / r.qty);
  return tr('میانگین هر خرید') + ' ' + fmtShort(r.amount / r.n);
}
// ── گرهٔ خودکار: داخل هر پاکت+زیرشاخه، عنوان‌ها بر اساس کلمهٔ اول گره می‌شوند («نان بربری»+«نان لواش» → «نان») ──
// استثناها: state.titleNo شامل 'x:cat|sub|key' (جداشده‌ها)؛ state.titleGroups (الحاق دستی) اولویت دارد.
const STOP = new Set(['خرید', 'یک', 'یه', 'بسته', 'عدد', 'کیلو', 'گرم', 'دو', 'سه', 'چند', 'مقداری', 'buy', 'a', 'the', 'one', 'pack']);
export function firstWord(key) {
  const ws = String(key || '').split(' ').filter((w) => w && !STOP.has(w));
  const w = ws[0] || '';
  return w.length >= 2 ? w : '';
}
export function isDetached(catId, sub, key) {
  return (state.titleNo || []).includes('x:' + catId + '|' + (sub || '') + '|' + key);
}
export function detachTitle(catId, sub, key) {
  if (!state.titleNo) state.titleNo = [];
  const id = 'x:' + catId + '|' + (sub || '') + '|' + key;
  if (!state.titleNo.includes(id)) state.titleNo.push(id);
  state.titleGroupsAt = Date.now();
}
export function reattachTitle(catId, sub, key) {
  const id = 'x:' + catId + '|' + (sub || '') + '|' + key;
  state.titleNo = (state.titleNo || []).filter((x) => x !== id);
  state.titleGroupsAt = Date.now();
}
// نقشهٔ کلید عنوان → کلید گره برای یک پاکت+زیرشاخه (روی همهٔ ماه‌ها تا گره‌ها بین ماه‌ها ثابت بمانند)
const nodeCache = new Map();
let nodeCacheStamp = '';
export function nodeMap(catId, sub) {
  const stamp = (state.updatedAt || 0) + ':' + (state.titleGroupsAt || 0) + ':' + state.transactions.length;
  if (nodeCacheStamp !== stamp) { nodeCache.clear(); nodeCacheStamp = stamp; }
  const ck = catId + '|' + (sub || '');
  if (nodeCache.has(ck)) return nodeCache.get(ck);
  const keys = new Set();
  for (const it of allItems()) {
    if (it.cat !== catId || (it.sub || '') !== (sub || '')) continue;
    const k = normTitle(it.title);
    if (k) keys.add(groupOf(k));
  }
  const byWord = new Map();
  for (const k of keys) {
    if (isDetached(catId, sub, k)) continue;
    const w = firstWord(k);
    if (!w) continue;
    if (!byWord.has(w)) byWord.set(w, []);
    byWord.get(w).push(k);
  }
  const map = new Map();
  for (const [w, ks] of byWord) if (ks.length >= 2) for (const k of ks) map.set(k, w);
  nodeCache.set(ck, map);
  return map;
}
export function nodeOf(catId, sub, key) {
  return nodeMap(catId, sub).get(key) || key;
}
export function nodeMembers(catId, sub, node) {
  const out = [];
  for (const [k, w] of nodeMap(catId, sub)) if (w === node) out.push(k);
  return out;
}
// نام نمایشی یک کلید (سرگروه دستی → عنوان یادگرفته‌شده؛ وگرنه خودِ کلید)
export function displayTitle(key, fallback) {
  const tm = state.titleMap && state.titleMap[key];
  return (tm && tm.title) || fallback || key;
}

export function titleTotals(mk, catId, sub, opts) {
  opts = opts || {};
  const m = new Map();
  let total = 0;
  for (const it of spendItems(mk, catId)) {
    if ((it.sub || '') !== (sub || '')) continue;
    const k0 = normTitle(it.title) || '—';
    const kg = groupOf(k0);
    const node = nodeOf(catId, sub, kg);
    if (opts.node && node !== opts.node) continue;
    const k = opts.node || opts.level === 'title' ? kg : node;
    const isNode = k !== kg;
    const e = m.get(k) || { key: k, title: isNode ? k : (kg === k0 ? it.title : displayTitle(kg)) || tr('بدون عنوان'), node: isNode, members: isNode ? nodeMembers(catId, sub, k).length : 0, grouped: groupMembers(kg).length, amount: 0, n: 0, qty: 0, unit: '', allQty: true, items: [] };
    e.amount += it.amount;
    e.n++;
    if (it.qty > 0) { e.qty += it.qty; if (!e.unit) e.unit = it.unit; else if (e.unit !== it.unit) e.allQty = false; } else e.allQty = false;
    e.items.push(it);
    m.set(k, e);
    total += it.amount;
  }
  return { total, rows: [...m.values()].sort((a, b) => b.amount - a.amount) };
}
function series(mk, n, fn) {
  const out = [];
  let k = mk;
  for (let i = 0; i < n; i++) {
    out.unshift(fn(k));
    k = shiftMonth(k, -1);
  }
  return out;
}
export function subSeries(mk, catId, sub, n) {
  return series(mk, n || 6, (k) => spendItems(k, catId).filter((it) => (it.sub || '') === (sub || '')).reduce((s, it) => s + it.amount, 0));
}
export function titleSeries(mk, catId, sub, key, n, exact) {
  return series(mk, n || 6, (k) => spendItems(k, catId).filter((it) => (it.sub || '') === (sub || '') && (exact ? titleKey(it.title) : nodeOf(catId, sub, titleKey(it.title))) === key).reduce((s, it) => s + it.amount, 0));
}
export function catSeries(mk, catId, n) {
  return series(mk, n || 6, (k) => spendItems(k, catId).reduce((s, it) => s + it.amount, 0));
}

// ── اسپارک‌لاین SVG کوچک ──
export function sparkline(vals, color) {
  const W = 60;
  const H = 18;
  const max = Math.max(...vals, 1);
  const n = vals.length;
  const pts = vals.map((v, i) => [(i / Math.max(1, n - 1)) * (W - 4) + 2, H - 2 - (v / max) * (H - 5)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="${color || 'currentColor'}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="1.8" fill="${color || 'currentColor'}"/></svg>`;
}
function trendHtml(cur, prev) {
  if (!prev && !cur) return '';
  if (!prev) return `<span class="trend new">${tr('جدید')}</span>`;
  const d = Math.round(((cur - prev) / prev) * 100);
  if (Math.abs(d) < 3) return `<span class="trend flat">=</span>`;
  return `<span class="trend ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${toFa(Math.abs(d))}${pctSign()}</span>`;
}

// ── «قبض ماه»: نوار انباشتهٔ تک‌خطی ──
const PALETTE = ['#3d8bfd', '#22c55e', '#f59e0b', '#a78bfa', '#ef4444', '#14b8a6', '#f472b6', '#84cc16', '#fb923c', '#60a5fa', '#c084fc', '#94a3b8'];
function colorFor(i) {
  return PALETTE[i % PALETTE.length];
}
function stackedBar(rows, total) {
  if (!total) return '';
  return `<div class="stack" role="img">${rows
    .map((r, i) => `<span style="width:${((r.amount / total) * 100).toFixed(2)}%;background:${r.sub ? colorFor(i) : 'var(--faint)'}" title="${esc(subLabel(r.sub))}"></span>`)
    .join('')}</div>`;
}

// ── بینش‌های خودکار (حداکثر ۳ جمله) ──
function insights(mk, catId, rows, total) {
  const out = [];
  const prevKeys = [1, 2, 3].map((i) => shiftMonth(mk, -i));
  const avg3 = prevKeys.reduce((s, k) => s + spendItems(k, catId).reduce((a, it) => a + it.amount, 0), 0) / 3;
  const c = catById(catId);
  if (avg3 > 0 && total > 0) {
    const d = Math.round(((total - avg3) / avg3) * 100);
    if (Math.abs(d) >= 10) out.push({ txt: tr('{c} این ماه {p}٪ {dir} از میانگین ۳ ماه اخیر است.', { c: c.label, p: toFa(Math.abs(d)), dir: d > 0 ? tr('بیشتر') : tr('کمتر') }), cls: d > 0 ? 'warn' : 'good' });
  }
  const top2 = rows.filter((r) => r.sub).slice(0, 2);
  if (top2.length === 2 && total > 0) {
    const share = Math.round(((top2[0].amount + top2[1].amount) / total) * 100);
    if (share >= 50) out.push({ txt: tr('{a} و {b} {p}٪ {c} را می‌سازند.', { a: subLabel(top2[0].sub), b: subLabel(top2[1].sub), p: toFa(share), c: c.label }), cls: '' });
  }
  const prevMk = shiftMonth(mk, -1);
  for (const r of rows.filter((x) => x.sub).slice(0, 4)) {
    const pn = spendItems(prevMk, catId).filter((it) => (it.sub || '') === r.sub).length;
    if (pn >= 3 && r.n >= 1 && (r.n <= pn / 2 || r.n >= pn * 2)) {
      out.push({ txt: tr('{s} {n} بار — ماه قبل {p} بار.', { s: subLabel(r.sub), n: toFa(r.n), p: toFa(pn) }), cls: r.n > pn ? 'warn' : 'good', sub: r.sub });
      break;
    }
  }
  const un = rows.find((r) => !r.sub);
  if (un && total > 0 && un.amount / total >= 0.3) out.push({ txt: tr('{p}٪ این پاکت دسته‌بندی نشده؛ با «دسته‌بندی سریع» گزارش دقیق‌تر می‌شود.', { p: toFa(Math.round((un.amount / total) * 100)) }), cls: 'muted', quick: true });
  return out.slice(0, 3);
}

// ── سطح ۲: زیرشاخه‌های یک پاکت ──
export function subReportHtml(mk, catId) {
  const c = catById(catId);
  const { total, rows } = subTotals(mk, catId);
  const share = catShare(mk, catId) + catCarried(mk, catId);
  const ins = insights(mk, catId, rows, total);
  const prevMk = shiftMonth(mk, -1);
  const prevTotals = subTotals(prevMk, catId).rows;
  const prevOf = (sub) => (prevTotals.find((r) => r.sub === sub) || {}).amount || 0;
  const head = `
    <div class="stat" style="background:var(--bg2);margin-bottom:10px">
      <div class="lbl">${monthLabel(mk)} · ${tr('سهم')} ${toFa(c.target)}${pctSign()}</div>
      <div class="val ${share && total > share ? 'red' : ''}">${fmtShort(total)}</div>
      <div class="sub">${share ? (tr('سقف') + ' ' + fmtShort(share) + ' · ' + (total > share ? tr('{amt} بیشتر', { amt: fmtShort(total - share) }) : tr('{amt} مانده', { amt: fmtShort(share - total) }))) : tr('بودجه این ماه ثبت نشده')}</div>
    </div>
    ${(() => { const lk = lockedReportHtml(mk, catId); if (lk) return lk; return stackedBar(rows, total) + `<div class="stack-legend">${rows.slice(0, 6).map((r, i) => `<span><i style="background:${r.sub ? colorFor(i) : 'var(--faint)'}"></i>${esc(subLabel(r.sub))} ${toFa(Math.round((r.amount / (total || 1)) * 100))}${pctSign()}</span>`).join('')}</div>`; })()}
    ${ins.length && !lockedReportHtml(mk, catId) ? `<div class="insights">${ins.map((x) => `<div class="ins ${x.cls}" ${x.quick ? `onclick="openQuickCategorize('${catId}','${mk}')"` : x.sub ? `onclick="openSubReport('${catId}','${x.sub}','${mk}')"` : ''}>${icon(x.cls === 'good' ? 'check' : x.cls === 'warn' ? 'alert' : 'info')}<span>${x.txt}</span></div>`).join('')}</div>` : ''}`;
  const list = rows.length
    ? rows
        .map((r, i) => {
          const s = subSeries(mk, catId, r.sub, 6);
          return `<button type="button" class="srow subrow" onclick="${r.sub ? `openSubReport('${catId}','${r.sub}','${mk}')` : `openQuickCategorize('${catId}','${mk}')`}">
          <span class="ib sm" style="background:${r.sub ? colorFor(i) : 'var(--faint)'}22;color:${r.sub ? colorFor(i) : 'var(--muted)'}">${icon(r.sub ? 'tag' : 'help')}</span>
          <span class="smid"><span class="st1">${esc(subLabel(r.sub))}</span><span class="st2">${toFa(r.n)} ${tr('مورد')} · ${toFa(Math.round((r.amount / (total || 1)) * 100))}${pctSign()} ${trendHtml(r.amount, prevOf(r.sub))}</span></span>
          ${sparkline(s, r.sub ? colorFor(i) : 'var(--muted)')}
          <span class="sval"><b>${fmtShort(r.amount)}</b></span>
        </button>`;
        })
        .join('')
    : `<div class="empty">${tr('خرجی در این پاکت برای {m} ثبت نشده.', { m: monthLabel(mk) })}</div>`;
  return head + `<div class="sgroup" style="margin-top:12px">${list}</div>`;
}

// ── سطح ۳: عنوان‌های یک زیرشاخه ──
export function titleReportHtml(mk, catId, sub) {
  const { total, rows } = titleTotals(mk, catId, sub);
  const s6 = subSeries(mk, catId, sub, 6);
  const prev = s6[s6.length - 2] || 0;
  const head = `
    <div class="stat" style="background:var(--bg2);margin-bottom:10px">
      <div class="lbl">${monthLabel(mk)} · ${esc(catById(catId).label)}</div>
      <div class="val">${fmtShort(total)} ${trendHtml(total, prev)}</div>
      <div class="sub" style="display:flex;align-items:center;gap:8px">${tr('۶ ماه اخیر')} ${sparkline(s6, catById(catId).color)}</div>
    </div>`;
  const list = rows.length
    ? rows
        .map((r) => {
          const ts = titleSeries(mk, catId, sub, r.key, 6);
          const go = r.node ? `openTitleNode('${catId}','${sub || ''}','${esc(r.key)}','${mk}')` : `openTitleItems('${catId}','${sub || ''}','${esc(r.key)}','${mk}')`;
          return `<button type="button" class="srow subrow" onclick="${go}">
          <span class="smid"><span class="st1">${esc(r.title)}${r.node ? ` <small class="badge">${toFa(r.members)} ${tr('عنوان')}</small>` : r.grouped ? ` <small class="badge">${toFa(r.grouped + 1)} ${tr('عنوان')}</small>` : ''}</span><span class="st2">${toFa(r.n)} ${tr('بار')} · ${avgLabel(r)}</span></span>
          ${sparkline(ts, catById(catId).color)}
          <span class="sval"><b>${fmtShort(r.amount)}</b> <small class="muted">${toFa(Math.round((r.amount / (total || 1)) * 100))}${pctSign()}</small></span>
        </button>`;
        })
        .join('')
    : `<div class="empty">${tr('موردی نیست.')}</div>`;
  return head + `<div class="sgroup">${list}</div>`;
}
// ── اعضای یک گره ──
export function nodeReportHtml(mk, catId, sub, node) {
  const { total, rows } = titleTotals(mk, catId, sub, { node });
  const s6 = titleSeries(mk, catId, sub, node, 6);
  const prev = s6[s6.length - 2] || 0;
  const head = `
    <div class="stat" style="background:var(--bg2);margin-bottom:10px">
      <div class="lbl">${monthLabel(mk)} · ${esc(subLabel(sub))}</div>
      <div class="val">${fmtShort(total)} ${trendHtml(total, prev)}</div>
      <div class="sub" style="display:flex;align-items:center;gap:8px">${tr('۶ ماه اخیر')} ${sparkline(s6, catById(catId).color)}</div>
    </div>
    <p class="small muted">${tr('این عنوان‌ها چون با «{w}» شروع می‌شوند خودکار یک گره شده‌اند. اگر موردی اشتباه است، جدایش کن.', { w: esc(node) })}</p>`;
  const list = rows
    .map((r) => {
      const ts = titleSeries(mk, catId, sub, r.key, 6, true);
      return `<div class="srow subrow" style="cursor:default">
        <span class="smid" onclick="openTitleItems('${catId}','${sub || ''}','${esc(r.key)}','${mk}')" style="cursor:pointer"><span class="st1">${esc(r.title)}</span><span class="st2">${toFa(r.n)} ${tr('بار')} · ${avgLabel(r)}</span></span>
        ${sparkline(ts, catById(catId).color)}
        <span class="sval"><b>${fmtShort(r.amount)}</b></span>
        <button type="button" class="btn sm ghost" title="${tr('جدا کن')}" onclick="event.stopPropagation();ndDetach('${catId}','${sub || ''}','${esc(r.key)}','${esc(node)}','${mk}')">${icon('x')}</button>
      </div>`;
    })
    .join('');
  return head + `<div class="sgroup">${list}</div>`;
}
// کارت پیشنهاد ادغام عنوان‌های شبیه (تأیید با کاربر)
export function groupSuggestHtml(catId, sub) {
  const g = suggestGroups(catId, sub)[0];
  if (!g) return '';
  const id = g.keys.join('|');
  return `<div class="ins gsug">${icon('help')}<span>${tr('{n} عنوان شبیه هم: {list} — یکی شوند؟', { n: toFa(g.keys.length), list: g.titles.map((t) => '«' + esc(t) + '»').join(tr('، ')) })}
    <span class="row" style="margin-top:6px;gap:6px"><button type="button" class="btn sm primary" onclick="gsAnswer('${esc(id)}','${esc(g.canon)}',1,'${catId}','${sub || ''}')">${tr('بله، «{t}»', { t: esc(g.titles[0]) })}</button><button type="button" class="btn sm" onclick="gsAnswer('${esc(id)}','',0,'${catId}','${sub || ''}')">${tr('نه')}</button></span></span></div>`;
}

// ── دسته‌بندی سریع تاریخچه: هر عنوانِ یکتا یک بار ──
export function uncategorized(catId) {
  const m = new Map();
  for (const tx of state.transactions) {
    if (tx.type !== 'out' || isTransfer(tx) || isLoanTx(tx)) continue;
    const keep = spendRatio(tx);
    if (!keep) continue;
    if (isInvoice(tx)) {
      const k1 = txAmountToman(tx) / (tx.amount || 1); // نرخ ارز حساب → تومان
      for (const l of tx.lines || []) {
        if (l.sub || l.cat === 'loan' || (catId && l.cat !== catId)) continue;
        const k = l.cat + '|' + titleKey(l.name);
        const e = m.get(k) || { key: k, cat: l.cat, title: l.name || tr('بدون عنوان'), n: 0, amount: 0 };
        e.n++;
        e.amount += (l.amount || 0) * k1 * keep;
        m.set(k, e);
      }
    } else {
      if (tx.sub || (catId && tx.cat !== catId)) continue;
      const k = tx.cat + '|' + titleKey(tx.note);
      const e = m.get(k) || { key: k, cat: tx.cat, title: tx.note || tr('بدون عنوان'), n: 0, amount: 0 };
      e.n++;
      e.amount += txAmountToman(tx) * keep;
      m.set(k, e);
    }
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount);
}
// اعمال زیرشاخه روی همهٔ اقلامِ هم‌عنوان و هم‌پاکت (فقط آن‌هایی که زیرشاخه ندارند)
export function applySubToTitle(catId, key, sub) {
  let n = 0;
  for (const tx of state.transactions) {
    if (tx.type !== 'out' || isTransfer(tx)) continue;
    if (isInvoice(tx)) {
      for (const l of tx.lines || []) {
        if (l.sub || l.cat !== catId) continue;
        if (titleKey(l.name) !== key) continue;
        l.sub = sub;
        n++;
        tx.updatedAt = Date.now();
      }
    } else {
      if (tx.sub || tx.cat !== catId) continue;
      if (titleKey(tx.note) !== key) continue;
      tx.sub = sub;
      tx.updatedAt = Date.now();
      n++;
    }
  }
  if (key !== '—') learnTitle(key, catId, sub, 0);
  return n;
}
