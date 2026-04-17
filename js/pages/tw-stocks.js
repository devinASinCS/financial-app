/**
 * Taiwan Stocks page
 */
const PageTWStocks = (() => {
  const MARKET = 'TW';
  let _activeTab = 'holdings';
  let _fetchingPrices = false;
  let _autoFetchDone  = false;

  function render() {
    const pendingDca = Store.getPendingDcaPlans(MARKET);

    document.getElementById('app-content').innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">🇹🇼 台股投資組合</div>
          <div class="page-subtitle">台灣上市、上櫃股票</div>
        </div>
        <div style="display:flex;gap:8px;" id="tw-action-btns"></div>
      </div>

      ${pendingDca.length > 0 ? `
        <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px;">
          <span style="font-size:18px;">🔔</span>
          <div style="flex:1;">
            <strong style="color:#1D4ED8;">定期定額待執行</strong>
            <div style="font-size:13px;color:#1E40AF;margin-top:2px;">
              ${pendingDca.map(p => `${p.symbol} ${p.name}（${Utils.formatTWD(p.monthlyAmount)}/月）`).join('、')}
            </div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="PageTWStocks.switchTab('dca')">前往執行</button>
        </div>
      ` : ''}

      <!-- Summary Cards -->
      <div class="grid-4" style="margin-bottom:20px;" id="tw-summary-cards"></div>

      <!-- Tabs -->
      <div class="tab-bar">
        <button class="tab-btn ${_activeTab==='holdings'?'active':''}" onclick="PageTWStocks.switchTab('holdings')">📋 持股</button>
        <button class="tab-btn ${_activeTab==='trades'?'active':''}" onclick="PageTWStocks.switchTab('trades')">🔄 交易紀錄</button>
        <button class="tab-btn ${_activeTab==='dividends'?'active':''}" onclick="PageTWStocks.switchTab('dividends')">💵 除權息</button>
        <button class="tab-btn ${_activeTab==='dca'?'active':''}" onclick="PageTWStocks.switchTab('dca')">
          📅 定期定額${pendingDca.length > 0 ? ` <span style="background:#EF4444;color:white;border-radius:10px;padding:1px 6px;font-size:10px;">${pendingDca.length}</span>` : ''}
        </button>
        <button class="tab-btn ${_activeTab==='pnl'?'active':''}" onclick="PageTWStocks.switchTab('pnl')">📈 損益走勢</button>
      </div>

      <div id="tw-tab-content"></div>
    `;

    _renderSummary();
    _renderActionBtns();
    _renderTab();

    // Auto-fetch closing prices after market hours if cache is stale
    if (!_autoFetchDone) {
      _autoFetchDone = true;
      setTimeout(() => {
        const holdings = Store.getHoldings(MARKET);
        if (holdings.length > 0 && !StockPrice.isMarketOpen(MARKET)) {
          const anyStale = holdings.some(h => StockPrice.isCacheStale(h.symbol));
          if (anyStale) refreshPrices();
        }
      }, 800);
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

    // Compute market value from cached prices
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
    const hasPrices      = priceCount > 0;
    const unrealizedPnL  = hasPrices ? totalMarketValue - totalCost : null;
    const unrealizedPct  = totalCost > 0 && unrealizedPnL !== null ? (unrealizedPnL / totalCost * 100) : null;

    document.getElementById('tw-summary-cards').innerHTML = `
      <div class="card">
        <div class="card-title">持股成本</div>
        <div class="stat-value">${Utils.formatTWD(totalCost)}</div>
        <div class="stat-sub">${hasPrices
          ? '市值 ' + Utils.formatTWD(totalMarketValue)
          : holdings.length + ' 檔持股'}</div>
      </div>
      <div class="card">
        <div class="card-title">未實現損益</div>
        ${unrealizedPnL !== null
          ? `<div class="stat-value ${Utils.pnlClass(unrealizedPnL)}">${Utils.formatTWD(unrealizedPnL, true)}</div>
             <div class="stat-sub ${Utils.pnlClass(unrealizedPct)}">${Utils.pnlArrow(unrealizedPct)} ${Math.abs(unrealizedPct).toFixed(2)}%</div>`
          : `<div class="stat-value" style="color:#9CA3AF;font-size:14px;">--</div>
             <div class="stat-sub"><a href="#" style="color:#3B82F6;" onclick="event.preventDefault();PageTWStocks.refreshPrices()">點此更新報價</a></div>`
        }
      </div>
      <div class="card">
        <div class="card-title">已實現損益</div>
        <div class="stat-value ${Utils.pnlClass(realizedPnL)}">${Utils.formatTWD(realizedPnL, true)}</div>
        <div class="stat-sub">${realized.length} 筆賣出</div>
      </div>
      <div class="card">
        <div class="card-title">累計股利收入</div>
        <div class="stat-value" style="color:#8B5CF6;">${Utils.formatTWD(divIncome)}</div>
        <div class="stat-sub">${divs.length} 次除息</div>
      </div>
    `;
  }

  function _renderActionBtns() {
    const btns = {
      holdings:  `<button class="btn btn-secondary" onclick="PageTWStocks.openImport()">📥 匯入對帳單</button>
                  <button class="btn btn-primary" onclick="PageTWStocks.openAddTrade()">＋ 新增交易</button>`,
      trades:    `<button class="btn btn-secondary" onclick="PageTWStocks.openImport()">📥 匯入對帳單</button>
                  <button class="btn btn-primary" onclick="PageTWStocks.openAddTrade()">＋ 新增交易</button>`,
      dividends: `<button class="btn btn-primary" onclick="PageTWStocks.openAddDividend()">＋ 新增除權息</button>`,
      dca:       `<button class="btn btn-primary" onclick="PageTWStocks.openAddDca()">＋ 新增定期定額</button>`,
      pnl:       '',
    };
    document.getElementById('tw-action-btns').innerHTML = btns[_activeTab] || '';
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
      case 'dca':       _renderDca(); break;
      case 'pnl':       _renderPnL(); break;
    }
  }

  // ── Holdings Tab ────────────────────────────────────────────────
  function _renderHoldings() {
    const holdings     = Store.getHoldings(MARKET);
    const container    = document.getElementById('tw-tab-content');
    const priceCache   = Store.getStockPrices();
    const upcomingDivs = Store.getUpcomingTWDivs();

    if (holdings.length === 0) {
      container.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
          <div class="card">
            <div class="empty-state"><div class="empty-state-icon">📋</div>
            <div class="empty-state-text">尚無持股，請新增交易紀錄</div></div>
          </div>
          <div class="card">
            <div class="empty-state"><div class="empty-state-icon">📊</div>
            <div class="empty-state-text">持股分布圖</div></div>
          </div>
        </div>`;
      return;
    }

    // Match upcoming TWSE ex-dividend events to our holdings
    const mySymbols = new Set(holdings.map(h => h.symbol));
    const relevantUpcoming = upcomingDivs.filter(d => {
      const sym = d['股票代號'] ?? d['代號'] ?? '';
      return mySymbols.has(sym);
    });

    // Last price update timestamp
    const fetchTimes = holdings
      .map(h => priceCache[h.symbol]?.fetchedAt)
      .filter(Boolean)
      .map(t => new Date(t).getTime());
    const lastUpdateMs  = fetchTimes.length ? Math.max(...fetchTimes) : 0;
    const lastUpdateStr = lastUpdateMs
      ? new Date(lastUpdateMs).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : null;

    // Upcoming ex-dividend alert banner
    const upcomingAlert = relevantUpcoming.length > 0 ? `
      <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:flex-start;gap:12px;">
        <span style="font-size:18px;line-height:1.4;">📅</span>
        <div>
          <strong style="color:#92400E;">即將除權息提醒</strong>
          <div style="font-size:13px;color:#78350F;margin-top:4px;">
            ${relevantUpcoming.map(d => {
              const sym    = d['股票代號'] ?? d['代號'] ?? '';
              const name   = d['名稱'] ?? '';
              const exDate = d['除息日'] ?? d['除權日'] ?? d['除權息日'] ?? '';
              const type   = d['除息或除權'] ?? d['類別'] ?? '';
              const cash   = d['每股配息'] ?? d['現金股利'] ?? '';
              const stock  = d['每股配股'] ?? d['股票股利'] ?? '';
              const detail = [
                cash  ? `配息 ${cash}` : '',
                stock ? `配股 ${stock}` : '',
              ].filter(Boolean).join('、');
              return `<div style="margin-top:2px;">🔹 <strong>${sym} ${name}</strong>${type ? ' ' + type : ''} — 除息日 ${exDate}${detail ? '（' + detail + '）' : ''}</div>`;
            }).join('')}
          </div>
        </div>
      </div>` : '';

    // Build table rows with live price columns
    const tableRows = holdings.map(h => {
      const p             = priceCache[h.symbol];
      const hasPrice      = p && p.price && !p.error;
      const currentPrice  = hasPrice ? p.price : null;
      const marketValue   = currentPrice !== null ? currentPrice * h.quantity : null;
      const unrealizedPnL = marketValue !== null ? marketValue - h.totalCost : null;
      const unrealizedPct = h.totalCost > 0 && unrealizedPnL !== null ? unrealizedPnL / h.totalCost * 100 : null;

      const changePct     = hasPrice && p.changePercent !== undefined ? p.changePercent : null;
      const changeHtml    = changePct !== null
        ? `<div style="font-size:11px;${changePct >= 0 ? 'color:#10B981' : 'color:#EF4444'};">${changePct >= 0 ? '▲' : '▼'} ${Math.abs(changePct).toFixed(2)}%</div>`
        : '';

      // Upcoming ex-div badge for this symbol
      const upDiv  = relevantUpcoming.find(d => (d['股票代號'] ?? d['代號'] ?? '') === h.symbol);
      const exDate = upDiv ? (upDiv['除息日'] ?? upDiv['除權日'] ?? upDiv['除權息日'] ?? '') : '';
      const exBadge = exDate
        ? `<div style="font-size:10px;background:#FEF3C7;color:#92400E;padding:1px 5px;border-radius:4px;margin-top:2px;white-space:nowrap;">📅 ${exDate}</div>`
        : '';

      return `
        <tr>
          <td>
            <strong style="color:#1D4ED8;">${h.symbol}</strong>
            ${exBadge}
          </td>
          <td>${h.name}</td>
          <td class="text-right">${Utils.formatShares(h.quantity)}</td>
          <td class="text-right">${Utils.formatTWD(h.avgCost)}</td>
          <td class="text-right">
            ${hasPrice ? Utils.formatTWD(currentPrice) : '<span style="color:#D1D5DB;">--</span>'}
            ${changeHtml}
          </td>
          <td class="text-right">
            ${marketValue !== null ? Utils.formatTWD(marketValue) : '<span style="color:#D1D5DB;">--</span>'}
          </td>
          <td class="text-right ${unrealizedPnL !== null ? Utils.pnlClass(unrealizedPnL) : ''}">
            ${unrealizedPnL !== null
              ? `${Utils.formatTWD(unrealizedPnL, true)}<div style="font-size:11px;">${Utils.pnlArrow(unrealizedPct)} ${Math.abs(unrealizedPct).toFixed(2)}%</div>`
              : '<span style="color:#D1D5DB;">--</span>'
            }
          </td>
          <td class="text-center">
            <button class="btn btn-secondary btn-sm" onclick="PageTWStocks.openAddTrade('${h.symbol}','${h.name}')">交易</button>
            <button class="btn btn-secondary btn-sm" style="margin-left:4px;color:#8B5CF6;" onclick="PageTWStocks.openAddDividendFor('${h.symbol}')">除權息</button>
          </td>
        </tr>
      `;
    }).join('');

    // For pie chart: use market value when prices are available
    const holdingsForPie = holdings.map(h => {
      const p  = priceCache[h.symbol];
      const mv = (p && p.price && !p.error) ? p.price * h.quantity : h.totalCost;
      return { ...h, totalCost: mv };
    });
    const pieLabel = fetchTimes.length > 0 ? '持股分布（市值）' : '持股分布（成本）';

    container.innerHTML = `
      ${upcomingAlert}
      <div style="display:grid;grid-template-columns:3fr 2fr;gap:20px;">
        <div class="card" style="overflow-x:auto;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <div class="card-title" style="margin:0;">持股明細</div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
              ${lastUpdateStr ? `<span style="font-size:11px;color:#9CA3AF;">更新：${lastUpdateStr}</span>` : ''}
              <button class="btn btn-secondary btn-sm" id="tw-refresh-btn"
                onclick="PageTWStocks.refreshPrices()" ${_fetchingPrices ? 'disabled' : ''}>
                ${_fetchingPrices ? '更新中…' : '🔄 更新報價'}
              </button>
            </div>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>代號</th>
                <th>名稱</th>
                <th class="text-right">持股數</th>
                <th class="text-right">平均成本</th>
                <th class="text-right">現價</th>
                <th class="text-right">市值</th>
                <th class="text-right">未實現損益</th>
                <th class="text-center">操作</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
        <div class="card">
          <div class="card-title" style="margin-bottom:12px;">${pieLabel}</div>
          <canvas id="tw-holdings-pie"></canvas>
        </div>
      </div>
    `;

    setTimeout(() => Charts.renderHoldingsPie('tw-holdings-pie', holdingsForPie, 'TWD'), 50);
  }

  // ── Trades Tab ──────────────────────────────────────────────────
  function _renderTrades() {
    const trades = Store.getStockTrades(MARKET).slice().reverse();
    const container = document.getElementById('tw-tab-content');

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
              <th style="font-size:11px;color:#9CA3AF;">來源</th>
              <th class="text-right">股數</th>
              <th class="text-right">價格</th>
              <th class="text-right">手續費</th>
              <th class="text-right">交易稅</th>
              <th class="text-right">金額</th>
              <th class="text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            ${trades.map(t => {
              const gross = t.quantity * t.price;
              const net = t.action === 'buy'
                ? gross + (t.fee||0) + (t.tax||0)
                : gross - (t.fee||0) - (t.tax||0);
              return `
                <tr>
                  <td>${Utils.formatDate(t.date)}</td>
                  <td><strong style="color:#1D4ED8;">${t.symbol}</strong></td>
                  <td>${t.name}</td>
                  <td class="text-center">
                    <span class="badge ${t.action==='buy'?'badge-buy':'badge-sell'}">
                      ${t.action==='buy'?'買進':'賣出'}
                    </span>
                  </td>
                  <td style="font-size:11px;color:#9CA3AF;">${t.source === 'dca' ? '📅DCA' : '手動'}</td>
                  <td class="text-right">${Utils.formatShares(t.quantity)}</td>
                  <td class="text-right">${Utils.formatTWD(t.price)}</td>
                  <td class="text-right" style="color:#9CA3AF;">${Utils.formatTWD(t.fee||0)}</td>
                  <td class="text-right" style="color:#9CA3AF;">${Utils.formatTWD(t.tax||0)}</td>
                  <td class="text-right" style="font-weight:600;color:${t.action==='buy'?'#EF4444':'#10B981'};">
                    ${t.action==='buy'?'-':'+'}${Utils.formatTWD(net)}
                  </td>
                  <td class="text-center">
                    <button class="btn btn-secondary btn-sm" onclick="PageTWStocks.openEditTrade('${t.id}')">編輯</button>
                    <button class="btn btn-danger btn-sm" style="margin-left:4px;" onclick="PageTWStocks.delTrade('${t.id}')">刪除</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ── Dividends Tab ───────────────────────────────────────────────
  function _renderDividends() {
    const divs      = Store.getDividends(MARKET).slice().sort((a, b) => b.date.localeCompare(a.date));
    const container = document.getElementById('tw-tab-content');

    if (divs.length === 0) {
      container.innerHTML = `
        <div class="card">
          <div class="empty-state">
            <div class="empty-state-icon">💵</div>
            <div class="empty-state-text">尚無除權息紀錄</div>
            <button class="btn btn-primary" style="margin-top:12px;" onclick="PageTWStocks.openAddDividend()">＋ 新增除權息</button>
          </div>
        </div>`;
      return;
    }

    // Group by symbol → sorted by total cash desc
    const bySymbol = {};
    divs.forEach(d => {
      if (!bySymbol[d.symbol]) bySymbol[d.symbol] = { symbol: d.symbol, name: d.name, cashTotal: 0, stockShares: 0, count: 0 };
      bySymbol[d.symbol].cashTotal    += d.cashTotal    || 0;
      bySymbol[d.symbol].stockShares  += d.stockShares  || 0;
      bySymbol[d.symbol].count++;
    });
    const grouped = Object.values(bySymbol).sort((a, b) => b.cashTotal - a.cashTotal);
    const grandTotal = grouped.reduce((s, g) => s + g.cashTotal, 0);

    container.innerHTML = `
      <!-- Grand total summary -->
      <div class="card" style="border-left:4px solid #10B981;padding:14px 16px;background:#F0FDF4;margin-bottom:12px;display:flex;align-items:center;gap:24px;">
        <div>
          <div style="font-size:12px;color:#6B7280;">累計股利總計</div>
          <div style="font-size:22px;font-weight:700;color:#059669;">${Utils.formatTWD(grandTotal)}</div>
        </div>
        <div style="font-size:12px;color:#9CA3AF;">${divs.length} 筆紀錄 · ${grouped.length} 檔股票</div>
      </div>

      <!-- Per-stock expandable cards -->
      <div style="margin-bottom:20px;">
        ${grouped.map(g => {
          const symbolDivs = divs.filter(d => d.symbol === g.symbol).sort((a, b) => b.date.localeCompare(a.date));
          const detailRows = symbolDivs.map(d => `
            <tr>
              <td style="white-space:nowrap;">${Utils.formatDate(d.date)}</td>
              <td class="text-right" style="color:#8B5CF6;font-weight:600;">${d.cashTotal > 0 ? Utils.formatTWD(d.cashTotal) : '-'}</td>
              <td class="text-right" style="color:#3B82F6;">${d.stockShares > 0 ? d.stockShares + ' 股' : '-'}</td>
              <td style="font-size:12px;color:#6B7280;">${d.note || '-'}</td>
              <td class="text-center">
                <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();PageTWStocks.openEditDividend('${d.id}')">編輯</button>
                <button class="btn btn-danger btn-sm" style="margin-left:4px;" onclick="event.stopPropagation();PageTWStocks.delDividend('${d.id}')">刪除</button>
              </td>
            </tr>`).join('');
          return `
            <div class="card" style="margin-bottom:8px;padding:14px 16px;cursor:pointer;border-left:4px solid #8B5CF6;" onclick="PageTWStocks.toggleDivGroup('${g.symbol}')">
              <div style="display:flex;align-items:center;gap:12px;">
                <div style="min-width:60px;">
                  <div style="font-weight:700;color:#1D4ED8;font-size:15px;">${g.symbol}</div>
                  <div style="font-size:12px;color:#6B7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px;">${g.name}</div>
                </div>
                <div style="flex:1;">
                  <div style="font-size:18px;font-weight:700;color:#8B5CF6;">${Utils.formatTWD(g.cashTotal)}</div>
                  ${g.stockShares > 0 ? `<div style="font-size:12px;color:#3B82F6;">+ ${g.stockShares} 股配股</div>` : ''}
                </div>
                <div style="font-size:11px;color:#9CA3AF;white-space:nowrap;">${g.count} 次紀錄</div>
                <span id="div-arrow-${g.symbol}" style="color:#9CA3AF;font-size:12px;margin:0 4px;">▼</span>
                <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();PageTWStocks.openAddDividendFor('${g.symbol}')">＋ 新增</button>
              </div>
              <div id="div-detail-${g.symbol}" style="display:none;margin-top:12px;border-top:1px solid #E2E8F0;padding-top:10px;overflow-x:auto;">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th class="text-right">現金股利</th>
                      <th class="text-right">配股</th>
                      <th>備註</th>
                      <th class="text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody>${detailRows}</tbody>
                  <tfoot>
                    <tr style="font-weight:600;background:#F8FAFC;">
                      <td>合計</td>
                      <td class="text-right" style="color:#8B5CF6;">${Utils.formatTWD(g.cashTotal)}</td>
                      <td class="text-right" style="color:#3B82F6;">${g.stockShares > 0 ? g.stockShares + ' 股' : '-'}</td>
                      <td colspan="2"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>`;
        }).join('')}
      </div>

      <!-- Full history table -->
      <div class="card" style="overflow-x:auto;">
        <div class="card-title" style="margin-bottom:12px;">完整除權息紀錄</div>
        <table class="data-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>代號</th>
              <th>名稱</th>
              <th class="text-right">現金股利</th>
              <th class="text-right">配股股數</th>
              <th>備註</th>
              <th class="text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            ${divs.map(d => `
              <tr>
                <td style="white-space:nowrap;">${Utils.formatDate(d.date)}</td>
                <td><strong style="color:#1D4ED8;">${d.symbol}</strong></td>
                <td>${d.name}</td>
                <td class="text-right" style="color:#8B5CF6;font-weight:600;">${d.cashTotal > 0 ? Utils.formatTWD(d.cashTotal) : '-'}</td>
                <td class="text-right" style="color:#3B82F6;">${d.stockShares > 0 ? d.stockShares + ' 股' : '-'}</td>
                <td style="font-size:12px;color:#6B7280;">${d.note || '-'}</td>
                <td class="text-center">
                  <button class="btn btn-secondary btn-sm" onclick="PageTWStocks.openEditDividend('${d.id}')">編輯</button>
                  <button class="btn btn-danger btn-sm" style="margin-left:4px;" onclick="PageTWStocks.delDividend('${d.id}')">刪除</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ── DCA Tab ─────────────────────────────────────────────────────
  function _renderDca() {
    const plans = Store.getDcaPlans(MARKET);
    const pending = Store.getPendingDcaPlans(MARKET);
    const pendingIds = new Set(pending.map(p => p.id));
    const container = document.getElementById('tw-tab-content');

    if (plans.length === 0) {
      container.innerHTML = `
        <div class="card">
          <div class="empty-state">
            <div class="empty-state-icon">📅</div>
            <div class="empty-state-text">尚未設定定期定額計畫</div>
            <p style="font-size:13px;color:#6B7280;max-width:360px;text-align:center;margin:8px auto 0;">
              設定後，系統會在每月執行日提醒你，並根據你輸入的成交價格自動計算張數。
            </p>
            <button class="btn btn-primary" style="margin-top:12px;" onclick="PageTWStocks.openAddDca()">＋ 新增定期定額</button>
          </div>
        </div>`;
      return;
    }

    const today = new Date();
    const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;

    container.innerHTML = `
      <div class="card">
        <table class="data-table">
          <thead>
            <tr>
              <th>股票</th>
              <th class="text-right">每月投入</th>
              <th>執行日</th>
              <th>本月狀態</th>
              <th class="text-center">啟用</th>
              <th class="text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            ${plans.map(p => {
              const isDue = pendingIds.has(p.id);
              const isDone = p.lastExecutedMonth === currentMonthKey;
              return `
                <tr>
                  <td>
                    <div style="font-weight:600;color:#1D4ED8;">${p.symbol}</div>
                    <div style="font-size:12px;color:#6B7280;">${p.name}</div>
                  </td>
                  <td class="text-right" style="font-weight:600;">${Utils.formatTWD(p.monthlyAmount)}</td>
                  <td>每月 ${p.executionDay} 日</td>
                  <td>
                    ${!p.active
                      ? '<span style="color:#9CA3AF;font-size:12px;">已停用</span>'
                      : isDone
                        ? '<span style="color:#10B981;font-size:12px;">✓ 本月已執行</span>'
                        : isDue
                          ? '<span style="color:#F59E0B;font-size:12px;font-weight:600;">⚡ 待執行</span>'
                          : `<span style="color:#9CA3AF;font-size:12px;">${p.executionDay} 日執行</span>`
                    }
                  </td>
                  <td class="text-center">
                    <input type="checkbox" ${p.active ? 'checked' : ''}
                      onchange="PageTWStocks.toggleDca('${p.id}', this.checked)"
                      style="width:15px;height:15px;cursor:pointer;">
                  </td>
                  <td class="text-center">
                    ${isDue ? `<button class="btn btn-primary btn-sm" onclick="PageTWStocks.executeDca('${p.id}')" style="margin-right:4px;">執行</button>` : ''}
                    <button class="btn btn-secondary btn-sm" onclick="PageTWStocks.openEditDca('${p.id}')">編輯</button>
                    <button class="btn btn-danger btn-sm" style="margin-left:4px;" onclick="PageTWStocks.delDca('${p.id}')">刪除</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ── P&L Tab ─────────────────────────────────────────────────────
  function _renderPnL() {
    const timeline = Store.getPnLTimeline(MARKET);
    const realized = Store.getRealizedTrades(MARKET);
    const container = document.getElementById('tw-tab-content');

    container.innerHTML = `
      <div style="display:grid;gap:20px;">
        <div class="card">
          <div class="card-title" style="margin-bottom:4px;">損益走勢</div>
          <div class="chart-container" style="height:280px;">
            <canvas id="tw-pnl-chart"></canvas>
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
                <th class="text-right">成本</th>
                <th class="text-right">收入</th>
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
                  <td class="text-right">${Utils.formatTWD(r.avgCost)}</td>
                  <td class="text-right">${Utils.formatTWD(r.sellPrice)}</td>
                  <td class="text-right">${Utils.formatTWD(r.cost)}</td>
                  <td class="text-right">${Utils.formatTWD(r.proceeds)}</td>
                  <td class="text-right ${Utils.pnlClass(r.pnl)}">${Utils.formatTWD(r.pnl, true)}</td>
                  <td class="text-right ${Utils.pnlClass(r.pnlPct)}">${Utils.pnlArrow(r.pnlPct)} ${Math.abs(r.pnlPct).toFixed(2)}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ` : ''}
      </div>
    `;

    setTimeout(() => Charts.renderPnLLine('tw-pnl-chart', timeline, 'TWD'), 50);
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
    if (!Utils.confirm('確定刪除此除權息紀錄？')) return;
    Store.deleteDividend(id);
    Utils.showToast('已刪除');
    _refresh();
  }

  function openImport() {
    Modal.openImport(MARKET, _refresh);
  }

  // DCA actions
  function openAddDca() {
    Modal.openDcaPlan(MARKET, null, _refresh);
  }

  function openEditDca(id) {
    const plan = Store.getDcaPlans().find(p => p.id === id);
    if (plan) Modal.openDcaPlan(MARKET, plan, _refresh);
  }

  function delDca(id) {
    if (!Utils.confirm('確定刪除此定期定額計畫？')) return;
    Store.deleteDcaPlan(id);
    Utils.showToast('已刪除');
    _refresh();
  }

  function toggleDca(id, active) {
    Store.updateDcaPlan(id, { active });
    Utils.showToast(active ? '已啟用' : '已停用');
    _renderDca();
  }

  function executeDca(id) {
    const plan = Store.getDcaPlans().find(p => p.id === id);
    if (plan) Modal.openDcaExecute(plan, _refresh);
  }

  function toggleDivGroup(symbol) {
    const detail = document.getElementById('div-detail-' + symbol);
    const arrow  = document.getElementById('div-arrow-' + symbol);
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

    // Update button immediately
    const btn = document.getElementById('tw-refresh-btn');
    if (btn) { btn.disabled = true; btn.textContent = '更新中…'; }

    try {
      const holdings = Store.getHoldings(MARKET);
      if (holdings.length === 0) { Utils.showToast('尚無持股'); return; }

      const symbols = holdings.map(h => h.symbol);

      // Fetch prices (worker → direct Yahoo fallback)
      const newPrices = await StockPrice.fetchPrices(MARKET, symbols);
      const allPrices = Store.getStockPrices();
      Object.assign(allPrices, newPrices);
      Store.saveStockPrices(allPrices);

      // Fetch upcoming ex-dividend / ex-rights from TWSE (via worker, best effort)
      const upcoming = await StockPrice.fetchTWUpcomingDividends(symbols);
      if (upcoming.length > 0) Store.saveUpcomingTWDivs(upcoming);

      const ok = Object.values(newPrices).filter(p => !p.error).length;
      Utils.showToast(`已更新 ${ok}/${symbols.length} 檔報價${upcoming.length > 0 ? '，發現 ' + upcoming.length + ' 筆除權息' : ''}`);

      _renderSummary();
      if (_activeTab === 'holdings') _renderHoldings();
    } catch (e) {
      Utils.showToast('報價更新失敗：' + e.message);
    } finally {
      _fetchingPrices = false;
      const btn2 = document.getElementById('tw-refresh-btn');
      if (btn2) { btn2.disabled = false; btn2.textContent = '🔄 更新報價'; }
    }
  }

  return {
    render, switchTab,
    openAddTrade, openEditTrade, delTrade,
    openAddDividend, openAddDividendFor, openEditDividend, delDividend,
    openImport,
    openAddDca, openEditDca, delDca, toggleDca, executeDca,
    toggleDivGroup,
    refreshPrices,
  };
})();
