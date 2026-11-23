// انتخابگرِ حساب: موزاییکِ همهٔ حساب‌ها (کشیدن به چپ/راست) + بیرون بودنِ حسابِ مبدأ
// از فهرستِ مقصد در انتقال (و برعکس)، با جابه‌جاییِ خودکار وقتی یکی می‌شوند.
//
// اجرا:  cd tools/harness && npm i && node acctpick-test.mjs
import { readFileSync } from 'node:fs';
import { bootApp, reporter, REPO } from './boot-app.mjs';

const R = reporter();
const { check } = R;

const seedState = {
  accounts: [
    { id: 'a1', name: 'کارت ملت', bank: 'بانک ملت', bankId: 'mellat', type: 'کارت بانکی', currency: 'تومان', initial: 0, last4: '1234', updatedAt: 1 },
    { id: 'a2', name: 'حساب ملی', bank: 'بانک ملی', bankId: 'melli', type: 'کارت بانکی', currency: 'تومان', initial: 0, last4: '4321', updatedAt: 2 },
    { id: 'a3', name: 'نقد', bank: '', type: 'نقدی', currency: 'تومان', initial: 0, updatedAt: 3 },
    { id: 'a4', name: 'کیف صرافی', bank: 'نوبیتکس', type: 'ارز دیجیتال', currency: 'تومان', initial: 0, updatedAt: 4 },
    { id: 'a5', name: 'حساب قدیمی', bank: 'بانک سپه', bankId: 'sepah', type: 'کارت بانکی', currency: 'تومان', initial: 0, archived: true, updatedAt: 5 },
  ],
  transactions: [], investments: [], debts: [], installments: [],
  budgets: {}, rates: {}, baseCurrency: 'تومان', calendar: 'jalali', bookId: '',
};

const app = await bootApp({ seed: { capital_app_v1: JSON.stringify(seedState) } });
const { window } = app;
const st = await import('file://' + REPO + '/js/state.js');
const forms = await import('file://' + REPO + '/js/forms.js');
const ap = await import('file://' + REPO + '/js/acctpick.js');
const jal = await import('file://' + REPO + '/js/jalali.js');

const M0 = jal.curMonthKey();
const isoOf = (mk, day) => {
  const [y, m] = String(mk).split('/').map(Number);
  const g = jal.toGregorian(y, m, day);
  return g[0] + '-' + String(g[1]).padStart(2, '0') + '-' + String(g[2]).padStart(2, '0');
};
const $ = (id) => window.document.getElementById(id);
const val = (id) => String(($(id) || {}).value == null ? '' : $(id).value);
const sheetHtml = () => ($('sheet') || {}).innerHTML || '';
const subHtml = () => ($('sheet2') || {}).innerHTML || '';
const tiles = (id) => [...window.document.querySelectorAll(`#${id}_ap .achip[data-a]`)].map((b) => b.dataset.a);
const opts = (id) => [...(($(id) || {}).options || [])].map((o) => o.value);

// پول در حساب‌ها تا انتقال ممکن باشد
st.state.transactions.push({ id: 'inc1', type: 'in', cat: null, amount: 9000000, accountId: 'a1', note: 'حقوق', dateISO: isoOf(M0, 1), time: '08:00', month: M0, updatedAt: 1 });
st.state.transactions.push({ id: 'o1', type: 'out', cat: 'need', amount: 10000, accountId: 'a3', note: 'نان', dateISO: isoOf(M0, 2), month: M0, updatedAt: 2 });
st.save();

