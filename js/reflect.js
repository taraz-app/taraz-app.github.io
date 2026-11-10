// «بازتاب ماه»: بخش اختیاری در گزارش — چند یادداشت کوتاه از جریان واقعی پول بین پاکت‌ها.
// هیچ پیامی خودش بالا نمی‌آید؛ کاربر ردیف را باز می‌کند. لحن: مشاهده + یک نکته، نه هشدار.
import { icon } from './icons.js';
import { esc, toFa, fmtShort, toast, pctSign } from './utils.js';
import { t as tr } from './i18n.js';
import { state, CATS, save, catSpent, catShare, budgetOf, computeMonths, incomeIn, isInvoice, isTransfer, isLoanTx, isReversed, spendRatio, txAmountToman, FUN_CARRY_MONTHS, PROFILES, profileFor, setProfile, setTargetMonth, getTargetMonth } from './state.js';
import { curMonthKey, monthLabel, shiftMonth, monthOfISO } from './jalali.js';
import { monthInstallments } from './installments.js';
import { openModal, closeModal } from './modal.js';

const MAIN = ['need', 'invest', 'fun', 'charity'];
const label = (id) => (CATS.find((c) => c.id === id) || {}).label || id;
const joinFa = (arr) => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(tr('، ')) + ' ' + tr('و') + ' ' + arr[arr.length - 1]);

// ── تراکنش‌های تفریح ماه (ساده؛ فاکتور به‌صورت خطی) ──
function funTxs(mk) {
  return state.transactions.filter((t) => t.month === mk && t.type === 'out' && t.cat === 'fun' && !isInvoice(t) && !isTransfer(t) && !isLoanTx(t) && !isReversed(t));
}
export function funTagStats(mk) {
  const list = funTxs(mk);
  let sum = 0, social = 0, play = 0, tagged = 0;
  for (const t of list) {
    const a = txAmountToman(t) * spendRatio(t);
    sum += a;
    const tags = t.tags || [];
    if (tags.length) tagged++;
    if (tags.includes('social')) social += a;
    if (tags.includes('play')) play += a;
  }
  return { n: list.length, tagged, sum, socialPct: sum ? Math.round((social / sum) * 100) : 0, playPct: sum ? Math.round((play / sum) * 100) : 0 };
}

// ── جریان‌های ماه: انحراف هر پاکت از سهمش و این‌که کمبود از کجا پر شد ──
export function monthFlows(mk) {
  const prevTM = getTargetMonth();
  setTargetMonth(mk);
  const budget = budgetOf(mk);
  const cats = MAIN.map((id) => {
    const share = catShare(mk, id), spent = catSpent(mk, id);
    return { id, share, spent, dev: spent - share };
  });
  const waste = catSpent(mk, 'waste');
  const cm = computeMonths()[mk] || { carriedIn: 0 };
  const over = cats.filter((c) => c.dev > 0);
  const under = cats.filter((c) => c.dev < 0);
  const deficit = over.reduce((a, c) => a + c.dev, 0) + waste;
  // کمبود از پاکت‌های زیر سهم، به نسبت مانده‌شان برداشته می‌شود (تقریب absorbDeficit)
  const underSum = under.reduce((a, c) => a + -c.dev, 0);
  const sources = {};
  if (deficit > 0 && underSum > 0) {
    const pool = Math.min(deficit, underSum);
    for (const c of under) sources[c.id] = Math.round((pool * -c.dev) / underSum);
  }
  const coveredByCarry = deficit > 0 && underSum < deficit && cm.carriedIn > 0;
  setTargetMonth(prevTM);
  return { mk, budget, cats, waste, over, under, deficit, sources, coveredByCarry, income: incomeIn(mk), carriedIn: cm.carriedIn || 0, carriedCats: cm.carriedCats || {} };
}
function sourcesText(f, excludeId) {
  if (f.mk === curMonthKey()) return ''; // وسط ماه هنوز معلوم نیست از کجا پر می‌شود
  const total = Object.values(f.sources).reduce((a, b) => a + b, 0);
  const ids = Object.keys(f.sources).filter((id) => id !== excludeId && f.sources[id] >= total * 0.1).sort((a, b) => f.sources[b] - f.sources[a]);
  if (ids.length) return tr('کمبودش از سهم {cats} برداشته شد.', { cats: joinFa(ids.map(label)) });
  if (f.coveredByCarry) return tr('ماندهٔ ماه‌های قبل پوششش داد.');
  return '';
}
function txCount(mk) {
  return state.transactions.filter((t) => t.month === mk && t.type === 'out' && !isTransfer(t) && !isLoanTx(t) && !isReversed(t)).length;
}
function budgetMonthsBefore(mk) {
  return Object.keys(state.budgets).filter((k) => k < mk && state.budgets[k] && state.budgets[k].amount > 0).length;
}

