/**
 * NotionSync — client-side wrapper for the Cloudflare Worker sync endpoint.
 * All Worker communication goes through here; pages never call fetch directly.
 */
const NotionSync = (() => {

  const KEYS = {
    workerUrl: 'fm_notion_worker_url',
    lastSync:  'fm_notion_last_sync',
    lastSyncDir: 'fm_notion_last_sync_dir', // 'save' | 'load'
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
    ping, save, load,
  };
})();
