// انصراف از خریدِ قسطی و برگشتِ پولِ اقساط:
// سندِ برگشت برای هر قسط، لغوِ اقساطِ باقی‌مانده، اثرِ دقیق روی خرج/پاکت/موجودی،
// نبودنِ طرحِ لغوشده در سررسیدها/یادآوری‌ها/برنامهٔ ماه‌به‌ماه، و راهِ برگشت از انصراف.
//
// اجرا:  cd tools/harness && npm i && node cancel-test.mjs
import { bootApp, reporter, REPO } from './boot-app.mjs';

const R = reporter();
const { check } = R;

const seedState = {
  accounts: [
    { id: 'a1', name: 'کارت ملت', bank: 'بانک ملت', bankId: 'mellat', type: 'کارت بانکی', currency: 'تومان', initial: 0, last4: '1234', updatedAt: 1 },
    { id: 'a2', name: 'حساب ملی', bank: 'بانک ملی', bankId: 'melli', type: 'کارت بانکی', currency: 'تومان', initial: 0, last4: '4321', updatedAt: 2 },
    { id: 'a3', name: 'صرافی', bank: '', type: 'صرافی', currency: 'ریال', initial: 0, updatedAt: 3 },
  ],
  transactions: [], investments: [], debts: [], installments: [],
  budgets: {}, rates: { ریال: 0.1 }, baseCurrency: 'تومان', calendar: 'jalali', bookId: '',
};

const app = await bootApp({ seed: { capital_app_v1: JSON.stringify(seedState) } });
const { window } = app;
const st = await import('file://' + REPO + '/js/state.js');
const forms = await import('file://' + REPO + '/js/forms.js');
const inst = await import('file://' + REPO + '/js/installments.js');
const remind = await import('file://' + REPO + '/js/remind.js');
const jal = await import('file://' + REPO + '/js/jalali.js');
const { fmt, fmtShort } = await import('file://' + REPO + '/js/utils.js');

const M0 = jal.curMonthKey();
const M1 = jal.shiftMonth(M0, 1);
const M2 = jal.shiftMonth(M0, 2);
const isoOf = (mk, day) => {
  const [y, m] = String(mk).split('/').map(Number);
  const g = jal.toGregorian(y, m, day);
  return g[0] + '-' + String(g[1]).padStart(2, '0') + '-' + String(g[2]).padStart(2, '0');
};
const TODAY = jal.isoToday();
const round = (n) => Math.round(n);
const $ = (id) => window.document.getElementById(id);
const val = (id) => String(($(id) || {}).value == null ? '' : $(id).value);
const txt = (id) => String(($(id) || {}).textContent || '');

let pseq = 0;
function mkPlan(o) {
  const p = Object.assign({
    id: 'pl' + ++pseq, kind: 'purchase', mode: 'purchase', title: 'یخچال', accountId: 'a1',
    cat: 'need', badDebt: false, sub: '', note: '', createdISO: TODAY, updatedAt: Date.now(),
    rows: [], disburseTxId: null, disburseAccountId: '', principal: 0,
  }, o);
  st.state.installments.push(p);
  st.save();
  return p;
}
function mkRow(p, o) {
  const r = Object.assign({ id: 'r' + p.rows.length + 1, kind: 'pay', dueISO: isoOf(M1, 10), amount: 0, interest: 0, penalty: 0, paidISO: null }, o);
  p.rows.push(r);
  return r;
}
const rowTx = (p, rowId) => {
  const r = (p.rows || []).find((x) => x.id === rowId);
  return (r && st.state.transactions.find((t) => t.id === r.txId)) || null;
};
const refundsOf = (txId) => st.state.transactions.filter((x) => x.refund && x.refundOf === txId);
const allRefunds = () => st.state.transactions.filter((x) => x.refund);
const snap = () => ({
  spent: st.spentIn(M0), spentM1: st.spentIn(M1), spentM2: st.spentIn(M2),
  need: st.catSpent(M0, 'need'), needM1: st.catSpent(M1, 'need'),
  inc: st.incomeIn(M0), incM1: st.incomeIn(M1),
  bal1: st.accountCurrent(st.state.accounts[0]), bal2: st.accountCurrent(st.state.accounts[1]),
  bal3: st.accountCurrent(st.state.accounts[2]),
  remain: inst.totalRemaining(), due: inst.dueRows(3650).length, n: st.state.transactions.length,
});

