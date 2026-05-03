/**
 * Dashboard page — overview of finances
 */
const PageDashboard = (() => {

  function render() {
    const { year, month } = Utils.thisMonth();
    const summary = Store.getMonthlySummary(year, month);

    // Last 6 months data for chart
    const monthlyData = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(year, month - 1 - i, 1);
      const y = d.getFullYear(), m = d.getMonth() + 1;
      const s = Store.getMonthlySummary(y, m);
      monthlyData.push({
        label: `${m}月`,
        income: s.income,
        expense: s.expense,
        net: s.net
      });
    }

    // Stock totals
    const twHoldings = Store.getHoldings('TW');
    const usHoldings = Store.getHoldings('US');
    const twCost     = twHoldings.reduce((s, h) => s + h.totalCost, 0);
    const usCost     = usHoldings.reduce((s, h) => s + h.totalCost, 0);

    const twRealized  = Store.getRealizedTrades('TW').reduce((s, r) => s + r.pnl, 0);
    const usRealized  = Store.getRealizedTrades('US').reduce((s, r) => s + r.pnl, 0);
    const twDivIncome = Store.getDividends('TW').reduce((s, d) => s + (d.cashTotal || 0), 0);
    const usDivIncome = Store.getDividends('US').reduce((s, d) => s + (d.cashTotal || 0), 0);

    // Banks
    const banks = Store.getBanks();
    const totalBankBalance = banks.reduce((s, b) => s + (b.balance || 0), 0);

    // Recent transactions
    const recentTx = Store.getTransactions().slice(0, 8);

    // Category breakdown this month
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    const monthTx = Store.getTransactions().filter(t => t.date.startsWith(prefix));
    const expenseTx = monthTx.filter(t => t.type === 'expense');
    const catMap = {};
    expenseTx.forEach(t => { catMap[t.category] = (catMap[t.category] || 0) + t.amount; });
    const catData = Object.entries(catMap)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);

    // Pending auto-debits
    const pendingDebits = Store.getPendingDebits().filter(d => d.total > 0 && d.daysUntilDebit >= 0 && d.daysUntilDebit <= 7);

    document.getElementById('app-content').innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title"><i class="fa-solid fa-chart-pie" style="color:#10B981;margin-right:8px;font-size:18px;"></i>財務總覽</div>
          <div class="page-subtitle">${year}年${month}月</div>
        </div>
      </div>

      <!-- Stats Row -->
      <div class="grid-4" style="margin-bottom:20px;">
        <div class="card">
          <div class="card-title"><i class="fa-solid fa-arrow-trend-up" style="color:#10B981;margin-right:5px;"></i>本月收入</div>
          <div class="stat-value" style="color:#10B981;">${Utils.formatTWD(summary.income)}</div>
          <div class="stat-sub">共 ${Store.getTransactions().filter(t=>t.date.startsWith(prefix)&&t.type==='income').length} 筆</div>
        </div>
        <div class="card">
          <div class="card-title"><i class="fa-solid fa-arrow-trend-down" style="color:#EF4444;margin-right:5px;"></i>本月支出</div>
          <div class="stat-value" style="color:#EF4444;">${Utils.formatTWD(summary.expense)}</div>
          <div class="stat-sub">共 ${expenseTx.length} 筆</div>
        </div>
        <div class="card">
          <div class="card-title"><i class="fa-solid fa-scale-balanced" style="color:#6366F1;margin-right:5px;"></i>本月結餘</div>
          <div class="stat-value ${Utils.pnlClass(summary.net)}">${Utils.formatTWD(summary.net)}</div>
          <div class="stat-sub">${Utils.pnlArrow(summary.net)} ${summary.net >= 0 ? '盈餘' : '虧損'}</div>
        </div>
        <div class="card">
          <div class="card-title"><i class="fa-solid fa-building-columns" style="color:#10B981;margin-right:5px;"></i>銀行總餘額</div>
          <div class="stat-value" style="color:#6366F1;">${Utils.formatTWD(totalBankBalance)}</div>
          <div class="stat-sub">${banks.length} 個帳戶</div>
        </div>
      </div>

      <!-- Bank Balances -->
      ${banks.length > 0 ? `
      <div class="card" style="margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <div class="card-title"><i class="fa-solid fa-building-columns" style="color:#10B981;margin-right:6px;"></i>銀行帳戶</div>
          <a href="#banks" class="btn btn-sm btn-ghost gap-1">管理銀行</a>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;">
          ${banks.map(b => {
            const cards = b.creditCards || [];
            const totalLimit = cards.reduce((s, c) => s + (c.limit || 0), 0);
            // Current month credit card spending for this bank
            const monthCCSpend = Store.getTransactions().filter(t =>
              t.type === 'expense' &&
              t.paymentMethod === 'credit_card' &&
              t.bankId === b.id &&
              t.date.startsWith(prefix)
            ).reduce((s, t) => s + t.amount, 0);

            return `
              <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px;">
                <div style="font-weight:600;font-size:14px;margin-bottom:8px;color:#1E293B;"><i class="fa-solid fa-building-columns" style="color:#10B981;font-size:13px;margin-right:4px;"></i>${b.name}</div>
                <div style="font-size:22px;font-weight:700;color:#3B82F6;margin-bottom:6px;">${Utils.formatTWD(b.balance || 0)}</div>
                ${cards.length > 0 ? `
                  <div style="font-size:11px;color:#64748B;border-top:1px solid #E2E8F0;padding-top:6px;margin-top:4px;">
                    ${cards.length} 張信用卡
                    ${totalLimit > 0 ? ` · 總額度 ${Utils.formatTWD(totalLimit)}` : ''}
                    ${monthCCSpend > 0 ? `<br><span style="color:#EF4444;">本月消費 ${Utils.formatTWD(monthCCSpend)}</span>` : ''}
                  </div>
                ` : `<div style="font-size:11px;color:#94A3B8;">無信用卡</div>`}
              </div>
            `;
          }).join('')}
        </div>

        ${pendingDebits.length > 0 ? `
          <div style="margin-top:12px;padding:10px 14px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;font-size:12px;color:#92400E;">
            ⚠️ 即將自動扣款：
            ${pendingDebits.map(d =>
              `<strong>${d.cardName}</strong> ${Utils.formatTWD(d.total)}（${d.daysUntilDebit === 0 ? '今日' : `${d.daysUntilDebit} 天後`}）`
            ).join(' · ')}
          </div>
        ` : ''}
      </div>
      ` : `
      <div class="card" style="margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div class="card-title"><i class="fa-solid fa-building-columns" style="color:#10B981;margin-right:6px;"></i>銀行帳戶</div>
          <a href="#banks" class="btn btn-primary btn-sm"><i class="fa-solid fa-plus fa-xs"></i> 新增銀行</a>
        </div>
        <div class="empty-state" style="padding:24px 0 8px;"><div class="empty-state-text">尚未設定銀行帳戶</div></div>
      </div>
      `}

      <!-- Charts Row -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
        <div class="card">
          <div class="card-title" style="margin-bottom:12px;">近 6 個月收支</div>
          <div class="chart-container" style="height:240px;">
            <canvas id="dash-cashflow-chart"></canvas>
          </div>
        </div>
        <div class="card">
          <div class="card-title" style="margin-bottom:12px;">本月支出分類</div>
          ${catData.length > 0
            ? `<canvas id="dash-cat-chart" style="max-height:240px;"></canvas>`
            : `<div class="empty-state" style="padding:60px 0;"><div class="empty-state-icon">🗂️</div><div class="empty-state-text">本月尚無支出紀錄</div></div>`
          }
        </div>
      </div>

      <!-- Investment Summary + Recent Tx -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">

        <!-- Investment Cards -->
        <div>
          <div class="card" style="margin-bottom:16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
              <div class="card-title">🇹🇼 台股</div>
              <a href="#tw-stocks" class="btn btn-sm btn-ghost gap-1">查看詳情</a>
            </div>
            <div class="grid-2" style="gap:12px;">
              <div>
                <div style="font-size:11px;color:#9CA3AF;">持股成本</div>
                <div style="font-size:18px;font-weight:700;">${Utils.formatTWD(twCost)}</div>
              </div>
              <div>
                <div style="font-size:11px;color:#9CA3AF;">已實現損益</div>
                <div style="font-size:18px;font-weight:700;" class="${Utils.pnlClass(twRealized)}">${Utils.formatTWD(twRealized, true)}</div>
              </div>
              <div>
                <div style="font-size:11px;color:#9CA3AF;">累計股利</div>
                <div style="font-size:16px;font-weight:600;color:#8B5CF6;">${Utils.formatTWD(twDivIncome)}</div>
              </div>
              <div>
                <div style="font-size:11px;color:#9CA3AF;">持股檔數</div>
                <div style="font-size:16px;font-weight:600;">${twHoldings.length} 檔</div>
              </div>
            </div>
          </div>
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
              <div class="card-title">🇺🇸 美股</div>
              <a href="#us-stocks" class="btn btn-sm btn-ghost gap-1">查看詳情</a>
            </div>
            <div class="grid-2" style="gap:12px;">
              <div>
                <div style="font-size:11px;color:#9CA3AF;">持股成本</div>
                <div style="font-size:18px;font-weight:700;">${Utils.formatUSD(usCost)}</div>
              </div>
              <div>
                <div style="font-size:11px;color:#9CA3AF;">已實現損益</div>
                <div style="font-size:18px;font-weight:700;" class="${Utils.pnlClass(usRealized)}">${Utils.formatUSD(usRealized, true)}</div>
              </div>
              <div>
                <div style="font-size:11px;color:#9CA3AF;">累計股利</div>
                <div style="font-size:16px;font-weight:600;color:#8B5CF6;">${Utils.formatUSD(usDivIncome)}</div>
              </div>
              <div>
                <div style="font-size:11px;color:#9CA3AF;">持股檔數</div>
                <div style="font-size:16px;font-weight:600;">${usHoldings.length} 檔</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Recent Transactions -->
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
            <div class="card-title">最近收支</div>
            <a href="#transactions" class="btn btn-sm btn-ghost gap-1">查看全部</a>
          </div>
          ${recentTx.length === 0
            ? `<div class="empty-state"><div class="empty-state-icon"><i class="fa-solid fa-credit-card" style="color:#6366F1;font-size:13px;"></i></div><div class="empty-state-text">尚無收支紀錄</div></div>`
            : `<div>
                ${recentTx.map(t => `
                  <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid #F3F4F6;">
                    <div>
                      <div style="font-size:13px;font-weight:500;">${t.note || t.category}</div>
                      <div style="font-size:11px;color:#9CA3AF;">${Utils.formatDate(t.date)} · <span class="category-pill">${t.category}</span></div>
                    </div>
                    <div style="font-size:14px;font-weight:700;" class="${t.type==='income' ? 'text-profit' : 'text-loss'}">
                      ${t.type==='income' ? '+' : '-'}${Utils.formatTWD(t.amount)}
                    </div>
                  </div>
                `).join('')}
               </div>`
          }
        </div>
      </div>
    `;

    // Render charts after DOM is ready
    setTimeout(() => {
      Charts.renderMonthlyCashFlow('dash-cashflow-chart', monthlyData);
      if (catData.length > 0) Charts.renderCategoryDonut('dash-cat-chart', catData);
    }, 50);
  }

  return { render };
})();
