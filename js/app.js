import { store, toast, showTip, hideTip, APP_VERSION, haptic } from './utils.js';
import { t, t as tr, setLang, langPref, LANGS, calPref, setCalendar } from './i18n.js';
import { icon } from './icons.js';
import * as inst from './installments.js';
import { openNewBook, bookToggle, bookCreate } from './book.js';
import { openHealth, openHealthSettings, saveHealthSettings, resetHealthSettings } from './healthui.js';
import { openCatReport, openSubReport, openTitleItems,
  gsAnswer,
  gsUngroup,
  openTitleNode,
  ndDetach,
  ndReattach,
  openCustomSubs,
  csRename,
  csDelete,
  csDelete2,
  csDelete3, openQuickCategorize, qcPick } from './subsui.js';
import { closeModal, openModal, closeSubModal } from './modal.js';
import { render, setRender } from './view.js';
import { setOnSave, state, curStats } from './state.js';
import { guideAfterRender } from './guide.js';
import { celebrateAfterRender } from './clarity.js';
import { showDueNotice } from './notice.js';
import { renderAll, fitNumbers, setTodayLabel, resetMonths, txShift, repShift, togglePocket, toggleAcctGroup } from './render.js';
import { txfQuery, txfKind, txfToggle, txfSet, txfClear, txfOpen, txfDraft, txfDraftRange, txfDraftAmt, txfDraftClear, txfApply } from './txfilter.js';
import {
  delDebt,
  enableDebtReminders,
  findDebt,
  notifyDueDebts,
  openDebtForm,
  overdueCount,
  saveDebt,
  setDebtKind,
  settleDebt,
  addDebtPayment,
  delDebtPayment,
  syncDebtAmountLabel,
  debtPaybackChanged,
  debtInterestCatChanged,
  debtPickInterestSub,
  openDebtRemind,
  debtPickContact,
  sendDebtRemind,
} from './debts.js';
import { initReminders, checkReminders, openRemindSettings, remindSetDays, remindSetHour, remindEnable, remindExportCal } from './remind.js';
import {
  applyTheme,
  bioUnlock,
  changePinPrompt,
  changePinDo,
  changePassPrompt,
  changePassDo,
  clearPin,
  disableBiometric,
  enableBiometric,
  encryptFinish,
  encryptStep2,
  encryptStep3,
  initPrefs,
  openEncryptSetup,
  openPinRestoreModal,
  openSettings,
  openSettingsAppearance,
  openSettingsSecurity,
  openSettingsGoogle,
  openSettingsScan,
  openSettingsAI,
  openSettingsBackup,
  exportBackup,
  disableEncPrompt,
  disableEncDo,
  saveBackupNow,
  backupSaved,
  copyBackupText,
  importBackup,
  submitImportPass,
  openSettingsLanguage,
  openSettingsBook,
  openBookCalendar,
  changeDigits,
  openSettingsRates,
  openBaseCurrency,
  bcSync,
  applyBaseCurrency,
  openSettingsAbout,
  resetGuidesUI,
  lockApp,
  recoveryFinish,
  recoveryStep2,
  savePinRestore,
  rotatePhrasePrompt,
  saveGeminiKey,
  clearGeminiKey,
  setLockMode,
  showLockForRemote,
  startPhraseRecovery,
  submitLockPin,
  toggleLockMode,
  togglePrivacy,
  tryBiometric,
  unlockApp,
} from './prefs.js';
import {
  googleSignIn,
  googleSignOut,
  googleSignOutDo,
  initGoogleOnLoad,
  loadFromDrive,
  openProfileMenu,
  pushToDrive,
  refreshFromDrive,
  scheduleSync,
  submitRemotePass,
  syncOnPageChange,
} from './sync.js';
import {
  delAccount,
  archiveAccount,
  openRenameInstitution,
  saveRenameInstitution,
  delInvest,
  delTx,
  editInvestPrice,
  openAccountForm,
  openAccountLedger,
  openPocketLedger,
  openBudgetForm,
  setBudgetAmount,
  useScan, dropScan,
  acctCardInput, acctCardPreview,
  openInvestForm,
  openRateEdit,
  openTransferForm,
  openTxForm,
  saveAccount,
  saveBudget,
  saveInvest,
  savePrice,
  saveRate,
  saveRateFrom,
  saveTransfer,
  saveTx,
  cancelTxForm,
  setTxCat,
  txCatsExpand,
  txNext,
  txBack,
  lineCatsExpand,
  syncLineReflect,
  setTxSub,
  pickTxTitle,
  onTxNoteInput,
  setTxType,
  setTxMode,
  onTxAmountInput,
  syncTxUnitTotal,
  addTxLine,
  removeTxLine,
  toggleLineDisc,
  syncTxLine,
  setLineCat,
  setLineSub,
  addRemainderLine,
  toggleScanPick,
  openScanFromList,
  startScan,
  onScanPhoto,
  rescanAs,
  setPaperType,
  setPaperCat,
  removePaperRow,
  savePaperTxs,
  syncTxAmountLabel,
  toggleCustomCurrency,
  transferAccountsChanged,
  updateTransferPreview,
  openQuickTx,
  qaKey,
  qaOp,
  qaEq,
  qaFn,
  qaSetType,
  qaSetCat,
  qaPickTitle,
  qaTag, setTxTag, toggleQuiz, quizAnswer, quizPickTx, quizPickQa,
  qaPickAccount,
  qaChooseAccount,
  qaMore,
  qaSave,
} from './forms.js';

