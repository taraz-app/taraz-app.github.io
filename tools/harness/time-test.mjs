// ساعتِ تراکنش‌ها: انتقال، اقساط، وام، برگشتِ پول، انصراف از خریدِ قسطی، طلب/بدهی،
// ثبتِ سریع — و نمایشِ ساعت در لیست، دفترِ حساب، دفترچهٔ پاکت و ترتیبِ ردیف‌های یک روز.
//
// اجرا:  cd tools/harness && npm i && node time-test.mjs
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
const inst = await import('file://' + REPO + '/js/installments.js');
const debts = await import('file://' + REPO + '/js/debts.js');
const jal = await import('file://' + REPO + '/js/jalali.js');
const { toFa, nowHM } = await import('file://' + REPO + '/js/utils.js');
const view = await import('file://' + REPO + '/js/view.js');

const M0 = jal.curMonthKey();
const M1 = jal.shiftMonth(M0, 1);
const isoOf = (mk, day) => {
  const [y, m] = String(mk).split('/').map(Number);
  const g = jal.toGregorian(y, m, day);
  return g[0] + '-' + String(g[1]).padStart(2, '0') + '-' + String(g[2]).padStart(2, '0');
};
const TODAY = jal.isoToday();
const $ = (id) => window.document.getElementById(id);
const val = (id) => String(($(id) || {}).value == null ? '' : $(id).value);
const setVal = (id, v) => { const el = $(id); if (el) el.value = v; return !!el; };
const hm = (s) => /^\d{2}:\d{2}$/.test(String(s || ''));
const txs = () => st.state.transactions;
const listHtml = () => ($('txContent') || {}).innerHTML || '';
const sheet = () => app.sheetHtml();

st.state.budgets[M0] = { amount: 20000000, updatedAt: Date.now() };
st.state.budgets[M1] = { amount: 20000000, updatedAt: Date.now() };
// پول در حساب تا انتقال ممکن باشد
st.state.transactions.push({ id: 'inc1', type: 'in', cat: null, amount: 9000000, accountId: 'a1', note: 'حقوق', dateISO: isoOf(M0, 1), time: '08:00', month: M0, updatedAt: 1 });
st.save();

// ── ۱. انتقال بین حساب‌ها ─────────────────────────────────────────────────
forms.openTransferForm();
check('فرمِ انتقال کادرِ ساعت دارد', !!$('trTime') && /ساعت/.test(sheet()));
check('کادرِ ساعت خالی است و «الان» را پیشنهاد می‌دهد', val('trTime') === '' && /الان/.test(sheet()));
setVal('trFrom', 'a1'); setVal('trTo', 'a2'); setVal('trAmount', '500000');
setVal('trDate', isoOf(M0, 12)); setVal('trTime', '14:30');
const n1 = txs().length;
forms.saveTransfer();
const out1 = txs().find((t) => t.type === 'transferOut' && t.amount === 500000);
const inn1 = txs().find((t) => t.type === 'transferIn' && t.pair === out1.pair);
check('انتقال ثبت شد', txs().length === n1 + 2 && !!out1 && !!inn1);
check('ساعت روی سندِ برداشت نشست', out1 && out1.time === '14:30', out1 && out1.time);
check('ساعت روی سندِ واریز هم نشست', inn1 && inn1.time === '14:30', inn1 && inn1.time);
check('ساعت در لیست دیده می‌شود', listHtml().indexOf(toFa('14:30')) >= 0, listHtml().slice(0, 0));

// کارمزدِ انتقال هم همان ساعت را می‌گیرد
forms.openTransferForm();
setVal('trFrom', 'a1'); setVal('trTo', 'a2'); setVal('trAmount', '400000');
setVal('trAmountTo', '395000');
setVal('trDate', isoOf(M0, 13)); setVal('trTime', '21:05');
forms.saveTransfer();
const fee = txs().find((t) => t.nobal && t.pair && t.type === 'out' && t.amount === 5000);
check('کارمزدِ انتقال ساخته شد', !!fee, JSON.stringify(txs().filter((t) => t.nobal).map((t) => t.amount)));
check('کارمزد هم ساعتِ همان انتقال را دارد', fee && fee.time === '21:05', fee && fee.time);
const outF = txs().find((t) => t.pair === fee.pair && t.type === 'transferOut');
check('هر سه سندِ انتقال یک ساعت دارند', outF.time === fee.time && txs().find((t) => t.pair === fee.pair && t.type === 'transferIn').time === fee.time);

