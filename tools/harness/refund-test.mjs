// برگشتِ پولِ یک خرید: سندِ برگشت و اثرش روی خرجِ ماه، پاکت، درآمد، موجودی و رابطِ کاربری
//
// اجرا:  cd tools/harness && npm i && node refund-test.mjs
import { readFileSync } from 'node:fs';
import { bootApp, reporter, REPO } from './boot-app.mjs';

const R = reporter();
const { check } = R;

const seedState = {
  accounts: [
    { id: 'a1', name: 'کارت ملت', bank: 'بانک ملت', bankId: 'mellat', type: 'کارت بانکی', currency: 'تومان', initial: 0, last4: '1234', updatedAt: 1 },
    { id: 'a2', name: 'حساب ملی', bank: 'بانک ملی', bankId: 'melli', type: 'کارت بانکی', currency: 'تومان', initial: 0, last4: '4321', updatedAt: 2 },
  ],
  transactions: [], investments: [], debts: [], installments: [],
  budgets: {}, rates: {}, baseCurrency: 'تومان', calendar: 'jalali', bookId: '',
};

const app = await bootApp({ seed: { capital_app_v1: JSON.stringify(seedState) } });
const { window } = app;
const st = await import('file://' + REPO + '/js/state.js');
const forms = await import('file://' + REPO + '/js/forms.js');
const jal = await import('file://' + REPO + '/js/jalali.js');
const { fmt } = await import('file://' + REPO + '/js/utils.js');

const M0 = jal.curMonthKey();
const M1 = jal.shiftMonth(M0, 1);
const isoOf = (mk, day) => {
  const [y, m] = String(mk).split('/').map(Number);
  const g = jal.toGregorian(y, m, day);
  return g[0] + '-' + String(g[1]).padStart(2, '0') + '-' + String(g[2]).padStart(2, '0');
};
const TODAY = jal.isoToday();
const dayOf = (iso) => +String(iso).split('-')[2];

let seq = 0;
function addTx(o) {
  const dateISO = o.dateISO || isoOf(M0, 10);
  const t = Object.assign({
    id: 'tx' + ++seq, type: 'out', cat: 'need', accountId: 'a1', amount: 0,
    dateISO, time: '10:00', month: jal.monthOfISO(dateISO), note: '', updatedAt: Date.now(),
  }, o);
  t.month = jal.monthOfISO(t.dateISO);
  st.state.transactions.push(t);
  st.save();
  return t;
}
const byId = (id) => st.state.transactions.find((x) => x.id === id) || null;
const refunds = () => st.state.transactions.filter((x) => x.refund);
const round = (n) => Math.round(n);
// عکسِ لحظه‌ای از آمار: هر ادعا نسبت به «درست قبل از همان کار» سنجیده می‌شود
const snap = () => ({
  spent: st.spentIn(M0), need: st.catSpent(M0, 'need'), fun: st.catSpent(M0, 'fun'),
  inc: st.incomeIn(M0), spentM1: st.spentIn(M1), incM1: st.incomeIn(M1),
  bal1: st.accountCurrent(st.state.accounts[0]), bal2: st.accountCurrent(st.state.accounts[1]),
  n: st.state.transactions.length,
});

// بودجهٔ دو ماه تا سقفِ پاکت‌ها معنا داشته باشد
st.state.budgets[M0] = { amount: 10000000, updatedAt: Date.now() };
st.state.budgets[M1] = { amount: 10000000, updatedAt: Date.now() };
const income = addTx({ type: 'in', cat: null, amount: 5000000, accountId: 'a1', note: 'حقوق', dateISO: isoOf(M0, 1) });
const buy = addTx({ amount: 900000, accountId: 'a1', note: 'لوازم خانگی', cat: 'need', dateISO: isoOf(M0, 10) });
const other = addTx({ amount: 100000, accountId: 'a1', note: 'نان', cat: 'need', dateISO: isoOf(M0, 11) });

check('پایه: خرجِ ماهِ خرید = ۱٬۰۰۰٬۰۰۰ تومان', round(st.spentIn(M0)) === 1000000, String(st.spentIn(M0)));
check('پایه: درآمدِ ماه = ۵٬۰۰۰٬۰۰۰ تومان', round(st.incomeIn(M0)) === 5000000, String(st.incomeIn(M0)));
check('پایه: ماندهٔ حسابِ ملی صفر است', round(st.accountCurrent(st.state.accounts[1])) === 0, String(st.accountCurrent(st.state.accounts[1])));

