/**
 * Transactions page — mobile-first with activity calendar
 * Tabs: 當日 | 圖表 | 全部 | 活動 | 銀行 | 訂閱
 */
const PageTransactions = (() => {

  // ── State ─────────────────────────────────────────────────────────
  const _todayStr = () => new Date().toISOString().slice(0, 10);
  let _calYear  = new Date().getFullYear();
  let _calMonth = new Date().getMonth() + 1;
  let _selected = _todayStr();
  let _tab      = 'day'; // 'day' | 'charts' | 'all' | 'events' | 'banks' | 'subs'
  let _eventsDetailId = null;

  // ── Helpers ───────────────────────────────────────────────────────
  function _expColor(expense, hasIncome) {
    if (expense === 0 && !hasIncome) return '#f1f5f9';
    if (expense === 0)  return '#bbf7d0';
    if (expense < 500)  return '#fef9c3';
    if (expense < 2000) return '#fed7aa';
    if (expense < 5000) return '#fb923c';
    return '#ef4444';
  }

  function _icon(cat) {
    const m = {
      '餐飲':'🍜','日常生活購物':'🛒','交通費':'🚗','娛樂':'🎮',
      '旅遊':'✈️','醫療健康':'🏥','教育':'📚','服飾鞋包':'👗',
      '薪資':'💰','投資':'📈','獎金':'🎁','利息':'🏦',
      '副業':'💻','借還款':'🤝','住家':'🏠','其他支出':'💸','其他':'💸',
    };
    return m[cat] || '💸';
  }

  function _payLabel(t) {
    if (t.type === 'income') return '';
    const banks = Store.getBanks();
    if (t.paymentMethod === 'credit_card') {
      if (t.cardId) {
        for (const b of banks) {
          const card = (b.creditCards || []).find(c => c.id === t.cardId);
          if (card) return `💳 ${card.name}`;
        }
      }
      return '💳 信用卡';
    }
    if (t.paymentMethod === 'bank_transfer') {
      if (t.bankId) {
        const bank = banks.find(b => b.id === t.bankId);
        if (bank) return `🏦 ${bank.name}`;
      }
      return '🏦 銀行轉帳';
    }
    return '💵 現金';
  }

  function _diffChip(diff, inverted) {
    if (diff === 0) return '<span style="font-size:11px;color:#94a3b8;">持平</span>';
    const good = inverted ? diff < 0 : diff > 0;
    const sign = diff > 0 ? '+' : '';
    return `<span style="font-size:11px;font-weight:600;color:${good ? '#10b981' : '#ef4444'};">${sign}${Utils.formatTWD(diff)}</span>`;
  }

  function _pctChip(pct, inverted) {
    if (!pct || !isFinite(pct)) return '';
    const good = inverted ? pct < 0 : pct > 0;
    const sign = pct > 0 ? '+' : '';
    return `<span style="font-size:10px;background:${good ? '#dcfce7' : '#fee2e2'};color:${good ? '#15803d' : '#dc2626'};padding:1px 5px;border-radius:8px;margin-left:4px;">${sign}${pct.toFixed(1)}%</span>`;
  }

  // ── Main render ───────────────────────────────────────────────────
  function render() {
    const isMobile = window.innerWidth < 768;
    if (isMobile) {
      document.getElementById('app-content').innerHTML = `
        <div style="position:fixed;top:calc(52px + env(safe-area-inset-top,0px));bottom:calc(72px + env(safe-area-inset-bottom,0px));left:0;right:0;display:flex;flex-direction:column;overflow:hidden;background:#f8fafc;">
          <div id="tx-header" style="flex-shrink:0;background:white;box-shadow:0 1px 3px rgba(0,0,0,.07);z-index:2;"></div>
          <div id="tx-body" style="flex:1;overflow-y:auto;min-height:0;-webkit-overflow-scrolling:touch;"></div>
        </div>`;
    } else {
      document.getElementById('app-content').innerHTML = `
        <div style="display:flex;flex-direction:column;height:calc(100vh - 64px);overflow:hidden;">
          <div id="tx-header" style="flex-shrink:0;background:white;box-shadow:0 1px 3px rgba(0,0,0,.07);z-index:2;"></div>
          <div id="tx-body" style="flex:1;overflow-y:auto;min-height:0;background:#f8fafc;"></div>
        </div>`;
    }
    _refresh();
  }

  function _refresh() {
    const h = document.getElementById('tx-header');
    const b = document.getElementById('tx-body');
    if (h) h.innerHTML = _buildHeader();
    if (b) {
      b.innerHTML = _buildBody();
      if (_tab === 'charts') setTimeout(_doCharts, 50);
    }
  }

  // ── Header ────────────────────────────────────────────────────────
  function _buildHeader() {
    if (_tab === 'day')    return _buildTabStrip() + _buildSummary() + _buildCalendar();
    if (_tab === 'charts' || _tab === 'all') return _buildTabStrip() + _buildMonthNav();
    if (_tab === 'events' && _eventsDetailId) return _buildTabStrip() + _buildEventsDetailHeader();
    return _buildTabStrip();
  }

  function _buildTabStrip() {
    const tabs = [
      { id:'day',    label:'📅 當日' },
      { id:'charts', label:'📊 圖表' },
      { id:'all',    label:'📋 全部' },
      { id:'events', label:'🎯 活動' },
      { id:'banks',  label:'🏦 銀行' },
      { id:'subs',   label:'🔄 訂閱' },
    ];
    return `
      <div class="tx-tab-strip">
        ${tabs.map(t =>
          `<button class="tx-tab-btn${_tab === t.id ? ' active' : ''}"
            style="flex:none;white-space:nowrap;"
            onclick="PageTransactions.setTab('${t.id}')">${t.label}</button>`
        ).join('')}
      </div>`;
  }

  function _buildSummary() {
    const s   = Store.getMonthlySummary(_calYear, _calMonth);
    const all = Store.getTransactions();
    const bal = all.reduce((a, t) => t.type === 'income' ? a + t.amount : a - t.amount, 0);
    const mn  = ['1','2','3','4','5','6','7','8','9','10','11','12'];
    return `
      <div style="display:flex;border-bottom:1px solid #f1f5f9;">
        <div style="flex:1;text-align:center;padding:7px 4px;border-right:1px solid #f1f5f9;">
          <div style="font-size:10px;color:#94a3b8;font-weight:500;">${mn[_calMonth-1]}月收入</div>
          <div style="font-size:13px;font-weight:700;color:#10b981;margin-top:1px;">+${Utils.formatTWD(s.income)}</div>
        </div>
        <div style="flex:1;text-align:center;padding:7px 4px;border-right:1px solid #f1f5f9;">
          <div style="font-size:10px;color:#94a3b8;font-weight:500;">${mn[_calMonth-1]}月支出</div>
          <div style="font-size:13px;font-weight:700;color:#ef4444;margin-top:1px;">-${Utils.formatTWD(s.expense)}</div>
        </div>
        <div style="flex:1;text-align:center;padding:7px 4px;">
          <div style="font-size:10px;color:#94a3b8;font-weight:500;">累積結餘</div>
          <div style="font-size:13px;font-weight:700;color:${bal >= 0 ? '#10b981' : '#ef4444'};margin-top:1px;">
            ${bal >= 0 ? '+' : ''}${Utils.formatTWD(bal)}
          </div>
        </div>
      </div>`;
  }

  function _buildMonthNav() {
    const mn = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    const s  = Store.getMonthlySummary(_calYear, _calMonth);
    return `
      <div style="display:flex;align-items:center;padding:8px 12px;border-bottom:1px solid #f1f5f9;gap:8px;">
        <button onclick="PageTransactions.prevMonth()"
          style="background:none;border:none;font-size:22px;cursor:pointer;color:#64748b;padding:2px 6px;line-height:1;flex-shrink:0;">‹</button>
        <div style="flex:1;text-align:center;">
          <span style="font-size:14px;font-weight:700;color:#1e293b;">${_calYear}年${mn[_calMonth-1]}</span>
          <span style="font-size:11px;color:#94a3b8;margin-left:8px;">
            收<span style="color:#10b981;font-weight:600;">${Utils.formatTWD(s.income)}</span>
            &nbsp;支<span style="color:#ef4444;font-weight:600;">${Utils.formatTWD(s.expense)}</span>
          </span>
        </div>
        <button onclick="PageTransactions.nextMonth()"
          style="background:none;border:none;font-size:22px;cursor:pointer;color:#64748b;padding:2px 6px;line-height:1;flex-shrink:0;">›</button>
      </div>`;
  }

  function _buildCalendar() {
    const prefix      = `${_calYear}-${String(_calMonth).padStart(2,'0')}-`;
    const txs         = Store.getTransactions();
    const dayMap      = {};

    for (const t of txs) {
      if (!t.date.startsWith(prefix)) continue;
      if (!dayMap[t.date]) dayMap[t.date] = { exp: 0, inc: 0 };
      if (t.type === 'expense') dayMap[t.date].exp += t.amount;
      else                      dayMap[t.date].inc += t.amount;
    }

    const firstDow    = new Date(_calYear, _calMonth - 1, 1).getDay();
    const daysInMonth = new Date(_calYear, _calMonth, 0).getDate();
    const today       = _todayStr();
    const monthNames  = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

    let cells = '';
    for (let i = 0; i < firstDow; i++) cells += '<div></div>';

    for (let d = 1; d <= daysInMonth; d++) {
      const ds      = `${_calYear}-${String(_calMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const data    = dayMap[ds] || { exp: 0, inc: 0 };
      const future  = ds > today;
      const isSel   = ds === _selected;
      const isToday = ds === today;
      const bg      = future ? '#f1f5f9' : _expColor(data.exp, data.inc > 0);

      const expLabel = !future && !isSel && data.exp >= 2000
        ? `<span style="font-size:8px;color:${data.exp >= 5000 ? 'rgba(255,255,255,0.9)' : '#7c2d12'};line-height:1;position:absolute;bottom:2px;left:0;right:0;text-align:center;">
            ${data.exp >= 10000 ? Math.round(data.exp / 1000) + 'k' : (data.exp / 1000).toFixed(1) + 'k'}
          </span>`
        : '';

      const incDot = !future && data.inc > 0 && data.exp === 0
        ? '<span style="width:4px;height:4px;border-radius:50%;background:#10b981;position:absolute;bottom:3px;left:50%;transform:translateX(-50%);"></span>'
        : '';

      cells += `
        <div class="tx-cal-day"
          onclick="PageTransactions.selectDate('${ds}')"
          style="background:${isSel ? '#3b82f6' : bg};opacity:${future ? 0.35 : 1};${isToday && !isSel ? 'box-shadow:0 0 0 1.5px #64748b inset;' : ''}${isSel ? 'box-shadow:0 0 0 2px #1d4ed8 inset;' : ''}">
          <span style="font-size:11px;line-height:1;font-weight:${isToday || isSel ? 700 : 400};
            color:${isSel ? 'white' : isToday ? '#1e293b' : '#374151'};">${d}</span>
          ${expLabel}${!expLabel ? incDot : ''}
        </div>`;
    }

    return `
      <div style="padding:6px 10px 5px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <button onclick="PageTransactions.prevMonth()"
            style="background:none;border:none;font-size:22px;cursor:pointer;color:#64748b;padding:2px 6px;line-height:1;">‹</button>
          <span style="font-size:13px;font-weight:700;color:#1e293b;">${_calYear}年${monthNames[_calMonth-1]}</span>
          <button onclick="PageTransactions.nextMonth()"
            style="background:none;border:none;font-size:22px;cursor:pointer;color:#64748b;padding:2px 6px;line-height:1;">›</button>
        </div>
        <div class="tx-cal-grid" style="margin-bottom:3px;">
          ${['日','一','二','三','四','五','六'].map(w =>
            `<div style="text-align:center;font-size:9px;color:#94a3b8;font-weight:600;padding-bottom:2px;">${w}</div>`
          ).join('')}
        </div>
        <div class="tx-cal-grid">${cells}</div>
        <div style="display:flex;align-items:center;gap:3px;margin-top:4px;justify-content:flex-end;">
          <span style="font-size:9px;color:#94a3b8;">少</span>
          ${['#f1f5f9','#bbf7d0','#fef9c3','#fed7aa','#fb923c','#ef4444'].map(c =>
            `<div style="width:8px;height:8px;border-radius:2px;background:${c};"></div>`
          ).join('')}
          <span style="font-size:9px;color:#94a3b8;">多</span>
        </div>
      </div>`;
  }

  // ── Events detail header (sticky part) ───────────────────────────
  function _buildEventsDetailHeader() {
    const e = Store.getEvents().find(ev => ev.id === _eventsDetailId);
    if (!e) return '';
    const txs      = Store.getEventTransactions(_eventsDetailId);
    const totalExp = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const totalInc = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    return `
      <div style="border-top:1px solid #f1f5f9;">
        <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid #f8fafc;">
          <button onclick="PageTransactions.backToEvents()"
            style="background:none;border:none;font-size:20px;cursor:pointer;color:#64748b;padding:2px 6px;line-height:1;">←</button>
          <div style="font-size:20px;">${e.icon || '🎯'}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:700;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${e.name}</div>
            ${e.startDate ? `<div style="font-size:11px;color:#94a3b8;">${Utils.formatDate(e.startDate)}${e.endDate ? ' – ' + Utils.formatDate(e.endDate) : ''}</div>` : ''}
          </div>
          <button class="btn btn-secondary btn-sm" onclick="PageTransactions.openEditEvent('${e.id}')">編輯</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 12px;">
          <div style="text-align:center;padding:6px;background:#fef2f2;border-radius:8px;">
            <div style="font-size:10px;color:#94a3b8;">總支出</div>
            <div style="font-size:15px;font-weight:700;color:#ef4444;">${Utils.formatTWD(totalExp)}</div>
          </div>
          <div style="text-align:center;padding:6px;background:#f0fdf4;border-radius:8px;">
            <div style="font-size:10px;color:#94a3b8;">總收入</div>
            <div style="font-size:15px;font-weight:700;color:#10b981;">${Utils.formatTWD(totalInc)}</div>
          </div>
        </div>
        <div style="padding:0 12px 8px;">
          <button class="btn btn-primary" style="width:100%;font-size:13px;" onclick="PageTransactions.openAddEventTx()">+ 新增記帳</button>
        </div>
      </div>`;
  }

  // ── Tab body ──────────────────────────────────────────────────────
  function _buildBody() {
    if (_tab === 'day')    return _buildDayView();
    if (_tab === 'charts') return _buildChartsView();
    if (_tab === 'all')    return _buildAllView();
    if (_tab === 'events') return _eventsDetailId ? _buildEventsDetailBody() : _buildEventsView();
    if (_tab === 'banks')  return _buildBanksView();
    if (_tab === 'subs')   return _buildSubsView();
    return '';
  }

  function _buildDayView() {
    const txs     = Store.getTransactions().filter(t => t.date === _selected).slice().reverse();
    const [y,m,d] = _selected.split('-');
    const today   = _todayStr();
    const label   = _selected === today ? '今天' : `${+m}/${+d}`;
    const total   = txs.reduce((s, t) => t.type === 'income' ? s + t.amount : s - t.amount, 0);

    const rows = txs.map(t => `
      <div style="display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid #f1f5f9;">
        <div style="width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;
          font-size:20px;flex-shrink:0;background:${t.type === 'income' ? '#d1fae5' : '#fee2e2'};">
          ${_icon(t.category)}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:#1e293b;">${t.category}</div>
          <div style="font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${t.note || _payLabel(t) || (t.type === 'income' ? '收入' : '支出')}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:15px;font-weight:700;color:${t.type === 'income' ? '#10b981' : '#ef4444'};">
            ${t.type === 'income' ? '+' : '-'}${Utils.formatTWD(t.amount)}
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:3px;">
            <span onclick="PageTransactions.openEdit('${t.id}')"
              style="font-size:13px;cursor:pointer;color:#94a3b8;">✏️</span>
            <span onclick="PageTransactions.del('${t.id}')"
              style="font-size:13px;cursor:pointer;color:#94a3b8;">🗑️</span>
          </div>
        </div>
      </div>`).join('');

    const emptyState = `
      <div style="text-align:center;padding:36px 16px;color:#94a3b8;">
        <div style="font-size:40px;margin-bottom:10px;">📋</div>
        <div style="font-size:14px;margin-bottom:4px;">今日尚無記帳</div>
        <div style="font-size:12px;">點擊上方按鈕新增</div>
      </div>`;

    return `
      <div style="display:flex;flex-direction:column;height:100%;">
        <div style="display:flex;align-items:center;justify-content:space-between;
          padding:9px 14px;border-bottom:1px solid #e2e8f0;background:white;flex-shrink:0;">
          <div>
            <span style="font-size:14px;font-weight:700;color:#1e293b;">${y}/${m}/${d}</span>
            <span style="font-size:12px;color:#64748b;margin-left:6px;">${label}</span>
            ${txs.length > 0 ? `<span style="font-size:13px;font-weight:600;
              color:${total >= 0 ? '#10b981' : '#ef4444'};margin-left:10px;">
              ${total >= 0 ? '+' : ''}${Utils.formatTWD(total)}</span>` : ''}
          </div>
          <button class="btn btn-primary" style="padding:7px 16px;font-size:13px;border-radius:10px;"
            onclick="PageTransactions.openAddForDate('${_selected}')">＋記帳</button>
        </div>
        <div style="flex:1;overflow-y:auto;min-height:0;">
          ${txs.length > 0 ? rows : emptyState}
        </div>
      </div>`;
  }

  function _buildChartsView() {
    const prevY  = _calMonth === 1 ? _calYear - 1 : _calYear;
    const prevM  = _calMonth === 1 ? 12 : _calMonth - 1;
    const cur    = Store.getMonthlySummary(_calYear, _calMonth);
    const prev   = Store.getMonthlySummary(prevY, prevM);
    const mn     = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

    const expDiff = cur.expense - prev.expense;
    const expPct  = prev.expense > 0 ? (expDiff / prev.expense * 100) : 0;
    const incDiff = cur.income  - prev.income;
    const incPct  = prev.income  > 0 ? (incDiff / prev.income  * 100) : 0;
    const netCur  = cur.income  - cur.expense;
    const netPrev = prev.income - prev.expense;
    const netDiff = netCur - netPrev;

    const prefix   = `${_calYear}-${String(_calMonth).padStart(2,'0')}-`;
    const monthTxs = Store.getTransactions().filter(t => t.date.startsWith(prefix) && t.type === 'expense');
    const catMap   = {};
    monthTxs.forEach(t => { catMap[t.category] = (catMap[t.category] || 0) + t.amount; });
    const hasCat   = Object.keys(catMap).length > 0;

    return `
      <div style="padding:12px 12px 20px;display:flex;flex-direction:column;gap:10px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div style="background:white;border-radius:14px;padding:12px 14px;border-top:3px solid #ef4444;">
            <div style="font-size:10px;color:#94a3b8;font-weight:500;margin-bottom:3px;">本月支出</div>
            <div style="font-size:19px;font-weight:700;color:#ef4444;">${Utils.formatTWD(cur.expense)}</div>
            <div style="font-size:10px;color:#94a3b8;margin-top:3px;">上月 ${Utils.formatTWD(prev.expense)}</div>
            <div style="margin-top:4px;display:flex;align-items:center;flex-wrap:wrap;gap:2px;">
              ${_diffChip(expDiff, true)}${_pctChip(expPct, true)}
            </div>
          </div>
          <div style="background:white;border-radius:14px;padding:12px 14px;border-top:3px solid #10b981;">
            <div style="font-size:10px;color:#94a3b8;font-weight:500;margin-bottom:3px;">本月收入</div>
            <div style="font-size:19px;font-weight:700;color:#10b981;">${Utils.formatTWD(cur.income)}</div>
            <div style="font-size:10px;color:#94a3b8;margin-top:3px;">上月 ${Utils.formatTWD(prev.income)}</div>
            <div style="margin-top:4px;display:flex;align-items:center;flex-wrap:wrap;gap:2px;">
              ${_diffChip(incDiff)}${_pctChip(incPct)}
            </div>
          </div>
        </div>
        <div style="background:white;border-radius:14px;padding:12px 14px;border-top:3px solid #3b82f6;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:10px;color:#94a3b8;font-weight:500;margin-bottom:3px;">本月結餘</div>
            <div style="font-size:20px;font-weight:700;color:${netCur >= 0 ? '#3b82f6' : '#ef4444'};">
              ${netCur >= 0 ? '+' : ''}${Utils.formatTWD(netCur)}
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:10px;color:#94a3b8;">上月 ${netPrev >= 0 ? '+' : ''}${Utils.formatTWD(netPrev)}</div>
            <div style="margin-top:4px;">${_diffChip(netDiff)}</div>
          </div>
        </div>
        <div style="background:white;border-radius:14px;padding:14px;">
          <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:10px;">近6個月收支</div>
          <div style="height:160px;"><canvas id="tx-trend-chart"></canvas></div>
        </div>
        <div style="background:white;border-radius:14px;padding:14px;">
          <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:10px;">
            ${mn[_calMonth-1]}支出分類
          </div>
          ${hasCat
            ? '<canvas id="tx-cat-chart" style="max-height:200px;"></canvas>'
            : '<div style="text-align:center;padding:24px 0;color:#94a3b8;font-size:13px;">本月尚無支出記帳</div>'}
        </div>
      </div>`;
  }

  function _doCharts() {
    const { year, month: curM } = Utils.thisMonth();
    const monthly = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(year, curM - 1 - i, 1);
      const s = Store.getMonthlySummary(d.getFullYear(), d.getMonth() + 1);
      monthly.push({ label: `${d.getMonth() + 1}月`, income: s.income, expense: s.expense });
    }
    Charts.renderMonthlyCashFlow('tx-trend-chart', monthly);

    const prefix = `${_calYear}-${String(_calMonth).padStart(2,'0')}-`;
    const txs    = Store.getTransactions().filter(t => t.date.startsWith(prefix) && t.type === 'expense');
    const catMap = {};
    txs.forEach(t => { catMap[t.category] = (catMap[t.category] || 0) + t.amount; });
    const catData = Object.entries(catMap).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
    if (catData.length > 0) Charts.renderCategoryDonut('tx-cat-chart', catData);
  }

  function _buildAllView() {
    const prefix = `${_calYear}-${String(_calMonth).padStart(2,'0')}-`;
    const all    = Store.getTransactions()
      .filter(t => t.date.startsWith(prefix))
      .slice().sort((a, b) => b.date.localeCompare(a.date));

    if (all.length === 0) {
      return `<div style="text-align:center;padding:40px 16px;color:#94a3b8;">
        <div style="font-size:40px;margin-bottom:10px;">📋</div>
        <div style="font-size:14px;">本月尚無記帳</div>
      </div>`;
    }

    const groups = {};
    for (const t of all) (groups[t.date] = groups[t.date] || []).push(t);

    const sections = Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0])).map(([date, items]) => {
      const [,m,d] = date.split('-');
      const dayNet = items.reduce((s, t) => t.type === 'income' ? s + t.amount : s - t.amount, 0);
      const rows   = items.map(t => `
        <div style="display:flex;align-items:center;gap:9px;padding:9px 14px;border-bottom:1px solid #f8fafc;">
          <div style="font-size:20px;width:26px;text-align:center;flex-shrink:0;">${_icon(t.category)}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:600;color:#334155;">${t.category}</div>
            <div style="font-size:11px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${t.note || _payLabel(t) || '-'}
            </div>
          </div>
          <div style="font-size:13px;font-weight:700;color:${t.type === 'income' ? '#10b981' : '#ef4444'};flex-shrink:0;">
            ${t.type === 'income' ? '+' : '-'}${Utils.formatTWD(t.amount)}
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
            <span onclick="PageTransactions.openEdit('${t.id}')" style="cursor:pointer;font-size:12px;color:#cbd5e1;">✏️</span>
            <span onclick="PageTransactions.del('${t.id}')" style="cursor:pointer;font-size:12px;color:#cbd5e1;">🗑️</span>
          </div>
        </div>`).join('');

      return `
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;
            padding:5px 14px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;">
            <span style="font-size:11px;font-weight:700;color:#64748b;">${+m}月${+d}日</span>
            <span style="font-size:11px;font-weight:700;color:${dayNet >= 0 ? '#10b981' : '#ef4444'};">
              ${dayNet >= 0 ? '+' : ''}${Utils.formatTWD(dayNet)}
            </span>
          </div>
          ${rows}
        </div>`;
    }).join('');

    return `<div style="padding-bottom:16px;">${sections}</div>`;
  }

  // ── Events views ──────────────────────────────────────────────────
  function _buildEventsView() {
    const events = Store.getEvents().slice().sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    );

    const addBtn = `
      <div style="padding:10px 14px;background:white;border-bottom:1px solid #f1f5f9;">
        <button class="btn btn-primary" style="width:100%;" onclick="PageTransactions.openAddEvent()">＋ 新增活動</button>
      </div>`;

    if (events.length === 0) {
      return `${addBtn}<div style="text-align:center;padding:40px 16px;color:#94a3b8;">
        <div style="font-size:40px;margin-bottom:10px;">🎯</div>
        <div style="font-size:14px;margin-bottom:4px;">尚未建立活動</div>
        <div style="font-size:12px;">例如旅遊、婚禮等</div>
      </div>`;
    }

    const cards = events.map(e => {
      const txs      = Store.getEventTransactions(e.id);
      const totalExp = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
      const totalInc = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
      const dateRange = e.startDate && e.endDate
        ? `${Utils.formatDate(e.startDate)} – ${Utils.formatDate(e.endDate)}`
        : e.startDate ? Utils.formatDate(e.startDate) : '無日期';
      return `
        <div style="background:white;border-bottom:1px solid #f1f5f9;padding:12px 14px;">
          <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;">
            <div style="width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;
              font-size:22px;flex-shrink:0;background:${e.color || '#3b82f6'}18;border-left:3px solid ${e.color || '#3b82f6'};">
              ${e.icon || '🎯'}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:14px;font-weight:700;color:#1e293b;">${e.name}</div>
              <div style="font-size:11px;color:#94a3b8;">${dateRange}</div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <div style="font-size:15px;font-weight:700;color:#ef4444;">${Utils.formatTWD(totalExp)}</div>
              ${totalInc > 0 ? `<div style="font-size:11px;color:#10b981;">+${Utils.formatTWD(totalInc)}</div>` : ''}
              <div style="font-size:11px;color:#94a3b8;">${txs.length} 筆</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;justify-content:flex-end;">
            <button class="btn btn-primary btn-sm" onclick="PageTransactions.viewEvent('${e.id}')">查看明細</button>
            <button class="btn btn-secondary btn-sm" onclick="PageTransactions.openEditEvent('${e.id}')">編輯</button>
            <button class="btn btn-danger btn-sm" onclick="PageTransactions.deleteEvent('${e.id}')">刪除</button>
          </div>
        </div>`;
    }).join('');

    return addBtn + cards;
  }

  function _buildEventsDetailBody() {
    const e = Store.getEvents().find(ev => ev.id === _eventsDetailId);
    if (!e) { _eventsDetailId = null; return _buildEventsView(); }

    const txs = Store.getEventTransactions(_eventsDetailId)
      .slice().sort((a, b) => b.date.localeCompare(a.date));

    if (txs.length === 0) {
      return `<div style="text-align:center;padding:40px 16px;color:#94a3b8;">
        <div style="font-size:40px;margin-bottom:10px;">📝</div>
        <div style="font-size:14px;">尚未有記帳，點上方按鈕新增</div>
      </div>`;
    }

    return `<div style="padding-bottom:16px;">` + txs.map(t => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #f1f5f9;background:white;">
        <div style="font-size:20px;width:28px;text-align:center;flex-shrink:0;">${_icon(t.category)}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:#334155;">${t.category}</div>
          <div style="font-size:11px;color:#94a3b8;">${t.date.slice(5)} · ${t.note || '-'}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:14px;font-weight:700;color:${t.type === 'income' ? '#10b981' : '#ef4444'};">
            ${t.type === 'income' ? '+' : '-'}${Utils.formatTWD(t.amount)}
          </div>
          <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:3px;">
            <span onclick="PageTransactions.openEditEventTx('${t.id}')" style="cursor:pointer;font-size:12px;color:#94a3b8;">✏️</span>
            <span onclick="PageTransactions.deleteEventTx('${t.id}')" style="cursor:pointer;font-size:12px;color:#94a3b8;">🗑️</span>
          </div>
        </div>
      </div>`).join('') + `</div>`;
  }

  // ── Banks view ────────────────────────────────────────────────────
  function _buildBanksView() {
    const banks  = Store.getBanks();
    const allTx  = Store.getTransactions();
    const today  = new Date();
    const prefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2,'0')}`;

    const addBtn = `
      <div style="padding:10px 14px;background:white;border-bottom:1px solid #f1f5f9;">
        <button class="btn btn-primary" style="width:100%;" onclick="PageTransactions.openAddBank()">＋ 新增銀行</button>
      </div>`;

    if (banks.length === 0) {
      return `${addBtn}<div style="text-align:center;padding:40px 16px;color:#94a3b8;">
        <div style="font-size:40px;margin-bottom:10px;">🏦</div>
        <div style="font-size:14px;">尚未新增銀行</div>
      </div>`;
    }

    const bankCards = banks.map(bank => {
      const cards = bank.creditCards || [];

      const cardsHtml = cards.length === 0
        ? `<div style="margin-top:6px;">
            <button class="btn btn-secondary btn-sm" onclick="PageTransactions.openAddCard('${bank.id}','${bank.name}')">+ 新增信用卡</button>
          </div>`
        : `<div style="border-top:1px solid #f1f5f9;margin-top:10px;padding-top:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <span style="font-size:12px;font-weight:600;color:#475569;">信用卡</span>
              <button class="btn btn-secondary btn-sm" onclick="PageTransactions.openAddCard('${bank.id}','${bank.name}')">+ 新增</button>
            </div>
            ${cards.map(card => {
              const isDebit = card.type === 'debit';
              if (isDebit) {
                return `<div style="background:#f8fafc;border-radius:8px;padding:10px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">
                  <div>
                    <div style="font-weight:600;font-size:13px;">💳 ${card.name}</div>
                    <div style="font-size:11px;color:#64748b;">簽帳金融卡</div>
                  </div>
                  <div style="display:flex;gap:5px;">
                    <button class="btn btn-secondary btn-sm" onclick="PageTransactions.openEditCard('${bank.id}','${card.id}')">編輯</button>
                    <button class="btn btn-danger btn-sm" onclick="PageTransactions.deleteCard('${bank.id}','${card.id}')">刪除</button>
                  </div>
                </div>`;
              }
              const monthSpend = allTx.filter(t =>
                t.type === 'expense' && t.paymentMethod === 'credit_card' &&
                t.cardId === card.id && t.date.startsWith(prefix)
              ).reduce((s, t) => s + t.amount, 0);
              const usagePct = card.limit > 0 ? Math.min(100, (monthSpend / card.limit) * 100) : 0;
              const barColor = usagePct >= 80 ? '#ef4444' : usagePct >= 50 ? '#f59e0b' : '#10b981';
              return `<div style="background:#f8fafc;border-radius:8px;padding:10px 12px;margin-bottom:6px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:${card.limit > 0 ? '6px' : '0'};">
                  <div>
                    <div style="font-weight:600;font-size:13px;">💳 ${card.name}</div>
                    ${card.limit > 0 ? `<div style="font-size:11px;color:#64748b;">額度 ${Utils.formatTWD(card.limit)}</div>` : ''}
                  </div>
                  <div style="display:flex;gap:5px;">
                    <button class="btn btn-secondary btn-sm" onclick="PageTransactions.openEditCard('${bank.id}','${card.id}')">編輯</button>
                    <button class="btn btn-danger btn-sm" onclick="PageTransactions.deleteCard('${bank.id}','${card.id}')">刪除</button>
                  </div>
                </div>
                ${card.limit > 0 ? `
                  <div style="display:flex;justify-content:space-between;font-size:11px;color:#64748b;margin-bottom:3px;">
                    <span>本月已刷 ${Utils.formatTWD(monthSpend)}</span>
                    <span style="color:${barColor};">${usagePct.toFixed(1)}%</span>
                  </div>
                  <div style="background:#e2e8f0;border-radius:4px;height:5px;">
                    <div style="background:${barColor};width:${usagePct}%;height:5px;border-radius:4px;transition:width .3s;"></div>
                  </div>` : ''}
              </div>`;
            }).join('')}
          </div>`;

      return `
        <div style="background:white;border-bottom:1px solid #f1f5f9;padding:12px 14px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">
            <div>
              <div style="font-size:15px;font-weight:700;color:#1e293b;">🏦 ${bank.name}</div>
              <div style="display:flex;align-items:center;gap:8px;margin-top:3px;">
                <span style="font-size:20px;font-weight:800;color:#3b82f6;">${Utils.formatTWD(bank.balance || 0)}</span>
                <button onclick="PageTransactions.adjustBalance('${bank.id}')"
                  style="font-size:11px;color:#6366f1;background:none;border:1px solid #c7d2fe;border-radius:5px;padding:2px 8px;cursor:pointer;">調整</button>
              </div>
            </div>
            <div style="display:flex;gap:5px;flex-shrink:0;">
              <button class="btn btn-secondary btn-sm" onclick="PageTransactions.openEditBank('${bank.id}')">編輯</button>
              <button class="btn btn-danger btn-sm" onclick="PageTransactions.deleteBank('${bank.id}')">刪除</button>
            </div>
          </div>
          ${cardsHtml}
        </div>`;
    }).join('');

    return addBtn + bankCards;
  }

  // ── Subscriptions view ────────────────────────────────────────────
  function _buildSubsView() {
    const subs   = Store.getSubscriptions();
    const active = subs.filter(s => s.active);
    let monthly  = 0;
    for (const s of active) {
      if (s.currency === 'TWD') monthly += s.amount;
      else if (s.lastRate) monthly += s.amount * s.lastRate;
    }

    const subIcons = {
      youtube:'▶️', netflix:'🎬', spotify:'🎵', claude:'🤖', openai:'🤖',
      chatgpt:'🤖', apple:'🍎', icloud:'☁️', google:'🔍', adobe:'🎨',
      microsoft:'🪟', office:'📄', notion:'📝', github:'🐙', disney:'🏰',
    };
    function getIcon(name) {
      const lower = name.toLowerCase();
      for (const [k, ic] of Object.entries(subIcons)) {
        if (lower.includes(k)) return ic;
      }
      return '🔄';
    }

    const today = new Date();
    function getNextDate(s) {
      const d = new Date(today.getFullYear(), today.getMonth(), s.billingDay);
      if (d < today) return new Date(today.getFullYear(), today.getMonth() + 1, s.billingDay);
      return d;
    }

    const summaryHtml = active.length > 0 ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 14px;background:white;border-bottom:1px solid #f1f5f9;">
        <div style="background:#f8fafc;border-radius:10px;padding:10px 12px;">
          <div style="font-size:10px;color:#94a3b8;">啟用訂閱</div>
          <div style="font-size:20px;font-weight:700;color:#6366f1;">${active.length}</div>
          <div style="font-size:10px;color:#94a3b8;">共 ${subs.length} 筆</div>
        </div>
        <div style="background:#f8fafc;border-radius:10px;padding:10px 12px;">
          <div style="font-size:10px;color:#94a3b8;">每月估計</div>
          <div style="font-size:18px;font-weight:700;color:#ef4444;">${Utils.formatTWD(monthly)}</div>
          <div style="font-size:10px;color:#94a3b8;">每年 ${Utils.formatTWD(monthly * 12)}</div>
        </div>
      </div>` : '';

    const addBtn = `
      <div style="padding:10px 14px;background:white;border-bottom:1px solid #f1f5f9;">
        <button class="btn btn-primary" style="width:100%;" onclick="PageTransactions.openAddSub()">＋ 新增訂閱</button>
      </div>`;

    if (subs.length === 0) {
      return `${addBtn}<div style="text-align:center;padding:40px 16px;color:#94a3b8;">
        <div style="font-size:40px;margin-bottom:10px;">🔄</div>
        <div style="font-size:14px;">尚未新增訂閱</div>
      </div>`;
    }

    const rows = subs.map(s => {
      const next    = getNextDate(s);
      const days    = Math.ceil((next - today) / 86400000);
      const twdEst  = s.currency === 'TWD' ? s.amount : (s.lastRate ? Math.round(s.amount * s.lastRate) : null);
      const daysLbl = days === 0 ? '今天' : days === 1 ? '明天' : `${days}天後`;
      return `
        <div style="background:white;border-bottom:1px solid #f1f5f9;padding:10px 14px;display:flex;align-items:center;gap:10px;${!s.active ? 'opacity:0.5;' : ''}">
          <div style="font-size:22px;flex-shrink:0;">${getIcon(s.name)}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:#1e293b;">${s.name}</div>
            <div style="font-size:11px;color:#94a3b8;">
              ${s.currency} ${Utils.formatNumber(s.amount, s.currency === 'TWD' ? 0 : 2)}
              ${twdEst !== null && s.currency !== 'TWD' ? ` ≈ ${Utils.formatTWD(twdEst)}` : ''}
              · ${next.getMonth() + 1}/${next.getDate()} (${daysLbl})
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;">
            <div style="font-size:14px;font-weight:700;color:#6366f1;">${twdEst !== null ? Utils.formatTWD(twdEst) : '–'}</div>
            <div style="display:flex;gap:4px;align-items:center;">
              <label style="display:inline-flex;align-items:center;cursor:pointer;">
                <input type="checkbox" ${s.active ? 'checked' : ''} style="cursor:pointer;width:15px;height:15px;"
                  onchange="PageTransactions.toggleSubActive('${s.id}', this.checked)">
              </label>
              <button class="btn btn-secondary btn-sm" onclick="PageTransactions.openEditSub('${s.id}')">編輯</button>
              <button class="btn btn-danger btn-sm" onclick="PageTransactions.deleteSub('${s.id}')">刪除</button>
            </div>
          </div>
        </div>`;
    }).join('');

    return summaryHtml + addBtn + rows;
  }

  // ── Interactions ──────────────────────────────────────────────────
  function selectDate(d) {
    _selected = d;
    _tab      = 'day';
    _refresh();
  }

  function prevMonth() {
    if (--_calMonth < 1) { _calMonth = 12; _calYear--; }
    _refresh();
  }

  function nextMonth() {
    if (++_calMonth > 12) { _calMonth = 1; _calYear++; }
    _refresh();
  }

  function setTab(t) {
    if (t !== 'events') _eventsDetailId = null;
    _tab = t;
    _refresh();
  }

  function openAddForDate(date) {
    Modal.openTransaction(
      { date, type: 'expense', amount: '', category: '其他', note: '', paymentMethod: 'cash', bankId: null, cardId: null },
      () => _refresh()
    );
  }

  function openAdd() { openAddForDate(_selected); }

  function openEdit(id) {
    const tx = Store.getTransactions().find(t => t.id === id);
    if (tx) Modal.openTransaction(tx, () => _refresh());
  }

  function del(id) {
    if (!Utils.confirm('確認刪除此筆記帳？')) return;
    Store.deleteTransaction(id);
    Utils.showToast('已刪除');
    _refresh();
  }

  // ── Events actions ────────────────────────────────────────────────
  function viewEvent(id) { _eventsDetailId = id; _refresh(); }
  function backToEvents() { _eventsDetailId = null; _refresh(); }

  function openAddEvent() { Modal.openEvent(null, () => _refresh()); }

  function openEditEvent(id) {
    const e = Store.getEvents().find(ev => ev.id === id);
    if (e) Modal.openEvent(e, () => _refresh());
  }

  function deleteEvent(id) {
    const e = Store.getEvents().find(ev => ev.id === id);
    if (!e) return;
    const count = Store.getEventTransactions(id).length;
    const msg = count > 0
      ? `確認刪除「${e.name}」？\n\n此活動有 ${count} 筆記帳，刪除後記帳仍會保留。`
      : `確認刪除「${e.name}」？`;
    if (!Utils.confirm(msg)) return;
    Store.deleteEvent(id);
    if (_eventsDetailId === id) _eventsDetailId = null;
    Utils.showToast('已刪除');
    _refresh();
  }

  function openAddEventTx() {
    if (!_eventsDetailId) return;
    Modal.openTransaction({ eventId: _eventsDetailId }, () => _refresh());
  }

  function openEditEventTx(txId) {
    const tx = Store.getTransactions().find(t => t.id === txId);
    if (tx) Modal.openTransaction(tx, () => _refresh());
  }

  function deleteEventTx(txId) {
    if (!Utils.confirm('確認刪除此筆記帳？')) return;
    Store.deleteTransaction(txId);
    Utils.showToast('已刪除');
    _refresh();
  }

  // ── Banks actions ─────────────────────────────────────────────────
  function openAddBank() { Modal.openBank(null, () => _refresh()); }

  function openEditBank(id) {
    const bank = Store.getBanks().find(b => b.id === id);
    if (bank) Modal.openBank(bank, () => _refresh());
  }

  function deleteBank(id) {
    const bank = Store.getBanks().find(b => b.id === id);
    if (!bank || !Utils.confirm(`確認刪除「${bank.name}」及其所有信用卡資料？`)) return;
    Store.deleteBank(id);
    Utils.showToast('已刪除');
    _refresh();
  }

  function openAddCard(bankId, bankName) {
    Modal.openCreditCard(bankId, bankName, null, () => _refresh());
  }

  function openEditCard(bankId, cardId) {
    const bank = Store.getBanks().find(b => b.id === bankId);
    if (!bank) return;
    const card = (bank.creditCards || []).find(c => c.id === cardId);
    if (card) Modal.openCreditCard(bankId, bank.name, card, () => _refresh());
  }

  function deleteCard(bankId, cardId) {
    const bank = Store.getBanks().find(b => b.id === bankId);
    const card = (bank && bank.creditCards || []).find(c => c.id === cardId);
    if (!card || !Utils.confirm(`確認刪除「${card.name}」？`)) return;
    Store.deleteCreditCard(bankId, cardId);
    Utils.showToast('已刪除');
    _refresh();
  }

  function adjustBalance(bankId) {
    const bank = Store.getBanks().find(b => b.id === bankId);
    if (!bank) return;
    Modal.open(`
      <div class="modal-header">
        <span class="modal-title">調整餘額 — ${bank.name}</span>
        <button class="modal-close" onclick="Modal.close()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">帳戶餘額 (NT$)</label>
          <input type="number" id="adj-balance" class="form-input" value="${bank.balance || 0}" step="1">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" onclick="PageTransactions._saveAdjBalance('${bankId}')">儲存</button>
      </div>
    `, () => _refresh());
  }

  function _saveAdjBalance(bankId) {
    const balance = parseFloat(document.getElementById('adj-balance').value || 0);
    Store.updateBank(bankId, { balance });
    Utils.showToast('已更新');
    Modal.close();
  }

  // ── Subscriptions actions ─────────────────────────────────────────
  function openAddSub() { Modal.openSubscription(null, () => _refresh()); }

  function openEditSub(id) {
    const sub = Store.getSubscriptions().find(s => s.id === id);
    if (sub) Modal.openSubscription(sub, () => _refresh());
  }

  function deleteSub(id) {
    const sub = Store.getSubscriptions().find(s => s.id === id);
    if (!sub || !Utils.confirm(`確認刪除「${sub.name}」？`)) return;
    Store.deleteSubscription(id);
    Utils.showToast('已刪除');
    _refresh();
  }

  function toggleSubActive(id, active) {
    Store.updateSubscription(id, { active });
    _refresh();
  }

  async function billSubNow(id) {
    await PageSubscriptions.billNow(id);
    _refresh();
  }

  return {
    render, selectDate, prevMonth, nextMonth, setTab,
    openAdd, openAddForDate, openEdit, del,
    viewEvent, backToEvents,
    openAddEvent, openEditEvent, deleteEvent,
    openAddEventTx, openEditEventTx, deleteEventTx,
    openAddBank, openEditBank, deleteBank,
    openAddCard, openEditCard, deleteCard,
    adjustBalance, _saveAdjBalance,
    openAddSub, openEditSub, deleteSub,
    toggleSubActive, billSubNow,
  };
})();
