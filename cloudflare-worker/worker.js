/**
 * Cashio Cloudflare Worker v2 — multi-user auth + D1 storage + stock data
 *
 * Secrets (set via wrangler secret put):
 *   GOOGLE_CLIENT_ID      — OAuth client id
 *   GOOGLE_CLIENT_SECRET  — OAuth client secret
 *   ENCRYPTION_KEY        — 32+ char random string for AES-256-GCM
 *   INTERNAL_SECRET       — secret for /internal/gmail-token (used by GAS)
 *
 * Variables (wrangler.toml [vars]):
 *   FRONTEND_URL          — e.g. https://your-app.pages.dev
 *   WORKER_URL            — e.g. https://cashio-worker.your-sub.workers.dev
 */

// ── Constants ──────────────────────────────────────────────────────────────
const GOOGLE_AUTH    = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN   = 'https://oauth2.googleapis.com/token';
const GOOGLE_PROFILE = 'https://www.googleapis.com/oauth2/v3/userinfo';
const SESSION_TTL    = 30 * 24 * 60 * 60; // 30 days in seconds

const FM_KEYS = [
  'fm_transactions', 'fm_banks', 'fm_stock_trades', 'fm_dividends',
  'fm_subscriptions', 'fm_events', 'fm_settings',
];

// ── Entry point ────────────────────────────────────────────────────────────
export default {
  async fetch(req, env) {
    const url    = new URL(req.url);
    const path   = url.pathname;
    const method = req.method;

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }

    const json = (body, status = 200, extra = {}) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(req), ...extra },
      });

    try {
      // ── Public auth routes ───────────────────────────────────────────────
      if (path === '/auth/google')   return startOAuth(env);
      if (path === '/auth/callback') return handleCallback(req, url, env);

      // ── Internal route: fresh Gmail access token for GAS ────────────────
      if (path === '/internal/gmail-token') return gmailToken(req, url, env, json);

      // ── New REST routes (session cookie or Bearer api-key) ───────────────
      if (path === '/auth/logout') {
        return handleLogout(req, env);
      }
      if (path === '/auth/me' && method === 'GET') {
        const user = await sessionUser(req, env);
        if (!user) return json({ error: 'Unauthorized' }, 401);
        return json(user);
      }
      if (path === '/api/data') {
        const user = await sessionUser(req, env);
        if (!user) return json({ error: 'Unauthorized' }, 401);
        if (method === 'GET') return getData(user, env, json);
        if (method === 'PUT') return putData(user, req, env, json);
      }
      if (path === '/api/import' && method === 'POST') {
        const user = await sessionUser(req, env);
        if (!user) return json({ error: 'Unauthorized' }, 401);
        return importTx(user, req, env, json);
      }
      if (path === '/api/apikey') {
        const user = await sessionUser(req, env);
        if (!user) return json({ error: 'Unauthorized' }, 401);
        if (method === 'GET')    return listApiKeys(user, env, json);
        if (method === 'POST')   return createApiKey(user, env, json);
        if (method === 'DELETE') return deleteApiKey(user, req, env, json);
      }

      // ── Legacy action-based POST (backward compat with notion-sync.js) ───
      if (method === 'POST') {
        return handleLegacyAction(req, env, json);
      }

      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ ok: false, error: e.message }, 500);
    }
  },
};

// ── CORS ───────────────────────────────────────────────────────────────────
// Reflect the request origin so credentials work cross-origin.
// SameSite=Lax on session cookie prevents CSRF on mutations.
function corsHeaders(req) {
  const origin = req.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin':      origin,
    'Access-Control-Allow-Methods':     'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':     'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Vary':                             'Origin',
  };
}

// ── OAuth flow ─────────────────────────────────────────────────────────────
function startOAuth(env) {
  const params = new URLSearchParams({
    client_id:     env.GOOGLE_CLIENT_ID,
    redirect_uri:  env.WORKER_URL + '/auth/callback',
    response_type: 'code',
    scope:         'openid email profile https://www.googleapis.com/auth/gmail.readonly',
    access_type:   'offline',
    prompt:        'consent', // always return refresh_token
  });
  return Response.redirect(`${GOOGLE_AUTH}?${params}`, 302);
}