setRender(() => {
  renderAll();
  guideAfterRender(curTab);
  setTimeout(celebrateAfterRender, 250);
  setTimeout(() => { try { showDueNotice(); } catch (e) {} }, 600);
});
setOnSave(scheduleSync);

const TABS = [
  { id: 'home', get lbl() { return t('nav.home'); } },
  { id: 'tx', get lbl() { return t('nav.tx'); } },
  { id: 'report', get lbl() { return t('nav.report'); } },
  { id: 'assets', get lbl() { return t('nav.assets'); } },
];
// زیرصفحه‌های تب «دارایی» (بعد از صفحهٔ مرور)
const ASSET_VIEWS = {
  accounts: { get lbl() { return t('nav.accounts'); }, el: 'accountsContent', acts: () => `<button class="btn sm icon" title="${t('act.transfer')}" onclick="openTransferForm()">${icon('swap')}</button><button class="btn sm icon primary" title="${t('act.newAccount')}" onclick="openAccountForm()">${icon('plus')}</button>` },
  invest: { get lbl() { return t('nav.invest'); }, el: 'investContent', acts: () => `<button class="btn sm icon primary" title="${t('act.newInvest')}" onclick="openInvestForm()">${icon('plus')}</button>` },
  debts: { get lbl() { return t('nav.debts'); }, el: 'debtsContent', acts: () => `<button class="btn sm icon primary" title="${t('act.newDebt')}" onclick="openDebtForm()">${icon('plus')}</button>` },
  installments: { get lbl() { return t('nav.installments'); }, el: 'installmentsContent', acts: () => `<button class="btn sm icon primary" title="${t('act.newPlan')}" onclick="openPlanForm()">${icon('plus')}</button>` },
};

let curTab = 'home';
let curAsset = ''; // '' = صفحهٔ مرور