// بودجه تا سقفِ پاکت‌ها معنا داشته باشد
st.state.budgets[M0] = { amount: 20000000, updatedAt: Date.now() };
st.state.budgets[M1] = { amount: 20000000, updatedAt: Date.now() };
st.state.budgets[M2] = { amount: 20000000, updatedAt: Date.now() };

// ── ۰. پایه: یک خریدِ قسطی با پیش‌پرداخت و سه قسط ──────────────────────────
const p1 = mkPlan({ title: 'یخچال' });
const down = mkRow(p1, { id: 'down', kind: 'down', dueISO: isoOf(M0, 5), amount: 2000000 });
const r1 = mkRow(p1, { id: 'r1', dueISO: isoOf(M0, 10), amount: 900000, interest: 100000 });
const r2 = mkRow(p1, { id: 'r2', dueISO: isoOf(M1, 10), amount: 900000, interest: 100000 });
const r3 = mkRow(p1, { id: 'r3', dueISO: isoOf(M2, 10), amount: 900000, interest: 100000 });

const pre0 = snap();
inst.payRow(p1.id, 'down', { accountId: 'a1', dateISO: isoOf(M0, 5) });
inst.payRow(p1.id, 'r1', { accountId: 'a1', dateISO: isoOf(M0, 12) });
inst.payRow(p1.id, 'r2', { accountId: 'a1', dateISO: isoOf(M1, 11) });

check('پایه: پیش‌پرداخت و دو قسط سندِ خرج شدند', !!rowTx(p1, 'down') && !!rowTx(p1, 'r1') && !!rowTx(p1, 'r2') && !rowTx(p1, 'r3'));
check('پایه: سندِ قسط پاکتِ همان خرید را دارد', rowTx(p1, 'r1').cat === 'need' && rowTx(p1, 'r1').planId === p1.id);
check('پایه: سودِ قسط هم داخلِ سند است', rowTx(p1, 'r1').amount === 1000000, String(rowTx(p1, 'r1').amount));
check('پایه: خرجِ ماهِ قسط‌ها زیاد شد', round(st.spentIn(M0)) === round(pre0.spent) + 3000000 && round(st.spentIn(M1)) === round(pre0.spentM1) + 1000000, st.spentIn(M0) + '/' + st.spentIn(M1));
check('پایه: ماندهٔ اقساط = قسطِ سوم', round(inst.totalRemaining()) === 1000000, String(inst.totalRemaining()));
check('پایه: آمارِ طرح درست است', (() => { const s = inst.planStats(p1); return s.rows.length === 4 && s.paid.length === 3 && round(s.paidSum) === 4000000 && round(s.remain) === 1000000 && s.done === false; })(), JSON.stringify(inst.planStats(p1).paidSum));
check('پایه: سررسید و یادآوری فقط قسطِ سوم', inst.dueRows(3650).length === 1 && inst.dueRows(3650)[0].row.id === 'r3' && remind.reminderItems().some((x) => x.planId === p1.id));
check('پایه: موجودیِ کارت به اندازهٔ پرداخت‌ها کم شد', round(st.accountCurrent(st.state.accounts[0])) === round(pre0.bal1) - 4000000, String(st.accountCurrent(st.state.accounts[0])));

