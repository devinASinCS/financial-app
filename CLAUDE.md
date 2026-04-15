# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

This is a zero-build, static HTML/JS/CSS app with no package manager or bundler. Open `index.html` directly in a browser (double-click or use a local dev server):

```bash
# Simplest: open directly
start financial-app/index.html

# Or with a local server (any static server works)
npx serve financial-app
python -m http.server 8080  # then open http://localhost:8080/financial-app
```

There are no build steps, no tests, no linting configs, and no CI pipeline.

## Architecture

**Global script execution order** (defined in `index.html`):
1. `js/store.js` — `Store` singleton
2. `js/utils.js` — `Utils` singleton
3. `js/components/modal.js` — `Modal` singleton
4. `js/components/charts.js` — `Charts` singleton (wraps Chart.js)
5. `js/pages/dashboard.js`, `transactions.js`, `tw-stocks.js`, `us-stocks.js` — page modules
6. `js/app.js` — router + bootstrap (runs last, depends on all above)

All modules are IIFEs that return a public API and are attached to `window` implicitly. No ES modules, no imports/exports.

**Routing**: hash-based (`#dashboard`, `#transactions`, `#tw-stocks`, `#us-stocks`). Navigating updates the URL hash, fires `hashchange`, and calls `PageXxx.render()`.

**State**: All data lives in `localStorage` under keys prefixed `fm_`. `Store` is the sole read/write interface — never touch `localStorage` directly from pages or components. `Store` also computes derived state: `getHoldings()` (weighted average cost), `getRealizedTrades()` (FIFO-like P&L), `getPnLTimeline()` (monthly cumulative).

**Rendering**: Pages write innerHTML to `#app-content` synchronously, then schedule chart renders with `setTimeout(..., 50)` so the DOM is ready for Chart.js canvas elements.

**Modal**: A single overlay `#modal-overlay` is reused for all dialogs. `Modal.open(html, onClose)` is the generic entry point; typed helpers (`openTransaction`, `openStockTrade`, `openDividend`, `openImport`, `openCarrierConfig`) build the specific HTML. Form submission callbacks (`_saveTx`, `_saveTrade`, etc.) are exposed on `Modal` so they can be called from `onclick` attributes inside the injected HTML.

## Key Conventions

- **Currency**: TW stocks use NT$ (`Utils.formatTWD`); US stocks use USD (`Utils.formatUSD`). The `market` field (`'TW'` or `'US'`) on every trade/dividend/holding determines which formatter to use.
- **Dates**: Always stored as `YYYY-MM-DD` ISO strings. `Utils.normalizeDate()` handles conversion from Republic of China calendar (民國), slash-separated, and compact `YYYYMMDD` formats.
- **Holdings cost basis**: Weighted average method. Sells reduce `totalCost` proportionally. Stock dividends add shares at zero cost.
- **Dividend → income auto-link**: When a new dividend is saved via `Modal._saveDiv`, a matching income transaction (category `'股利'`, source `'dividend'`) is automatically created in `Store`.
- **Demo data**: `app.js:seedDemoData()` seeds sample transactions and trades on first load (when both `fm_transactions` and `fm_stock_trades` are empty in localStorage).
- **Chart instance management**: `Charts` tracks all Chart.js instances by canvas ID and calls `.destroy()` before re-rendering to avoid canvas reuse errors.