// ساعت خالی = همین لحظه
forms.openTransferForm();
setVal('trFrom', 'a1'); setVal('trTo', 'a2'); setVal('trAmount', '100000');
setVal('trDate', isoOf(M0, 14)); setVal('trTime', '');
forms.saveTransfer();
const out2 = txs().find((t) => t.type === 'transferOut' && t.amount === 100000);
check('ساعتِ خالی، ساعتِ همین لحظه می‌شود', out2 && hm(out2.time), out2 && out2.time);

// ویرایشِ انتقال: ساعتِ قبلی پر می‌شود و عوض می‌شود
forms.openTransferForm(out1);
check('ویرایشِ انتقال ساعتِ ثبت‌شده را نشان می‌دهد', val('trTime') === '14:30', val('trTime'));
setVal('trTime', '09:45');
forms.saveTransfer();
check('ویرایش، ساعتِ هر دو سند را عوض کرد', out1.time === '09:45' && inn1.time === '09:45', out1.time + '/' + inn1.time);
check('ویرایش سندِ تازه نساخت', txs().filter((t) => t.pair === out1.pair).length === 2);

// ── ۲. اقساط: پرداختِ قسط ─────────────────────────────────────────────────
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
const rowTx = (p, rowId) => {
  const r = (p.rows || []).find((x) => x.id === rowId);
  return (r && txs().find((t) => t.id === r.txId)) || null;
};
const p1 = mkPlan({ title: 'یخچال' });
p1.rows.push({ id: 'r1', kind: 'pay', dueISO: isoOf(M0, 10), amount: 900000, interest: 100000, penalty: 0, paidISO: null });
p1.rows.push({ id: 'r2', kind: 'pay', dueISO: isoOf(M1, 10), amount: 900000, interest: 0, penalty: 0, paidISO: null });
st.save();

inst.openPayRow(p1.id, 'r1');
check('شیتِ پرداختِ قسط کادرِ ساعت دارد', !!$('prTime') && /ساعت/.test(sheet()));
setVal('prTime', '09:15');
setVal('prDate', isoOf(M0, 11));
inst.confirmPayRow(p1.id, 'r1');
check('ساعتِ قسط روی ردیف ذخیره شد', p1.rows[0].paidTime === '09:15', p1.rows[0].paidTime);
check('ساعت روی سندِ قسط نشست', rowTx(p1, 'r1') && rowTx(p1, 'r1').time === '09:15', rowTx(p1, 'r1') && rowTx(p1, 'r1').time);
inst.openPlanDetail(p1.id);
check('جزئیاتِ طرح ساعتِ پرداخت را نشان می‌دهد', sheet().indexOf(toFa('09:15')) >= 0, sheet().slice(0, 0));
check('دکمهٔ پرداختِ قسطِ بعدی سرِ جایش است', sheet().indexOf(`openPayRow('${p1.id}','r2')`) >= 0);

// پرداختِ سریع (از کارتِ خانه / یادآوری) بدونِ شیت: ساعتِ همین لحظه
const n2 = txs().length;
inst.payRow(p1.id, 'r2');
check('پرداختِ سریع سند ساخت', txs().length === n2 + 1 && !!rowTx(p1, 'r2'));
check('پرداختِ سریع ساعتِ همین لحظه را می‌گذارد', hm(rowTx(p1, 'r2').time), rowTx(p1, 'r2').time);

// لغوِ پرداخت: ساعتِ کهنه نمی‌ماند
inst.unpayRow(p1.id, 'r2');
check('لغوِ پرداخت، ساعت را هم پاک می‌کند', p1.rows[1].paidTime === '' && !rowTx(p1, 'r2'), String(p1.rows[1].paidTime));
inst.payRow(p1.id, 'r2', { dateISO: isoOf(M1, 11), time: '20:00' });
check('پرداختِ دوباره با ساعتِ دلخواه', rowTx(p1, 'r2').time === '20:00', rowTx(p1, 'r2').time);

// ویرایشِ ردیف: ساعتِ پرداخت
inst.openRowEdit(p1.id, 'r1');
check('فرمِ ویرایشِ ردیف کادرِ ساعت دارد', !!$('rwPaidTime') && val('rwPaidTime') === '09:15', val('rwPaidTime'));
setVal('rwPaidTime', '11:30');
inst.saveRow(p1.id, 'r1');
check('ویرایشِ ردیف ساعتِ سند را عوض کرد', rowTx(p1, 'r1').time === '11:30', rowTx(p1, 'r1').time);
inst.openRowEdit(p1.id, 'r1');
setVal('rwPaidTime', '');
inst.saveRow(p1.id, 'r1');
check('خالی گذاشتنِ ساعت، ساعتِ قبلی را نگه می‌دارد', rowTx(p1, 'r1').time === '11:30', rowTx(p1, 'r1').time);