// ── ۱. روی چه تراکنش‌هایی می‌شود «پولش برگشت» زد ──────────────────────────
const xferOut = addTx({ type: 'transferOut', pair: 'pr1', cat: null, amount: 50000, accountId: 'a1', note: '' });
addTx({ type: 'transferIn', pair: 'pr1', cat: null, amount: 50000, accountId: 'a2', note: '' });
const loanTx = addTx({ cat: 'loan', amount: 200000, accountId: 'a1', note: 'قرض به برادر' });
const planTx = addTx({ amount: 300000, accountId: 'a1', note: 'قسط', planId: 'p1', planRowId: 'r1' });
check('خرجِ ساده: برگشت پذیر است', forms.canRefund(buy) === true);
check('فاکتور هم برگشت می‌پذیرد', forms.canRefund(addTx({ kind: 'invoice', amount: 400000, note: 'فاکتور', lines: [{ id: 'l1', name: 'قلم', qty: 1, unit: '', unitPrice: 400000, amount: 400000, cat: 'need' }] })) === true);
check('درآمد: برگشت ندارد', forms.canRefund(income) === false);
check('انتقال: برگشت ندارد', forms.canRefund(xferOut) === false);
check('پاکتِ قرض: برگشت ندارد', forms.canRefund(loanTx) === false);
check('قسطِ خریدِ قسطی هم برگشت می‌پذیرد (از بخشِ اقساط)', forms.canRefund(planTx) === true);
check('قسطِ پاکتِ قرض/امانت برگشت ندارد', forms.canRefund({ type: 'out', cat: 'loan', accountId: 'a1', amount: 250000, planId: 'p1', planRowId: 'r2' }) === false);

// ── ۲. برگشتِ کامل از راهِ رابطِ کاربری ───────────────────────────────────
forms.openTxForm(buy);
const formHtml = app.sheetHtml();
check('فرمِ تراکنش دکمهٔ «پولش برگشت» دارد', /پولش برگشت/.test(formHtml) && /openRefundForm\('tx2'\)/.test(formHtml), formHtml.slice(0, 120));
check('فرمِ درآمد دکمهٔ برگشت ندارد', (forms.openTxForm(income), !/پولش برگشت/.test(app.sheetHtml())));
check('فرمِ انتقال به فرمِ انتقال می‌رود', (forms.openTxForm(xferOut), !/پولش برگشت/.test(app.sheetHtml())));

forms.openRefundForm(buy.id);
let sheet = app.sheetHtml();
check('شیتِ برگشت باز می‌شود', app.overlayOpen() && /برگشتِ پول/.test(sheet));
check('مبلغِ پیشنهادی = همهٔ مانده', (window.document.getElementById('rfAmount') || {}).value === '900000', String((window.document.getElementById('rfAmount') || {}).value));
check('چیپِ «کلِّ مبلغ» و «نصف» هست', /کلِّ مبلغ/.test(sheet) && /نصف/.test(sheet) && /450000/.test(sheet));
check('انتخابِ حساب دارد و حسابِ خرید پیش‌فرض است', !!window.document.getElementById('rfAcc') && window.document.getElementById('rfAcc').value === 'a1');
check('تاریخِ برگشت پیش‌فرض امروز است', (window.document.getElementById('rfDate') || {}).value === TODAY, String((window.document.getElementById('rfDate') || {}).value));
check('چیپ‌های دلیل هست', /کالا نرسید/.test(sheet) && /سفارش لغو شد/.test(sheet));
check('راهنما می‌گوید چه می‌شود', /دیگر خرج حساب نمی‌شود/.test((window.document.getElementById('rfHint') || {}).textContent || ''), (window.document.getElementById('rfHint') || {}).textContent);

forms.setRfReason('کالا نرسید');
check('چیپِ دلیل، توضیح را پر می‌کند', /کالا نرسید/.test(String((window.document.getElementById('rfNote') || {}).value)));
forms.setRfAmount('450000');
check('با مبلغِ کمتر، راهنها عوض می‌شود', /خرج می‌ماند/.test((window.document.getElementById('rfHint') || {}).textContent || ''), (window.document.getElementById('rfHint') || {}).textContent);
forms.setRfAmount('900000');

