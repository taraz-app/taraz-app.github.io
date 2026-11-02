// اسکنِ کارتِ بانکی: آیکونِ دکمه، شیتِ چهارخانه‌ی اسکن، خواندنِ شماره بدون هوش مصنوعی، ساختِ حساب
import { readFileSync, readdirSync } from 'node:fs';
import { bootApp, reporter, REPO } from './boot-app.mjs';

const R = reporter();
const { check } = R;

const TODAY = new Date().toISOString().slice(0, 10);
const seedState = {
  accounts: [
    { id: 'a1', name: 'کارت ملت', bank: 'بانک ملت', bankId: 'mellat', type: 'کارت بانکی', currency: 'تومان', initial: 500000, last4: '1234', updatedAt: 1 },
    { id: 'a2', name: 'نقد', bank: '', type: 'نقدی', currency: 'تومان', initial: 50000, updatedAt: 2 },
  ],
  transactions: [], investments: [], debts: [], installments: [],
  budgets: {}, rates: {}, baseCurrency: 'تومان', calendar: 'jalali', bookId: '',
};

const app = await bootApp({ seed: { capital_app_v1: JSON.stringify(seedState) } });
const { window } = app;
const $ = app.$;
const doc = window.document;
const st = await import('file://' + REPO + '/js/state.js');
const scan = await import('file://' + REPO + '/js/scan.js');
const cards = await import('file://' + REPO + '/js/cards.js');

const MELLI = '6037991234567893';   // لون درست، BIN ملی
const BLU = '6219861900000000';     // لون درست، BIN8 بلوبانک
const BAD = '6037991234567890';     // لون غلط

// ── ۱. آیکونِ دکمهٔ شناور: دیگر دوربین نیست ──────────────────────────────
const fabHtml = ($('scanFab') || {}).innerHTML || '';
check('آیکونِ دوربین از دکمهٔ اسکن برداشته شد', !/M4 8h3l2-3h6/.test(fabHtml), fabHtml.slice(0, 90));
check('آیکونِ «اسکن» (کادرِ گوشه‌دار) گذاشته شد', /M3 8V5a2 2 0 0 1 2-2h3/.test(fabHtml), fabHtml.slice(0, 90));
check('عنوانِ دکمه هر چهار ورودی را می‌گوید', /کارت بانکی/.test($('scanFab').getAttribute('title') || '') && /متن پیامک/.test($('scanFab').getAttribute('aria-label') || ''), $('scanFab').getAttribute('title'));

// ── ۲. شیتِ اسکن چهار خانه دارد ─────────────────────────────────────────
check('شیتِ اسکن چهار خانه دارد', doc.querySelectorAll('#scanSheet .fs-it').length === 4, 'n=' + doc.querySelectorAll('#scanSheet .fs-it').length);
check('خانهٔ «کارت بانکی» اضافه شد', !!$('scCard') && /کارت بانکی/.test($('scCard').textContent));
check('چیدمانِ شیت چهارستونه است', !/cols3/.test($('scanSheet').innerHTML));
check('آیکونِ خانهٔ کارت، کارت است', /M2 10h20/.test($('scCard').innerHTML || ''), $('scCard').innerHTML.slice(0, 60));
check('ورودی‌های پنهانِ عکسِ کارت در صفحه‌اند', !!$('cardScanCam') && !!$('cardScanGal'));
check('ورودیِ کارت onchange درست دارد', /onCardPhoto\(this\)/.test($('cardScanCam').getAttribute('onchange') || ''));

// ── ۳. بیرون‌کشیدنِ شماره از متن (پارسرِ محلی، بدون هوش مصنوعی) ──────────
const cdt = scan.cardDigitsFromText;
check('گروه‌های ۴تایی با فاصله', cdt('بانک ملت\n6037 9912 3456 7893\n12/07').digits === MELLI, cdt('6037 9912 3456 7893').digits);
check('خط تیره و رقمِ فارسی', cdt('کارت: ۶۰۳۷-۹۹۱۲-۳۴۵۶-۷۸۹۳').digits === MELLI, cdt('کارت: ۶۰۳۷-۹۹۱۲-۳۴۵۶-۷۸۹۳').digits);
check('۱۶ رقمِ پیوسته', cdt('شماره 6037991234567893 پایان').digits === MELLI);
check('دو خطِ ۸ رقمی به هم می‌چسبند', cdt('6037 9912\n3456 7893').digits === MELLI, cdt('6037 9912\n3456 7893').digits);
const noisy = cdt('CVV2 999 تاریخ انقضا 04/09 IR820120000000001234567890 6037-9912-3456-7893');
check('شبا و CVV با کارت اشتباه گرفته نمی‌شود', noisy.digits === MELLI, noisy.candidates.join('|'));
check('شمارهٔ نامعتبر با ok=false برمی‌گردد', cdt(BAD).digits === BAD && cdt(BAD).ok === false);
check('متنِ بی‌شماره چیزی نمی‌دهد', cdt('سلام خوبی؟').digits === '' && cdt('').digits === '');

