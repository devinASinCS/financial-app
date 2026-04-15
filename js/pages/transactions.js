/**
 * Transactions page — income & expense tracking
 */
const PageTransactions = (() => {

  let _filterYear  = new Date().getFullYear();
  let _filterMonth = new Date().getMonth() + 1;
  let _filterType  = 'all';
  let _filterCat   = 'all';

  function render() {
    document.getElementById('app-content').innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">💳 收支記錄</div>
          <div class="page-subtitle">記錄每日收入與支出</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary" onclick="PageTransactions.openAdd()">＋ 新增</button>
        </div>
      </div>

      <!-- Summary Cards -->
      <div id="tx-summary-cards" class="grid-3" style="margin-bottom:20px;"></div>

      <!-- Charts -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
        <div class="card">
          <div class="card-title" style="margin-bottom:12px;">收支趨勢（近6個月）</div>
          <div class="chart-container" style="height:220px;"><canvas id="tx-trend-chart"></canvas></div>
        </div>
        <div class="card">
          <div class="card-title" style="margin-bottom:12px;">支出分類</div>
          <div id="tx-cat-chart-wrap"><canvas id="tx-cat-chart" style="max-height:220px;"></canvas></div>
        </div>
      </div>

      <!-- Filter Bar + Table -->
      <div class="card">
        <div class="filter-bar" style="margin-bottom:14px;">
          <select id="tx-filter-year" class="form-select" style="width:90px;" onchange="PageTransactions.onFilterChange()">
            ${_yearOptions()}
          </select>
          <select id="tx-filter-month" class="form-select" style="width:90px;" onchange="PageTransactions.onFilterChange()">
            <option value="0">全年</option>
            ${[...Array(12)].map((_, i) => `<option value="${i+1}" ${_filterMonth === i+1 ? 'selected' : ''}>${i+1}月</option>`).join('')}
          </select>
          <select id="tx-filter-type" class="form-select" style="width:90px;" onchange="PageTransactions.onFilterChange()">
            <option value="all">全部</option>
            <option value="income">收入</option>
            <option value="expense">支出</option>
          </select>
          <select id="tx-filter-cat" class="form-select" style="width:110px;" onchange="PageTransactions.onFilterChange()">
            <option value="all">所有分類</option>
            ${[...Store.EXPENSE_CATEGORIES, ...Store.INCOME_CATEGORIES].map(c =>
              `<option value="${c}">${c}</option>`
            ).join('')}
          </select>
          <span id="tx-count" style="font-size:12px;color:#9CA3AF;margin-left:auto;"></span>
        </div>
        <div id="tx-table-wrap"></div>
      </div>
    `;

    _renderSummary();
    _renderTable();
    _renderCharts();
  }

  function _yearOptions() {
    const current = new Date().getFullYear();
    let opts = '';
    for (let y = current; y >= current - 5; y--) {
      opts += `<option value="${y}" ${_filterYear === y ? 'selected' : ''}>${y}年</option>`;
    }
    return opts;
  }

  function _renderSummary() {
    const { year, month } = Utils.thisMonth();
    const s = Store.getMonthlySummary(year, month);
    const allTx = Store.getTransactions();
    const totalBalance = allTx.reduce((acc, t) => t.type === 'income' ? acc + t.amount : acc - t.amount, 0);

    document.getElementById('tx-summary-cards').innerHTML = `
      <div class="card">
        <div class="card-title">本月收入</div>
        <div class="stat-value" style="color:#10B981;">${Utils.formatTWD(s.income)}</div>
        <div class="stat-sub">${Utils.formatMonth(year + '-' + String(month).padStart(2,'0'))}</div>
      </div>
      <div class="card">
        <div class="card-title">本月支出</div>
        <div class="stat-value" style="color:#EF4444;">${Utils.formatTWD(s.expense)}</div>
        <div class="stat-sub">結餘 <span class="${Utils.pnlClass(s.net)}">${Utils.formatTWD(s.net)}</span></div>
      </div>
      <div class="card">
        <div class="card-title">累計總結餘</div>
        <div class="stat-value ${Utils.pnlClass(totalBalance)}">${Utils.formatTWD(totalBalance)}</div>
        <div class="stat-sub">共 ${allTx.length} 筆紀錄</div>
      </div>
    `;
  }

  function _getFiltered() {
    const year  = parseInt(document.getElementById('tx-filter-year')?.value  || _filterYear);
    const month = parseInt(document.getElementById('tx-filter-month')?.value || 0);
    const type  = document.getElementById('tx-filter-type')?.value || 'all';
    const cat   = document.getElementById('tx-filter-cat')?.value  || 'all';

    _filterYear  = year;
    _filterMonth = month;
    _filterType  = type;
    _filterCat   = cat;

    const prefix = month === 0
      ? `${year}-`
      : `${year}-${String(month).padStart(2, '0')}`;

    return Store.getTransactions().filter(t => {
      if (!t.date.startsWith(prefix)) return false;
      if (type !== 'all' && t.type !== type) return false;
      if (cat  !== 'all' && t.category !== cat) return false;
      return true;
    });
  }

  function _paymentLabel(t) {
    if (t.type === 'income') return '';
    const banks = Store.getBanks();
    if (t.paymentMethod === 'credit_card') {
      if (t.cardId) {
        for (const b of banks) {
          const card = (b.creditCards || []).find(c => c.id === t.cardId);
          if (card) return `<span style="color:#6366F1;font-size:11px;">💳 ${card.name}</span>`;
        }
      }
      return `<span style="color:#6366F1;font-size:11px;">💳 信用卡</span>`;
    }
    if (t.paymentMethod === 'bank_transfer') {
      if (t.bankId) {
        const bank = banks.find(b => b.id === t.bankId);
        if (bank) return `<span style="color:#0369A1;font-size:11px;">🏦 ${bank.name}</span>`;
      }
      return `<span style="color:#0369A1;font-size:11px;">🏦 銀行轉帳</span>`;
    }
    return `<span style="color:#6B7280;font-size:11px;">💵 現金</span>`;
  }

  function _sourceLabel(t) {
    if (t.source === 'dividend') return '📈股利';
    if (t.source === 'subscription') return '🔄訂閱';
    if (t.source === 'auto_debit') return '🏦自動扣款';
    return '手動';
  }

  function _renderTable() {
    const txs = _getFiltered();
    const countEl = document.getElementById('tx-count');
    if (countEl) countEl.textContent = `共 ${txs.length} 筆`;

    const wrap = document.getElementById('tx-table-wrap');
    if (!wrap) return;

    if (txs.length === 0) {
      wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">💳</div><div class="empty-state-text">此期間無收支紀錄</div></div>`;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>類型</th>
            <th>分類</th>
            <th>付款方式</th>
            <th>備註</th>
            <th style="font-size:11px;color:#9CA3AF;">來源</th>
            <th class="text-right">金額</th>
            <th class="text-center">操作</th>
          </tr>
        </thead>
        <tbody>
          ${txs.map(t => `
            <tr>
              <td style="white-space:nowrap;">${Utils.formatDate(t.date)}</td>
              <td>
                <span class="badge ${t.type === 'income' ? 'badge-income' : 'badge-expense'}">
                  ${t.type === 'income' ? '收入' : '支出'}
                </span>
              </td>
              <td><span class="category-pill">${t.category}</span></td>
              <td>${_paymentLabel(t)}</td>
              <td style="color:#6B7280;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.note || '-'}</td>
              <td style="font-size:11px;color:#9CA3AF;">${_sourceLabel(t)}</td>
              <td class="text-right" style="font-weight:700;">
                <span style="color:${t.type === 'income' ? '#10B981' : '#EF4444'}">
                  ${t.type === 'income' ? '+' : '-'}${Utils.formatTWD(t.amount)}
                </span>
              </td>
              <td class="text-center">
                <button class="btn btn-secondary btn-sm" onclick="PageTransactions.openEdit('${t.id}')">編輯</button>
                <button class="btn btn-danger btn-sm" style="margin-left:4px;" onclick="PageTransactions.del('${t.id}')">刪除</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function _renderCharts() {
    const { year, month: curMonth } = Utils.thisMonth();

    const monthlyData = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(year, curMonth - 1 - i, 1);
      const y = d.getFullYear(), m = d.getMonth() + 1;
      const s = Store.getMonthlySummary(y, m);
      monthlyData.push({ label: `${m}月`, income: s.income, expense: s.expense });
    }

    const txs = _getFiltered().filter(t => t.type === 'expense');
    const catMap = {};
    txs.forEach(t => { catMap[t.category] = (catMap[t.category] || 0) + t.amount; });
    const catData = Object.entries(catMap)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);

    setTimeout(() => {
      Charts.renderMonthlyCashFlow('tx-trend-chart', monthlyData);
      if (catData.length > 0) {
        Charts.renderCategoryDonut('tx-cat-chart', catData);
      } else {
        const wrap = document.getElementById('tx-cat-chart-wrap');
        if (wrap) wrap.innerHTML = `<div class="empty-state" style="padding:60px 0;"><div class="empty-state-icon">🗂️</div><div class="empty-state-text">此期間無支出紀錄</div></div>`;
      }
    }, 50);
  }

  function onFilterChange() {
    _renderTable();
    _renderCharts();
  }

  function openAdd() {
    Modal.openTransaction(null, () => { _renderSummary(); _renderTable(); _renderCharts(); });
  }

  function openEdit(id) {
    const tx = Store.getTransactions().find(t => t.id === id);
    if (!tx) return;
    Modal.openTransaction(tx, () => { _renderSummary(); _renderTable(); _renderCharts(); });
  }

  function del(id) {
    if (!Utils.confirm('確定要刪除此筆記錄？')) return;
    Store.deleteTransaction(id);
    Utils.showToast('已刪除');
    _renderSummary();
    _renderTable();
    _renderCharts();
  }

  return { render, onFilterChange, openAdd, openEdit, del };
})();