const pre = snap();
const nBefore = st.state.transactions.length;
window.document.getElementById('rfDate').value = isoOf(M0, Math.min(20, dayOf(TODAY) + 1));
window.document.getElementById('rfAcc').value = 'a2'; // پول به حسابِ دیگری برگشته
forms.saveRefund();
const rf = refunds()[0];
check('سندِ برگشت ساخته شد', st.state.transactions.length === nBefore + 1 && !!rf);
check('سندِ برگشت به خرید وصل است', rf && rf.refundOf === buy.id && rf.refund === true);
check('سندِ برگشت ورودی است ولی پاکت ندارد', rf && rf.type === 'in' && rf.cat === null);
check('سندِ برگشت در حسابِ مقصد و ماهِ خودش نشست', rf && rf.accountId === 'a2' && rf.month === M0, rf && rf.month);
check('دلیلِ برگشت ذخیره شد', rf && /کالا نرسید/.test(rf.note || ''), rf && rf.note);
check('شیت بسته شد', !app.overlayOpen());

// ── ۳. اثرِ مالی ─────────────────────────────────────────────────────────
check('خریدِ برگشت‌خورده دیگر خرج نیست', st.isReversed(buy) === true && st.spendRatio(buy) === 0);
check('موجودیِ حسابِ خرید دست‌نخورده است', round(st.accountCurrent(st.state.accounts[0])) === -1000000 + 5000000 - 50000 - 200000 - 300000 - 400000, String(st.accountCurrent(st.state.accounts[0])));
check('پول به حسابِ مقصد برگشت', round(st.accountCurrent(st.state.accounts[1])) === 50000 + 900000, String(st.accountCurrent(st.state.accounts[1])));
check('خرجِ ماه دقیقاً به اندازهٔ برگشت کم شد', round(st.spentIn(M0)) === round(pre.spent) - 900000, st.spentIn(M0) + ' vs ' + pre.spent);
check('پاکتِ ضروریات دقیقاً به همان اندازه کم شد', round(st.catSpent(M0, 'need')) === round(pre.need) - 900000, st.catSpent(M0, 'need') + ' vs ' + pre.need);
check('برگشت درآمد حساب نشد', round(st.incomeIn(M0)) === round(pre.inc), st.incomeIn(M0) + ' vs ' + pre.inc);
check('موجودیِ حسابِ مقصد به اندازهٔ برگشت زیاد شد', round(st.accountCurrent(st.state.accounts[1])) === round(pre.bal2) + 900000, String(st.accountCurrent(st.state.accounts[1])));
check('موجودیِ حسابِ خرید با برگشت عوض نشد', round(st.accountCurrent(st.state.accounts[0])) === round(pre.bal1), String(st.accountCurrent(st.state.accounts[0])));
check('قلم در دفترچهٔ پاکت می‌ماند ولی اثرش صفر است', (() => {
  const it = st.pocketItems(M0, 'need').find((x) => x.txId === buy.id);
  return !!it && it.reversed === true && it.amount === 0 && it.gross === 900000;
})(), JSON.stringify(st.pocketItems(M0, 'need').find((x) => x.txId === buy.id)));
check('سندِ برگشت در لیستِ کاربر پنهان نمی‌شود', st.displayTxs(st.state.transactions).some((x) => x.refund));