function paintAssetView() {
  const ov = document.getElementById('assetsOverview');
  const view = document.getElementById('assetsView');
  const bar = document.getElementById('assetsViewBar');
  if (!ov || !view) return;
  const v = ASSET_VIEWS[curAsset];
  ov.style.display = v ? 'none' : '';
  view.style.display = v ? '' : 'none';
  Object.entries(ASSET_VIEWS).forEach(([k, d]) => {
    const el = document.getElementById(d.el);
    if (el) el.style.display = k === curAsset ? '' : 'none';
  });
  if (bar) {
    bar.innerHTML = v
      ? `<button type="button" class="back" onclick="setAssetTab('')" aria-label="${t('act.back')}"><span class="dir-chev">${icon('chevR')}</span></button><h2>${v.lbl}</h2><div class="acts">${v.acts()}</div>`
      : '';
  }
  const title = document.getElementById('pageTitle');
  if (title && curTab === 'assets') title.textContent = v ? v.lbl : t('nav.assets');
  const fab = document.getElementById('fab');
  if (fab) fab.title = curAsset === 'debts' ? t('act.newDebt') : curAsset === 'installments' ? t('act.newPlan') : t('act.newTx');
  fitNumbers();
}

function setAssetTab(id) {
  curAsset = ASSET_VIEWS[id] ? id : '';
  paintAssetView();
  window.scrollTo({ top: 0 });
}
function buildAssetTabs() {
  paintAssetView();
}

function switchTab(id) {
  // سازگاری با کدهای قدیمی: accounts / invest / debts / installments → تب دارایی
  if (ASSET_VIEWS[id]) {
    curAsset = id;
    id = 'assets';
  } else if (id === 'assets') curAsset = '';
  if (!TABS.some((t) => t.id === id)) return;
  curTab = id;
  document.querySelectorAll('section').forEach((s) => s.classList.remove('active'));
  const sec = document.getElementById('tab-' + id);
  if (sec) sec.classList.add('active');
  const title = document.getElementById('pageTitle');
  const tab = TABS.find((t) => t.id === id);
  if (title && tab) title.textContent = tab.lbl;
  document.querySelectorAll('#bottomNav .bn').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
  moveBnPill();
  paintAssetView();
  render();
  syncOnPageChange();
  window.scrollTo({ top: 0 });
}

// حبابِ کشوییِ تب فعال (سبک تلگرام: کل آیتم را می‌پوشاند)
function moveBnPill() {
  const nav = document.getElementById('bottomNav');
  const pill = document.getElementById('bnPill');
  if (!nav || !pill) return;
  const on = nav.querySelector('.bn.on');
  if (!on) { pill.style.opacity = '0'; return; }
  pill.style.left = on.offsetLeft + 4 + 'px';
  pill.style.width = on.offsetWidth - 8 + 'px';
  pill.style.opacity = '1';
}
window.addEventListener('resize', moveBnPill);
addEventListener('load', () => setTimeout(moveBnPill, 80));

function paintShellIcons() {
  document.querySelectorAll('#bottomNav .bn[data-ic]').forEach((b) => {
    if (!b.querySelector('svg')) b.insertAdjacentHTML('afterbegin', icon(b.dataset.ic));
    const l = b.querySelector('.bnl');
    if (l) l.textContent = t('nav.' + b.dataset.tab);
  });
  const set = (id, name) => {
    const el = document.getElementById(id);
    if (el && !el.querySelector('svg')) el.innerHTML = icon(name);
  };
  set('fab', 'plus');
  set('btnSettings', 'settings');
  set('btnPrivacy', 'eye');
  document.querySelectorAll('.logo').forEach((l) => (l.innerHTML = icon('wallet')));
}

function isLocked() {
  return !!(
    document.documentElement.classList.contains('needs-lock') ||
    (document.getElementById('lockScreen') && document.getElementById('lockScreen').classList.contains('show'))
  );
}

function handleAppBack() {
  const overlay = document.getElementById('overlay');
  if (overlay && overlay.classList.contains('show')) {
    closeModal();
    return true;
  }
  if (isLocked()) return true;
  if (curTab === 'assets' && curAsset) {
    setAssetTab('');
    return true;
  }
  if (curTab !== 'home') {
    switchTab('home');
    return true;
  }
  return false;
}

