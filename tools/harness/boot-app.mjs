// راه‌اندازِ مشترکِ تست‌ها: صفحهٔ واقعی را در jsdom بالا می‌آورد.
// از index.html واقعی DOM می‌سازد، گلوبال‌های مرورگر را نصب می‌کند، زبان را fa می‌گذارد
// و بعد دقیقاً مثل js/boot.js اول i18n و بعد app.js را بارگذاری می‌کند.
//
// اجرا:  cd tools/harness && npm i && node <test>.mjs
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function reporter() {
  let pass = 0;
  const fails = [];
  return {
    check(name, ok, detail) {
      if (ok) pass++;
      else fails.push(name + (detail ? ` → ${detail}` : ''));
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ' → ' + detail}`);
      return !!ok;
    },
    done(problems = []) {
      const real = (problems || []).filter((p) => !/Not implemented: HTMLCanvas|Could not load|favicon/i.test(String(p)));
      console.log(`\n=== ${pass} passed, ${fails.length} failed, ${real.length} runtime problems ===`);
      fails.forEach((f) => console.log('  FAILED: ' + f));
      real.forEach((p) => console.log('  PROBLEM: ' + p));
      process.exit(fails.length || real.length ? 1 : 0);
    },
  };
}

// ── شیمِ سلکتور ─────────────────────────────────────────────────────────
// موتورِ سلکتورِ jsdom با دو شکلی که برنامه در زمانِ اجرا می‌سازد مشکل دارد.
function fixSelector(sel) {
  if (typeof sel !== 'string') return sel;
  return sel
    .replace(/\[([-\w]+)=([^\]"']+)\]/g, '[$1="$2"]') // [data-tab=home] → [data-tab="home"]
    .replace(/:not\(\[([-\w]+)\]\)/g, '');             // بعدش دستی فیلتر می‌شود
}
function notAttrOf(sel) {
  const m = /:not\(\[([-\w]+)\]\)/.exec(typeof sel === 'string' ? sel : '');
  return m ? m[1] : null;
}
function installSelectorShims(win) {
  for (const proto of [win.Element.prototype, win.Document.prototype]) {
    const qs = proto.querySelector;
    const qsa = proto.querySelectorAll;
    proto.querySelector = function (sel) { return qs.call(this, fixSelector(sel)) || null; };
    proto.querySelectorAll = function (sel) {
      const attr = notAttrOf(sel);
      const list = qsa.call(this, fixSelector(sel));
      if (!attr) return list;
      const kept = [];
      list.forEach((el) => { if (!el.hasAttribute(attr)) kept.push(el); });
      return kept;
    };
  }
}

// ── جای‌گزینِ امکاناتِ نبودِ مرورگر ────────────────────────────────────
function installStubs(win, problems, blocked = []) {
  win.scrollTo = () => {};
  win.scroll = () => {};
  win.matchMedia = win.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  if (typeof win.Notification === 'undefined') {
    win.Notification = class Notification {
      static permission = 'default';
      static requestPermission() { return Promise.resolve('default'); }
    };
  }
  // node-canvas نصب نیست: کانتکستِ دوبعدی بی‌سروصدا
  win.HTMLCanvasElement.prototype.getContext = () => ({
    fillRect() {}, clearRect() {}, drawImage() {}, getImageData: () => ({ data: [] }),
    putImageData() {}, createImageData: () => ([]), save() {}, restore() {}, scale() {},
    translate() {}, rotate() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    stroke() {}, fill() {}, arc() {}, setTransform() {}, measureText: () => ({ width: 0 }),
    fillText() {}, strokeText() {}, canvas: null, font: '', fillStyle: '', globalAlpha: 1,
  });
  win.HTMLCanvasElement.prototype.toBlob = function (cb) { cb && cb(null); };
  win.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/jpeg;base64,'; };
  if (!win.URL.createObjectURL) win.URL.createObjectURL = () => 'blob:stub';
  if (!win.URL.revokeObjectURL) win.URL.revokeObjectURL = () => {};
  // شبکه در تست بسته است؛ این لیستِ درخواست‌های مسدودشده را نگه می‌دارد
  win.fetch = async (url, init) => {
    blocked.push(String(url).slice(0, 110));
    if (win.__fetchStub) {
      const r = await win.__fetchStub(url, init);
      if (r) return r;
    }
    return { ok: false, status: 0, url: String(url), json: async () => ({}), text: async () => '', headers: { get: () => null } };
  };
  const gcs = win.getComputedStyle.bind(win);
  win.getComputedStyle = (el, pseudo) => {
    try { return gcs(el, pseudo); } catch (e) {
      return { getPropertyValue: () => '', setProperty() {}, removeProperty() {}, display: 'block', direction: 'rtl' };
    }
  };
  win.HTMLElement.prototype.scrollIntoView = () => {};
  if (!win.navigator.vibrate) win.navigator.vibrate = () => {};
  if (!win.navigator.clipboard) {
    win.navigator.clipboard = { readText: async () => (win.__clipboardText || ''), writeText: async (t) => { win.__clipboardText = t; } };
  }
}

export async function bootApp(opts = {}) {
  const problems = [];
  const blocked = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => problems.push('jsdomError: ' + (e && e.message)));
  vc.on('error', (...a) => problems.push('console.error: ' + a.map(String).join(' ').slice(0, 200)));

  let html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  html = html.replace(/<script\b[\s\S]*?<\/script>/gi, ''); // ماژول‌ها را خودِ Node بارگذاری می‌کند

  const dom = new JSDOM(html, {
    url: opts.url || 'https://taraz-app.github.io/',
    pretendToBeVisual: true,
    runScripts: 'dangerously', // onclickهای درون‌خطی باید کار کنند
    virtualConsole: vc,
  });
  const win = dom.window;

  win.localStorage.setItem('capital_lang', opts.lang || 'fa');
  if (opts.seed) for (const [k, v] of Object.entries(opts.seed)) win.localStorage.setItem(k, v);
  if (opts.fetchStub) win.__fetchStub = opts.fetchStub;

  installSelectorShims(win);
  installStubs(win, problems, blocked);
  win.addEventListener('error', (e) => problems.push('window.error: ' + (e.error ? e.error.stack : e.message)));
  win.__capLog = (label, err) => problems.push('capLog ' + label + ': ' + (err && err.stack || err));

  const names = ['window', 'document', 'location', 'history', 'localStorage', 'sessionStorage',
    'HTMLElement', 'HTMLInputElement', 'HTMLCanvasElement', 'HTMLImageElement', 'Element', 'Node',
    'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'Blob', 'File', 'FileReader', 'FormData',
    'URL', 'URLSearchParams', 'Image', 'Notification', 'requestAnimationFrame', 'cancelAnimationFrame',
    'getComputedStyle', 'matchMedia', 'DOMParser', 'XMLHttpRequest', 'crypto', 'performance',
    'navigator', 'screen', 'alert', 'confirm', 'prompt', 'fetch', 'AbortController', 'TextEncoder', 'TextDecoder',
    'innerWidth', 'innerHeight', 'devicePixelRatio', 'scrollY', 'scrollX', 'pageYOffset', 'pageXOffset',
    'getSelection', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver'];
  for (const n of names) {
    try {
      if (typeof win[n] === 'undefined') continue;
      Object.defineProperty(globalThis, n, { value: win[n], configurable: true, writable: true });
    } catch (e) { /* گلوبالِ فقط‌خواندنی */ }
  }
  // متدهای رویداد باید به window بسته شوند وگرنه jsdom «Illegal invocation» می‌دهد
  for (const n of ['addEventListener', 'removeEventListener', 'dispatchEvent']) {
    Object.defineProperty(globalThis, n, { value: win[n].bind(win), configurable: true, writable: true });
  }
  globalThis.window = win;
  globalThis.document = win.document;

  const mod = (p) => import(pathToFileURL(path.join(REPO, p)).href);
  const i18n = await mod('js/i18n.js');
  await i18n.initI18n();
  await mod('js/app.js');

  const $ = (id) => win.document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(30);

  const homeErr = ($('homeContent') || {}).innerHTML || '';
  if (/برنامه بالا نیامد/.test(homeErr)) problems.push('APP BOOT FAILED: ' + (($('lockDebug') || {}).textContent || homeErr.slice(0, 300)));

  return {
    window: win, document: win.document, $, wait, problems, blocked, i18n, REPO, mod,
    overlayOpen: () => ($('overlay') || { classList: { contains: () => false } }).classList.contains('show'),
    sheetHtml: () => ($('sheet') || {}).innerHTML || '',
    subOpen: () => !!win.document.querySelector('.overlay.sub.show'),
    subHtml: () => (win.document.querySelector('#sheet2') || {}).innerHTML || '',
    toasts: () => {
      const out = [...win.document.querySelectorAll('.toast')].map((e) => e.textContent.trim());
      const t = win.document.getElementById('toast');
      if (t && t.textContent.trim()) out.push(t.textContent.trim());
      return out;
    },
    click(sel) {
      const el = typeof sel === 'string' ? win.document.querySelector(sel) : sel;
      if (!el) throw new Error('no element for ' + sel);
      el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      return el;
    },
  };
}
