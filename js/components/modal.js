/**
 * Modal — generic dialog component
 */
const Modal = (() => {
  let _onClose = null;

  function open(html, onClose) {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    content.innerHTML = html;
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    _onClose = onClose || null;

    overlay.onclick = (e) => {
      if (e.target === overlay) close();
    };
  }

  function close() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
    document.getElementById('modal-content').innerHTML = '';
    if (_onClose) { _onClose(); _onClose = null; }
  }

  // ── Transaction Modal ───────────────────────────────────────────
  function openTransaction(existing = null, onSave) {
    // `existing` may be a partial preset (no id) when opening from an event page
    const isEdit = !!(existing && existing.id);
    const t = existing || {
      date: Utils.today(), type: 'expense', amount: '',
      category: Store.EXPENSE_CATEGORIES[0], note: '', source: 'manual',
      paymentMethod: 'cash', bankId: null, cardId: null, eventId: null,
    };

    const expCats = Store.EXPENSE_CATEGORIES.map(c =>
      `<option value="${c}" ${t.category === c && t.type === 'expense' ? 'selected' : ''}>${c}</option>`
    ).join('');
    const incCats = Store.INCOME_CATEGORIES.map(c =>
      `<option value="${c}" ${t.category === c && t.type === 'income' ? 'selected' : ''}>${c}</option>`
    ).join('');

    // Build bank options for payment method
    const banks = Store.getBanks();
    const bankOptions = banks.map(b =>
      `<option value="${b.id}" ${t.bankId === b.id ? 'selected' : ''}>${b.name}</option>`
    ).join('');

    // Build card options for currently selected bank
    const selectedBank = banks.find(b => b.id === t.bankId);
    const cardOptions = selectedBank
      ? selectedBank.creditCards.map(c =>
          `<option value="${c.id}" ${t.cardId === c.id ? 'selected' : ''}>${c.name}</option>`
        ).join('')
      : '';

    const payMethod = t.paymentMethod || 'cash';

    open(`
      <div class="modal-header">
        <span class="modal-title">${isEdit ? '編輯收支' : '新增收支'}</span>
        <button class="modal-close" onclick="Modal.close()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">類型</label>
          <div style="display:flex;gap:10px;">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="radio" name="tx-type" value="expense" ${t.type === 'expense' ? 'checked' : ''} onchange="Modal._onTypeChange(this)">
              <span style="color:#EF4444;font-weight:600;">💸 支出</span>
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="radio" name="tx-type" value="income" ${t.type === 'income' ? 'checked' : ''} onchange="Modal._onTypeChange(this)">
              <span style="color:#10B981;font-weight:600;">💰 收入</span>
            </label>
          </div>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">日期</label>
            <input type="date" id="tx-date" class="form-input" value="${t.date}">
          </div>
          <div class="form-group">
            <label class="form-label">幣別與金額</label>
            <div style="display:flex;gap:6px;">
              <select id="tx-currency" class="form-select" style="width:auto;min-width:88px;"
                onchange="Modal._onCurrencyChange()">
                ${CURRENCIES.map(c =>
                  `<option value="${c.code}" ${(t.foreignCurrency || 'TWD') === c.code ? 'selected' : ''}>${c.code}</option>`
                ).join('')}
              </select>
              <input type="number" id="tx-foreign-amount" class="form-input" placeholder="0"
                value="${t.foreignCurrency && t.foreignCurrency !== 'TWD' ? (t.foreignAmount || '') : (t.amount || '')}"
                min="0" step="any" oninput="Modal._calcFX()">
            </div>
          </div>
        </div>
        <div id="tx-fx-row" style="display:${t.foreignCurrency && t.foreignCurrency !== 'TWD' ? '' : 'none'};margin-bottom:14px;">
          <div style="background:#FFF7ED;border-radius:8px;padding:10px 14px;font-size:13px;color:#92400E;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span>1&nbsp;<span id="tx-fx-code">${t.foreignCurrency || ''}</span>&nbsp;=</span>
            <input type="number" id="tx-fx-rate" class="form-input"
              style="width:90px;padding:4px 8px;font-size:13px;"
              value="${t.exchangeRate || ''}"
              min="0.00001" step="0.00001" oninput="Modal._calcFX()">
            <span>NT$&nbsp;&nbsp;→&nbsp;&nbsp;共計&nbsp;</span>
            <strong id="tx-fx-preview">—</strong>
            <button type="button"
              style="font-size:11px;color:#6B7280;text-decoration:underline;background:none;border:none;cursor:pointer;padding:0;margin-left:4px;"
              onclick="Modal.openExchangeRates()">編輯匯率</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">分類</label>
          <select id="tx-category" class="form-select">
            <optgroup label="支出" id="cat-expense-group">${expCats}</optgroup>
            <optgroup label="收入" id="cat-income-group">${incCats}</optgroup>
          </select>
        </div>

        <!-- Payment Method (expense only) -->
        <div class="form-group" id="payment-method-group">
          <label class="form-label">付款方式</label>
          <div style="display:flex;gap:14px;flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
              <input type="radio" name="tx-payment" value="cash" ${payMethod === 'cash' ? 'checked' : ''} onchange="Modal._onPaymentChange(this)">
              <span>💵 現金</span>
            </label>
            <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
              <input type="radio" name="tx-payment" value="bank_transfer" ${payMethod === 'bank_transfer' ? 'checked' : ''} onchange="Modal._onPaymentChange(this)">
              <span>🏦 銀行轉帳</span>
            </label>
            <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
              <input type="radio" name="tx-payment" value="credit_card" ${payMethod === 'credit_card' ? 'checked' : ''} onchange="Modal._onPaymentChange(this)">
              <span>💳 信用卡</span>
            </label>
          </div>
        </div>

        <div id="payment-bank-group" class="form-group" style="display:${(payMethod === 'bank_transfer' || payMethod === 'credit_card') && banks.length > 0 ? '' : 'none'};">
          <label class="form-label">${payMethod === 'credit_card' ? '信用卡所屬銀行' : '銀行'}</label>
          <select id="tx-bank" class="form-select" onchange="Modal._onPaymentBankChange()">
            <option value="">選擇銀行</option>
            ${bankOptions}
          </select>
        </div>

        <div id="payment-card-group" class="form-group" style="display:${payMethod === 'credit_card' && cardOptions ? '' : 'none'};">
          <label class="form-label">信用卡</label>
          <select id="tx-card" class="form-select">
            <option value="">選擇信用卡</option>
            ${cardOptions}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">備註</label>
          <textarea id="tx-note" class="form-textarea" placeholder="輸入備註...">${t.note || ''}</textarea>
        </div>

        ${(() => {
          const events = Store.getEvents();
          if (events.length === 0) return '';
          const opts = events.map(e =>
            `<option value="${e.id}" ${t.eventId === e.id ? 'selected' : ''}>${e.icon || '📋'} ${e.name}</option>`
          ).join('');
          return `
            <div class="form-group">
              <label class="form-label">歸屬活動 <span style="font-size:11px;color:#9CA3AF;font-weight:400;">（選填）</span></label>
              <select id="tx-event" class="form-select">
                <option value="">不歸屬活動</option>
                ${opts}
              </select>
            </div>`;
        })()}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" onclick="Modal._saveTx(${isEdit ? `'${t.id}'` : 'null'})">
          ${isEdit ? '儲存' : '新增'}
        </button>
      </div>
    `, onSave);

    setTimeout(() => {
      Modal._onTypeChange({ value: t.type });
      Modal._onPaymentChange({ value: payMethod });
      if (t.foreignCurrency && t.foreignCurrency !== 'TWD') Modal._calcFX();
    }, 0);
  }

  function _onTypeChange(radio) {
    const type = radio.value || document.querySelector('[name="tx-type"]:checked')?.value;
    const expGrp = document.getElementById('cat-expense-group');
    const incGrp = document.getElementById('cat-income-group');
    const payGrp = document.getElementById('payment-method-group');
    const payBankGrp = document.getElementById('payment-bank-group');
    const payCardGrp = document.getElementById('payment-card-group');
    if (!expGrp || !incGrp) return;
    if (type === 'expense') {
      expGrp.style.display = '';
      incGrp.style.display = 'none';
      if (expGrp.querySelector('option')) document.getElementById('tx-category').value = expGrp.querySelector('option').value;
      if (payGrp) payGrp.style.display = '';
    } else {
      expGrp.style.display = 'none';
      incGrp.style.display = '';
      if (incGrp.querySelector('option')) document.getElementById('tx-category').value = incGrp.querySelector('option').value;
      if (payGrp) payGrp.style.display = 'none';
      if (payBankGrp) payBankGrp.style.display = 'none';
      if (payCardGrp) payCardGrp.style.display = 'none';
    }
  }

  function _onPaymentChange(radio) {
    const method = radio.value || document.querySelector('[name="tx-payment"]:checked')?.value;
    const bankGrp = document.getElementById('payment-bank-group');
    const cardGrp = document.getElementById('payment-card-group');
    const bankLabel = bankGrp?.querySelector('label.form-label');
    const banks = Store.getBanks();

    if (!bankGrp || !cardGrp) return;

    if (method === 'bank_transfer') {
      bankGrp.style.display = banks.length > 0 ? '' : 'none';
      if (bankLabel) bankLabel.textContent = '銀行';
      cardGrp.style.display = 'none';
    } else if (method === 'credit_card') {
      bankGrp.style.display = banks.length > 0 ? '' : 'none';
      if (bankLabel) bankLabel.textContent = '信用卡所屬銀行';
      // Trigger card update
      Modal._onPaymentBankChange();
    } else {
      bankGrp.style.display = 'none';
      cardGrp.style.display = 'none';
    }
  }

  function _onPaymentBankChange() {
    const bankId = document.getElementById('tx-bank')?.value;
    const method = document.querySelector('[name="tx-payment"]:checked')?.value;
    const cardGrp = document.getElementById('payment-card-group');
    const cardSel = document.getElementById('tx-card');
    if (!cardGrp || !cardSel) return;

    if (method === 'credit_card' && bankId) {
      const bank = Store.getBanks().find(b => b.id === bankId);
      const cards = bank?.creditCards || [];
      cardSel.innerHTML = `<option value="">選擇信用卡</option>` +
        cards.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      cardGrp.style.display = cards.length > 0 ? '' : 'none';
    } else {
      cardGrp.style.display = 'none';
    }
  }

  function _onCurrencyChange() {
    const code  = document.getElementById('tx-currency')?.value || 'TWD';
    const fxRow = document.getElementById('tx-fx-row');
    const codeEl = document.getElementById('tx-fx-code');
    const rateEl = document.getElementById('tx-fx-rate');
    if (!fxRow) return;

    if (code !== 'TWD') {
      fxRow.style.display = '';
      if (codeEl) codeEl.textContent = code;
      if (rateEl) rateEl.value = Store.getExchangeRate(code);
      _calcFX();
    } else {
      fxRow.style.display = 'none';
      const prev = document.getElementById('tx-fx-preview');
      if (prev) prev.textContent = '—';
    }
  }

  function _calcFX() {
    const amt  = parseFloat(document.getElementById('tx-foreign-amount')?.value || 0);
    const rate = parseFloat(document.getElementById('tx-fx-rate')?.value || 0);
    const prev = document.getElementById('tx-fx-preview');
    if (!prev) return;
    prev.textContent = (amt > 0 && rate > 0)
      ? Utils.formatTWD(Math.round(amt * rate))
      : '—';
  }

  function _saveTx(existingId) {
    const type     = document.querySelector('[name="tx-type"]:checked')?.value || 'expense';
    const date     = document.getElementById('tx-date').value;
    const category = document.getElementById('tx-category').value;
    const note     = document.getElementById('tx-note').value.trim();

    if (!date) { Utils.showToast('請填寫日期'); return; }

    // ── Currency / FX ───────────────────────────────────────────
    const currency = document.getElementById('tx-currency')?.value || 'TWD';
    let amount, foreignAmount = null, foreignCurrency = null, exchangeRate = null;

    if (currency !== 'TWD') {
      foreignAmount = parseFloat(document.getElementById('tx-foreign-amount')?.value || 0);
      exchangeRate  = parseFloat(document.getElementById('tx-fx-rate')?.value || 0);
      if (!foreignAmount || foreignAmount <= 0) { Utils.showToast('請填寫有效金額'); return; }
      if (!exchangeRate  || exchangeRate  <= 0) { Utils.showToast('請填寫匯率'); return; }
      amount = Math.round(foreignAmount * exchangeRate);
      foreignCurrency = currency;
    } else {
      amount = parseFloat(document.getElementById('tx-foreign-amount')?.value || 0);
      if (!amount || amount <= 0) { Utils.showToast('請填寫有效金額'); return; }
    }

    let paymentMethod = null, bankId = null, cardId = null;
    if (type === 'expense') {
      paymentMethod = document.querySelector('[name="tx-payment"]:checked')?.value || 'cash';
      bankId = document.getElementById('tx-bank')?.value || null;
      cardId = document.getElementById('tx-card')?.value || null;
      if (paymentMethod === 'cash') { bankId = null; cardId = null; }
      if (paymentMethod === 'bank_transfer') { cardId = null; }
    }

    const eventId = document.getElementById('tx-event')?.value || null;
    const data = {
      date, type, amount, category, note, source: 'manual',
      paymentMethod, bankId: bankId || null, cardId: cardId || null,
      eventId: eventId || null,
      foreignAmount, foreignCurrency, exchangeRate,
    };
    if (existingId) {
      Store.updateTransaction(existingId, data);
      Utils.showToast('已更新');
    } else {
      Store.addTransaction(data);
      Utils.showToast('已新增');
    }
    close();
  }

  // ── Stock Trade Modal ───────────────────────────────────────────
  function openStockTrade(market, existing = null, onSave) {
    const isEdit = !!existing;
    const isTW = market === 'TW';
    const t = existing || {
      date: Utils.today(), symbol: '', name: '', action: 'buy',
      quantity: '', price: '', fee: '', tax: '', market
    };

    open(`
      <div class="modal-header">
        <span class="modal-title">${isEdit ? '編輯' : '新增'}${isTW ? '台股' : '美股'}交易</span>
        <button class="modal-close" onclick="Modal.close()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">買賣別</label>
          <div style="display:flex;gap:10px;">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="radio" name="trade-action" value="buy" ${t.action === 'buy' ? 'checked' : ''}>
              <span style="color:#3B82F6;font-weight:600;">📈 買進</span>
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="radio" name="trade-action" value="sell" ${t.action === 'sell' ? 'checked' : ''}>
              <span style="color:#F59E0B;font-weight:600;">📉 賣出</span>
            </label>
          </div>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">日期</label>
            <input type="date" id="trade-date" class="form-input" value="${t.date}">
          </div>
          <div class="form-group">
            <label class="form-label">${isTW ? '股票代號' : '股票代碼'}</label>
            <input type="text" id="trade-symbol" class="form-input" placeholder="${isTW ? '例：2330' : '例：AAPL'}" value="${t.symbol}" style="text-transform:uppercase">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">股票名稱</label>
          <input type="text" id="trade-name" class="form-input" placeholder="${isTW ? '例：台積電' : '例：Apple Inc.'}" value="${t.name}">
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">股數${isTW ? '（張=1000股）' : ''}</label>
            <input type="number" id="trade-qty" class="form-input" placeholder="0" value="${t.quantity || ''}" min="1" step="${isTW ? '1000' : '1'}">
          </div>
          <div class="form-group">
            <label class="form-label">成交價格 (${isTW ? 'NT$' : '$'})</label>
            <input type="number" id="trade-price" class="form-input" placeholder="0.00" value="${t.price || ''}" min="0" step="0.01">
          </div>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">手續費 (${isTW ? 'NT$' : '$'})</label>
            <input type="number" id="trade-fee" class="form-input" placeholder="0" value="${t.fee || ''}" min="0" step="1">
          </div>
          <div class="form-group">
            <label class="form-label">${isTW ? '交易稅 (NT$)' : '稅費 ($)'}</label>
            <input type="number" id="trade-tax" class="form-input" placeholder="0" value="${t.tax || ''}" min="0" step="1">
          </div>
        </div>
        <div id="trade-total-preview" style="background:#F0FDF4;padding:10px 14px;border-radius:8px;font-size:13px;color:#065F46;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" onclick="Modal._saveTrade('${market}', ${isEdit ? `'${t.id}'` : 'null'})">
          ${isEdit ? '儲存' : '新增'}
        </button>
      </div>
    `, onSave);

    ['trade-qty','trade-price','trade-fee','trade-tax'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', _updateTradePreview);
    });
    _updateTradePreview();
  }

  function _updateTradePreview() {
    const qty   = parseFloat(document.getElementById('trade-qty')?.value || 0);
    const price = parseFloat(document.getElementById('trade-price')?.value || 0);
    const fee   = parseFloat(document.getElementById('trade-fee')?.value || 0);
    const tax   = parseFloat(document.getElementById('trade-tax')?.value || 0);
    const action= document.querySelector('[name="trade-action"]:checked')?.value || 'buy';
    const prev  = document.getElementById('trade-total-preview');
    if (!prev) return;

    const gross = qty * price;
    const net   = action === 'buy' ? gross + fee + tax : gross - fee - tax;
    prev.textContent = `成交金額：${Utils.formatNumber(gross, 0)}  |  ${action === 'buy' ? '實付' : '實收'}：${Utils.formatNumber(net, 0)}`;
  }

  function _saveTrade(market, existingId) {
    const action   = document.querySelector('[name="trade-action"]:checked')?.value || 'buy';
    const date     = document.getElementById('trade-date').value;
    const symbol   = document.getElementById('trade-symbol').value.trim().toUpperCase();
    const name     = document.getElementById('trade-name').value.trim();
    const quantity = parseFloat(document.getElementById('trade-qty').value);
    const price    = parseFloat(document.getElementById('trade-price').value);
    const fee      = parseFloat(document.getElementById('trade-fee').value || 0);
    const tax      = parseFloat(document.getElementById('trade-tax').value || 0);

    if (!date || !symbol || !quantity || !price) { Utils.showToast('請填寫必要欄位'); return; }

    const data = { date, symbol, name: name || symbol, action, quantity, price, fee, tax, market };
    if (existingId) {
      Store.updateStockTrade(existingId, data);
      Utils.showToast('已更新');
    } else {
      Store.addStockTrade(data);
      Utils.showToast('已新增');
    }
    close();
  }

  // ── Dividend Modal ──────────────────────────────────────────────
  function openDividend(market, existing = null, onSave, holdings = []) {
    const isEdit = !!existing;
    const isTW = market === 'TW';
    const d = existing || {
      date: Utils.today(), symbol: '', name: '',
      cashPerShare: '', stockRatio: '',
      holdingQuantity: '', note: '', market
    };

    // If pre-filled with a specific holding, auto-select it
    const preHolding = holdings.find(h => h.symbol === d.symbol);
    const holdingOptions = holdings.map(h =>
      `<option value="${h.symbol}" data-qty="${h.quantity}" data-name="${h.name}"
        ${d.symbol === h.symbol ? 'selected' : ''}>
        ${h.symbol} ${h.name} (${Utils.formatShares(h.quantity)}股)
       </option>`
    ).join('');

    // Pre-fill holding quantity from current holdings if not editing
    const preQty = d.holdingQuantity || (preHolding ? preHolding.quantity : '');

    open(`
      <div class="modal-header">
        <span class="modal-title">${isEdit ? '編輯' : '新增'}除權息紀錄</span>
        <button class="modal-close" onclick="Modal.close()">✕</button>
      </div>
      <div class="modal-body">
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">除息/除權日</label>
            <input type="date" id="div-date" class="form-input" value="${d.date}">
          </div>
          <div class="form-group">
            <label class="form-label">股票</label>
            ${holdings.length > 0 ? `
              <select id="div-symbol-select" class="form-select" onchange="Modal._onDivStockChange(this)">
                <option value="">手動輸入</option>
                ${holdingOptions}
              </select>
              <div style="font-size:11px;color:#9CA3AF;margin-top:3px;">選擇持股後自動帶入股數</div>
            ` : ''}
            <input type="text" id="div-symbol" class="form-input" style="margin-top:${holdings.length > 0 ? '6px' : '0'}"
              placeholder="${isTW ? '股票代號' : '代碼'}" value="${d.symbol}"
              oninput="Modal._onDivSymbolInput('${market}')">
          </div>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">股票名稱</label>
            <input type="text" id="div-name" class="form-input" placeholder="${isTW ? '例：台積電' : '例：AAPL'}" value="${d.name}">
          </div>
          <div class="form-group">
            <label class="form-label">
              持有股數
              ${holdings.length > 0 ? `<span style="font-size:11px;color:#9CA3AF;font-weight:400;">（從持股自動帶入）</span>` : ''}
            </label>
            <input type="number" id="div-holding" class="form-input" placeholder="0" value="${preQty}" oninput="Modal._calcDiv()">
          </div>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">現金股利 (${isTW ? 'NT$/股' : '$/股'})</label>
            <input type="number" id="div-cash" class="form-input" placeholder="0.00" value="${d.cashPerShare || ''}" step="0.0001" oninput="Modal._calcDiv()">
          </div>
          ${isTW ? `
          <div class="form-group">
            <label class="form-label">股票股利 (股/千股)</label>
            <input type="number" id="div-stock" class="form-input" placeholder="0" value="${d.stockRatio || ''}" step="0.0001" oninput="Modal._calcDiv()">
          </div>
          ` : '<div></div>'}
        </div>
        <div id="div-calc-preview" style="background:#EFF6FF;padding:12px 14px;border-radius:8px;font-size:13px;color:#1E40AF;display:none;"></div>
        <div class="form-group" style="margin-top:12px;">
          <label class="form-label">備註</label>
          <input type="text" id="div-note" class="form-input" placeholder="備註..." value="${d.note || ''}">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" onclick="Modal._saveDiv('${market}', ${isEdit ? `'${d.id}'` : 'null'})">
          ${isEdit ? '儲存' : '新增並計入'}
        </button>
      </div>
    `, onSave);

    setTimeout(() => Modal._calcDiv(), 0);
  }

  function _onDivStockChange(sel) {
    const opt = sel.selectedOptions[0];
    if (!opt || !opt.value) return;
    const sym = document.getElementById('div-symbol');
    const name = document.getElementById('div-name');
    const holding = document.getElementById('div-holding');
    if (sym) sym.value = opt.value;
    if (name) name.value = opt.dataset.name || '';
    if (holding) { holding.value = opt.dataset.qty || ''; Modal._calcDiv(); }
  }

  function _onDivSymbolInput(market) {
    const symbol = document.getElementById('div-symbol')?.value.trim().toUpperCase();
    if (!symbol || symbol.length < 2) return;
    const holdings = Store.getHoldings(market);
    const match = holdings.find(h => h.symbol === symbol);
    if (match) {
      const nameEl = document.getElementById('div-name');
      const holdingEl = document.getElementById('div-holding');
      if (nameEl && !nameEl.value) nameEl.value = match.name;
      if (holdingEl && !holdingEl.value) {
        holdingEl.value = match.quantity;
        Modal._calcDiv();
      }
    }
  }

  function _calcDiv() {
    const holding     = parseFloat(document.getElementById('div-holding')?.value || 0);
    const cashPerShare= parseFloat(document.getElementById('div-cash')?.value || 0);
    const stockRatioEl= document.getElementById('div-stock');
    const stockRatio  = stockRatioEl ? parseFloat(stockRatioEl.value || 0) : 0;
    const prev        = document.getElementById('div-calc-preview');
    if (!prev) return;

    const cashTotal  = holding * cashPerShare;
    const stockShares= Math.floor(holding / 1000 * stockRatio);

    if (cashTotal > 0 || stockShares > 0) {
      prev.style.display = '';
      prev.innerHTML = `
        <strong>預計獲得：</strong><br>
        ${cashTotal > 0 ? `💵 現金股利：<strong>NT$ ${Utils.formatNumber(cashTotal, 2)}</strong><br>` : ''}
        ${stockShares > 0 ? `📈 股票股利：<strong>${stockShares} 股</strong>` : ''}
      `;
    } else {
      prev.style.display = 'none';
    }
  }

  function _saveDiv(market, existingId) {
    const date          = document.getElementById('div-date').value;
    const symbol        = document.getElementById('div-symbol').value.trim();
    const name          = document.getElementById('div-name').value.trim();
    const holdingQty    = parseFloat(document.getElementById('div-holding').value || 0);
    const cashPerShare  = parseFloat(document.getElementById('div-cash').value || 0);
    const stockRatioEl  = document.getElementById('div-stock');
    const stockRatio    = stockRatioEl ? parseFloat(stockRatioEl.value || 0) : 0;
    const note          = document.getElementById('div-note').value.trim();

    if (!date || !symbol) { Utils.showToast('請填寫日期與股票代號'); return; }

    const cashTotal  = holdingQty * cashPerShare;
    const stockShares= Math.floor(holdingQty / 1000 * stockRatio);

    const data = {
      date, symbol, name: name || symbol, market,
      cashPerShare, stockRatio, holdingQuantity: holdingQty,
      cashTotal, stockShares, note,
    };

    if (existingId) {
      Store.updateDividend(existingId, data);
      Utils.showToast('已更新');
    } else {
      Store.addDividend(data);
      if (cashTotal > 0) {
        Store.addTransaction({
          date, type: 'income',
          amount: cashTotal,
          category: '股利',
          note: `${symbol} ${name} 現金股利`,
          source: 'dividend',
        });
      }
      Utils.showToast(`已新增${cashTotal > 0 ? `，現金股利 NT$${Utils.formatNumber(cashTotal,2)} 已計入收入` : ''}`);
    }
    close();
  }

  // ── Import Modal ────────────────────────────────────────────────
  function openImport(market, onImport) {
    const isTW = market === 'TW';
    open(`
      <div class="modal-header">
        <span class="modal-title">匯入${isTW ? '台股' : '美股'}對帳單</span>
        <button class="modal-close" onclick="Modal.close()">✕</button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;color:#6B7280;margin-bottom:12px;">
          請將對帳單文字貼上，系統會自動解析交易紀錄。
        </p>
        <div style="background:#F3F4F6;border-radius:8px;padding:12px;margin-bottom:14px;font-size:12px;color:#4B5563;">
          <strong>支援格式（每筆交易一組）：</strong><br>
          ${isTW ? `
            日期：2024/03/15<br>
            股票代碼：2330<br>
            股票名稱：台積電<br>
            交易別：買進<br>
            成交股數：1000<br>
            成交價格：735<br>
            手續費：1050<br>
            交易稅：0
          ` : `
            Date: 2024-03-15<br>
            Symbol: AAPL<br>
            Description: Apple Inc.<br>
            Action: Buy<br>
            Quantity: 10<br>
            Price: 172.50<br>
            Commission: 0
          `}
        </div>
        <textarea id="import-text" class="import-area" placeholder="貼上對帳單內容..."></textarea>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" onclick="Modal._doImport('${market}')">解析並匯入</button>
      </div>
    `, onImport);
  }

  function _doImport(market) {
    const text = document.getElementById('import-text').value;
    if (!text.trim()) { Utils.showToast('請貼上對帳單內容'); return; }

    const trades = market === 'TW'
      ? Utils.parseTWStatement(text)
      : Utils.parseUSStatement(text);

    if (trades.length === 0) {
      Utils.showToast('未能解析出任何交易，請確認格式');
      return;
    }

    trades.forEach(t => Store.addStockTrade({ ...t, market }));
    Utils.showToast(`成功匯入 ${trades.length} 筆交易`);
    close();
  }

  // ── Bank Modal ──────────────────────────────────────────────────
  function openBank(existing = null, onSave) {
    const isEdit = !!existing;
    const b = existing || { name: '', balance: 0 };

    open(`
      <div class="modal-header">
        <span class="modal-title">${isEdit ? '編輯銀行' : '新增銀行'}</span>
        <button class="modal-close" onclick="Modal.close()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">銀行名稱</label>
          <input type="text" id="bank-name" class="form-input" placeholder="例：玉山銀行、國泰世華" value="${b.name}">
        </div>
        <div class="form-group">
          <label class="form-label">目前餘額 (NT$)</label>
          <input type="number" id="bank-balance" class="form-input" placeholder="0" value="${b.balance || 0}" step="1">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" onclick="Modal._saveBank(${isEdit ? `'${b.id}'` : 'null'})">
          ${isEdit ? '儲存' : '新增'}
        </button>
      </div>
    `, onSave);
  }

  function _saveBank(existingId) {
    const name    = document.getElementById('bank-name').value.trim();
    const balance = parseFloat(document.getElementById('bank-balance').value || 0);

    if (!name) { Utils.showToast('請填寫銀行名稱'); return; }

    if (existingId) {
      Store.updateBank(existingId, { name, balance });
      Utils.showToast('已更新');
    } else {
      Store.addBank({ name, balance });
      Utils.showToast('已新增');
    }
    close();
  }

  // ── Credit Card Modal ───────────────────────────────────────────
  function openCreditCard(bankId, bankName, existing = null, onSave) {
    const isEdit = !!existing;
    const c = existing || { name: '', limit: 0, statementDay: 25, autoDebitDay: 15 };

    open(`
      <div class="modal-header">
        <span class="modal-title">${isEdit ? '編輯信用卡' : '新增信用卡'} — ${bankName}</span>
        <button class="modal-close" onclick="Modal.close()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">信用卡名稱</label>
          <input type="text" id="card-name" class="form-input" placeholder="例：玉山 U Bear Card" value="${c.name}">
        </div>
        <div class="form-group">
          <label class="form-label">信用額度 (NT$)</label>
          <input type="number" id="card-limit" class="form-input" placeholder="0" value="${c.limit || ''}" step="1000" min="0">
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">結算日（每月幾號）</label>
            <input type="number" id="card-statement-day" class="form-input" placeholder="25" value="${c.statementDay || 25}" min="1" max="31">
            <div style="font-size:11px;color:#9CA3AF;margin-top:4px;">帳單截止日</div>
          </div>
          <div class="form-group">
            <label class="form-label">自動扣款日（每月幾號）</label>
            <input type="number" id="card-debit-day" class="form-input" placeholder="15" value="${c.autoDebitDay || 15}" min="1" max="31">
            <div style="font-size:11px;color:#9CA3AF;margin-top:4px;">從銀行帳戶自動扣款</div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" onclick="Modal._saveCreditCard('${bankId}', ${isEdit ? `'${c.id}'` : 'null'})">
          ${isEdit ? '儲存' : '新增'}
        </button>
      </div>
    `, onSave);
  }

  function _saveCreditCard(bankId, existingId) {
    const name         = document.getElementById('card-name').value.trim();
    const limit        = parseFloat(document.getElementById('card-limit').value || 0);
    const statementDay = parseInt(document.getElementById('card-statement-day').value || 25);
    const autoDebitDay = parseInt(document.getElementById('card-debit-day').value || 15);

    if (!name) { Utils.showToast('請填寫信用卡名稱'); return; }
    if (statementDay < 1 || statementDay > 31) { Utils.showToast('結算日請填 1–31'); return; }
    if (autoDebitDay < 1 || autoDebitDay > 31) { Utils.showToast('扣款日請填 1–31'); return; }

    const data = { name, limit, statementDay, autoDebitDay };
    if (existingId) {
      Store.updateCreditCard(bankId, existingId, data);
      Utils.showToast('已更新');
    } else {
      Store.addCreditCard(bankId, data);
      Utils.showToast('已新增');
    }
    close();
  }

  // ── Subscription Modal ──────────────────────────────────────────
  function openSubscription(existing = null, onSave) {
    const isEdit = !!existing;
    const s = existing || {
      name: '', currency: 'USD', amount: '', billingDay: 1,
      bankId: '', cardId: '', active: true,
    };

    const banks = Store.getBanks();
    const bankOptions = banks.map(b =>
      `<option value="${b.id}" ${s.bankId === b.id ? 'selected' : ''}>${b.name}</option>`
    ).join('');
    const selectedBank = banks.find(b => b.id === s.bankId);
    const cardOptions = selectedBank
      ? selectedBank.creditCards.map(c =>
          `<option value="${c.id}" ${s.cardId === c.id ? 'selected' : ''}>${c.name}</option>`
        ).join('')
      : '';

    const currencies = ['TWD', 'USD', 'JPY', 'EUR', 'GBP', 'AUD', 'CAD', 'HKD'];

    open(`
      <div class="modal-header">
        <span class="modal-title">${isEdit ? '編輯訂閱' : '新增訂閱'}</span>
        <button class="modal-close" onclick="Modal.close()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">訂閱名稱</label>
          <input type="text" id="sub-name" class="form-input" placeholder="例：YouTube Premium、Claude Pro" value="${s.name}">
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">計費幣別</label>
            <select id="sub-currency" class="form-select">
              ${currencies.map(c => `<option value="${c}" ${s.currency === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">金額（原始幣別）</label>
            <input type="number" id="sub-amount" class="form-input" placeholder="0.00" value="${s.amount || ''}" step="0.01" min="0">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">每月扣款日</label>
          <input type="number" id="sub-billing-day" class="form-input" placeholder="1" value="${s.billingDay || 1}" min="1" max="31">
        </div>
        <div class="form-group">
          <label class="form-label">扣款銀行</label>
          <select id="sub-bank" class="form-select" onchange="Modal._onSubBankChange()">
            <option value="">不綁定銀行</option>
            ${bankOptions}
          </select>
        </div>
        <div id="sub-card-group" class="form-group" style="display:${cardOptions ? '' : 'none'};">
          <label class="form-label">扣款信用卡</label>
          <select id="sub-card" class="form-select">
            <option value="">不指定信用卡</option>
            ${cardOptions}
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" onclick="Modal._saveSubscription(${isEdit ? `'${s.id}'` : 'null'})">
          ${isEdit ? '儲存' : '新增'}
        </button>
      </div>
    `, onSave);
  }

  function _onSubBankChange() {
    const bankId = document.getElementById('sub-bank')?.value;
    const cardGrp = document.getElementById('sub-card-group');
    const cardSel = document.getElementById('sub-card');
    if (!cardGrp || !cardSel) return;

    if (bankId) {
      const bank = Store.getBanks().find(b => b.id === bankId);
      const cards = bank?.creditCards || [];
      cardSel.innerHTML = `<option value="">不指定信用卡</option>` +
        cards.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      cardGrp.style.display = cards.length > 0 ? '' : 'none';
    } else {
      cardGrp.style.display = 'none';
    }
  }

  function _saveSubscription(existingId) {
    const name       = document.getElementById('sub-name').value.trim();
    const currency   = document.getElementById('sub-currency').value;
    const amount     = parseFloat(document.getElementById('sub-amount').value || 0);
    const billingDay = parseInt(document.getElementById('sub-billing-day').value || 1);
    const bankId     = document.getElementById('sub-bank').value || null;
    const cardId     = document.getElementById('sub-card')?.value || null;

    if (!name) { Utils.showToast('請填寫訂閱名稱'); return; }
    if (!amount || amount <= 0) { Utils.showToast('請填寫有效金額'); return; }
    if (billingDay < 1 || billingDay > 31) { Utils.showToast('扣款日請填 1–31'); return; }

    const data = { name, currency, amount, billingDay, bankId, cardId: cardId || null };
    if (existingId) {
      Store.updateSubscription(existingId, data);
      Utils.showToast('已更新');
    } else {
      Store.addSubscription(data);
      Utils.showToast('已新增');
    }
    close();
  }

  // ── DCA Plan Modal ──────────────────────────────────────────────
  function openDcaPlan(market, existing = null, onSave) {
    const isEdit = !!existing;
    const isTW = market === 'TW';
    const p = existing || {
      symbol: '', name: '', monthlyAmount: '', executionDay: 1,
      active: true, note: '', bankId: '', cardId: '',
    };

    const banks = Store.getBanks();
    const bankOptions = banks.map(b =>
      `<option value="${b.id}" ${p.bankId === b.id ? 'selected' : ''}>${b.name}</option>`
    ).join('');
    const selectedBank = banks.find(b => b.id === p.bankId);
    const cardOptions = selectedBank
      ? selectedBank.creditCards.map(c =>
          `<option value="${c.id}" ${p.cardId === c.id ? 'selected' : ''}>${c.name}</option>`
        ).join('')
      : '';

    open(`
      <div class="modal-header">
        <span class="modal-title">${isEdit ? '編輯' : '新增'}定期定額 — ${isTW ? '台股' : '美股'}</span>
        <button class="modal-close" onclick="Modal.close()">✕</button>
      </div>
      <div class="modal-body">
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">${isTW ? '股票代號' : '股票代碼'}</label>
            <input type="text" id="dca-symbol" class="form-input"
              placeholder="${isTW ? '例：0050' : '例：VTI'}"
              value="${p.symbol}" style="text-transform:uppercase"
              oninput="Modal._onDcaSymbolInput('${market}')">
          </div>
          <div class="form-group">
            <label class="form-label">股票名稱</label>
            <input type="text" id="dca-name" class="form-input"
              placeholder="${isTW ? '例：元大台灣50' : '例：Vanguard Total'}"
              value="${p.name}">
          </div>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">每月投入金額 (${isTW ? 'NT$' : '$'})</label>
            <input type="number" id="dca-amount" class="form-input"
              placeholder="${isTW ? '5000' : '100'}"
              value="${p.monthlyAmount || ''}" min="1" step="1">
          </div>
          <div class="form-group">
            <label class="form-label">每月執行日</label>
            <input type="number" id="dca-day" class="form-input"
              placeholder="1" value="${p.executionDay || 1}" min="1" max="28">
            <div style="font-size:11px;color:#9CA3AF;margin-top:3px;">建議 1–28，避免月底問題</div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">扣款銀行（選填）</label>
          <select id="dca-bank" class="form-select" onchange="Modal._onDcaBankChange()">
            <option value="">不指定</option>
            ${bankOptions}
          </select>
        </div>
        <div id="dca-card-group" class="form-group" style="display:${cardOptions ? '' : 'none'};">
          <label class="form-label">扣款信用卡（選填）</label>
          <select id="dca-card" class="form-select">
            <option value="">不指定</option>
            ${cardOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">備註</label>
          <input type="text" id="dca-note" class="form-input" placeholder="備註..." value="${p.note || ''}">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" onclick="Modal._saveDcaPlan('${market}', ${isEdit ? `'${p.id}'` : 'null'})">
          ${isEdit ? '儲存' : '新增'}
        </button>
      </div>
    `, onSave);
  }

  function _onDcaSymbolInput(market) {
    const symbol = document.getElementById('dca-symbol')?.value.trim().toUpperCase();
    if (!symbol) return;
    // Auto-fill name from existing holdings
    const holdings = Store.getHoldings(market);
    const match = holdings.find(h => h.symbol === symbol);
    if (match) {
      const nameEl = document.getElementById('dca-name');
      if (nameEl && !nameEl.value) nameEl.value = match.name;
    }
  }

  function _onDcaBankChange() {
    const bankId = document.getElementById('dca-bank')?.value;
    const cardGrp = document.getElementById('dca-card-group');
    const cardSel = document.getElementById('dca-card');
    if (!cardGrp || !cardSel) return;
    if (bankId) {
      const bank = Store.getBanks().find(b => b.id === bankId);
      const cards = bank?.creditCards || [];
      cardSel.innerHTML = `<option value="">不指定</option>` +
        cards.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      cardGrp.style.display = cards.length > 0 ? '' : 'none';
    } else {
      cardGrp.style.display = 'none';
    }
  }

  function _saveDcaPlan(market, existingId) {
    const symbol      = document.getElementById('dca-symbol').value.trim().toUpperCase();
    const name        = document.getElementById('dca-name').value.trim();
    const monthlyAmount = parseFloat(document.getElementById('dca-amount').value || 0);
    const executionDay  = parseInt(document.getElementById('dca-day').value || 1);
    const bankId      = document.getElementById('dca-bank').value || null;
    const cardId      = document.getElementById('dca-card')?.value || null;
    const note        = document.getElementById('dca-note').value.trim();

    if (!symbol) { Utils.showToast('請填寫股票代號'); return; }
    if (!monthlyAmount || monthlyAmount <= 0) { Utils.showToast('請填寫有效投入金額'); return; }
    if (executionDay < 1 || executionDay > 28) { Utils.showToast('執行日請填 1–28'); return; }

    const data = { market, symbol, name: name || symbol, monthlyAmount, executionDay, bankId, cardId: cardId || null, note };
    if (existingId) {
      Store.updateDcaPlan(existingId, data);
      Utils.showToast('已更新');
    } else {
      Store.addDcaPlan(data);
      Utils.showToast('已新增');
    }
    close();
  }

  // ── Currency definitions ─────────────────────────────────────────
  const CURRENCIES = [
    { code: 'TWD', symbol: 'NT$', name: '新台幣' },
    { code: 'JPY', symbol: '¥',   name: '日圓' },
    { code: 'USD', symbol: '$',   name: '美元' },
    { code: 'EUR', symbol: '€',   name: '歐元' },
    { code: 'GBP', symbol: '£',   name: '英鎊' },
    { code: 'KRW', symbol: '₩',   name: '韓圓' },
    { code: 'THB', symbol: '฿',   name: '泰銖' },
    { code: 'SGD', symbol: 'S$',  name: '新幣' },
    { code: 'AUD', symbol: 'A$',  name: '澳幣' },
    { code: 'HKD', symbol: 'HK$', name: '港幣' },
    { code: 'CNY', symbol: '¥',   name: '人民幣' },
    { code: 'MYR', symbol: 'RM',  name: '馬幣' },
  ];

  // ── Event Modal ─────────────────────────────────────────────────
  const _EVENT_COLORS = [
    { value: '#3B82F6', label: '藍' }, { value: '#10B981', label: '綠' },
    { value: '#F59E0B', label: '橙' }, { value: '#EF4444', label: '紅' },
    { value: '#8B5CF6', label: '紫' }, { value: '#EC4899', label: '粉' },
    { value: '#06B6D4', label: '青' }, { value: '#F97316', label: '橘' },
  ];

  function openEvent(existing = null, onSave) {
    const isEdit = !!existing;
    const e = existing || {
      name: '', icon: '📋', color: '#3B82F6',
      startDate: '', endDate: '', note: '',
    };

    const colorBtns = _EVENT_COLORS.map(c => `
      <label style="cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;">
        <input type="radio" name="ev-color" value="${c.value}"
          ${e.color === c.value ? 'checked' : ''}
          style="display:none;"
          onchange="Modal._onEventColorChange('${c.value}')">
        <span class="ev-color-swatch" data-color="${c.value}"
          style="display:block;width:28px;height:28px;border-radius:50%;background:${c.value};
                 border:3px solid ${e.color === c.value ? '#1F2937' : 'transparent'};
                 transition:border-color .15s;cursor:pointer;"></span>
        <span style="font-size:10px;color:#6B7280;">${c.label}</span>
      </label>`).join('');

    open(`
      <div class="modal-header">
        <span class="modal-title">${isEdit ? '編輯活動' : '新增活動'}</span>
        <button class="modal-close" onclick="Modal.close()">✕</button>
      </div>
      <div class="modal-body">
        <div class="grid-2">
          <div class="form-group" style="flex:3;">
            <label class="form-label">活動名稱</label>
            <input type="text" id="ev-name" class="form-input"
              placeholder="例：日本旅遊、婚禮籌備" value="${e.name}">
          </div>
          <div class="form-group" style="flex:1;">
            <label class="form-label">圖示（Emoji）</label>
            <input type="text" id="ev-icon" class="form-input"
              placeholder="📋" value="${e.icon || '📋'}"
              style="font-size:22px;text-align:center;" maxlength="2">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">顏色</label>
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:4px;">
            ${colorBtns}
          </div>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">開始日期 <span style="font-size:11px;color:#9CA3AF;font-weight:400;">（選填）</span></label>
            <input type="date" id="ev-start" class="form-input" value="${e.startDate || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">結束日期 <span style="font-size:11px;color:#9CA3AF;font-weight:400;">（選填）</span></label>
            <input type="date" id="ev-end" class="form-input" value="${e.endDate || ''}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">備註</label>
          <textarea id="ev-note" class="form-textarea" placeholder="活動說明...">${e.note || ''}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" onclick="Modal._saveEvent(${isEdit ? `'${e.id}'` : 'null'})">
          ${isEdit ? '儲存' : '建立活動'}
        </button>
      </div>
    `, onSave);
  }

  function _onEventColorChange(color) {
    document.querySelectorAll('.ev-color-swatch').forEach(s => {
      s.style.borderColor = s.dataset.color === color ? '#1F2937' : 'transparent';
    });
  }

  function _saveEvent(existingId) {
    const name      = document.getElementById('ev-name').value.trim();
    const icon      = document.getElementById('ev-icon').value.trim() || '📋';
    const color     = document.querySelector('[name="ev-color"]:checked')?.value || '#3B82F6';
    const startDate = document.getElementById('ev-start').value || null;
    const endDate   = document.getElementById('ev-end').value || null;
    const note      = document.getElementById('ev-note').value.trim();

    if (!name) { Utils.showToast('請填寫活動名稱'); return; }

    const data = { name, icon, color, startDate, endDate, note };
    if (existingId) {
      Store.updateEvent(existingId, data);
      Utils.showToast('已更新');
    } else {
      Store.addEvent(data);
      Utils.showToast('活動已建立');
    }
    close();
  }

  // ── Exchange Rates Modal ─────────────────────────────────────────
  function openExchangeRates() {
    const rates = Store.getExchangeRates();
    const fxCurrencies = CURRENCIES.filter(c => c.code !== 'TWD');

    const rows = fxCurrencies.map(c => `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <span style="width:44px;font-weight:700;font-size:14px;">${c.code}</span>
        <span style="flex:1;font-size:13px;color:#6B7280;">${c.name}</span>
        <span style="font-size:13px;white-space:nowrap;">1 ${c.code} =</span>
        <input type="number" id="rate-${c.code}" class="form-input"
          style="width:96px;padding:4px 8px;font-size:13px;text-align:right;"
          value="${rates[c.code] || ''}" min="0.00001" step="0.00001">
        <span style="font-size:13px;">NT$</span>
      </div>`).join('');

    open(`
      <div class="modal-header">
        <span class="modal-title">匯率設定</span>
        <button class="modal-close" onclick="Modal.close()">✕</button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;color:#6B7280;margin-bottom:16px;">
          設定各幣別對新台幣的換算匯率，用於計算外幣支出的台幣金額。
        </p>
        ${rows}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Modal._resetExchangeRates()">恢復預設</button>
        <button class="btn btn-secondary" style="margin-left:auto;" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" onclick="Modal._saveExchangeRates()">儲存</button>
      </div>
    `);
  }

  function _resetExchangeRates() {
    const def = Store.DEFAULT_EXCHANGE_RATES;
    CURRENCIES.filter(c => c.code !== 'TWD').forEach(c => {
      const el = document.getElementById(`rate-${c.code}`);
      if (el) el.value = def[c.code] ?? '';
    });
  }

  function _saveExchangeRates() {
    const rates = {};
    CURRENCIES.filter(c => c.code !== 'TWD').forEach(c => {
      const val = parseFloat(document.getElementById(`rate-${c.code}`)?.value || 0);
      if (val > 0) rates[c.code] = val;
    });
    Store.saveExchangeRates(rates);
    Utils.showToast('匯率已儲存');
    close();
  }

  // ── DCA Execute Modal ───────────────────────────────────────────
  function openDcaExecute(plan, onSave) {
    const isTW = plan.market === 'TW';
    const today = Utils.today();

    open(`
      <div class="modal-header">
        <span class="modal-title">執行定期定額 — ${plan.symbol} ${plan.name}</span>
        <button class="modal-close" onclick="Modal.close()">✕</button>
      </div>
      <div class="modal-body">
        <div style="background:#EFF6FF;border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:13px;color:#1E40AF;">
          <strong>每月投入：</strong>${isTW ? Utils.formatTWD(plan.monthlyAmount) : '$' + plan.monthlyAmount}
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">執行日期</label>
            <input type="date" id="dca-exec-date" class="form-input" value="${today}">
          </div>
          <div class="form-group">
            <label class="form-label">成交價格 (${isTW ? 'NT$' : '$'})</label>
            <input type="number" id="dca-exec-price" class="form-input"
              placeholder="輸入今日成交價" min="0.01" step="0.01"
              oninput="Modal._calcDcaShares('${plan.market}', ${plan.monthlyAmount})">
          </div>
        </div>
        <div id="dca-calc-preview" style="background:#F0FDF4;padding:12px 14px;border-radius:8px;font-size:13px;color:#065F46;display:none;"></div>
        <div class="form-group" style="margin-top:12px;">
          <label class="form-label">手續費 (${isTW ? 'NT$' : '$'})</label>
          <input type="number" id="dca-exec-fee" class="form-input" placeholder="0" value="0" min="0" step="1"
            oninput="Modal._calcDcaShares('${plan.market}', ${plan.monthlyAmount})">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" onclick="Modal._executeDca('${plan.id}')">確認執行</button>
      </div>
    `, onSave);
  }

  function _calcDcaShares(market, monthlyAmount) {
    const price = parseFloat(document.getElementById('dca-exec-price')?.value || 0);
    const fee   = parseFloat(document.getElementById('dca-exec-fee')?.value || 0);
    const prev  = document.getElementById('dca-calc-preview');
    if (!prev || !price) { if (prev) prev.style.display = 'none'; return; }

    const isTW = market === 'TW';
    const available = monthlyAmount - fee;
    // TW stocks trade in lots of 1000 shares (1 張)
    const rawShares = available / price;
    const shares = isTW ? Math.floor(rawShares / 1000) * 1000 : Math.floor(rawShares * 10000) / 10000;
    const actualCost = shares * price + fee;
    const remainder = monthlyAmount - actualCost;

    prev.style.display = '';
    prev.innerHTML = `
      <strong>計算結果：</strong><br>
      ${isTW
        ? `可買 <strong>${shares / 1000} 張（${Utils.formatShares(shares)} 股）</strong>`
        : `可買 <strong>${shares} 股</strong>`
      }<br>
      實際花費：${isTW ? Utils.formatTWD(actualCost) : '$' + actualCost.toFixed(2)}<br>
      ${remainder > 0 ? `剩餘：${isTW ? Utils.formatTWD(remainder) : '$' + remainder.toFixed(2)}（不足一${isTW ? '張' : '股'}）` : ''}
    `;
  }

  function _executeDca(planId) {
    const plan  = Store.getDcaPlans().find(p => p.id === planId);
    if (!plan) return;

    const date  = document.getElementById('dca-exec-date').value;
    const price = parseFloat(document.getElementById('dca-exec-price').value || 0);
    const fee   = parseFloat(document.getElementById('dca-exec-fee').value || 0);

    if (!date) { Utils.showToast('請選擇日期'); return; }
    if (!price || price <= 0) { Utils.showToast('請輸入成交價格'); return; }

    const isTW = plan.market === 'TW';
    const available = plan.monthlyAmount - fee;
    const rawShares = available / price;
    const shares = isTW ? Math.floor(rawShares / 1000) * 1000 : Math.floor(rawShares * 10000) / 10000;

    if (shares <= 0) { Utils.showToast('金額不足以購買任何股份'); return; }

    Store.addStockTrade({
      date, symbol: plan.symbol, name: plan.name,
      action: 'buy', quantity: shares, price, fee, tax: 0,
      market: plan.market, source: 'dca',
    });

    const monthKey = date.slice(0, 7);
    Store.updateDcaPlan(planId, { lastExecutedMonth: monthKey });

    Utils.showToast(`已執行：買入 ${plan.symbol} ${isTW ? shares/1000 + '張' : shares + '股'}`);
    close();
  }

  return {
    open, close,
    openTransaction, _onTypeChange, _onCurrencyChange, _calcFX, _saveTx,
    _onPaymentChange, _onPaymentBankChange,
    openExchangeRates, _resetExchangeRates, _saveExchangeRates,
    openStockTrade, _updateTradePreview, _saveTrade,
    openDividend, _onDivStockChange, _onDivSymbolInput, _calcDiv, _saveDiv,
    openImport, _doImport,
    openBank, _saveBank,
    openCreditCard, _saveCreditCard,
    openSubscription, _onSubBankChange, _saveSubscription,
    openDcaPlan, _onDcaSymbolInput, _onDcaBankChange, _saveDcaPlan,
    openDcaExecute, _calcDcaShares, _executeDca,
    openEvent, _onEventColorChange, _saveEvent,
  };
})();
