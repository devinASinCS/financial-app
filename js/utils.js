/**
 * Utils — formatting, parsing, and helper functions
 */
const Utils = (() => {

  // ── Number / Currency Formatters ────────────────────────────────
  function formatTWD(amount, showSign = false) {
    const abs = Math.abs(amount);
    const str = 'NT$' + abs.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    if (!showSign) return amount < 0 ? '-' + str : str;
    return (amount >= 0 ? '+' : '-') + str;
  }

  function formatUSD(amount, showSign = false) {
    const abs = Math.abs(amount);
    const str = '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (!showSign) return amount < 0 ? '-' + str : str;
    return (amount >= 0 ? '+' : '-') + str;
  }

  function formatNumber(n, decimals = 2) {
    return Number(n).toLocaleString('zh-TW', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function formatShares(n) {
    return Number(n).toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  }

  // ── Date Formatters ─────────────────────────────────────────────
  function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''));
    return d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  function formatMonth(monthStr) {
    // "2024-03" -> "2024年3月"
    const [y, m] = monthStr.split('-');
    return `${y}年${parseInt(m)}月`;
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function thisMonth() {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  // ── Color helpers ───────────────────────────────────────────────
  function pnlClass(value) {
    if (value > 0) return 'text-profit';
    if (value < 0) return 'text-loss';
    return 'text-neutral';
  }

  function pnlArrow(value) {
    if (value > 0) return '▲';
    if (value < 0) return '▼';
    return '─';
  }

  // ── Pie chart colors ────────────────────────────────────────────
  const CHART_COLORS = [
    '#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6',
    '#06B6D4','#F97316','#EC4899','#84CC16','#14B8A6',
    '#6366F1','#D946EF','#0EA5E9','#A3E635','#FB923C',
  ];
  function chartColor(i) { return CHART_COLORS[i % CHART_COLORS.length]; }

  // ── Statement Parsers ───────────────────────────────────────────
  /**
   * Parse Taiwan stock broker statement (對帳單).
   * Accepts both structured key-value and table formats.
   * Returns array of trade objects.
   */
  function parseTWStatement(text) {
    const trades = [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // Try to detect format and parse
    let current = {};
    const fieldMap = {
      '日期': 'date', '成交日期': 'date', '交割日期': 'settleDate',
      '股票代碼': 'symbol', '代碼': 'symbol', '證券代號': 'symbol',
      '股票名稱': 'name', '名稱': 'name', '證券名稱': 'name',
      '交易別': 'action', '買賣別': 'action', '委託別': 'action',
      '成交股數': 'quantity', '股數': 'quantity',
      '成交價格': 'price', '成交價': 'price', '均價': 'price',
      '手續費': 'fee',
      '交易稅': 'tax', '證交稅': 'tax',
      '交割金額': 'total', '成交金額': 'total',
      '備註': 'note',
    };

    const actionMap = {
      '買進': 'buy', '買': 'buy', 'B': 'buy', 'Buy': 'buy',
      '賣出': 'sell', '賣': 'sell', 'S': 'sell', 'Sell': 'sell',
    };

    function finalizeCurrent() {
      if (current.symbol && current.date) {
        const trade = {
          date: normalizeDate(current.date),
          symbol: String(current.symbol).trim(),
          name: current.name || current.symbol,
          action: actionMap[current.action] || 'buy',
          quantity: parseFloat(String(current.quantity || '0').replace(/,/g, '')),
          price:    parseFloat(String(current.price || '0').replace(/,/g, '')),
          fee:      parseFloat(String(current.fee || '0').replace(/,/g, '')),
          tax:      parseFloat(String(current.tax || '0').replace(/,/g, '')),
          market:   'TW',
        };
        if (trade.quantity > 0 && trade.price > 0) trades.push(trade);
        current = {};
      }
    }

    for (const line of lines) {
      // Key: Value format
      const colonIdx = line.indexOf('：');
      const colonIdx2 = line.indexOf(':');
      const sepIdx = colonIdx >= 0 ? colonIdx : colonIdx2;

      if (sepIdx > 0) {
        const key = line.slice(0, sepIdx).trim();
        const val = line.slice(sepIdx + 1).trim();
        const field = fieldMap[key];
        if (field) {
          if (field === 'date' && current.date) finalizeCurrent();
          current[field] = val;
          continue;
        }
      }

      // Tab / comma separated row (table format)
      const parts = line.split(/[\t,，]/).map(p => p.trim());
      if (parts.length >= 5) {
        const [col0, col1, col2, col3, col4, col5, col6] = parts;
        // Try: date, symbol, name, action, qty, price, fee
        if (isDateLike(col0) && /^\d{4,6}$/.test(col1)) {
          finalizeCurrent();
          current = {
            date: col0, symbol: col1, name: col2 || col1,
            action: col3, quantity: col4, price: col5, fee: col6 || '0'
          };
          finalizeCurrent();
          continue;
        }
      }
    }
    finalizeCurrent();
    return trades;
  }

  /**
   * Parse US stock statement / brokerage report.
   */
  function parseUSStatement(text) {
    const trades = [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    const fieldMap = {
      'Date': 'date', 'Trade Date': 'date', 'Settlement Date': 'settleDate',
      'Symbol': 'symbol', 'Ticker': 'symbol',
      'Description': 'name',
      'Action': 'action', 'Transaction Type': 'action', 'Type': 'action',
      'Quantity': 'quantity', 'Shares': 'quantity',
      'Price': 'price', 'Price Per Share': 'price',
      'Commission': 'fee', 'Fees': 'fee',
      'Amount': 'total',
    };

    const actionMap = {
      'Buy': 'buy', 'Bought': 'buy', 'BUY': 'buy', 'Purchase': 'buy',
      'Sell': 'sell', 'Sold': 'sell', 'SELL': 'sell',
    };

    let current = {};

    function finalizeCurrent() {
      if (current.symbol && current.date) {
        const trade = {
          date: normalizeDate(current.date),
          symbol: String(current.symbol).trim().toUpperCase(),
          name: current.name || current.symbol,
          action: actionMap[current.action] || (current.action || '').toLowerCase() === 'buy' ? 'buy' : 'sell',
          quantity: parseFloat(String(current.quantity || '0').replace(/,/g, '')),
          price:    parseFloat(String(current.price || '0').replace(/[$,]/g, '')),
          fee:      parseFloat(String(current.fee || '0').replace(/[$,]/g, '')),
          tax:      0,
          market:   'US',
        };
        if (trade.quantity > 0 && trade.price > 0) trades.push(trade);
        current = {};
      }
    }

    for (const line of lines) {
      // Key: Value
      const sep = line.indexOf(':');
      if (sep > 0) {
        const key = line.slice(0, sep).trim();
        const val = line.slice(sep + 1).trim();
        if (fieldMap[key]) {
          if (fieldMap[key] === 'date' && current.date) finalizeCurrent();
          current[fieldMap[key]] = val;
          continue;
        }
      }
      // CSV / tab row
      const parts = line.split(/[\t,]/).map(p => p.trim());
      if (parts.length >= 5) {
        const [col0, col1, col2, col3, col4, col5, col6] = parts;
        if (isDateLike(col0) && /^[A-Z]{1,5}$/.test(col1)) {
          finalizeCurrent();
          current = {
            date: col0, symbol: col1, name: col2 || col1,
            action: col3, quantity: col4, price: col5, fee: col6 || '0'
          };
          finalizeCurrent();
        }
      }
    }
    finalizeCurrent();
    return trades;
  }

  /**
   * Parse dividend / ex-rights notice (除權息通知).
   * Returns a dividend object.
   */
  function parseDividendNotice(text, market = 'TW') {
    const result = {
      market,
      symbol: '', name: '', date: '',
      cashPerShare: 0, stockRatio: 0,
      holdingQuantity: 0,
    };

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    const fieldMap_TW = {
      '股票代碼': 'symbol', '代碼': 'symbol', '證券代號': 'symbol',
      '股票名稱': 'name', '名稱': 'name',
      '除息日': 'date', '除權日': 'date', '除權息日': 'date', '基準日': 'date',
      '現金股利': 'cashPerShare', '現金股息': 'cashPerShare',
      '股票股利': 'stockRatio', '股票股息': 'stockRatio',
      '持有股數': 'holdingQuantity', '持有數量': 'holdingQuantity',
    };

    const fieldMap_US = {
      'Symbol': 'symbol', 'Ticker': 'symbol',
      'Company': 'name', 'Description': 'name',
      'Ex-Dividend Date': 'date', 'Ex-Date': 'date', 'Record Date': 'date',
      'Dividend Per Share': 'cashPerShare', 'Amount': 'cashPerShare', 'Rate': 'cashPerShare',
      'Shares Held': 'holdingQuantity',
    };

    const fmap = market === 'TW' ? fieldMap_TW : fieldMap_US;

    for (const line of lines) {
      for (const sep of ['：', ':']) {
        const idx = line.indexOf(sep);
        if (idx > 0) {
          const key = line.slice(0, idx).trim();
          const val = line.slice(idx + 1).trim();
          if (fmap[key]) {
            const field = fmap[key];
            if (field === 'date') {
              result[field] = normalizeDate(val);
            } else if (['cashPerShare', 'stockRatio', 'holdingQuantity'].includes(field)) {
              result[field] = parseFloat(val.replace(/[,，NT$元股]/g, '')) || 0;
            } else {
              result[field] = val;
            }
          }
          break;
        }
      }
    }

    return result;
  }

  // ── Date normalization ──────────────────────────────────────────
  function normalizeDate(str) {
    if (!str) return today();
    str = String(str).trim();

    // Already ISO
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

    // 2024/03/15
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(str)) return str.replace(/\//g, '-');

    // 113/03/15 (Republic of China calendar)
    const roc = str.match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);
    if (roc) {
      const year = parseInt(roc[1]) + 1911;
      return `${year}-${roc[2]}-${roc[3]}`;
    }

    // 20240315
    if (/^\d{8}$/.test(str)) {
      return `${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}`;
    }

    // Try native parse
    const d = new Date(str);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);

    return today();
  }

  function isDateLike(str) {
    return /^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(str) ||
           /^\d{8}$/.test(str) ||
           /^\d{2,3}\/\d{2}\/\d{2}$/.test(str);
  }

  // ── DOM helpers ─────────────────────────────────────────────────
  function el(selector) { return document.querySelector(selector); }
  function els(selector) { return document.querySelectorAll(selector); }

  function showToast(msg, duration = 3000) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), duration);
  }

  function confirm(message) {
    return window.confirm(message);
  }

  return {
    formatTWD, formatUSD, formatNumber, formatShares,
    formatDate, formatMonth, today, thisMonth,
    pnlClass, pnlArrow, chartColor, CHART_COLORS,
    parseTWStatement, parseUSStatement, parseDividendNotice,
    normalizeDate, isDateLike,
    el, els, showToast, confirm,
  };
})();
