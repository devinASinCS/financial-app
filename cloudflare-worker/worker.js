/**
 * Cloudflare Worker — Notion CORS proxy & backup storage
 *
 * Environment variables (set in Cloudflare dashboard → Settings → Variables):
 *   NOTION_TOKEN       — Notion integration secret  (e.g. "secret_xxx")
 *   NOTION_PAGE_ID     — ID of the Notion page used as backup storage
 *
 * Deploy with:
 *   npx wrangler deploy
 * or paste this file into the Cloudflare Workers online editor.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const NOTION_VERSION = '2022-06-28';
const CHUNK_SIZE     = 1900;   // chars per Notion paragraph block (max 2000)
const MAX_BLOCKS     = 100;    // Notion append limit per request

export default {
  async fetch(request, env) {
    // ── CORS preflight ──────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return jsonResp({ ok: false, error: 'Method not allowed' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResp({ ok: false, error: 'Invalid JSON body' }, 400);
    }

    const { action, data } = body;

    try {
      if (action === 'save') {
        await saveToNotion(data, env);
        return jsonResp({ ok: true, savedAt: new Date().toISOString() });
      }

      if (action === 'load') {
        const loaded = await loadFromNotion(env);
        return jsonResp({ ok: true, data: loaded });
      }

      if (action === 'ping') {
        // Simple connectivity test — verify env vars are set
        if (!env.NOTION_TOKEN || !env.NOTION_PAGE_ID) {
          return jsonResp({ ok: false, error: 'Worker env vars not configured' });
        }
        return jsonResp({ ok: true, message: 'Worker is reachable' });
      }

      if (action === 'stockPrices') {
        const { market, symbols } = body;
        if (!Array.isArray(symbols) || symbols.length === 0) {
          return jsonResp({ ok: false, error: 'symbols array required' }, 400);
        }
        const prices = await fetchStockPrices(market, symbols);
        return jsonResp({ ok: true, prices });
      }

      if (action === 'twDividends') {
        const dividends = await fetchTWSEDividends();
        return jsonResp({ ok: true, dividends });
      }

      if (action === 'stockName') {
        const { market, symbol } = body;
        if (!symbol) return jsonResp({ ok: false, error: 'symbol required' }, 400);
        const name = await fetchStockName(market, symbol);
        return jsonResp({ ok: !!name, name });
      }

      return jsonResp({ ok: false, error: `Unknown action: ${action}` }, 400);
    } catch (e) {
      return jsonResp({ ok: false, error: e.message }, 500);
    }
  },
};

// ── Helpers ──────────────────────────────────────────────────────────

function jsonResp(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function notionFetch(path, method, body, env) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      'Authorization':   `Bearer ${env.NOTION_TOKEN}`,
      'Content-Type':    'application/json',
      'Notion-Version':  NOTION_VERSION,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`Notion API error (${res.status}): ${text.slice(0, 200)}`); }
}

// Fetch ALL block children (handles pagination)
async function getAllBlocks(pageId, env) {
  const blocks = [];
  let cursor;
  do {
    const qs     = cursor ? `?start_cursor=${cursor}` : '';
    const result = await notionFetch(`/blocks/${pageId}/children${qs}`, 'GET', undefined, env);
    if (result.object === 'error') throw new Error(result.message);
    blocks.push(...(result.results || []));
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);
  return blocks;
}

// ── Save ─────────────────────────────────────────────────────────────

async function saveToNotion(data, env) {
  const pageId = env.NOTION_PAGE_ID;

  // 1. Delete (archive) all existing blocks
  const existing = await getAllBlocks(pageId, env);
  for (const block of existing) {
    await notionFetch(`/blocks/${block.id}`, 'DELETE', undefined, env);
  }

  // 2. Chunk the JSON string
  const json   = JSON.stringify({ ...data, _savedAt: new Date().toISOString() });
  const chunks = [];
  for (let i = 0; i < json.length; i += CHUNK_SIZE) {
    chunks.push(json.slice(i, i + CHUNK_SIZE));
  }

  // 3. Append in batches of MAX_BLOCKS
  for (let i = 0; i < chunks.length; i += MAX_BLOCKS) {
    const batch = chunks.slice(i, i + MAX_BLOCKS).map(chunk => ({
      object: 'block',
      type:   'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: chunk } }],
      },
    }));
    const result = await notionFetch(`/blocks/${pageId}/children`, 'PATCH', { children: batch }, env);
    if (result.object === 'error') throw new Error(result.message);
  }
}

// ── Stock Price Fetching ──────────────────────────────────────────────

/**
 * Fetch closing prices from Yahoo Finance for a list of symbols.
 * For TW stocks, tries .TW suffix first, then .TWO (OTC).
 * Also enriches with ex-dividend date from Yahoo quote API when available.
 */
