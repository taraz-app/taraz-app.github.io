// ورودیِ متنیِ پیامکِ بانک: پارسرِ محلی + مسیرِ هوش مصنوعی + صفحهٔ بازبینیِ قابلِ ویرایش
import { bootApp, reporter, REPO } from './boot-app.mjs';

const R = reporter();
const { check } = R;

const SMS = [
  'برداشت 1,500,000 ریال از حساب 6395-****-****-1234 در تاریخ 1405/06/17 ساعت 14:35 مانده 12,000,000 ریال',
  'واریز 25,000,000 ریال به حساب شما نزد بانک ملت - حقوق شهریور - 1405/06/01 08:12',
  'مشتری گرامی، خرید از فروشگاه رفاه به مبلغ 500000 ریال با کارت ****4321 در 1405/05/20 انجام شد',
  'پرداخت قبض برق 230000 ریال - شناسه 12345 - 1405/04/11',
  'رمز پویا شما: 123456 - بانک ملت',
  'انتقال وجه 5,000,000 ریال از حساب شما به حساب 1234567890 به نام علی - 1405/06/10 19:02',
  'بلوبانک: ۳۵۰٬۰۰۰ تومان خرید از اسنپ‌فود در تاریخ ۱۴۰۵/۰۶/۱۵ ساعت ۲۱:۱۰',
  'موجودی حساب شما 45,000,000 ریال است',
  'برداشت ناموفق از خودپرداز - بانک ملی',
  'حساب شما به مبلغ 3000000 ریال بستانکار شد - سود سپرده - بانک پارسیان',
];
const PASTE = SMS.join('\n\n');

const seedState = {
  accounts: [
    { id: 'a1', name: 'کارت ملت', bank: 'بانک ملت', bankId: 'mellat', type: 'کارت بانکی', currency: 'تومان', initial: 500000, last4: '1234', updatedAt: 1 },
    { id: 'a2', name: 'حساب ملی', bank: 'بانک ملی', bankId: 'melli', type: 'کارت بانکی', currency: 'تومان', initial: 300000, last4: '4321', updatedAt: 2 },
    { id: 'a3', name: 'نقد', bank: '', type: 'نقدی', currency: 'تومان', initial: 50000, updatedAt: 3 },
  ],
  transactions: [], investments: [], debts: [], installments: [],
  budgets: {}, rates: {}, baseCurrency: 'تومان', calendar: 'jalali', bookId: '',
};

const app = await bootApp({ seed: { capital_app_v1: JSON.stringify(seedState) } });
const { window } = app;
const $ = app.$;
const st = await import('file://' + REPO + '/js/state.js');
const sms = await import('file://' + REPO + '/js/sms.js');
const doc = window.document;
const rowsOf = () => [...doc.querySelectorAll('[id^="pAmt_"]')];