async function handleCallback(req, url, env) {
  const code = url.searchParams.get('code');
  if (!code) return Response.redirect(`${env.FRONTEND_URL}?error=no_code`, 302);

  // Exchange code → tokens
  const tokRes = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  env.WORKER_URL + '/auth/callback',
      grant_type:    'authorization_code',
    }),
  });
  const tok = await tokRes.json();
  if (!tok.access_token) return Response.redirect(`${env.FRONTEND_URL}?error=oauth_failed`, 302);

  // Fetch Google profile
  const profRes = await fetch(GOOGLE_PROFILE, {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  const prof = await profRes.json();

  // Encrypt refresh_token (only returned on first consent or re-consent)
  const encRefresh = tok.refresh_token
    ? await aesEncrypt(tok.refresh_token, env.ENCRYPTION_KEY)
    : null;

  // Upsert user — preserve existing refresh_token if Google didn't return a new one
  await env.DB.prepare(`
    INSERT INTO users (id, email, name, picture, refresh_token)
    VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT(id) DO UPDATE SET
      name          = excluded.name,
      picture       = excluded.picture,
      refresh_token = COALESCE(excluded.refresh_token, refresh_token)
  `).bind(prof.sub, prof.email, prof.name, prof.picture, encRefresh).run();

  // Create session
  const sid      = randHex(32);
  const expiry   = nowSec() + SESSION_TTL;
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?1, ?2, ?3)'
  ).bind(sid, prof.sub, expiry).run();

  return new Response(null, {
    status: 302,
    headers: {
      Location:     env.FRONTEND_URL,
      'Set-Cookie': sessionCookie(sid, SESSION_TTL),
    },
  });
}

async function handleLogout(req, env) {
  const sid = getCookie(req, 'session');
  if (sid) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
  return new Response(null, {
    status: 302,
    headers: {
      Location:     env.FRONTEND_URL + '#dashboard',
      'Set-Cookie': sessionCookie('', 0),
    },
  });
}

// ── Session resolution ─────────────────────────────────────────────────────
// Accepts: session cookie, or  Authorization: Bearer <api_key>
async function sessionUser(req, env) {
  // 1. Try Bearer API key (used by GAS and REST clients)
  const auth = req.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) {
    const key = auth.slice(7).trim();
    const row = await env.DB.prepare(`
      SELECT u.id, u.email, u.name, u.picture
      FROM api_keys ak JOIN users u ON ak.user_id = u.id
      WHERE ak.key = ?
    `).bind(key).first();
    if (row) return row;
  }

  // 2. Try session cookie
  const sid = getCookie(req, 'session');
  if (!sid) return null;

  const row = await env.DB.prepare(`
    SELECT u.id, u.email, u.name, u.picture
    FROM sessions s JOIN users u ON s.user_id = u.id
    WHERE s.id = ?1 AND s.expires_at > ?2
  `).bind(sid, nowSec()).first();
  return row || null;
}

// ── Data CRUD (new REST endpoints) ─────────────────────────────────────────
async function getData(user, env, json) {
  const rows = await env.DB.prepare(
    'SELECT key, value FROM user_data WHERE user_id = ?'
  ).bind(user.id).all();
  const data = {};
  for (const r of rows.results) {
    try { data[r.key] = JSON.parse(r.value); } catch {}
  }
  return json(data);
}

