// ─── یادآوری سررسیدها: اعلان (با دکمهٔ «پرداخت شد»)، عدد روی آیکون، و خروجی تقویم (.ics) ───
// بدون سرور: اعلان‌ها موقع باز/دیده‌شدن اپ ساخته می‌شوند؛ تقویم گوشی یادآورِ مستقل از اپ است.
import { icon } from './icons.js';
import { esc, fmt, fmtShort, store, toast, todayISO, saveFile, toFa, infoTip } from './utils.js';
import { fmtDate } from './jalali.js';
import { openModal, closeModal } from './modal.js';
import { render } from './view.js';
import { save, state, accountById, curName, baseCur } from './state.js';
import { allDebts, debtRemaining, daysUntilDue, settleDebt } from './debts.js';
import { allPlans, rowTotal, payRow, openPlanDetail } from './installments.js';
import { t as tr } from './i18n.js';

const DAY_KEY = 'capital_remind_day';
const DAYS_OPTS = [0, 1, 2, 3, 7];
const HOUR_OPTS = [7, 8, 9, 10, 12, 18, 20];

export function remindPrefs() {
  const r = state.remind || {};
  return { days: DAYS_OPTS.includes(r.days) ? r.days : 1, hour: HOUR_OPTS.includes(r.hour) ? r.hour : 9 };
}
function setPref(patch) {
  state.remind = Object.assign({}, remindPrefs(), patch);
  save();
}

// همهٔ سررسیدهای باز: طلب/بدهی + ردیف‌های قسط
export function reminderItems() {
  const out = [];
  for (const d of allDebts()) {
    if (d.settled || !d.dueISO) continue;
    const a = d.accountId && accountById(d.accountId);
    const cur = (a && a.currency) || baseCur();
    out.push({
      id: 'debt-' + d.id,
      kind: 'debt',
      debtId: d.id,
      title: (d.kind === 'in' ? tr('طلب از') : tr('بدهی به')) + ' ' + (d.person || ''),
      amount: debtRemaining(d),
      cur,
      dueISO: d.dueISO,
      days: daysUntilDue(d.dueISO),
    });
  }
  for (const p of allPlans()) {
    if (p.cancelled) continue; // از این خرید منصرف شده‌ای؛ سررسیدی در کار نیست
    const a = accountById(p.accountId);
    const cur = (a && a.currency) || baseCur();
    const inst = (p.rows || []).filter((x) => x.kind !== 'down' && x.kind !== 'interest');
    for (const r of p.rows || []) {
      if (r.paidISO || !r.dueISO) continue;
      const n = inst.indexOf(r) + 1;
      const lbl = r.kind === 'down' ? tr('پیش‌پرداخت') : r.kind === 'interest' ? tr('سود') : tr('قسط {n}/{m}', { n: toFa(n), m: toFa(inst.length) });
      out.push({
        id: 'inst-' + p.id + '-' + r.id,
        kind: 'inst',
        planId: p.id,
        rowId: r.id,
        title: lbl + ' ' + (p.title || ''),
        amount: rowTotal(r),
        cur,
        dueISO: r.dueISO,
        days: daysUntilDue(r.dueISO),
      });
    }
  }
  return out.sort((x, y) => String(x.dueISO).localeCompare(String(y.dueISO)));
}

function whenLabel(days, iso) {
  if (days === 0) return tr('امروز');
  if (days === 1) return tr('فردا');
  if (days < 0) return tr('عقب‌افتاده') + ' · ' + fmtDate(iso);
  return fmtDate(iso);
}

// ── عدد روی آیکون اپ: تعداد موارد امروز/عقب‌افتاده ──
export function updateBadge() {
  if (!('setAppBadge' in navigator)) return;
  const n = reminderItems().filter((it) => it.days !== null && it.days <= 0).length;
  try {
    if (n > 0) navigator.setAppBadge(n).catch(() => {});
    else navigator.clearAppBadge().catch(() => {});
  } catch (e) {}
}

// ── اعلان‌ها ──
export function notifyState() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission; // granted | denied | default
}
export async function enableReminders() {
  if (typeof Notification === 'undefined') {
    toast(tr('این مرورگر یادآوری ندارد'));
    return false;
  }
  const p = await Notification.requestPermission();
  if (p !== 'granted') {
    toast(tr('اجازه یادآوری داده نشد'));
    return false;
  }
  toast(tr('یادآوری روشن شد'));
  await checkReminders(true);
  return true;
}

async function swReg() {
  try {
    if (!('serviceWorker' in navigator)) return null;
    return await navigator.serviceWorker.getRegistration();
  } catch (e) {
    return null;
  }
}