// ── ۴. رابط: ردیف‌ها و دفترچه ────────────────────────────────────────────
forms.openTxForm(buy);
sheet = app.sheetHtml();
check('خریدِ کامل برگشت‌خورده: دکمهٔ برگشت ندارد و راهنما دارد', !/پولش برگشت/.test(sheet) && /کامل برگشته/.test(sheet), sheet.slice(0, 100));
forms.openRefundDetail(rf);
sheet = app.sheetHtml();
check('شیتِ سندِ برگشت: لغو و دیدنِ خرید و ویرایش', /لغوِ این برگشت/.test(sheet) && /دیدنِ خرید/.test(sheet) && /ویرایش/.test(sheet));
check('شیتِ سندِ برگشت مبلغ و حسابِ خودش را نشان می‌دهد', /حساب ملی/.test(sheet) && sheet.indexOf(fmt(900000)) >= 0, sheet.indexOf(fmt(900000)) + ' / ' + fmt(900000));
forms.openPocketLedger('need', M0);
sheet = app.sheetHtml();
check('دفترچهٔ پاکت برچسبِ «برگشت خورد» دارد', /برگشت خورد/.test(sheet));
check('دفترچهٔ پاکت می‌گوید خرج حساب نمی‌شود', /خرج حساب نمی‌شود/.test(sheet));
check('خرجِ نشان‌داده‌شده در دفترچه بدونِ آن خرید است', sheet.indexOf(fmt(st.catSpent(M0, 'need'))) >= 0, fmt(st.catSpent(M0, 'need')));
check('مبلغِ خط‌خوردهٔ خرید در دفترچه دیده می‌شود', sheet.indexOf(fmt(900000)) >= 0 && /line-through/.test(sheet));

// ── ۵. ویرایشِ سندِ برگشت (جای اضافه‌شدن، عوض می‌شود) ─────────────────────
forms.openRefundForm(buy.id, rf.id);
check('ویرایشِ برگشت مبلغِ قبلی را نشان می‌دهد', (window.document.getElementById('rfAmount') || {}).value === '900000', String((window.document.getElementById('rfAmount') || {}).value));
check('ویرایشِ برگشت عنوانِ درست دارد', /ویرایشِ برگشت/.test(app.sheetHtml()));
const nEdit = st.state.transactions.length;
window.document.getElementById('rfAmount').value = '900000';
window.document.getElementById('rfDate').value = isoOf(M0, Math.min(25, dayOf(TODAY) + 2));
forms.saveRefund();
check('ویرایش، سندِ تازه نمی‌سازد', st.state.transactions.length === nEdit);
check('تاریخِ سندِ برگشت ویرایش شد', byId(rf.id).dateISO === isoOf(M0, Math.min(25, dayOf(TODAY) + 2)), byId(rf.id).dateISO);

// ── ۶. لغوِ برگشت: همه‌چیز به حالتِ قبل ─────────────────────────────────
forms.openRefundDetail(byId(rf.id));
forms.cancelRefund(rf.id);
check('لغو، تأیید می‌خواهد', /لغو شود/.test(app.sheetHtml()));
app.click('#cfYes');
await app.wait(20);
check('سندِ برگشت حذف شد', refunds().length === 0);
check('خرجِ ماه به حالتِ قبل برگشت', round(st.spentIn(M0)) === round(pre.spent), st.spentIn(M0) + ' vs ' + pre.spent);
check('پاکت به حالتِ قبل برگشت', round(st.catSpent(M0, 'need')) === round(pre.need), st.catSpent(M0, 'need') + ' vs ' + pre.need);
check('موجودیِ حسابِ مقصد به حالتِ قبل برگشت', round(st.accountCurrent(st.state.accounts[1])) === round(pre.bal2), String(st.accountCurrent(st.state.accounts[1])));
check('تعدادِ تراکنش‌ها به حالتِ قبل برگشت', st.state.transactions.length === pre.n, st.state.transactions.length + ' vs ' + pre.n);
check('خرید دوباره خرج حساب می‌شود', st.isReversed(buy) === false && st.spendRatio(buy) === 1);