// ── ۳. وام: ساعتِ واریزِ اصل ──────────────────────────────────────────────
inst.openPlanForm();
inst.plSetKind('loan');
check('فرمِ وام کادرِ ساعتِ دریافت دارد', !!$('plStartTime'), sheet().slice(0, 0));
setVal('plTitle', 'وام مسکن');
setVal('plPrincipal', '5000000');
setVal('plStart', isoOf(M0, 2));
setVal('plStartTime', '13:20');
setVal('plDisburseAcc', 'a1');
setVal('plCat', 'need');
setVal('plCount', '3');
setVal('plPer', '1800000');
setVal('plFirst', isoOf(M1, 2));
const n3 = txs().length;
inst.savePlan();
const loan = st.state.installments.find((x) => x.title === 'وام مسکن');
check('طرحِ وام ساخته شد', !!loan, JSON.stringify(st.state.installments.map((x) => x.title)));
const disb = loan && txs().find((t) => t.id === loan.disburseTxId);
check('سندِ واریزِ اصلِ وام ساخته شد', txs().length >= n3 + 1 && !!disb, String(txs().length - n3));
check('ساعتِ دریافت روی سندِ واریز نشست', disb && disb.time === '13:20', disb && disb.time);
check('ساعتِ دریافت روی طرح ذخیره شد', loan && loan.disburseTime === '13:20', loan && loan.disburseTime);

// طرحِ وامِ قدیمی بدونِ ساعت: با اولین هماهنگی، ساعت می‌گیرد
const p3 = mkPlan({ title: 'وام قدیمی', kind: 'loan', cat: 'need', principal: 1000000, disburseAccountId: 'a1', startISO: isoOf(M0, 3), rows: [{ id: 'z1', kind: 'pay', dueISO: isoOf(M1, 3), amount: 500000, interest: 0, penalty: 0, paidISO: null }] });
inst.payRow(p3.id, 'z1', { dateISO: isoOf(M0, 20) });
inst.openPlanForm(p3);
inst.savePlan();
check('طرحِ قدیمی هم ساعتِ واریز پیدا می‌کند', hm(p3.disburseTime), String(p3.disburseTime));
const disb3 = txs().find((t) => t.id === p3.disburseTxId);
check('سندِ واریزِ طرحِ قدیمی ساعت دارد', disb3 && disb3.time === p3.disburseTime, disb3 && disb3.time);

// ── ۴. برگشتِ پول ────────────────────────────────────────────────────────
const buy = { id: 'buy1', type: 'out', cat: 'need', accountId: 'a1', amount: 700000, note: 'کفش', dateISO: isoOf(M0, 9), time: '17:40', month: M0, kind: 'simple', lines: null, updatedAt: 5 };
st.state.transactions.push(buy); st.save();
forms.openRefundForm(buy.id);
check('شیتِ برگشت کادرِ ساعت دارد', !!$('rfTime') && /ساعت/.test(sheet()));
check('ساعتِ برگشت پیش‌فرض خالی است', val('rfTime') === '');
setVal('rfAmount', '300000');
setVal('rfDate', isoOf(M0, 15));
setVal('rfTime', '18:45');
forms.saveRefund();
const rf = txs().find((t) => t.refund && t.refundOf === 'buy1');
check('سندِ برگشت با ساعتِ دلخواه ساخته شد', rf && rf.time === '18:45' && rf.dateISO === isoOf(M0, 15), rf && rf.time);
forms.openRefundForm(buy.id, rf.id);
check('ویرایشِ برگشت ساعتِ ثبت‌شده را نشان می‌دهد', val('rfTime') === '18:45', val('rfTime'));
setVal('rfTime', '');
forms.saveRefund();
check('خالی گذاشتنِ ساعت در ویرایش، ساعتِ قبلی را نگه می‌دارد', rf.time === '18:45', rf.time);
forms.openRefundDetail(rf);
check('شیتِ جزئیاتِ برگشت ساعت را نشان می‌دهد', sheet().indexOf(toFa('18:45')) >= 0, sheet().slice(0, 0));

