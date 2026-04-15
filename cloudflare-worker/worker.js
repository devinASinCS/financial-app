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