// ── ۷. برگشتِ جزئی: دقیقاً به همان اندازه که برگشته ──────────────────────
const part = addTx({ amount: 800000, accountId: 'a1', note: 'کفش', cat: 'fun', dateISO: isoOf(M0, 12) });
const pre7 = snap();
const needBefore = pre7.need;
const funBefore = pre7.fun;
forms.openRefundForm(part.id);
window.document.getElementById('rfAmount').value = '300000';
forms.saveRefund();
check('برگشتِ جزئی ثبت شد', refunds().length === 1 && refunds()[0].amount === 300000);
check('پاکتِ تفریح فقط ۳۰۰٬۰۰۰ کم شد', round(st.catSpent(M0, 'fun')) === round(funBefore) - 300000, st.catSpent(M0, 'fun') + ' vs ' + funBefore);
check('پاکتِ ضروریات دست‌نخورده ماند', round(st.catSpent(M0, 'need')) === round(needBefore), st.catSpent(M0, 'need') + ' vs ' + needBefore);
check('خرجِ ماه فقط ۳۰۰٬۰۰۰ کم شد', round(st.spentIn(M0)) === round(pre7.spent) - 300000, st.spentIn(M0) + ' vs ' + pre7.spent);
check('نسبتِ باقی‌ماندهٔ خرج درست است', Math.abs(st.spendRatio(part) - 0.625) < 1e-9, String(st.spendRatio(part)));
check('برگشتِ جزئی، خرید را «باطل» نمی‌کند', st.isReversed(part) === false);
check('مبلغِ برگشت‌خورده به پولِ خودِ تراکنش', round(st.refundedInTxUnit(part)) === 300000, String(st.refundedInTxUnit(part)));
check('برگشتِ جزئی هم درآمد نیست', round(st.incomeIn(M0)) === round(pre7.inc), String(st.incomeIn(M0)));
forms.openRefundForm(part.id);
check('ماندهٔ قابلِ برگشت ۵۰۰٬۰۰۰ است', (window.document.getElementById('rfAmount') || {}).value === '500000', String((window.document.getElementById('rfAmount') || {}).value));
window.document.getElementById('rfAmount').value = '900000';
forms.refundPreview();
check('مبلغِ بیشتر از خرید، هشدار می‌گیرد', /بیشتر است/.test((window.document.getElementById('rfHint') || {}).textContent || ''), (window.document.getElementById('rfHint') || {}).textContent);
const nOver = st.state.transactions.length;
forms.saveRefund();
check('مبلغِ زیادی رد می‌شود', st.state.transactions.length === nOver && refunds().length === 1);
forms.openRefundForm(part.id);
window.document.getElementById('rfAmount').value = '500000';
forms.saveRefund();
check('ادامهٔ برگشتِ جزئی تا کامل', st.isReversed(part) === true && refunds().length === 2, 'n=' + refunds().length);
check('با کامل‌شدن، خرجِ آن پاکت صفر شد', round(st.catSpent(M0, 'fun')) === round(funBefore) - 800000, st.catSpent(M0, 'fun') + ' vs ' + funBefore);

// ── ۸. فاکتور: برگشت به نسبتِ اقلام تقسیم می‌شود ─────────────────────────
const inv = addTx({
  kind: 'invoice', amount: 900000, accountId: 'a1', note: 'خرید خانه', cat: null, dateISO: isoOf(M0, 13),
  lines: [
    { id: 'il1', name: 'برنج', qty: 1, unit: '', unitPrice: 600000, amount: 600000, cat: 'need' },
    { id: 'il2', name: 'بازی', qty: 1, unit: '', unitPrice: 300000, amount: 300000, cat: 'fun' },
  ],
});
const needB2 = st.catSpent(M0, 'need');
const funB2 = st.catSpent(M0, 'fun');
forms.openRefundForm(inv.id);
window.document.getElementById('rfAmount').value = '300000';
forms.saveRefund();
check('برگشتِ فاکتور: ضروریات به نسبت کم شد (۲۰۰٬۰۰۰)', round(st.catSpent(M0, 'need')) === round(needB2) - 200000, st.catSpent(M0, 'need') + ' vs ' + needB2);
check('برگشتِ فاکتور: تفریح به نسبت کم شد (۱۰۰٬۰۰۰)', round(st.catSpent(M0, 'fun')) === round(funB2) - 100000, st.catSpent(M0, 'fun') + ' vs ' + funB2);
check('راهنمای فاکتور از پاکتِ قلم‌ها حرف می‌زند', (forms.openRefundForm(inv.id, refunds().find((x) => x.refundOf === inv.id).id), /پاکتِ قلم‌های فاکتور|برگشت/.test(app.sheetHtml())));