// ── ۱. راه‌های رسیدن به برگشت در بخشِ اقساط ──────────────────────────────
inst.openPlanDetail(p1.id);
let sheet = app.sheetHtml();
check('جزئیاتِ طرح دکمهٔ «انصراف» دارد', /انصراف/.test(sheet) && sheet.indexOf(`openPlanCancel('${p1.id}')`) >= 0);
check('قسطِ پرداخت‌شده دکمهٔ «برگشت» دارد', sheet.indexOf(`rowRefund('${p1.id}','r1')`) >= 0 && sheet.indexOf(`rowRefund('${p1.id}','down')`) >= 0);
check('قسطِ پرداخت‌نشده دکمهٔ برگشت ندارد', sheet.indexOf(`rowRefund('${p1.id}','r3')`) < 0);
check('دکمهٔ «پرداخت» سرِ جایش است', sheet.indexOf(`openPayRow('${p1.id}','r3')`) >= 0);
check('قسطِ خریدِ قسطی برگشت‌پذیر است', forms.canRefund(rowTx(p1, 'r1')) === true);
check('پیش‌پرداخت هم برگشت‌پذیر است', forms.canRefund(rowTx(p1, 'down')) === true);

// وام: پاکتِ قرض/امانت خرج نیست ⇒ دکمهٔ برگشت روی قسطش نمی‌آید
const p2 = mkPlan({ title: 'وام مسکن', kind: 'loan', cat: 'loan' });
mkRow(p2, { id: 'l1', dueISO: isoOf(M1, 15), amount: 500000 });
inst.payRow(p2.id, 'l1', { accountId: 'a1', dateISO: isoOf(M0, 20) });
inst.openPlanDetail(p2.id);
sheet = app.sheetHtml();
check('قسطِ وام دکمهٔ برگشت ندارد', sheet.indexOf(`rowRefund('${p2.id},'l1')`) < 0);
check('قسطِ وام برگشت‌پذیر نیست', forms.canRefund(rowTx(p2, 'l1')) === false);
check('طرحِ وام هم دکمهٔ «تسویه/انصراف» دارد', sheet.indexOf(`openPlanCancel('${p2.id}')`) >= 0 && /تسویه\/انصراف/.test(sheet));

// ── ۲. برگشتِ بخشی از یک قسط (دقیقاً به همان اندازه) ─────────────────────
inst.rowRefund(p1.id, 'r1');
await app.wait(40);
check('دکمهٔ «برگشت» شیتِ برگشت را باز می‌کند', app.overlayOpen() && /برگشتِ پول/.test(app.sheetHtml()), app.sheetHtml().slice(0, 80));
check('مبلغِ پیشنهادی = کلِّ آن قسط', val('rfAmount') === '1000000', val('rfAmount'));

const pre2 = snap();
forms.setRfAmount('400000');
check('راهنمای زنده می‌گوید چقدر خرج می‌ماند', /خرج می‌ماند/.test(txt('rfHint')), txt('rfHint'));
$('rfAcc').value = 'a2';
$('rfDate').value = isoOf(M0, 20);
forms.setRfReason('کالا معیوب بود');
const n2 = st.state.transactions.length;
forms.saveRefund();
const rf1 = refundsOf(rowTx(p1, 'r1').id)[0];
check('سندِ برگشتِ قسط ساخته شد', st.state.transactions.length === n2 + 1 && !!rf1);
check('سندِ برگشت ورودی و بدونِ پاکت است', rf1 && rf1.type === 'in' && rf1.cat === null);
check('سندِ برگشت به حسابِ مقصد و ماهِ خودش نشست', rf1 && rf1.accountId === 'a2' && rf1.month === M0 && rf1.dateISO === isoOf(M0, 20));
check('دلیلِ برگشت ذخیره شد', rf1 && /کالا معیوب بود/.test(rf1.note || ''));
check('خرجِ ماه دقیقاً ۴۰۰٬۰۰۰ کم شد', round(st.spentIn(M0)) === round(pre2.spent) - 400000, st.spentIn(M0) + ' vs ' + pre2.spent);
check('پاکتِ ضروریات دقیقاً ۴۰۰٬۰۰۰ کم شد', round(st.catSpent(M0, 'need')) === round(pre2.need) - 400000, st.catSpent(M0, 'need') + ' vs ' + pre2.need);
check('برگشت درآمد حساب نشد', round(st.incomeIn(M0)) === round(pre2.inc), String(st.incomeIn(M0)));
check('پول به حسابِ ملی برگشت', round(st.accountCurrent(st.state.accounts[1])) === round(pre2.bal2) + 400000, String(st.accountCurrent(st.state.accounts[1])));
check('موجودیِ کارتِ پرداخت‌کننده دست‌نخورده است', round(st.accountCurrent(st.state.accounts[0])) === round(pre2.bal1), String(st.accountCurrent(st.state.accounts[0])));
check('قسط نیمه‌برگشت‌خورده هنوز بخشی از خرج است', st.spendRatio(rowTx(p1, 'r1')) === 0.6 && st.isReversed(rowTx(p1, 'r1')) === false, String(st.spendRatio(rowTx(p1, 'r1'))));
check('پرداختیِ طرح عوض نمی‌شود؛ جمعِ برگشتی ثبت می‌شود', round(inst.planStats(p1).paidSum) === 4000000 && round(inst.planRefunded(p1)) === 400000, String(inst.planRefunded(p1)));
check('ماندهٔ اقساط با برگشت عوض نمی‌شود', round(inst.totalRemaining()) === round(pre2.remain), String(inst.totalRemaining()));
inst.openPlanDetail(p1.id);
sheet = app.sheetHtml();
check('در جزئیاتِ طرح، برگشتِ آن قسط دیده می‌شود', /برگشت/.test(sheet) && sheet.indexOf(fmtShort(400000)) >= 0, sheet.indexOf(fmtShort(400000)) + ' / ' + fmtShort(400000));
check('قسطِ نیمه‌برگشت‌خورده هنوز دکمهٔ «برگشت» دارد (برای مانده)', sheet.indexOf(`rowRefund('${p1.id}','r1')`) >= 0);