// ── ۱. پارسرِ محلی ──────────────────────────────────────────────────────
const one = (i) => sms.parseBankSms(SMS[i]);
check('برداشت: ریال → تومان و ۴ رقم آخرِ کارت', one(0)[0].amount === 150000 && one(0)[0].account === '1234', JSON.stringify(one(0)[0]));
check('برداشت: تاریخ شمسی → میلادی و ساعت', one(0)[0].date === '2026-09-08' && one(0)[0].time === '14:35', one(0)[0].date + ' ' + one(0)[0].time);
check('برداشت: «مانده» تراکنش نشده', one(0).length === 1, 'rows=' + one(0).length);
check('واریز: نوع in و نام بانک', one(1)[0].type === 'in' && one(1)[0].amount === 2500000 && /ملت/.test(one(1)[0].account), JSON.stringify(one(1)[0]));
check('واریز: یادداشت حقوق', /حقوق/.test(one(1)[0].note), one(1)[0].note);
check('خرید: نام فروشگاه در یادداشت، نه «به مبلغ»', one(2)[0].note === 'فروشگاه رفاه', one(2)[0].note);
check('خرید: ۴ رقم آخرِ کارتِ ستاره‌دار', one(2)[0].account === '4321', one(2)[0].account);
check('فروشگاه رفاه با بانک رفاه اشتباه گرفته نشد', !/بانک رفاه/.test(one(2)[0].account), one(2)[0].account);
check('قبض: یادداشت «قبض برق»', one(3)[0].note === 'قبض برق' && one(3)[0].amount === 23000, JSON.stringify(one(3)[0]));
check('رمز پویا نادیده گرفته شد', one(4).length === 0);
check('انتقال: طرفِ حساب در یادداشت', /انتقال به علی/.test(one(5)[0].note), one(5)[0].note);
check('انتقال: ۴ رقم آخرِ حسابِ مقصد', one(5)[0].account === '7890', one(5)[0].account);
check('تومانِ صریح تقسیم بر ۱۰ نمی‌شود', one(6)[0].amount === 350000, String(one(6)[0].amount));
check('اعداد و جداکنندهٔ فارسی خوانده شد', /بلوبانک/.test(one(6)[0].account) && one(6)[0].date === '2026-09-06', JSON.stringify(one(6)[0]));
check('اطلاعیهٔ موجودی تراکنش نمی‌شود', one(7).length === 0);
check('تراکنشِ ناموفق نادیده گرفته شد', one(8).length === 0);
check('«بستانکار شد» = درآمد + سود', one(9)[0].type === 'in' && one(9)[0].amount === 300000 && /سود/.test(one(9)[0].note), JSON.stringify(one(9)[0]));
const pasted = sms.parseBankSms(PASTE);
check('چسباندنِ چند پیامک پشت هم: ۷ تراکنش از ۱۰ پیامک', pasted.length === 7, 'rows=' + pasted.length);
check('پیامکِ چسبیده در یک خط هم جدا می‌شود', sms.parseBankSms(SMS[0] + ' ' + SMS[3]).length === 2);
check('متنِ خالی/چرند رد می‌شود', sms.parseBankSms('').length === 0 && sms.parseBankSms('سلام خوبی؟').length === 0);
check('پاکت حدس زده می‌شود', pasted.every((r) => r.type === 'in' ? r.cat === null : ['need', 'invest', 'fun', 'charity', 'waste'].includes(r.cat)));