// ── ۹. برگشت در ماهِ بعد: اثر در ماهِ خرید، ردیف در ماهِ خودش ────────────
const lateBuy = addTx({ amount: 700000, accountId: 'a1', note: 'کت', cat: 'need', dateISO: isoOf(M0, 14) });
const pre9 = snap();
const ceilM1Before = st.catCeiling(M1, 'need');
const spentM1Before = pre9.spentM1;
const incM1Before = pre9.incM1;
forms.openRefundForm(lateBuy.id);
window.document.getElementById('rfDate').value = isoOf(M1, 3);
window.document.getElementById('rfAmount').value = '700000';
forms.saveRefund();
const lateRf = refunds().find((x) => x.refundOf === lateBuy.id);
check('سندِ برگشت در ماهِ بعد نشست', lateRf && lateRf.month === M1 && lateRf.dateISO === isoOf(M1, 3), lateRf && lateRf.month);
check('خرجِ ماهِ خرید کم شد', round(st.spentIn(M0)) === round(pre9.spent) - 700000, st.spentIn(M0) + ' vs ' + pre9.spent);
check('خرجِ ماهِ بعد زیاد نشد', round(st.spentIn(M1)) === round(spentM1Before), st.spentIn(M1) + ' vs ' + spentM1Before);
check('درآمدِ ماهِ بعد زیاد نشد', round(st.incomeIn(M1)) === round(incM1Before), st.incomeIn(M1) + ' vs ' + incM1Before);
check('سقفِ پاکتِ ماهِ بعد از ماندهٔ آزادشده بیشتر شد', st.catCeiling(M1, 'need') > ceilM1Before, st.catCeiling(M1, 'need') + ' vs ' + ceilM1Before);
check('ماندهٔ ماهِ خرید هم بیشتر شد', st.computeMonths()[M0].remaining > 0 && round(st.computeMonths()[M0].spent) === round(st.spentIn(M0)), String(st.computeMonths()[M0].spent));

// ── ۱۰. حذفِ خرید، برگشت‌هایش را هم می‌برد ───────────────────────────────
const nDel = st.state.transactions.length;
const rfOfLate = refunds().filter((x) => x.refundOf === lateBuy.id).length;
forms.delTx(lateBuy.id);
check('تأییدِ حذف، برگشت را هم می‌گوید', /برگشتِ پولش/.test(app.sheetHtml()));
app.click('#cfYes');
await app.wait(20);
check('خرید با سندِ برگشتش حذف شد', st.state.transactions.length === nDel - 1 - rfOfLate && !byId(lateBuy.id), 'n=' + st.state.transactions.length);
check('برگشتِ یتیم نماند', !refunds().some((x) => x.refundOf === lateBuy.id));

// ── ۱۱. ردیفِ برگشت در لیستِ تراکنش‌ها دیده می‌شود ───────────────────────
const todayBuy = addTx({ amount: 250000, accountId: 'a1', note: 'هدفون', cat: 'fun', dateISO: TODAY });
forms.openRefundForm(todayBuy.id);
window.document.getElementById('rfNote').value = 'کالا نرسید';
forms.saveRefund();
const listHtml = (window.document.getElementById('txContent') || {}).innerHTML || '';
check('ردیفِ «برگشتِ پول» در لیستِ همان روز هست', /برگشتِ پول|کالا نرسید/.test(listHtml) && /برگشت/.test(listHtml));
check('ردیفِ خرید برچسبِ «برگشت خورد» گرفت', /برگشت خورد/.test(listHtml));
check('برگشت در لیست با آیکنِ خودش است', listHtml.indexOf('M9 14L4 9l5-5') >= 0);
check('ردیفِ برگشت با برچسبِ سبز مشخص است', /badge" style="color:var\(--green\)">برگشت</.test(listHtml));

// ── ۱۲. ترجمهٔ انگلیسیِ رشته‌های تازه ───────────────────────────────────
const en = readFileSync(REPO + '/i18n/en-ui.js', 'utf8');
for (const k of ['پولش برگشت', 'برگشتِ پول', 'چقدر برگشت؟', 'به کدام حساب برگشت؟', 'تاریخِ برگشت', 'کالا نرسید', 'لغوِ این برگشت', 'برگشت خورد', 'ثبتِ برگشت']) {
  check('ترجمهٔ انگلیسی: ' + k, en.indexOf("'" + k + "':") >= 0);
}
// هیچ‌جا به کاربر نگوییم «تراکنش را حذف کن» تا پول برگردد
const fa = readFileSync(REPO + '/js/forms.js', 'utf8');
check('راهنمای شیت می‌گوید خرید سرِ جایش می‌ماند', /تراکنشِ خرید سرِ جایش می‌ماند/.test(fa));

R.done(app.problems);