// ── ۱. موزاییک: همهٔ حساب‌ها با همان اندازه، در نوارِ کشیدنی ───────────────
const box = window.document.createElement('div');
box.innerHTML = ap.apickHtml({ id: 'demo', selected: 'a2' });
window.document.body.appendChild(box);
check('نوارِ موزاییک ساخته می‌شود', !!$('demo_ap') && $('demo_ap').classList.contains('apick'));
check('همهٔ حساب‌های فعال در نوارند (نه فقط پرکاربردها)', tiles('demo').length === 4, tiles('demo').join(','));
check('حسابِ بایگانی در نوار نمی‌آید', !tiles('demo').includes('a5'));
check('حسابِ انتخاب‌شده اولین کاشی است', tiles('demo')[0] === 'a2', tiles('demo')[0]);
check('کاشیِ انتخاب‌شده روشن است', !!window.document.querySelector(`#demo_ap .achip[data-a="a2"].on`));
check('اندازهٔ کاشی‌ها همان قبلی است (آیکن + نام + موجودی)', (() => {
  const t = window.document.querySelector('#demo_ap .achip[data-a="a2"]');
  return !!t && !!t.querySelector('.achip-ic') && /کارت ملت|حساب ملی/.test(t.textContent);
})(), ($('demo_ap') || {}).textContent);
check('کاشیِ «همهٔ حساب‌ها» برای جست‌وجو هست', /همهٔ حساب‌ها/.test($('demo_ap').textContent) && /openAcctSheet\('demo'\)/.test($('demo_ap').innerHTML));
const CSS = readFileSync(REPO + '/css/app.css', 'utf8');
const apickRule = (CSS.match(/\.apick\{[\s\S]*?\}/) || [''])[0];
check('نوار با کشیدنِ انگشت چپ/راست می‌رود', /flex-wrap:nowrap/.test(apickRule) && /overflow-x:auto/.test(apickRule) && /scroll-snap-type:x/.test(apickRule) && /scrollbar-width:none/.test(apickRule), apickRule.replace(/\s+/g, ' ').slice(0, 140));
check('کاشی‌ها در نوار می‌چسبند', /\.apick>\.achip\{flex:0 0 auto;scroll-snap-align:start\}/.test(readFileSync(REPO + '/css/app.css', 'utf8')));

// انتخاب با زدن روی کاشی
const b2 = window.document.createElement('div');
b2.innerHTML = ap.apickHtml({ id: 'demo3', selected: 'a1', onchange: "window.__hit=(window.__hit||0)+1" });
window.document.body.appendChild(b2);
window.__hit = 0;
ap.apickChoose('demo3', 'a4');
check('زدن روی کاشی، حساب را انتخاب می‌کند', val('demo3') === 'a4', val('demo3'));
check('انتخاب، رویدادِ تغییر را هم می‌فرستد', window.__hit === 1, String(window.__hit));
check('گزینه‌های select پنهان هم همهٔ حساب‌ها را دارند', opts('demo3').filter(Boolean).length === 4, opts('demo3').join(','));

// حسابِ بایگانیِ انتخاب‌شده (ویرایشِ تراکنشِ قدیمی) گم نمی‌شود
const b3 = window.document.createElement('div');
b3.innerHTML = ap.apickHtml({ id: 'demo4', selected: 'a5' });
window.document.body.appendChild(b3);
check('حسابِ بایگانیِ انتخاب‌شده در نوار می‌ماند', tiles('demo4').includes('a5') && val('demo4') === 'a5', tiles('demo4').join(','));
check('حسابِ بایگانی گزینهٔ select هم دارد', opts('demo4').includes('a5'), opts('demo4').join(','));