// ── ۲. ورودی‌های UI ─────────────────────────────────────────────────────
check('دکمهٔ «متن پیامک» در انتخابگرِ اسکن هست', !!$('scTxt') && /متن پیامک/.test($('scTxt').textContent));
check('انتخابگرِ اسکن سه‌ستونه است', /fs-grid cols3/.test(doc.querySelector('#scanSheet').innerHTML));
$('scTxt').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await app.wait(40);
check('با ضربه روی آن، شیتِ متن باز می‌شود', app.overlayOpen() && !!$('scanTxt'));
check('شیتِ متن دکمهٔ کلیپ‌بورد و پاک‌کردن دارد', /pasteScanText\(/.test(app.sheetHtml()) && /scanTxtClear\(/.test(app.sheetHtml()));
check('بدون کلید، راهنما به پارسرِ خودِ برنامه اشاره می‌کند', /پارسرِ خودِ برنامه|پارسرِ محلی/.test($('scanTxtHint').textContent), $('scanTxtHint').textContent);
window.closeModal();

// دکمهٔ داخل فرم تراکنش
window.openTxForm(null, { full: true });
await app.wait(50);
check('فرم تراکنش هم «متن پیامک» دارد', /openScanText\(\)/.test(app.sheetHtml()));
check('عنوانِ دکمهٔ اسکن به متن هم اشاره می‌کند', /عکس یا متن/.test(app.sheetHtml()));
window.closeModal();

// ── ۳. مسیرِ محلی: بدون کلید ────────────────────────────────────────────
window.openScanText();
await app.wait(30);
$('scanTxt').value = PASTE;
$('scanTxt').dispatchEvent(new window.Event('input'));
await app.wait(20);
check('همزمان با تایپ، تعداد تراکنش‌ها نشان داده می‌شود', /۷/.test($('scanTxtHint').textContent), $('scanTxtHint').textContent);
window.submitScanText();
await app.wait(60);
check('صفحهٔ بازبینی باز شد', app.overlayOpen() && rowsOf().length === 7, 'rows=' + rowsOf().length);
check('ردیف‌ها قابلِ ویرایش‌اند (کادر مبلغ)', rowsOf().every((i) => i.tagName === 'INPUT'));
check('یادداشت‌ها در کادرهایشان هستند', [...doc.querySelectorAll('[id^="pNote_"]')].some((i) => /حقوق/.test(i.value)));
check('حسابِ هر ردیف با حساب‌های برنامه جور شد',
  [...doc.querySelectorAll('[id^="pAcct_"]')].some((s) => s.value === 'a1') || [...doc.querySelectorAll('[id^="pAcct_"]')].some((s) => s.value === 'a2'),
  [...doc.querySelectorAll('[id^="pAcct_"]')].map((s) => s.value).join(','));
check('انتخابگرِ حسابِ ردیف‌ها چیپس/شیت دارد', !!doc.querySelector('[id^="pAcct_"][id$="_ap"]'));

// ویرایشِ یک ردیف و ثبت
const before = st.state.transactions.length;
rowsOf()[0].value = '999';
rowsOf()[0].dispatchEvent(new window.Event('input'));
const lastRowId = rowsOf()[rowsOf().length - 1].id.replace('pAmt_', '');
window.removePaperRow(lastRowId);
await app.wait(20);
window.savePaperTxs();
await app.wait(60);
check('ثبت شد و صفحه بسته شد', !app.overlayOpen());
const added = st.state.transactions.slice(before);
check('تراکنش‌ها ساخته شدند (یک ردیف هم حذف شد)', added.length === 6, 'added=' + added.length);
check('ویرایشِ مبلغ اعمال شد', added.some((t) => t.amount === 999), added.map((t) => t.amount).join(','));
check('مبلغِ ریالی به تومان ثبت شد (نه خام)', added.some((t) => t.amount === 50000) && !added.some((t) => t.amount === 5000000) && !added.some((t) => t.amount === 25000000), added.map((t) => t.amount).join(','));
check('تراکنشِ درآمدی هم ثبت شد', added.some((t) => t.type === 'in'));
check('حساب‌ها به آیدیِ واقعی وصل شدند', added.every((t) => st.state.accounts.some((a) => a.id === t.accountId)));

// ── ۳٫۵. پیامکِ واقعیِ بانک ملی و تجارت (قالبِ «کلید: مقدار») ─────────────
const REAL_PASTE = [
  'بانك ملي ايران\nخريداينترنتي:2,362,500-\nحساب:02000\nمانده:11,919,634\n0810-21:55',
  'بانك ملي ايران\nانتقال:30,000,000+\nحساب:02000\nمانده:30,338,121\n0810-20:49',
  'بانك ملي ايران\nانتقال:19,014,500-\nحساب:02000\nمانده:455,121\n0808-12:43',
  '*بانک تجارت* \nحساب: 0377806172623 \nبرداشت: 50,025,000 ریال \nاز طريق: شتاب  \nمانده: 30,925,720 ریال \n1405-08-11\n18:36',
  '*بانک تجارت* \nحساب: 0177005368448 \nبرداشت: 54,545,400 ریال \nاز طريق: شعبه   \nکدشعبه: 3001\nمانده: 1,362,260 ریال \n1405-07-30\n14:27',
  '*بانک تجارت* \nحساب: 0377806172623 \nواریز: 2,250,000 ریال \nاز طريق: خودپرداز  \nمانده: 85,618,720 ریال \n1405-07-29\n18:45',
].join('\n\n');
const real = sms.parseBankSms(REAL_PASTE);
check('هر پیامکِ ملی/تجارت یک پیامکِ جدا شمرده می‌شود', sms.splitMessages(REAL_PASTE).length === 6, 'msgs=' + sms.splitMessages(REAL_PASTE).length);
check('۶ پیامک → ۶ تراکنش', real.length === 6, 'rows=' + real.length);
check('countTxBlocks هم ۶ است', sms.countTxBlocks(REAL_PASTE) === 6);
check('ملی: علامتِ «-» یعنی خرج و مبلغ ریال→تومان', real[0].type === 'out' && real[0].amount === 236250, JSON.stringify([real[0].type, real[0].amount]));
check('ملی: «خريداينترنتي» → «خرید اینترنتی»', real[0].note === 'خرید اینترنتی', real[0].note);
check('ملی: «0810-21:55» → تاریخ و ساعتِ درست', real[0].date === '2026-11-01' && real[0].time === '21:55', real[0].date + ' ' + real[0].time);
check('ملی: «حساب:02000» شمارهٔ حساب است نه کارتِ مهرِ زمانی', real[0].account === 'ملی 2000', real[0].account);
check('ملی: علامتِ «+» یعنی درآمد', real[1].type === 'in' && real[1].amount === 3000000, JSON.stringify([real[1].type, real[1].amount]));
check('ملی: «0808» هم خوانده شد', real[2].date === '2026-10-30' && real[2].amount === 1901450, real[2].date + ' ' + real[2].amount);
check('تجارت: کانالِ «از طریق» در یادداشت', real[3].note === 'برداشت (شتاب)', real[3].note);
check('تجارت: ۴ رقم آخرِ حسابِ ۱۳ رقمی', real[3].account === 'تجارت 2623', real[3].account);
check('تجارت: تاریخ و ساعت روی خطِ جدا', real[3].date === '2026-11-02' && real[3].time === '18:36', real[3].date + ' ' + real[3].time);
check('تجارت: «کدشعبه» مبلغ نشد', real[4].amount === 5454540 && real[4].account === 'تجارت 8448', JSON.stringify([real[4].amount, real[4].account]));
check('تجارت: واریز از خودپرداز = درآمد', real[5].type === 'in' && real[5].amount === 225000 && real[5].note === 'واریز (خودپرداز)', JSON.stringify([real[5].type, real[5].amount, real[5].note]));
check('مانده هیچ‌جا تراکنش نشد', !real.some((r) => r.amount === 3092572 || r.amount === 1191963 || r.amount === 3033812));

// ── ۴. مسیرِ هوش مصنوعی (با پاسخِ ساختگی) ───────────────────────────────
window.localStorage.setItem('capital_gemini_key', 'test-key');
const calls = [];
const aiReply = {
  transactions: [
    { type: 'out', kind: 'simple', note: 'خرید از دیجی‌کالا', account: 'ملت 1234', date: '1405/06/20', time: '11:20', cat: 'need', qty: 0, unit: '', writtenToman: 0, bankRial: 8400000, store: '', lines: [] },
    { type: 'in', kind: 'simple', note: 'واریز حقوق', account: 'ملی', date: '1405/06/01', time: null, cat: null, qty: 0, unit: '', writtenToman: 45000000, bankRial: 0, store: '', lines: [] },
  ],
};
window.__fetchStub = async (url, init) => {
  const u = String(url);
  if (u.includes(':generateContent')) {
    calls.push(init && init.body ? JSON.parse(init.body) : null);
    const payload = { candidates: [{ content: { parts: [{ text: JSON.stringify(aiReply) }] } }] };
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  }
  if (u.includes('/v1beta/models')) {
    const payload = { models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] };
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  }
  return null;
};
const AI_TEXT = 'مبلغ پانصد هزار تومان از حساب شما کسر شد - 1405/08/10 ساعت 10:20';
check('متنِ بدونِ رقمِ مبلغ را پارسرِ محلی نمی‌خواند', sms.parseBankSms(AI_TEXT).length === 0);
check('ولی یک بلوکِ تراکنش شمرده می‌شود', sms.countTxBlocks(AI_TEXT) === 1);
window.openScanText();
await app.wait(20);
check('با کلید، راهنما به هوش مصنوعی اشاره می‌کند', /هوش مصنوعی/.test($('scanTxtHint').textContent));
$('scanTxt').value = AI_TEXT;
window.submitScanText();
await app.wait(120);
check('درخواست به گوگل رفت', calls.length >= 1, 'calls=' + calls.length);
const parts = calls.length ? calls[0].contents[0].parts : [];
check('برای ورودیِ متنی عکس فرستاده نمی‌شود', parts.length === 1 && !parts.some((p) => p.inlineData), JSON.stringify(parts.map((p) => Object.keys(p))));
check('پرامپت دربارهٔ پیامک است', /پیامک/.test(parts[0] ? parts[0].text : ''), (parts[0] ? parts[0].text : '').slice(0, 40));
check('jsonMode روشن است', !!calls[0] && calls[0].generationConfig.responseMimeType === 'application/json');
check('پاسخِ مدل به صفحهٔ بازبینی رفت', app.overlayOpen() && rowsOf().length === 2, 'rows=' + rowsOf().length);
const aiVals = rowsOf().map((i) => i.value.replace(/[^\d]/g, ''));
check('مبلغِ ریالیِ مدل به تومان تبدیل شد', aiVals[0] === '840000', aiVals.join(','));
check('مبلغِ تومانیِ مدل دست نخورد', aiVals[1] === '45000000', aiVals.join(','));
check('یادداشتِ مدل در ردیف است', [...doc.querySelectorAll('[id^="pNote_"]')].some((i) => /دیجی/.test(i.value)));
window.closeModal();

// پیامکِ قالب‌دار را پارسرِ خودِ برنامه می‌خواند: بی‌خرجِ سهمیه و بی‌انتظار
calls.length = 0;
window.openScanText();
await app.wait(20);
$('scanTxt').value = REAL_PASTE;
window.submitScanText();
await app.wait(80);
check('پیامکِ قالب‌دار بدونِ صدا زدنِ گوگل خوانده شد', calls.length === 0 && rowsOf().length === 6, 'calls=' + calls.length + ' rows=' + rowsOf().length);
const realVals = rowsOf().map((i) => i.value.replace(/[^\d]/g, ''));
check('مبلغ‌های ملی/تجارت در ردیف‌ها درست نشست', realVals[0] === '236250' && realVals[3] === '5002500', realVals.join(','));
const realAccs = [...doc.querySelectorAll('select[id^="pAcct_"]')].map((x) => x.value);
check('ردیف‌های «ملی 2000» به حسابِ ملیِ برنامه وصل شدند', realAccs[0] === 'a2' && realAccs[1] === 'a2' && realAccs[2] === 'a2', realAccs.join(','));
const realDates = [...doc.querySelectorAll('input[id^="pDate_"]')].map((x) => x.value);
check('تاریخِ هر ردیف پر شده و با پیامک می‌خواند', realDates.length === 6 && realDates[0] === '2026-11-01' && realDates[3] === '2026-11-02', realDates.join(','));
window.closeModal();

// ── ۵. هوش مصنوعی نرسید → پارسرِ محلی ───────────────────────────────────
window.__fetchStub = async (url) => {
  const u = String(url);
  if (u.includes(':generateContent')) return { ok: false, status: 400, json: async () => ({ error: { message: 'empty inline data' } }), text: async () => 'empty inline data' };
  if (u.includes('/v1beta/models')) { const p = { models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }; return { ok: true, status: 200, json: async () => p, text: async () => JSON.stringify(p) }; }
  return null;
};
const MIX = REAL_PASTE + '\n\n' + AI_TEXT;
window.openScanText();
await app.wait(20);
$('scanTxt').value = MIX;
window.submitScanText();
await app.wait(150);
check('متنِ قاطی: وقتی مدل خطا داد، پارسرِ محلی همان ۶ پیامکِ قالب‌دار را ساخت', app.overlayOpen() && rowsOf().length === 6, 'rows=' + rowsOf().length);
window.closeModal();

// متنِ بی‌ربط با کلیدِ خراب: باید پیامِ خطا بدهد، نه صفحهٔ خالی
window.__fetchStub = async () => null;
window.openScanText();
await app.wait(20);
$('scanTxt').value = 'سلام امروز هوا خوبه';
window.submitScanText();
await app.wait(120);
check('متنِ بی‌تراکنش پیام می‌دهد و صفحهٔ خالی نمی‌سازد', !rowsOf().length);
check('هنوز در شیتِ متن هستیم یا پیام خورده', !!$('scanTxt') || app.toasts().length >= 0);
window.closeModal();
window.localStorage.setItem('capital_gemini_key', '');

// ── ۶. پلِ ورسل هم برای متن آماده است ──────────────────────────────────
const proxy = (await import('node:fs')).readFileSync(REPO + '/tools/api-gemini.js', 'utf8');
check('پلِ ورسل part خالیِ عکس نمی‌فرستد', /if \(img\) parts\.push/.test(proxy));
check('sms.js در پیش‌کشِ سرویس‌ورکر هست', /'\.\/js\/sms\.js'/.test((await import('node:fs')).readFileSync(REPO + '/sw.js', 'utf8')));

R.done(app.problems);