async function showOne(title, body, tag, data, withActions) {
  const reg = await swReg();
  const opts = { body, tag, data, renotify: false, icon: './icons/icon-192.png', badge: './icons/icon-192.png' };
  if (reg && reg.showNotification) {
    if (withActions) opts.actions = [{ action: 'paid', title: tr('پرداخت شد') }, { action: 'open', title: tr('باز کردن') }];
    try {
      await reg.showNotification(title, opts);
      return;
    } catch (e) {}
  }
  try {
    const n = new Notification(title, opts);
    n.onclick = () => {
      window.focus();
      handleAction('open', data);
      n.close();
    };
  } catch (e) {}
}

// یک بار در روز: هر موردی که تا «x روز» دیگر سررسید دارد یا عقب‌افتاده است
export async function checkReminders(force) {
  updateBadge();
  if (notifyState() !== 'granted') return;
  const day = todayISO();
  if (!force && store.get(DAY_KEY) === day) return;
  const { days } = remindPrefs();
  const due = reminderItems().filter((it) => it.days !== null && it.days <= days);
  store.set(DAY_KEY, day);
  if (!due.length) return;
  const top = due.slice(0, 4);
  for (const it of top) {
    const body = fmt(it.amount) + ' ' + curName(it.cur) + ' · ' + whenLabel(it.days, it.dueISO);
    await showOne(it.title, body, 'taraz-' + it.id, { id: it.id, kind: it.kind, debtId: it.debtId, planId: it.planId, rowId: it.rowId }, true);
  }
  if (due.length > top.length) {
    await showOne(tr('سررسیدها'), tr('{n} مورد دیگر هم نزدیک سررسید است', { n: toFa(due.length - top.length) }), 'taraz-more', { kind: 'more' }, false);
  }
}

// عمل روی اعلان (از SW یا از خود اعلان)
export function handleAction(action, data) {
  data = data || {};
  if (data.kind === 'inst' && data.planId) {
    if (action === 'paid') {
      payRow(data.planId, data.rowId);
      return;
    }
    if (typeof window.switchTab === 'function') window.switchTab('installments');
    openPlanDetail(data.planId);
    return;
  }
  if (data.kind === 'debt' && data.debtId) {
    if (typeof window.switchTab === 'function') window.switchTab('debts');
    // «پرداخت شد» برای قرض: شیت تسویه با ماندهٔ پیش‌فرض باز می‌شود (حساب را کاربر تأیید می‌کند)
    settleDebt(data.debtId);
    return;
  }
  if (typeof window.switchTab === 'function') window.switchTab(data.kind === 'more' ? 'installments' : 'home');
}

// پیام‌های SW (کلیک روی اعلان وقتی اپ بسته/پس‌زمینه بوده)
export function initReminders() {
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (e) => {
        const m = e.data || {};
        if (m.type === 'remind-action') handleAction(m.action, m.data);
      });
    }
  } catch (e) {}
  // اگر با پارامتر اعلان باز شده‌ایم (SW کلاینت تازه باز کرده)
  try {
    const u = new URL(location.href);
    const act = u.searchParams.get('remind');
    if (act) {
      const data = JSON.parse(decodeURIComponent(u.searchParams.get('rd') || '{}'));
      history.replaceState(null, '', u.pathname);
      setTimeout(() => handleAction(act, data), 400);
    }
  } catch (e) {}
}

