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
  'fm_transactions', 'fm_deleted_tx_ids', 'fm_banks', 'fm_stock_trades', 'fm_dividends',
  'fm_subscriptions', 'fm_expense_events', 'fm_settings',
];

const GMAIL_SEARCH        = 'subject:(消費通知 OR 刷卡通知 OR 消費提醒 OR 信用卡消費 OR 消費明細 OR 消費彙整) newer_than:3d';
const GMAIL_SEARCH_MANUAL = 'subject:(消費通知 OR 刷卡通知 OR 消費提醒 OR 信用卡消費 OR 消費明細 OR 消費彙整) newer_than:30d';
const GMAIL_API    = 'https://gmail.googleapis.com/gmail/v1/users/me';

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
      if (path === '/debug/pdf-check' && method === 'GET') {
        const user = await sessionUser(req, env);
        if (!user) return json({ error: 'Unauthorized' }, 401);
        return debugPdfCheck(user, env, json);
      }
      if (path === '/debug/run-pdf-import' && method === 'GET') {
        const user = await sessionUser(req, env);
        if (!user) return json({ error: 'Unauthorized' }, 401);
        return debugRunPdfImport(user, env, json);
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
      if (path === '/api/import-email-now' && method === 'POST') {
        const user = await sessionUser(req, env);
        if (!user) return json({ error: 'Unauthorized' }, 401);
        return importEmailNow(user, env, json);
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

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledImport(env));
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
      Location:     `${env.FRONTEND_URL}#session=${sid}`,
      'Set-Cookie': sessionCookie(sid, SESSION_TTL),
    },
  });
}

async function handleLogout(req, env) {
  const bearer = (req.headers.get('Authorization') || '').startsWith('Bearer ')
    ? req.headers.get('Authorization').slice(7).trim() : null;
  const sid = getCookie(req, 'session') || bearer;
  if (sid) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(req), 'Set-Cookie': sessionCookie('', 0) },
  });
}

// ── Session resolution ─────────────────────────────────────────────────────
// Accepts: session cookie, Authorization: Bearer <session_id>, or Bearer <api_key>
async function sessionUser(req, env) {
  const auth = req.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) {
    const key = auth.slice(7).trim();
    // Try API key
    const apiRow = await env.DB.prepare(`
      SELECT u.id, u.email, u.name, u.picture
      FROM api_keys ak JOIN users u ON ak.user_id = u.id
      WHERE ak.key = ?
    `).bind(key).first();
    if (apiRow) return apiRow;
    // Try session token (used by mobile/Safari where cookies are blocked)
    const sessRow = await env.DB.prepare(`
      SELECT u.id, u.email, u.name, u.picture
      FROM sessions s JOIN users u ON s.user_id = u.id
      WHERE s.id = ?1 AND s.expires_at > ?2
    `).bind(key, nowSec()).first();
    if (sessRow) return sessRow;
  }

  // Fall back to session cookie (desktop browsers)
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
  const placeholders = FM_KEYS.map((_, i) => `?${i + 2}`).join(', ');
  const rows = await env.DB.prepare(
    `SELECT key, value FROM user_data WHERE user_id = ?1 AND key IN (${placeholders})`
  ).bind(user.id, ...FM_KEYS).all();
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

// ── Manual email import trigger ────────────────────────────────────────────
async function importEmailNow(user, env, json) {
  const row = await env.DB.prepare('SELECT refresh_token FROM users WHERE id = ?').bind(user.id).first();
  if (!row?.refresh_token) return json({ ok: false, error: 'no_token' }, 400);
  let token;
  try {
    token = await getGmailAccessToken(row.refresh_token, env);
  } catch (e) {
    const error = e.message === 'invalid_grant' ? 'reauth_required' : 'token_refresh_failed';
    return json({ ok: false, error }, 400);
  }
  // Clear processed IDs so past emails get re-scanned (safe: _mergeTx deduplicates by tx ID)
  await env.DB.prepare(
    "DELETE FROM user_data WHERE user_id = ?1 AND key = 'email_processed_ids'"
  ).bind(user.id).run();
  const before = await env.DB.prepare(
    "SELECT value FROM user_data WHERE user_id = ?1 AND key = 'fm_transactions'"
  ).bind(user.id).first();
  const beforeCount = before ? JSON.parse(before.value).filter(t => t.source === 'email_import').length : 0;
  const stats = await processUserEmails(user, token, env, GMAIL_SEARCH_MANUAL);
  const after = await env.DB.prepare(
    "SELECT value FROM user_data WHERE user_id = ?1 AND key = 'fm_transactions'"
  ).bind(user.id).first();
  const afterCount = after ? JSON.parse(after.value).filter(t => t.source === 'email_import').length : 0;
  return json({ ok: true, imported: afterCount - beforeCount, total: afterCount, debug: stats });
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
    const queue    = await _getPdfQueue(user.id, env);
    const filtered = queue.filter(i => i.id !== body.itemId);
    await _savePdfQueue(user.id, filtered, env);
    await env.DB.prepare('DELETE FROM user_data WHERE user_id = ?1 AND key = ?2')
      .bind(user.id, `fm_pdf_item_${body.itemId}`).run();
    return json({ ok: true, removed: queue.length - filtered.length });
  }

  if (action === 'clear_stock_pdf_items') {
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
    if (!Array.isArray(body.itemIds)) return json({ ok: false, error: 'itemIds required' }, 400);
    const queue    = await _getPdfQueue(user.id, env);
    const idSet    = new Set(body.itemIds);
    const filtered = queue.filter(i => !idSet.has(i.id));
    await _savePdfQueue(user.id, filtered, env);
    for (const id of body.itemIds) {
      await env.DB.prepare('DELETE FROM user_data WHERE user_id = ?1 AND key = ?2')
        .bind(user.id, `fm_pdf_item_${id}`).run();
    }
    return json({ ok: true, removed: queue.length - filtered.length });
  }

  return json({ ok: false, error: `Unknown action: ${action}` }, 400);
}

