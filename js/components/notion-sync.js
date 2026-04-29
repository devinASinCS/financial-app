/**
 * NotionSync — client-side wrapper for the Cloudflare Worker sync endpoint.
 * All Worker communication goes through here; pages never call fetch directly.
 */
const NotionSync = (() => {

  const KEYS = {
    workerUrl:      'fm_notion_worker_url',
    lastSync:       'fm_notion_last_sync',
    lastSyncDir:    'fm_notion_last_sync_dir', // 'save' | 'load'
    autoSync:       'fm_notion_auto_sync',
    lastServerSave: 'fm_last_server_save', // server-acknowledged timestamp of our last successful save
  };

  // ── Config ───────────────────────────────────────────────────────
  function getWorkerUrl() {
    return (localStorage.getItem(KEYS.workerUrl) || '').trim();
  }

  function setWorkerUrl(url) {
    localStorage.setItem(KEYS.workerUrl, url.trim());
  }

  function isConfigured() {
    return getWorkerUrl().length > 0;
  }

  function isAutoSyncEnabled() {
    return localStorage.getItem(KEYS.autoSync) === 'true';
  }

  function setAutoSync(enabled) {
    localStorage.setItem(KEYS.autoSync, enabled ? 'true' : 'false');
  }

  function getLastSync() {
    return localStorage.getItem(KEYS.lastSync) || null;
  }

  function getLastSyncDir() {
    return localStorage.getItem(KEYS.lastSyncDir) || null;
  }

  function _recordSync(direction) {
    localStorage.setItem(KEYS.lastSync, new Date().toISOString());
    localStorage.setItem(KEYS.lastSyncDir, direction);
  }

  // ── Auto-save (debounced) ─────────────────────────────────────────
  let _saveTimer = null;
  let _isSyncing = false;

  function scheduleAutoSave() {
    if (!isConfigured() || !isAutoSyncEnabled()) return;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
      if (_isSyncing) return;
      _isSyncing = true;
      try {
        await save();
        _updateSyncBadge();
      } catch { /* silent fail — auto-sync is best-effort */ }
      finally { _isSyncing = false; }
    }, 3000);
  }

  // ── Sync on startup ───────────────────────────────────────────────
  async function syncOnStart() {
    if (!isConfigured() || !isAutoSyncEnabled()) return;
    try {
      const result = await _request({ action: 'load' });
      if (!result.data || !result.data._savedAt) return;

      const remoteTs = new Date(result.data._savedAt).getTime();
      // Compare against server-acknowledged save timestamp to avoid clock-skew false positives.
      // fm_last_server_save is set only when we receive a confirmed savedAt from the Worker,
      // so it's always a server-side timestamp — safe to compare with _savedAt.
      const lastKnown = localStorage.getItem(KEYS.lastServerSave);
      if (lastKnown && new Date(lastKnown).getTime() >= remoteTs) return; // already up-to-date

      Store.importData(result.data);
      // Record the server timestamp of this version so future startups skip re-importing it.
      localStorage.setItem(KEYS.lastServerSave, result.data._savedAt);
      _recordSync('load');
      _updateSyncBadge();
      window.dispatchEvent(new Event('hashchange'));
    } catch { /* silent fail — don't block startup */ }
  }

  function _updateSyncBadge() {
    const el = document.getElementById('sync-status-badge');
    if (!el) return;
    const lastSync = getLastSync();
    if (!lastSync) { el.style.display = 'none'; return; }
    const d = new Date(lastSync);
    const fmt = d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    el.textContent = `☁️ ${fmt}`;
    el.style.display = '';
  }

  // ── Core request ─────────────────────────────────────────────────
  async function _request(body) {
    const url = getWorkerUrl();
    if (!url) throw new Error('尚未設定 Cloudflare Worker URL');

    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    let result;
    try { result = await res.json(); }
    catch { throw new Error(`Worker 回應格式錯誤 (HTTP ${res.status})`); }

    if (!result.ok) throw new Error(result.error || `操作失敗 (HTTP ${res.status})`);
    return result;
  }

  // ── Ping — test connectivity ──────────────────────────────────────
  async function ping() {
    return _request({ action: 'ping' });
  }

  // ── Save — push local data to Notion ─────────────────────────────
  async function save() {
    const data = Store.exportData();
    const result = await _request({ action: 'save', data });
    // Store the server's returned timestamp so syncOnStart() can compare purely server-side.
    if (result.savedAt) localStorage.setItem(KEYS.lastServerSave, result.savedAt);
    _recordSync('save');
    return result;
  }

  // ── Load — pull data from Notion and import locally ───────────────
  async function load() {
    const result = await _request({ action: 'load' });

    if (!result.data) throw new Error('Notion 中尚無備份資料，請先執行「上傳到 Notion」');

    const importResult = Store.importData(result.data);
    if (!importResult.ok) throw new Error(importResult.error);

    _recordSync('load');
    return importResult;
  }

  return {
    isConfigured,
    getWorkerUrl, setWorkerUrl,
    getLastSync, getLastSyncDir,
    isAutoSyncEnabled, setAutoSync,
    scheduleAutoSave, syncOnStart,
    ping, save, load,
  };
})();