async function putData(user, req, env, json) {
  const body = await req.json();
  const ts   = nowSec();
  const stmt = env.DB.prepare(`
    INSERT INTO user_data (user_id, key, value, updated_at) VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const batch = Object.entries(body)
    .filter(([k]) => FM_KEYS.includes(k))
    .map(([k, v]) => stmt.bind(user.id, k, JSON.stringify(v), ts));
  if (batch.length) await env.DB.batch(batch);
  return json({ ok: true, saved: batch.length });
}

// ── Transaction import (called by GAS via Bearer api-key) ──────────────────
async function importTx(user, req, env, json) {
  const { transactions } = await req.json();
  if (!Array.isArray(transactions) || !transactions.length) {
    return json({ ok: true, imported: 0 });
  }
  const count = await _mergeTx(user.id, transactions, env);
  return json({ ok: true, imported: count });
}

async function _mergeTx(userId, newTxList, env) {
  const row     = await env.DB.prepare(
    "SELECT value FROM user_data WHERE user_id = ?1 AND key = 'fm_transactions'"
  ).bind(userId).first();
  const current  = row ? JSON.parse(row.value) : [];
  const existing = new Set(current.map(t => t.id));
  const added    = newTxList.filter(t => t.id && !existing.has(t.id));
  if (!added.length) return 0;
  const merged = [...current, ...added];
  await env.DB.prepare(`
    INSERT INTO user_data (user_id, key, value, updated_at) VALUES (?1, 'fm_transactions', ?2, ?3)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).bind(userId, JSON.stringify(merged), nowSec()).run();
  return added.length;
}

// ── API key management ─────────────────────────────────────────────────────
async function listApiKeys(user, env, json) {
  const rows = await env.DB.prepare(
    "SELECT substr(key,1,8)||'...' AS hint, label, created_at FROM api_keys WHERE user_id = ?"
  ).bind(user.id).all();
  return json(rows.results);
}

async function createApiKey(user, env, json) {
  const key = randHex(32);
  await env.DB.prepare(
    'INSERT INTO api_keys (key, user_id, label) VALUES (?1, ?2, ?3)'
  ).bind(key, user.id, 'GAS Import Key').run();
  return json({ ok: true, key }); // only time the raw key is shown
}

async function deleteApiKey(user, req, env, json) {
  const { key } = await req.json();
  await env.DB.prepare(
    'DELETE FROM api_keys WHERE key = ?1 AND user_id = ?2'
  ).bind(key, user.id).run();
  return json({ ok: true });
}

// ── Internal: get a fresh Gmail access_token for a given user (used by GAS) ─
async function gmailToken(req, url, env, json) {
  if (req.headers.get('Authorization') !== `Bearer ${env.INTERNAL_SECRET}`) {
    return json({ error: 'Forbidden' }, 403);
  }
  const email = url.searchParams.get('email');
  const user  = await env.DB.prepare(
    'SELECT refresh_token FROM users WHERE email = ?'
  ).bind(email).first();
  if (!user?.refresh_token) return json({ error: 'No stored token for this email' }, 404);

  const refreshToken = await aesDecrypt(user.refresh_token, env.ENCRYPTION_KEY);
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) return json({ error: 'Token refresh failed' }, 502);
  return json({ access_token: data.access_token, expires_in: data.expires_in });
}