// ── ۴. شیتِ کارت بدون کلیدِ هوش مصنوعی باز می‌شود ───────────────────────
$('scCard').click();
await app.wait(30);
check('با ضربه روی «کارت بانکی» شیت باز شد', app.overlayOpen() && !!$('cardKp'), app.sheetHtml().slice(0, 80));
check('دو راهِ عکس دارد (دوربین و گالری)', /startCardCapture\('cam'\)/.test(app.sheetHtml()) && /startCardCapture\('gal'\)/.test(app.sheetHtml()));
check('بدون کلید، راهِ تایپ را توضیح می‌دهد', /۱۶ رقم را بنویس/.test(app.sheetHtml()), app.sheetHtml().slice(-200));
check('نامِ الگوریتم/فناوری به کاربر نشان داده نمی‌شود', !/لون|Luhn|BIN|OCR|TextDetector|Shape Detection|۶ رقمِ اول|شش رقم/.test(app.sheetHtml()), (app.sheetHtml().match(/لون|Luhn|BIN|OCR|TextDetector|۶ رقمِ اول/) || ['-'])[0]);
check('کلیدِ هوش مصنوعی لازم ندارد', !/کلید عکس را بگذار/.test(app.toasts().join(' ')));

$('cardKp').value = MELLI;
window.cardKpInput($('cardKp'));
await app.wait(10);
check('شماره ۴تایی گروه می‌شود', $('cardKp').value === '6037 9912 3456 7893', $('cardKp').value);
check('بانک از ۶ رقمِ اول تشخیص داده شد', /بانک ملی/.test($('cardKpHint').textContent), $('cardKpHint').textContent);
check('پیش‌نمایشِ کارتِ رنگی ساخته شد', !!doc.querySelector('#cardKpPreview .bcard'));

$('cardKp').value = BAD;
window.cardKpInput($('cardKp'));
check('شمارهٔ نامعتبر هشدار می‌گیرد', /معتبر به نظر نمی‌رسد/.test($('cardKpHint').textContent), $('cardKpHint').textContent);
check('با شمارهٔ نامعتبر حساب اضافه نمی‌شود', window.addAccountFromCard() === undefined && !!$('cardKp') && /معتبر به نظر نمی‌رسد/.test(app.toasts().join(' ')), app.toasts().join('|'));

$('cardKp').value = '123456';
window.cardKpInput($('cardKp'));
check('بانکِ ناشناخته به کاربر گفته می‌شود', /نمی‌شناسم/.test($('cardKpHint').textContent), $('cardKpHint').textContent);
check('کمتر از ۱۶ رقم حساب نمی‌سازد', !!$('cardKp') && (window.addAccountFromCard(), /۱۶ رقم/.test(app.toasts().join(' '))), app.toasts().join('|'));

// ── ۵. شمارهٔ درست → فرمِ حسابِ پیش‌پرشده ──────────────────────────────
$('cardKp').value = BLU;
window.cardKpInput($('cardKp'));
check('BIN هشت‌رقمیِ بلوبانک شناخته شد', /بلوبانک/.test($('cardKpHint').textContent), $('cardKpHint').textContent);
const nBefore = st.state.accounts.length;
window.addAccountFromCard();
await app.wait(40);
check('فرمِ حساب با همان شماره باز شد', app.overlayOpen() && !!$('aCard') && cards.cardDigits($('aCard').value) === BLU, ($('aCard') || {}).value);
check('بانک از BIN در فرم پر شد', ($('aBank') || {}).value === 'بلوبانک', ($('aBank') || {}).value);
check('نوعِ حساب «کارت بانکی» شد', ($('aType') || {}).value === 'کارت بانکی', ($('aType') || {}).value);
check('نامِ پیشنهادی ساخته شد', /بلوبانک/.test(($('aName') || {}).value), ($('aName') || {}).value);
check('فرمِ حساب هم دکمهٔ اسکن دارد', /startCardCapture\('cam'\)/.test(app.sheetHtml()) && /startCardCapture\('gal'\)/.test(app.sheetHtml()));
check('فرمِ حساب هم نامِ الگوریتم نمی‌آورد', !/لون|Luhn|BIN/.test(app.sheetHtml()));
check('پیش‌نمایشِ کارت در فرم هست', !!doc.querySelector('#aCardPreview .bcard'));
window.saveAccount();
await app.wait(40);
check('حساب از روی کارت ساخته شد', st.state.accounts.length === nBefore + 1 && st.state.accounts.some((a) => a.bankId === 'blu' && a.last4 === '0000'), JSON.stringify(st.state.accounts.map((a) => a.bank + '/' + a.last4)));
check('شمارهٔ کامل ذخیره نمی‌شود (فقط ۴ رقم آخر)', !JSON.stringify(st.state.accounts).includes(BLU));

