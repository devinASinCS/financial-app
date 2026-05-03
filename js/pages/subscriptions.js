/**
 * Subscriptions page — recurring subscription management
 */
const PageSubscriptions = (() => {

  function render() {
    document.getElementById('app-content').innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">🔄 訂閱管理</div>
          <div class="page-subtitle">管理每月訂閱服務，自動計入信用卡消費</div>
        </div>
        <button class="btn btn-primary" onclick="PageSubscriptions.openAdd()"><i class="fa-solid fa-plus fa-xs"></i> 新增訂閱</button>
      </div>
      <div id="sub-summary" style="margin-bottom:20px;"></div>
      <div id="sub-list"></div>
    `;
    _renderSummary();
    _renderList();
  }

  function _renderSummary() {
    const subs = Store.getSubscriptions().filter(s => s.active);
    const wrap = document.getElementById('sub-summary');
    if (!wrap || subs.length === 0) return;

    // TWD subs: direct total; non-TWD: use lastRate if available
    let estimatedMonthly = 0;
    for (const s of subs) {
      if (s.currency === 'TWD') {
        estimatedMonthly += s.amount;
      } else if (s.lastRate) {
        estimatedMonthly += s.amount * s.lastRate;
      }
    }

    wrap.innerHTML = `
      <div class="grid-3">
        <div class="card">
          <div class="card-title">啟用訂閱數</div>
          <div class="stat-value" style="color:#6366F1;">${subs.length}</div>
          <div class="stat-sub">共 ${Store.getSubscriptions().length} 個訂閱</div>
        </div>
        <div class="card">
          <div class="card-title">預估每月費用</div>
          <div class="stat-value" style="color:#EF4444;">${Utils.formatTWD(estimatedMonthly)}</div>
          <div class="stat-sub">${estimatedMonthly > 0 ? '依最近一次匯率估算' : '尚無匯率資料'}</div>
        </div>
        <div class="card">
          <div class="card-title">預估每年費用</div>
          <div class="stat-value" style="color:#F59E0B;">${Utils.formatTWD(estimatedMonthly * 12)}</div>
          <div class="stat-sub">月費 × 12</div>
        </div>
      </div>
    `;
  }

  function _renderList() {
    const subs = Store.getSubscriptions();
    const wrap = document.getElementById('sub-list');
    if (!wrap) return;

    if (subs.length === 0) {
      wrap.innerHTML = `
        <div class="card">
          <div class="empty-state">
            <div class="empty-state-icon">🔄</div>
            <div class="empty-state-text">尚未新增任何訂閱服務</div>
            <button class="btn btn-primary" style="margin-top:12px;" onclick="PageSubscriptions.openAdd()"><i class="fa-solid fa-plus fa-xs"></i> 新增第一個訂閱</button>
          </div>
        </div>`;
      return;
    }

    const banks = Store.getBanks();
    const today = new Date();
    const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const nextMonthDate = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    // Common subscription icons
    const subIcons = {
      'youtube': '📺', 'netflix': '🎬', 'spotify': '🎵',
      'claude': '🤖', 'openai': '🤖', 'chatgpt': '🤖',
      'apple': '🍎', 'icloud': '☁️', 'google': '🔍',
      'adobe': '🎨', 'microsoft': '💼', 'office': '💼',
      'dropbox': '📦', 'notion': '📝', 'figma': '🎨',
      'github': '💻', 'aws': '☁️', 'vercel': '🚀',
      'disney': '🏰', 'hbo': '📺', 'prime': '📦',
    };

    function getIcon(name) {
      const lower = name.toLowerCase();
      for (const [key, icon] of Object.entries(subIcons)) {
        if (lower.includes(key)) return icon;
      }
      return '🔄';
    }

    function getNextBillingDate(sub) {
      const d = new Date(today.getFullYear(), today.getMonth(), sub.billingDay);
      if (d < today) {
        return new Date(today.getFullYear(), today.getMonth() + 1, sub.billingDay);
      }
      return d;
    }

    function getCardName(sub) {
      if (!sub.bankId && !sub.cardId) return null;
      const bank = banks.find(b => b.id === sub.bankId);
      if (!bank) return null;
      if (sub.cardId) {
        const card = (bank.creditCards || []).find(c => c.id === sub.cardId);
        return card ? `${bank.name} · ${card.name}` : bank.name;
      }
      return bank.name;
    }

    wrap.innerHTML = `
      <div class="card">
        <table class="data-table">
          <thead>
            <tr>
              <th>訂閱服務</th>
              <th>費用</th>
              <th>NT$ 估算</th>
              <th>下次扣款</th>
              <th>綁定信用卡</th>
              <th>上次帳單</th>
              <th class="text-center">狀態</th>
              <th class="text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            ${subs.map(s => {
              const nextDate = getNextBillingDate(s);
              const daysUntil = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));
              const cardName = getCardName(s);
              const isBilled = s.lastBilledMonth === currentMonthKey;
              const twdEstimate = s.currency === 'TWD'
                ? s.amount
                : (s.lastRate ? Math.round(s.amount * s.lastRate) : null);

              return `
                <tr style="${!s.active ? 'opacity:0.5;' : ''}">
                  <td>
                    <div style="display:flex;align-items:center;gap:8px;">
                      <span style="font-size:20px;">${getIcon(s.name)}</span>
                      <div>
                        <div style="font-weight:600;">${s.name}</div>
                        <div style="font-size:11px;color:#9CA3AF;">每月 ${s.billingDay} 日</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style="font-weight:600;">${s.currency} ${Utils.formatNumber(s.amount, s.currency === 'TWD' ? 0 : 2)}</div>
                  </td>
                  <td style="color:#6366F1;font-weight:600;">
                    ${twdEstimate !== null ? Utils.formatTWD(twdEstimate) : '<span style="color:#9CA3AF;font-size:12px;">待取得匯率</span>'}
                    ${s.lastRate && s.currency !== 'TWD' ? `<div style="font-size:11px;color:#9CA3AF;">1 ${s.currency} = ${Utils.formatNumber(s.lastRate, 2)} TWD</div>` : ''}
                  </td>
                  <td>
                    <div style="font-weight:500;">${nextDate.getMonth() + 1}/${nextDate.getDate()}</div>
                    <div style="font-size:11px;color:${daysUntil <= 3 ? '#EF4444' : '#9CA3AF'};">
                      ${daysUntil === 0 ? '今日' : daysUntil === 1 ? '明日' : `${daysUntil} 天後`}
                    </div>
                  </td>
                  <td style="font-size:12px;color:#64748B;">${cardName || '<span style="color:#9CA3AF;">未綁定</span>'}</td>
                  <td style="font-size:12px;">
                    ${isBilled
                      ? `<span style="color:#10B981;">✓ ${currentMonthKey.replace('-','/')} 已計入</span>`
                      : s.lastBilledMonth
                        ? `<span style="color:#9CA3AF;">${s.lastBilledMonth.replace('-','/')}</span>`
                        : '<span style="color:#9CA3AF;">–</span>'
                    }
                  </td>
                  <td class="text-center">
                    <label style="display:inline-flex;align-items:center;cursor:pointer;gap:5px;">
                      <input type="checkbox" ${s.active ? 'checked' : ''}
                        onchange="PageSubscriptions.toggleActive('${s.id}', this.checked)"
                        style="width:15px;height:15px;cursor:pointer;">
                      <span style="font-size:11px;color:${s.active ? '#10B981' : '#9CA3AF'};">${s.active ? '啟用' : '停用'}</span>
                    </label>
                  </td>
                  <td class="text-center">
                    <button class="btn btn-sm btn-ghost gap-1" onclick="PageSubscriptions.openEdit('${s.id}')">編輯</button>
                    <button class="btn btn-sm btn-ghost gap-1" style="margin-left:4px;color:#6366F1;"
                      onclick="PageSubscriptions.billNow('${s.id}')" title="立即計入本月帳單">
                      手動計入
                    </button>
                    <button class="btn btn-sm btn-ghost text-error gap-1" style="margin-left:4px;" onclick="PageSubscriptions.del('${s.id}')">刪除</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function openAdd() {
    Modal.openSubscription(null, () => { _renderSummary(); _renderList(); });
  }

  function openEdit(id) {
    const sub = Store.getSubscriptions().find(s => s.id === id);
    if (!sub) return;
    Modal.openSubscription(sub, () => { _renderSummary(); _renderList(); });
  }

  function del(id) {
    const sub = Store.getSubscriptions().find(s => s.id === id);
    if (!sub) return;
    if (!Utils.confirm(`確定要刪除訂閱「${sub.name}」？`)) return;
    Store.deleteSubscription(id);
    Utils.showToast('已刪除');
    _renderSummary();
    _renderList();
  }

  function toggleActive(id, active) {
    Store.updateSubscription(id, { active });
    Utils.showToast(active ? '已啟用' : '已停用');
    _renderSummary();
    _renderList();
  }

  /**
   * Manually bill a subscription for the current month with exchange rate fetch.
   */
  async function billNow(id) {
    const sub = Store.getSubscriptions().find(s => s.id === id);
    if (!sub) return;

    const today = new Date();
    const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

    if (sub.lastBilledMonth === monthKey) {
      Utils.showToast('本月已計入，若要重新計入請先刪除該筆消費紀錄');
      return;
    }

    Utils.showToast('正在取得匯率...');

    let twdAmount = sub.amount;
    let rate = 1;

    if (sub.currency !== 'TWD') {
      try {
        const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
        const data = await res.json();
        const rates = data.rates;
        // Convert: sub.currency → USD → TWD
        const usdAmount = sub.currency === 'USD' ? sub.amount : sub.amount / rates[sub.currency];
        twdAmount = Math.round(usdAmount * rates.TWD);
        rate = twdAmount / sub.amount;
      } catch (e) {
        // Fallback: use last known rate or prompt manual entry
        if (sub.lastRate) {
          rate = sub.lastRate;
          twdAmount = Math.round(sub.amount * rate);
          Utils.showToast(`無法取得即時匯率，使用上次匯率 1 ${sub.currency} = ${rate.toFixed(2)} TWD`);
        } else {
          Utils.showToast('無法取得匯率，請稍後再試或手動新增消費紀錄');
          return;
        }
      }
    }

    const billingDate = `${monthKey}-${String(sub.billingDay).padStart(2, '0')}`;
    const rateNote = sub.currency !== 'TWD' ? ` (${sub.currency} ${sub.amount} × ${rate.toFixed(2)})` : '';

    Store.addTransaction({
      date: billingDate,
      type: 'expense',
      amount: twdAmount,
      category: '訂閱',
      note: `${sub.name}${rateNote}`,
      source: 'subscription',
      paymentMethod: sub.cardId ? 'credit_card' : (sub.bankId ? 'bank_transfer' : 'cash'),
      bankId: sub.bankId || null,
      cardId: sub.cardId || null,
    });

    Store.updateSubscription(id, { lastBilledMonth: monthKey, lastRate: rate });
    Utils.showToast(`已計入：${sub.name} ${Utils.formatTWD(twdAmount)}`);
    _renderSummary();
    _renderList();
  }

  /**
   * Process all active subscriptions for the current month (called on app init).
   * Returns the number of subscriptions billed.
   */
  async function processAll() {
    const today = new Date();
    const todayDay = today.getDate();
    const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

    const pending = Store.getSubscriptions().filter(s =>
      s.active &&
      s.lastBilledMonth !== monthKey &&
      todayDay >= s.billingDay
    );

    if (pending.length === 0) return 0;

    // Fetch exchange rates once for all
    let rates = null;
    const needsRates = pending.some(s => s.currency !== 'TWD');
    if (needsRates) {
      try {
        const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
        const data = await res.json();
        rates = data.rates;
      } catch (e) {
        // Will fall back to lastRate per subscription
      }
    }

    let billed = 0;
    for (const sub of pending) {
      let twdAmount = sub.amount;
      let rate = 1;

      if (sub.currency !== 'TWD') {
        if (rates) {
          const usdAmount = sub.currency === 'USD' ? sub.amount : sub.amount / rates[sub.currency];
          twdAmount = Math.round(usdAmount * rates.TWD);
          rate = twdAmount / sub.amount;
        } else if (sub.lastRate) {
          rate = sub.lastRate;
          twdAmount = Math.round(sub.amount * rate);
        } else {
          // Skip if no rate available
          continue;
        }
      }

      const billingDate = `${monthKey}-${String(sub.billingDay).padStart(2, '0')}`;
      const rateNote = sub.currency !== 'TWD' ? ` (${sub.currency} ${sub.amount} × ${rate.toFixed(2)})` : '';

      Store.addTransaction({
        date: billingDate,
        type: 'expense',
        amount: twdAmount,
        category: '訂閱',
        note: `${sub.name}${rateNote}`,
        source: 'subscription',
        paymentMethod: sub.cardId ? 'credit_card' : (sub.bankId ? 'bank_transfer' : 'cash'),
        bankId: sub.bankId || null,
        cardId: sub.cardId || null,
      });

      Store.updateSubscription(sub.id, { lastBilledMonth: monthKey, lastRate: rate });
      billed++;
    }

    return billed;
  }

  return {
    render,
    openAdd, openEdit, del,
    toggleActive, billNow,
    processAll,
  };
})();
