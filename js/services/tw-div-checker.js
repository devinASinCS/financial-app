/**
 * TwDivChecker — Automatic ex-dividend record generation for TW stocks.
 *
 * Runs once per calendar day on app startup. Fetches the TWSE ex-dividend
 * calendar via the Cloudflare Worker, matches results against the user's TW
 * holdings, and applies this rule per (symbol, ex-date):
 *
 *   today <  exDate  → nothing; the row is surfaced on the dashboard as upcoming.
 *   today >= exDate  → create ONE dividend record (shares × per-share amounts)
 *                      plus one income transaction dated on the 發放日, unless
 *                      this (symbol, ex-date) was already recorded.
 *
 * The record is anchored to the ex-date (`date` = `exDate`), while `payDate`
 * carries the 現金股利發放日 — the day the cash actually lands, and therefore the
 * date used for the linked income transaction.
 *
 * Create-once guarantee: a (symbol, ex-date) key is written to a persistent
 * ledger the moment its record is created, and the ledger is unioned with every
 * live TW dividend record before the loop runs. Deleting a dividend also writes
 * its key (see Store.deleteDividend), so a record you removed is never rebuilt.
 *
 * Amounts are pre-tax estimates. Users can edit/delete auto-created records
 * from the 台股 → 除權息 tab.
 */