function askLeaveApp() {
  openModal(`
    <div style="text-align:center;padding:10px 4px">
      <span class="ib lg red" style="margin-bottom:12px">${icon('logout')}</span>
      <p style="font-size:15px;margin:0 0 18px">${tr('می‌خوای از برنامه خارج شوی؟')}</p>
      <div class="row">
        <button class="btn" style="flex:1" onclick="closeModal()">${tr('نه، بمون')}</button>
        <button class="btn danger" style="flex:1" onclick="leaveApp()">${tr('بله، خارج شو')}</button>
      </div>
    </div>`);
}

let leavingApp = false;
function leaveApp() {
  leavingApp = true;
  closeModal();
  try {
    window.close();
  } catch (e) {}
  history.go(-2);
}

function setupBackButton() {
  history.replaceState({ cap: 0 }, '');
  history.pushState({ cap: 1 }, '');
  window.addEventListener('popstate', () => {
    if (leavingApp) return;
    if (handleAppBack()) {
      history.pushState({ cap: 1 }, '');
      return;
    }
    history.pushState({ cap: 1 }, '');
    askLeaveApp();
  });
}

function findTx(id) {
  return state.transactions.find((x) => x.id === id);
}
function findAccount(id) {
  return state.accounts.find((x) => x.id === id);
}
function findInvest(id) {
  return state.investments.find((x) => x.id === id);
}

