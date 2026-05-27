/**
 * Auth — Google OAuth session management.
 * Loaded before app.js. Exposes window.Auth.
 */
const Auth = (() => {
  let _user = null;
  const SESSION_KEY = 'cashio_sid';

  // Auto-detect worker URL: localhost dev vs. production
  const API = (() => {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:8787';
    return 'https://cashio-worker.jacky90052414.workers.dev';
  })();

  function _getToken() { return localStorage.getItem(SESSION_KEY); }

  function authHeaders() {
    const t = _getToken();
    return t ? { 'Authorization': `Bearer ${t}` } : {};
  }

  async function init() {
    // Pick up session token dropped in URL hash by OAuth callback (Safari-safe)
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const hashToken = hash.get('session');
    if (hashToken) {
      localStorage.setItem(SESSION_KEY, hashToken);
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    if (!_getToken()) return null;
    try {
      const res = await fetch(`${API}/auth/me`, { headers: authHeaders() });
      if (res.ok) {
        _user = await res.json();
        return _user;
      }
      localStorage.removeItem(SESSION_KEY); // expired or invalid
    } catch {}
    return null;
  }

  function getUser()   { return _user; }
  function getApiUrl() { return API; }

  function renderLogin() {
    // Full-screen overlay — sits on top of existing layout
    const overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9999',
      'background:var(--b2,#f1f5f9)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:1rem',
    ].join(';');
    overlay.innerHTML = `
      <div class="card w-full max-w-sm bg-base-100 shadow-2xl">
        <div class="card-body items-center text-center gap-5 py-10">
          <div class="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
            <svg viewBox="0 0 40 40" class="w-10 h-10" xmlns="http://www.w3.org/2000/svg">
              <path d="M 23,12 A 8.3,8.3 0 1,0 23,28" fill="none" stroke="white" stroke-width="5.6" stroke-linecap="round"/>
              <line x1="16.7" y1="10" x2="16.7" y2="30" stroke="rgba(255,255,255,0.5)" stroke-width="2.4" stroke-linecap="round"/>
            </svg>
          </div>
          <div>
            <h1 class="text-2xl font-bold tracking-tight">Cashio</h1>
            <p class="text-base-content/50 text-sm mt-1">個人理財追蹤</p>
          </div>
          <a href="${API}/auth/google"
             class="btn btn-primary w-full gap-2 shadow">
            <i class="fa-brands fa-google"></i>
            使用 Google 帳號登入
          </a>
          <p class="text-xs text-base-content/40">
            登入即代表您同意我們存取您的 Gmail<br>以自動匯入信用卡消費通知
          </p>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
  }

  function injectUserBadge(user) {
    // ── Sidebar user badge (desktop) ──────────────────────────────────────
    const sidebarFooter = document.querySelector('.sidebar-footer');
    if (sidebarFooter) {
      sidebarFooter.insertAdjacentHTML('afterbegin', `
        <div class="flex items-center gap-2 px-3 py-2 mb-1 rounded-lg hover:bg-white/10 cursor-pointer group"
             onclick="Auth.logout()" title="登出">
          <img src="${user.picture}" alt="${user.name}"
               class="w-7 h-7 rounded-full flex-shrink-0"
               referrerpolicy="no-referrer">
          <div class="flex-1 min-w-0">
            <p class="text-xs font-medium text-slate-200 truncate">${user.name}</p>
            <p class="text-xs text-slate-400 truncate">${user.email}</p>
          </div>
          <i class="fa-solid fa-arrow-right-from-bracket text-slate-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity"></i>
        </div>
      `);
    }

    // ── Mobile topbar user avatar ─────────────────────────────────────────
    const topbarInner = document.querySelector('.topbar-inner');
    if (topbarInner) {
      topbarInner.insertAdjacentHTML('beforeend', `
        <div class="ml-auto pr-3">
          <img src="${user.picture}" alt="${user.name}"
               class="w-7 h-7 rounded-full cursor-pointer border-2 border-white/30"
               referrerpolicy="no-referrer"
               onclick="Auth.logout()"
               title="${user.name} — 點擊登出">
        </div>
      `);
    }
  }

  async function logout() {
    if (!confirm(`確定要登出 ${_user?.email || ''} 嗎？`)) return;
    try {
      await fetch(`${API}/auth/logout`, { method: 'POST', headers: authHeaders() });
    } catch {}
    localStorage.removeItem(SESSION_KEY);
    window.location.reload();
  }

  return { init, getUser, getApiUrl, authHeaders, renderLogin, injectUserBadge, logout };
})();
