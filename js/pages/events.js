/**
 * Events page — group transactions by activity (trip, wedding, etc.)
 *
 * Two views:
 *  - List view  : cards for each event with totals
 *  - Detail view: all transactions tagged to one event, with summary
 */
const PageEvents = (() => {

  let _currentEventId = null; // null = list view, string = detail view

  // ── Helpers ──────────────────────────────────────────────────────
  const _FX_SYMBOL = { JPY:'¥', USD:'$', EUR:'€', GBP:'£', KRW:'₩', THB:'฿', SGD:'S$', AUD:'A$', HKD:'HK$', CNY:'¥', MYR:'RM' };
  function _fxLabel(t) {
    if (!t.foreignCurrency || t.foreignCurrency === 'TWD') return '';
    const sym = _FX_SYMBOL[t.foreignCurrency] || (t.foreignCurrency + ' ');
    return `<div style="font-size:11px;color:#9CA3AF;font-weight:400;">${sym}${Utils.formatNumber(t.foreignAmount, 0)}</div>`;
  }

  // ── Entry point ──────────────────────────────────────────────────
  function render() {
    _currentEventId = null;
    _renderList();
  }

  // ── List view ────────────────────────────────────────────────────
  function _renderList() {
    const events = Store.getEvents().slice().sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    );

    const cardHtml = events.length === 0
      ? `<div class="card" style="grid-column:1/-1;">
           <div class="empty-state">
             <div class="empty-state-icon">🎯</div>
             <div class="empty-state-text">尚未建立任何活動</div>
             <p style="font-size:13px;color:#6B7280;max-width:340px;text-align:center;margin:8px auto 0;">
               建立活動後，可在新增支出時選擇歸屬，方便計算旅遊、婚禮等專案的總花費。
             </p>
             <button class="btn btn-primary" style="margin-top:14px;" onclick="PageEvents.openAdd()"><i class="fa-solid fa-plus fa-xs"></i> 新增活動</button>
           </div>
         </div>`
      : events.map(e => _eventCard(e)).join('');

    document.getElementById('app-content').innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title"><i class="fa-solid fa-calendar-days" style="color:#6366F1;margin-right:8px;font-size:18px;"></i>活動記帳</div>
          <div class="page-subtitle">將支出依活動分組，掌握每次旅遊或專案的總花費</div>
        </div>
        ${events.length > 0
          ? `<button class="btn btn-primary" onclick="PageEvents.openAdd()"><i class="fa-solid fa-plus fa-xs"></i> 新增活動</button>`
          : ''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px;">
        ${cardHtml}
      </div>
    `;
  }

  function _eventCard(e) {
    const txs      = Store.getEventTransactions(e.id);
    const expenses = txs.filter(t => t.type === 'expense');
    const income   = txs.filter(t => t.type === 'income');
    const totalExp = expenses.reduce((s, t) => s + t.amount, 0);
    const totalInc = income.reduce((s, t) => s + t.amount, 0);

    const dateRange = e.startDate && e.endDate
      ? `${Utils.formatDate(e.startDate)} ─ ${Utils.formatDate(e.endDate)}`
      : e.startDate
        ? `${Utils.formatDate(e.startDate)} 起`
        : '未設定日期';

    // Calculate number of days if range is set
    let daysLabel = '';
    if (e.startDate && e.endDate) {
      const days = Math.round((new Date(e.endDate) - new Date(e.startDate)) / 86400000) + 1;
      daysLabel = `${days} 天`;
    }

    return `
      <div class="card" style="border-top:4px solid ${e.color || '#3B82F6'};position:relative;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:12px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:28px;line-height:1;">${e.icon || '<i class="fa-solid fa-clipboard-list" style="color:#6B7280;"></i>'}</span>
            <div>
              <div style="font-weight:700;font-size:16px;color:#111827;">${e.name}</div>
              <div style="font-size:12px;color:#9CA3AF;margin-top:2px;">${dateRange}${daysLabel ? ' · ' + daysLabel : ''}</div>
            </div>
          </div>
        </div>

        <div style="display:flex;gap:16px;margin-bottom:16px;">
          <div>
            <div style="font-size:11px;color:#6B7280;margin-bottom:2px;">總支出</div>
            <div style="font-size:22px;font-weight:700;color:#EF4444;">${Utils.formatTWD(totalExp)}</div>
          </div>
          ${totalInc > 0 ? `
          <div>
            <div style="font-size:11px;color:#6B7280;margin-bottom:2px;">收入/退款</div>
            <div style="font-size:22px;font-weight:700;color:#10B981;">${Utils.formatTWD(totalInc)}</div>
          </div>` : ''}
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:13px;color:#6B7280;">${txs.length} 筆紀錄${e.note ? ' · ' + e.note : ''}</span>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-primary btn-sm" onclick="PageEvents.viewEvent('${e.id}')">查看明細</button>
            <button class="btn btn-sm btn-ghost gap-1" onclick="PageEvents.openEdit('${e.id}')"><i class="fa-solid fa-pen fa-xs"></i></button>
            <button class="btn btn-sm btn-ghost text-error gap-1" onclick="PageEvents.deleteEvent('${e.id}')"><i class="fa-solid fa-trash fa-xs"></i></button>
          </div>
        </div>
      </div>
    `;
  }

  // ── Detail view ──────────────────────────────────────────────────
  function viewEvent(id) {
    _currentEventId = id;
    _renderDetail();
  }

  function _renderDetail() {
    const event = Store.getEvents().find(e => e.id === _currentEventId);
    if (!event) { render(); return; }

    const txs      = Store.getEventTransactions(_currentEventId)
                          .slice().sort((a, b) => b.date.localeCompare(a.date));
    const expenses = txs.filter(t => t.type === 'expense');
    const income   = txs.filter(t => t.type === 'income');
    const totalExp = expenses.reduce((s, t) => s + t.amount, 0);
    const totalInc = income.reduce((s, t) => s + t.amount, 0);
    const netCost  = totalExp - totalInc;

    // Category breakdown for expenses
    const catTotals = {};
    expenses.forEach(t => {
      catTotals[t.category] = (catTotals[t.category] || 0) + t.amount;
    });
    const topCats = Object.entries(catTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Date range
    let daysLabel = '';
    if (event.startDate && event.endDate) {
      const days = Math.round((new Date(event.endDate) - new Date(event.startDate)) / 86400000) + 1;
      daysLabel = `${days} 天`;
      if (totalExp > 0) daysLabel += ` · 平均 ${Utils.formatTWD(Math.round(totalExp / days))}/天`;
    }

    const tableHtml = txs.length === 0
      ? `<div class="empty-state" style="padding:40px 0;">
           <div class="empty-state-icon">💸</div>
           <div class="empty-state-text">尚未新增任何支出</div>
           <button class="btn btn-primary" style="margin-top:12px;" onclick="PageEvents.openAddTx()"><i class="fa-solid fa-plus fa-xs"></i> 新增支出</button>
         </div>`
      : `<table class="data-table">
           <thead>
             <tr>
               <th>日期</th>
               <th>分類</th>
               <th>備註</th>
               <th class="text-center">類型</th>
               <th class="text-right">金額</th>
               <th class="text-center">操作</th>
             </tr>
           </thead>
           <tbody>
             ${txs.map(t => `
               <tr>
                 <td style="white-space:nowrap;">${Utils.formatDate(t.date)}</td>
                 <td><span style="background:#F3F4F6;padding:2px 8px;border-radius:12px;font-size:12px;">${t.category}</span></td>
                 <td style="color:#4B5563;">${t.note || '-'}</td>
                 <td class="text-center">
                   <span class="badge ${t.type === 'expense' ? 'badge-sell' : 'badge-buy'}">
                     ${t.type === 'expense' ? '支出' : '收入'}
                   </span>
                 </td>
                 <td class="text-right ${t.type === 'expense' ? 'text-loss' : 'text-profit'}" style="font-weight:600;">
                   ${t.type === 'expense' ? '-' : '+'}${Utils.formatTWD(t.amount)}
                   ${_fxLabel(t)}
                 </td>
                 <td class="text-center">
                   <button class="btn btn-sm btn-ghost gap-1" onclick="PageEvents.openEditTx('${t.id}')">編輯</button>
                   <button class="btn btn-sm btn-ghost text-error gap-1" style="margin-left:4px;" onclick="PageEvents.deleteTx('${t.id}')">刪除</button>
                 </td>
               </tr>
             `).join('')}
           </tbody>
         </table>`;

    const catBreakdown = topCats.length > 0
      ? `<div class="card">
           <div class="card-title" style="margin-bottom:12px;">支出分類</div>
           ${topCats.map(([cat, amt]) => {
             const pct = totalExp > 0 ? (amt / totalExp * 100) : 0;
             return `
               <div style="margin-bottom:10px;">
                 <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px;">
                   <span>${cat}</span>
                   <span style="font-weight:600;">${Utils.formatTWD(amt)} <span style="color:#9CA3AF;font-weight:400;">(${pct.toFixed(1)}%)</span></span>
                 </div>
                 <div style="height:6px;background:#F3F4F6;border-radius:3px;overflow:hidden;">
                   <div style="height:100%;width:${pct}%;background:${event.color || '#3B82F6'};border-radius:3px;transition:width .3s;"></div>
                 </div>
               </div>`;
           }).join('')}
         </div>`
      : '';

    document.getElementById('app-content').innerHTML = `
      <div class="page-header">
        <div style="display:flex;align-items:center;gap:12px;">
          <button class="btn btn-sm btn-ghost gap-1" onclick="PageEvents.render()" style="font-size:16px;padding:4px 10px;">←</button>
          <div>
            <div class="page-title">${event.icon || '<i class="fa-solid fa-clipboard-list" style="color:#6B7280;"></i>'} ${event.name}</div>
            <div class="page-subtitle">
              ${event.startDate && event.endDate
                ? `${Utils.formatDate(event.startDate)} ─ ${Utils.formatDate(event.endDate)}${daysLabel ? ' · ' + daysLabel : ''}`
                : event.startDate
                  ? `${Utils.formatDate(event.startDate)} 起`
                  : '活動記帳'}
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" onclick="Modal.openExchangeRates()"><i class="fa-solid fa-right-left fa-xs"></i> 匯率</button>
          <button class="btn btn-secondary" onclick="PageEvents.openEdit('${event.id}')"><i class="fa-solid fa-pen fa-xs"></i> 編輯活動</button>
          <button class="btn btn-secondary" onclick="PageEvents.openAddTx()"><i class="fa-solid fa-plus fa-xs"></i> 新增收支</button>
        </div>
      </div>

      <!-- Summary cards -->
      <div class="grid-3" style="margin-bottom:20px;">
        <div class="card" style="border-left:4px solid #EF4444;">
          <div class="card-title">總支出</div>
          <div class="stat-value text-loss">${Utils.formatTWD(totalExp)}</div>
          <div class="stat-sub">${expenses.length} 筆支出</div>
        </div>
        <div class="card" style="border-left:4px solid #10B981;">
          <div class="card-title">收入 / 退款</div>
          <div class="stat-value ${totalInc > 0 ? 'text-profit' : ''}">${Utils.formatTWD(totalInc)}</div>
          <div class="stat-sub">${income.length} 筆收入</div>
        </div>
        <div class="card" style="border-left:4px solid ${event.color || '#3B82F6'};">
          <div class="card-title">淨花費</div>
          <div class="stat-value text-loss">${Utils.formatTWD(netCost)}</div>
          <div class="stat-sub">支出 − 退款</div>
        </div>
      </div>

      <!-- Breakdown + Table -->
      <div style="display:grid;grid-template-columns:${catBreakdown ? '1fr 300px' : '1fr'};gap:20px;align-items:start;">
        <div class="card" style="overflow-x:auto;">
          <div class="card-title" style="margin-bottom:14px;">收支明細</div>
          ${tableHtml}
        </div>
        ${catBreakdown}
      </div>
    `;
  }

  // ── Actions ─────────────────────────────────────────────────────
  function openAdd() {
    Modal.openEvent(null, () => {
      if (_currentEventId) _renderDetail(); else _renderList();
    });
  }

  function openEdit(id) {
    const event = Store.getEvents().find(e => e.id === id);
    if (event) Modal.openEvent(event, () => {
      if (_currentEventId) _renderDetail(); else _renderList();
    });
  }

  function deleteEvent(id) {
    const event = Store.getEvents().find(e => e.id === id);
    if (!event) return;
    const txCount = Store.getEventTransactions(id).length;
    const msg = txCount > 0
      ? `確定刪除「${event.name}」？\n\n${txCount} 筆相關收支記錄將保留，但不再歸屬於此活動。`
      : `確定刪除「${event.name}」？`;
    if (!Utils.confirm(msg)) return;
    Store.deleteEvent(id);
    Utils.showToast('活動已刪除');
    _currentEventId = null;
    _renderList();
  }

  /** Open the transaction form pre-linked to the current event. */
  function openAddTx() {
    if (!_currentEventId) return;
    Modal.openTransaction({ eventId: _currentEventId }, () => _renderDetail());
  }

  function openEditTx(txId) {
    const tx = Store.getTransactions().find(t => t.id === txId);
    if (tx) Modal.openTransaction(tx, () => _renderDetail());
  }

  function deleteTx(txId) {
    if (!Utils.confirm('確定刪除此筆記錄？')) return;
    Store.deleteTransaction(txId);
    Utils.showToast('已刪除');
    _renderDetail();
  }

  return {
    render, viewEvent,
    openAdd, openEdit, deleteEvent,
    openAddTx, openEditTx, deleteTx,
  };
})();
