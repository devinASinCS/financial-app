/**
 * App — router, bootstrap, global init
 */
(function () {

  // ── Router ──────────────────────────────────────────────────────
  const routes = {
    dashboard:     PageDashboard,
    transactions:  PageTransactions,
    events:        PageEvents,
    'tw-stocks':   PageTWStocks,
    'us-stocks':   PageUSStocks,
    banks:         PageBanks,
    subscriptions: PageSubscriptions,
    settings:      PageSettings,
  };

  function getPage() {
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    return routes[hash] ? hash : 'dashboard';
  }

  function navigate(page) {
    // Update desktop sidebar links
    document.querySelectorAll('.nav-link').forEach(a => {
      a.classList.toggle('active', a.dataset.page === page);
    });
    // Update mobile top nav items
    document.querySelectorAll('.mobile-nav-item').forEach(a => {
      a.classList.toggle('active', a.dataset.page === page);
    });

    const pageModule = routes[page];
    if (pageModule) {
      window.scrollTo(0, 0);
      pageModule.render();
    }
  }

  function handleHashChange() {
    navigate(getPage());
  }

  // ── Sidebar date ────────────────────────────────────────────────
  function updateSidebarDate() {
    const d = new Date();
    const full = d.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
    const short = d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', weekday: 'short' });
    const sidebarEl = document.getElementById('sidebar-date');
    if (sidebarEl) sidebarEl.textContent = full;
    const mobileEl = document.getElementById('mobile-date');
    if (mobileEl) mobileEl.textContent = short;
  }

  // ── Seed demo data ──────────────────────────────────────────────
  function seedDemoData() {
    const txs    = Store.getTransactions();
    const trades = Store.getStockTrades();
    if (txs.length > 0 || trades.length > 0) return;

    const today = Utils.today();
    const y = new Date().getFullYear();
    const m = String(new Date().getMonth() + 1).padStart(2, '0');
    const pm = String(new Date().getMonth()).padStart(2, '0') || '12';

    [
      { date: `${y}-${m}-01`, type: 'income',  amount: 65000, category: '薪資',    note: '三月薪資' },
      { date: `${y}-${m}-03`, type: 'expense', amount: 320,   category: '餐飲',    note: '便當' },
      { date: `${y}-${m}-05`, type: 'expense', amount: 1200,  category: '交通',    note: '悠遊卡加值' },
      { date: `${y}-${m}-08`, type: 'expense', amount: 580,   category: '餐飲',    note: '聚餐' },
      { date: `${y}-${m}-10`, type: 'expense', amount: 15000, category: '住房',    note: '房租' },
      { date: `${y}-${m}-12`, type: 'expense', amount: 2600,  category: '購物',    note: '衣服' },
      { date: `${y}-${m}-15`, type: 'expense', amount: 450,   category: '餐飲',    note: '晚餐' },
      { date: `${y}-${m}-18`, type: 'expense', amount: 800,   category: '娛樂',    note: '電影' },
      { date: `${y}-${m}-20`, type: 'income',  amount: 5000,  category: '副業',    note: '設計外包' },
      { date: `${y}-${m}-22`, type: 'expense', amount: 1800,  category: '水電費',  note: '水電瓦斯' },
      { date: `${y}-${m}-25`, type: 'expense', amount: 990,   category: '通訊',    note: '電話費' },
      { date: `${y}-${m}-01`, type: 'income',  amount: 65000, category: '薪資',    note: '二月薪資' },
      { date: `${y}-${pm}-05`, type: 'expense', amount: 280,  category: '餐飲',    note: '早餐' },
      { date: `${y}-${pm}-12`, type: 'expense', amount: 14800, category: '住房',   note: '房租' },
      { date: `${y}-${pm}-20`, type: 'expense', amount: 3200, category: '購物',    note: '家用品' },
    ].forEach(t => Store.addTransaction({ ...t, source: 'manual', paymentMethod: 'cash' }));

    [
      { date: `${y}-01-10`, symbol: '2330', name: '台積電',     action: 'buy',  quantity: 1000, price: 720,   fee: 1026, tax: 0,    market: 'TW' },
      { date: `${y}-01-20`, symbol: '2317', name: '鴻海',       action: 'buy',  quantity: 2000, price: 112,   fee: 319,  tax: 0,    market: 'TW' },
      { date: `${y}-02-05`, symbol: '0050', name: '元大台灣50', action: 'buy',  quantity: 1000, price: 175,   fee: 249,  tax: 0,    market: 'TW' },
      { date: `${y}-02-15`, symbol: '2330', name: '台積電',     action: 'sell', quantity: 500,  price: 760,   fee: 543,  tax: 1140, market: 'TW' },
      { date: `${y}-03-01`, symbol: '2412', name: '中華電信',   action: 'buy',  quantity: 1000, price: 126,   fee: 180,  tax: 0,    market: 'TW' },
    ].forEach(t => Store.addStockTrade(t));

    Store.addDividend({ date: `${y}-03-15`, symbol: '2330', name: '台積電',     market: 'TW', cashPerShare: 3.0, stockRatio: 0, holdingQuantity: 500,  cashTotal: 1500, stockShares: 0, note: '現金股利' });
    Store.addDividend({ date: `${y}-03-20`, symbol: '0050', name: '元大台灣50', market: 'TW', cashPerShare: 2.2, stockRatio: 0, holdingQuantity: 1000, cashTotal: 2200, stockShares: 0, note: '現金股利' });

    [
      { date: `${y}-01-05`, symbol: 'AAPL', name: 'Apple Inc.',       action: 'buy',  quantity: 20, price: 182.5, fee: 0, tax: 0, market: 'US' },
      { date: `${y}-01-15`, symbol: 'MSFT', name: 'Microsoft Corp.',  action: 'buy',  quantity: 10, price: 420.0, fee: 0, tax: 0, market: 'US' },
      { date: `${y}-02-10`, symbol: 'NVDA', name: 'NVIDIA Corp.',     action: 'buy',  quantity: 5,  price: 780.0, fee: 0, tax: 0, market: 'US' },
      { date: `${y}-03-01`, symbol: 'AAPL', name: 'Apple Inc.',       action: 'sell', quantity: 10, price: 195.0, fee: 0, tax: 0, market: 'US' },
    ].forEach(t => Store.addStockTrade(t));

    Store.addDividend({ date: `${y}-03-10`, symbol: 'AAPL', name: 'Apple Inc.',      market: 'US', cashPerShare: 0.25, stockRatio: 0, holdingQuantity: 20, cashTotal: 5.0,  stockShares: 0, note: 'Q1 Dividend' });
    Store.addDividend({ date: `${y}-03-12`, symbol: 'MSFT', name: 'Microsoft Corp.', market: 'US', cashPerShare: 0.75, stockRatio: 0, holdingQuantity: 10, cashTotal: 7.5,  stockShares: 0, note: 'Q1 Dividend' });
  }

  // ── Auto-process on init ─────────────────────────────────────────
  async function runAutoProcessing() {
    // 1. Credit card auto-debits (synchronous)
    const debitCount = Store.processAutoDebits();
    if (debitCount > 0) {
      Utils.showToast(`已自動處理 ${debitCount} 張信用卡扣款，銀行餘額已更新`);
    }

    // 2. Subscription billing (async — needs exchange rate fetch)
    try {
      const billedCount = await PageSubscriptions.processAll();
      if (billedCount > 0) {
        Utils.showToast(`已自動計入 ${billedCount} 筆訂閱費用`);
      }
    } catch (e) {
      // Non-critical, silent fail
    }
  }

  // ── Bootstrap ───────────────────────────────────────────────────
  function init() {
    updateSidebarDate();
    seedDemoData();

    window.addEventListener('hashchange', handleHashChange);

    document.querySelectorAll('.nav-link').forEach(a => {
      a.addEventListener('click', () => {
        // Let hash change fire navigation
      });
    });

    // Initial render
    navigate(getPage());

    // Run auto-processing after initial render (non-blocking)
    setTimeout(() => runAutoProcessing(), 500);

    // Sync from cloud if remote data is newer (non-blocking)
    setTimeout(() => NotionSync.syncOnStart(), 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