// ── خروجی تقویم (.ics): هر سررسید یک رویداد تمام‌روز با هشدار «x روز قبل، ساعت h» ──
function icsEsc(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
function icsDate(iso) {
  return String(iso).replace(/-/g, '');
}
function nextDay(iso) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function buildICS(items, prefs) {
  const { days, hour } = prefs || remindPrefs();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  // هشدار نسبت به شروع رویداد تمام‌روز (نیمه‌شب): x روز قبل ساعت h ⇒ (x*24 − h) ساعت قبل
  const hoursBefore = Math.max(0, days * 24 - hour);
  const trig = hoursBefore === 0 ? 'PT0S' : '-PT' + hoursBefore + 'H';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Taraz//Reminders//FA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + icsEsc(tr('سررسیدهای تراز')),
  ];
  for (const it of items) {
    const title = it.title + ' — ' + fmt(it.amount) + ' ' + curName(it.cur);
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + it.id + '@taraz',
      'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + icsDate(it.dueISO),
      'DTEND;VALUE=DATE:' + icsDate(nextDay(it.dueISO)),
      'SUMMARY:' + icsEsc(title),
      'DESCRIPTION:' + icsEsc(tr('یادآوری از برنامهٔ تراز')),
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:' + icsEsc(title),
      'TRIGGER' + (hoursBefore === 0 ? ':' : ';RELATED=START:') + trig,
      'END:VALARM',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
export async function exportCalendar() {
  const items = reminderItems().filter((it) => it.days === null || it.days >= 0);
  if (!items.length) {
    toast(tr('سررسید بازی برای تقویم نیست'));
    return;
  }
  const ics = buildICS(items);
  const res = await saveFile('taraz-reminders.ics', ics, 'text/calendar');
  if (res === 'cancel') return;
  toast(tr('{n} سررسید آمادهٔ افزودن به تقویم', { n: toFa(items.length) }));
}

// ── شیت تنظیمات یادآوری ──
export function openRemindSettings() {
  const { days, hour } = remindPrefs();
  const st = notifyState();
  const items = reminderItems();
  const soon = items.filter((it) => it.days !== null && it.days <= 7);
  const stTxt = st === 'granted' ? tr('روشن') : st === 'denied' ? tr('در تنظیمات مرورگر مسدود شده') : st === 'unsupported' ? tr('این مرورگر پشتیبانی نمی‌کند') : tr('خاموش');
  openModal(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>${tr('یادآوری سررسیدها')}</h2>
    <div class="field"><label>${tr('چند روز قبل خبر بده؟')}</label>
      <div class="chips" id="rmDays">${DAYS_OPTS.map((d) => `<button type="button" class="chip ${d === days ? 'on' : ''}" onclick="remindSetDays(${d})">${d === 0 ? tr('همان روز') : tr('{n} روز قبل', { n: toFa(d) })}</button>`).join('')}</div>
    </div>
    <div class="field"><label>${tr('ساعت هشدارِ تقویم')} ${infoTip(tr('برای رویدادهایی که به تقویم گوشی اضافه می‌کنی. اعلان‌های خود برنامه وقتی بازش می‌کنی می‌آیند.'))}</label>
      <div class="chips" id="rmHour">${HOUR_OPTS.map((h) => `<button type="button" class="chip ${h === hour ? 'on' : ''}" onclick="remindSetHour(${h})">${toFa(String(h).padStart(2, '0'))}:۰۰</button>`).join('')}</div>
    </div>
    <div class="sgroup" style="margin-top:4px">
      <button type="button" class="srow" onclick="remindEnable()">
        <span class="sic" style="background:#f59e0b">${icon('bell')}</span>
        <span class="smid"><span class="st1">${tr('اعلان روی گوشی')}</span><span class="st2">${tr('با دکمهٔ «پرداخت شد» روی خود اعلان؛ عدد عقب‌افتاده‌ها روی آیکون')}</span></span>
        <span class="sval">${stTxt}</span>
      </button>
      <button type="button" class="srow" onclick="remindExportCal()">
        <span class="sic" style="background:#0ea5e9">${icon('calendar')}</span>
        <span class="smid"><span class="st1">${tr('افزودن به تقویم گوشی')}</span><span class="st2">${tr('یادآور مستقل از برنامه؛ حتی اگر مدت‌ها بازش نکنی. بعد از تغییر جدول اقساط دوباره بزن.')}</span></span>
        <span class="sval">${toFa(items.filter((it) => it.days === null || it.days >= 0).length)}</span>
      </button>
    </div>
    ${soon.length ? `<h3 class="muted" style="margin:14px 0 6px">${tr('تا یک هفتهٔ آینده')}</h3>
    <div class="sgroup">${soon.slice(0, 8).map((it) => `<div class="srow" style="cursor:default">
        <span class="sic" style="background:${it.days <= 0 ? 'var(--red)' : '#64748b'}">${icon(it.kind === 'inst' ? 'calendar' : 'handshake')}</span>
        <span class="smid"><span class="st1">${esc(it.title)}</span><span class="st2">${whenLabel(it.days, it.dueISO)}</span></span>
        <span class="sval">${fmtShort(it.amount)}</span>
      </div>`).join('')}</div>` : `<div class="hint" style="margin-top:12px">${tr('تا یک هفتهٔ آینده سررسیدی نداری.')}</div>`}
  `);
}
export function remindSetDays(d) {
  setPref({ days: d });
  openRemindSettings();
}
export function remindSetHour(h) {
  setPref({ hour: h });
  openRemindSettings();
}
export async function remindEnable() {
  if (notifyState() === 'granted') {
    await checkReminders(true);
    toast(tr('اعلان‌های امروز فرستاده شد'));
    return;
  }
  const ok = await enableReminders();
  if (ok) openRemindSettings();
}
export function remindExportCal() {
  exportCalendar();
}
export function remindSummary() {
  const st = notifyState();
  const { days } = remindPrefs();
  return (st === 'granted' ? tr('اعلان روشن') : tr('اعلان خاموش')) + ' · ' + (days === 0 ? tr('همان روز') : tr('{n} روز قبل', { n: toFa(days) }));
}
