/**
 * Transactions page — mobile-first with activity calendar
 */
const PageTransactions = (() => {

  // ── State ─────────────────────────────────────────────────────────
  const _todayStr = () => new Date().toISOString().slice(0, 10);
  let _calYear  = new Date().getFullYear();
  let _calMonth = new Date().getMonth() + 1;
  let _selected = _todayStr();
  let _tab      = 'day'; // 'day' | 'charts' | 'all'

  // ── Helpers ───────────────────────────────────────────────────────
  function _dayBg(expense, hasIncome) {
    if (expense === 0 && !hasIncome) return '#ebedf0';
    if (expense === 0)  return '#bbf7d0';
    if (expense < 200)  return '#fef9c3';
    if (expense < 1000) return '#fed7aa';
    if (expense < 3000) return '#fb923c';
    return '#ef4444';
  }

  function _icon(cat) {
    const m = {
      '餐飲':'🍜','日常購物':'🛍️','網路購物':'📦','交通':'🚇',
      '訂閱服務':'📱','醫療保健':'💊','超市賣場':'🛒','帳單費用':'📄',
      '娛樂':'🎮','住房':'🏠','旅遊':'✈️','投資':'📊',
      '薪資':'💰','股利':'📈','利息':'🏦','其他收入':'💵','其他':'💳',
    };
    return m[cat] || '💳';
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

  // ── Main render ───────────────────────────────────────────────────
  function render() {
    const isMobile = window.innerWidth < 768;
    const outerH   = isMobile
      ? 'calc(100svh - 52px - env(safe-area-inset-top,0px) - 72px - env(safe-area-inset-bottom,0px))'
      : 'calc(100vh - 64px)';

    document.getElementById('app-content').innerHTML = `
      <div style="margin:-14px;display:flex;flex-direction:column;height:${outerH};overflow:hidden;">
        <div id="tx-header" style="flex-shrink:0;background:white;box-shadow:0 1px 3px rgba(0,0,0,.07);z-index:2;"></div>
        <div id="tx-body"   style="flex:1;overflow-y:auto;min-height:0;-webkit-overflow-scrolling:touch;background:#f8fafc;"></div>
      </div>
    `;
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
    return _buildSummary() + _buildCalendar() + _buildTabStrip();
  }

  function _buildSummary() {
    const s      = Store.getMonthlySummary(_calYear, _calMonth);
    const allTx  = Store.getTransactions();
    const bal    = allTx.reduce((a, t) => t.type === 'income' ? a + t.amount : a - t.amount, 0);
    const mn     = ['1','2','3','4','5','6','7','8','9','10','11','12'];
    return `
      <div style="display:flex;border-bottom:1px solid #f1f5f9;">
        <div style="flex:1;text-align:center;padding:8px 4px;border-right:1px solid #f1f5f9;">
          <div style="font-size:10px;color:#94a3b8;font-weight:500;">${mn[_calMonth-1]}月收入</div>
          <div style="font-size:13px;font-weight:700;color:#10b981;margin-top:1px;">+${Utils.formatTWD(s.income)}</div>
        </div>
        <div style="flex:1;text-align:center;padding:8px 4px;border-right:1px solid #f1f5f9;">
          <div style="font-size:10px;color:#94a3b8;font-weight:500;">${mn[_calMonth-1]}月支出</div>
          <div style="font-size:13px;font-weight:700;color:#ef4444;margin-top:1px;">-${Utils.formatTWD(s.expense)}</div>
        </div>
        <div style="flex:1;text-align:center;padding:8px 4px;">
          <div style="font-size:10px;color:#94a3b8;font-weight:500;">累計結餘</div>
          <div style="font-size:13px;font-weight:700;color:${bal>=0?'#10b981':'#ef4444'};margin-top:1px;">
            ${bal>=0?'+':''}${Utils.formatTWD(bal)}
          </div>
        </div>
      </div>`;
  }

  function _buildCalendar() {
    const prefix = `${_calYear}-${String(_calMonth).padStart(2,'0')}-`;
    const txs    = Store.getTransactions();

    // Build day totals
    const dayMap = {};
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

    // Empty leading cells
    let cells = '';
    for (let i = 0; i < firstDow; i++) cells += `<div></div>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const ds   = `${_calYear}-${String(_calMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const data = dayMap[ds] || { exp: 0, inc: 0 };
      const bg   = ds > today ? '#f1f5f9' : _dayBg(data.exp, data.inc > 0);
      const isSel   = ds === _selected;
      const isToday = ds === today;
      const future  = ds > today;
      cells += `
        <div class="tx-cal-day"
          onclick="PageTransactions.selectDate('${ds}')"
          style="background:${bg};opacity:${future?0.38:1};
            border-color:${isSel?'#3b82f6':isToday?'#94a3b8':'transparent'};">
          <span style="font-size:11px;line-height:1;
            font-weight:${isToday?700:500};
            color:${isSel?'#1d4ed8':isToday?'#1e293b':'#475569'};">${d}</span>
          ${data.inc>0&&data.exp===0?'<span style="width:3px;height:3px;border-radius:50%;background:#10b981;position:absolute;bottom:3px;"></span>':''}
        </div>`;
    }

    return `
      <div style="padding:8px 12px 6px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;">
          <button onclick="PageTransactions.prevMonth()"
            style="background:none;border:none;font-size:20px;cursor:pointer;color:#64748b;padding:2px 8px;line-height:1;">‹</button>
          <span style="font-size:13px;font-weight:700;color:#1e293b;">${_calYear}年 ${monthNames[_calMonth-1]}</span>
          <button onclick="PageTransactions.nextMonth()"
            style="background:none;border:none;font-size:20px;cursor:pointer;color:#64748b;padding:2px 8px;line-height:1;">›</button>
        </div>
        <div class="tx-cal-grid" style="margin-bottom:3px;">
          ${['日','一','二','三','四','五','六'].map(w =>
            `<div style="text-align:center;font-size:10px;color:#94a3b8;font-weight:600;padding-bottom:2px;">${w}</div>`
          ).join('')}
        </div>
        <div class="tx-cal-grid">${cells}</div>
        <div style="display:flex;align-items:center;gap:3px;margin-top:5px;justify-content:flex-end;">
          <span style="font-size:9px;color:#94a3b8;">少</span>
          ${['#ebedf0','#fef9c3','#fed7aa','#fb923c','#ef4444'].map(c =>
            `<div style="width:9px;height:9px;border-radius:2px;background:${c};"></div>`
          ).join('')}
          <span style="font-size:9px;color:#94a3b8;">多</span>
        </div>
      </div>`;
  }

  function _buildTabStrip() {
    const tabs = [
      { id:'day',    label:'📅 當日' },
      { id:'charts', label:'📊 圖表' },
      { id:'all',    label:'📋 全部' },
    ];
    return `
      <div style="display:flex;border-top:1px solid #f1f5f9;">
        ${tabs.map(t =>
          `<button class="tx-tab-btn${_tab===t.id?' active':''}"
            onclick="PageTransactions.setTab('${t.id}')">${t.label}</button>`
        ).join('')}
      </div>`;
  }

  // ── Tab body ──────────────────────────────────────────────────────
  function _buildBody() {
    if (_tab === 'day')    return _buildDayView();
    if (_tab === 'charts') return _buildChartsView();
    return _buildAllView();
  }

  function _buildDayView() {
    const txs  = Store.getTransactions().filter(t => t.date === _selected).slice().reverse();
    const [y,m,d] = _selected.split('-');
    const today   = _todayStr();
    const label   = _selected === today ? '今天' : `${+m}/${+d}`;
    const total   = txs.reduce((s,t) => t.type==='income' ? s+t.amount : s-t.amount, 0);

    const rows = txs.map(t => `
      <div style="display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid #f1f5f9;">
        <div style="width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;
          font-size:20px;flex-shrink:0;background:${t.type==='income'?'#d1fae5':'#fee2e2'};">
          ${_icon(t.category)}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:#1e293b;">${t.category}</div>
          <div style="font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${t.note || _payLabel(t) || (t.type==='income'?'收入':'支出')}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:15px;font-weight:700;color:${t.type==='income'?'#10b981':'#ef4444'};">
            ${t.type==='income'?'+':'-'}${Utils.formatTWD(t.amount)}
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
        <div style="font-size:40px;margin-bottom:10px;">📝</div>
        <div style="font-size:14px;margin-bottom:4px;">當天無記錄</div>
        <div style="font-size:12px;">點擊下方按鈕新增</div>
      </div>`;

    return `
      <div style="display:flex;flex-direction:column;height:100%;">
        <div style="display:flex;align-items:center;justify-content:space-between;
          padding:10px 14px;border-bottom:1px solid #e2e8f0;background:white;flex-shrink:0;">
          <div>
            <span style="font-size:14px;font-weight:700;color:#1e293b;">${y}/${m}/${d}</span>
            <span style="font-size:12px;color:#64748b;margin-left:6px;">${label}</span>
            ${txs.length > 0 ? `<span style="font-size:13px;font-weight:600;
              color:${total>=0?'#10b981':'#ef4444'};margin-left:10px;">
              ${total>=0?'+':''}${Utils.formatTWD(total)}</span>` : ''}
          </div>
          <button class="btn btn-primary" style="padding:7px 16px;font-size:13px;border-radius:10px;"
            onclick="PageTransactions.openAddForDate('${_selected}')">＋ 新增</button>
        </div>
        <div style="flex:1;overflow-y:auto;min-height:0;">
          ${txs.length > 0 ? rows : emptyState}
        </div>
      </div>`;
  }

  function _buildChartsView() {
    const prefix = `${_calYear}-${String(_calMonth).padStart(2,'0')}-`;
    const monthTxs = Store.getTransactions().filter(t => t.date.startsWith(prefix) && t.type==='expense');
    const catMap   = {};
    monthTxs.forEach(t => { catMap[t.category] = (catMap[t.category]||0) + t.amount; });
    const hasCat   = Object.keys(catMap).length > 0;
    const mn       = ['1','2','3','4','5','6','7','8','9','10','11','12'];

    return `
      <div style="padding:12px 12px 20px;display:flex;flex-direction:column;gap:12px;">
        <div class="card" style="padding:14px;">
          <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:10px;">收支趨勢（近6個月）</div>
          <div style="height:180px;"><canvas id="tx-trend-chart"></canvas></div>
        </div>
        <div class="card" style="padding:14px;">
          <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:10px;">
            ${mn[_calMonth-1]}月 支出分類
          </div>
          ${hasCat
            ? `<canvas id="tx-cat-chart" style="max-height:200px;"></canvas>`
            : `<div style="text-align:center;padding:24px 0;color:#94a3b8;font-size:13px;">此月份無支出記錄</div>`}
        </div>
      </div>`;
  }

  function _doCharts() {
    const { year, month: curM } = Utils.thisMonth();
    const monthly = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(year, curM - 1 - i, 1);
      const s = Store.getMonthlySummary(d.getFullYear(), d.getMonth()+1);
      monthly.push({ label: `${d.getMonth()+1}月`, income: s.income, expense: s.expense });
    }
    Charts.renderMonthlyCashFlow('tx-trend-chart', monthly);

    const prefix = `${_calYear}-${String(_calMonth).padStart(2,'0')}-`;
    const txs    = Store.getTransactions().filter(t => t.date.startsWith(prefix) && t.type==='expense');
    const catMap = {};
    txs.forEach(t => { catMap[t.category] = (catMap[t.category]||0) + t.amount; });
    const catData = Object.entries(catMap).map(([category,amount])=>({category,amount})).sort((a,b)=>b.amount-a.amount);
    if (catData.length > 0) Charts.renderCategoryDonut('tx-cat-chart', catData);
  }

  function _buildAllView() {
    const prefix = `${_calYear}-${String(_calMonth).padStart(2,'0')}-`;
    const all    = Store.getTransactions()
      .filter(t => t.date.startsWith(prefix))
      .slice().sort((a,b) => b.date.localeCompare(a.date));

    if (all.length === 0) {
      return `<div style="text-align:center;padding:40px 16px;color:#94a3b8;">
        <div style="font-size:40px;margin-bottom:10px;">📋</div>
        <div style="font-size:14px;">此月份無記錄</div>
      </div>`;
    }

    // Group by date
    const groups = {};
    for (const t of all) (groups[t.date] = groups[t.date]||[]).push(t);

    const sections = Object.entries(groups).sort((a,b)=>b[0].localeCompare(a[0])).map(([date, items]) => {
      const [,m,d] = date.split('-');
      const dayNet = items.reduce((s,t)=>t.type==='income'?s+t.amount:s-t.amount, 0);
      const rows   = items.map(t => `
        <div style="display:flex;align-items:center;gap:9px;padding:9px 14px;border-bottom:1px solid #f8fafc;">
          <div style="font-size:20px;width:26px;text-align:center;flex-shrink:0;">${_icon(t.category)}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:600;color:#334155;">${t.category}</div>
            <div style="font-size:11px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${t.note || _payLabel(t) || '-'}
            </div>
          </div>
          <div style="font-size:13px;font-weight:700;color:${t.type==='income'?'#10b981':'#ef4444'};flex-shrink:0;">
            ${t.type==='income'?'+':'-'}${Utils.formatTWD(t.amount)}
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
            <span style="font-size:11px;font-weight:700;color:${dayNet>=0?'#10b981':'#ef4444'};">
              ${dayNet>=0?'+':''}${Utils.formatTWD(dayNet)}
            </span>
          </div>
          ${rows}
        </div>`;
    }).join('');

    return `<div style="padding-bottom:16px;">${sections}</div>`;
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
    _tab = t;
    _refresh();
  }

  function openAddForDate(date) {
    Modal.openTransaction(
      { date, type: 'expense', amount: '', category: '其他', note: '', paymentMethod: 'cash', bankId: null, cardId: null },
      () => _refresh()
    );
  }

  function openAdd() {
    openAddForDate(_selected);
  }

  function openEdit(id) {
    const tx = Store.getTransactions().find(t => t.id === id);
    if (tx) Modal.openTransaction(tx, () => _refresh());
  }

  function del(id) {
    if (!Utils.confirm('確定要刪除此筆記錄？')) return;
    Store.deleteTransaction(id);
    Utils.showToast('已刪除');
    _refresh();
  }

  return { render, selectDate, prevMonth, nextMonth, setTab, openAdd, openAddForDate, openEdit, del };
})();
