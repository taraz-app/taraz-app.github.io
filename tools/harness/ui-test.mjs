// دودِ کلیِ برنامه در jsdom: بوت، تب‌ها، فیلتر، اسکن، فرم تراکنش، نسخه و پیش‌کش
import { readFileSync, readdirSync } from 'node:fs';
import { bootApp, reporter, REPO } from './boot-app.mjs';

const TODAY = new Date().toISOString().slice(0, 10);
const MONTH = TODAY.slice(0, 7);

const R = reporter();
const { check } = R;

const seedState = {
  accounts: [
    { id: 'a1', name: 'کارت ملت', bank: 'بانک ملت', bankId: 'mellat', type: 'کارت بانکی', currency: 'تومان', initial: 500000, last4: '1234', updatedAt: 1 },
    { id: 'a2', name: 'نقد', bank: '', type: 'نقدی', currency: 'تومان', initial: 50000, updatedAt: 2 },
  ],
  transactions: [
    { id: 't1', type: 'out', amount: 20000, accountId: 'a2', note: 'نان', dateISO: TODAY, time: '09:00', month: MONTH, cat: 'need', sub: '', lines: [], tags: [], stamp: 1, updatedAt: 1 },
    { id: 't2', type: 'in', amount: 900000, accountId: 'a1', note: 'حقوق', dateISO: TODAY, time: '08:00', month: MONTH, cat: null, sub: '', lines: [], tags: [], stamp: 2, updatedAt: 2 },
  ],
  investments: [], debts: [], installments: [],
  budgets: {}, rates: {}, baseCurrency: 'تومان', calendar: 'jalali', bookId: '',
};

const app = await bootApp({ seed: { capital_app_v1: JSON.stringify(seedState) } });
const { window } = app;
const $ = app.$;
const doc = window.document;
const st = await import('file://' + REPO + '/js/state.js');

