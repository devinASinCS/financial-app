/**
 * US Stocks page — mirrors TW Stocks but in USD
 */
const PageUSStocks = (() => {
  const MARKET = 'US';
  let _activeTab      = 'holdings';
  let _fetchingPrices = false;
  let _autoFetchDone  = false;

  function render() {
    document.getElementById('app-content').innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title"><i class="fa-solid fa-chart-bar" style="color:#3B82F6;margin-right:8px;font-size:18px;"></i>美股投資組合</div>
          <div class="page-subtitle">美國上市股票 (USD)</div>
        </div>
        <div style="display:flex;gap:8px;" id="us-action-btns"></div>
      </div>

      <!-- Summary Cards -->
      <div class="stock-summary-grid" style="margin-bottom:16px;" id="us-summary-cards"></div>

      <!-- Tabs -->
      <div class="tab-bar">
        <button class="tab-btn ${_activeTab==='holdings'?'active':''}" onclick="PageUSStocks.switchTab('holdings')">持股</button>
        <button class="tab-btn ${_activeTab==='trades'?'active':''}" onclick="PageUSStocks.switchTab('trades')">交易</button>
        <button class="tab-btn ${_activeTab==='dividends'?'active':''}" onclick="PageUSStocks.switchTab('dividends')">股利</button>
        <button class="tab-btn ${_activeTab==='pnl'?'active':''}" onclick="PageUSStocks.switchTab('pnl')">損益</button>
      </div>

      <div id="us-tab-content"></div>
    `;

    _renderSummary();
    _renderActionBtns();
    _renderTab();

    if (!_autoFetchDone) {
      _autoFetchDone = true;
      setTimeout(() => {
        const holdings = Store.getHoldings(MARKET);
        if (holdings.length > 0 && !StockPrice.isMarketOpen(MARKET)) {
          const anyStale = holdings.some(h => StockPrice.isCacheStale(h.symbol));
          if (anyStale) refreshPrices();
        }
      }, 1000);
    }
  }

  function _renderSummary() {
    const holdings   = Store.getHoldings(MARKET);
    const realized   = Store.getRealizedTrades(MARKET);
    const divs       = Store.getDividends(MARKET);
    const priceCache = Store.getStockPrices();

    const totalCost   = holdings.reduce((s, h) => s + h.totalCost, 0);
    const realizedPnL = realized.reduce((s, r) => s + r.pnl, 0);
    const divIncome   = divs.reduce((s, d) => s + (d.cashTotal || 0), 0);

    let totalMarketValue = 0;
    let priceCount = 0;
    holdings.forEach(h => {
      const p = priceCache[h.symbol];
      if (p && p.price && !p.error) {
        totalMarketValue += p.price * h.quantity;
        priceCount++;
      } else {
        totalMarketValue += h.totalCost;
      }
    });
    const hasPrices     = priceCount > 0;
    const unrealizedPnL = hasPrices ? totalMarketValue - totalCost : null;
    const unrealizedPct = totalCost > 0 && unrealizedPnL !== null ? (unrealizedPnL / totalCost * 100) : null;

    document.getElementById('us-summary-cards').innerHTML = `
      <div class="card">
        <div class="card-title">持股成本</div>
        <div class="stat-value">${Utils.formatUSD(totalCost)}</div>
        <div class="stat-sub">${hasPrices ? '市值 ' + Utils.formatUSD(totalMarketValue) : holdings.length + ' 檔持股'}</div>
      </div>
      <div class="card">
        <div class="card-title">未實現損益</div>
        ${unrealizedPnL !== null
          ? `<div class="stat-value ${Utils.pnlClass(unrealizedPnL)}">${Utils.formatUSD(unrealizedPnL, true)}</div>
             <div class="stat-sub ${Utils.pnlClass(unrealizedPct)}">${Utils.pnlArrow(unrealizedPct)} ${Math.abs(unrealizedPct).toFixed(2)}%</div>`
          : `<div class="stat-value" style="color:#9CA3AF;font-size:14px;">--</div>
             <div class="stat-sub"><a href="#" style="color:#3B82F6;" onclick="event.preventDefault();PageUSStocks.refreshPrices()">點此更新報價</a></div>`
        }
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
    `;
  }

  function _renderActionBtns() {
    const btns = {
      holdings:  `<button class="btn btn-secondary" onclick="PageUSStocks.openImport()">📥 匯入</button>
                  <button class="btn btn-primary" onclick="PageUSStocks.openAddTrade()"><i class="fa-solid fa-plus fa-xs"></i> 新增交易</button>`,
      trades:    `<button class="btn btn-secondary" onclick="PageUSStocks.openImport()">📥 匯入</button>
                  <button class="btn btn-primary" onclick="PageUSStocks.openAddTrade()"><i class="fa-solid fa-plus fa-xs"></i> 新增交易</button>`,
      dividends: `<button class="btn btn-primary" onclick="PageUSStocks.openAddDividend()"><i class="fa-solid fa-plus fa-xs"></i> 新增股利</button>`,

      pnl:       '',
    };
    document.getElementById('us-action-btns').innerHTML = btns[_activeTab] || '';
  }

  function switchTab(tab) {
    _activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (event?.target) event.target.classList.add('active');
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
    const holdings   = Store.getHoldings(MARKET);
    const container  = document.getElementById('us-tab-content');
    const priceCache = Store.getStockPrices();

    if (holdings.length === 0) {
      container.innerHTML = `
        <div class="card"><div class="empty-state"><div class="empty-state-icon">📋</div>
        <div class="empty-state-text">尚無持股，請新增交易紀錄</div></div></div>`;
      return;
    }

    const fetchTimes = holdings
      .map(h => priceCache[h.symbol]?.fetchedAt)
      .filter(Boolean)
      .map(t => new Date(t).getTime());
    const lastUpdateMs  = fetchTimes.length ? Math.max(...fetchTimes) : 0;
    const lastUpdateStr = lastUpdateMs
      ? new Date(lastUpdateMs).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : null;

    const holdingCards = holdings.map(h => {
      const p             = priceCache[h.symbol];
      const hasPrice      = p && p.price && !p.error;
      const currentPrice  = hasPrice ? p.price : null;
      const marketValue   = currentPrice !== null ? currentPrice * h.quantity : null;
      const unrealizedPnL = marketValue !== null ? marketValue - h.totalCost : null;
      const unrealizedPct = h.totalCost > 0 && unrealizedPnL !== null ? unrealizedPnL / h.totalCost * 100 : null;
      const changePct     = hasPrice && p.changePercent !== undefined ? p.changePercent : null;
      const exDate        = hasPrice && p.exDividendDate ? p.exDividendDate : null;

      const symbolTrades = Store.getStockTrades(MARKET).filter(t => t.symbol === h.symbol).slice().reverse();
      const tradeRows = symbolTrades.map(t => {
        const gross = t.quantity * t.price;
        const net   = t.action === 'buy' ? gross + (t.fee || 0) : gross - (t.fee || 0);
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid #f1f5f9;">
          <span class="badge ${t.action === 'buy' ? 'badge-buy' : 'badge-sell'}" style="flex-shrink:0;">${t.action === 'buy' ? 'Buy' : 'Sell'}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;color:#374151;">${Utils.formatDate(t.date)} · ${Utils.formatShares(t.quantity)}股</div>
            <div style="font-size:11px;color:#94a3b8;">@ ${Utils.formatUSD(t.price)}${t.fee ? ' · fee ' + Utils.formatUSD(t.fee) : ''}</div>
          </div>
          <div style="font-size:13px;font-weight:700;color:${t.action === 'buy' ? '#ef4444' : '#10b981'};flex-shrink:0;">${t.action === 'buy' ? '-' : '+'}${Utils.formatUSD(net)}</div>
          <div style="display:flex;gap:2px;flex-shrink:0;">
            <button onclick="event.stopPropagation();PageUSStocks.openEditTrade('${t.id}')" style="background:none;border:none;cursor:pointer;font-size:14px;padding:2px;"><i class="fa-solid fa-pen fa-xs"></i></button>
            <button onclick="event.stopPropagation();PageUSStocks.delTrade('${t.id}')" style="background:none;border:none;cursor:pointer;font-size:14px;padding:2px;"><i class="fa-solid fa-trash fa-xs"></i></button>
          </div>
        </div>`;
      }).join('');

      return `
        <div style="background:white;border-radius:14px;padding:14px;margin-bottom:10px;box-shadow:0 1px 4px rgba(0,0,0,.06);">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <div style="font-size:17px;font-weight:700;color:#1d4ed8;">${h.symbol}</div>
              <div style="font-size:12px;color:#6b7280;margin-top:1px;">${h.name}</div>
              ${exDate ? `<div style="font-size:10px;background:#EDE9FE;color:#5b21b6;padding:1px 6px;border-radius:4px;margin-top:3px;display:inline-block;">💵 Ex ${exDate}</div>` : ''}
            </div>
            <div style="text-align:right;">
              <div style="font-size:17px;font-weight:700;color:#1e293b;">${hasPrice ? Utils.formatUSD(currentPrice) : '<span style="color:#d1d5db;">--</span>'}</div>
              ${changePct !== null ? `<div style="font-size:11px;color:${changePct >= 0 ? '#10b981' : '#ef4444'};">${changePct >= 0 ? '▲' : '▼'} ${Math.abs(changePct).toFixed(2)}%</div>` : ''}
            </div>
          </div>
          <div style="display:flex;margin-top:10px;padding-top:8px;border-top:1px solid #f1f5f9;">
            <div style="flex:1;text-align:center;">
              <div style="font-size:9px;color:#94a3b8;font-weight:500;margin-bottom:2px;">市值</div>
              <div style="font-size:13px;font-weight:600;color:#1e293b;">${marketValue !== null ? Utils.formatUSD(marketValue) : '--'}</div>
            </div>
            <div style="flex:1;text-align:center;border-left:1px solid #f1f5f9;">
              <div style="font-size:9px;color:#94a3b8;font-weight:500;margin-bottom:2px;">未實現損益</div>
              <div style="font-size:13px;font-weight:600;color:${unrealizedPnL !== null ? (unrealizedPnL >= 0 ? '#10b981' : '#ef4444') : '#94a3b8'};">
                ${unrealizedPnL !== null ? Utils.formatUSD(unrealizedPnL, true) : '--'}
              </div>
              ${unrealizedPct !== null ? `<div style="font-size:10px;color:${unrealizedPct >= 0 ? '#10b981' : '#ef4444'};">${unrealizedPct >= 0 ? '▲' : '▼'}${Math.abs(unrealizedPct).toFixed(2)}%</div>` : ''}
            </div>
            <div style="flex:1;text-align:center;border-left:1px solid #f1f5f9;">
              <div style="font-size:9px;color:#94a3b8;font-weight:500;margin-bottom:2px;">持股</div>
              <div style="font-size:13px;font-weight:600;color:#1e293b;">${Utils.formatShares(h.quantity)}股</div>
              <div style="font-size:10px;color:#94a3b8;">均 ${Utils.formatUSD(h.avgCost)}</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;margin-top:10px;padding-top:8px;border-top:1px solid #f1f5f9;">
            <button class="btn btn-primary btn-sm" onclick="PageUSStocks.openAddTrade('${h.symbol}','${h.name}')">＋ 交易</button>
            <button class="btn btn-sm btn-ghost gap-1" style="color:#8b5cf6;" onclick="PageUSStocks.openAddDividendFor('${h.symbol}')">股利</button>
            <button id="us-holding-arrow-${h.symbol}" class="btn btn-sm btn-ghost gap-1" style="margin-left:auto;"
              onclick="PageUSStocks.toggleHoldingTrades('${h.symbol}')">▼ 明細</button>
          </div>
          <div id="us-holding-trades-${h.symbol}" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid #f1f5f9;">
            <div style="font-size:11px;font-weight:600;color:#64748b;margin-bottom:4px;">交易紀錄</div>
            ${symbolTrades.length === 0
              ? '<div style="text-align:center;color:#9ca3af;font-size:12px;padding:8px 0;">尚無交易紀錄</div>'
              : tradeRows}
          </div>
        </div>`;
    }).join('');

    const holdingsForPie = holdings.map(h => {
      const p  = priceCache[h.symbol];
      const mv = (p && p.price && !p.error) ? p.price * h.quantity : h.totalCost;
      return { ...h, totalCost: mv };
    });
    const pieLabel = fetchTimes.length > 0 ? '持股分布（市值）' : '持股分布（成本）';

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        ${lastUpdateStr ? `<span style="font-size:11px;color:#9ca3af;">更新：${lastUpdateStr}</span>` : '<span></span>'}
        <button class="btn btn-sm btn-ghost gap-1" id="us-refresh-btn"
          onclick="PageUSStocks.refreshPrices()" ${_fetchingPrices ? 'disabled' : ''}>
          ${_fetchingPrices ? '更新中…' : '🔄 更新報價'}
        </button>
      </div>
      ${holdingCards}
      <div style="background:white;border-radius:14px;padding:14px;margin-top:4px;">
        <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:10px;">${pieLabel}</div>
        <canvas id="us-holdings-pie" style="max-height:220px;"></canvas>
      </div>
    `;

    setTimeout(() => Charts.renderHoldingsPie('us-holdings-pie', holdingsForPie, 'USD'), 50);
  }

  // ── Trades ──────────────────────────────────────────────────────
  function _renderTrades() {
    const trades    = Store.getStockTrades(MARKET).slice().reverse();
    const container = document.getElementById('us-tab-content');

    if (trades.length === 0) {
      container.innerHTML = `<div class="card"><div class="empty-state"><div class="empty-state-icon">🔄</div><div class="empty-state-text">尚無交易紀錄</div></div></div>`;
      return;
    }

    container.innerHTML = `
      <div style="background:white;border-radius:14px;overflow:hidden;">
        ${trades.map(t => {
          const gross = t.quantity * t.price;
          const net   = t.action === 'buy' ? gross + (t.fee || 0) : gross - (t.fee || 0);
          return `
            <div style="border-bottom:1px solid #f1f5f9;">
              <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;">
                <span class="badge ${t.action === 'buy' ? 'badge-buy' : 'badge-sell'}" style="flex-shrink:0;">${t.action === 'buy' ? 'Buy' : 'Sell'}</span>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:700;">
                    <span style="color:#1d4ed8;">${t.symbol}</span>
                    <span style="font-weight:400;color:#374151;font-size:12px;"> ${t.name}</span>
                  </div>
                  <div style="font-size:11px;color:#94a3b8;">${Utils.formatDate(t.date)}</div>
                </div>
                <div style="text-align:right;flex-shrink:0;">
                  <div style="font-size:14px;font-weight:700;color:${t.action === 'buy' ? '#ef4444' : '#10b981'};">
                    ${t.action === 'buy' ? '-' : '+'}${Utils.formatUSD(net)}
                  </div>
                  <div style="font-size:10px;color:#94a3b8;">${Utils.formatShares(t.quantity)}股</div>
                </div>
                <button id="us-trade-arrow-${t.id}" onclick="PageUSStocks.toggleTradeDetail('${t.id}')"
                  style="background:none;border:1px solid #e2e8f0;border-radius:6px;padding:4px 7px;cursor:pointer;color:#94a3b8;font-size:12px;flex-shrink:0;">▼</button>
              </div>
              <div id="us-trade-detail-${t.id}" style="display:none;padding:0 14px 12px;background:#f8fafc;">
                <div style="display:flex;flex-wrap:wrap;gap:8px 20px;font-size:12px;color:#374151;padding-bottom:10px;">
                  <div><span style="color:#94a3b8;">單價</span> ${Utils.formatUSD(t.price)}</div>
                  <div><span style="color:#94a3b8;">股數</span> ${Utils.formatShares(t.quantity)}</div>
                  ${t.fee ? `<div><span style="color:#94a3b8;">手續費</span> ${Utils.formatUSD(t.fee)}</div>` : ''}
                </div>
                <div style="display:flex;gap:8px;">
                  <button class="btn btn-sm btn-ghost gap-1" onclick="PageUSStocks.openEditTrade('${t.id}')"><i class="fa-solid fa-pen fa-xs"></i> 編輯</button>
                  <button class="btn btn-sm btn-ghost text-error gap-1" onclick="PageUSStocks.delTrade('${t.id}')"><i class="fa-solid fa-trash fa-xs"></i> 刪除</button>
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>`;
  }

  // ── Dividends ───────────────────────────────────────────────────
  function _renderDividends() {
    const divs      = Store.getDividends(MARKET).slice().sort((a, b) => b.date.localeCompare(a.date));
    const container = document.getElementById('us-tab-content');

    if (divs.length === 0) {
      container.innerHTML = `
        <div class="card">
          <div class="empty-state">
            <div class="empty-state-icon">💵</div>
            <div class="empty-state-text">尚無股利紀錄</div>
            <button class="btn btn-primary" style="margin-top:12px;" onclick="PageUSStocks.openAddDividend()"><i class="fa-solid fa-plus fa-xs"></i> 新增股利</button>
          </div>
        </div>`;
      return;
    }

    const bySymbol = {};
    divs.forEach(d => {
      if (!bySymbol[d.symbol]) bySymbol[d.symbol] = { symbol: d.symbol, name: d.name, cashTotal: 0, count: 0 };
      bySymbol[d.symbol].cashTotal += d.cashTotal || 0;
      bySymbol[d.symbol].count++;
    });
    const grouped    = Object.values(bySymbol).sort((a, b) => b.cashTotal - a.cashTotal);
    const grandTotal = grouped.reduce((s, g) => s + g.cashTotal, 0);

    container.innerHTML = `
      <div style="background:#f0fdf4;border-radius:14px;padding:14px 16px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:11px;color:#6b7280;font-weight:500;">累計股利收入</div>
          <div style="font-size:22px;font-weight:700;color:#059669;">${Utils.formatUSD(grandTotal)}</div>
        </div>
        <div style="text-align:right;font-size:12px;color:#9ca3af;">${divs.length} 筆 · ${grouped.length} 檔</div>
      </div>

      ${grouped.map(g => {
        const symbolDivs = divs.filter(d => d.symbol === g.symbol);
        const detailRows = symbolDivs.map(d => `
          <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #f1f5f9;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;font-weight:600;color:#374151;">${Utils.formatDate(d.date)}</div>
              ${d.note ? '<div style="font-size:11px;color:#94a3b8;">' + d.note + '</div>' : ''}
            </div>
            <div style="text-align:right;flex-shrink:0;">
              ${d.cashTotal > 0 ? '<div style="font-size:13px;font-weight:600;color:#8b5cf6;">' + Utils.formatUSD(d.cashTotal) + '</div>' : ''}
            </div>
            <div style="display:flex;gap:2px;flex-shrink:0;">
              <button onclick="event.stopPropagation();PageUSStocks.openEditDividend('${d.id}')" style="background:none;border:none;cursor:pointer;font-size:14px;padding:2px;"><i class="fa-solid fa-pen fa-xs"></i></button>
              <button onclick="event.stopPropagation();PageUSStocks.delDividend('${d.id}')" style="background:none;border:none;cursor:pointer;font-size:14px;padding:2px;"><i class="fa-solid fa-trash fa-xs"></i></button>
            </div>
          </div>`).join('');

        return `
          <div style="background:white;border-radius:14px;margin-bottom:10px;overflow:hidden;">
            <div onclick="PageUSStocks.toggleDivGroup('${g.symbol}')"
              style="display:flex;align-items:center;padding:14px 16px;cursor:pointer;border-left:4px solid #8b5cf6;">
              <div style="flex:1;min-width:0;">
                <div style="font-size:15px;font-weight:700;color:#1d4ed8;">${g.symbol}</div>
                <div style="font-size:11px;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${g.name}</div>
              </div>
              <div style="text-align:right;margin-right:12px;">
                <div style="font-size:16px;font-weight:700;color:#8b5cf6;">${Utils.formatUSD(g.cashTotal)}</div>
                <div style="font-size:11px;color:#9ca3af;">${g.count} 次紀錄</div>
              </div>
              <span id="us-div-arrow-${g.symbol}" style="color:#94a3b8;font-size:14px;flex-shrink:0;">▼</span>
            </div>
            <div id="us-div-detail-${g.symbol}" style="display:none;padding:0 16px 12px;">
              <div style="display:flex;justify-content:flex-end;padding-top:8px;padding-bottom:4px;">
                <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();PageUSStocks.openAddDividendFor('${g.symbol}')"><i class="fa-solid fa-plus fa-xs"></i> 新增</button>
              </div>
              ${detailRows}
            </div>
          </div>`;
      }).join('')}
    `;
  }

  // ── PnL Tab ──────────────────────────────────────────────────────
  function _renderPnL() {
    const timeline  = Store.getPnLTimeline(MARKET);
    const realized  = Store.getRealizedTrades(MARKET);
    const container = document.getElementById('us-tab-content');

    container.innerHTML = `
      <div style="display:grid;gap:20px;">
        <div class="card">
          <div class="card-title" style="margin-bottom:4px;">損益走勢</div>
          <div class="chart-container" style="height:280px;">
            <canvas id="us-pnl-chart"></canvas>
          </div>
        </div>
        ${realized.length > 0 ? `
        <div style="background:white;border-radius:14px;overflow:hidden;">
          <div style="padding:14px 16px;font-weight:600;color:#374151;border-bottom:1px solid #f1f5f9;">已實現交易紀錄</div>
          ${realized.slice().reverse().map(r => `
            <div style="display:flex;align-items:center;gap:10px;padding:11px 16px;border-bottom:1px solid #f8fafc;">
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:700;"><span style="color:#1d4ed8;">${r.symbol}</span> <span style="font-weight:400;color:#374151;font-size:12px;">${r.name}</span></div>
                <div style="font-size:11px;color:#94a3b8;">${Utils.formatDate(r.date)} · ${Utils.formatShares(r.quantity)}股 @ ${Utils.formatUSD(r.sellPrice)}</div>
              </div>
              <div style="text-align:right;flex-shrink:0;">
                <div style="font-size:14px;font-weight:700;${Utils.pnlClass(r.pnl) === 'text-green' ? 'color:#10b981' : 'color:#ef4444'};">${Utils.formatUSD(r.pnl, true)}</div>
                <div style="font-size:11px;color:#94a3b8;">${Utils.pnlArrow(r.pnlPct)} ${Math.abs(r.pnlPct).toFixed(2)}%</div>
              </div>
            </div>`).join('')}
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
    Modal.openDividend(MARKET, null, _refresh);
  }

  function openAddDividendFor(symbol) {
    const trade = Store.getStockTrades(MARKET).find(t => t.symbol === symbol);
    Modal.openDividend(MARKET, { symbol, name: trade?.name || '', market: MARKET }, _refresh);
  }

  function openEditDividend(id) {
    const d = Store.getDividends(MARKET).find(d => d.id === id);
    if (d) Modal.openDividend(MARKET, d, _refresh);
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

  function toggleHoldingTrades(symbol) {
    const detail = document.getElementById('us-holding-trades-' + symbol);
    const btn    = document.getElementById('us-holding-arrow-' + symbol);
    if (!detail) return;
    const isOpen = detail.style.display !== 'none';
    detail.style.display = isOpen ? 'none' : '';
    if (btn) btn.textContent = isOpen ? '▼ 明細' : '▲ 收起';
  }

  function toggleTradeDetail(id) {
    const detail = document.getElementById('us-trade-detail-' + id);
    const btn    = document.getElementById('us-trade-arrow-' + id);
    if (!detail) return;
    const isOpen = detail.style.display !== 'none';
    detail.style.display = isOpen ? 'none' : '';
    if (btn) btn.textContent = isOpen ? '▼' : '▲';
  }

  function toggleDivGroup(symbol) {
    const detail = document.getElementById('us-div-detail-' + symbol);
    const arrow  = document.getElementById('us-div-arrow-' + symbol);
    if (!detail) return;
    const open = detail.style.display === 'none';
    detail.style.display = open ? '' : 'none';
    if (arrow) arrow.textContent = open ? '▲' : '▼';
  }

  function _refresh() {
    render();
  }

  // ── Price Refresh ───────────────────────────────────────────────
  async function refreshPrices() {
    if (_fetchingPrices) return;
    _fetchingPrices = true;

    const btn = document.getElementById('us-refresh-btn');
    if (btn) { btn.disabled = true; btn.textContent = '更新中…'; }

    try {
      const holdings = Store.getHoldings(MARKET);
      if (holdings.length === 0) { Utils.showToast('尚無持股'); return; }

      const symbols   = holdings.map(h => h.symbol);
      const newPrices = await StockPrice.fetchPrices(MARKET, symbols);
      const allPrices = Store.getStockPrices();
      Object.assign(allPrices, newPrices);
      Store.saveStockPrices(allPrices);

      const ok = Object.values(newPrices).filter(p => !p.error).length;
      Utils.showToast(`已更新 ${ok}/${symbols.length} 檔報價`);

      _renderSummary();
      if (_activeTab === 'holdings') _renderHoldings();
    } catch (e) {
      Utils.showToast('報價更新失敗：' + e.message);
    } finally {
      _fetchingPrices = false;
      const btn2 = document.getElementById('us-refresh-btn');
      if (btn2) { btn2.disabled = false; btn2.textContent = '🔄 更新報價'; }
    }
  }

  return {
    render, switchTab,
    openAddTrade, openEditTrade, delTrade,
    openAddDividend, openAddDividendFor, openEditDividend, delDividend,
    openImport,
    toggleHoldingTrades, toggleTradeDetail, toggleDivGroup,
    refreshPrices,
  };
})();