Object.assign(window, {
  txfQuery, txfKind, txfToggle, txfSet, txfClear, txfOpen, txfDraft, txfDraftRange, txfDraftAmt, txfDraftClear, txfApply,
  curStats,
  openPlanForm: inst.openPlanForm,
  plPickSub: inst.plPickSub,
  plCatChanged: inst.plCatChanged,
  openPlanDetail: inst.openPlanDetail,
  openInstSchedule: inst.openInstSchedule,
  findPlan: inst.findPlan,
  savePlan: inst.savePlan,
  delPlan: inst.delPlan,
  plSetKind: inst.plSetKind,
  plStartChanged: inst.plStartChanged,
  plSetMode: inst.plSetMode,
  plRecalc: inst.plRecalc,
  payRow: inst.payRow,
  unpayRow: inst.unpayRow,
  openPayRow: inst.openPayRow,
  confirmPayRow: inst.confirmPayRow,
  openRowEdit: inst.openRowEdit,
  saveRow: inst.saveRow,
  delRow: inst.delRow,
  switchTab,
  setAssetTab,
  closeModal,
  closeSubModal,
  openBudgetForm,
  setBudgetAmount,
  useScan, dropScan,
  acctCardInput, acctCardPreview,
  openTxForm,
  openQuickTx,
  qaKey,
  qaOp,
  qaEq,
  qaFn,
  qaSetType,
  qaSetCat,
  qaPickTitle,
  qaTag, setTxTag, toggleQuiz, quizAnswer, quizPickTx, quizPickQa,
  qaPickAccount,
  qaChooseAccount,
  qaMore,
  qaSave,
  setTxType,
  setTxCat,
  txCatsExpand,
  txNext,
  txBack,
  lineCatsExpand,
  syncLineReflect,
  setTxSub,
  pickTxTitle,
  onTxNoteInput,
  saveTx,
  cancelTxForm,
  delTx,
  syncTxAmountLabel,
  setTxMode,
  onTxAmountInput,
  syncTxUnitTotal,
  addTxLine,
  removeTxLine,
  toggleLineDisc,
  syncTxLine,
  setLineCat,
  setLineSub,
  addRemainderLine,
  toggleScanPick,
  openScanFromList,
  startScan,
  onScanPhoto,
  rescanAs,
  setPaperType,
  setPaperCat,
  removePaperRow,
  savePaperTxs,
  openAccountForm,
  openAccountLedger,
  openPocketLedger,
  saveAccount,
  delAccount,
  archiveAccount,
  openRenameInstitution,
  saveRenameInstitution,
  openInvestForm,
  saveInvest,
  delInvest,
  editInvestPrice,
  savePrice,
  saveBudget,
  openRateEdit,
  saveRate,
  saveRateFrom,
  openTransferForm,
  toggleCustomCurrency,
  transferAccountsChanged,
  updateTransferPreview,
  saveTransfer,
  txShift,
  repShift,
  togglePocket,
  showTip,
  hideTip,
  toggleAcctGroup,
  googleSignIn,
  googleSignOut,
  googleSignOutDo,
  openProfileMenu,
  pushToDrive,
  loadFromDrive,
  findTx,
  findAccount,
  findInvest,
  findDebt,
  openDebtForm,
  saveDebt,
  delDebt,
  settleDebt,
  addDebtPayment,
  delDebtPayment,
  setDebtKind,
  syncDebtAmountLabel,
  debtPaybackChanged,
  debtInterestCatChanged,
  debtPickInterestSub,
  openDebtRemind,
  debtPickContact,
  sendDebtRemind,
  openRemindSettings,
  remindSetDays,
  remindSetHour,
  remindEnable,
  remindExportCal,
  enableDebtReminders,
  render,
  toast,
  applyTheme,
  openSettings,
  openSettingsAppearance,
  openSettingsSecurity,
  openSettingsGoogle,
  openSettingsScan,
  openSettingsAI,
  openNewBook,
  bookToggle,
  bookCreate,
  openCatReport,
  openSubReport,
  openTitleItems,
  gsAnswer,
  gsUngroup,
  openTitleNode,
  ndDetach,
  ndReattach,
  openCustomSubs,
  csRename,
  csDelete,
  csDelete2,
  csDelete3,
  openHealth,
  openHealthSettings,
  saveHealthSettings,
  resetHealthSettings,
  openQuickCategorize,
  qcPick,
  openSettingsBackup,
  exportBackup,
  disableEncPrompt,
  disableEncDo,
  saveBackupNow,
  backupSaved,
  copyBackupText,
  importBackup,
  submitImportPass,
  openSettingsLanguage,
  openSettingsBook,
  openBookCalendar,
  changeDigits,
  openSettingsRates,
  changeLanguage,
  changeCalendar,
  setTodayLabel,
  openBaseCurrency,
  bcSync,
  applyBaseCurrency,
  openSettingsAbout,
  resetGuidesUI,
  lockApp,
  saveGeminiKey,
  clearGeminiKey,
  changePinPrompt,
  changePinDo,
  changePassPrompt,
  changePassDo,
  clearPin,
  enableBiometric,
  disableBiometric,
  submitLockPin,
  tryBiometric,
  bioUnlock,
  unlockApp,
  leaveApp,
  togglePrivacy,
  openEncryptSetup,
  encryptStep2,
  encryptStep3,
  encryptFinish,
  rotatePhrasePrompt,
  startPhraseRecovery,
  recoveryStep2,
  recoveryFinish,
  openPinRestoreModal,
  savePinRestore,
  setLockMode,
  showLockForRemote,
  submitRemotePass,
  toggleLockMode,
});