// ── بوت و رندر ────────────────────────────────────────────────────────
check('خانه رندر شد', ($('homeContent').innerHTML || '').length > 200, 'len=' + ($('homeContent').innerHTML || '').length);
window.switchTab('tx');
await app.wait(60);
check('تبِ تراکنش‌ها فعال شد', $('tab-tx').classList.contains('active'));
check('لیست تراکنش‌ها رندر شد', /نان/.test($('txContent').textContent) && /حقوق/.test($('txContent').textContent));
check('نوارِ فیلتر در لیست هست', !!$('txfQ') || /txfOpen\(/.test($('txContent').innerHTML));
check('چیپِ «نوع» بیرونِ شیتِ فیلتر رندر نمی‌شود', !/txfDraft\('kinds'|txfToggle\('kinds'/.test($('txContent').innerHTML));
window.txfOpen();
await app.wait(30);
check('شیتِ فیلتر چیپِ نوع دارد', app.overlayOpen() && /txfDraft\('kinds'/.test(app.sheetHtml()));
window.closeModal();
await app.wait(20);
check('شیت بسته شد', !app.overlayOpen());

// ── انتخابگرِ اسکن ─────────────────────────────────────────────────────
window.setScanMenu(true);
await app.wait(20);
check('انتخابگرِ اسکن باز شد', $('scanSheet').classList.contains('show'));
check('سه راهِ ورود: دوربین، گالری، متن', !!$('scCam') && !!$('scGal') && !!$('scTxt'));
$('scCam').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await app.wait(30);
check('بدون کلید، دوربین پیامِ «کلید را بگذار» می‌دهد', app.toasts().some((t) => /کلید/.test(t)), app.toasts().join(' | '));
check('بدون کلید، شیتِ عکس باز نشد', !app.overlayOpen());
$('scTxt').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await app.wait(30);
check('متنِ پیامک بدون کلید هم باز می‌شود', app.overlayOpen() && !!$('scanTxt'));
window.closeModal();
await app.wait(20);

// ── فرم تراکنش ────────────────────────────────────────────────────────
window.openTxForm(null, { full: true });
await app.wait(60);
check('فرم تراکنش باز شد', app.overlayOpen() && !!$('txAmount') && !!$('txNote'));
check('انتخابگرِ حساب با چیپس و شیت رندر شد', !!$('txAccount') && !!doc.querySelector('#txAccount_ap'));
check('چیپسِ حساب موجودی را نشان می‌دهد', /۵۰۰/.test($('txAccount_ap').textContent) || ($('txAccount_ap').textContent || '').length > 5, $('txAccount_ap').textContent.slice(0, 40));
check('دکمهٔ اسکن داخل فرم هست', /toggleScanPick\(/.test(app.sheetHtml()));
window.toggleScanPick();
await app.wait(20);
check('ردیفِ انتخابِ منبع باز شد و «متن پیامک» دارد', /startScan\('cam'\)/.test(app.sheetHtml()) && /openScanText\(\)/.test(app.sheetHtml()));
$('txNote').value = 'تستِ دود';
$('txAmount').value = '12000';
$('txAmount').dispatchEvent(new window.Event('input'));
if (!doc.querySelector('#txTypeSeg button.on')) window.setTxType('out');
const before = st.state.transactions.length;
const hadType = !!doc.querySelector('#txTypeSeg button.on');
if (!hadType) { window.setTxType('out'); await app.wait(20); }
const catChip = doc.querySelector('#txCats .chip[data-cat="need"]');
check('چیپسِ پاکت در فرم هست', !!catChip);
if (catChip) window.setTxCat(catChip);
await app.wait(20);
window.saveTx();
await app.wait(60);
if (st.state.transactions.length === before) console.log('  [debug] saveTx toasts:', app.toasts().join(' | '), '| typeSeg:', !!doc.querySelector('#txTypeSeg button.on'), '| amt:', ($('txAmount') || {}).value);
const added = st.state.transactions.slice(before);
check('تراکنش از فرم ثبت شد', added.length === 1, 'added=' + added.length);
check('مبلغ و یادداشت درست ثبت شد', added[0] && added[0].amount === 12000 && added[0].note === 'تستِ دود', JSON.stringify(added[0] && { a: added[0].amount, n: added[0].note }));
check('حسابِ تراکنش آیدی دارد', added[0] && st.state.accounts.some((a) => a.id === added[0].accountId));
check('فرم بعد از ثبت بسته شد', !app.overlayOpen());

// ── ثبتِ سریع ─────────────────────────────────────────────────────────
window.openQuickTx();
await app.wait(60);
check('ثبتِ سریع باز شد', app.overlayOpen());
check('ثبتِ سریع هم انتخابگرِ حساب دارد', !!doc.querySelector('[id^="qaAcc"]') || /qaPickAccount|qaChooseAccount/.test(app.sheetHtml()));
window.closeModal();
await app.wait(20);

// ── نسخه و پیش‌کش ─────────────────────────────────────────────────────
const idx = readFileSync(REPO + '/index.html', 'utf8');
const utils = readFileSync(REPO + '/js/utils.js', 'utf8');
const sw = readFileSync(REPO + '/sw.js', 'utf8');
const ver = (utils.match(/APP_VERSION = '([^']+)'/) || [])[1];
check('نسخه در utils تعریف شده', /^\d+\.\d+\.\d+$/.test(ver || ''), ver);
const refs = [...idx.matchAll(/\.(?:css|js)\?v=([\d.]+)/g)].map((m) => m[1]);
check('index.html به همان نسخه ارجاع می‌دهد', refs.length >= 2 && refs.every((v) => v === ver), refs.join(','));
check('READMEها همان نسخه را دارند',
  readFileSync(REPO + '/README.md', 'utf8').includes(ver) && readFileSync(REPO + '/README.fa.md', 'utf8').includes(ver));
const cache = (sw.match(/CACHE = '([^']+)'/) || [])[1];
check('نامِ کشِ سرویس‌ورکر v… است', /^capital-app-v\d+$/.test(cache || ''), cache);
check('هر فایلِ js در پیش‌کشِ سرویس‌ورکر هست',
  readdirSync(REPO + '/js').filter((f) => f.endsWith('.js')).every((f) => sw.includes("'./js/" + f + "'")),
  readdirSync(REPO + '/js').filter((f) => f.endsWith('.js') && !sw.includes("'./js/" + f + "'")).join(','));
check('نقطهٔ ورودِ برنامه در index.html هست', /src="js\/boot\.js\?v=/.test(idx));
check('boot.js اول زبان را می‌آورد بعد برنامه را', /initI18n/.test(readFileSync(REPO + '/js/boot.js', 'utf8')) && /import\('\.\/app\.js'\)/.test(readFileSync(REPO + '/js/boot.js', 'utf8')));

R.done(app.problems);
