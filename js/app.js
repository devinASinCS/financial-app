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

  // ── Auto-process on init ─────────────────────────────────────────
  async function runAutoProcessing() {
    // 1. Credit card auto-debits (synchronous)
    const debitCount = Store.processAutoDebits();
    if (debitCount > 0) {
      Utils.showToast(`已自動處理 ${debitCount} 張信用卡扣款，銀行餘額已更新`);
    }
  }

  // ── Bootstrap ───────────────────────────────────────────────────
  async function init() {
    // Check auth — show login overlay if not signed in
    const user = await Auth.init();
    if (!user) {
      Auth.renderLogin();
      return;
    }

    // Show spinner while pulling user data from D1 before first render
    document.getElementById('app-content').innerHTML =
      '<div class="flex items-center justify-center py-32">' +
      '<span class="loading loading-spinner loading-lg text-primary"></span></div>';

    await Sync.forceSync(); // push local first so unsynced data isn't lost on pull

    updateSidebarDate();

    Auth.injectUserBadge(user);

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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
