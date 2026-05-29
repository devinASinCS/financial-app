/**
 * Sync — bidirectional localStorage ↔ Worker/D1 sync.
 * Loaded after auth.js, before app.js.
 * Monkey-patches localStorage.setItem so every fm_* write auto-queues a push.
 */
const Sync = (() => {
  const FM_KEYS = [
    'fm_transactions', 'fm_banks', 'fm_stock_trades', 'fm_dividends',
    'fm_subscriptions', 'fm_expense_events', 'fm_settings',
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
      for (const [key, value] of Object.entries(data)) {
        _nativeSet(key, JSON.stringify(value));
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
    const pushResult = await push();
    const pullResult = await pull();
    return { push: pushResult, pull: pullResult };
  }

  // ── Auto-push on any fm_* localStorage mutation ────────────────────────
  const _nativeSet = localStorage.setItem.bind(localStorage);
  let   _timer     = null;

  localStorage.setItem = function (key, value) {
    _nativeSet(key, value);
    if (key.startsWith('fm_') && FM_KEYS.includes(key)) {
      clearTimeout(_timer);
      _timer = setTimeout(push, 1500); // debounce — batch rapid mutations
    }
  };

  return { pull, push, forceSync };
})();