// ── یادداشت‌ها ──
// هر یادداشت: {id, head, body, pos?}؛ head = مشاهده با عدد، body = نکته
export function insights(mk, opts) {
  opts = opts || {};
  const f = monthFlows(mk);
  if (!f.budget) return [];
  const mid = mk === curMonthKey();
  const sofar = mid ? tr('تا این‌جا ') : '';
  const out = [];
  const push = (n) => { if (!out.some((x) => x.id === n.id)) out.push(n); };

  // ماه‌های اول: فقط یادآوری نقشه
  if (budgetMonthsBefore(mk) < 2) {
    push({ id: 'intro', head: tr('درصدها نقشه‌اند، نه قانون.'), body: tr('اول ضروریات را ببند؛ تقسیم بعداً. چند ماه که بگذرد، این بخش از خرج‌های خودت می‌گوید کدام پاکت از کدام پاکت خورده.') });
  }

  // ۱) اتلاف
  if (f.waste > 0) {
    push({ id: 'waste', head: sofar + tr('{amt} اتلاف ثبت شد.', { amt: fmtShort(f.waste) }) + ' ' + sourcesText(f), body: tr('اتلاف همان بخشی از پول است که هیچ پاکتی را پر نکرد — نه نیاز، نه آینده، نه لذت، نه معنا. اسمش را که می‌نویسی، نصف راه را رفته‌ای.') });
  }

  // ۲) بزرگ‌ترین جریان (هر دو جهت)
  const big = [...f.cats].filter((c) => f.budget && Math.abs(c.dev) >= Math.max(f.budget * 0.03, 1)).sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev))[0];
  if (big) {
    const amt = fmtShort(Math.abs(big.dev));
    const L = label(big.id);
    if (big.dev > 0) {
      const head = sofar + tr('{cat} {amt} بیشتر از سهمش شد.', { cat: L, amt }) + ' ' + sourcesText(f, big.id);
      const body = {
        need: tr('اگر این چند ماه تکرار شود، شاید سهم فعلی ضروریات برای زندگی تو واقعی نیست — نه این‌که بد خرج کرده باشی. سهم را با واقعیت تنظیم کن، نه برعکس.'),
        invest: tr('پس‌اندازی که با خالی گذاشتن تفریح یا معنا ساخته شود معمولاً دوام نمی‌آورد. اگر می‌خواهی بیشتر کنار بگذاری، سهم‌ها را عوض کن؛ پاکتی را بی‌صدا خالی نکن.'),
        fun: tr('تفریح اتلاف نیست؛ پایان زنجیرهٔ چراهاست. اما وقتی از سهم پاکت دیگری خورده شود، آن لذت را با نگرانی ماه بعد می‌خری.'),
        charity: tr('این پاکت برای ماندگاری ساخته شده، نه رکورد. مقدار کم و مرتب از بزرگ و گاه‌به‌گاه بهتر کار می‌کند — و اگر از ضروریات بخورد، پایدار نمی‌ماند.'),
      }[big.id];
      push({ id: 'over_' + big.id, head, body });
    } else if (!mid || Math.abs(big.dev) > big.share * 0.5) {
      const head = sofar + tr('{cat} {amt} کمتر از سهمش پر شد.', { cat: L, amt });
      const body = {
        need: tr('کم‌خرجی در ضروریات همیشه صرفه‌جویی نیست؛ گاهی نیازی عقب افتاده — درمان، تعمیر، لباس — که بعداً گران‌تر برمی‌گردد. اگر واقعاً نیازی نبود، سهمش را کوچک کن.'),
        invest: tr('این تنها پاکتی است که برای «تو»ی آینده خرج می‌شود. وقتی اول ماه کنار نرود، آخر ماه معمولاً چیزی نمی‌ماند.'),
        fun: tr('تفریح نخریدن پس‌انداز نیست؛ مانده‌اش به ماه بعد می‌رود (تا سقف سه ماه). اگر از قصد جمع می‌کنی برای تجربه‌ای بزرگ‌تر، خوب است. اگر فقط وقتش نشد، چیزی که کم آمده انرژی است، نه پول.'),
        charity: tr('این پاکت کاری می‌کند که سه پاکت دیگر نمی‌کنند؛ سیر شدن و لذت بردن جایش را نمی‌گیرد. کوچک اما همین ماه، بهتر از بزرگ ماه بعد.'),
      }[big.id];
      push({ id: 'under_' + big.id, head, body });
    }
  }

  // ۳) تفریح: برچسب‌ها، تراکم، قسط، سقف انباشت
  const fun = f.cats.find((c) => c.id === 'fun');
  const ft = funTagStats(mk);
  const funList = funTxs(mk);
  if (ft.n >= 2 && ft.tagged * 2 >= ft.n) {
    const s = ft.socialPct, p = ft.playPct;
    const stat = tr('{s}٪ با دیگران · {p}٪ بازی', { s: toFa(s), p: toFa(p) });
    if (s >= 50 && p >= 50) push({ id: 'tags_both', pos: true, head: stat, body: tr('بیشتر تفریحت هم با دیگران بود، هم خودت بازیگرش بودی — دو چیزی که لذت را ماندگار می‌کنند و دیرتر عادی می‌شوند.') });
    else if (s >= 50) push({ id: 'tags_social', pos: true, head: stat, body: tr('بیشتر تفریح این ماه با دیگران گذشت. برای بازیگر بودن هم جا هست: چیزی بسازی، یاد بگیری، حرکت کنی.') });
    else if (p >= 50) push({ id: 'tags_play', pos: true, head: stat, body: tr('بیشتر تفریحت بازی بود — خودت وسط ماجرا. چند تایش را با دیگران شریک شو؛ لذتِ گفته‌شده بیشتر می‌ماند.') });
    else if (s < 25 && p < 25) push({ id: 'tags_none', head: stat, body: tr('تفریح این ماه بیشتر تنها و تماشاگر بود. لذتِ بی‌تلاش زود عادی می‌شود و دفعهٔ بعد باید بیشتر خرج کرد تا همان حس برگردد. این‌ها را از قبل انتخاب کرده بودی، یا پیش آمد؟') });
  }
  if (funList.length >= 3 && fun && fun.spent > 0) {
    const mx = Math.max(...funList.map(txAmountToman));
    if (mx > fun.spent * 0.5) push({ id: 'fun_dense', head: tr('بیش از نصف تفریح ماه در یک خرج ({amt}) رفت.', { amt: fmtShort(mx) }), body: tr('تجربهٔ کشیده — چند بار کوچک در طول ماه — معمولاً بیشتر می‌ماند تا یک بار بزرگ که زود تمام می‌شود.') });
  }
  const instFun = funList.filter((t) => t.planId).reduce((a, t) => a + txAmountToman(t), 0);
  if (instFun > 0) push({ id: 'fun_inst', head: tr('{amt} از تفریح این ماه قسط بود.', { amt: fmtShort(instFun) }), body: tr('تفریحی که بدهی می‌سازد سرزندگی نمی‌سازد؛ لذتش تمام شده و پرداختش مانده.') });
  const funCarry = f.carriedCats.fun || 0;
  if (fun && fun.share > 0 && funCarry >= fun.share * (FUN_CARRY_MONTHS - 0.05)) {
    push({ id: 'fun_cap', head: tr('سهم تفریح {n} ماه جمع شده ({amt}).', { n: toFa(FUN_CARRY_MONTHS), amt: fmtShort(funCarry) }), body: tr('از این بالاتر دیگر انباشته نمی‌شود. تجربهٔ کشیده — چند روز، یک یادگیری، یک سفر — بیشتر از یک شب گران می‌ماند.') });
  }

  // معنا: یک پرداخت بزرگ به‌جای مکرر
  const chTx = state.transactions.filter((t) => t.month === mk && t.type === 'out' && t.cat === 'charity' && !isTransfer(t) && !isLoanTx(t) && !isReversed(t));
  const ch = f.cats.find((c) => c.id === 'charity');
  if (!mid && chTx.length === 1 && ch && ch.spent >= ch.share * 0.8) {
    push({ id: 'charity_once', head: tr('همهٔ معنا در یک پرداخت بود.'), body: tr('مکرر و کوچک، همراه با وقت و تماس، بیشتر می‌ماند تا یک حوالهٔ بی‌نام — گیرنده‌ای که می‌بینی، اثری که پیداست.') });
  }

  // ۴) الگوی سه‌ماهه: یک پاکت سه ماه پشت‌سرهم منبع بوده
  if (!opts.shallow && !mid) {
    const topSrc = (ff) => Object.keys(ff.sources).sort((a, b) => ff.sources[b] - ff.sources[a])[0];
    const s0 = topSrc(f);
    if (s0) {
      const f1 = monthFlows(shiftMonth(mk, -1)), f2 = monthFlows(shiftMonth(mk, -2));
      if (f1.budget && f2.budget && topSrc(f1) === s0 && topSrc(f2) === s0) {
        push({ id: 'repeat_src', head: tr('سه ماه پشت‌سرهم، {cat} کمبود پاکت‌های دیگر را پر کرده.', { cat: label(s0) }), body: tr('این دیگر اتفاق نیست، الگوست. یا سهم‌ها را عوض کن، یا بپذیر که این پاکت عملاً کوچک‌تر از نقشه است.') });
      }
    }
  }

  // ۵) پیشنهاد الگو (فقط این‌جا؛ هرگز خودکار)
  const sug = !opts.shallow ? profileSuggestion(mk) : null;
  if (sug) push({ id: 'profile', profile: sug });

  // ۶) تعادل (مثبت؛ دو ماه پشت‌سرهم تکرار نمی‌شود)
  const balanced = f.waste === 0 && f.cats.every((c) => Math.abs(c.dev) <= f.budget * 0.05);
  if (balanced && !mid) {
    const prevB = (() => { const p = monthFlows(shiftMonth(mk, -1)); return p.budget && p.waste === 0 && p.cats.every((c) => Math.abs(c.dev) <= p.budget * 0.05); })();
    if (!prevB) push({ id: 'balanced', pos: true, head: tr('همهٔ پاکت‌ها نزدیک سهم‌شان ماندند.'), body: tr('هیچ پاکتی از پاکت دیگر نخورد. وقتی تقسیم با زندگی می‌خواند، همین‌قدر بی‌صداست.') });
  }

  // ترتیب و سقف: اتلاف → جریان → تفریح/زمان → الگو → پیشنهاد → مثبت‌ها (اگر جا بود)
  const neg = out.filter((n) => !n.pos && n.id !== 'profile');
  const prof = out.filter((n) => n.id === 'profile');
  const pos = out.filter((n) => n.pos);
  return [...neg, ...prof, ...pos].slice(0, 3);
}

