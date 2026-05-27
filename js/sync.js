/**
 * Sync — bidirectional localStorage ↔ Worker/D1 sync.
 * Loaded after auth.js, before app.js.
 * Monkey-patches localStorage.setItem so every fm_* write auto-queues a push.
 */
const Sync = (() => {
  const FM_KEYS = [
    'fm_transactions', 'fm_banks', 'fm_stock_trades', 'fm_dividends',
    'fm_subscriptions', 'fm_events', 'fm_settings',
  ];

  // Download all user data from D1 → localStorage
  async function pull() {
    try {
      const res = await fetch(`${Auth.getApiUrl()}/api/data`, { headers: Auth.authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      // Write via native setItem to avoid triggering our push hook
      for (const [key, value] of Object.entries(data)) {
        _nativeSet(key, JSON.stringify(value));
      }
    } catch (e) {
      console.warn('[Sync] pull failed:', e.message);
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
      await fetch(`${Auth.getApiUrl()}/api/data`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', ...Auth.authHeaders() },
        body:    JSON.stringify(data),
      });
    } catch (e) {
      console.warn('[Sync] push failed:', e.message);
    }
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

  return { pull, push };
})();