// ── ۵. انصراف از خریدِ قسطی ──────────────────────────────────────────────
const p4 = mkPlan({ title: 'مبل' });
p4.rows.push({ id: 'm1', kind: 'down', dueISO: isoOf(M0, 6), amount: 500000, interest: 0, penalty: 0, paidISO: null });
p4.rows.push({ id: 'm2', kind: 'pay', dueISO: isoOf(M1, 6), amount: 500000, interest: 0, penalty: 0, paidISO: null });
inst.payRow(p4.id, 'm1', { dateISO: isoOf(M0, 6), time: '10:10' });
inst.payRow(p4.id, 'm2', { dateISO: isoOf(M1, 6), time: '10:10' });
inst.openPlanCancel(p4.id);
check('شیتِ انصراف کادرِ ساعت دارد', !!$('pcTime') && /ساعت/.test(sheet()));
setVal('pcDate', isoOf(M0, 22));
setVal('pcTime', '08:05');
inst.savePlanCancel();
const cancels = txs().filter((t) => t.refund && t.cancelOf === p4.id);
check('انصراف دو سندِ برگشت ساخت', cancels.length === 2, String(cancels.length));
check('هر دو سندِ انصراف ساعتِ انتخابی دارند', cancels.every((t) => t.time === '08:05' && t.dateISO === isoOf(M0, 22)), JSON.stringify(cancels.map((t) => t.time)));
const p5 = mkPlan({ title: 'فرش' });
p5.rows.push({ id: 'f1', kind: 'pay', dueISO: isoOf(M0, 7), amount: 400000, interest: 0, penalty: 0, paidISO: null });
inst.payRow(p5.id, 'f1', { dateISO: isoOf(M0, 7) });
inst.openPlanCancel(p5.id);
setVal('pcTime', '');
inst.savePlanCancel();
const c5 = txs().find((t) => t.refund && t.cancelOf === p5.id);
check('ساعتِ خالی در انصراف = همین لحظه', c5 && hm(c5.time), c5 && c5.time);

// ── ۶. طلب و بدهی ────────────────────────────────────────────────────────
debts.openDebtForm();
check('فرمِ طلب/بدهی کادرِ ساعت دارد', !!$('dTime') && /ساعت/.test(sheet()));
setVal('dPerson', 'رضا'); setVal('dAmount', '1000000');
setVal('dDate', isoOf(M0, 4)); setVal('dTime', '16:25');
setVal('dDue', isoOf(M1, 4));
setVal('dAccount', 'a1');
const n6 = txs().length;
debts.saveDebt();
const d1 = st.state.debts.find((x) => x.person === 'رضا');
check('طلب ثبت شد', !!d1, JSON.stringify((st.state.debts || []).map((x) => x.person)));
const dtx = d1 && txs().find((t) => t.id === d1.txId);
check('سندِ قرض دادن ساعت دارد', dtx && dtx.time === '16:25', dtx && dtx.time);
check('ساعت روی خودِ طلب ذخیره شد', d1 && d1.time === '16:25', d1 && d1.time);

debts.settleDebt(d1.id);
check('شیتِ تسویه کادرِ ساعت دارد', !!$('spTime'), sheet().slice(0, 0));
setVal('spAmount', '400000');
setVal('spDate', isoOf(M0, 18));
setVal('spTime', '19:55');
setVal('spAcc', 'a1');
debts.addDebtPayment(d1.id);
const pay1 = d1.payments[0];
check('پرداختِ جزئی ثبت شد', !!pay1 && pay1.amount === 400000, JSON.stringify(d1.payments));
check('ساعتِ پرداخت ذخیره شد', pay1 && pay1.time === '19:55', pay1 && pay1.time);
const payTx = txs().find((t) => t.id === pay1.txId);
check('سندِ برگشتِ طلب ساعت دارد', payTx && payTx.time === '19:55', payTx && payTx.time);
debts.settleDebt(d1.id);
check('تاریخچهٔ پرداخت ساعت را نشان می‌دهد', sheet().indexOf(toFa('19:55')) >= 0, sheet().slice(0, 0));

// ── ۷. ثبتِ سریع (کیبورد) ────────────────────────────────────────────────
forms.openQuickTx({ amount: 120000, cat: 'need' });
forms.qaChooseAccount('a1');
const n7 = txs().length;
forms.qaSave();
const qa = txs()[txs().length - 1];
check('ثبتِ سریع سند ساخت', txs().length === n7 + 1 && qa && qa.amount === 120000, JSON.stringify(qa && qa.amount));
check('ثبتِ سریع ساعتِ همین لحظه را دارد', qa && hm(qa.time), qa && qa.time);

