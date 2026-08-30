/**
 * TwDivChecker — Automatic ex-dividend record generation for TW stocks.
 *
 * Runs once per calendar day on app startup. Fetches the TWSE ex-dividend
 * calendar via the Cloudflare Worker, matches results against the user's TW
 * holdings, and:
 *   - Auto-creates estimated dividend records for ex-dates that are today or
 *     earlier (amounts = shares × per-share dividend from TWSE data), dated at
 *     the actual cash payment date fetched from FinMind when available.
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
    const rawDate = _field(row, '除權除息日期', '除權息日', '除息日期', '除息日', '除權日期', '除權日');
    // Guard: normalizeDate('') falls back to today(), which would make every
    // row look like it ex-divides today (daily duplicate records + empty
    // pending list). An unparseable/missing date must yield '' so the row
    // is skipped instead.
    const exDate  = rawDate ? Utils.normalizeDate(rawDate) : '';

    // Actual payment date — when cash arrives in brokerage account.
    // TWSE TWT48U includes 現金股利發放日 for cash dividends.
    // Falls back to exDate when the field is absent (e.g. stock-only rows).
    const rawPayDate = _field(row, '現金股利發放日', '配息發放日', '發放日');
    const payDate    = rawPayDate ? Utils.normalizeDate(rawPayDate) : exDate;

    // cashPS: NT$ cash dividend per share.
    // stkPS:  NT$ stock dividend per share of par value (par = NT$10),
    //         so new shares = held × (stkPS / 10).
    const cashPS = parseFloat(_field(row, '每股配息', '現金股利') || '0') || 0;
    const stkPS  = parseFloat(_field(row, '無償配股率', '每股配股', '股票股利') || '0') || 0;

    return { sym, name, exDate, payDate, cashPS, stkPS };
  }

  // FinMind TaiwanStockDividend is the only free source with the actual cash
  // payment date (TWSE/TPEX/MOPS endpoints all lack it — verified live).
  // CORS is open and no token is needed at this volume (a few symbols, once/day).
  // Returns { 'sym_exDate': 'YYYY-MM-DD' }; on failure returns {} so callers
  // fall back to the ex-date.
  async function _fetchPayDates(symbols) {
    const syms = [...new Set(symbols)];
    const d = new Date(); d.setMonth(d.getMonth() - 6);
    const start = [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
    const map = {};
    for (const sym of syms) {
      try {
        const res  = await fetch('https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockDividend&data_id=' + encodeURIComponent(sym) + '&start_date=' + start);
        const json = await res.json();
        for (const rec of (json.data || [])) {
          if (rec.CashExDividendTradingDate && rec.CashDividendPaymentDate) {
            map[sym + '_' + rec.CashExDividendTradingDate] = rec.CashDividendPaymentDate;
          }
        }
      } catch { /* FinMind unreachable — records fall back to ex-date */ }
    }
    return map;
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

    // Skip the fetch if we already ran today AND have cached data.
    // If cache is empty (Worker was down last time), retry even on the same day.
    // The '|v2' suffix versions the check tag so a code update that changes the
    // fetch/injection logic forces one refetch even if today's run already happened.
    const checkTag = today + '|v2';
    const cachedRows = Store.getUpcomingTWDivs();
    if (localStorage.getItem(CHECK_DATE_KEY) === checkTag && cachedRows.length > 0) {
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
    } catch {
      // Worker not configured or unreachable — fall through to cached data.
    }

    if (rows.length === 0) rows = Store.getUpcomingTWDivs();
    if (rows.length === 0) {
      localStorage.setItem(CHECK_DATE_KEY, checkTag);
      return { created: 0, pending: [] };
    }

    // TWSE data has no cash payment date — fetch it from FinMind and inject it
    // into the rows as '現金股利發放日' so _normalize() resolves payDate from
    // the cached calendar everywhere (auto-create, dashboard pending card).
    const payMap = await _fetchPayDates(
      rows.map(r => _normalize(r).sym).filter(s => holdingMap[s])
    );
    for (const row of rows) {
      const { sym, exDate } = _normalize(row);
      const pay = payMap[sym + '_' + exDate];
      if (pay) row['現金股利發放日'] = pay;
    }
    Store.saveUpcomingTWDivs(rows);

    // Upgrade earlier auto-created records still dated with the ex-date
    // placeholder now that the actual payment date is known.
    for (const d of Store.getDividends('TW')) {
      if (d.source !== AUTO_SOURCE || !d.exDate || d.date !== d.exDate) continue;
      const pay = payMap[d.symbol + '_' + d.exDate];
      if (pay && pay !== d.date) {
        Store.updateDividend(d.id, { date: pay, note: '系統自動建立（日期為現金股利發放日）' });
      }
    }

    // Build a dedup set from already-auto-created dividend records to guarantee
    // idempotency if checkAndAutoCreate somehow runs more than once per day.
    // Build dedup set from BOTH the persisted done-key cache AND live dividend records.
    // The cache survives pull() overwriting fm_dividends; the live records cover the
    // case where the cache was cleared (e.g. localStorage wipe on a new device).
    const _storedDone = JSON.parse(localStorage.getItem(AUTO_DONE_KEY) || '[]');
    const doneKeys = new Set([
      ..._storedDone,
      ...Store.getDividends('TW')
        .filter(d => d.source === AUTO_SOURCE)
        .map(d => `${d.symbol}_${d.exDate || d.date}`),
    ]);

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
          date: payDate,   // actual cash payment date from FinMind; falls back to ex-date
          exDate: exDate,
          symbol: sym,
          name: name || sym,
          market: 'TW',
          cashTotal,
          stockShares,
          cashPerShare: cashPS,
          stockRatio: stkPS,
          holdingQuantity: h.quantity,
          note: payDate !== exDate
            ? '系統自動建立（日期為現金股利發放日）'
            : '系統自動建立（日期為除息日），請更新為實際發放日後儲存以計入收入',
          source: AUTO_SOURCE,
        });
        // Income transaction intentionally NOT created here — the payment date is
        // unknown (TWSE does not publish it). When the user edits this record and
        // sets the actual payment date, Modal._saveDiv will create the income entry.

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
    // Persist done keys so recurring runs (across days) skip already-created records
    // even when fm_dividends was overwritten by a server pull.
    localStorage.setItem(AUTO_DONE_KEY, JSON.stringify([...doneKeys]));
    localStorage.setItem(CHECK_DATE_KEY, checkTag);
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
        if (!sym || !exDate) return null;
        // Keep upcoming ex-dates (incl. today) AND already-ex'd rows whose cash
        // hasn't been paid yet, so this card matches the 台股 holdings alert
        // instead of claiming "no events" while the alert shows one.
        if (exDate < today && !(payDate && payDate >= today)) return null;
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