async function changeLanguage(pref) {
  await setLang(pref);
  paintShellIcons();
  setTodayLabel();
  buildAssetTabs();
  switchTab(curTab);
  if (window.openSettingsLanguage) window.openSettingsLanguage();
}
function changeCalendar(v) {
  setCalendar(v);
}
window.onBookChanged = () => {
  resetMonths();
  setTodayLabel();
  buildAssetTabs();
  switchTab('home');
};
paintShellIcons();
// منوی سریعِ FAB به شیت کشویی تلگرامی: تراکنش / طلب و بدهی / سرمایه / اقساط
(function setupFabMenu() {
  const fab = document.getElementById('fab');
  const menu = document.getElementById('fabMenu');
  const scrim = document.getElementById('fabScrim');
  if (!fab || !menu || !scrim) return;
  const items = {
    fmTx: { ic: 'list', fn: () => openTxForm() },
    fmDebt: { ic: 'handshake', fn: () => openDebtForm() },
    fmInv: { ic: 'trend', fn: () => openInvestForm() },
    fmInst: { ic: 'calendar', fn: () => inst.openPlanForm() },
  };
  Object.keys(items).forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const ic = el.querySelector('.fm-ic');
    if (ic) ic.innerHTML = icon(items[id].ic);
    el.onclick = () => { setFabMenu(false); items[id].fn(); };
  });
  window.setFabMenu = function (open) {
    menu.classList.toggle('show', open);
    menu.removeAttribute('hidden');
    scrim.hidden = !open;
    fab.classList.toggle('open', open);
    if (open) {
      const ss = document.getElementById('scanSheet');
      if (ss) ss.classList.remove('show');
      haptic(8);
    }
  };
  fab.onclick = () => window.setFabMenu(!menu.classList.contains('show'));
  scrim.onclick = () => {
    window.setFabMenu(false);
    if (window.setScanMenu) window.setScanMenu(false);
  };
})();

// دکمهٔ دوربین: اول پیشنهاد «گالری / دوربین»، بعد خواندن فاکتور
(function setupScanFab() {
  const sc = document.getElementById('scanFab');
  const sheet = document.getElementById('scanSheet');
  const scrim = document.getElementById('fabScrim');
  if (!sc || !sheet || !scrim) return;
  sc.innerHTML = icon('camera');
  window.setScanMenu = function (open) {
    sheet.classList.toggle('show', open);
    if (open) {
      if (window.setFabMenu) window.setFabMenu(false);
      haptic(8);
    }
    scrim.hidden = !open;
  };
  sc.onclick = () => window.setScanMenu(!sheet.classList.contains('show'));
  const items = { scCam: { ic: 'camera', kind: 'cam' }, scGal: { ic: 'image', kind: 'gal' } };
  Object.entries(items).forEach(([id, it]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const ic = el.querySelector('.fm-ic');
    if (ic) ic.innerHTML = icon(it.ic);
    el.onclick = () => {
      window.setScanMenu(false);
      const needForm = !document.getElementById('scanCam'); // ورودی‌ها فقط داخل فرم ساخته می‌شوند
      // فرمِ کامل باز شود: فرمِ سریع (کیبورد) ورودی‌های scanCam/scanGal ندارد،
      // پس بدون full هیچ فایل‌پیکی باز نمی‌شد
      if (needForm) openTxForm(null, { full: true });
      setTimeout(() => startScan(it.kind), needForm ? 250 : 30);
    };
  });
})();

// مخفی‌کردن نرم دکمه‌های شناور هنگام اسکرول به پایین، بازگشت در اسکرول به بالا
(function setupFabScrollHide() {
  let lastY = 0;
  window.addEventListener('scroll', () => {
    const y = window.scrollY || 0;
    const menu = document.getElementById('fabMenu');
    const sm = document.getElementById('scanSheet');
    const anyOpen = (menu && menu.classList.contains('show')) || (sm && sm.classList.contains('show'));
    if (anyOpen) {
      document.body.classList.remove('fabsHidden');
      lastY = y;
      return;
    }
    if (y > lastY + 4 && y > 40) document.body.classList.add('fabsHidden');
    else if (y < lastY - 4 || y < 24) document.body.classList.remove('fabsHidden');
    lastY = y;
  }, { passive: true });
})();
document.querySelectorAll('#bottomNav .bn').forEach((b) => {
  b.onclick = () => switchTab(b.dataset.tab);
  b.classList.toggle('on', b.dataset.tab === curTab);
});
const btnPrivacy = document.getElementById('btnPrivacy');
const btnSettings = document.getElementById('btnSettings');
if (btnPrivacy) btnPrivacy.onclick = togglePrivacy;
if (btnSettings) btnSettings.onclick = openSettings;
const btnProfile = document.getElementById('btnProfile');
if (btnProfile) btnProfile.onclick = openProfileMenu;
try {
  setupBackButton();
} catch (e) {}
try {
  setTodayLabel();
  buildAssetTabs();
  render();
  initPrefs();
  initReminders();
  checkReminders();
} catch (err) {
  console.error(err);
  if (window.__capLog) window.__capLog(tr('شروع برنامه'), err);
  const dbg = document.getElementById('lockDebug');
  if (dbg) dbg.textContent = (tr('خطا در شروع:') + ' ') + ((err && err.message) || err);
  const home = document.getElementById('homeContent');
  if (home) home.innerHTML = ('<div class="card">' + tr('برنامه بالا نیامد. صفحه را کامل ببند و دوباره باز کن.') + '</div>');
}

