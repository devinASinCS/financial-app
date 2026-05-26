/**
 * Store — localStorage-backed state management
 * All data persisted in localStorage as JSON.
 */
const Store = (() => {

  // ── Default categories ──────────────────────────────────────────
  const EXPENSE_CATEGORIES = [
    '餐飲', '交通', '住房', '購物', '娛樂',
    '醫療', '教育', '水電費', '通訊', '保險', '訂閱', '信用卡還款', '其他'
  ];
  const INCOME_CATEGORIES = [
    '薪資', '獎金', '投資收益', '股利', '副業', '其他'
  ];

  // ── Default exchange rates (1 unit → NT$) ──────────────────────
  const DEFAULT_EXCHANGE_RATES = {
    JPY: 0.21, USD: 32.5, EUR: 35.5, GBP: 41.0, KRW: 0.024,
    THB: 0.92, SGD: 24.0, AUD: 21.0, HKD: 4.2,  CNY: 4.5, MYR: 7.2,
  };

  // ── Keys ────────────────────────────────────────────────────────
  const KEYS = {
    transactions:   'fm_transactions',
    stockTrades:    'fm_stock_trades',
    dividends:      'fm_dividends',
    banks:          'fm_banks',
    subscriptions:  'fm_subscriptions',
    debitLog:       'fm_debit_log',
    dcaPlans:       'fm_dca_plans',
    stockPrices:    'fm_stock_prices',
    upcomingTWDivs: 'fm_tw_upcoming_divs',
    events:         'fm_expense_events',
    exchangeRates:  'fm_exchange_rates',
    settings:       'fm_settings',
  };

  // ── Helpers ─────────────────────────────────────────────────────
  function load(key, fallback = []) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }
  let _suppressAutoSave = false;

  function save(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
    localStorage.setItem('fm_last_modified', new Date().toISOString());
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }


  // Default bank setting
  function getDefaultBankId() { return (load(KEYS.settings, {}) || {}).defaultBankId || null; }
  function setDefaultBankId(id) {
    const s = load(KEYS.settings, {}) || {};
    save(KEYS.settings, { ...s, defaultBankId: id || null });
  }

  // ── Transaction CRUD ────────────────────────────────────────────
  function getTransactions() { return load(KEYS.transactions); }

  // Adjust bank balance when a bank_transfer transaction is added/removed.
  // Pass reverse=true to undo the effect (for edit/delete).
  function _adjustBankForTransfer(tx, reverse) {
    if (!tx || tx.paymentMethod !== 'bank_transfer' || !tx.bankId) return;
    const bank = getBanks().find(b => b.id === tx.bankId);
    if (!bank) return;
    const wallets = bank.wallets || [{ currency: 'TWD', balance: bank.balance || 0 }];
    const hasFX = tx.foreignCurrency && tx.foreignAmount != null;
    const targetCur = hasFX ? tx.foreignCurrency : 'TWD';
    const useAmt    = hasFX ? tx.foreignAmount  : tx.amount;
    let wIdx = wallets.findIndex(w => w.currency === targetCur);
    let amt  = useAmt;
    if (wIdx === -1) { wIdx = wallets.findIndex(w => w.currency === 'TWD'); amt = tx.amount; }
    if (wIdx === -1) return;
    let delta = tx.type === 'expense' ? -amt : amt;
    if (reverse) delta = -delta;
    const newWallets = wallets.map((w, i) => i === wIdx ? { ...w, balance: (w.balance || 0) + delta } : w);
    updateBank(bank.id, { wallets: newWallets });
  }

  function addTransaction(tx) {
    const list = getTransactions();
    const item = { id: uid(), createdAt: new Date().toISOString(), ...tx };
    list.unshift(item);
    save(KEYS.transactions, list);
    _adjustBankForTransfer(item, false);
    return item;
  }

  function updateTransaction(id, updates) {
    const old = getTransactions().find(t => t.id === id);
    _adjustBankForTransfer(old, true);               // reverse old effect
    const list = getTransactions().map(t => t.id === id ? { ...t, ...updates } : t);
    save(KEYS.transactions, list);
    const newTx = list.find(t => t.id === id);
    _adjustBankForTransfer(newTx, false);            // apply new effect
  }

  function deleteTransaction(id) {
    const tx = getTransactions().find(t => t.id === id);
    save(KEYS.transactions, getTransactions().filter(t => t.id !== id));
    _adjustBankForTransfer(tx, true);                // reverse effect
  }

  // ── Stock Trade CRUD ────────────────────────────────────────────
  function getStockTrades(market = null) {
    const all = load(KEYS.stockTrades);
    return market ? all.filter(t => t.market === market) : all;
  }

  // Adjust bank balance when a stock trade is added/edited/deleted.
  function _adjustBankForTrade(trade, reverse) {
    if (!trade || !trade.bankId) return;
    const bank = getBanks().find(b => b.id === trade.bankId);
    if (!bank) return;
    const currency = trade.market === 'US' ? 'USD' : 'TWD';
    const wallets = bank.wallets || [{ currency: 'TWD', balance: bank.balance || 0 }];
    let wIdx = wallets.findIndex(w => w.currency === currency);
    if (wIdx === -1) wIdx = wallets.findIndex(w => w.currency === 'TWD');
    if (wIdx === -1) return;
    const qty = trade.quantity || 0;
    const price = trade.price || 0;
    const fee = trade.fee || 0;
    const tax = trade.tax || 0;
    const net = trade.action === 'buy' ? qty * price + fee + tax : qty * price - fee - tax;
    let delta = trade.action === 'buy' ? -net : net;
    if (reverse) delta = -delta;
    const newWallets = wallets.map((w, i) => i === wIdx ? { ...w, balance: (w.balance || 0) + delta } : w);
    updateBank(bank.id, { wallets: newWallets });
  }

  function addStockTrade(trade) {
    const list = load(KEYS.stockTrades);
    const item = { id: uid(), createdAt: new Date().toISOString(), ...trade };
    list.push(item);
    list.sort((a, b) => new Date(a.date) - new Date(b.date));
    save(KEYS.stockTrades, list);
    _adjustBankForTrade(item, false);
    return item;
  }

  function updateStockTrade(id, updates) {
    const list = load(KEYS.stockTrades);
    const old = list.find(t => t.id === id);
    if (old) _adjustBankForTrade(old, true);
    const newList = list.map(t => t.id === id ? { ...t, ...updates } : t);
    save(KEYS.stockTrades, newList);
    const updated = newList.find(t => t.id === id);
    if (updated) _adjustBankForTrade(updated, false);
  }

  function deleteStockTrade(id) {
    const list = load(KEYS.stockTrades);
    const old = list.find(t => t.id === id);
    if (old) _adjustBankForTrade(old, true);
    save(KEYS.stockTrades, list.filter(t => t.id !== id));
  }

  // ── Dividend CRUD ───────────────────────────────────────────────
  function getDividends(market = null) {
    const all = load(KEYS.dividends);
    return market ? all.filter(d => d.market === market) : all;
  }

  function addDividend(div) {
    const list = load(KEYS.dividends);
    const item = { id: uid(), createdAt: new Date().toISOString(), ...div };
    list.push(item);
    list.sort((a, b) => new Date(a.date) - new Date(b.date));
    save(KEYS.dividends, list);
    return item;
  }

  function updateDividend(id, updates) {
    const list = load(KEYS.dividends).map(d => d.id === id ? { ...d, ...updates } : d);
    save(KEYS.dividends, list);
  }

  function deleteDividend(id) {
    save(KEYS.dividends, load(KEYS.dividends).filter(d => d.id !== id));
  }

  // ── Bank CRUD ───────────────────────────────────────────────────
  function _migrateBank(b) {
    if (b.wallets) return b;
    return { ...b, wallets: [{ currency: b.currency || 'TWD', balance: b.balance || 0 }] };
  }
  function getBanks() { return load(KEYS.banks, []).map(_migrateBank); }

  function addBank(bank) {
    const list = getBanks();
    const wallets = bank.wallets || [{ currency: 'TWD', balance: 0 }];
    const item = { id: uid(), creditCards: [], name: bank.name || '', wallets };
    list.push(item);
    save(KEYS.banks, list);
    return item;
  }

  function updateBank(id, updates) {
    const list = getBanks().map(b => b.id === id ? { ...b, ...updates } : b);
    save(KEYS.banks, list);
  }

  function deleteBank(id) {
    save(KEYS.banks, getBanks().filter(b => b.id !== id));
  }

  // ── Credit Card CRUD (nested inside bank) ───────────────────────
  function addCreditCard(bankId, card) {
    const banks = getBanks();
    const idx = banks.findIndex(b => b.id === bankId);
    if (idx === -1) return null;
    const newCard = { id: uid(), ...card };
    banks[idx].creditCards = [...(banks[idx].creditCards || []), newCard];
    save(KEYS.banks, banks);
    return newCard;
  }

  function updateCreditCard(bankId, cardId, updates) {
    const banks = getBanks().map(b => {
      if (b.id !== bankId) return b;
      return {
        ...b,
        creditCards: (b.creditCards || []).map(c =>
          c.id === cardId ? { ...c, ...updates } : c
        )
      };
    });
    save(KEYS.banks, banks);
  }

  function deleteCreditCard(bankId, cardId) {
    const banks = getBanks().map(b => {
      if (b.id !== bankId) return b;
      return { ...b, creditCards: (b.creditCards || []).filter(c => c.id !== cardId) };
    });
    save(KEYS.banks, banks);
  }

  // ── Subscription CRUD ───────────────────────────────────────────
  function getSubscriptions() { return load(KEYS.subscriptions, []); }

  function addSubscription(sub) {
    const list = getSubscriptions();
    const item = { id: uid(), active: true, lastBilledMonth: null, lastRate: null, ...sub };
    list.push(item);
    save(KEYS.subscriptions, list);
    return item;
  }

  function updateSubscription(id, updates) {
    const list = getSubscriptions().map(s => s.id === id ? { ...s, ...updates } : s);
    save(KEYS.subscriptions, list);
  }

  function deleteSubscription(id) {
    save(KEYS.subscriptions, getSubscriptions().filter(s => s.id !== id));
  }

  // ── DCA Plan CRUD ───────────────────────────────────────────────
  /**
   * DCA plan: invest a fixed amount on a set day each month.
   * { id, market, symbol, name, monthlyAmount, executionDay,
   *   active, lastExecutedMonth, bankId, cardId, note }
   */
  function getDcaPlans(market = null) {
    const all = load(KEYS.dcaPlans, []);
    return market ? all.filter(p => p.market === market) : all;
  }

  function addDcaPlan(plan) {
    const list = getDcaPlans();
    const item = { id: uid(), active: true, lastExecutedMonth: null, ...plan };
    list.push(item);
    save(KEYS.dcaPlans, list);
    return item;
  }

  function updateDcaPlan(id, updates) {
    const list = getDcaPlans().map(p => p.id === id ? { ...p, ...updates } : p);
    save(KEYS.dcaPlans, list);
  }

  function deleteDcaPlan(id) {
    save(KEYS.dcaPlans, getDcaPlans().filter(p => p.id !== id));
  }

  /**
   * Get DCA plans that are due today (execution day passed, not yet executed this month).
   */
  function getPendingDcaPlans(market = null) {
    const today = new Date();
    const todayDay = today.getDate();
    const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    return getDcaPlans(market).filter(p =>
      p.active &&
      p.lastExecutedMonth !== monthKey &&
      todayDay >= p.executionDay
    );
  }

  // ── Auto Credit Card Debit ──────────────────────────────────────
  /**
   * On auto-debit day, sum all credit card expenses in the billing cycle
   * and deduct from the linked bank's balance.
   * Billing cycle: (statementDay+1 of 2 months ago) → (statementDay of last month)
   * Returns number of cards processed.
   */
  function processAutoDebits() {
    const today = new Date();
    const todayDay = today.getDate();
    const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const log = load(KEYS.debitLog, {});
    let processed = 0;

    for (const bankSnapshot of getBanks()) {
      for (const card of (bankSnapshot.creditCards || [])) {
        if (card.type === 'debit') continue;
        if (todayDay < card.autoDebitDay) continue;
        const logKey = `${bankSnapshot.id}_${card.id}_${monthKey}`;
        if (log[logKey]) continue;

        // Billing cycle end = statementDay of last month
        const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const cycleEndDate = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), card.statementDay);
        const cycleEndStr = cycleEndDate.toISOString().slice(0, 10);

        // Billing cycle start = (statementDay+1) of 2 months ago
        const prevPrevMonth = new Date(today.getFullYear(), today.getMonth() - 2, 1);
        const cycleStartDate = new Date(prevPrevMonth.getFullYear(), prevPrevMonth.getMonth(), card.statementDay + 1);
        const cycleStartStr = cycleStartDate.toISOString().slice(0, 10);

        const txs = getTransactions().filter(t =>
          t.paymentMethod === 'credit_card' &&
          t.cardId === card.id &&
          t.type === 'expense' &&
          t.date >= cycleStartStr &&
          t.date <= cycleEndStr
        );

        const total = txs.reduce((s, t) => s + t.amount, 0);

        // Refresh bank data in case previous card updated it
        const bank = getBanks().find(b => b.id === bankSnapshot.id);
        if (bank) {
          updateBank(bank.id, { balance: (bank.balance || 0) - total });
        }

        log[logKey] = { processedDate: todayStr(), amount: total, cardName: card.name };
        save(KEYS.debitLog, log);
        processed++;
      }
    }
    return processed;
  }

  /**
   * Get pending auto-debit info (for display — not yet processed this month).
   */
  function getPendingDebits() {
    const today = new Date();
    const todayDay = today.getDate();
    const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const log = load(KEYS.debitLog, {});
    const pending = [];

    for (const bank of getBanks()) {
      for (const card of (bank.creditCards || [])) {
        if (card.type === 'debit') continue;
        const logKey = `${bank.id}_${card.id}_${monthKey}`;
        if (log[logKey]) continue;

        const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const cycleEndDate = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), card.statementDay);
        const cycleEndStr = cycleEndDate.toISOString().slice(0, 10);
        const prevPrevMonth = new Date(today.getFullYear(), today.getMonth() - 2, 1);
        const cycleStartDate = new Date(prevPrevMonth.getFullYear(), prevPrevMonth.getMonth(), card.statementDay + 1);
        const cycleStartStr = cycleStartDate.toISOString().slice(0, 10);

        const txs = getTransactions().filter(t =>
          t.paymentMethod === 'credit_card' &&
          t.cardId === card.id &&
          t.type === 'expense' &&
          t.date >= cycleStartStr &&
          t.date <= cycleEndStr
        );
        const total = txs.reduce((s, t) => s + t.amount, 0);

        pending.push({
          bankId: bank.id, bankName: bank.name,
          cardId: card.id, cardName: card.name,
          autoDebitDay: card.autoDebitDay,
          total, daysUntilDebit: card.autoDebitDay - todayDay,
        });
      }
    }
    return pending;
  }

  // ── Expense Events CRUD ─────────────────────────────────────────
  /**
   * Event: { id, name, icon, color, startDate, endDate, note, createdAt }
   * Transactions carry an optional `eventId` field linking them to an event.
   */
  function getEvents() { return load(KEYS.events, []); }

  function addEvent(event) {
    const list = getEvents();
    const item = { id: uid(), createdAt: new Date().toISOString(), ...event };
    list.push(item);
    save(KEYS.events, list);
    return item;
  }

  function updateEvent(id, updates) {
    save(KEYS.events, getEvents().map(e => e.id === id ? { ...e, ...updates } : e));
  }

  /**
   * Delete an event. All transactions that belonged to it are kept but
   * have their eventId cleared, so nothing is lost.
   */
  function deleteEvent(id) {
    // Unlink transactions
    const txs = load(KEYS.transactions, []).map(t =>
      t.eventId === id ? { ...t, eventId: null } : t
    );
    save(KEYS.transactions, txs);
    save(KEYS.events, getEvents().filter(e => e.id !== id));
  }

  function getEventTransactions(eventId) {
    return load(KEYS.transactions, []).filter(t => t.eventId === eventId);
  }

  // ── Stock Price Cache ───────────────────────────────────────────
  function getStockPrices() { return load(KEYS.stockPrices, {}); }
  function saveStockPrices(prices) { save(KEYS.stockPrices, prices); }
  function updateStockPrice(symbol, data) {
    const prices = getStockPrices();
    prices[symbol] = { ...data, updatedAt: new Date().toISOString() };
    save(KEYS.stockPrices, prices);
  }

  // ── Upcoming TW Dividend Cache ───────────────────────────────────
  function getUpcomingTWDivs() { return load(KEYS.upcomingTWDivs, []); }
  function saveUpcomingTWDivs(data) { save(KEYS.upcomingTWDivs, data); }

  // ── Exchange Rates ───────────────────────────────────────────────
  /** Returns merged defaults + user overrides so all currencies are always present. */
  function getExchangeRates() { return { ...DEFAULT_EXCHANGE_RATES, ...load(KEYS.exchangeRates, {}) }; }
  function saveExchangeRates(rates) { save(KEYS.exchangeRates, rates); }
  function getExchangeRate(code) { return getExchangeRates()[code] || 1; }

  // ── Computed: Holdings ──────────────────────────────────────────
  function getHoldings(market) {
    const trades = getStockTrades(market);
    const holdings = {};

    for (const t of trades) {
      if (!holdings[t.symbol]) {
        holdings[t.symbol] = {
          symbol: t.symbol, name: t.name, market,
          quantity: 0, totalCost: 0
        };
      }
      const h = holdings[t.symbol];
      if (t.action === 'buy') {
        const cost = t.quantity * t.price + (t.fee || 0);
        h.totalCost += cost;
        h.quantity  += t.quantity;
      } else {
        if (h.quantity > 0) {
          const ratio = t.quantity / h.quantity;
          h.totalCost = h.totalCost * (1 - ratio);
          h.quantity  -= t.quantity;
        }
      }
    }

    const divs = getDividends(market).filter(d => d.stockShares > 0);
    for (const d of divs) {
      if (holdings[d.symbol] && holdings[d.symbol].quantity > 0) {
        holdings[d.symbol].quantity += d.stockShares;
      }
    }

    return Object.values(holdings)
      .filter(h => h.quantity > 0.0001)
      .map(h => ({
        ...h,
        avgCost: h.quantity > 0 ? h.totalCost / h.quantity : 0
      }));
  }

  // ── Computed: Realized P&L ──────────────────────────────────────
  function getRealizedTrades(market) {
    const trades = getStockTrades(market);
    const costBasis = {};
    const realized  = [];

    for (const t of trades) {
      if (!costBasis[t.symbol]) {
        costBasis[t.symbol] = { quantity: 0, totalCost: 0 };
      }
      const cb = costBasis[t.symbol];

      if (t.action === 'buy') {
        cb.totalCost += t.quantity * t.price + (t.fee || 0);
        cb.quantity  += t.quantity;
      } else {
        const avgCost  = cb.quantity > 0 ? cb.totalCost / cb.quantity : 0;
        const proceeds = t.quantity * t.price - (t.fee || 0) - (t.tax || 0);
        const cost     = avgCost * t.quantity;
        const pnl      = proceeds - cost;

        realized.push({
          id: t.id, date: t.date,
          symbol: t.symbol, name: t.name,
          quantity: t.quantity,
          avgCost, sellPrice: t.price,
          proceeds, cost, pnl,
          pnlPct: cost > 0 ? (pnl / cost) * 100 : 0
        });

        if (cb.quantity > 0) {
          const ratio   = t.quantity / cb.quantity;
          cb.totalCost  = cb.totalCost * (1 - ratio);
          cb.quantity  -= t.quantity;
        }
      }
    }
    return realized;
  }

  // ── Computed: P&L Timeline ─────────────────────────────────────
  function getPnLTimeline(market) {
    const realized = getRealizedTrades(market);
    const divs     = getDividends(market);

    const months = new Set();
    realized.forEach(r => months.add(r.date.slice(0, 7)));
    divs.forEach(d => months.add(d.date.slice(0, 7)));

    if (months.size === 0) return [];

    const sorted = [...months].sort();
    let cumPnL = 0;
    let cumDiv = 0;

    return sorted.map(month => {
      const mPnL = realized.filter(r => r.date.slice(0, 7) === month).reduce((s, r) => s + r.pnl, 0);
      const mDiv = divs.filter(d => d.date.slice(0, 7) === month).reduce((s, d) => s + (d.cashTotal || 0), 0);
      cumPnL += mPnL;
      cumDiv += mDiv;
      return {
        month,
        label: month.replace('-', '/'),
        tradePnL: mPnL,
        dividendIncome: mDiv,
        cumulativePnL: cumPnL + cumDiv,
      };
    });
  }

  // ── Summary helpers ─────────────────────────────────────────────
  function getMonthlySummary(year, month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    const txs = getTransactions().filter(t => t.date.startsWith(prefix));
    const income  = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    return { income, expense, net: income - expense, count: txs.length };
  }

  // ── Export / Import ─────────────────────────────────────────────
  function exportData() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      transactions:  load(KEYS.transactions, []),
      stockTrades:   load(KEYS.stockTrades, []),
      dividends:     load(KEYS.dividends, []),
      banks:         load(KEYS.banks, []),
      subscriptions: load(KEYS.subscriptions, []),
      dcaPlans:      load(KEYS.dcaPlans, []),
      debitLog:      load(KEYS.debitLog, {}),
      events:        load(KEYS.events, []),
    };
  }

  /**
   * Import data from a backup object.
   * Returns { ok: true, counts } on success, { ok: false, error } on failure.
   */
  function importData(obj) {
    // Suppress auto-save during import: the data came from the server, no need to echo it back.
    // Allowing auto-save here would update _savedAt to the local clock, causing other devices
    // to think this device has "newer" data and incorrectly overwrite their local changes.
    _suppressAutoSave = true;
    try {
      if (!obj || typeof obj !== 'object') throw new Error('無效的資料格式');
      if (Array.isArray(obj.transactions))  save(KEYS.transactions,  obj.transactions);
      if (Array.isArray(obj.stockTrades))   save(KEYS.stockTrades,   obj.stockTrades);
      if (Array.isArray(obj.dividends))     save(KEYS.dividends,     obj.dividends);
      if (Array.isArray(obj.banks))         save(KEYS.banks,         obj.banks);
      if (Array.isArray(obj.subscriptions)) save(KEYS.subscriptions, obj.subscriptions);
      if (Array.isArray(obj.dcaPlans))      save(KEYS.dcaPlans,      obj.dcaPlans);
      if (obj.debitLog && typeof obj.debitLog === 'object') save(KEYS.debitLog, obj.debitLog);
      if (Array.isArray(obj.events))        save(KEYS.events,        obj.events);
      return {
        ok: true,
        counts: {
          transactions:  (obj.transactions  || []).length,
          stockTrades:   (obj.stockTrades   || []).length,
          dividends:     (obj.dividends     || []).length,
          banks:         (obj.banks         || []).length,
          subscriptions: (obj.subscriptions || []).length,
          dcaPlans:      (obj.dcaPlans      || []).length,
        }
      };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      _suppressAutoSave = false;
    }
  }

  return {
    EXPENSE_CATEGORIES, INCOME_CATEGORIES,
    getTransactions, addTransaction, updateTransaction, deleteTransaction,
    getStockTrades, addStockTrade, updateStockTrade, deleteStockTrade,
    getDividends, addDividend, updateDividend, deleteDividend,
    getBanks, addBank, updateBank, deleteBank,
    addCreditCard, updateCreditCard, deleteCreditCard,
    getSubscriptions, addSubscription, updateSubscription, deleteSubscription,
    getDcaPlans, addDcaPlan, updateDcaPlan, deleteDcaPlan, getPendingDcaPlans,
    processAutoDebits, getPendingDebits,
    getHoldings, getRealizedTrades, getPnLTimeline,
    getMonthlySummary,
    exportData, importData,
    getStockPrices, saveStockPrices, updateStockPrice,
    getUpcomingTWDivs, saveUpcomingTWDivs,
    DEFAULT_EXCHANGE_RATES, getExchangeRates, saveExchangeRates, getExchangeRate,
    getDefaultBankId, setDefaultBankId,
  };
})();