// ── پیشنهاد الگوی سهم‌ها از سه ماه کامل اخیر ──
export function profileSuggestion(mk) {
  mk = mk || curMonthKey();
  const cur = curMonthKey();
  const last = mk === cur ? shiftMonth(mk, -1) : mk;
  const rf = state.reflect || {};
  if (rf.profileSnooze && rf.profileSnooze >= last) return null;
  if (rf.profileAskedFor && shiftMonth(rf.profileAskedFor, 3) > last) return null;
  const months = [last, shiftMonth(last, -1), shiftMonth(last, -2)];
  let inc = 0, need = 0, inst = 0, investFull = true;
  for (const k of months) {
    const i = incomeIn(k);
    if (!i || !budgetOf(k)) return null; // ماه بی‌درآمد یا بی‌بودجه → فعلاً هیچ
    inc += i;
    need += catSpent(k, 'need');
    inst += monthInstallments(k);
    if (catSpent(k, 'invest') < catShare(k, 'invest') * 0.95) investFull = false;
  }
  const active = profileFor(last).id;
  const needR = need / inc, instR = inst / inc;
  let id = null;
  if (instR > 0.2) id = 'recovery';
  else if (needR > 0.75) id = 'limited';
  else if (needR < 0.45 && investFull) id = 'abundant';
  if (!id || id === active) return null;
  return { id, needPct: Math.round(needR * 100), instPct: Math.round(instR * 100), from: cur, askedFor: last };
}
const PROFILE_NAMES = { standard: 'استاندارد', limited: 'محدود', abundant: 'فراوان', recovery: 'نقاهت', custom: 'دلخواه' };
export function profileName(id) {
  return tr(PROFILE_NAMES[id] || PROFILE_NAMES.standard);
}
function profileLine(id, targets) {
  const tg = targets || PROFILES[id];
  return MAIN.map((c) => `${label(c)} ${toFa(tg[c])}${pctSign()}`).join(' · ');
}
function profileCardHtml(sug) {
  const why = {
    recovery: tr('سه ماه اخیر حدود {p}٪ درآمدت قسط بوده.', { p: toFa(sug.instPct) }),
    limited: tr('سه ماه اخیر ضروریات حدود {p}٪ درآمدت را گرفته.', { p: toFa(sug.needPct) }),
    abundant: tr('سه ماه اخیر ضروریات حدود {p}٪ درآمدت بوده و آزادی مالی هر ماه پر شده.', { p: toFa(sug.needPct) }),
  }[sug.id];
  return `<div class="rf-note rf-profile">
    <div class="rf-head">${esc(why)} ${tr('شاید الگوی «{n}» به زندگی تو نزدیک‌تر باشد:', { n: profileName(sug.id) })}</div>
    <div class="rf-body">${profileLine(sug.id)}${sug.id === 'recovery' ? '<br>' + tr('(تا پایان بدهی؛ بعدش به الگوی قبلی برمی‌گردد)') : ''}</div>
    <div class="rf-body muted">${tr('این فقط یک پیشنهاد از روی عددهای خودت است. لازم نیست از این الگو پیروی کنی؛ اول ضروریات را ببند، تقسیم بعداً.')}</div>
    <div class="row" style="gap:8px;margin-top:8px">
      <button type="button" class="btn sm primary" onclick="applySuggestedProfile('${sug.id}')">${tr('اعمال از این ماه')}</button>
      <button type="button" class="btn sm ghost" onclick="snoozeProfile('${sug.askedFor}')">${tr('فعلاً نه')}</button>
    </div>
  </div>`;
}
export function applySuggestedProfile(id) {
  setProfile(id, curMonthKey());
  state.reflect = Object.assign({}, state.reflect || {}, { profileAskedFor: curMonthKey(), at: Date.now() });
  save();
  closeModal();
  if (window.render) window.render();
  toast(tr('الگوی «{n}» از این ماه فعال شد', { n: profileName(id) }));
}
export function snoozeProfile(askedFor) {
  state.reflect = Object.assign({}, state.reflect || {}, { profileAskedFor: askedFor || curMonthKey(), at: Date.now() });
  save();
  openReflect(curReflectMk);
}

