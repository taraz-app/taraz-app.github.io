// اتصالِ هوش مصنوعی: هر دو مسیر (گوگلِ مستقیم و پلِ ورسل) باید همیشه امتحان شوند،
// پیامِ خطا باید بگوید کدام مسیر چه گفت، و «آزمایشِ اتصال» در تنظیمات صادقانه گزارش بدهد.
//
// اجرا:  cd tools/harness && npm i && node ai-test.mjs
import { readFileSync } from 'node:fs';
import { bootApp, reporter, REPO } from './boot-app.mjs';

const R = reporter();
const { check } = R;

const DIRECT = 'https://generativelanguage.googleapis.com/v1beta/models';
const PROXY = 'https://taraz-api.vercel.app/api/gemini';
const REGION = { error: { code: 403, message: 'User location is not supported for the API use.', status: 'FAILED_PRECONDITION' } };
const BADKEY = { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } };
const QUOTA = { error: { code: 429, message: 'You exceeded your current quota.', status: 'RESOURCE_EXHAUSTED' } };
const ANSWER = {
  candidates: [{
    content: {
      parts: [{
        text: JSON.stringify({
          transactions: [{ type: 'out', note: 'نان', amount: 50000, date: '1405-08-10', time: '10:20' }],
        }),
      }],
    },
  }],
};
const LIST = { models: [{ name: 'models/a' }, { name: 'models/b' }, { name: 'models/c' }] };

const res = (status, obj) => ({
  ok: status >= 200 && status < 300,
  status,
  url: '',
  json: async () => obj,
  text: async () => JSON.stringify(obj),
  headers: { get: () => 'application/json' },
});

let calls = [];   // ترتیبِ مسیرهایی که واقعاً صدا زده شدند
let plan = null;  // (route) → پاسخ؛ null یعنی «شبکه قطع»

const app = await bootApp({
  seed: {
    capital_gemini_key: 'AIza-test-key',
    capital_gemini_models_v1: JSON.stringify({ at: Date.now(), list: ['gemini-3.7-flash'] }),
  },
  fetchStub: async (url) => {
    const u = String(url);
    if (!u.startsWith(DIRECT) && u !== PROXY) return null;
    const route = u === PROXY ? 'proxy' : 'direct';
    calls.push(route);
    return plan ? plan(route, u) : null;
  },
});
const { window } = app;
const scan = await import('file://' + REPO + '/js/scan.js');
const { store } = await import('file://' + REPO + '/js/utils.js');

const reset = (order) => { calls = []; plan = null; scan.saveDirectOk(order === 'direct'); };
const rows = (p) => p.then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }));
const SMS = 'مبلغ 50,000 تومان از حساب شما کسر شد - 1405-08-10 ساعت 10:20';

// ── ۱. هر دو مسیر همیشه امتحان می‌شوند (باگِ قدیمی: روی اولین خطا می‌شکست) ──────
reset('proxy');
plan = (route) => (route === 'proxy' ? res(403, REGION) : res(200, ANSWER));
let out = await rows(scan.readSmsText(SMS));
check('پل منطقه‌ای رد کرد → از گوگلِ مستقیم خواند', out.ok && out.r.length === 1 && out.r[0].amount === 50000, JSON.stringify(out.r || out.e.message).slice(0, 120));
check('ترتیبِ درخواست‌ها: اول پل، بعد مستقیم', calls.join(',') === 'proxy,direct', calls.join(','));
check('موفقیتِ مسیرِ مستقیم در کشِ مسیر نشست', JSON.parse(store.get('capital_gemini_direct_ok') || '{}').ok === true, store.get('capital_gemini_direct_ok'));

reset('direct');
plan = (route) => (route === 'direct' ? res(403, REGION) : res(200, ANSWER));
out = await rows(scan.readSmsText(SMS));
check('مستقیم منطقه‌ای رد کرد → از پل خواند', out.ok && out.r.length === 1 && out.r[0].amount === 50000, JSON.stringify(out.r || out.e.message).slice(0, 120));
check('ترتیبِ درخواست‌ها: اول مستقیم، بعد پل', calls.join(',') === 'direct,proxy', calls.join(','));
check('شکستِ مسیرِ مستقیم در کشِ مسیر نشست', JSON.parse(store.get('capital_gemini_direct_ok') || '{}').ok === false, store.get('capital_gemini_direct_ok'));

reset('proxy');
plan = () => res(200, ANSWER);
out = await rows(scan.readSmsText(SMS));
check('اگر مسیرِ اول جواب داد، مسیرِ دوم بی‌خبر می‌ماند', out.ok && calls.length === 1, calls.join(','));

