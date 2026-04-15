/**
 * US Stocks page — mirrors TW Stocks but in USD
 */
const PageUSStocks = (() => {
  const MARKET = 'US';
  let _activeTab = 'holdings';

  function render() {
    document.getElementById('app-content').innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">🇺🇸 美股投資組合</div>
          <div class="page-subtitle">美國上市股票 (USD)</div>
        </div>
        <div style="display:flex;gap:8px;" id="us-action-btns"></div>
      </div>

      <!-- Summary Cards -->
      <div class="grid-4" style="margin-bottom:20px;" id="us-summary-cards"></div>

      <!-- Tabs -->
      <div class="tab-bar">
        <button class="tab-btn ${_activeTab==='holdings'?'active':''}" onclick="PageUSStocks.switchTab('holdings')">📋 持股</button>
        <button class="tab-btn ${_activeTab==='trades'?'active':''}" onclick="PageUSStocks.switchTab('trades')">🔄 交易紀錄</button>
        <button class="tab-btn ${_activeTab==='dividends'?'active':''}" onclick="PageUSStocks.switchTab('dividends')">💵 股利</button>
        <button class="tab-btn ${_activeTab==='pnl'?'active':''}" onclick="PageUSStocks.switchTab('pnl')">📈 損益走勢</button>
      </div>

      <div id="us-tab-content"></div>
    `;

    _renderSummary();
    _renderActionBtns();
    _renderTab();
  }

  function _renderSummary() {
    const holdings  = Store.getHoldings(MARKET);
    const realized  = Store.getRealizedTrades(MARKET);
    const divs      = Store.getDividends(MARKET);

    const totalCost   = holdings.reduce((s, h) => s + h.totalCost, 0);
    const realizedPnL = realized.reduce((s, r) => s + r.pnl, 0);
    const divIncome   = divs.reduce((s, d) => s + (d.cashTotal || 0), 0);
    const totalReturn = realizedPnL + divIncome;

    document.getElementById('us-summary-cards').innerHTML = `
      <div class="card">
        <div class="card-title">持股成本</div>
        <div class="stat-value">${Utils.formatUSD(totalCost)}</div>
        <div class="stat-sub">${holdings.length} 檔持股</div>
      </div>
      <div class="card">
        <div class="card-title">已實現損益</div>
        <div class="stat-value ${Utils.pnlClass(realizedPnL)}">${Utils.formatUSD(realizedPnL, true)}</div>
        <div class="stat-sub">${realized.length} 筆賣出</div>
      </div>
      <div class="card">
        <div class="card-title">累計股利收入</div>
        <div class="stat-value" style="color:#8B5CF6;">${Utils.formatUSD(divIncome)}</div>
        <div class="stat-sub">${divs.length} 次配息</div>
      </div>
      <div class="card">
        <div class="card-title">總報酬</div>
        <div class="stat-value ${Utils.pnlClass(totalReturn)}">${Utils.formatUSD(totalReturn, true)}</div>
        <div class="stat-sub">交易 + 股利</div>
      </div>
    `;
  }

  function _renderActionBtns() {
    const btns = {
      holdings:  `<button class="btn btn-secondary" onclick="PageUSStocks.openImport()">📥 匯入對帳單</button>
                  <button class="btn btn-primary" onclick="PageUSStocks.openAddTrade()">＋ 新增交易</button>`,
      trades:    `<button class="btn btn-secondary" onclick="PageUSStocks.openImport()">📥 匯入對帳單</button>
                  <button class="btn btn-primary" onclick="PageUSStocks.openAddTrade()">＋ 新增交易</button>`,
      dividends: `<button class="btn btn-primary" onclick="PageUSStocks.openAddDividend()">＋ 新增股利</button>`,
      pnl:       '',
    };
    document.getElementById('us-action-btns').innerHTML = btns[_activeTab] || '';
  }

  function switchTab(tab) {
    _activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    _renderActionBtns();
    _renderTab();
  }

  function _renderTab() {
    switch (_activeTab) {
      case 'holdings':  _renderHoldings(); break;
      case 'trades':    _renderTrades(); break;
      case 'dividends': _renderDividends(); break;
      case 'pnl':       _renderPnL(); break;
    }
  }

  // ── Holdings ────────────────────────────────────────────────────
  function _renderHoldings() {
    const holdings = Store.getHoldings(MARKET);
    const container = document.getElementById('us-tab-content');

    if (holdings.length === 0) {
      container.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
          <div class="card"><div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">尚無持股，請新增交易紀錄</div></div></div>
          <div class="card"><div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-text">持股分布圖</div></div></div>
        </div>`;
      return;
    }

    const realized = Store.getRealizedTrades(MARKET);
    const realizedBySymbol = {};
    realized.forEach(r => { realizedBySymbol[r.symbol] = (realizedBySymbol[r.symbol] || 0) + r.pnl; });

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:3fr 2fr;gap:20px;">
        <div class="card" style="overflow-x:auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>代號</th>
                <th>名稱</th>
                <th class="text-right">持股數</th>
                <th class="text-right">平均成本</th>
                <th class="text-right">總成本</th>
                <th class="text-right">已實現損益</th>
                <th class="text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              ${holdings.map(h => {
                const rlz = realizedBySymbol[h.symbol] || 0;
                return `
                  <tr>
                    <td><strong style="color:#1D4ED8;">${h.symbol}</strong></td>
                    <td>${h.name}</td>
                    <td class="text-right">${Utils.formatShares(h.quantity)}</td>
                    <td class="text-right">${Utils.formatUSD(h.avgCost)}</td>
                    <td class="text-right">${Utils.formatUSD(h.totalCost)}</td>
                    <td class="text-right ${Utils.pnlClass(rlz)}">${Utils.formatUSD(rlz, true)}</td>
                    <td class="text-center">
                      <button class="btn btn-secondary btn-sm" onclick="PageUSStocks.openAddTrade('${h.symbol}','${h.name}')">交易</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div class="card">
          <div class="card-title" style="margin-bottom:12px;">持股分布（成本）</div>
          <canvas id="us-holdings-pie"></canvas>
        </div>
      </div>
    `;

    setTimeout(() => Charts.renderHoldingsPie('us-holdings-pie', holdings, 'USD'), 50);
  }

  // ── Trades ──────────────────────────────────────────────────────
  function _renderTrades() {
    const trades = Store.getStockTrades(MARKET).slice().reverse();
    const container = document.getElementById('us-tab-content');

    if (trades.length === 0) {
      container.innerHTML = `<div class="card"><div class="empty-state"><div class="empty-state-icon">🔄</div><div class="empty-state-text">尚無交易紀錄</div></div></div>`;
      return;
    }

    container.innerHTML = `
      <div class="card" style="overflow-x:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>代號</th>
              <th>名稱</th>
              <th class="text-center">買賣</th>
              <th class="text-right">股數</th>
              <th class="text-right">價格</th>
              <th class="text-right">手續費</th>
              <th class="text-right">金額</th>
              <th class="text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            ${trades.map(t => {
              const gross = t.quantity * t.price;
              const net = t.action === 'buy'
                ? gross + (t.fee||0)
                : gross - (t.fee||0);
              return `
                <tr>
                  <td>${Utils.formatDate(t.date)}</td>
                  <td><strong style="color:#1D4ED8;">${t.symbol}</strong></td>
                  <td>${t.name}</td>
                  <td class="text-center">
                    <span class="badge ${t.action==='buy'?'badge-buy':'badge-sell'}">
                      ${t.action==='buy'?'Buy':'Sell'}
                    </span>
                  </td>
                  <td class="text-right">${Utils.formatShares(t.quantity)}</td>
                  <td class="text-right">${Utils.formatUSD(t.price)}</td>
                  <td class="text-right" style="color:#9CA3AF;">${Utils.formatUSD(t.fee||0)}</td>
                  <td class="text-right" style="font-weight:600;color:${t.action==='buy'?'#EF4444':'#10B981'};">
                    ${t.action==='buy'?'-':'+'}${Utils.formatUSD(net)}
                  </td>
                  <td class="text-center">
                    <button class="btn btn-secondary btn-sm" onclick="PageUSStocks.openEditTrade('${t.id}')">編輯</button>
                    <button class="btn btn-danger btn-sm" style="margin-left:4px;" onclick="PageUSStocks.delTrade('${t.id}')">刪除</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ── Dividends ───────────────────────────────────────────────────
  function _renderDividends() {
    const divs = Store.getDividends(MARKET).slice().reverse();
    const container = document.getElementById('us-tab-content');

    container.innerHTML = `
      <div class="card" style="overflow-x:auto;">
        ${divs.length === 0
          ? `<div class="empty-state"><div class="empty-state-icon">💵</div><div class="empty-state-text">尚無股利紀錄</div></div>`
          : `<table class="data-table">
              <thead>
                <tr>
                  <th>配息日</th>
                  <th>代號</th>
                  <th>名稱</th>
                  <th class="text-right">持有股數</th>
                  <th class="text-right">每股股利</th>
                  <th class="text-right">股利總額</th>
                  <th>備註</th>
                  <th class="text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                ${divs.map(d => `
                  <tr>
                    <td>${Utils.formatDate(d.date)}</td>
                    <td><strong style="color:#1D4ED8;">${d.symbol}</strong></td>
                    <td>${d.name}</td>
                    <td class="text-right">${Utils.formatShares(d.holdingQuantity)}</td>
                    <td class="text-right">${Utils.formatUSD(d.cashPerShare)}</td>
                    <td class="text-right" style="color:#8B5CF6;font-weight:600;">${Utils.formatUSD(d.cashTotal)}</td>
                    <td style="color:#6B7280;font-size:12px;">${d.note || '-'}</td>
                    <td class="text-center">
                      <button class="btn btn-secondary btn-sm" onclick="PageUSStocks.openEditDividend('${d.id}')">編輯</button>
                      <button class="btn btn-danger btn-sm" style="margin-left:4px;" onclick="PageUSStocks.delDividend('${d.id}')">刪除</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>`
        }
      </div>
    `;
  }

  // ── P&L ─────────────────────────────────────────────────────────
  function _renderPnL() {
    const timeline  = Store.getPnLTimeline(MARKET);
    const realized  = Store.getRealizedTrades(MARKET);
    const container = document.getElementById('us-tab-content');

    container.innerHTML = `
      <div style="display:grid;gap:20px;">
        <div class="card">
          <div class="card-title" style="margin-bottom:4px;">損益走勢 (USD)</div>
          <div class="chart-container" style="height:280px;">
            <canvas id="us-pnl-chart"></canvas>
          </div>
        </div>
        ${realized.length > 0 ? `
        <div class="card" style="overflow-x:auto;">
          <div class="card-title" style="margin-bottom:14px;">已實現交易紀錄</div>
          <table class="data-table">
            <thead>
              <tr>
                <th>賣出日期</th>
                <th>代號</th>
                <th>名稱</th>
                <th class="text-right">股數</th>
                <th class="text-right">平均成本</th>
                <th class="text-right">賣出價格</th>
                <th class="text-right">損益</th>
                <th class="text-right">報酬率</th>
              </tr>
            </thead>
            <tbody>
              ${realized.slice().reverse().map(r => `
                <tr>
                  <td>${Utils.formatDate(r.date)}</td>
                  <td><strong style="color:#1D4ED8;">${r.symbol}</strong></td>
                  <td>${r.name}</td>
                  <td class="text-right">${Utils.formatShares(r.quantity)}</td>
                  <td class="text-right">${Utils.formatUSD(r.avgCost)}</td>
                  <td class="text-right">${Utils.formatUSD(r.sellPrice)}</td>
                  <td class="text-right ${Utils.pnlClass(r.pnl)}">${Utils.formatUSD(r.pnl, true)}</td>
                  <td class="text-right ${Utils.pnlClass(r.pnlPct)}">${Utils.pnlArrow(r.pnlPct)} ${Math.abs(r.pnlPct).toFixed(2)}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ` : ''}
      </div>
    `;

    setTimeout(() => Charts.renderPnLLine('us-pnl-chart', timeline, 'USD'), 50);
  }

  // ── Actions ─────────────────────────────────────────────────────
  function openAddTrade(symbol = '', name = '') {
    const pre = symbol ? { symbol, name, market: MARKET } : null;
    Modal.openStockTrade(MARKET, pre, _refresh);
  }

  function openEditTrade(id) {
    const t = Store.getStockTrades(MARKET).find(t => t.id === id);
    if (t) Modal.openStockTrade(MARKET, t, _refresh);
  }

  function delTrade(id) {
    if (!Utils.confirm('確定刪除此交易紀錄？')) return;
    Store.deleteStockTrade(id);
    Utils.showToast('已刪除');
    _refresh();
  }

  function openAddDividend() {
    const holdings = Store.getHoldings(MARKET);
    Modal.openDividend(MARKET, null, _refresh, holdings);
  }

  function openEditDividend(id) {
    const d = Store.getDividends(MARKET).find(d => d.id === id);
    if (d) {
      const holdings = Store.getHoldings(MARKET);
      Modal.openDividend(MARKET, d, _refresh, holdings);
    }
  }

  function delDividend(id) {
    if (!Utils.confirm('確定刪除此股利紀錄？')) return;
    Store.deleteDividend(id);
    Utils.showToast('已刪除');
    _refresh();
  }

  function openImport() {
    Modal.openImport(MARKET, _refresh);
  }

  function _refresh() {
    _renderSummary();
    _renderTab();
  }

  return {
    render, switchTab,
    openAddTrade, openEditTrade, delTrade,
    openAddDividend, openEditDividend, delDividend,
    openImport,
  };
})();