// ── ۲. انتقال: حسابِ مبدأ در فهرستِ مقصد نیست ────────────────────────────
forms.openTransferForm();
check('فرمِ انتقال باز می‌شود', app.overlayOpen() && !!$('trFrom') && !!$('trTo'));
const from0 = val('trFrom');
const to0 = val('trTo');
check('مبدأ و مقصد از اول یکی نیستند', from0 && to0 && from0 !== to0, from0 + '/' + to0);
check('مقصد، حسابِ مبدأ را در فهرستش ندارد', !opts('trTo').includes(from0), opts('trTo').join(','));
check('مبدأ، حسابِ مقصد را در فهرستش ندارد', !opts('trFrom').includes(to0), opts('trFrom').join(','));
check('کاشی‌های مقصد هم مبدأ را نشان نمی‌دهند', !tiles('trTo').includes(from0) && tiles('trTo').length === 3, tiles('trTo').join(','));
check('کاشی‌های مبدأ هم مقصد را نشان نمی‌دهند', !tiles('trFrom').includes(to0));
ap.openAcctSheet('trTo');
check('شیتِ کاملِ مقصد هم مبدأ را ندارد', !subHtml().includes(`apickChoose('trTo','${from0}')`) && /apickChoose\('trTo'/.test(subHtml()), subHtml().slice(0, 60));
check('شیتِ مقصد بقیهٔ حساب‌ها را دارد', (subHtml().match(/apickChoose\('trTo','a\d'\)/g) || []).length === 3, String((subHtml().match(/apickChoose\('trTo','a\d'\)/g) || []).length));
window.closeSubModal();

// ── ۳. عوض کردنِ مبدأ: فهرستِ مقصد همان لحظه به‌روز می‌شود ───────────────
ap.apickChoose('trFrom', 'a3');
check('مبدأ عوض شد', val('trFrom') === 'a3', val('trFrom'));
check('مقصد سرِ جایش ماند (چون یکی نشدند)', val('trTo') === to0, val('trTo'));
check('فهرستِ مقصد همان لحظه به‌روز شد: مبدأِ تازه نیست، مبدأِ قبلی هست', !opts('trTo').includes('a3') && opts('trTo').includes(from0), opts('trTo').join(','));
check('کاشی‌های مقصد هم به‌روز شدند', !tiles('trTo').includes('a3') && tiles('trTo').includes(from0), tiles('trTo').join(','));
check('فهرستِ مبدأ مقصد را ندارد و انتخابِ تازه اولِ نوار است', !opts('trFrom').includes(to0) && tiles('trFrom')[0] === 'a3', tiles('trFrom').join(','));
check('با عوض شدنِ مبدأ، مقصد نمی‌تواند همان را بگیرد', (() => {
  ap.openAcctSheet('trTo');
  const ok = !subHtml().includes(`apickChoose('trTo','a3')`);
  window.closeSubModal();
  return ok;
})(), subHtml().slice(0, 40));

// تضمینِ اینکه هیچ‌وقت یکی نمی‌شوند: اگر مقدارِ فعلی از فهرست بیرون برود، خودش جابه‌جا می‌شود
ap.apickSetExclude('trTo', [val('trTo')]);
check('مقداری که از فهرست بیرون رفته خودکار عوض می‌شود', val('trTo') && val('trTo') !== to0 && val('trTo') !== val('trFrom'), val('trTo'));
check('بعدِ جابه‌جایی هم گزینه‌ها سازگارند', opts('trTo').includes(val('trTo')) && !opts('trFrom').includes(val('trTo')), opts('trTo').join(','));

// ── ۴. انتقال با این حالت ثبت می‌شود ─────────────────────────────────────
ap.apickChoose('trFrom', 'a1');
check('مبدأ و مقصد برای ثبت یکی نیستند', val('trFrom') === 'a1' && val('trTo') && val('trTo') !== 'a1', val('trFrom') + '/' + val('trTo'));
$('trAmount').value = '300000';
$('trDate').value = isoOf(M0, 12);
$('trTime').value = '10:20';
const n = st.state.transactions.length;
forms.saveTransfer();
const out = st.state.transactions.find((t) => t.type === 'transferOut' && t.amount === 300000);
const inn = out && st.state.transactions.find((t) => t.pair === out.pair && t.type === 'transferIn');
check('انتقال ثبت شد', st.state.transactions.length === n + 2 && !!out && !!inn, String(st.state.transactions.length - n));
check('مبدأ و مقصدِ سندها یکی نیست', !!out && !!inn && out.accountId !== inn.accountId, out && out.accountId + '/' + (inn && inn.accountId));
check('ساعتِ انتقال سرِ جایش است', out && out.time === '10:20' && inn.time === '10:20', out && out.time);

// ویرایشِ انتقالِ ثبت‌شده هم همان استثنا را دارد
forms.openTransferForm(out);
check('ویرایشِ انتقال هم مبدأ را از فهرستِ مقصد بیرون می‌گذارد', !opts('trTo').includes(out.accountId) && val('trTo') === inn.accountId, opts('trTo').join(','));
check('ویرایش، مبدأِ درست را نشان می‌دهد', val('trFrom') === out.accountId, val('trFrom'));

// ── ۵. بقیهٔ فرم‌ها: همهٔ حساب‌ها در موزاییک، بدونِ استثنا ───────────────
const buy = { id: 'buy9', type: 'out', cat: 'need', accountId: 'a1', amount: 500000, note: 'کتاب', dateISO: isoOf(M0, 9), time: '12:00', month: M0, kind: 'simple', lines: null, updatedAt: 9 };
st.state.transactions.push(buy); st.save();
forms.openTxForm(buy);
check('فرمِ تراکنش همهٔ حساب‌های فعال را دارد', tiles('txAccount').length === 4 && val('txAccount') === 'a1', tiles('txAccount').join(','));
forms.openRefundForm(buy.id);
check('شیتِ برگشت همهٔ حساب‌ها را دارد (برگشت به همان حساب هم می‌شود)', tiles('rfAcc').length === 4 && val('rfAcc') === 'a1', tiles('rfAcc').join(','));
window.closeModal();

R.done();
