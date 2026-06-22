/**
 * TwDivChecker — Automatic ex-dividend record generation for TW stocks.
 *
 * Runs once per calendar day on app startup. Fetches the TWSE ex-dividend
 * calendar via the Cloudflare Worker, matches results against the user's TW
 * holdings, and:
 *   - Auto-creates estimated dividend + income records for ex-dates that are
 *     today or earlier (amounts = shares × per-share dividend from TWSE data).
 *   - Exposes getPendingDivs() so dashboard.js can synchronously render a
 *     "upcoming ex-dividends" preview card from the cached calendar.
 *
 * Dedup guarantee: before inserting, checks for an existing dividend record
 * with source='auto_exdiv' and the same symbol+date, so running twice is safe.
 *
 * Amounts are pre-tax estimates. Users can edit/delete auto-created records
 * from the 台股 → 除權息 tab.
 */
const TwDivChecker = (() => {
  // localStorage key that stores the date of the last successful run (YYYY-MM-DD).
  // Prevents redundant fetches within the same calendar day.
  const CHECK_DATE_KEY = 'fm_tw_div_check_date';

  // source tag applied to both auto-created dividends and their income transactions.
  // Used as the dedup discriminator so we only skip OUR own records, not manual ones.
  const AUTO_SOURCE = 'auto_exdiv';

  // ── Helpers ─────────────────────────────────────────────────────

  function _today() {
    return new Date().toISOString().slice(0, 10);
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
   *    - Creates a dividend record (if not already done).
   *    - Creates a matching income transaction.
   * 3. Returns { created: number, pending: Array } where pending is the list
   *    of future ex-dates with expected amounts for dashboard display.
   *
   * Silent no-op if the Worker is not configured or there are no TW holdings.
   */
  async function checkAndAutoCreate() {
    const today = _today();

    // Already ran today — skip the fetch but still return pending from cache.
    if (localStorage.getItem(CHECK_DATE_KEY) === today) {
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

    // Build a dedup set from already-auto-created dividend records to guarantee
    // idempotency if checkAndAutoCreate somehow runs more than once per day.
    const doneKeys = new Set(
      Store.getDividends('TW')
        .filter(d => d.source === AUTO_SOURCE)
        .map(d => `${d.symbol}_${d.exDate || d.date}`)
    );

    let created = 0;
    const pending = [];

    for (const row of rows) {
      const { sym, name, exDate, payDate, cashPS, stkPS } = _normalize(row);
      if (!sym || !exDate) continue;

      const h = holdingMap[sym];
      if (!h) continue; // user doesn't hold this stock

      if (exDate <= today) {
        // Ex-date has arrived or already passed — auto-create if not yet recorded.
        const key = `${sym}_${exDate}`;
        if (doneKeys.has(key)) continue;

        // Formula per user spec:
        //   cash  = shares × cashPerShare
        //   stock = floor(shares × (stockDivPerShare / 10))
        const cashTotal   = Math.round(h.quantity * cashPS);
        const stockShares = Math.floor(h.quantity * (stkPS / 10));
        if (cashTotal === 0 && stockShares === 0) continue; // nothing to record

        Store.addDividend({
          date: payDate,   // actual distribution date (入帳日)
          exDate: exDate,  // ex-dividend date stored for reference and dedup
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

        doneKeys.add(key);
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
