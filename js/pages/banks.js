/**
 * Banks page — bank account & credit card management
 */
const PageBanks = (() => {

  function render() {
    document.getElementById('app-content').innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">🏦 銀行設定</div>
          <div class="page-subtitle">管理銀行帳戶與信用卡</div>
        </div>
        <button class="btn btn-primary" onclick="PageBanks.openAddBank()">＋ 新增銀行</button>
      </div>
      <div id="banks-list"></div>
    `;
    _renderList();
  }

  function _renderList() {
    const banks = Store.getBanks();
    const wrap = document.getElementById('banks-list');
    if (!wrap) return;

    if (banks.length === 0) {
      wrap.innerHTML = `
        <div class="card">
          <div class="empty-state">
            <div class="empty-state-icon">🏦</div>
            <div class="empty-state-text">尚未新增任何銀行帳戶</div>
            <button class="btn btn-primary" style="margin-top:12px;" onclick="PageBanks.openAddBank()">＋ 新增第一個銀行</button>
          </div>
        </div>`;
      return;
    }

    const { year, month } = Utils.thisMonth();
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    const allTx = Store.getTransactions();

    wrap.innerHTML = banks.map(bank => {
      const cards = bank.creditCards || [];
      const totalLimit = cards.filter(c => !c.type || c.type === 'credit').reduce((s, c) => s + (c.limit || 0), 0);

      const cardsHtml = cards.length === 0
        ? `<div style="color:#94A3B8;font-size:13px;padding:12px 0;">尚未新增卡片</div>`
        : cards.map(card => {
            const isDebit = card.type === 'debit';
            if (isDebit) {
              return `
                <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 14px;margin-bottom:8px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                      <div style="font-weight:600;font-size:14px;margin-bottom:2px;">🏧 ${card.name}</div>
                      <div style="font-size:12px;color:#64748B;">簽帳金融卡</div>
                    </div>
                    <div style="display:flex;gap:6px;">
                      <button class="btn btn-secondary btn-sm" onclick="PageBanks.openEditCard('${bank.id}','${card.id}')">編輯</button>
                      <button class="btn btn-danger btn-sm" onclick="PageBanks.delCard('${bank.id}','${card.id}')">刪除</button>
                    </div>
                  </div>
                </div>`;
            }

            // Credit card — show usage bar
            const monthSpend = allTx.filter(t =>
              t.type === 'expense' &&
              t.paymentMethod === 'credit_card' &&
              t.cardId === card.id &&
              t.date.startsWith(prefix)
            ).reduce((s, t) => s + t.amount, 0);

            const usagePct = card.limit > 0 ? Math.min(100, (monthSpend / card.limit) * 100) : 0;
            const barColor = usagePct >= 80 ? '#EF4444' : usagePct >= 50 ? '#F59E0B' : '#10B981';

            return `
              <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 14px;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                  <div style="flex:1;">
                    <div style="font-weight:600;font-size:14px;margin-bottom:4px;">💳 ${card.name}</div>
                    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:#64748B;">
                      ${card.limit > 0 ? `<span>額度：<strong style="color:#374151;">${Utils.formatTWD(card.limit)}</strong></span>` : ''}
                      <span>結算日：每月 <strong style="color:#374151;">${card.statementDay}</strong> 日</span>
                      <span>扣款日：每月 <strong style="color:#374151;">${card.autoDebitDay}</strong> 日</span>
                    </div>
                    ${card.limit > 0 ? `
                      <div style="margin-top:8px;">
                        <div style="display:flex;justify-content:space-between;font-size:11px;color:#64748B;margin-bottom:3px;">
                          <span>本月消費 ${Utils.formatTWD(monthSpend)}</span>
                          <span style="color:${barColor};">${usagePct.toFixed(1)}%</span>
                        </div>
                        <div style="background:#E2E8F0;border-radius:4px;height:6px;">
                          <div style="background:${barColor};width:${usagePct}%;height:6px;border-radius:4px;transition:width .3s;"></div>
                        </div>
                      </div>
                    ` : ''}
                  </div>
                  <div style="display:flex;gap:6px;margin-left:12px;">
                    <button class="btn btn-secondary btn-sm" onclick="PageBanks.openEditCard('${bank.id}','${card.id}')">編輯</button>
                    <button class="btn btn-danger btn-sm" onclick="PageBanks.delCard('${bank.id}','${card.id}')">刪除</button>
                  </div>
                </div>
              </div>
            `;
          }).join('');

      return `
        <div class="card" style="margin-bottom:16px;">
          <!-- Bank Header -->
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
            <div>
              <div style="font-size:18px;font-weight:700;color:#1E293B;">🏦 ${bank.name}</div>
              <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                <span style="font-size:22px;font-weight:800;color:#3B82F6;">${Utils.formatTWD(bank.balance || 0)}</span>
                <button onclick="PageBanks.openAdjustBalance('${bank.id}')"
                  style="font-size:11px;color:#6366F1;background:none;border:1px solid #C7D2FE;border-radius:5px;padding:2px 8px;cursor:pointer;">
                  調整餘額
                </button>
              </div>
              ${cards.length > 0 ? `<div style="font-size:12px;color:#64748B;margin-top:2px;">${cards.length} 張卡片${totalLimit > 0 ? ' · 信用總額度 ' + Utils.formatTWD(totalLimit) : ''}</div>` : ''}
            </div>
            <div style="display:flex;gap:8px;">
              <button class="btn btn-secondary btn-sm" onclick="PageBanks.openEditBank('${bank.id}')">編輯</button>
              <button class="btn btn-danger btn-sm" onclick="PageBanks.delBank('${bank.id}')">刪除</button>
            </div>
          </div>

          <!-- Credit Cards -->
          <div style="border-top:1px solid #E2E8F0;padding-top:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <div style="font-size:13px;font-weight:600;color:#475569;">卡片</div>
              <button class="btn btn-secondary btn-sm" onclick="PageBanks.openAddCard('${bank.id}', '${bank.name}')">＋ 新增卡片</button>
            </div>
            ${cardsHtml}
          </div>
        </div>
      `;
    }).join('');
  }

  function openAddBank() {
    Modal.openBank(null, () => { _renderList(); });
  }

  function openEditBank(id) {
    const bank = Store.getBanks().find(b => b.id === id);
    if (!bank) return;
    Modal.openBank(bank, () => { _renderList(); });
  }

  function delBank(id) {
    const bank = Store.getBanks().find(b => b.id === id);
    if (!bank) return;
    if (!Utils.confirm(`確定要刪除「${bank.name}」？這將同時刪除其所有信用卡設定。`)) return;
    Store.deleteBank(id);
    Utils.showToast('已刪除');
    _renderList();
  }

  function openAddCard(bankId, bankName) {
    Modal.openCreditCard(bankId, bankName, null, () => { _renderList(); });
  }

  function openEditCard(bankId, cardId) {
    const bank = Store.getBanks().find(b => b.id === bankId);
    if (!bank) return;
    const card = (bank.creditCards || []).find(c => c.id === cardId);
    if (!card) return;
    Modal.openCreditCard(bankId, bank.name, card, () => { _renderList(); });
  }

  function delCard(bankId, cardId) {
    const bank = Store.getBanks().find(b => b.id === bankId);
    const card = (bank?.creditCards || []).find(c => c.id === cardId);
    if (!card) return;
    if (!Utils.confirm(`確定要刪除信用卡「${card.name}」？`)) return;
    Store.deleteCreditCard(bankId, cardId);
    Utils.showToast('已刪除');
    _renderList();
  }

  function openAdjustBalance(bankId) {
    const bank = Store.getBanks().find(b => b.id === bankId);
    if (!bank) return;

    Modal.open(`
      <div class="modal-header">
        <span class="modal-title">調整餘額 — ${bank.name}</span>
        <button class="modal-close" onclick="Modal.close()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">目前餘額 (NT$)</label>
          <input type="number" id="adj-balance" class="form-input" value="${bank.balance || 0}" step="1">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" onclick="PageBanks._saveBalance('${bankId}')">儲存</button>
      </div>
    `, () => { _renderList(); });
  }

  function _saveBalance(bankId) {
    const balance = parseFloat(document.getElementById('adj-balance').value || 0);
    Store.updateBank(bankId, { balance });
    Utils.showToast('餘額已更新');
    Modal.close();
  }

  return {
    render,
    openAddBank, openEditBank, delBank,
    openAddCard, openEditCard, delCard,
    openAdjustBalance, _saveBalance,
  };
})();