// ── ۶. عکس بدون متن‌یاب و بدون کلید → پیام و بازگشت به تایپ ────────────
window.openCardScan();
await app.wait(20);
await window.onCardPhoto({ files: [{ name: 'card.jpg', type: 'image/jpeg' }], value: 'x' });
await app.wait(40);
check('بدون متن‌یاب/کلید، شیتِ تایپ باز می‌ماند', app.overlayOpen() && !!$('cardKp'), app.sheetHtml().slice(0, 60));
check('دلیلش را به کاربر می‌گوید', /خودکار|۱۶ رقم/.test(app.toasts().join(' ') + ($('cardKpHint') || {}).textContent), app.toasts().join('|'));
check('حسابی از عکسِ نخوانده ساخته نشد', st.state.accounts.length === nBefore + 1);

// ── ۷. متن‌یابِ خودِ گوشی: خواندنِ عکس بدون هوش مصنوعی ──────────────────
globalThis.TextDetector = class { async detect() { return [{ rawValue: 'بانک ملت' }, { rawValue: '6037 9912' }, { rawValue: '3456 7893' }, { rawValue: 'CVV2 999' }]; } };
globalThis.createImageBitmap = async () => ({ width: 800, height: 500 });
check('textDetectorOk وقتی متن‌یاب هست true است', scan.textDetectorOk() === true);
const dev = await scan.readCardImage({ name: 'card.jpg', type: 'image/jpeg' });
check('عکس روی دستگاه و بدون اینترنت خوانده شد', dev.source === 'device' && dev.digits === MELLI && dev.ok === true, JSON.stringify(dev));
window.openCardScan();
await app.wait(20);
await window.onCardPhoto({ files: [{ name: 'card.jpg', type: 'image/jpeg' }], value: '' });
await app.wait(60);
check('بعد از خواندنِ عکس، فرمِ حساب پر شد', !!$('aCard') && cards.cardDigits($('aCard').value) === MELLI, ($('aCard') || {}).value);
check('بانک هم از روی عکس پر شد', /بانک ملی/.test(($('aBank') || {}).value), ($('aBank') || {}).value);
check('هیچ درخواستِ شبکه‌ای برای خواندنِ کارت لازم نبود', (window.__fetchCalls || []).length === 0, 'fetch=' + (window.__fetchCalls || []).length);
delete globalThis.TextDetector;
delete globalThis.createImageBitmap;
window.closeModal();

// ── ۸. نسخه، پیش‌کش و ترجمه ─────────────────────────────────────────────
const idx = readFileSync(REPO + '/index.html', 'utf8');
const ver = (readFileSync(REPO + '/js/utils.js', 'utf8').match(/APP_VERSION = '([^']+)'/) || [])[1];
check('index.html با نسخهٔ برنامه هم‌خوان است', idx.includes('?v=' + ver), ver);
const sw = readFileSync(REPO + '/sw.js', 'utf8');
const jsFiles = readdirSync(REPO + '/js').filter((f) => f.endsWith('.js'));
check('همهٔ ماژول‌های js در پیش‌کشِ سرویس‌ورکر هستند', jsFiles.every((f) => sw.includes("'./js/" + f + "'")), jsFiles.filter((f) => !sw.includes("'./js/" + f + "'")).join(','));
const enUi = (await import('file://' + REPO + '/i18n/en-ui.js')).default;
const needEn = ['عکس از کارت', 'اسکن از عکس', 'در حال خواندن کارت…', 'شمارهٔ کارت خوانده شد — چک کن و ذخیره کن', '۱۶ رقمِ شمارهٔ کارت را بنویس'];
check('رشته‌های تازهٔ کارت ترجمهٔ انگلیسی دارند', needEn.every((k) => enUi[k]), needEn.filter((k) => !enUi[k]).join(' | '));

R.done(app.problems);