async function fetchStockPrices(market, symbols) {
  const prices = {};

  await Promise.all(symbols.map(async symbol => {
    const suffixes = market === 'TW' ? ['.TW', '.TWO'] : [''];
    let priceData = null;

    for (const suffix of suffixes) {
      try {
        const yahooSym = symbol + suffix;
        const url = `https://query2.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1d&range=5d`;
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!r.ok) continue;

        const json = await r.json();
        const result = json.chart?.result?.[0];
        if (!result) continue;

        const meta = result.meta;
        const curr = meta.regularMarketPrice;
        const prev = meta.chartPreviousClose ?? meta.previousClose ?? curr;

        priceData = {
          price: curr,
          previousClose: prev,
          change: curr - prev,
          changePercent: prev ? (curr - prev) / prev * 100 : 0,
          currency: meta.currency,
          marketState: meta.marketState,
          yahooSymbol: yahooSym,
          fetchedAt: new Date().toISOString(),
        };
        break;
      } catch { continue; }
    }

    prices[symbol] = priceData || { error: 'Symbol not found', fetchedAt: new Date().toISOString() };
  }));

  // Enrich with ex-dividend date via Yahoo quote API (best effort)
  const validSymbols = symbols.filter(s => prices[s] && !prices[s].error);
  if (validSymbols.length > 0) {
    try {
      const yahooSyms = validSymbols.map(s => prices[s].yahooSymbol).join(',');
      const qr = await fetch(
        `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${yahooSyms}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      if (qr.ok) {
        const qd = await qr.json();
        for (const q of (qd.quoteResponse?.result || [])) {
          const sym = market === 'TW'
            ? q.symbol.replace(/\.(TW|TWO)$/i, '')
            : q.symbol;
          if (prices[sym]) {
            if (q.exDividendDate) {
              prices[sym].exDividendDate = new Date(q.exDividendDate * 1000).toISOString().slice(0, 10);
            }
            if (q.trailingAnnualDividendRate) {
              prices[sym].annualDividendRate = q.trailingAnnualDividendRate;
            }
          }
        }
      }
    } catch { /* quote API is optional — skip ex-dividend data if unavailable */ }
  }

  return prices;
}

/**
 * Fetch the display name for a single stock symbol from Yahoo Finance.
 * Returns the name string or null if not found.
 */
async function fetchStockName(market, symbol) {
  if (market === 'TW') {
    // TWSE/TPEX MIS API returns proper Chinese names
    for (const ex of ['tse', 'otc']) {
      try {
        const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${ex}_${symbol}.tw&json=1&delay=0`;
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!r.ok) continue;
        const json = await r.json();
        const name = json.msgArray?.[0]?.nf || json.msgArray?.[0]?.n;
        if (name) return name;
      } catch { continue; }
    }
  }

  // Yahoo Finance fallback (English for TW, primary for US)
  const suffixes = market === 'TW' ? ['.TW', '.TWO'] : [''];
  for (const suffix of suffixes) {
    try {
      const yahooSym = symbol + suffix;
      const url = `https://query2.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1d&range=1d`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) continue;
      const json = await r.json();
      const meta = json.chart?.result?.[0]?.meta;
      if (!meta) continue;
      const name = meta.longName || meta.shortName;
      if (name) return name;
    } catch { continue; }
  }
  return null;
}

/**
 * Fetch TWSE upcoming ex-dividend / ex-rights schedule.
 * Returns an array of objects keyed by the TWSE field names.
 */
async function fetchTWSEDividends() {
  try {
    const r = await fetch('https://www.twse.com.tw/rwd/zh/exRight/TWT48U?response=json', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!r.ok) return [];
    const json = await r.json();
    const fields = json.fields || [];
    return (json.data || []).map(row => {
      const obj = {};
      fields.forEach((f, i) => { obj[f] = row[i]; });
      return obj;
    });
  } catch { return []; }
}

// ── Load ─────────────────────────────────────────────────────────────

async function loadFromNotion(env) {
  const pageId = env.NOTION_PAGE_ID;
  const blocks = await getAllBlocks(pageId, env);

  if (blocks.length === 0) return null;

  // Concatenate text from all paragraph blocks
  const json = blocks
    .filter(b => b.type === 'paragraph')
    .map(b =>
      (b.paragraph.rich_text || [])
        .map(rt => rt.plain_text ?? rt.text?.content ?? '')
        .join('')
    )
    .join('');

  if (!json) return null;
  return JSON.parse(json);
}
