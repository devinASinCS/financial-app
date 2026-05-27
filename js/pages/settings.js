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
          <i class="fa-solid fa-clipboard-list" style="color:#6B7280;"></i> 最近自動匯入（共 ${txs.length} 筆）
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
    const workerUrl = Auth.getApiUrl();
    const el = document.getElementById('stock-pdf-status');
    if (el) el.textContent = '載入中...';
    try {
      const res  = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...Auth.authHeaders() },
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
        errors += `<p style="color:#dc2626;font-size:12px;">${item.fileName}：${isPwd ? '密碼錯誤' : e.message}</p>`;
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

    const divBankVal      = document.getElementById('div-bank-select')?.value || '';
    const [divBankId, divBankCurrency] = divBankVal ? divBankVal.split(':') : [null, 'USD'];
    const usdRate   = Store.getExchangeRate('USD');

    for (const t of selected) {
      if (t.action === 'dividend') {
        Store.addDividend({
          date: t.date, symbol: t.symbol, name: t.name,
          market: t.market, cashTotal: t.dividendNet,
          stockShares: 0, note: 'PDF匯入',
        });
        if (t.dividendNet > 0) {
          Store.addTransaction({
            date: t.date, type: 'income',
            amount: Math.round(t.dividendNet * usdRate * 100) / 100,
            category: '股利',
            note: `${t.symbol} ${t.name} 美股股利`,
            source: 'dividend',
            paymentMethod: divBankId ? 'bank_transfer' : 'cash',
            bankId: divBankId || null,
            foreignAmount: t.dividendNet,
            foreignCurrency: divBankCurrency || 'USD',
            exchangeRate: usdRate,
          });
        }
        continue;
      }
      Store.addStockTrade({
        date: t.date, symbol: t.symbol, name: t.name,
        action: t.action, quantity: t.quantity, price: t.price,
        fee: t.fee, tax: t.tax, market: t.market,
      });
    }

    // 清除 Worker 佇列中已處理的項目
    const workerUrl = Auth.getApiUrl();
    if (workerUrl) {
      const doneIds = [...new Set(selected.map(t => t._srcId))];
      await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...Auth.authHeaders() },
        body: JSON.stringify({ action: 'clear_stock_pdf_items', itemIds: doneIds }),
      }).catch(() => {});
      _stockPdfItems = _stockPdfItems.filter(item => !doneIds.includes(item.id));
    }

    _stockParsed = _stockParsed.filter(t => !t._checked);
    const divCount   = selected.filter(t => t.action === 'dividend').length;
    const tradeCount = selected.length - divCount;
    const msg = [tradeCount > 0 && `${tradeCount} 筆交易`, divCount > 0 && `${divCount} 筆股利`].filter(Boolean).join('、');
    Utils.showToast(`已匯入 ${msg}`);
    PageSettings.render();
  }

  async function _extractPdfText(base64Data, password) {
    const binary = atob(base64Data.replace(/\s/g, ''));
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
    if (/海外股票交易明細/.test(text))  return _parseCathayUSReport(text);
    if (/客戶日對帳單/.test(text))      return _parseCathayTWDaily(text);

    // Generic fallback
    const lines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const raw = [];
    for (const line of lines) { const t = _tryParseTradeRow(line); if (t) raw.push(t); }
    const seen = new Set();
    return raw.filter(t => {
      const k = `${t.date}|${t.symbol}|${t.quantity}|${t.price}|${t.action}`;
      if (seen.has(k)) return false; seen.add(k); return true;
    });
  }

  // 國泰證券 證券日對帳單 — domestic TW stocks
  function _parseCathayTWDaily(text) {
    const lines = text.split('\n').map(l => l.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);

    // First YYYY/MM/DD in document = trade date
    let tradeDate = null;
    for (const line of lines) {
      const m = line.match(/(\d{4}\/\d{2}\/\d{2})/);
      if (m) { tradeDate = m[1].replace(/\//g, '-'); break; }
    }
    if (!tradeDate) return [];

    // Build name→code from holdings section (庫存明細): "2886 兆豐金 ..."
    const nameToCode = {};
    for (const line of lines) {
      const m = line.match(/(\d{4,5})\s+([一-鿿]{2,10})/);
      if (m) nameToCode[m[2]] = m[1];
    }

    const trades = [];
    const seen = new Set();
    for (const line of lines) {
      // ChineseName  集買/集賣/現買/現賣/融買/融賣  qty  price  totalAmt  fee  tax
      const m = line.match(/([一-鿿]{2,10})\s+(集買|集賣|現買|現賣|融買|融賣|零買|零賣)\s+([\d,]+)\s+([\d.]+)\s+([\d,]+)\s+([\d,]+)\s*([\d,]*)/);
      if (!m) continue;
      const [, name, typeStr, qtyStr, priceStr, , feeStr, taxStr] = m;
      const qty   = parseInt(qtyStr.replace(/,/g, ''), 10);
      const price = parseFloat(priceStr);
      if (!qty || !price || price <= 0) continue;
      const action = /買/.test(typeStr) ? 'buy' : 'sell';
      const fee    = parseInt((feeStr || '0').replace(/,/g, ''), 10) || 0;
      const tax    = parseInt((taxStr || '0').replace(/,/g, ''), 10) || 0;
      const symbol = nameToCode[name] || name;
      const k = `${tradeDate}|${symbol}|${qty}|${price}|${action}`;
      if (seen.has(k)) continue;
      seen.add(k);
      trades.push({ date: tradeDate, symbol, name, action, quantity: qty, price, fee, tax, market: 'TW' });
    }
    return trades;
  }

  // 國泰綜合證券 客戶日買賣報告書 — US / overseas stocks
  function _parseCathayUSReport(text) {
    const lines = text.split('\n').map(l => l.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);

    // Report date from header: "2026年04月27日"
    let reportDate = null;
    for (const line of lines) {
      const m = line.match(/(\d{4})年(\d{2})月(\d{2})日/);
      if (m) { reportDate = `${m[1]}-${m[2]}-${m[3]}`; break; }
    }

    // Join lines by 8-digit trade reference into one record per trade
    const records = [];
    let cur = '';
    for (const line of lines) {
      if (/^\d{8}\s/.test(line)) { if (cur) records.push(cur); cur = line; }
      else if (cur) cur += ' ' + line;
    }
    if (cur) records.push(cur);

    const trades = [];
    const seen = new Set();
    for (const record of records) {
      // Actual line order: ref SYMBOL/Name USD price net(±) 美國 action shares amt fee tax date
      const m = record.match(/^\d{8}\s+([A-Z0-9.]+)\/(.+?)\s+\S+\s+([\d.]+)\s+(-?[\d.]+)\s+(美國|日本|香港|英國|德國)\s+(買進?|賣出?|除息)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+).*?(\d{4}\/\d{2}\/\d{2})/);
      if (!m) continue;
      const [, symbol, nameRaw, priceStr, netStr, marketStr, actionStr, sharesStr, , feeStr, taxStr, settleDateStr] = m;
      const shares = parseFloat(sharesStr);
      const price  = parseFloat(priceStr);
      if (!shares || !price) continue;

      // Use header report date; fallback: derive from settlement (US = T+1)
      let tradeDate = reportDate;
      if (!tradeDate) {
        const d = new Date(settleDateStr.replace(/\//g, '-') + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() - 1);
        tradeDate = d.toISOString().slice(0, 10);
      }

      const action = actionStr === '除息' ? 'dividend' : /買/.test(actionStr) ? 'buy' : 'sell';
      const fee    = parseFloat(feeStr) || 0;
      const tax    = parseFloat(taxStr) || 0;
      const market = marketStr === '美國' ? 'US' : 'TW';
      const k = `${tradeDate}|${symbol}|${shares}|${price}|${action}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const dividendNet = action === 'dividend' ? Math.abs(parseFloat(netStr || 0)) : 0;
      trades.push({ date: tradeDate, symbol, name: nameRaw.trim(), action, quantity: shares, price, fee, tax, market, dividendNet });
    }
    return trades;
  }

  function _tryParseTradeRow(line) {
    const m = line.match(
      /(\d{4}[\/\-]\d{2}[\/\-]\d{2})\s+(\d{4,6})\s*([一-鿿\w]*(?:\s[一-鿿\w]+)*?)\s*(買進?|賣出?)\s+([\d,]+)\s+([\d,]+(?:\.\d+)?)((?:\s+[\d,]+)*)/
    );
    if (!m) return null;
    const [, dateStr, symbol, nameRaw, actionStr, qtyStr, priceStr, restStr] = m;
    const qty   = parseInt(qtyStr.replace(/,/g, ''), 10);
    const price = parseFloat(priceStr.replace(/,/g, ''));
    if (!qty || !price || price <= 0 || price > 200000) return null;
    const action   = /買/.test(actionStr) ? 'buy' : 'sell';
    const totalAmt = qty * price;
    const others   = (restStr || '').match(/[\d,]+/g)
      ?.map(n => parseInt(n.replace(/,/g, ''), 10))
      .filter(n => n > 0 && Math.abs(n - totalAmt) > totalAmt * 0.05) || [];
    let fee = 0, tax = 0;
    if (others.length >= 2) { fee = others[0]; tax = others[1]; }
    else if (others.length === 1) { fee = others[0]; }
    else {
      fee = Math.max(20, Math.round(totalAmt * 0.001425));
      tax = action === 'sell' ? Math.round(totalAmt * 0.003) : 0;
    }
    return { date: dateStr.replace(/\//g, '-'), symbol, name: nameRaw.trim() || symbol, action, quantity: qty, price, fee, tax, market: 'TW' };
  }

  function _renderStockParsedTrades(container, extraHtml = '') {
    if (_stockParsed.length === 0) {
      container.innerHTML = extraHtml +
        '<p style="color:#6b7280;font-size:13px;padding:8px 0;">沒有解析到任何交易記錄。' +
        '請確認 PDF 密碼，或執行 GAS 中的 testLatestStatement() 確認附件格式。</p>';
      return;
    }
    const count = _stockParsed.filter(t => t._checked).length;
    const hasDividends = _stockParsed.some(t => t.action === 'dividend');
    const divBankHtml = hasDividends ? (() => {
      const banks = Store.getBanks();
      const opts = banks.flatMap(b => (b.wallets || [{currency: b.currency || 'TWD', balance: 0}]).map(w => `<option value="${b.id}:${w.currency}">${b.name} (${w.currency})</option>`)).join('');
      return `<div style="margin-bottom:12px;padding:10px 14px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;font-size:13px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span style="font-weight:600;color:#5b21b6;">💰 除息入帳銀行：</span>
        <select id="div-bank-select" class="form-input" style="width:auto;">
          <option value="">不連結銀行</option>${opts}
        </select>
      </div>`;
    })() : '';
    const rows  = _stockParsed.map(t => `
      <tr>
        <td style="text-align:center;">
          <input type="checkbox" ${t._checked ? 'checked' : ''}
            onchange="PageSettings.toggleStockTrade('${t._id}')">
        </td>
        <td style="font-size:12px;white-space:nowrap;">${t.date}</td>
        <td style="font-size:12px;font-weight:600;">${t.symbol}</td>
        <td style="font-size:12px;">${t.name}</td>
        <td style="font-size:12px;color:${t.action === 'buy' ? '#16a34a' : t.action === 'sell' ? '#dc2626' : '#7c3aed'};font-weight:600;">
          ${t.action === 'buy' ? '買進' : t.action === 'sell' ? '賣出' : '除息'}
        </td>
        <td style="font-size:12px;text-align:right;">${t.quantity.toLocaleString()}</td>
        <td style="font-size:12px;text-align:right;">${t.price.toFixed(2)}</td>
        <td style="font-size:12px;text-align:right;">${t.fee.toLocaleString()}</td>
        <td style="font-size:12px;text-align:right;">${t.tax.toLocaleString()}</td>
        <td style="font-size:12px;color:#6b7280;">${t._srcBroker}</td>
      </tr>`).join('');

    container.innerHTML = extraHtml + `
      ${divBankHtml}
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
  function setDefaultBank(id) {
    Store.setDefaultBankId(id || null);
    Utils.showToast(id ? '預設銀行已儲存' : '已清除預設銀行');
  }

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

    document.getElementById('app-content').innerHTML = `
      <div class="page-header">
        <h2 class="page-title"><i class="fa-solid fa-gear" style="color:#6B7280;margin-right:8px;font-size:18px;"></i>設定</h2>
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
          <button class="btn btn-primary" onclick="PageSettings.exportJSON()"><i class="fa-solid fa-download fa-xs"></i> 匯出 JSON 備份</button>
          <button class="btn btn-secondary" onclick="PageSettings.triggerImport()"><i class="fa-solid fa-upload fa-xs"></i> 匯入 JSON 備份</button>
        </div>
        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px;margin-top:14px;">
          <p style="font-size:13px;color:#0369a1;margin:0;">
            💡 建議在換裝置前、清除瀏覽器前先下載備份。備份為純文字 JSON，可用任何文字編輯器查看。
          </p>
        </div>
      </div>

      <!-- ── Cloud Sync ── -->
      <div class="card mb-6">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
          <h3 class="section-title" style="margin:0;">☁️ 雲端自動同步</h3>
          <span style="font-size:11px;background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:12px;font-weight:600;">已啟用</span>
        </div>
        <p style="font-size:14px;color:#6b7280;margin:8px 0 12px;">
          資料透過 Google 帳號自動同步至雲端，跨裝置即時存取。每次資料變更自動推送，開啟 App 時自動拉取最新資料。
        </p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;">
          <div style="font-size:13px;color:#166534;display:flex;align-items:center;gap:8px;">
            <i class="fa-solid fa-circle-check"></i>
            <span>登入即同步，無需任何額外設定。信用卡消費通知每 15 分鐘自動從 Gmail 匯入。</span>
          </div>
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
          系統每 15 分鐘自動偵測 Gmail 中的券商對帳單 PDF，無需任何設定。
          收到對帳單後點擊下方按鈕取得佇列，輸入 PDF 密碼即可解析並匯入。
        </p>

        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
          <button class="btn btn-secondary" onclick="PageSettings.fetchStockPdfQueue()">
            <i class="fa-solid fa-rotate"></i> 取得待處理對帳單
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
            <div style="font-size:12px;font-weight:600;color:#1d4ed8;margin-bottom:6px;">支援券商（通用格式）</div>
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

      <!-- ── Default Bank ── -->
      <div class="card mb-6">
        <h3 class="section-title">預設銀行</h3>
        <p style="font-size:14px;color:#6b7280;margin:8px 0 16px;">
          新增交易或股票買賣時，自動預選此銀行帳戶。
        </p>
        ${banks.length === 0 ? `<p style="font-size:13px;color:#9ca3af;">尚未設定任何銀行帳戶。</p>` : `
        <select class="form-select" style="max-width:280px;"
          onchange="PageSettings.setDefaultBank(this.value)">
          <option value="">不設預設銀行</option>
          ${banks.map(b => `<option value="${b.id}" ${Store.getDefaultBankId() === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
        </select>`}
      </div>

      <!-- ── Danger Zone ── -->
      <div class="card" style="border:1px solid #fecaca;">
        <h3 class="section-title" style="color:#dc2626;">⚠️ 危險操作</h3>
        <p style="font-size:14px;color:#6b7280;margin:8px 0 16px;">
          以下操作會永久刪除資料，執行前請先下載備份。
        </p>
        <button class="btn btn-error" onclick="PageSettings.clearAllData()"><i class="fa-solid fa-trash fa-xs"></i> 清除所有資料</button>
      </div>
    `;

    // Load API keys asynchronously after DOM is ready
  }

  return {
    render,
    exportJSON, triggerImport, clearAllData,
    fetchStockPdfQueue, parseAndPreviewPdfs, toggleStockTrade, importSelectedStockTrades,
    setDefaultBank,
  };
})();