// ── PDF queue helpers (stored per-user in D1) ──────────────────────────────
async function _getPdfQueue(userId, env) {
  const indexRow = await env.DB.prepare(
    "SELECT value FROM user_data WHERE user_id = ?1 AND key = 'fm_pdf_queue'"
  ).bind(userId).first();
  const index = indexRow ? JSON.parse(indexRow.value) : [];
  if (!index.length) return [];
  // Fetch pdfBase64 for each item from its own row (avoids SQLITE_TOOBIG)
  const result = [];
  for (const meta of index) {
    const itemRow = await env.DB.prepare(
      "SELECT value FROM user_data WHERE user_id = ?1 AND key = ?2"
    ).bind(userId, `fm_pdf_item_${meta.id}`).first();
    result.push({ ...meta, pdfBase64: itemRow ? JSON.parse(itemRow.value) : '' });
  }
  return result;
}

async function _savePdfQueue(userId, queue, env) {
  // Index row stores metadata only — no base64
  const index = queue.map(({ pdfBase64: _pdf, ...meta }) => meta);
  await env.DB.prepare(`
    INSERT INTO user_data (user_id, key, value, updated_at) VALUES (?1, 'fm_pdf_queue', ?2, ?3)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).bind(userId, JSON.stringify(index), nowSec()).run();
  // Each PDF stored in its own row
  for (const item of queue) {
    if (!item.pdfBase64) continue;
    await env.DB.prepare(`
      INSERT INTO user_data (user_id, key, value, updated_at) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(userId, `fm_pdf_item_${item.id}`, JSON.stringify(item.pdfBase64), nowSec()).run();
  }
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

// ── Scheduled import (email transactions + stock PDFs) ─────────────────────
async function runScheduledImport(env) {
  const users = await env.DB.prepare(
    'SELECT id, refresh_token FROM users WHERE refresh_token IS NOT NULL'
  ).all();
  for (const user of users.results) {
    try {
      const token = await getGmailAccessToken(user.refresh_token, env);
      await Promise.allSettled([
        processUserEmails(user, token, env),
        processUserStockPdfs(user, token, env),
      ]);
    } catch { /* skip failed user */ }
  }
}

async function processUserEmails(user, accessToken, env, search = GMAIL_SEARCH) {

  const row = await env.DB.prepare(
    "SELECT value FROM user_data WHERE user_id = ?1 AND key = 'email_processed_ids'"
  ).bind(user.id).first();
  const processedIds = new Set(row ? JSON.parse(row.value) : []);

  const messages = await searchGmailMessages(accessToken, search);
  const allTxs   = [];
  const newIds   = [];

  for (const { id: msgId } of messages) {
    if (processedIds.has(msgId)) continue;
    newIds.push(msgId);
    try {
      const msg = await getGmailMessage(accessToken, msgId);
      allTxs.push(...parseGmailMessage(msg));
    } catch { /* skip unparseable message */ }
  }

  if (newIds.length) {
    const allIds = [...processedIds, ...newIds].slice(-1000);
    await env.DB.prepare(`
      INSERT INTO user_data (user_id, key, value, updated_at) VALUES (?1, 'email_processed_ids', ?2, ?3)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(user.id, JSON.stringify(allIds), nowSec()).run();
  }

  if (!allTxs.length) return { messagesFound: messages.length, newMessages: newIds.length, parsed: 0 };

  const banksRow = await env.DB.prepare(
    "SELECT value FROM user_data WHERE user_id = ?1 AND key = 'fm_banks'"
  ).bind(user.id).first();
  const banks  = banksRow ? JSON.parse(banksRow.value) : [];
  const bankMap = {};
  for (const bank of banks) {
    const cc = (bank.creditCards || []).find(c => !c.type || c.type === 'credit');
    if (cc) bankMap[bank.name] = { bankId: bank.id, cardId: cc.id };
  }

  const txList = allTxs.map((tx) => {
    const resolved = (tx.bankName && bankMap[tx.bankName]) || {};
    const noteSlug = (tx.note || '').trim().slice(0, 15).replace(/\W/g, '_');
    return {
      id:            `ei_${tx.date}_${tx.amount}_${noteSlug}`,
      date:          tx.date,
      type:          'expense',
      amount:        tx.amount,
      category:      tx.category,
      note:          tx.note,
      source:        'email_import',
      paymentMethod: 'credit_card',
      bankId:        resolved.bankId  || null,
      cardId:        resolved.cardId  || null,
      eventId:       null,
      foreignAmount: null, foreignCurrency: null, exchangeRate: null,
    };
  });
  await _mergeTx(user.id, txList, env);
  return { messagesFound: messages.length, newMessages: newIds.length, parsed: allTxs.length };
}

const STOCK_PDF_SEARCH = '(subject:證券日對帳單 OR subject:買賣報告書) has:attachment newer_than:35d';
const MAX_PDF_BYTES    = 700_000; // ~950KB base64 — stay under D1 1MB row limit

async function processUserStockPdfs(user, accessToken, env) {
  const row = await env.DB.prepare(
    "SELECT value FROM user_data WHERE user_id = ?1 AND key = 'stock_pdf_processed_ids'"
  ).bind(user.id).first();
  const processedIds = new Set(row ? JSON.parse(row.value) : []);

  const messages = await searchGmailMessages(accessToken, STOCK_PDF_SEARCH);
  const queue    = await _getPdfQueue(user.id, env);
  const newIds   = [];

  for (const { id: msgId } of messages) {
    if (processedIds.has(msgId)) continue;
    newIds.push(msgId);
    try {
      const msg     = await getGmailMessage(accessToken, msgId);
      const headers = msg.payload?.headers || [];
      const from    = headers.find(h => h.name === 'From')?.value || '';
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      const date    = emailToDateStr(new Date(parseInt(msg.internalDate)));
      const broker  = _detectBrokerFromEmail(from, subject);

      const pdfs = _findPdfParts(msg.payload);
      for (const part of pdfs) {
        if ((part.body?.size || 0) > MAX_PDF_BYTES) continue;
        let rawB64;
        if (part.body.attachmentId) {
          const attRes = await fetch(
            `${GMAIL_API}/messages/${msgId}/attachments/${part.body.attachmentId}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (!attRes.ok) continue;
          const attData = await attRes.json();
          rawB64 = attData.data;
        } else {
          rawB64 = part.body.data;
        }
        if (!rawB64) continue;
        queue.push({
          id:        randHex(8),
          broker,
          emailDate: date,
          subject,
          fileName:  part.filename || 'statement.pdf',
          pdfBase64: rawB64.replace(/-/g, '+').replace(/_/g, '/'),
          addedAt:   new Date().toISOString(),
        });
      }
    } catch { /* skip unparseable message */ }
  }

  if (newIds.length) {
    const allIds = [...processedIds, ...newIds].slice(-500);
    await env.DB.prepare(`
      INSERT INTO user_data (user_id, key, value, updated_at) VALUES (?1, 'stock_pdf_processed_ids', ?2, ?3)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(user.id, JSON.stringify(allIds), nowSec()).run();
    await _savePdfQueue(user.id, queue, env);
  }
}

function _findPdfParts(payload, found = []) {
  if (!payload) return found;
  const isPdf = payload.mimeType === 'application/pdf'
    || payload.mimeType === 'application/octet-stream'
    || (payload.filename || '').toLowerCase().endsWith('.pdf');
  if (isPdf && (payload.body?.attachmentId || payload.body?.data)) {
    found.push(payload);
  }
  for (const part of (payload.parts || [])) _findPdfParts(part, found);
  return found;
}

function _detectBrokerFromEmail(from, subject) {
  const s = (from + ' ' + subject).toLowerCase();
  if (/yuanta|元大/.test(s))    return '元大證券';
  if (/fubon|富邦/.test(s))      return '富邦證券';
  if (/sinopac|永豐/.test(s))    return '永豐金證券';
  if (/kgi|凱基/.test(s))        return '凱基證券';
  if (/cathay|國泰/.test(s))     return '國泰證券';
  if (/firstsec|第一金/.test(s)) return '第一金證券';
  if (/masterlink|群益/.test(s)) return '群益證券';
  if (/interactivebrokers|ib\.com/.test(s)) return 'Interactive Brokers';
  return '未知券商';
}

async function debugRunPdfImport(user, env, json) {
  const row = await env.DB.prepare('SELECT refresh_token FROM users WHERE id = ?').bind(user.id).first();
  if (!row?.refresh_token) return json({ error: 'no refresh_token' });
  let token;
  try { token = await getGmailAccessToken(row.refresh_token, env); }
  catch (e) { return json({ error: e.message }); }

  const processedRow = await env.DB.prepare(
    "SELECT value FROM user_data WHERE user_id = ?1 AND key = 'stock_pdf_processed_ids'"
  ).bind(user.id).first();
  const processedIds = new Set(processedRow ? JSON.parse(processedRow.value) : []);

  const messages = await searchGmailMessages(token, STOCK_PDF_SEARCH);
  const newMsgs = messages.filter(m => !processedIds.has(m.id));

  const steps = [];
  let queued = 0;

  for (const { id: msgId } of newMsgs) {
    const step = { msgId, pdfsFound: 0, pdfsQueued: 0, error: null };
    try {
      const msg   = await getGmailMessage(token, msgId);
      const pdfs  = _findPdfParts(msg.payload);
      step.pdfsFound = pdfs.length;
      for (const part of pdfs) {
        const size = part.body?.size || 0;
        if (size > MAX_PDF_BYTES) { step.error = `size ${size} > MAX`; continue; }
        let rawB64;
        if (part.body.attachmentId) {
          const attRes = await fetch(
            `${GMAIL_API}/messages/${msgId}/attachments/${part.body.attachmentId}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!attRes.ok) { step.error = `attachment fetch ${attRes.status}`; continue; }
          rawB64 = (await attRes.json()).data;
        } else {
          rawB64 = part.body.data;
        }
        if (!rawB64) { step.error = 'rawB64 empty'; continue; }
        step.pdfsQueued++;
        queued++;
      }
    } catch(e) {
      step.error = e.message;
    }
    steps.push(step);
  }

  // Now actually save
  let saveError = null;
  if (queued > 0) {
    try {
      await processUserStockPdfs({ id: user.id }, token, env);
    } catch(e) {
      saveError = e.message;
    }
  }

  return json({ totalFound: messages.length, newUnprocessed: newMsgs.length, queued, saveError, steps });
}

