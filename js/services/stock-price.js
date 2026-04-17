/**
 * StockPrice — fetch and cache live stock prices + upcoming dividend data.
 *
 * Strategy:
 *  1. If a Cloudflare Worker URL is configured (fm_worker_url), use it as a
 *     server-side proxy — avoids CORS restrictions and supports TWSE API calls.
 *  2. Otherwise, attempt a direct fetch to Yahoo Finance v8 chart endpoint,
 *     which generally allows browser requests.
 *
 * Price data is cached in Store (fm_stock_prices) and considered stale after
 * CACHE_TTL_MS (default 6 hours).
 */
const StockPrice = (() => {
  const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

  // ── Internal helpers ────────────────────────────────────────────

  function _workerUrl() {
    // Same key that NotionSync uses — set via ⚙️ Settings → Worker URL field
    return (localStorage.getItem('fm_notion_worker_url') || '').trim();
  }

  async function _postWorker(action, payload = {}) {
    const url = _workerUrl();
    if (!url) {
      const err = new Error('Worker URL not configured');
      err.code = 'NO_WORKER';
      throw err;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    if (!res.ok) throw new Error(`Worker returned HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || `${action} failed`);
    return data;
  }

  /** Fallback: fetch directly from Yahoo Finance v8 chart API (no auth required). */
  async function _directYahoo(market, symbols) {
    const prices = {};
    const suffix = market === 'TW' ? '.TW' : '';

    await Promise.all(symbols.map(async sym => {
      try {
        const yahooSym = sym + suffix;
        const url = `https://query2.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1d&range=5d`;
        const r = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const json = await r.json();
        const meta = json.chart?.result?.[0]?.meta;
        if (!meta) throw new Error('No chart data');
        const curr = meta.regularMarketPrice;
        const prev = meta.chartPreviousClose ?? meta.previousClose ?? curr;
        prices[sym] = {
          price: curr,
          previousClose: prev,
          change: curr - prev,
          changePercent: prev ? (curr - prev) / prev * 100 : 0,
          currency: meta.currency,
          marketState: meta.marketState,
          fetchedAt: new Date().toISOString(),
        };
      } catch (e) {
        prices[sym] = { error: e.message, fetchedAt: new Date().toISOString() };
      }
    }));

    return prices;
  }

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Fetch current prices for an array of symbols in a given market ('TW' or 'US').
   * Returns { [symbol]: { price, change, changePercent, currency, exDividendDate?, error? } }
   *
   * Prefers the Cloudflare Worker proxy; falls back to direct Yahoo Finance.
   */
  async function fetchPrices(market, symbols) {
    if (!symbols || symbols.length === 0) return {};

    if (_workerUrl()) {
      try {
        const data = await _postWorker('stockPrices', { market, symbols });
        return data.prices;
      } catch (e) {
        if (e.code !== 'NO_WORKER') throw e;
      }
    }

    return _directYahoo(market, symbols);
  }

  /**
   * Fetch TWSE upcoming ex-dividend / ex-rights schedule, filtered to the
   * provided symbols. Requires the Cloudflare Worker (TWSE API has CORS restrictions).
   * Returns [] if the worker is not configured or the request fails.
   */
  async function fetchTWUpcomingDividends(symbols) {
    try {
      const data = await _postWorker('twDividends');
      const all = data.dividends || [];
      const set = new Set(symbols.map(String));
      return all.filter(d => {
        const sym = d['股票代號'] ?? d['代號'] ?? d['symbol'] ?? '';
        return set.has(String(sym));
      });
    } catch { return []; }
  }

  /**
   * Fetch the display name for a single stock symbol.
   * Returns a string name, or null if not found.
   * Uses Yahoo Finance v8 chart API directly (no worker required).
   */
  async function fetchStockName(market, symbol) {
    if (!symbol) return null;

    // Prefer worker proxy (avoids browser CORS issues)
    if (_workerUrl()) {
      try {
        const data = await _postWorker('stockName', { market, symbol });
        if (data.name) return data.name;
      } catch {}
    }

    // Direct Yahoo Finance fallback
    const suffixes = market === 'TW' ? ['.TW', '.TWO'] : [''];
    for (const suffix of suffixes) {
      try {
        const yahooSym = symbol + suffix;
        const url = `https://query2.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1d&range=1d`;
        const r = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!r.ok) continue;
        const json = await r.json();
        const meta = json.chart?.result?.[0]?.meta;
        if (!meta) continue;
        const name = market === 'TW'
          ? (meta.shortName || meta.longName)
          : (meta.longName || meta.shortName);
        if (name) return name;
      } catch { continue; }
    }
    return null;
  }

  /**
   * Whether the cached price for `symbol` is considered stale.
   * Always returns true if no price has been fetched yet.
   */
  function isCacheStale(symbol) {
    const p = Store.getStockPrices()[symbol];
    if (!p || p.error) return true;
    return Date.now() - new Date(p.fetchedAt || 0).getTime() > CACHE_TTL_MS;
  }

  /**
   * Whether the given market is currently in its regular trading session.
   * TW: 09:00–13:30 CST (UTC+8), Mon–Fri
   * US: 09:30–16:00 EDT (UTC-4, conservative estimate), Mon–Fri
   */
  function isMarketOpen(market) {
    const now = new Date();
    if (now.getUTCDay() === 0 || now.getUTCDay() === 6) return false; // weekend
    const h = now.getUTCHours();
    const m = now.getUTCMinutes();
    if (market === 'TW') {
      const minCST = ((h + 8) % 24) * 60 + m;
      return minCST >= 9 * 60 && minCST < 13 * 60 + 30;
    } else {
      let hEST = h - 4; if (hEST < 0) hEST += 24;
      const minEST = hEST * 60 + m;
      return minEST >= 9 * 60 + 30 && minEST < 16 * 60;
    }
  }

  return { fetchPrices, fetchStockName, fetchTWUpcomingDividends, isCacheStale, isMarketOpen };
})();