// ── ۳. انصراف از کلّ خرید: همهٔ پرداختی برمی‌گردد، بقیهٔ اقساط لغو ────────
const pre3 = snap();
inst.openPlanCancel(p1.id);
sheet = app.sheetHtml();
check('شیتِ انصراف باز می‌شود', app.overlayOpen() && /انصراف از خریدِ قسطی/.test(sheet));
check('مبلغِ پیشنهادی = همهٔ ماندهٔ قابلِ برگشت', val('pcAmount') === '3600000', val('pcAmount'));
check('شیت می‌گوید چقدر پرداخت شده و چقدر لغو می‌شود', sheet.indexOf(fmtShort(4000000)) >= 0 && sheet.indexOf(fmtShort(1000000)) >= 0);
check('انتخابِ حساب و تاریخ و دلیل دارد', !!$('pcAcc') && val('pcAcc') === 'a1' && val('pcDate') === TODAY && /انصراف از خرید/.test(sheet));
check('چیپِ «به‌جز سود» سودِ پرداخت‌شده را نگه می‌دارد', /به‌جز سود/.test(sheet) && /setPcAmount\('3400000'\)/.test(sheet), (sheet.match(/setPcAmount\('[^']*'\)/g) || []).join(' , '));
check('راهنها می‌گوید چه می‌شود', /برمی‌گردد/.test(txt('pcHint')), txt('pcHint'));
inst.setPcReason('انصراف از خرید');
check('چیپِ دلیل، توضیح را پر می‌کند', val('pcNote') === 'انصراف از خرید', val('pcNote'));
inst.setPcAmount('99999999');
check('مبلغِ بیشتر از پرداختی: راهنما قرمز می‌شود', /بیشتر است/.test(txt('pcHint')), txt('pcHint'));
const nBlocked = st.state.transactions.length;
inst.savePlanCancel();
check('با مبلغِ ناممکن سند ثبت نمی‌شود', st.state.transactions.length === nBlocked && !p1.cancelled);
inst.setPcAmount('3600000');
check('با برگشت به مبلغِ درست، راهنما درست می‌شود', /برمی‌گردد/.test(txt('pcHint')) && !/بیشتر است/.test(txt('pcHint')), txt('pcHint'));

const n3 = st.state.transactions.length;
inst.savePlanCancel();
const made = allRefunds().filter((x) => x.cancelOf === p1.id);
check('برای هر قسطِ پرداخت‌شده یک سندِ برگشت ساخته شد', st.state.transactions.length === n3 + 3 && made.length === 3, String(made.length));
check('سندِ برگشت به قسطِ خودش وصل است', made.every((x) => ['down', 'r1', 'r2'].some((rid) => x.refundOf === rowTx(p1, rid).id)) && made.every((x) => x.refund === true && x.cat === null && x.type === 'in'));
check('جمعِ برگشت دقیقاً همان مبلغ است', round(made.reduce((s, x) => s + x.amount, 0)) === 3600000, String(made.reduce((s, x) => s + x.amount, 0)));
check('ماندهٔ هر قسط درست برگشت: پیش‌پرداخت کامل', round(refundsOf(rowTx(p1, 'down').id)[0].amount) === 2000000, String((refundsOf(rowTx(p1, 'down').id)[0] || {}).amount));
check('ماندهٔ هر قسط درست برگشت: قسطِ نیمه‌برگشت‌خورده', round(refundsOf(rowTx(p1, 'r1').id)[1].amount) === 600000, String((refundsOf(rowTx(p1, 'r1').id)[1] || {}).amount));
check('ماندهٔ هر قسط درست برگشت: قسطِ ماهِ بعد', round(refundsOf(rowTx(p1, 'r2').id)[0].amount) === 1000000, String((refundsOf(rowTx(p1, 'r2').id)[0] || {}).amount));
check('طرح انصراف‌داده‌شده شد', !!p1.cancelled && inst.planStats(p1).cancelled === true && inst.planStats(p1).done === true);
check('ماندهٔ اقساط صفر شد', round(inst.totalRemaining()) === 0, String(inst.totalRemaining()));
check('سررسید و عقب‌افتاده‌ای نماند', inst.dueRows(3650).length === 0 && inst.overdueInstallments() === 0 && inst.planStats(p1).next === null);
check('برنامهٔ ماه‌به‌ماه خالی شد', inst.upcomingByMonth().length === 0);
check('یادآوری‌ها دیگر این طرح را نمی‌گویند', !remind.reminderItems().some((x) => x.planId === p1.id));
check('جمعِ اقساطِ ماهِ قسطِ سوم صفر شد', round(inst.monthInstallments(M2)) === 0, String(inst.monthInstallments(M2)));
check('خرجِ ماهِ پیش‌پرداخت و قسطِ اول صفر شد', round(st.spentIn(M0)) === round(pre3.spent) - 2600000, st.spentIn(M0) + ' vs ' + pre3.spent);
check('خرجِ ماهِ قسطِ دوم صفر شد', round(st.spentIn(M1)) === round(pre3.spentM1) - 1000000, st.spentIn(M1) + ' vs ' + pre3.spentM1);
check('پاکتِ ضروریات هم به همان اندازه کم شد', round(st.catSpent(M0, 'need')) === round(pre3.need) - 2600000 && round(st.catSpent(M1, 'need')) === round(pre3.needM1) - 1000000);
check('برگشت درآمد حساب نشد', round(st.incomeIn(M0)) === round(pre3.inc) && round(st.incomeIn(M1)) === round(pre3.incM1));
check('پول به کارت برگشت', round(st.accountCurrent(st.state.accounts[0])) === round(pre3.bal1) + 3600000, String(st.accountCurrent(st.state.accounts[0])));
check('سندِ برگشت در لیستِ کاربر پنهان نمی‌شود', st.displayTxs(st.state.transactions).filter((x) => x.refund).length === allRefunds().length);
check('قسط‌ها سرِ جایشان ماندند (تاریخچه پاک نشد)', inst.planStats(p1).paid.length === 3 && p1.rows.length === 4);
check('قسطِ لغونشده هنوز سرِ جایش است', !!p1.rows.find((x) => x.id === 'r3') && !p1.rows.find((x) => x.id === 'r3').paidISO);

inst.openPlanDetail(p1.id);
sheet = app.sheetHtml();
check('جزئیات می‌گوید انصراف داده شد', /انصراف داده شد/.test(sheet) && /از این خرید منصرف شده‌ای/.test(sheet));
check('جزئیات جمعِ برگشتی را نشان می‌دهد', sheet.indexOf(fmtShort(4000000)) >= 0, sheet.indexOf(fmtShort(4000000)) + ' / ' + fmtShort(inst.planRefunded(p1)));
check('دکمهٔ «بازگرداندن طرح» آمد', sheet.indexOf(`uncancelPlan('${p1.id}')`) >= 0 && /بازگرداندن طرح/.test(sheet));
check('قسطِ کامل برگشت‌خورده خط خورده و دکمهٔ برگشت ندارد', /line-through/.test(sheet) && sheet.indexOf(`rowRefund('${p1.id}','r2')`) < 0);
check('بخشِ اقساط هم انصراف را نشان می‌دهد', /انصراف داده شد/.test(inst.installmentsSection()) && /یخچال/.test(inst.installmentsSection()));
check('کارتِ خانه دیگر این طرح را یادآوری نمی‌کند', inst.installmentHomeCard() === '');
check('دوباره انصراف زدن کاری نمی‌کند', (() => { inst.openPlanCancel(p1.id); return !/pcAmount/.test(app.sheetHtml()) && app.toasts().some((t) => /چیزی برای لغو/.test(t)); })(), app.toasts().join(' | '));

// ── ۴. انصراف با مبلغِ کمتر (فروشنده جریمه کم کرده) ───────────────────────
const p3 = mkPlan({ title: 'مبل', cat: 'fun' });
mkRow(p3, { id: 'd', kind: 'down', dueISO: isoOf(M0, 6), amount: 500000 });
mkRow(p3, { id: 'x1', dueISO: isoOf(M1, 6), amount: 500000 });
mkRow(p3, { id: 'x2', dueISO: isoOf(M2, 6), amount: 500000 });
inst.payRow(p3.id, 'd', { accountId: 'a1', dateISO: isoOf(M0, 6) });
inst.payRow(p3.id, 'x1', { accountId: 'a1', dateISO: isoOf(M1, 6) });
const pre4 = snap();
inst.openPlanCancel(p3.id);
check('مبلغِ پیشنهادی = همهٔ پرداختی', val('pcAmount') === '1000000', val('pcAmount'));
inst.setPcAmount('700000');
$('pcDate').value = isoOf(M0, 25);
const n4 = st.state.transactions.length;
inst.savePlanCancel();
const made4 = allRefunds().filter((x) => x.cancelOf === p3.id);
check('با مبلغِ کمتر هم دو سند ساخته شد', st.state.transactions.length === n4 + 2 && made4.length === 2, String(made4.length));
check('مبلغ به نسبت بین قسط‌ها پخش شد', round(made4.reduce((s, x) => s + x.amount, 0)) === 700000 && made4.every((x) => x.amount === 350000), JSON.stringify(made4.map((x) => x.amount)));
check('از هر قسط فقط همان سهم کم شد', Math.abs(st.spendRatio(rowTx(p3, 'd')) - 0.3) < 1e-9 && Math.abs(st.spendRatio(rowTx(p3, 'x1')) - 0.3) < 1e-9, st.spendRatio(rowTx(p3, 'd')) + '/' + st.spendRatio(rowTx(p3, 'x1')));
check('پاکتِ تفریح فقط ۱۵۰٬۰۰۰ از هر قسط نگه داشت', round(st.catSpent(M0, 'fun')) === 150000 && round(st.catSpent(M1, 'fun')) === 150000, st.catSpent(M0, 'fun') + '/' + st.catSpent(M1, 'fun'));
check('خرجِ ماه‌ها به اندازهٔ همان ۷۰۰٬۰۰۰ کم شد', round((pre4.spent - st.spentIn(M0)) + (pre4.spentM1 - st.spentIn(M1))) === 700000, (pre4.spent - st.spentIn(M0)) + '/' + (pre4.spentM1 - st.spentIn(M1)));
check('ماندهٔ اقساط صفر شد و قسطِ سوم لغو شد', round(inst.totalRemaining()) === 0 && inst.dueRows(3650).length === 0);
check('پول به کارت برگشت', round(st.accountCurrent(st.state.accounts[0])) === round(pre4.bal1) + 700000, String(st.accountCurrent(st.state.accounts[0])));

// ── ۵. برگشت به حسابِ دیگری با پولِ دیگر ─────────────────────────────────
const p4 = mkPlan({ title: 'لپ‌تاپ' });
mkRow(p4, { id: 'y1', dueISO: isoOf(M0, 8), amount: 1000000 });
inst.payRow(p4.id, 'y1', { accountId: 'a1', dateISO: isoOf(M0, 8) });
const pre5 = snap();
inst.openPlanCancel(p4.id);
$('pcAcc').value = 'a3'; // صرافی با پولِ ریال
inst.savePlanCancel();
const rf5 = allRefunds().filter((x) => x.cancelOf === p4.id)[0];
check('سندِ برگشت با پولِ حسابِ مقصد نوشته شد', rf5 && rf5.accountId === 'a3' && rf5.amount === 10000000, String(rf5 && rf5.amount));
check('موجودیِ صرافی به پولِ خودش زیاد شد', round(st.accountCurrent(st.state.accounts[2])) === round(pre5.bal3) + 10000000, String(st.accountCurrent(st.state.accounts[2])));
check('اثرش روی خرج به تومان همان یک میلیون است', round(pre5.spent - st.spentIn(M0)) === 1000000, String(pre5.spent - st.spentIn(M0)));

// ── ۶. بازگرداندن طرح: هرچه انصراف ساخته بود پاک می‌شود ──────────────────
const pre6 = snap();
inst.uncancelPlan(p1.id);
sheet = app.sheetHtml();
check('بازگرداندن تأیید می‌خواهد', /انصراف لغو شود/.test(sheet));
app.click('#cfYes');
await app.wait(20);
check('سندِ برگشتِ انصراف پاک شد', allRefunds().filter((x) => x.cancelOf === p1.id).length === 0);
check('برگشتِ دستیِ قسط سرِ جایش ماند', refundsOf(rowTx(p1, 'r1').id).length === 1 && st.spendRatio(rowTx(p1, 'r1')) === 0.6, String(st.spendRatio(rowTx(p1, 'r1'))));
check('طرح دوباره فعال شد', !p1.cancelled && inst.planStats(p1).cancelled === false && inst.planStats(p1).done === false);
check('ماندهٔ اقساط برگشت', round(inst.totalRemaining()) === round(pre6.remain) + 1000000, String(inst.totalRemaining()));
check('سررسید و یادآوری برگشتند', inst.dueRows(3650).length === 1 && remind.reminderItems().some((x) => x.planId === p1.id));
check('خرجِ ماه‌ها به حالتِ قبل برگشت (منهای آن برگشتِ دستی)', round(st.spentIn(M0)) === round(pre6.spent) + 2600000 && round(st.spentIn(M1)) === round(pre6.spentM1) + 1000000, st.spentIn(M0) + '/' + st.spentIn(M1));
check('پولِ برگشتی از حساب کم شد', round(st.accountCurrent(st.state.accounts[0])) === round(pre6.bal1) - 3600000, String(st.accountCurrent(st.state.accounts[0])));
check('فقط همان سه سندِ انصراف پاک شد', st.state.transactions.length === pre6.n - 3, st.state.transactions.length + ' vs ' + pre6.n);

// ── ۷. لغوِ پرداختِ قسطی که برگشت خورده ──────────────────────────────────
const pre7 = snap();
const r1txId = rowTx(p1, 'r1').id;
inst.unpayRow(p1.id, 'r1');
sheet = app.sheetHtml();
check('لغوِ پرداخت هشدارِ برگشت می‌دهد', /سندِ برگشتِ پول دارد/.test(sheet), sheet.slice(0, 100));
app.click('#cfYes');
await app.wait(20);
check('با لغوِ پرداخت، سندِ برگشت هم پاک شد', refundsOf(r1txId).length === 0 && !allRefunds().some((x) => x.refundOf === r1txId));
check('قسط به حالت پرداخت‌نشده برگشت', !p1.rows.find((x) => x.id === 'r1').paidISO && !st.state.transactions.some((x) => x.id === r1txId));
check('خرجِ ماه به اندازهٔ کلِّ آن قسط کم شد', round(pre7.spent - st.spentIn(M0)) === 600000, String(pre7.spent - st.spentIn(M0)));
check('پولِ برگشتِ دستی هم از حساب رفت', round(st.accountCurrent(st.state.accounts[1])) === round(pre7.bal2) - 400000, String(st.accountCurrent(st.state.accounts[1])));

// ── ۸. حذفِ طرح، سندِ برگشت‌هایش را هم می‌برد ────────────────────────────
const pre8 = snap();
inst.delPlan(p3.id);
sheet = app.sheetHtml();
check('هشدارِ حذف از برگشتِ پول هم می‌گوید', /برگشتِ پول/.test(sheet), sheet.slice(0, 120));
app.click('#cfYes');
await app.wait(20);
check('طرح حذف شد', !st.state.installments.some((x) => x.id === p3.id));
check('سندِ قسط‌ها و سندِ برگشت‌ها با هم رفتند', !allRefunds().some((x) => x.cancelOf === p3.id) && !st.state.transactions.some((x) => x.planId === p3.id));
check('خرجِ ماه‌ها به حالتِ قبل از آن طرح برگشت', round(st.spentIn(M0)) === round(pre8.spent) - 150000 && round(st.spentIn(M1)) === round(pre8.spentM1) - 150000, st.spentIn(M0) + '/' + st.spentIn(M1));

// ── ۹. انصراف از وام: پول برمی‌گردد ولی خرجی عوض نمی‌شود ────────────────
const pre9 = snap();
inst.openPlanCancel(p2.id);
check('وام هم شیتِ انصراف دارد', app.overlayOpen() && /ثبتِ انصراف/.test(app.sheetHtml()));
inst.savePlanCancel();
const made9 = allRefunds().filter((x) => x.cancelOf === p2.id);
check('سندِ برگشتِ وام ساخته شد', made9.length === 1 && made9[0].amount === 500000, JSON.stringify(made9.map((x) => x.amount)));
check('پول به کارت برگشت', round(st.accountCurrent(st.state.accounts[0])) === round(pre9.bal1) + 500000, String(st.accountCurrent(st.state.accounts[0])));
check('چون پاکتِ قرض است، خرجی عوض نشد', round(st.spentIn(M0)) === round(pre9.spent) && round(st.incomeIn(M0)) === round(pre9.inc), st.spentIn(M0) + ' vs ' + pre9.spent);
check('طرحِ وام هم لغوشده شد', !!p2.cancelled && round(inst.totalRemaining()) === round(pre9.remain));

// ── ۱۰. ترجمهٔ انگلیسیِ رشته‌های تازه ───────────────────────────────────
const en = (await import('file://' + REPO + '/i18n/en-ui.js')).default;
for (const k of ['انصراف از خریدِ قسطی', 'ثبتِ انصراف و برگشتِ پول', 'اقساطِ لغونشده', 'قابلِ برگشت', 'لغوشده', 'بازگرداندن طرح', 'انصراف داده شد', 'لغو پرداخت', 'کالا را پس دادم', 'فروشنده لغو کرد', 'کالا موجود نبود', 'طرح دوباره فعال شد']) {
  check('ترجمهٔ انگلیسی: ' + k, typeof en[k] === 'string' && en[k].length > 1, String(en[k]));
}
check('ترجمهٔ انگلیسیِ راهنمای انصراف', typeof en['انصراف لغو شود؟ اقساطِ باقی‌مانده برمی‌گردند و سندِ برگشتِ پولِ این انصراف پاک می‌شود.'] === 'string');
check('کلیدِ تکراری در ترجمه‌ها نماند', new Set(Object.keys(en)).size === Object.keys(en).length);

R.done();