async function debugPdfCheck(user, env, json) {
  const row = await env.DB.prepare('SELECT refresh_token FROM users WHERE id = ?').bind(user.id).first();
  if (!row?.refresh_token) return json({ error: 'no refresh_token' });
  let token;
  try { token = await getGmailAccessToken(row.refresh_token, env); }
  catch (e) { return json({ error: e.message }); }

  const messages = await searchGmailMessages(token, STOCK_PDF_SEARCH);
  if (!messages.length) return json({ found: 0, query: STOCK_PDF_SEARCH });

  const msg = await getGmailMessage(token, messages[0].id);
  function summarizeParts(payload) {
    if (!payload) return null;
    const node = {
      mimeType: payload.mimeType,
      filename: payload.filename || null,
      bodySize: payload.body?.size || 0,
      hasAttachmentId: !!payload.body?.attachmentId,
      hasBodyData: !!(payload.body?.data),
    };
    if (payload.parts?.length) node.parts = payload.parts.map(p => summarizeParts(p));
    return node;
  }
  const headers = msg.payload?.headers || [];

  // Try downloading the first PDF attachment found
  const pdfs = _findPdfParts(msg.payload);
  let attachmentTest = null;
  if (pdfs.length > 0) {
    const part = pdfs[0];
    try {
      if (part.body?.attachmentId) {
        const attRes = await fetch(
          `${GMAIL_API}/messages/${messages[0].id}/attachments/${part.body.attachmentId}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const status = attRes.status;
        const attData = attRes.ok ? await attRes.json() : null;
        attachmentTest = { status, dataLen: attData?.data?.length || 0, filename: part.filename };
      } else if (part.body?.data) {
        attachmentTest = { status: 'inline', dataLen: part.body.data.length, filename: part.filename };
      }
    } catch(e) {
      attachmentTest = { error: e.message };
    }
  }

  return json({
    found: messages.length,
    firstMsgId: messages[0].id,
    subject: headers.find(h => h.name === 'Subject')?.value,
    from: headers.find(h => h.name === 'From')?.value,
    pdfPartsFound: pdfs.length,
    attachmentTest,
    mimeTree: summarizeParts(msg.payload),
  });
}

async function getGmailAccessToken(encryptedRefreshToken, env) {
  const refreshToken = await aesDecrypt(encryptedRefreshToken, env.ENCRYPTION_KEY);
  const res  = await fetch(GOOGLE_TOKEN, {
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
  if (!data.access_token) throw new Error(data.error || 'token_refresh_failed');
  return data.access_token;
}

async function searchGmailMessages(accessToken, query) {
  const url = `${GMAIL_API}/messages?q=${encodeURIComponent(query)}&maxResults=50`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 401 || res.status === 403) throw new Error(`gmail_auth_error:${res.status}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.messages || [];
}

async function getGmailMessage(accessToken, msgId) {
  const res = await fetch(`${GMAIL_API}/messages/${msgId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail API ${res.status}`);
  return res.json();
}

// Bank HTML email is authoritative — prefer HTML over plain text (plain is often truncated)
function extractPlainBody(payload) {
  return _extractHtml(payload) || _extractPlainText(payload);
}
function _extractHtml(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return _decodeBase64url(payload.body.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  }
  for (const part of (payload.parts || [])) {
    const t = _extractHtml(part);
    if (t) return t;
  }
  return '';
}
function _extractPlainText(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return _decodeBase64url(payload.body.data);
  }
  for (const part of (payload.parts || [])) {
    const t = _extractPlainText(part);
    if (t) return t;
  }
  return '';
}

function _decodeBase64url(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
  const bytes  = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function parseGmailMessage(msg) {
  const headers = msg.payload?.headers || [];
  const from    = (headers.find(h => h.name === 'From')?.value || '').toLowerCase();
  const subject = headers.find(h => h.name === 'Subject')?.value || '';
  const body    = extractPlainBody(msg.payload);
  const date    = new Date(parseInt(msg.internalDate));

  for (const parser of EMAIL_BANK_PARSERS) {
    if (parser.senderMatch(from) || parser.subjectMatch(subject)) {
      const results = parser.parse(body, subject, date);
      if (results.length > 0) return results;
    }
  }
  return emailParseGeneric(body, subject, date);
}

// ── Email category maps ─────────────────────────────────────────────────────
const EMAIL_CATEGORY_MAP = {
  '7-ELEVEN|全家|FamilyMart|萊爾富|OK便利|超商':         '購物',
  '麥當勞|McDonald|KFC|肯德基|摩斯|漢堡王|Burger King':  '餐飲',
  '星巴克|Starbucks|路易莎|Louisa|cama|咖啡|飲料':       '餐飲',
  '餐廳|飯店|食堂|小吃|火鍋|燒肉|牛排|拉麵|壽司|便當':  '餐飲',
  '誠品|博客來|momo|蝦皮|Shopee|PChome|Yahoo購物|蔦屋':  '購物',
  '中油|台塑|加油|油站|CPC':                             '交通',
  '捷運|MRT|高鐵|THSR|台鐵|TRA|公車|Uber|計程車':       '交通',
  'Apple|Google Play|App Store|Netflix|Spotify|YouTube': '訂閱',
  '藥局|藥妝|屈臣氏|Watsons|康是美|Cosmed':              '醫療',
  '全聯|家樂福|Carrefour|大潤發|COSTCO|好市多|愛買':     '購物',
  '電費|水費|瓦斯|電信|中華電信|台哥大|遠傳|台電':       '水電費',
};

const EMAIL_CATEGORY_HINT_MAP = {
  '餐廳|餐飲|飲食|美食|外食|Food':               '餐飲',
  '購物|零售|網購|百貨|超市|超商|量販|Retail':    '購物',
  '交通|運輸|加油|停車|Transport':               '交通',
  '醫療|藥局|診所|醫院|健康|Health':             '醫療',
  '娛樂|休閒|電影|KTV|遊戲|Entertainment':       '娛樂',
  '訂閱|訂購|線上服務|串流|Subscription':         '訂閱',
  '水電|公用|繳費|電信|Utility':                 '水電費',
  '旅遊|住宿|飯店|機票|Travel':                  '旅遊住宿',
};

// ── Bank parsers (ported from gas-email-importer.gs) ───────────────────────
const EMAIL_BANK_PARSERS = [
  {
    name: '國泰世華',
    senderMatch:  f => /cathaylife|cathaybk|cathayunited|cathay-united/i.test(f),
    subjectMatch: s => /國泰|Cathay/i.test(s) && /消費|刷卡/i.test(s),
    parse(body, subject, date) {
      const blocks = emailSmartSplit(body,
        ['卡別[\\s　]+行動卡號', '消費時間[：:]', '交易時間[：:]'],
        ['NT\\$\\s*[\\d,]+']
      );
      return emailParseBlocks(blocks, date, {
        amountRe:   [/消費金額[：:]\s*NT\$?\s*([\d,]+)/i, /NT\$\s*([\d,]+)/i],
        merchantRe: [/消費特店[：:]\s*(.+)/i, /消費商店[：:]\s*(.+)/i, /消費地點[：:]\s*(.+)/i, /NT\$[\d,]+\s+([^\n\r]+)/i],
        dateRe:     [/消費時間[：:]\s*(\d{4}\/\d{2}\/\d{2})/i, /交易時間[：:]\s*(\d{4}\/\d{2}\/\d{2})/i, /消費時間[：:]\s*(\d{3}\/\d{2}\/\d{2})/i, /交易時間[：:]\s*(\d{3}\/\d{2}\/\d{2})/i, /(\d{4}\/\d{2}\/\d{2})/, /(\d{3}\/\d{2}\/\d{2})/],
      }, this.name);
    },
  },
  {
    name: '玉山銀行',
    senderMatch:  f => /esunbank|e\.sun|esun\.com/i.test(f),
    subjectMatch: s => /玉山/i.test(s) && /消費|刷卡/i.test(s),
    parse(body, subject, date) {
      const blocks = emailSmartSplit(body, ['消費時間\\s', '交易日期\\s'], ['消費金額\\s']);
      return emailParseBlocks(blocks, date, {
        amountRe:   [/消費金額\s*NT\$?\s*([\d,]+)/i, /NT\$\s*([\d,]+)/i],
        merchantRe: [/消費商店\s+(.+)/i, /特店名稱\s+(.+)/i, /消費店家\s+(.+)/i],
        dateRe:     [/消費時間\s+(\d{4}\/\d{2}\/\d{2})/i, /交易日期\s+(\d{4}\/\d{2}\/\d{2})/i, /消費時間\s+(\d{3}\/\d{2}\/\d{2})/i, /交易日期\s+(\d{3}\/\d{2}\/\d{2})/i, /(\d{3}\/\d{2}\/\d{2})/],
      }, this.name);
    },
  },
  {
    name: '中信銀行',
    senderMatch:  f => /ctbcbank|ctbc|chinatrust/i.test(f),
    subjectMatch: s => /中信|中國信託/i.test(s) && /消費|刷卡/i.test(s),
    parse(body, subject, date) {
      const blocks = emailSmartSplit(body, ['消費日期[：:]', '交易日期[：:]', '消費時間[：:]'], ['消費金額[：:]', '金額[：:]']);
      return emailParseBlocks(blocks, date, {
        amountRe:   [/消費金額[：:]\s*NT\$?\s*([\d,]+)/i, /金額[：:]\s*NT\$?\s*([\d,]+)/i, /NT\$?\s*([\d,]+)/i],
        merchantRe: [/消費地點[：:]\s*(.+)/i, /特店[：:]\s*(.+)/i, /商店[：:]\s*(.+)/i],
        dateRe:     [/消費日期[：:]\s*(\d{4}\/\d{2}\/\d{2})/i, /交易日期[：:]\s*(\d{4}\/\d{2}\/\d{2})/i, /消費日期[：:]\s*(\d{3}\/\d{2}\/\d{2})/i, /交易日期[：:]\s*(\d{3}\/\d{2}\/\d{2})/i, /(\d{3}\/\d{2}\/\d{2})/, /(\d{2}-\d{2})/],
        inferYear:  true,
      }, this.name);
    },
  },
  {
    name: '台新銀行',
    senderMatch:  f => /taishinbank|taishin/i.test(f),
    subjectMatch: s => /台新/i.test(s) && /消費|刷卡/i.test(s),
    parse(body, subject, date) {
      const blocks = emailSmartSplit(body, ['交易時間[：:]', '消費時間[：:]'], ['消費金額[：:]']);
      return emailParseBlocks(blocks, date, {
        amountRe:   [/消費金額[：:]\s*NTD?\s*([\d,]+)/i, /NT\$\s*([\d,]+)/i, /NTD\s*([\d,]+)/i],
        merchantRe: [/消費商店[：:]\s*(.+)/i, /交易商店[：:]\s*(.+)/i],
        dateRe:     [/交易時間[：:]\s*(\d{4}-\d{2}-\d{2})/i, /(\d{4}\/\d{2}\/\d{2})/i, /(\d{4}-\d{2}-\d{2})/i, /(\d{3}\/\d{2}\/\d{2})/],
      }, this.name);
    },
  },
  {
    name: '富邦銀行',
    senderMatch:  f => /fubon|taipeibank|tpfubon/i.test(f),
    subjectMatch: s => /富邦/i.test(s) && /消費|刷卡/i.test(s),
    parse(body, subject, date) {
      const blocks = emailSmartSplit(body, ['消費日期[：:]', '交易日期[：:]'], ['消費金額[：:]']);
      return emailParseBlocks(blocks, date, {
        amountRe:   [/消費金額[：:]\s*NT\$?\s*([\d,]+)/i, /NT\$\s*([\d,]+)/i],
        merchantRe: [/消費商店[：:]\s*(.+)/i, /消費地點[：:]\s*(.+)/i],
        dateRe:     [/消費日期[：:]\s*(\d{4}\/\d{2}\/\d{2})/i, /交易日期[：:]\s*(\d{4}\/\d{2}\/\d{2})/i, /消費日期[：:]\s*(\d{3}\/\d{2}\/\d{2})/i, /交易日期[：:]\s*(\d{3}\/\d{2}\/\d{2})/i, /(\d{3}\/\d{2}\/\d{2})/],
      }, this.name);
    },
  },
  {
    name: '永豐銀行',
    senderMatch:  f => /sinopac|banksinopac/i.test(f),
    subjectMatch: s => /永豐/i.test(s) && /消費|刷卡/i.test(s),
    parse(body, subject, date) {
      const blocks = emailSmartSplit(body, ['消費日期[：:]', '交易日期[：:]'], ['消費金額[：:]']);
      return emailParseBlocks(blocks, date, {
        amountRe:   [/消費金額[：:]\s*NT\$?\s*([\d,]+)/i, /NT\$\s*([\d,]+)/i],
        merchantRe: [/消費商店[：:]\s*(.+)/i, /商店名稱[：:]\s*(.+)/i],
        dateRe:     [/消費日期[：:]\s*(\d{4}\/\d{2}\/\d{2})/i, /消費日期[：:]\s*(\d{3}\/\d{2}\/\d{2})/i, /(\d{3}\/\d{2}\/\d{2})/],
      }, this.name);
    },
  },
  {
    name: '聯邦銀行',
    senderMatch:  f => /unibank|unionbank/i.test(f),
    subjectMatch: s => /聯邦/i.test(s) && /消費|刷卡/i.test(s),
    parse(body, subject, date) {
      const blocks = emailSmartSplit(body, ['消費日期[：:]', '消費時間[：:]'], ['消費金額[：:]']);
      return emailParseBlocks(blocks, date, {
        amountRe:   [/消費金額[：:]\s*NT\$?\s*([\d,]+)/i, /NT\$\s*([\d,]+)/i],
        merchantRe: [/消費商店[：:]\s*(.+)/i],
        dateRe:     [/消費日期[：:]\s*(\d{4}\/\d{2}\/\d{2})/i, /消費日期[：:]\s*(\d{3}\/\d{2}\/\d{2})/i, /(\d{3}\/\d{2}\/\d{2})/],
      }, this.name);
    },
  },
  {
    name: 'LINE Pay',
    senderMatch:  f => /linepay|line\.me|jkopay/i.test(f),
    subjectMatch: s => /LINE Pay|街口|全支付/i.test(s),
    parse(body, subject, date) {
      const blocks = emailSmartSplit(body, ['交易時間[：:]', '付款時間[：:]'], ['NT\\$\\s*[\\d,]+']);
      return emailParseBlocks(blocks, date, {
        amountRe:   [/NT\$\s*([\d,]+)/i, /消費金額\s*([\d,]+)/i, /付款金額\s*([\d,]+)/i],
        merchantRe: [/消費店家[：:]\s*(.+)/i, /付款至[：:]\s*(.+)/i, /交易商店[：:]\s*(.+)/i],
        dateRe:     [/交易時間[：:]\s*(\d{4}[-\/]\d{2}[-\/]\d{2})/i, /(\d{4}-\d{2}-\d{2})/i, /(\d{3}\/\d{2}\/\d{2})/],
      }, this.name);
    },
  },
];

function emailParseGeneric(body, subject, date) {
  if (!/消費|刷卡|信用卡/.test(subject + body)) return [];
  const blocks = emailSmartSplit(body,
    ['消費時間[：:]', '交易時間[：:]', '消費日期[：:]', '交易日期[：:]'],
    ['消費金額[：:]', 'NT\\$\\s*[\\d,]+']
  );
  return emailParseBlocks(blocks, date, {
    amountRe:   [/消費金額[：:\s]*NT\$?\s*([\d,]+)/i, /NT\$\s*([\d,]+)/i, /NTD\s*([\d,]+)/i, /新台幣\s*([\d,]+)\s*元/i, /金額[：:\s]*\$?\s*([\d,]+)/i],
    merchantRe: [/消費特店[：:]\s*(.+)/i, /消費商店[：:]\s*(.+)/i, /消費地點[：:]\s*(.+)/i, /特店[：:]\s*(.+)/i, /商店[：:]\s*(.+)/i],
    dateRe:     [/(\d{4}\/\d{2}\/\d{2})/, /(\d{4}-\d{2}-\d{2})/, /(\d{3}\/\d{2}\/\d{2})/],
  });
}

function emailSmartSplit(body, timeAnchors, amountAnchors) {
  for (const anchor of timeAnchors) {
    const blocks = emailSplitByPattern(body, anchor);
    if (blocks.length >= 2) return blocks;
  }
  for (const anchor of (amountAnchors || [])) {
    const blocks = emailSplitByPattern(body, anchor);
    if (blocks.length >= 2) return blocks;
  }
  return [body];
}

function emailSplitByPattern(body, pattern) {
  const re        = new RegExp(pattern, 'g');
  const positions = [];
  let m;
  while ((m = re.exec(body)) !== null) positions.push(m.index);
  if (positions.length < 2) return [body];
  return positions.map((start, i) =>
    body.slice(start, i < positions.length - 1 ? positions[i + 1] : body.length)
  );
}

function emailParseBlocks(blocks, msgDate, opts, bankName) {
  const results  = [];
  const fallback = emailToDateStr(msgDate);
  const catRe    = [/消費類別[：:]\s*(.+)/i, /交易類別[：:]\s*(.+)/i, /消費類型[：:]\s*(.+)/i];
  for (const block of blocks) {
    const amount = emailExtractAmount(block, opts.amountRe);
    if (!amount || amount <= 0) continue;
    const merchant = emailExtractText(block, opts.merchantRe || []);
    const rawDate  = emailExtractDate(block, opts.dateRe || []);
    let date;
    if (!rawDate) {
      date = fallback;
    } else if (opts.inferYear && /^\d{2}-\d{2}$/.test(rawDate)) {
      date = emailInferFullDate(rawDate, msgDate);
    } else {
      date = rawDate;
    }
    const hint = emailExtractText(block, opts.categoryRe || catRe);
    results.push(emailBuildTx(amount, merchant, date, bankName, hint));
  }
  return results;
}

function emailExtractAmount(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const n = parseInt(m[1].replace(/,/g, ''), 10);
      if (n > 0) return n;
    }
  }
  return null;
}

function emailExtractText(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const t = m[1].trim().split(/[\n\r]/)[0].trim();
      if (t.length > 0 && t.length < 80) return t;
    }
  }
  return null;
}