// ── ردیف در گزارش ──
export function reflectRow(mk) {
  const rf = state.reflect || {};
  if (rf.off) return '';
  if (!budgetOf(mk) || txCount(mk) < 5) return '';
  const list = insights(mk);
  if (!list.length) return '';
  return `<button type="button" class="clar-strip rf-strip" onclick="openReflect('${mk}')">
    <span class="ib sm" style="background:var(--accent-soft,#6366f122);color:var(--accent)">${icon('info')}</span>
    <span class="cs-mid"><b>${tr('بازتاب ماه')}</b><small>${tr('{n} یادداشت از جریان پاکت‌ها', { n: toFa(list.length) })}</small></span>
    ${icon('chevL')}
  </button>`;
}
let curReflectMk = '';
export function openReflect(mk) {
  mk = mk || curMonthKey();
  curReflectMk = mk;
  const list = insights(mk);
  const ft = funTagStats(mk);
  openModal(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>${tr('بازتاب ماه')} · ${monthLabel(mk)}</h2>
    <p class="muted small" style="margin-top:-6px">${tr('چند مشاهده از این‌که پول واقعاً بین پاکت‌ها چطور جابه‌جا شد. نه نمره است، نه هشدار.')}</p>
    ${ft.tagged ? `<div class="small muted" style="margin-bottom:8px">${tr('تفریح')}: ${tr('{s}٪ با دیگران · {p}٪ بازی', { s: toFa(ft.socialPct), p: toFa(ft.playPct) })}</div>` : ''}
    <div class="rf-list">${list.map((n) => n.profile ? profileCardHtml(n.profile) : `<div class="rf-note"><div class="rf-head">${esc(n.head)}</div><div class="rf-body">${esc(n.body)}</div></div>`).join('') || `<div class="empty">${tr('این ماه چیزی برای گفتن نیست.')}</div>`}</div>
    <div class="row" style="justify-content:space-between;margin-top:12px">
      <button type="button" class="link" onclick="openFourPockets()">${tr('دربارهٔ چهار پاکت')}</button>
      <button type="button" class="link muted" onclick="hideReflect()">${tr('این بخش را نشان نده')}</button>
    </div>
  `);
}
export function hideReflect() {
  state.reflect = Object.assign({}, state.reflect || {}, { off: true, at: Date.now() });
  save();
  closeModal();
  if (window.render) window.render();
  toast(tr('بازتاب ماه پنهان شد؛ از تنظیمات برمی‌گردد'));
}
export function setReflectOn(on) {
  state.reflect = Object.assign({}, state.reflect || {}, { off: !on, at: Date.now() });
  save();
  if (window.render) window.render();
}

// ── دربارهٔ چهار پاکت ──
export function openFourPockets() {
  const pr = profileFor(curMonthKey());
  openModal(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>${tr('دربارهٔ چهار پاکت')}</h2>
    <div class="rf-about">
      <p><b>${tr('درصدها نقشه‌اند، نه قانون.')}</b> ${tr('اول ضروریات را ببند؛ تقسیم بعداً. الگوی فعلی تو:')} ${profileName(pr.id)} — ${profileLine(pr.id, pr.targets)}.</p>
      <p><b>${label('need')}</b> — ${tr('آن‌چه بدون آن زندگی نمی‌چرخد: خانه، خوراک، قبض، رفت‌وآمد، درمان. اگر این پاکت هر ماه از بقیه می‌خورد، سهمش را واقعی کن؛ خودت را سرزنش نکن.')}</p>
      <p><b>${label('invest')}</b> — ${tr('پولی که برای «تو»ی آینده خرج می‌شود: پس‌انداز اضطراری، سرمایه‌گذاری، بستن بدهی بد. اول ماه کنار می‌رود، نه از ته‌ماندهٔ آخر ماه.')}</p>
      <p><b>${label('fun')}</b> — ${tr('تفریح اتلاف نیست؛ پایان زنجیرهٔ چراهاست. آن‌چه بیشتر می‌ماند: با دیگران، و وقتی خودت بازیگری نه فقط تماشاگر. مانده‌اش تا سه ماه جمع می‌شود — بیشتر از آن دیگر تفریح نیست. تفریحی که بدهی می‌سازد، سرزندگی نمی‌سازد.')}</p>
      <p><b>${label('charity')}</b> — ${tr('کاری که سه پاکت دیگر نمی‌کنند. مقدار ثابت و کوچک، گیرنده و شکلش کاملاً به انتخاب خودت؛ مکرر و کوچک و همراه با وقت، بیشتر از بزرگ و گاه‌به‌گاه می‌ماند. بیشینه‌سازی لازم نیست.')}</p>
      <p><b>${label('waste')}</b> — ${tr('خرجی که هیچ پاکتی را پر نکرد. فقط اسمش را بنویس؛ همین کافی است.')}</p>
      <p class="muted small">${tr('انحراف در هر دو جهت دیده می‌شود: زیاد خرج کردن از یک پاکت و خالی ماندن پاکت دیگر، دو روی یک جابه‌جایی‌اند. اگر زندگی‌ات با این نقشه نمی‌خواند، نقشه را عوض کن — در تنظیمات، «الگوی پاکت‌ها».')}</p>
    </div>
    <button type="button" class="btn block" onclick="openProfileSettings()">${tr('الگوی پاکت‌ها')}</button>
  `);
}