// ── ۲. پیامِ خطا باید حقیقت را بگوید ───────────────────────────────────────
reset('proxy');
plan = () => res(403, REGION);
out = await rows(scan.readSmsText(SMS));
const m1 = out.ok ? '' : String(out.e.message || '');
check('منطقه از هر دو مسیر: پیام هر دو مسیر را می‌گوید', !out.ok && /سرورِ پل/.test(m1) && /کشور\/سرورِ دیگر/.test(m1), m1);
check('منطقه از راهِ پل: کاربر را دنبالِ کلیدِ تازه نمی‌فرستد', !/کلید/.test(m1) && !/پروژه/.test(m1), m1);
check('منطقه: یادِ «آزمایشِ اتصال» نمی‌اندازد ولی راهنما دارد', !/نامعتبر/.test(m1), m1);

reset('direct');
plan = () => res(403, REGION);
out = await rows(scan.readSmsText(SMS));
const m2 = out.ok ? '' : String(out.e.message || '');
check('منطقه فقط روی مسیرِ مستقیم: راهنمای فیلترشکن می‌دهد', !out.ok && /فیلترشکن/.test(m2) && /منطقه/.test(m2), m2);

reset('proxy');
plan = () => null; // هر دو مسیر در سطحِ شبکه قطع
out = await rows(scan.readSmsText(SMS));
const m3 = out.ok ? '' : String(out.e.message || '');
check('هیچ مسیری نرسید: «نه گوگل جواب داد نه پلِ ورسل»', !out.ok && /نه گوگل جواب داد نه پلِ ورسل/.test(m3), m3);
check('هیچ مسیری نرسید: کاربر را به «آزمایشِ اتصال» می‌فرستد', /آزمایشِ اتصال/.test(m3), m3);
check('هیچ مسیری نرسید: الکی نمی‌گوید منطقه', !/منطقه/.test(m3), m3);

reset('proxy');
plan = () => res(400, BADKEY);
out = await rows(scan.readSmsText(SMS));
check('کلیدِ نامعتبر: همان پیامِ کلید می‌آید', !out.ok && /کلید نامعتبر/.test(String(out.e.message || '')), String(out.e.message || ''));

reset('proxy');
plan = () => res(429, QUOTA);
out = await rows(scan.readSmsText(SMS));
check('سهمیه: پیامِ سهمیه می‌آید', !out.ok && /سهمیه/.test(String(out.e.message || '')), String(out.e.message || ''));
check('سهمیه: مدل‌های دیگر را الکی امتحان نمی‌کند', calls.length <= 4, 'n=' + calls.length);

// ── ۳. «آزمایشِ اتصال»: گزارشِ صادقانهٔ هر دو مسیر ─────────────────────────
store.set('capital_gemini_key', '');
let rep = await scan.testGeminiConnection();
check('بی‌کلید: verdict=no-key', rep.verdict === 'no-key' && rep.key === false, rep.verdict);
check('بی‌کلید: می‌گوید اول کلید را ذخیره کن', /کلید/.test(rep.hint), rep.hint);
store.set('capital_gemini_key', 'AIza-test-key');

reset('direct');
plan = () => res(200, LIST);
rep = await scan.testGeminiConnection();
check('هر دو مسیر باز: verdict=ok', rep.verdict === 'ok' && rep.direct.ok && rep.proxy.ok, JSON.stringify(rep.direct) + ' ' + JSON.stringify(rep.proxy));
check('هر دو مسیر باز: تعدادِ مدل‌ها را می‌گوید', rep.models === 3 && /هر دو مسیر/.test(rep.hint), 'models=' + rep.models + ' ' + rep.hint);
check('هر دو مسیر باز: جزئیاتِ status دارد', /direct=200/.test(rep.detail) && /proxy=200/.test(rep.detail), rep.detail);

reset('direct');
plan = (route) => (route === 'direct' ? res(403, REGION) : res(200, LIST));
rep = await scan.testGeminiConnection();
check('فقط پل باز: verdict=ok و می‌گوید از پل می‌رویم', rep.verdict === 'ok' && /پل/.test(rep.hint), rep.hint);

reset('direct');
plan = () => res(403, REGION);
rep = await scan.testGeminiConnection();
check('منطقه از هر دو: verdict=region', rep.verdict === 'region', rep.verdict + ' ' + rep.hint);
check('منطقه از هر دو: راه‌حلِ درست (سرور/کشورِ دیگر) می‌دهد', /فیلترشکن/.test(rep.hint) && /کشور\/سرورِ دیگر/.test(rep.hint), rep.hint);
check('منطقه از هر دو: می‌گوید ورود به گوگل سالم است', /ورود به گوگل/.test(rep.hint), rep.hint);
check('منطقه از هر دو: جزئیاتِ region دارد', /direct=403\/region/.test(rep.detail) && /proxy=403\/region/.test(rep.detail), rep.detail);