function emailExtractDate(text, patterns) {
  const cm = text.match(/(\d{3,4})年(\d{1,2})月(\d{1,2})日/);
  if (cm) {
    let cy = parseInt(cm[1]);
    if (cy < 1900) cy += 1911;
    return cy + '-' + String(cm[2]).padStart(2, '0') + '-' + String(cm[3]).padStart(2, '0');
  }
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const raw = m[1].replace(/\//g, '-');
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
      if (/^\d{3}-\d{2}-\d{2}$/.test(raw)) {
        const [y, mo, d] = raw.split('-');
        return (parseInt(y) + 1911) + '-' + mo + '-' + d;
      }
      if (/^\d{2}-\d{2}$/.test(raw)) return raw;
    }
  }
  return null;
}

function emailInferFullDate(mmdd, msgDate) {
  const [mo, d] = mmdd.split('-');
  return msgDate.getFullYear() + '-' + mo.padStart(2, '0') + '-' + d.padStart(2, '0');
}

function emailToDateStr(date) {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}

function emailMapCategory(merchant, hint) {
  if (hint) {
    for (const [pattern, cat] of Object.entries(EMAIL_CATEGORY_HINT_MAP)) {
      if (new RegExp(pattern, 'i').test(hint)) return cat;
    }
  }
  if (!merchant) return '其他';
  for (const [pattern, cat] of Object.entries(EMAIL_CATEGORY_MAP)) {
    if (new RegExp(pattern, 'i').test(merchant)) return cat;
  }
  return '其他';
}

function emailBuildTx(amount, merchant, date, bankName, hint) {
  return {
    date,
    amount,
    category: emailMapCategory(merchant, hint),
    note:     merchant ? merchant.slice(0, 60) : '',
    bankName: bankName || null,
  };
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
    // TWSE blocked from Cloudflare IPs — return null so frontend uses its own TWSE call
    return null;
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