// ── Legacy action handler (backward compat with notion-sync.js) ────────────
async function handleLegacyAction(req, env, json) {
  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const { action } = body;

  // ── Public actions (no auth) ─────────────────────────────────────────────
  if (action === 'ping') {
    return json({ ok: true, storage: 'd1', version: '2.0' });
  }
  if (action === 'stockPrices') {
    const { market, symbols } = body;
    if (!Array.isArray(symbols) || !symbols.length) {
      return json({ ok: false, error: 'symbols array required' }, 400);
    }
    const prices = await fetchStockPrices(market, symbols);
    return json({ ok: true, prices });
  }
  if (action === 'twDividends') {
    return json({ ok: true, dividends: await fetchTWSEDividends() });
  }
  if (action === 'stockName') {
    const { market, symbol } = body;
    if (!symbol) return json({ ok: false, error: 'symbol required' }, 400);
    const name = await fetchStockName(market, symbol);
    return json({ ok: !!name, name });
  }

  // ── Auth-required actions ─────────────────────────────────────────────────
  // session cookie (notion-sync.js sends credentials: include after update)
  // OR Bearer api-key (GAS scripts)
  // OR legacy body.apiKey / body.secret (GAS backward compat)
  let user = await sessionUser(req, env);

  if (!user && body.apiKey) {
    const row = await env.DB.prepare(`
      SELECT u.id, u.email, u.name, u.picture
      FROM api_keys ak JOIN users u ON ak.user_id = u.id
      WHERE ak.key = ?
    `).bind(body.apiKey).first();
    user = row || null;
  }

  if (action === 'save') {
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
    // Store entire export blob as a single key for backward compat
    await env.DB.prepare(`
      INSERT INTO user_data (user_id, key, value, updated_at) VALUES (?1, 'fm_notion_backup', ?2, ?3)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(user.id, JSON.stringify(body.data), nowSec()).run();
    return json({ ok: true, savedAt: new Date().toISOString() });
  }

  if (action === 'load') {
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
    const row = await env.DB.prepare(
      "SELECT value FROM user_data WHERE user_id = ?1 AND key = 'fm_notion_backup'"
    ).bind(user.id).first();
    return json({ ok: true, data: row ? JSON.parse(row.value) : null });
  }

  if (action === 'add_transactions' || action === 'add_transaction') {
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
    const rawList = action === 'add_transactions' ? body.transactions : [body.transaction];
    if (!Array.isArray(rawList) || !rawList.length) {
      return json({ ok: false, error: 'transactions required' }, 400);
    }
    // Build bankName → {bankId, cardId} lookup from user's stored bank data
    const banksRow = await env.DB.prepare(
      "SELECT value FROM user_data WHERE user_id = ?1 AND key = 'fm_banks'"
    ).bind(user.id).first();
    const banks = banksRow ? JSON.parse(banksRow.value) : [];
    const bankMap = {};
    for (const bank of banks) {
      const cc = (bank.creditCards || []).find(c => !c.type || c.type === 'credit');
      if (cc) bankMap[bank.name] = { bankId: bank.id, cardId: cc.id };
    }
    const ts = nowSec().toString(36);
    const txList = rawList
      .filter(tx => tx && typeof tx.amount === 'number' && tx.date)
      .map((tx, i) => {
        const resolved = (tx.bankName && bankMap[tx.bankName]) || {};
        return {
          id:            tx.id || ts + i.toString(36) + Math.random().toString(36).slice(2, 6),
          date:          tx.date,
          type:          'expense',
          amount:        tx.amount,
          category:      tx.category || '其他',
          note:          tx.note     || '',
          source:        'email_import',
          paymentMethod: 'credit_card',
          bankId:        tx.bankId   || resolved.bankId  || null,
          cardId:        tx.cardId   || resolved.cardId  || null,
          eventId:       null,
          foreignAmount: null, foreignCurrency: null, exchangeRate: null,
        };
      });
    const count = await _mergeTx(user.id, txList, env);
    return json({ ok: true, count });
  }

  if (action === 'queue_stock_pdf') {
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
    const queue = await _getPdfQueue(user.id, env);
    const item  = {
      id:        randHex(8),
      broker:    body.broker    || '未知券商',
      emailDate: body.emailDate,
      subject:   body.subject   || '',
      fileName:  body.fileName  || 'statement.pdf',
      pdfBase64: body.pdfBase64,
      addedAt:   new Date().toISOString(),
    };
    queue.push(item);
    await _savePdfQueue(user.id, queue, env);
    return json({ ok: true, id: item.id });
  }

  if (action === 'get_stock_pdf_queue') {
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
    const queue = await _getPdfQueue(user.id, env);
    const items = body.metaOnly
      ? queue.map(({ id, broker, emailDate, subject, fileName, addedAt }) =>
          ({ id, broker, emailDate, subject, fileName, addedAt }))
      : queue;
    return json({ ok: true, items });
  }

  if (action === 'clear_stock_pdf_item') {
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
    if (!body.itemId) return json({ ok: false, error: 'itemId required' }, 400);
    const queue   = await _getPdfQueue(user.id, env);
    const filtered = queue.filter(i => i.id !== body.itemId);
    await _savePdfQueue(user.id, filtered, env);
    return json({ ok: true, removed: queue.length - filtered.length });
  }

  if (action === 'clear_stock_pdf_items') {
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
    if (!Array.isArray(body.itemIds)) return json({ ok: false, error: 'itemIds required' }, 400);
    const queue   = await _getPdfQueue(user.id, env);
    const idSet   = new Set(body.itemIds);
    const filtered = queue.filter(i => !idSet.has(i.id));
    await _savePdfQueue(user.id, filtered, env);
    return json({ ok: true, removed: queue.length - filtered.length });
  }

  return json({ ok: false, error: `Unknown action: ${action}` }, 400);
}

// ── PDF queue helpers (stored per-user in D1) ──────────────────────────────
async function _getPdfQueue(userId, env) {
  const row = await env.DB.prepare(
    "SELECT value FROM user_data WHERE user_id = ?1 AND key = 'fm_pdf_queue'"
  ).bind(userId).first();
  return row ? JSON.parse(row.value) : [];
}

async function _savePdfQueue(userId, queue, env) {
  await env.DB.prepare(`
    INSERT INTO user_data (user_id, key, value, updated_at) VALUES (?1, 'fm_pdf_queue', ?2, ?3)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).bind(userId, JSON.stringify(queue), nowSec()).run();
}

// ── AES-256-GCM encryption ─────────────────────────────────────────────────
async function _keyMaterial(secret) {
  const raw = new TextEncoder().encode(secret.slice(0, 32).padEnd(32, '0'));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function aesEncrypt(plaintext, secret) {
  const key = await _keyMaterial(secret);
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
    new TextEncoder().encode(plaintext));
  const out = new Uint8Array(12 + enc.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(enc), 12);
  return btoa(String.fromCharCode(...out));
}

async function aesDecrypt(ciphertext, secret) {
  const key = await _keyMaterial(secret);
  const buf = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12));
  return new TextDecoder().decode(dec);
}

