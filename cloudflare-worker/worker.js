/**
 * Cashio Cloudflare Worker — sync proxy + stock data
 *
 * Environment variables (Cloudflare dashboard → Settings → Variables):
 *   CASHIO_KV       — KV Namespace binding (recommended, zero subrequest limits)
 *                     Create a KV namespace in Cloudflare Dashboard → Workers & Pages → KV,
 *                     then bind it here as Variable name "CASHIO_KV".
 *
 *   NOTION_TOKEN    — (legacy) Notion integration secret, only used if CASHIO_KV is not bound
 *   NOTION_PAGE_ID  — (legacy) Notion page ID, only used if CASHIO_KV is not bound
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const NOTION_VERSION = '2022-06-28';
const CHUNK_SIZE     = 1900;
const MAX_BLOCKS     = 100;

export default {
  async fetch(request, env) {
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
        await saveData(data, env);
        return jsonResp({ ok: true, savedAt: new Date().toISOString() });
      }

      if (action === 'load') {
        const loaded = await loadData(env);
        return jsonResp({ ok: true, data: loaded });
      }

      if (action === 'ping') {
        const hasKV     = !!env.CASHIO_KV;
        const hasNotion = !!(env.NOTION_TOKEN && env.NOTION_PAGE_ID);
        if (!hasKV && !hasNotion) {
          return jsonResp({ ok: false, error: 'No storage configured. Bind CASHIO_KV or set NOTION_TOKEN + NOTION_PAGE_ID.' });
        }
        return jsonResp({ ok: true, message: 'Worker is reachable', storage: hasKV ? 'kv' : 'notion' });
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

      if (action === 'add_transaction') {
        // Optional secret guard — set ADD_TX_SECRET in Cloudflare Worker env vars
        if (env.ADD_TX_SECRET && body.secret !== env.ADD_TX_SECRET) {
          return jsonResp({ ok: false, error: 'Unauthorized' }, 403);
        }
        if (!env.CASHIO_KV) {
          return jsonResp({ ok: false, error: 'CASHIO_KV not configured' }, 500);
        }
        const tx = body.transaction;
        if (!tx || typeof tx.amount !== 'number' || !tx.date) {
          return jsonResp({ ok: false, error: 'transaction.amount (number) and transaction.date (YYYY-MM-DD) required' }, 400);
        }
        const raw  = await env.CASHIO_KV.get('backup');
        const data = raw ? JSON.parse(raw) : {};
        if (!Array.isArray(data.transactions)) data.transactions = [];

        const newTx = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          date:          tx.date,
          type:          'expense',
          amount:        tx.amount,
          category:      tx.category || '其他',
          note:          tx.note     || '',
          source:        'email_import',
          paymentMethod: 'credit_card',
          bankId:        tx.bankId   || null,
          cardId:        tx.cardId   || null,
          eventId:       null,
          foreignAmount: null, foreignCurrency: null, exchangeRate: null,
        };
        data.transactions.push(newTx);
        data._savedAt = new Date().toISOString();
        await env.CASHIO_KV.put('backup', JSON.stringify(data));
        return jsonResp({ ok: true, transaction: newTx });
      }

      return jsonResp({ ok: false, error: `Unknown action: ${action}` }, 400);
    } catch (e) {
      return jsonResp({ ok: false, error: e.message }, 500);
    }
  },
};

// ── Storage: KV (primary) or Notion blocks (legacy fallback) ──────────

async function saveData(data, env) {
  const payload = JSON.stringify({ ...data, _savedAt: new Date().toISOString() });

  if (env.CASHIO_KV) {
    // KV: single put, zero subrequests — recommended
    await env.CASHIO_KV.put('backup', payload);
    return;
  }

  // Legacy: Notion blocks (may hit subrequest limits if data is large)
  await saveToNotionBlocks(data, env);
}

async function loadData(env) {
  if (env.CASHIO_KV) {
    const raw = await env.CASHIO_KV.get('backup');
    if (!raw) return null;
    return JSON.parse(raw);
  }

  // Legacy: Notion blocks
  return loadFromNotionBlocks(env);
}

// ── Helpers ───────────────────────────────────────────────────────────

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
      'Authorization':  `Bearer ${env.NOTION_TOKEN}`,
      'Content-Type':   'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`Notion API error (${res.status}): ${text.slice(0, 200)}`); }
}

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

// ── Legacy Notion block storage ───────────────────────────────────────

async function saveToNotionBlocks(data, env) {
  if (!env.NOTION_TOKEN || !env.NOTION_PAGE_ID) {
    throw new Error('NOTION_TOKEN and NOTION_PAGE_ID are required when CASHIO_KV is not bound');
  }

  const pageId  = env.NOTION_PAGE_ID;
  const existing = await getAllBlocks(pageId, env);

  // Delete existing blocks (each is a separate subrequest — use KV to avoid this)
  for (const block of existing) {
    await notionFetch(`/blocks/${block.id}`, 'DELETE', undefined, env);
  }

  const json   = JSON.stringify({ ...data, _savedAt: new Date().toISOString() });
  const chunks = [];
  for (let i = 0; i < json.length; i += CHUNK_SIZE) {
    chunks.push(json.slice(i, i + CHUNK_SIZE));
  }

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

async function loadFromNotionBlocks(env) {
  if (!env.NOTION_TOKEN || !env.NOTION_PAGE_ID) return null;

  const pageId = env.NOTION_PAGE_ID;
  const blocks = await getAllBlocks(pageId, env);

  if (blocks.length === 0) return null;

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

// ── Stock Price Fetching ──────────────────────────────────────────────

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

        const json   = await r.json();
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
          const sym = market === 'TW' ? q.symbol.replace(/\.(TW|TWO)$/i, '') : q.symbol;
          if (prices[sym]) {
            if (q.exDividendDate)
              prices[sym].exDividendDate = new Date(q.exDividendDate * 1000).toISOString().slice(0, 10);
            if (q.trailingAnnualDividendRate)
              prices[sym].annualDividendRate = q.trailingAnnualDividendRate;
          }
        }
      }
    } catch { /* optional enrichment */ }
  }

  return prices;
}

async function fetchStockName(market, symbol) {
  if (market === 'TW') {
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

async function fetchTWSEDividends() {
  try {
    const r = await fetch('https://www.twse.com.tw/rwd/zh/exRight/TWT48U?response=json', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!r.ok) return [];
    const json   = await r.json();
    const fields = json.fields || [];
    return (json.data || []).map(row => {
      const obj = {};
      fields.forEach((f, i) => { obj[f] = row[i]; });
      return obj;
    });
  } catch { return []; }
}
