// ═══════════════════════════════════════════════════════════════════════════
// این فایل برای ریپوی taraz-api است (نه همین ریپو!)
// مسیر مقصد در آن‌سو:  api/gemini.js
// کار: عبوردهندهٔ Gemini — کلیدِ خودِ کاربر فوروارد می‌شود؛ هیچ کلید/تصویر/متنی
// ذخیره یا لاگ نمی‌شود. برنامه این‌طوری بدون فیلترشکن به گوگل وصل می‌شود.
// ═══════════════════════════════════════════════════════════════════════════
const ALLOWED_ORIGIN = 'https://taraz-app.github.io'; // فقط همین مبدأ
const GAPI = 'https://generativelanguage.googleapis.com/v1beta/models';

function sameOrigin(o) {
  return !!o && o.toLowerCase().replace(/\/+$/, '') === ALLOWED_ORIGIN;
}
function cors(req, res) {
  const origin = (req.headers.origin || '').toString();
  if (sameOrigin(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export const config = { api: { bodyParser: { sizeLimit: '4.5mb' } } };

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  try {
    const b = req.body || {};
    const key = String(b.key || '').trim();
    if (!key) { res.status(400).json({ error: 'missing-key' }); return; }
    let url;
    let init = { method: 'GET' };
    if (b.action === 'list') {
      url = GAPI + '?key=' + encodeURIComponent(key);
    } else {
      const model = String(b.model || '').trim();
      if (!model) { res.status(400).json({ error: 'missing-model' }); return; }
      url = GAPI + '/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);
      const generationConfig = { temperature: 0.1 };
      if (b.jsonMode) generationConfig.responseMimeType = 'application/json';
      init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: String(b.prompt || '') },
                { inlineData: { mimeType: 'image/jpeg', data: String(b.imageB64 || '') } },
              ],
            },
          ],
          generationConfig,
        }),
      };
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => { try { ctl.abort(); } catch (e) {} }, 25000);
    let up;
    try {
      up = await fetch(url, Object.assign(init, { signal: ctl.signal }));
    } finally {
      clearTimeout(timer);
    }
    const text = await up.text();
    res.status(up.status);
    res.setHeader('Content-Type', up.headers.get('content-type') || 'application/json; charset=utf-8');
    res.end(text);
  } catch (e) {
    res.status(502).json({ error: 'upstream', detail: String((e && e.message) || e).slice(0, 180) });
  }
}
