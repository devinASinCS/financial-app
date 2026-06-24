/**
 * Sync — bidirectional localStorage ↔ Worker/D1 sync.
 * Loaded after auth.js, before app.js.
 * Monkey-patches localStorage.setItem so every fm_* write auto-queues a push.
 */
const Sync = (() => {
  const FM_KEYS = [
    'fm_transactions', 'fm_deleted_tx_ids', 'fm_banks', 'fm_stock_trades', 'fm_dividends',
    'fm_subscriptions', 'fm_expense_events', 'fm_settings', 'fm_deleted_trade_ids',
    'fm_deleted_div_ids',
  ];

  // Download all user data from D1 → localStorage
  async function pull() {
    try {
      const res = await fetch(`${Auth.getApiUrl()}/api/data`, { headers: Auth.authHeaders() });
      if (!res.ok) {
        console.warn('[Sync] pull failed: HTTP', res.status);
        return { ok: false, status: res.status };
      }
      const data = await res.json();
      const userId = Auth.getUser()?.id;
      // Clear fm_* only on user switch — prevents previous user's data leaking
      // into a new user's session, while preserving data for the same user
      if (userId && localStorage.getItem('fm_current_user') !== userId) {
        for (const key of FM_KEYS) localStorage.removeItem(key);
        localStorage.setItem('fm_current_user', userId);
      }
      // Free space: remove PDF item blobs (fm_pdf_item_*) before writing
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('fm_pdf_item_')) toRemove.push(k);
      }
      toRemove.forEach(k => localStorage.removeItem(k));
      if (toRemove.length) console.log('[Sync] freed PDF blobs:', toRemove);

      const keys = Object.keys(data);
      // Snapshot tombstones before loop so else-branch writes can't clobber them mid-merge
      // Snapshot tombstones before iterating — the else branch below can overwrite
      // fm_deleted_*_ids mid-loop if the server sends them before the trade/tx arrays,
      // which would silently discard local tombstones and restore deleted records.
      const tombstones      = new Set(JSON.parse(localStorage.getItem('fm_deleted_tx_ids')    || '[]'));
      const tradeTombstones = new Set(JSON.parse(localStorage.getItem('fm_deleted_trade_ids') || '[]'));
      const divTombstones   = new Set(JSON.parse(localStorage.getItem('fm_deleted_div_ids')   || '[]'));
      for (const [key, value] of Object.entries(data)) {
        if (key === 'fm_transactions' && Array.isArray(value)) {
          // Merge: union local + D1 by ID so server-added email imports aren't lost.
          // Skip any D1 tx whose ID is tombstoned (user explicitly deleted it).
          const local = JSON.parse(localStorage.getItem('fm_transactions') || '[]');
          const byId = new Map(local.filter(t => t.id).map(t => [t.id, t]));
          for (const tx of value) {
            if (tx.id && !byId.has(tx.id) && !tombstones.has(tx.id)) byId.set(tx.id, tx);
          }
          _nativeSet(key, JSON.stringify([...byId.values()]));
        } else if (key === 'fm_stock_trades' && Array.isArray(value)) {
          // Same merge strategy as transactions: union by ID, respect tombstones.
          const local = JSON.parse(localStorage.getItem('fm_stock_trades') || '[]');
          const byId = new Map(local.filter(t => t.id).map(t => [t.id, t]));
          for (const trade of value) {
            if (trade.id && !byId.has(trade.id) && !tradeTombstones.has(trade.id)) byId.set(trade.id, trade);
          }
          const merged = [...byId.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
          _nativeSet(key, JSON.stringify(merged));
        } else if (key === 'fm_dividends' && Array.isArray(value)) {
          // Merge: same strategy as transactions/trades — union by ID, respect tombstones.
          const local = JSON.parse(localStorage.getItem('fm_dividends') || '[]');
          const byId = new Map(local.filter(d => d.id).map(d => [d.id, d]));
          for (const div of value) {
            if (div.id && !byId.has(div.id) && !divTombstones.has(div.id)) byId.set(div.id, div);
          }
          const merged = [...byId.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
          _nativeSet(key, JSON.stringify(merged));
        } else if (key === 'fm_deleted_trade_ids' && Array.isArray(value)) {
          // Union: never discard local tombstones that haven't reached the server yet.
          _nativeSet(key, JSON.stringify([...new Set([...tradeTombstones, ...value])].slice(-500)));
        } else if (key === 'fm_deleted_tx_ids' && Array.isArray(value)) {
          // Union: same for transaction tombstones.
          _nativeSet(key, JSON.stringify([...new Set([...tombstones, ...value])].slice(-500)));
        } else if (key === 'fm_deleted_div_ids' && Array.isArray(value)) {
          // Union: same for dividend tombstones.
          _nativeSet(key, JSON.stringify([...new Set([...divTombstones, ...value])].slice(-500)));
        } else {
          _nativeSet(key, JSON.stringify(value));
        }
      }
      console.log('[Sync] pull ok — keys:', keys);
      return { ok: true, keys };
    } catch (e) {
      console.warn('[Sync] pull failed:', e.message);
      return { ok: false, error: e.message };
    }
  }

  // Upload all fm_* keys from localStorage → D1
  async function push() {
    const data = {};
    for (const key of FM_KEYS) {
      const val = localStorage.getItem(key);
      if (val !== null) {
        try { data[key] = JSON.parse(val); } catch {}
      }
    }
    try {
      const res = await fetch(`${Auth.getApiUrl()}/api/data`, {
        method:   'PUT',
        headers:  { 'Content-Type': 'application/json', ...Auth.authHeaders() },
        body:     JSON.stringify(data),
        keepalive: true, // survives page close before debounce fires
      });
      if (!res.ok) {
        console.warn('[Sync] push failed: HTTP', res.status);
        return { ok: false, status: res.status };
      }
      console.log('[Sync] push ok');
      return { ok: true };
    } catch (e) {
      console.warn('[Sync] push failed:', e.message);
      return { ok: false, error: e.message };
    }
  }

  async function forceSync() {
    const pushResult = await push(); // push local first — D1 gets latest before we pull
    const pullResult = await pull(); // then pull — merges any server-side additions
    return { push: pushResult, pull: pullResult };
  }

  // ── Auto-push on any fm_* localStorage mutation ────────────────────────
  const _nativeSet = localStorage.setItem.bind(localStorage);
  let   _timer     = null;

  localStorage.setItem = function (key, value) {
    _nativeSet(key, value);
    if (key.startsWith('fm_') && FM_KEYS.includes(key)) {
      clearTimeout(_timer);
      _timer = setTimeout(push, 0); // debounce — batch synchronous multi-write ops; push immediately after
    }
  };

  // Flush on page hide/close. Always push — not just when debounce is pending —
  // so data reaches D1 even if the 1500ms timer already fired but push hadn't completed.
  // keepalive:true ensures the fetch survives tab close.
  function _flushOnHide() {
    clearTimeout(_timer);
    _timer = null;
    push();
  }
  window.addEventListener('pagehide', _flushOnHide);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') _flushOnHide();
  });

  return { pull, push, forceSync };
})();
