# Taraz (تراز) — Personal Finance PWA

[فارسی](./README.fa.md) · Live: <https://taraz-app.github.io/>

Taraz is an offline‑first personal budgeting app built as a static Progressive Web App. No backend, no accounts, no tracking: your data lives on your device (optionally end‑to‑end encrypted) and can be synced through your own Google Drive.

It is designed around the **envelope (“pocket”) method** — every month’s budget is split into a few pockets and the app tells you, at a glance, whether you are still on plan.

---

## Features

### Budget & pockets
- Monthly budget with carry‑over of the previous month’s remainder.
- Five spending pockets with target shares: **Essentials 60%**, **Investing 20%**, **Fun 15%**, **Giving 5%**, plus **Waste** (target 0% — for honesty with yourself).
- A separate **Loans / Lending** pocket that sits *outside* income and spending, so lending money or getting repaid never distorts your monthly picture.
- Home screen “spendable” card: what is left this month and how much per day until month end.
- Quick‑start checklist for new users (create account → set budget → first expense).

### Transactions
- Quick numeric keypad for entering an expense in two taps; amount is grouped with commas and read back in words (“1.5 million toman”).
- Full form: expense / income, pocket, account, date, note.
- **Invoices**: one transaction with many line items (name, quantity, unit, unit price), each item assignable to its own pocket; the app checks that lines add up to the total.
- **Transfers** between accounts, including cross‑currency transfers with a per‑transfer rate.
- Swipe a row to delete or edit, long‑press to repeat; “what if you hadn’t spent this?” reflection note for Waste items.
- **Photo import** (optional, uses your own Google Gemini API key): photograph a handwritten list or a receipt and get transactions/invoice lines pre‑filled for review.
- Per‑account ledger with running balance; per‑pocket ledger per month.

### Report
- Monthly verdict (“on plan”, “slightly off plan”, “X went over its share”) computed from how far actual spending drifts from the pocket targets.
- Bullet chart per pocket: light bar = share of budget, dark bar = actual, red segment past the target line.
- Installments paid this month and loan flows are shown separately.

### Assets
- **Accounts**: bank cards, cash, crypto, online wallets, grouped by institution; multi‑currency with per‑currency rates; opening balance; last‑4 digits.
- **Investments**: gold, property, car, crypto or anything with a quantity, buy price and current price; profit/loss overall and per asset.
- **Debts & loans**: money you lent or borrowed, with due dates, partial payments (each payment is its own transaction), settlement to any account, reminders for upcoming/overdue items.
- **Installment plans**: bank loans (equal installments or monthly principal + periodic interest) and installment purchases (down payment + n × instalment vs. cash price). Editable schedule per row (amount, date, interest, penalty), one‑tap “paid” that creates the real transaction, overdue tracking, interest reporting, optional disbursement of the loan principal into an account.
- Net worth (cash + investments) and obligations (open debts + unpaid installments) overview.

### Currency
- Any base currency (default: Iranian toman); ~25 built‑in currencies plus custom ones.
- Short‑form numbers on summary cards (2.4 million / 850K) with correct roll‑up; full numbers inside transactions.
- Base currency can be changed later; budgets and rates are converted.

### Language & calendar
- **Persian (RTL) and English (LTR)**; picked automatically from the device language or set manually in Settings.
- Persian or Latin numerals, localized units (million/thousand), logical‑property CSS so the whole layout mirrors correctly.
- **Solar Hijri (Jalali) or Gregorian** calendar display; budget months always follow the Jalali month boundaries, and in Gregorian mode the month is shown as a date range.

### Security & privacy
- Optional **end‑to‑end encryption** (AES‑256‑GCM, PBKDF2‑derived keys). The data key is wrapped by your password and by a **12‑word recovery phrase**; without one of them nobody — including Google — can read the file.
- **Biometric unlock** (WebAuthn platform authenticator: fingerprint / Face ID) as a convenience on top of the password.
- Password change and device‑merge flows when several devices use different passwords.
- “Hide amounts” toggle for using the app in public.
- **Backup**: export all data as JSON and restore it later (Settings → Backup).
- [Privacy Policy](./privacy.html) · [Terms of Service](./terms.html) (also linked from Settings → About).

### Sync & offline
- Installable PWA with a service worker; works fully offline.
- Optional **Google Drive sync** (`appDataFolder`, file `capital-app-data.json`): last‑writer‑wins by `updatedAt`, encrypted at rest when encryption is on.
- Native reminders (Notifications API) for debts and installments due soon.

### Appearance
- Five themes: Light (default), Night, Ocean, Forest, Sunset.
- Compact, thumb‑friendly layout; the same list component is used for accounts, debts and installments.

---

## Running locally

Everything is static. ES modules do not load over `file://`, so serve the folder:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```



## Project layout

| Path | Role |
| --- | --- |
| `index.html`, `css/app.css` | Shell and styles |
| `js/boot.js` → `js/app.js` | Loads language, then starts the app (tabs, FAB, shell) |
| `js/i18n.js`, `i18n/*.js` | Translation layer; `fa` / `en` dictionaries |
| `js/state.js` | Data model, calculations, currencies |
| `js/render.js` | Home, transactions, report, assets views |
| `js/forms.js` | Transaction / invoice / transfer / account / asset / budget forms |
| `js/debts.js`, `js/installments.js` | Debts and installment plans |
| `js/prefs.js` | Settings, security wizard, themes, rates |
| `js/crypto.js`, `js/securestore.js` | Encryption and key management |
| `js/sync.js` | Google sign‑in and Drive sync |
| `js/scan.js` | Photo import via Gemini |
| `js/jalali.js` | Jalali ↔ Gregorian conversion and formatting |
| `js/utils.js` | Formatting, money inputs, storage helpers |
| `sw.js`, `manifest.webmanifest` | Offline cache and install metadata |

## Data model (short)

- `transactions[]` — `{id,type:'out'|'in'|'transferOut'|'transferIn',cat,amount,accountId,dateISO,note,lines?,debtId?,planId?}`
- `accounts[]`, `investments[]`, `budgets{ 'yyyy/mm': {amount} }`, `rates{ cur: rate }`
- `debts[]` — `{…, payments:[{id,amount,dateISO,accountId,txId}]}`
- `installments[]` — `{kind:'loan'|'purchase', mode, rows:[{dueISO,amount,interest,penalty,paidISO,txId}]}`

All amounts are stored in the account’s own currency; the base currency is used only for totals.

## Version

Current: `2.38.14` (root) / `2.38.14-test` (test build). The version string is in `js/utils.js` (`APP_VERSION`) and shown in Settings → About.

## License

Personal project; all rights reserved unless stated otherwise.