reset('direct');
plan = (route) => (route === 'direct' ? res(403, REGION) : res(502, { error: 'upstream' }));
rep = await scan.testGeminiConnection();
check('مستقیم منطقه + پل خراب: verdict=region با راهنمای فیلترشکن', rep.verdict === 'region' && /فیلترشکن/.test(rep.hint), rep.verdict + ' ' + rep.hint);

reset('direct');
plan = () => null;
rep = await scan.testGeminiConnection();
check('شبکه قطع: verdict=net', rep.verdict === 'net' && /اینترنت/.test(rep.hint), rep.verdict + ' ' + rep.hint);

reset('direct');
plan = () => res(400, BADKEY);
rep = await scan.testGeminiConnection();
check('کلیدِ نامعتبر: verdict=key', rep.verdict === 'key', rep.verdict + ' ' + rep.hint);

reset('direct');
plan = () => res(429, QUOTA);
rep = await scan.testGeminiConnection();
check('سهمیه تمام: verdict=quota', rep.verdict === 'quota' && /سهمیه/.test(rep.hint), rep.verdict + ' ' + rep.hint);

// ── ۴. رابطِ کاربری: دکمهٔ آزمایش در بخشِ هوش مصنوعیِ تنظیمات ───────────────
reset('direct');
plan = () => res(200, LIST);
window.openSettingsScan();
const sheet = app.sheetHtml();
check('برگهٔ کلید، جای وضعیتِ اتصال دارد', /id="aiState"/.test(sheet), sheet.slice(0, 80));
check('دکمهٔ «آزمایشِ اتصال» هست', /آزمایشِ اتصال/.test(sheet) && /testAiConnection\(\)/.test(sheet));
check('توضیحِ تفاوتِ ورود و هوش مصنوعی در برگه هست', /ورود به گوگل کار می‌کند/.test(sheet) && /سرورِ دیگری/.test(sheet));
check('تابعِ آزمایش روی window است', typeof window.testAiConnection === 'function');

window.testAiConnection();
check('فوراً وضعیتِ «در حال آزمایش» نشان می‌دهد', /در حال آزمایش/.test((window.document.getElementById('aiState') || {}).innerHTML || ''));
await app.wait(60);
const st = (window.document.getElementById('aiState') || {}).innerHTML || '';
check('بعد از آزمایش، نتیجه در همان برگه می‌نشیند', /هر دو مسیر/.test(st) && /آزمایشِ دوباره/.test(st), st.slice(0, 160));
check('جزئیاتِ مسیرها هم نشان داده می‌شود', /direct=200/.test(st), st.slice(0, 200));

// ── ۵. صفحهٔ راهنمای کلید ──────────────────────────────────────────────────
const help = readFileSync(REPO + '/help-gemini.html', 'utf8');
check('راهنمای فارسی: «آزمایشِ اتصال» را نشان می‌دهد', /آزمایشِ اتصال/.test(help));
check('راهنمای فارسی: تفاوتِ لاگین و هوش مصنوعی را می‌گوید', /ورود به گوگل و همگام‌سازی درایو/.test(help));
check('راهنمای فارسی: راه‌حلِ سرورِ دیگر', /سرور یا کشورِ فیلترشکن را عوض کن/.test(help));
check('راهنمای انگلیسی: Test connection', /Test connection/.test(help));
check('راهنمای انگلیسی: switch the VPN server or country', /switch the VPN server or country/.test(help));

// ── ۶. هیچ پیامی کاربر را دنبالِ کارِ بی‌فایده نمی‌فرستد ─────────────────────
const src = readFileSync(REPO + '/js/scan.js', 'utf8');
// فقط رشتهٔ داخلِ کوتیشن (شرطِ خط با نام‌های داخلی کد کار دارد و به کاربر نشان داده نمی‌شود)
const userMsgs = src.split('\n')
  .map((l) => /return '([\s\S]*?)';\s*$/.exec(l))
  .filter(Boolean)
  .map((m) => m[1])
  .filter((t) => /منطقه|پلِ ورسل|کلید|سهمیه|اتصال/.test(t));
check('پیام‌های مربوط به اتصال شمارش شدند', userMsgs.length >= 6, 'n=' + userMsgs.length);
check('پیام‌های منطقه دیگر «کلیدِ تازه در پروژهٔ دیگر» نمی‌گویند', !userMsgs.some((t) => /پروژهٔ (دیگر|تازه)/.test(t)), userMsgs.filter((t) => /پروژه/.test(t)).join(' | '));
check('هیچ پیامِ کاربری نامِ فنیِ داخلی ندارد', !userMsgs.some((t) => /FAILED_PRECONDITION|proxyDown|noRoute|regionVia|generateContent|status ?=/i.test(t)), userMsgs.filter((t) => /FAILED|proxyDown|noRoute/i.test(t)).join(' | '));

R.done(app.problems);