// ── تنظیمات الگو ──
export function openProfileSettings() {
  const cur = curMonthKey();
  const pr = profileFor(cur);
  const row = (id) => `<button type="button" class="srow" onclick="pickProfile('${id}')">
      <span class="smid"><span class="st1">${profileName(id)}</span><span class="st2">${profileLine(id)}</span></span>
      ${pr.id === id ? icon('check') : ''}</button>`;
  const tg = pr.targets;
  openModal(`
    <button class="x" onclick="closeModal()" aria-label="${tr('بستن')}">${icon('x')}</button>
    <h2>${tr('الگوی پاکت‌ها')}</h2>
    <p class="muted small" style="margin-top:-6px">${tr('از این ماه به بعد اعمال می‌شود؛ ماه‌های قبل با الگوی خودشان می‌مانند. درصدها نقشه‌اند، نه قانون.')}</p>
    <div class="sgroup">${['standard', 'limited', 'abundant', 'recovery'].map(row).join('')}</div>
    <div class="card" style="margin-top:10px">
      <div class="small" style="margin-bottom:6px"><b>${tr('دلخواه')}</b> ${pr.id === 'custom' ? icon('check') : ''}</div>
      <div class="row" style="gap:6px">${MAIN.map((c) => `<div class="col field"><label>${label(c)}</label><input class="input" type="number" inputmode="numeric" min="0" max="100" id="pf_${c}" value="${tg[c]}"></div>`).join('')}</div>
      <div class="row" style="gap:6px">
        <div class="col field"><label>${tr('سقف تومانی تفریح (اختیاری)')}</label><input class="input" type="number" inputmode="numeric" min="0" id="pf_funCap" value="${pr.funCap || ''}"></div>
        <div class="col field"><label>${tr('تا تاریخ (اختیاری)')}</label><input class="input" type="date" id="pf_end" value="${pr.endISO || ''}"></div>
      </div>
      <button type="button" class="btn sm block" onclick="saveCustomProfile()">${tr('ذخیرهٔ دلخواه')}</button>
    </div>
  `);
}
export function pickProfile(id) {
  if (id === 'recovery') {
    const d = window.prompt(tr('تا چه تاریخی؟ (YYYY-MM-DD؛ خالی = بدون پایان)'), '');
    if (d === null) return;
    setProfile(id, curMonthKey(), { endISO: (d || '').trim() });
  } else setProfile(id, curMonthKey());
  save();
  closeModal();
  if (window.render) window.render();
  toast(tr('الگوی «{n}» از این ماه فعال شد', { n: profileName(id) }));
}
export function saveCustomProfile() {
  const tg = {};
  let sum = 0;
  for (const c of MAIN) { tg[c] = Math.max(0, Math.round(Number(document.getElementById('pf_' + c).value) || 0)); sum += tg[c]; }
  if (sum !== 100) return toast(tr('جمع درصدها باید ۱۰۰ شود (الان {n})', { n: toFa(sum) }));
  const funCap = Math.max(0, Number(document.getElementById('pf_funCap').value) || 0);
  const endISO = (document.getElementById('pf_end').value || '').trim();
  setProfile('custom', curMonthKey(), { targets: tg, funCap, endISO });
  save();
  closeModal();
  if (window.render) window.render();
  toast(tr('الگوی دلخواه از این ماه فعال شد'));
}

if (typeof window !== 'undefined') Object.assign(window, { openReflect, hideReflect, openFourPockets, openProfileSettings, pickProfile, saveCustomProfile, applySuggestedProfile, snoozeProfile, setReflectOn });