// ── Misc helpers ───────────────────────────────────────────────────────────
function randHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
function nowSec() { return Math.floor(Date.now() / 1000); }
function getCookie(req, name) {
  const m = (req.headers.get('Cookie') || '').match(
    new RegExp('(?:^|;\\s*)' + name + '=([^;]*)')
  );
  return m?.[1] ?? null;
}
function sessionCookie(val, maxAge) {
  return `session=${val}; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}; Path=/`;
}

// ── Stock price fetching (unchanged from v1) ───────────────────────────────
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
        const j      = await r.json();
        const result = j.chart?.result?.[0];
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

  const valid = symbols.filter(s => prices[s] && !prices[s].error);
  if (valid.length > 0) {
    try {
      const syms = valid.map(s => prices[s].yahooSymbol).join(',');
      const qr   = await fetch(
        `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${syms}`,
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
        const r   = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!r.ok) continue;
        const j    = await r.json();
        const name = j.msgArray?.[0]?.nf || j.msgArray?.[0]?.n;
        if (name) return name;
      } catch { continue; }
    }
  }
  const suffixes = market === 'TW' ? ['.TW', '.TWO'] : [''];
  for (const suffix of suffixes) {
    try {
      const r = await fetch(
        `https://query2.finance.yahoo.com/v8/finance/chart/${symbol + suffix}?interval=1d&range=1d`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      if (!r.ok) continue;
      const j    = await r.json();
      const meta = j.chart?.result?.[0]?.meta;
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
    const j      = await r.json();
    const fields = j.fields || [];
    return (j.data || []).map(row => {
      const obj = {};
      fields.forEach((f, i) => { obj[f] = row[i]; });
      return obj;
    });
  } catch { return []; }
}