// ── ۸. نمایش و ترتیب ────────────────────────────────────────────────────
st.state.transactions.push({ id: 'e1', type: 'out', cat: 'fun', accountId: 'a1', amount: 10000, note: 'بدون ساعت', dateISO: isoOf(M0, 16), month: M0, updatedAt: 1, kind: 'simple', lines: null });
st.state.transactions.push({ id: 'e2', type: 'out', cat: 'fun', accountId: 'a1', amount: 20000, note: 'صبح', dateISO: isoOf(M0, 16), time: '07:30', month: M0, updatedAt: 2, kind: 'simple', lines: null });
st.state.transactions.push({ id: 'e3', type: 'out', cat: 'fun', accountId: 'a1', amount: 30000, note: 'شب', dateISO: isoOf(M0, 16), time: '23:10', month: M0, updatedAt: 3, kind: 'simple', lines: null });
st.save();
view.render();
const shown = st.sortTxs(st.displayTxs(txs()));
const day = shown.filter((t) => t.dateISO === isoOf(M0, 16)).map((t) => t.id);
check('ردیف‌های یک روز با ساعت مرتب می‌شوند', day.indexOf('e3') < day.indexOf('e2') && day.indexOf('e2') < day.indexOf('e1'), day.join(','));
const html = listHtml();
check('ساعت در لیست با رقمِ فارسی است', html.indexOf(toFa('07:30')) >= 0 && html.indexOf(toFa('23:10')) >= 0);
check('ردیفِ بدونِ ساعت، ساعتِ الکی نمی‌گیرد', /بدون ساعت/.test(html));

forms.openAccountLedger('a1');
check('دفترِ حساب ساعت را نشان می‌دهد', sheet().indexOf(toFa('14:30')) >= 0 || sheet().indexOf(toFa('09:45')) >= 0, sheet().slice(0, 0));
forms.openPocketLedger('need', M0);
check('دفترچهٔ پاکت ساعت را نشان می‌دهد', sheet().indexOf(toFa('11:30')) >= 0, sheet().slice(0, 0));
check('قلم‌های پاکت ساعت را با خودشان دارند', st.pocketItems(M0, 'need').some((x) => x.time === '11:30'), JSON.stringify(st.pocketItems(M0, 'need').map((x) => x.time)));

// ── ۹. بازبینیِ پیامک/عکس: ساعتِ هر ردیف ─────────────────────────────────
const SMS = 'بانك ملي ايران\nخريداينترنتي:2,362,500-\nحساب:02000\nمانده:11,919,634\n0810-21:55';
forms.openScanText(SMS);
await forms.submitScanText();
await app.wait(30);
const rev = sheet();
check('صفحهٔ بازبینی برای هر ردیف کادرِ ساعت دارد', /pTime_/.test(rev) && /چک کن، بعد ثبت کن/.test(rev), rev.slice(0, 60));
const pid = (rev.match(/id="pTime_([^"]+)"/) || [])[1];
check('ساعتِ خوانده‌شده از پیامک در کادر نشسته', !!pid && val('pTime_' + pid) === '21:55', pid ? val('pTime_' + pid) : 'ردیفی نیست');
setVal('pTime_' + pid, '22:10');
const n9 = txs().length;
forms.savePaperTxs();
const smsTx = txs().find((t) => t.amount === 236250);
check('سندِ پیامک ثبت شد', txs().length === n9 + 1 && !!smsTx, String(txs().length - n9));
check('ساعتِ ویرایش‌شده روی سندِ پیامک نشست', smsTx && smsTx.time === '22:10', smsTx && smsTx.time);

// ── ۱۰. ترجمهٔ انگلیسی ───────────────────────────────────────────────────
const en = (await import('file://' + REPO + '/i18n/en-ui.js')).default;
for (const k of ['ساعت (اختیاری)', 'الان', 'تاریخ', 'تاریخ پرداخت', 'تاریخِ برگشت', 'تاریخ ثبت']) {
  check('ترجمهٔ انگلیسی: ' + k, typeof en[k] === 'string' && en[k].length > 0, String(en[k]));
}
const instSrc = readFileSync(REPO + '/js/installments.js', 'utf8');
check('برچسبِ ساعتِ فرمِ وام ترجمهٔ درست دارد', /plStartTime/.test(instSrc) && !/tr\('ساعت'\)/.test(instSrc));

R.done();
