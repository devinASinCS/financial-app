/**
 * Settings page — Export/Import JSON + Notion Sync
 */
const PageSettings = (() => {

  // ── Export ───────────────────────────────────────────────────────
  function exportJSON() {
    const data = Store.exportData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href     = url;
    a.download = `finance-backup-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    Utils.showToast('備份已下載');
  }

  // ── Import ───────────────────────────────────────────────────────
  function triggerImport() {
    const input   = document.createElement('input');
    input.type    = 'file';
    input.accept  = '.json,application/json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        let obj;
        try { obj = JSON.parse(ev.target.result); }
        catch { Utils.showToast('JSON 格式錯誤，請選擇正確的備份檔'); return; }

        const ok = confirm(
          `即將匯入備份資料：\n` +
          `• 收支記錄 ${(obj.transactions||[]).length} 筆\n` +
          `• 股票交易 ${(obj.stockTrades||[]).length} 筆\n` +
          `• 銀行帳戶 ${(obj.banks||[]).length} 個\n\n` +
          `這將覆蓋目前所有資料，確定繼續嗎？`
        );
        if (!ok) return;

        const result = Store.importData(obj);
        if (result.ok) {
          Utils.showToast(`匯入成功！共 ${result.counts.transactions} 筆收支、${result.counts.stockTrades} 筆交易`);
          setTimeout(() => PageSettings.render(), 300);
        } else {
          Utils.showToast(`匯入失敗：${result.error}`);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  // ── Clear all data ────────────────────────────────────────────────
  function clearAllData() {
    if (!confirm('⚠️ 警告：這將永久刪除所有資料，包括收支記錄、股票交易、銀行設定等。\n\n此操作無法復原，確定要清除所有資料嗎？')) return;
    if (!confirm('再次確認：確定要清除所有資料？')) return;

    ['fm_transactions','fm_stock_trades','fm_dividends','fm_banks',
     'fm_subscriptions','fm_dca_plans','fm_debit_log'].forEach(k => localStorage.removeItem(k));
    Utils.showToast('所有資料已清除');
    setTimeout(() => PageSettings.render(), 300);
  }

  // ── Notion: toggle auto-sync ──────────────────────────────────────
  function toggleAutoSync(enabled) {
    NotionSync.setAutoSync(enabled);
    render();
    if (enabled) Utils.showToast('✅ 自動同步已開啟');
    else Utils.showToast('自動同步已關閉');
  }

  // ── Notion: save worker URL ───────────────────────────────────────
  function saveWorkerUrl() {
    const url = (document.getElementById('worker-url-input')?.value || '').trim();
    if (!url) { Utils.showToast('請輸入 Worker URL'); return; }
    if (!url.startsWith('http')) { Utils.showToast('URL 格式不正確'); return; }
    NotionSync.setWorkerUrl(url);
    Utils.showToast('Worker URL 已儲存');
    render();
  }

  // ── Notion: ping ─────────────────────────────────────────────────
  async function testConnection() {
    const btn = document.getElementById('btn-ping');
    if (btn) { btn.textContent = '測試中…'; btn.disabled = true; }
    try {
      await NotionSync.ping();
      Utils.showToast('✅ 連線成功！Worker 運作正常');
    } catch (e) {
      Utils.showToast(`❌ 連線失敗：${e.message}`);
    } finally {
      if (btn) { btn.textContent = '測試連線'; btn.disabled = false; }
    }
  }

  // ── Notion: upload ────────────────────────────────────────────────
  async function notionSave() {
    const btn = document.getElementById('btn-notion-save');
    if (btn) { btn.textContent = '上傳中…'; btn.disabled = true; }
    try {
      await NotionSync.save();
      Utils.showToast('✅ 資料已上傳至 Notion');
      render();
    } catch (e) {
      Utils.showToast(`❌ 上傳失敗：${e.message}`);
    } finally {
      if (btn) { btn.textContent = '⬆ 上傳到 Notion'; btn.disabled = false; }
    }
  }

  // ── Notion: download ─────────────────────────────────────────────
  async function notionLoad() {
    if (!confirm('從 Notion 載入資料將覆蓋目前所有本地資料，確定要繼續嗎？')) return;
    const btn = document.getElementById('btn-notion-load');
    if (btn) { btn.textContent = '載入中…'; btn.disabled = true; }
    try {
      const result = await NotionSync.load();
      Utils.showToast(`✅ 載入成功！共 ${result.counts.transactions} 筆收支`);
      render();
    } catch (e) {
      Utils.showToast(`❌ 載入失敗：${e.message}`);
    } finally {
      if (btn) { btn.textContent = '⬇ 從 Notion 載入'; btn.disabled = false; }
    }
  }

  // ── Email import log ─────────────────────────────────────────────
  function _renderEmailImportLog() {
    const txs = Store.getTransactions().filter(t => t.source === 'email_import');
    if (txs.length === 0) return '';
    const recent = txs.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    const rows = recent.map(t => `
      <tr>
        <td style="white-space:nowrap;font-size:12px;">${Utils.formatDate(t.date)}</td>
        <td style="font-size:12px;">${t.note || '-'}</td>
        <td style="font-size:12px;color:#6b7280;">${t.category}</td>
        <td style="text-align:right;font-size:12px;color:#ef4444;">-${Utils.formatTWD(t.amount)}</td>
      </tr>`).join('');
    return `
      <div style="margin-top:14px;">
        <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:8px;">
          📋 最近自動匯入（共 ${txs.length} 筆）
        </div>
        <div style="overflow-x:auto;">
          <table class="data-table" style="font-size:12px;">
            <thead><tr><th>日期</th><th>備註</th><th>分類</th><th class="text-right">金額</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  // ── Stock PDF Import ──────────────────────────────────────────────
  var _stockPdfItems  = [];  // [{id, broker, emailDate, subject, fileName, pdfBase64, addedAt}]
  var _stockParsed    = [];  // [{...trade fields, _id, _checked, _srcId, _srcBroker}]

  async function fetchStockPdfQueue() {
    const workerUrl = NotionSync.getWorkerUrl();
    if (!workerUrl) { Utils.showToast('請先設定 Worker URL'); return; }
    const el = document.getElementById('stock-pdf-status');
    if (el) el.textContent = '載入中...';
    try {
      const res  = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_stock_pdf_queue' }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      _stockPdfItems = json.items || [];
      const count = _stockPdfItems.length;
      if (el) el.textContent = count === 0 ? '佇列為空，無待處理對帳單' : `取得 ${count} 份待處理對帳單`;
      const wrap = document.getElementById('stock-pdf-password-wrap');
      if (wrap) wrap.style.display = count > 0 ? '' : 'none';
      const btn = document.getElementById('stock-parse-btn');
      if (btn) btn.disabled = count === 0;
    } catch (e) {
      if (el) el.textContent = `錯誤：${e.message}`;
    }
  }

  async function parseAndPreviewPdfs() {
    if (!_stockPdfItems.length) { Utils.showToast('請先點擊「取得待處理對帳單」'); return; }
    if (!window.pdfjsLib) { Utils.showToast('PDF.js 載入中，請稍後再試'); return; }
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const password  = (document.getElementById('stock-pdf-password') || {}).value || '';
    const container = document.getElementById('stock-pdf-results');
    if (container) container.innerHTML = '<p style="color:#6b7280;font-size:13px;padding:8px 0;">解析中，請稍候...</p>';
    _stockParsed = [];
    let errors = '';

    for (const item of _stockPdfItems) {
      try {
        const text   = await _extractPdfText(item.pdfBase64, password);
        const trades = _parseTWStockStatement(text, item.broker);
        for (const t of trades) {
          _stockParsed.push({
            ...t,
            _id:        Math.random().toString(36).slice(2),
            _checked:   true,
            _srcId:     item.id,
            _srcBroker: item.broker,
          });
        }
        if (trades.length === 0) errors += `<p style="color:#d97706;font-size:12px;">⚠️ ${item.fileName}：解析出 0 筆（格式不符或密碼錯誤）</p>`;
      } catch (e) {
        const isPwd = e.name === 'PasswordException' || /password/i.test(e.message);
        errors += `<p style="color:#dc2626;font-size:12px;">❌ ${item.fileName}：${isPwd ? '密碼錯誤' : e.message}</p>`;
      }
    }
    if (container) _renderStockParsedTrades(container, errors);
  }

  function toggleStockTrade(id) {
    const t = _stockParsed.find(x => x._id === id);
    if (t) t._checked = !t._checked;
    const btn = document.getElementById('stock-import-btn');
    if (btn) btn.textContent = `匯入選取的 ${_stockParsed.filter(x => x._checked).length} 筆`;
  }

  async function importSelectedStockTrades() {
    const selected = _stockParsed.filter(t => t._checked);
    if (!selected.length) { Utils.showToast('請先勾選要匯入的交易'); return; }

    for (const t of selected) {
      Store.addStockTrade({
        date: t.date, symbol: t.symbol, name: t.name,
        action: t.action, quantity: t.quantity, price: t.price,
        fee: t.fee, tax: t.tax, market: t.market,
      });
    }

    // 清除 Worker 佇列中已處理的項目
    const workerUrl = NotionSync.getWorkerUrl();
    if (workerUrl) {
      const doneIds = [...new Set(selected.map(t => t._srcId))];
      await Promise.all(doneIds.map(id =>
        fetch(workerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'clear_stock_pdf_item', itemId: id }),
        }).catch(() => {})
      ));
      _stockPdfItems = _stockPdfItems.filter(item => !doneIds.includes(item.id));
    }

    _stockParsed = _stockParsed.filter(t => !t._checked);
    Utils.showToast(`✅ 已匯入 ${selected.length} 筆股票交易`);
    PageSettings.render();
  }

  async function _extractPdfText(base64Data, password) {
    const binary = atob(base64Data);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const pdf = await pdfjsLib.getDocument({ data: bytes, password: password || undefined }).promise;
    let text = '';

    for (let p = 1; p <= pdf.numPages; p++) {
      const page    = await pdf.getPage(p);
      const content = await page.getTextContent();

      // Group text items by Y coordinate to reconstruct table rows
      const byY = {};
      for (const item of content.items) {
        if (!item.str) continue;
        const y = Math.round(item.transform[5]);
        (byY[y] = byY[y] || []).push({ x: item.transform[4], str: item.str });
      }
      const ys = Object.keys(byY).map(Number).sort((a, b) => b - a);
      for (const y of ys) {
        text += byY[y].sort((a, b) => a.x - b.x).map(i => i.str).join(' ') + '\n';
      }
    }
    return text;
  }

  function _parseTWStockStatement(text, broker) {
    const lines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const raw   = [];

    for (const line of lines) {
      const t = _tryParseTradeRow(line);
      if (t) raw.push(t);
    }

    // Deduplicate by date+symbol+qty+price+action
    const seen = new Set();
    return raw.filter(t => {
      const k = `${t.date}|${t.symbol}|${t.quantity}|${t.price}|${t.action}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function _tryParseTradeRow(line) {
    // Match: YYYY/MM/DD  symbol  [Chinese name]  買進/賣出  qty  price  [remaining numbers]
    const m = line.match(
      /(\d{4}[\/\-]\d{2}[\/\-]\d{2})\s+(\d{4,6})\s*([一-鿿\w]*(?:\s[一-鿿\w]+)*?)\s*(買進?|賣出?)\s+([\d,]+)\s+([\d,]+(?:\.\d+)?)((?:\s+[\d,]+)*)/
    );
    if (!m) return null;

    const [, dateStr, symbol, nameRaw, actionStr, qtyStr, priceStr, restStr] = m;
    const qty   = parseInt(qtyStr.replace(/,/g, ''), 10);
    const price = parseFloat(priceStr.replace(/,/g, ''));
    if (!qty || !price || price <= 0 || price > 200000) return null;

    const action    = /買/.test(actionStr) ? 'buy' : 'sell';
    const totalAmt  = qty * price;

    // Extract fee and tax from the remaining numbers (filter out settlement amount)
    const others = (restStr || '').match(/[\d,]+/g)
      ?.map(n => parseInt(n.replace(/,/g, ''), 10))
      .filter(n => n > 0 && Math.abs(n - totalAmt) > totalAmt * 0.05) || [];

    let fee = 0, tax = 0;
    if (others.length >= 2) { fee = others[0]; tax = others[1]; }
    else if (others.length === 1) { fee = others[0]; }
    else {
      // Estimate from standard TW rates if not found in text
      fee = Math.max(20, Math.round(totalAmt * 0.001425));
      tax = action === 'sell' ? Math.round(totalAmt * 0.003) : 0;
    }

    return {
      date:     dateStr.replace(/\//g, '-'),
      symbol,
      name:     nameRaw.trim() || symbol,
      action,
      quantity: qty,
      price,
      fee,
      tax,
      market:   'TW',
    };
  }

  function _renderStockParsedTrades(container, extraHtml = '') {
    if (_stockParsed.length === 0) {
      container.innerHTML = extraHtml +
        '<p style="color:#6b7280;font-size:13px;padding:8px 0;">沒有解析到任何交易記錄。' +
        '請確認 PDF 密碼，或執行 GAS 中的 testLatestStatement() 確認附件格式。</p>';
      return;
    }
    const count = _stockParsed.filter(t => t._checked).length;
    const rows  = _stockParsed.map(t => `
      <tr>
        <td style="text-align:center;">
          <input type="checkbox" ${t._checked ? 'checked' : ''}
            onchange="PageSettings.toggleStockTrade('${t._id}')">
        </td>
        <td style="font-size:12px;white-space:nowrap;">${t.date}</td>
        <td style="font-size:12px;font-weight:600;">${t.symbol}</td>
        <td style="font-size:12px;">${t.name}</td>
        <td style="font-size:12px;color:${t.action === 'buy' ? '#16a34a' : '#dc2626'};font-weight:600;">
          ${t.action === 'buy' ? '買進' : '賣出'}
        </td>
        <td style="font-size:12px;text-align:right;">${t.quantity.toLocaleString()}</td>
        <td style="font-size:12px;text-align:right;">${t.price.toFixed(2)}</td>
        <td style="font-size:12px;text-align:right;">${t.fee.toLocaleString()}</td>
        <td style="font-size:12px;text-align:right;">${t.tax.toLocaleString()}</td>
        <td style="font-size:12px;color:#6b7280;">${t._srcBroker}</td>
      </tr>`).join('');

    container.innerHTML = extraHtml + `
      <div style="overflow-x:auto;margin-top:8px;">
        <table class="data-table" style="font-size:12px;min-width:600px;">
          <thead><tr>
            <th></th><th>日期</th><th>代號</th><th>名稱</th><th>買賣</th>
            <th class="text-right">股數</th><th class="text-right">單價</th>
            <th class="text-right">手續費</th><th class="text-right">稅</th><th>券商</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="margin-top:12px;display:flex;gap:10px;align-items:center;">
        <button id="stock-import-btn" class="btn btn-primary"
          onclick="PageSettings.importSelectedStockTrades()">
          匯入選取的 ${count} 筆
        </button>
        <span style="font-size:12px;color:#6b7280;">共解析出 ${_stockParsed.length} 筆</span>
      </div>`;
  }

  // ── Render ────────────────────────────────────────────────────────
  function render() {
    const txs    = Store.getTransactions();
    const trades = Store.getStockTrades();
    const divs   = Store.getDividends();
    const banks  = Store.getBanks();
    const subs   = Store.getSubscriptions();
    const dcas   = Store.getDcaPlans();
    const totalCards = banks.reduce((s, b) => s + (b.creditCards || []).length, 0);

    let totalBytes = 0;
    ['fm_transactions','fm_stock_trades','fm_dividends','fm_banks',
     'fm_subscriptions','fm_dca_plans','fm_debit_log'].forEach(k => {
      totalBytes += (localStorage.getItem(k) || '').length * 2;
    });
    const sizeKB = (totalBytes / 1024).toFixed(1);

    // Notion sync status
    const workerUrl   = NotionSync.getWorkerUrl();
    const lastSync    = NotionSync.getLastSync();
    const lastDir     = NotionSync.getLastSyncDir();
    const configured  = NotionSync.isConfigured();
    const autoSync    = NotionSync.isAutoSyncEnabled();

    let syncStatusHtml = '';
    if (lastSync) {
      const d   = new Date(lastSync);
      const fmt = d.toLocaleString('zh-TW', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
      const dir = lastDir === 'save' ? '⬆ 上傳' : '⬇ 載入';
      syncStatusHtml = `
        <p style="font-size:13px;color:#6b7280;margin-top:10px;">
          上次同步：<strong>${fmt}</strong>（${dir}）
        </p>`;
    }

    document.getElementById('app-content').innerHTML = `
      <div class="page-header">
        <h2 class="page-title">⚙️ 設定</h2>
      </div>

      <!-- ── Data Summary ── -->
      <div class="card mb-6">
        <h3 class="section-title">資料總覽</h3>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:12px;">
          <div class="stat-mini"><div class="stat-mini-val">${txs.length}</div><div class="stat-mini-lbl">收支記錄</div></div>
          <div class="stat-mini"><div class="stat-mini-val">${trades.length}</div><div class="stat-mini-lbl">股票交易</div></div>
          <div class="stat-mini"><div class="stat-mini-val">${divs.length}</div><div class="stat-mini-lbl">股利紀錄</div></div>
          <div class="stat-mini"><div class="stat-mini-val">${banks.length}</div><div class="stat-mini-lbl">銀行帳戶</div></div>
          <div class="stat-mini"><div class="stat-mini-val">${totalCards}</div><div class="stat-mini-lbl">信用卡</div></div>
          <div class="stat-mini"><div class="stat-mini-val">${subs.length}</div><div class="stat-mini-lbl">訂閱項目</div></div>
        </div>
        <p style="font-size:12px;color:#9ca3af;margin-top:12px;">
          儲存空間：約 ${sizeKB} KB（瀏覽器 localStorage 上限通常為 5 MB）
        </p>
      </div>

      <!-- ── Local Backup ── -->
      <div class="card mb-6">
        <h3 class="section-title">本地備份 / 還原</h3>
        <p style="font-size:14px;color:#6b7280;margin:8px 0 16px;">
          將所有資料匯出為 JSON 檔案，或從備份檔還原。
        </p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <button class="btn-primary" onclick="PageSettings.exportJSON()">⬇️ 匯出 JSON 備份</button>
          <button class="btn-secondary" onclick="PageSettings.triggerImport()">⬆️ 匯入 JSON 備份</button>
        </div>
        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px;margin-top:14px;">
          <p style="font-size:13px;color:#0369a1;margin:0;">
            💡 建議在換裝置前、清除瀏覽器前先下載備份。備份為純文字 JSON，可用任何文字編輯器查看。
          </p>
        </div>
      </div>

      <!-- ── Notion Sync ── -->
      <div class="card mb-6">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
          <h3 class="section-title" style="margin:0;">Notion 雲端同步</h3>
          <span style="font-size:11px;background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:12px;font-weight:600;">Beta</span>
          <span id="sync-status-badge" style="font-size:11px;color:#6b7280;margin-left:auto;${lastSync ? '' : 'display:none'}">
            ☁️ ${lastSync ? new Date(lastSync).toLocaleTimeString('zh-TW', {hour:'2-digit',minute:'2-digit'}) : ''}
          </span>
        </div>
        <p style="font-size:14px;color:#6b7280;margin:8px 0 16px;">
          透過 Cloudflare Worker 將資料備份至 Notion，可跨裝置存取。
          設定方式請參考 <code style="background:#f3f4f6;padding:1px 5px;border-radius:4px;font-size:12px;">cloudflare-worker/</code> 目錄內的說明。
        </p>

        <!-- Worker URL input -->
        <div class="form-group">
          <label class="form-label">Cloudflare Worker URL</label>
          <div style="display:flex;gap:8px;">
            <input id="worker-url-input" class="form-input" type="url"
              placeholder="https://finance-notion-sync.your-name.workers.dev"
              value="${workerUrl.replace(/"/g, '&quot;')}">
            <button class="btn-secondary" style="white-space:nowrap;" onclick="PageSettings.saveWorkerUrl()">儲存</button>
          </div>
        </div>

        <!-- Auto-sync toggle -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:12px;">
          <div>
            <div style="font-size:14px;font-weight:500;color:#111827;">自動同步</div>
            <div style="font-size:12px;color:#6b7280;margin-top:2px;">資料變更時自動上傳；開啟 App 時自動從雲端下載最新資料</div>
          </div>
          <label style="position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0;margin-left:12px;">
            <input type="checkbox" ${autoSync ? 'checked' : ''} ${configured ? '' : 'disabled'}
              onchange="PageSettings.toggleAutoSync(this.checked)"
              style="opacity:0;width:0;height:0;">
            <span style="
              position:absolute;cursor:${configured ? 'pointer' : 'not-allowed'};
              top:0;left:0;right:0;bottom:0;
              background:${autoSync ? '#2563eb' : '#d1d5db'};
              border-radius:24px;transition:.2s;
            ">
              <span style="
                position:absolute;content:'';height:18px;width:18px;
                left:${autoSync ? '23px' : '3px'};bottom:3px;
                background:white;border-radius:50%;transition:.2s;
              "></span>
            </span>
          </label>
        </div>

        <!-- Action buttons -->
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px;">
          <button id="btn-ping" class="btn-secondary" onclick="PageSettings.testConnection()" ${configured ? '' : 'disabled'}>
            🔌 測試連線
          </button>
          <button id="btn-notion-save" class="btn-primary" onclick="PageSettings.notionSave()" ${configured ? '' : 'disabled'}>
            ⬆ 上傳到 Notion
          </button>
          <button id="btn-notion-load" class="btn-secondary" onclick="PageSettings.notionLoad()" ${configured ? '' : 'disabled'}>
            ⬇ 從 Notion 載入
          </button>
        </div>

        ${syncStatusHtml}

        ${!configured ? `
        <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:12px;margin-top:14px;">
          <p style="font-size:13px;color:#92400e;margin:0;">
            ⚠️ 請先輸入 Worker URL 才能使用雲端同步。部署步驟詳見專案內 <code>cloudflare-worker/</code> 說明。
          </p>
        </div>` : ''}
      </div>

      <!-- ── Email Auto-Import ── -->
      <div class="card mb-6">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
          <h3 class="section-title" style="margin:0;">📧 Email 自動匯入</h3>
          <span style="font-size:11px;background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:12px;font-weight:600;">Google Apps Script</span>
        </div>
        <p style="font-size:14px;color:#6b7280;margin:8px 0 16px;">
          信用卡消費通知寄到 Gmail 後，由 Google Apps Script 自動解析並寫入 Cashio，
          App 開啟時同步即可看到新交易。
        </p>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:16px;">
          <div style="font-weight:600;color:#1e293b;margin-bottom:12px;font-size:14px;">⚙️ 設定步驟</div>
          <ol style="font-size:13px;color:#374151;line-height:2;margin:0;padding-left:20px;">
            <li>前往 <a href="https://script.google.com" target="_blank" style="color:#2563eb;">script.google.com</a> → 建立新專案</li>
            <li>將專案根目錄的 <code style="background:#e5e7eb;padding:1px 5px;border-radius:4px;">gas-email-importer.gs</code> 全部內容貼入</li>
            <li>修改腳本頂部 <code style="background:#e5e7eb;padding:1px 5px;border-radius:4px;">CONFIG.workerUrl</code> 填入你的 Worker URL（同下方設定）</li>
            <li>執行一次 <code style="background:#e5e7eb;padding:1px 5px;border-radius:4px;">setupTrigger()</code> 安裝定時觸發器</li>
            <li>依提示授予 Gmail 存取權限</li>
            <li>執行 <code style="background:#e5e7eb;padding:1px 5px;border-radius:4px;">testLatestEmail()</code> 測試解析結果</li>
          </ol>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
          <div style="background:#eff6ff;border-radius:8px;padding:12px;">
            <div style="font-size:12px;font-weight:600;color:#1d4ed8;margin-bottom:6px;">✅ 支援銀行</div>
            <div style="font-size:12px;color:#1e40af;line-height:1.8;">
              國泰世華・玉山銀行<br>
              中信銀行・台新銀行<br>
              富邦銀行・永豐銀行<br>
              聯邦銀行・LINE Pay
            </div>
          </div>
          <div style="background:#fefce8;border-radius:8px;padding:12px;">
            <div style="font-size:12px;font-weight:600;color:#92400e;margin-bottom:6px;">💡 若你的銀行不在列表</div>
            <div style="font-size:12px;color:#78350f;line-height:1.8;">
              在 GAS 腳本的<br>
              <code style="background:#fde68a;padding:1px 4px;border-radius:3px;">BANK_PARSERS</code> 陣列<br>
              仿照現有格式新增即可
            </div>
          </div>
        </div>

        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;">
          <p style="font-size:13px;color:#166534;margin:0;">
            🔒 <strong>安全性：</strong>可在 Cloudflare Worker 環境變數中設定
            <code style="background:#dcfce7;padding:1px 5px;border-radius:4px;">ADD_TX_SECRET</code>，
            並在 GAS 腳本的 <code style="background:#dcfce7;padding:1px 5px;border-radius:4px;">CONFIG.secret</code> 填入相同值，
            防止未授權的寫入請求。
          </p>
        </div>

        ${_renderEmailImportLog()}
      </div>

      <!-- ── Stock PDF Import ── -->
      <div class="card mb-6">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
          <h3 class="section-title" style="margin:0;">📄 股票對帳單 PDF 匯入</h3>
          <span style="font-size:11px;background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:12px;font-weight:600;">PDF 解析</span>
        </div>
        <p style="font-size:14px;color:#6b7280;margin:8px 0 16px;">
          Google Apps Script 自動擷取券商對帳單 PDF 信件並上傳至 Worker 佇列。
          在此輸入 PDF 密碼即可解析、預覽並批次匯入台股交易記錄。
        </p>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:16px;">
          <div style="font-weight:600;color:#1e293b;margin-bottom:12px;font-size:14px;">⚙️ 設定步驟</div>
          <ol style="font-size:13px;color:#374151;line-height:2;margin:0;padding-left:20px;">
            <li>將 <code style="background:#e5e7eb;padding:1px 5px;border-radius:4px;">gas-email-importer.gs</code> 貼入 Google Apps Script（已包含對帳單函式）</li>
            <li>執行一次 <code style="background:#e5e7eb;padding:1px 5px;border-radius:4px;">setupStockTrigger()</code> 安裝每日觸發器</li>
            <li>收到對帳單後 GAS 自動上傳 PDF 至 Worker；回到此頁點擊下方按鈕取得佇列</li>
            <li>輸入 PDF 密碼（通常為身份證字號或生日），點擊「解析並預覽」</li>
            <li>確認解析結果無誤後點擊「匯入」</li>
          </ol>
        </div>

        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
          <button class="btn btn-secondary" onclick="PageSettings.fetchStockPdfQueue()">
            🔄 取得待處理對帳單
          </button>
          <span id="stock-pdf-status" style="font-size:13px;color:#6b7280;">點擊按鈕從 Worker 取得佇列</span>
        </div>

        <div id="stock-pdf-password-wrap" style="display:none;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px;margin-bottom:14px;">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <label style="font-size:13px;font-weight:600;white-space:nowrap;">🔑 PDF 密碼：</label>
            <input type="password" id="stock-pdf-password" class="form-input"
              placeholder="身份證字號 / 生日（格式依券商規定）"
              style="max-width:280px;flex:1;">
            <button id="stock-parse-btn" class="btn btn-primary" disabled
              onclick="PageSettings.parseAndPreviewPdfs()">
              🔍 解析並預覽
            </button>
          </div>
          <p style="font-size:11px;color:#166534;margin:6px 0 0;">
            密碼僅用於本次瀏覽器端解析，不會傳送至任何伺服器或儲存
          </p>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
          <div style="background:#eff6ff;border-radius:8px;padding:12px;">
            <div style="font-size:12px;font-weight:600;color:#1d4ed8;margin-bottom:6px;">✅ 支援券商（通用格式）</div>
            <div style="font-size:12px;color:#1e40af;line-height:1.8;">
              元大・富邦・永豐金・凱基<br>國泰・第一金・群益（及其他）
            </div>
          </div>
          <div style="background:#fefce8;border-radius:8px;padding:12px;">
            <div style="font-size:12px;font-weight:600;color:#92400e;margin-bottom:6px;">💡 PDF 解析失敗？</div>
            <div style="font-size:12px;color:#78350f;line-height:1.8;">
              執行 GAS 中的<br>
              <code style="background:#fde68a;padding:1px 4px;border-radius:3px;">testLatestStatement()</code><br>
              確認信件格式與附件
            </div>
          </div>
        </div>

        <div id="stock-pdf-results"></div>
      </div>

      <!-- ── Danger Zone ── -->
      <div class="card" style="border:1px solid #fecaca;">
        <h3 class="section-title" style="color:#dc2626;">⚠️ 危險操作</h3>
        <p style="font-size:14px;color:#6b7280;margin:8px 0 16px;">
          以下操作會永久刪除資料，執行前請先下載備份。
        </p>
        <button class="btn-danger" onclick="PageSettings.clearAllData()">🗑️ 清除所有資料</button>
      </div>
    `;
  }

  return {
    render,
    exportJSON, triggerImport, clearAllData,
    saveWorkerUrl, testConnection, notionSave, notionLoad, toggleAutoSync,
    fetchStockPdfQueue, parseAndPreviewPdfs, toggleStockTrade, importSelectedStockTrades,
  };
})();