// ورود گوگل از طریق Worker است؛ به کتابخانهٔ GIS وابسته نیست
initGoogleOnLoad();

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') {
    refreshFromDrive();
    checkReminders();
  }
});

const swHost = location.hostname;
const allowSW =
  swHost === 'localhost' ||
  swHost === '127.0.0.1' ||
  swHost.endsWith('.github.io') ||
  swHost.endsWith('.e2b.app');
// نسخهٔ تست سرویس‌ورکر ندارد؛ به‌روزرسانی با مقایسهٔ نسخهٔ روی سرور انجام می‌شود (همان دکمهٔ «درباره»)
if (!allowSW) {
  const setUpd = (st) => {
    window.__appUpdate = st;
    document.dispatchEvent(new CustomEvent('appupdate', { detail: st }));
  };
  window.__checkUpdate = () =>
    fetch('js/utils.js?u=' + Date.now(), { cache: 'no-store' })
      .then((r) => r.text())
      .then((txt) => {
        const m = txt.match(/APP_VERSION\s*=\s*'([^']+)'/);
        const remote = m && m[1];
        setUpd(remote && remote !== APP_VERSION ? 'ready' : 'latest');
        return window.__appUpdate;
      })
      .catch(() => {
        setUpd('offline');
        return 'offline';
      });
  window.__applyUpdate = () => {
    const u = new URL(location.href);
    u.searchParams.set('r', String(Date.now()));
    location.replace(u.toString());
  };
  setTimeout(() => window.__checkUpdate(), 1500);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') window.__checkUpdate();
  });
}
if ('serviceWorker' in navigator && allowSW) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker
    .register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      const kick = (w) => {
        if (w) w.postMessage('skipWaiting');
      };
      const setUpd = (st) => {
        window.__appUpdate = st;
        document.dispatchEvent(new CustomEvent('appupdate', { detail: st }));
      };
      // اگر نسخهٔ جدید نصب شده ولی فعال نشده (بعضی مرورگرها خودکار جابه‌جا نمی‌کنند)
      if (reg.waiting) {
        setUpd('ready');
        kick(reg.waiting);
      }
      window.__applyUpdate = () => {
        if (reg.waiting) kick(reg.waiting);
        else location.reload();
      };
      window.__checkUpdate = () =>
        reg
          .update()
          .then(() => {
            if (reg.waiting) setUpd('ready');
            else if (reg.installing) setUpd('installing');
            else setUpd('latest');
            return window.__appUpdate;
          })
          .catch(() => {
            setUpd('offline');
            return 'offline';
          });
      reg.update();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update();
      });
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        setUpd('installing');
        w.addEventListener('statechange', () => {
          if (w.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              setUpd('ready');
              kick(w); // خودکار اعمال می‌شود؛ اگر نشد، دکمهٔ «اعمال» در دربارهٔ برنامه هست
            } else setUpd('latest');
          }
        });
      });
    })
    .catch(() => {});
}