const TwDivChecker = (() => {
  // localStorage key that stores the date of the last successful run (YYYY-MM-DD).
  // Prevents redundant fetches within the same calendar day.
  const CHECK_DATE_KEY = 'fm_tw_div_check_date';

  // Persistent set of "symbol_exDate" keys that have already been auto-created.
  // NOT in sync FM_KEYS intentionally — pull() must not overwrite it, because
  // if the auto-created dividend wasn't pushed yet the server's fm_dividends
  // won't contain it and we'd lose the dedup state and create duplicates.
  const AUTO_DONE_KEY = 'fm_tw_div_auto_done';

  // source tag applied to both auto-created dividends and their income transactions.
  // Used as the dedup discriminator so we only skip OUR own records, not manual ones.
  const AUTO_SOURCE = 'auto_exdiv';

  // ── Helpers ─────────────────────────────────────────────────────

  function _today() {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
  }

  // Pull a value from a TWSE row object, trying multiple possible field names.
  // The TWSE API has historically used several column name variants.
  function _field(row, ...keys) {
    for (const k of keys) {
      const v = row[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  }

  // Normalise a raw TWSE row into a consistent shape.
  // Dates arrive as ROC calendar strings (e.g. "114/06/25"); Utils.normalizeDate
  // converts them to ISO YYYY-MM-DD.
  function _normalize(row) {
    const sym  = _field(row, '股票代號', '代號', 'symbol');
    const name = _field(row, '名稱', 'name');

    // Prefer the combined ex-date; fall back to cash-only or stock-only date.
    const rawDate = _field(row, '除權息日', '除息日期', '除息日', '除權日期', '除權日');
    const exDate  = Utils.normalizeDate(rawDate);

    // Actual payment date — when cash arrives in brokerage account.
    // TWSE TWT48U includes 現金股利發放日 for cash dividends.
    // Falls back to exDate when the field is absent (e.g. stock-only rows).
    const rawPayDate = _field(row, '現金股利發放日', '配息發放日', '發放日');
    const payDate    = rawPayDate ? Utils.normalizeDate(rawPayDate) : exDate;

    // cashPS: NT$ cash dividend per share.
    // stkPS:  NT$ stock dividend per share of par value (par = NT$10),
    //         so new shares = held × (stkPS / 10).
    const cashPS = parseFloat(_field(row, '每股配息', '現金股利') || '0') || 0;
    const stkPS  = parseFloat(_field(row, '每股配股', '股票股利') || '0') || 0;

    return { sym, name, exDate, payDate, cashPS, stkPS };
  }

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Main entry point called on app startup (once per calendar day).
   *
   * 1. Fetches the TWSE upcoming ex-dividend calendar from the Worker.
   * 2. For each entry whose ex-date ≤ today and the user holds the stock:
   *    - Creates a dividend record dated on the ex-date (if not already done).
   *    - Creates a matching income transaction dated on the pay date.
   * 3. Returns { created: number, pending: Array } where pending is the list
   *    of future ex-dates with expected amounts for dashboard display.
   *
   * Silent no-op if the Worker is not configured or there are no TW holdings.
   */
  async function checkAndAutoCreate() {
    const today = _today();

    // Skip the fetch if we already ran today AND have cached data.
    // If cache is empty (Worker was down last time), retry even on the same day.
    const cachedRows = Store.getUpcomingTWDivs();
    if (localStorage.getItem(CHECK_DATE_KEY) === today && cachedRows.length > 0) {
      return { created: 0, pending: getPendingDivs() };
    }

    const holdings = Store.getHoldings('TW');
    if (holdings.length === 0) return { created: 0, pending: [] };

    const holdingMap = {};
    for (const h of holdings) holdingMap[h.symbol] = h;
    const symbols = Object.keys(holdingMap);

    // Fetch from Worker (filtered to user's symbols by StockPrice.fetchTWUpcomingDividends).
    // On success, update the shared upcoming-divs cache that tw-stocks.js also reads.
    let rows = [];
    try {
      rows = await StockPrice.fetchTWUpcomingDividends(symbols);
      if (rows.length > 0) Store.saveUpcomingTWDivs(rows);
    } catch {
      // Worker not configured or unreachable — fall through to cached data.
    }

    if (rows.length === 0) rows = Store.getUpcomingTWDivs();
    if (rows.length === 0) {
      localStorage.setItem(CHECK_DATE_KEY, today);
      return { created: 0, pending: [] };
    }

    // Dedup set of `symbol_exDate` keys that must never be created a second time.
    // Union of two independent sources so a gap in either one can't produce a duplicate:
    //   1. the persisted ledger, which survives pull() overwriting fm_dividends and
    //      also records dividends the user deleted (see Store.deleteDividend);
    //   2. every live TW dividend record — ANY source, not just auto_exdiv, so a
    //      manually entered dividend for the same stock and ex-date blocks the
    //      auto-create instead of ending up alongside it.
    const _storedDone = JSON.parse(localStorage.getItem(AUTO_DONE_KEY) || '[]');
    const doneKeys = new Set([
      ..._storedDone,
      ...Store.getDividends('TW').map(d => `${d.symbol}_${d.exDate || d.date}`),
    ]);

    // Persist one key the moment its record is created, rather than batching every
    // key to the end of the loop: a mid-loop failure (quota, bad row) then can't
    // discard the keys for records that were already written.
    function _markDone(key) {
      doneKeys.add(key);
      const stored = JSON.parse(localStorage.getItem(AUTO_DONE_KEY) || '[]');
      if (!stored.includes(key)) {
        localStorage.setItem(AUTO_DONE_KEY, JSON.stringify([...stored, key]));
      }
    }

    let created = 0;
    const pending = [];

    for (const row of rows) {
      const { sym, name, exDate, payDate, cashPS, stkPS } = _normalize(row);
      if (!sym || !exDate) continue;

      const h = holdingMap[sym];
      if (!h) continue; // user doesn't hold this stock

      if (exDate <= today) {
        // The ex-date has arrived, or was missed because the app wasn't opened that
        // day — create exactly once, ever. The test is `today >= exDate` rather than
        // an exact match so skipping the ex-date over a weekend or a holiday still
        // records the dividend on the next open; the key check below is what keeps
        // that from happening more than once.
        const key = `${sym}_${exDate}`;
        if (doneKeys.has(key)) continue;

        // Formula per user spec:
        //   cash  = shares × cashPerShare
        //   stock = floor(shares × (stockDivPerShare / 10))
        const cashTotal   = Math.round(h.quantity * cashPS);
        const stockShares = Math.floor(h.quantity * (stkPS / 10));
        if (cashTotal === 0 && stockShares === 0) continue; // nothing to record

        Store.addDividend({
          date: exDate,    // record is anchored to the ex-dividend event
          exDate: exDate,  // 除息日 — also the dedup discriminator
          payDate: payDate, // 發放日 — the day the linked income is recorded on
          symbol: sym,
          name: name || sym,
          market: 'TW',
          cashTotal,
          stockShares,
          cashPerShare: cashPS,
          stockRatio: stkPS,
          holdingQuantity: h.quantity,
          note: '系統自動建立（預估）',
          source: AUTO_SOURCE,
        });

        // Mirror Modal._saveDiv: also create the linked income transaction so
        // the dividend shows up in monthly income totals immediately.
        if (cashTotal > 0) {
          Store.addTransaction({
            date: payDate,  // income recorded on actual payment date
            type: 'income',
            amount: cashTotal,
            category: '股利',
            note: `${sym} ${name || sym} 除權息（自動）`,
            source: AUTO_SOURCE,
          });
        }

        _markDone(key);
        created++;

      } else {
        // Future ex-date — collect for dashboard "Pending Dividends" card.
        pending.push({
          sym,
          name: name || sym,
          exDate,
          payDate,
          expectedCash: Math.round(h.quantity * cashPS),
          expectedStockShares: Math.floor(h.quantity * (stkPS / 10)),
        });
      }
    }

    pending.sort((a, b) => a.exDate.localeCompare(b.exDate));
    localStorage.setItem(CHECK_DATE_KEY, today);
    return { created, pending };
  }

  /**
   * Synchronously derive the pending-divs list from the cached TWSE calendar.
   * Called by dashboard.render() so the card renders on first paint without
   * waiting for the async checkAndAutoCreate().
   *
   * Returns [] when cache is empty (first-ever load before worker fetch).
   */
  function getPendingDivs() {
    const today    = _today();
    const holdings = Store.getHoldings('TW');
    const holdingMap = {};
    for (const h of holdings) holdingMap[h.symbol] = h;

    return Store.getUpcomingTWDivs()
      .map(row => {
        const { sym, name, exDate, payDate, cashPS, stkPS } = _normalize(row);
        if (!sym || !exDate || exDate <= today) return null;
        const h = holdingMap[sym];
        if (!h) return null;
        return {
          sym,
          name: name || sym,
          exDate,
          payDate,
          expectedCash: Math.round(h.quantity * cashPS),
          expectedStockShares: Math.floor(h.quantity * (stkPS / 10)),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.exDate.localeCompare(b.exDate));
  }

  return { checkAndAutoCreate, getPendingDivs };
})();
