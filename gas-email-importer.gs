/**
 * Cashio Email Auto-Importer
 * ==========================
 * 自動從 Gmail 信用卡消費通知郵件匯入交易到 Cashio。
 * 單封郵件含多筆消費明細時，會全部解析並分別寫入。
 *
 * 設定步驟：
 * 1. 前往 https://script.google.com → 建立新專案
 * 2. 將此檔案全部內容貼入 Code.gs
 * 3. 修改下方 CONFIG 區塊，填入你的 Worker URL
 * 4. 執行一次 setupTrigger() 安裝自動觸發器
 * 5. 依提示授予 Gmail 存取權限
 *
 * 測試：
 * - 執行 testLatestEmail()  → 預覽最新符合郵件的全部解析結果（不寫入）
 * - 執行 importCreditCardEmails() → 手動觸發一次完整匯入
 */

// ─── 使用者設定區 ─────────────────────────────────────────────────────────────
var CONFIG = {
  // Cashio 設定頁裡的 Cloudflare Worker URL（相同網址）
  workerUrl: 'https://YOUR_WORKER.YOUR_NAME.workers.dev',

  // 選填：安全金鑰。若在 Cloudflare Worker 環境變數設定了 ADD_TX_SECRET，
  // 請在這裡填入相同的值；否則留空。
  secret: '',

  // Gmail 搜尋條件，用來找信用卡消費通知郵件。
  // 可依你的銀行調整 subject 關鍵字。
  gmailSearchQuery: 'subject:(消費通知 OR 刷卡通知 OR 消費提醒 OR 信用卡消費 OR 消費明細 OR 消費彙整) newer_than:3d',

  // 自動執行間隔（分鐘）— setupTrigger() 會套用此設定
  triggerIntervalMinutes: 15,

  // 無法辨識特店時的預設分類
  defaultCategory: '其他',

  // 特店關鍵字 → 支出分類對應表
  categoryMap: {
    '7-ELEVEN|全家|FamilyMart|萊爾富|OK便利|超商':         '日常購物',
    '麥當勞|McDonald|KFC|肯德基|摩斯|漢堡王|Burger King':  '餐飲',
    '星巴克|Starbucks|路易莎|Louisa|cama|咖啡|飲料':       '餐飲',
    '餐廳|飯店|食堂|小吃|火鍋|燒肉|牛排|拉麵|壽司|便當':  '餐飲',
    '誠品|博客來|momo|蝦皮|Shopee|PChome|Yahoo購物|蔦屋':  '網路購物',
    '中油|台塑|加油|油站|CPC':                             '交通',
    '捷運|MRT|高鐵|THSR|台鐵|TRA|公車|Uber|計程車':       '交通',
    'Apple|Google Play|App Store|Netflix|Spotify|YouTube': '訂閱服務',
    '藥局|藥妝|屈臣氏|Watsons|康是美|Cosmed':              '醫療保健',
    '全聯|家樂福|Carrefour|大潤發|COSTCO|好市多|愛買':     '超市賣場',
    '電費|水費|瓦斯|電信|中華電信|台哥大|遠傳|台電':       '帳單費用',
  },
};
// ─────────────────────────────────────────────────────────────────────────────


/**
 * 主函式 — 由定時觸發器每 N 分鐘自動呼叫。
 * 掃描 Gmail 中符合條件的新郵件，解析所有消費並寫入 Cashio。
 */
function importCreditCardEmails() {
  var props        = PropertiesService.getScriptProperties();
  var processedIds = new Set(JSON.parse(props.getProperty('processedIds') || '[]'));

  var threads   = GmailApp.search(CONFIG.gmailSearchQuery, 0, 50);
  var imported  = 0;
  var failed    = 0;
  var unparsed  = 0;

  for (var ti = 0; ti < threads.length; ti++) {
    var msgs = threads[ti].getMessages();
    for (var mi = 0; mi < msgs.length; mi++) {
      var msg   = msgs[mi];
      var msgId = msg.getId();
      if (processedIds.has(msgId)) continue;

      var transactions = parseEmail(msg);

      // 無論是否成功解析，都標記為已處理，避免重複嘗試
      processedIds.add(msgId);

      if (transactions.length === 0) {
        unparsed++;
        continue;
      }

      for (var ti2 = 0; ti2 < transactions.length; ti2++) {
        var ok = postTransaction(transactions[ti2]);
        if (ok) {
          imported++;
        } else {
          failed++;
          Logger.log('❌ 寫入失敗：' + JSON.stringify(transactions[ti2]));
        }
      }
      Logger.log('✅ 郵件 ' + msg.getSubject() + ' 解析出 ' + transactions.length + ' 筆，成功寫入 ' + (transactions.length - failed));
    }
  }

  // 只保留最近 1000 個 ID，避免無限增長
  var idsToStore = [];
  processedIds.forEach(function(id) { idsToStore.push(id); });
  props.setProperty('processedIds', JSON.stringify(idsToStore.slice(-1000)));

  Logger.log('完成：匯入 ' + imported + ' 筆，失敗 ' + failed + ' 筆，無法解析 ' + unparsed + ' 封');
}


/**
 * 解析一封 Gmail 郵件，回傳 Transaction 陣列（可能為空陣列）。
 */
function parseEmail(msg) {
  var from    = msg.getFrom().toLowerCase();
  var subject = msg.getSubject();
  var body    = msg.getPlainBody();
  var date    = msg.getDate();

  for (var i = 0; i < BANK_PARSERS.length; i++) {
    var parser = BANK_PARSERS[i];
    if (parser.senderMatch(from) || parser.subjectMatch(subject)) {
      var results = parser.parse(body, subject, date);
      if (results && results.length > 0) return results;
    }
  }

  return parseGeneric(body, subject, date);
}


/**
 * 將一筆交易 POST 到 Cashio Cloudflare Worker 的 add_transaction 端點。
 */
function postTransaction(tx) {
  if (!CONFIG.workerUrl || CONFIG.workerUrl.indexOf('YOUR_WORKER') !== -1) {
    Logger.log('❌ 尚未設定 CONFIG.workerUrl');
    return false;
  }

  var payload = { action: 'add_transaction', transaction: tx };
  if (CONFIG.secret) payload.secret = CONFIG.secret;

  try {
    var res  = UrlFetchApp.fetch(CONFIG.workerUrl, {
      method:             'post',
      contentType:        'application/json',
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    var json = JSON.parse(res.getContentText());
    if (!json.ok) {
      Logger.log('❌ Worker 回應錯誤：' + json.error);
      return false;
    }
    return true;
  } catch (e) {
    Logger.log('❌ 網路錯誤：' + e.message);
    return false;
  }
}


// ─── 核心：多筆分割邏輯 ───────────────────────────────────────────────────────

/**
 * 將郵件 body 依「交易錨點」切割成多個交易區塊。
 *
 * 優先嘗試以時間/日期欄位作為分割點（每筆交易必有，合計列通常沒有）。
 * 若找不到兩個以上的時間錨點，改用金額欄位作為分割點。
 * 若只找到一個錨點，直接回傳 [body]（當成單筆處理）。
 *
 * @param {string} body - 郵件純文字內文
 * @param {string[]} timeAnchors - 時間/日期欄位的 regex 字串（優先用）
 * @param {string[]} amountAnchors - 金額欄位的 regex 字串（備援用）
 * @returns {string[]} 切割好的區塊陣列
 */
function smartSplit(body, timeAnchors, amountAnchors) {
  // 先試時間錨點（最可靠，不會出現在合計列）
  for (var i = 0; i < timeAnchors.length; i++) {
    var blocks = splitByPattern(body, timeAnchors[i]);
    if (blocks.length >= 2) return blocks;
  }
  // 備援：金額錨點
  if (amountAnchors) {
    for (var j = 0; j < amountAnchors.length; j++) {
      var blocks2 = splitByPattern(body, amountAnchors[j]);
      if (blocks2.length >= 2) return blocks2;
    }
  }
  return [body];
}

/**
 * 找出 pattern 所有出現位置，以這些位置為起點切割 body。
 */
function splitByPattern(body, pattern) {
  var re        = new RegExp(pattern, 'g');
  var positions = [];
  var m;
  while ((m = re.exec(body)) !== null) positions.push(m.index);
  if (positions.length < 2) return [body];

  var blocks = [];
  for (var i = 0; i < positions.length; i++) {
    var start = positions[i];
    var end   = i < positions.length - 1 ? positions[i + 1] : body.length;
    blocks.push(body.slice(start, end));
  }
  return blocks;
}


// ─── 各家銀行解析器（parse() 均回傳 Transaction[]）───────────────────────────

var BANK_PARSERS = [

  // ── 國泰世華銀行 ────────────────────────────────────────────────────────────
  {
    name: '國泰世華',
    senderMatch:  function(f) { return /cathaylife|cathaybk|cathayunited|cathay-united/i.test(f); },
    subjectMatch: function(s) { return /國泰|Cathay/i.test(s) && /消費|刷卡/i.test(s); },
    parse: function(body, subject, msgDate) {
      // 優先以表格標頭列「卡別 行動卡號後4碼…」分割（每筆消費前各出現一次）
      // 備援：帶標籤的時間欄位（部分格式仍有）
      var blocks = smartSplit(body,
        ['卡別[\\s　]+行動卡號', '消費時間[：:]', '交易時間[：:]'],
        ['NT\\$\\s*[\\d,]+']
      );
      return parseBlocks(blocks, msgDate, {
        amountRe:   [/消費金額[：:]\s*NT\$?\s*([\d,]+)/i, /NT\$\s*([\d,]+)/i],
        merchantRe: [
          /消費特店[：:]\s*(.+)/i,
          /消費商店[：:]\s*(.+)/i,
          /消費地點[：:]\s*(.+)/i,
          /NT\$[\d,]+\s+([^\n\r]+)/i,   // 表格格式：NT$金額 商店名稱 …
        ],
        dateRe: [
          /消費時間[：:]\s*(\d{4}\/\d{2}\/\d{2})/i,
          /交易時間[：:]\s*(\d{4}\/\d{2}\/\d{2})/i,
          /(\d{4}\/\d{2}\/\d{2})/,      // 表格格式：正卡 2026/04/27 17:23 TW
        ],
      });
    },
  },

  // ── 玉山銀行 ────────────────────────────────────────────────────────────────
  {
    name: '玉山銀行',
    senderMatch:  function(f) { return /esunbank|e\.sun|esun\.com/i.test(f); },
    subjectMatch: function(s) { return /玉山/i.test(s) && /消費|刷卡/i.test(s); },
    parse: function(body, subject, msgDate) {
      var blocks = smartSplit(body,
        ['消費時間\\s', '交易日期\\s'],
        ['消費金額\\s']
      );
      return parseBlocks(blocks, msgDate, {
        amountRe:   [/消費金額\s*NT\$?\s*([\d,]+)/i, /NT\$\s*([\d,]+)/i],
        merchantRe: [/消費商店\s+(.+)/i, /特店名稱\s+(.+)/i, /消費店家\s+(.+)/i],
        dateRe:     [/消費時間\s+(\d{4}\/\d{2}\/\d{2})/i, /交易日期\s+(\d{4}\/\d{2}\/\d{2})/i],
      });
    },
  },

  // ── 中國信託銀行 ─────────────────────────────────────────────────────────────
  {
    name: '中信銀行',
    senderMatch:  function(f) { return /ctbcbank|ctbc|chinatrust/i.test(f); },
    subjectMatch: function(s) { return /中信|中國信託/i.test(s) && /消費|刷卡/i.test(s); },
    parse: function(body, subject, msgDate) {
      var blocks = smartSplit(body,
        ['消費日期[：:]', '交易日期[：:]', '消費時間[：:]'],
        ['消費金額[：:]', '金額[：:]']
      );
      return parseBlocks(blocks, msgDate, {
        amountRe:   [/消費金額[：:]\s*NT\$?\s*([\d,]+)/i, /金額[：:]\s*NT\$?\s*([\d,]+)/i, /NT\$?\s*([\d,]+)/i],
        merchantRe: [/消費地點[：:]\s*(.+)/i, /特店[：:]\s*(.+)/i, /商店[：:]\s*(.+)/i],
        dateRe:     [/消費日期[：:]\s*(\d{4}\/\d{2}\/\d{2})/i, /交易日期[：:]\s*(\d{4}\/\d{2}\/\d{2})/i, /(\d{2}\/\d{2})/],
        inferYear:  true,
      }, msgDate);
    },
  },

  // ── 台新銀行 ─────────────────────────────────────────────────────────────────
  {
    name: '台新銀行',
    senderMatch:  function(f) { return /taishinbank|taishin/i.test(f); },
    subjectMatch: function(s) { return /台新/i.test(s) && /消費|刷卡/i.test(s); },
    parse: function(body, subject, msgDate) {
      var blocks = smartSplit(body,
        ['交易時間[：:]', '消費時間[：:]'],
        ['消費金額[：:]']
      );
      return parseBlocks(blocks, msgDate, {
        amountRe:   [/消費金額[：:]\s*NTD?\s*([\d,]+)/i, /NT\$\s*([\d,]+)/i, /NTD\s*([\d,]+)/i],
        merchantRe: [/消費商店[：:]\s*(.+)/i, /交易商店[：:]\s*(.+)/i],
        dateRe:     [/交易時間[：:]\s*(\d{4}-\d{2}-\d{2})/i, /(\d{4}\/\d{2}\/\d{2})/i, /(\d{4}-\d{2}-\d{2})/i],
      });
    },
  },

  // ── 富邦銀行 ─────────────────────────────────────────────────────────────────
  {
    name: '富邦銀行',
    senderMatch:  function(f) { return /fubon|taipeibank|tpfubon/i.test(f); },
    subjectMatch: function(s) { return /富邦/i.test(s) && /消費|刷卡/i.test(s); },
    parse: function(body, subject, msgDate) {
      var blocks = smartSplit(body,
        ['消費日期[：:]', '交易日期[：:]'],
        ['消費金額[：:]']
      );
      return parseBlocks(blocks, msgDate, {
        amountRe:   [/消費金額[：:]\s*NT\$?\s*([\d,]+)/i, /NT\$\s*([\d,]+)/i],
        merchantRe: [/消費商店[：:]\s*(.+)/i, /消費地點[：:]\s*(.+)/i],
        dateRe:     [/消費日期[：:]\s*(\d{4}\/\d{2}\/\d{2})/i, /交易日期[：:]\s*(\d{4}\/\d{2}\/\d{2})/i],
      });
    },
  },

  // ── 永豐銀行 ─────────────────────────────────────────────────────────────────
  {
    name: '永豐銀行',
    senderMatch:  function(f) { return /sinopac|banksinopac/i.test(f); },
    subjectMatch: function(s) { return /永豐/i.test(s) && /消費|刷卡/i.test(s); },
    parse: function(body, subject, msgDate) {
      var blocks = smartSplit(body,
        ['消費日期[：:]', '交易日期[：:]'],
        ['消費金額[：:]']
      );
      return parseBlocks(blocks, msgDate, {
        amountRe:   [/消費金額[：:]\s*NT\$?\s*([\d,]+)/i, /NT\$\s*([\d,]+)/i],
        merchantRe: [/消費商店[：:]\s*(.+)/i, /商店名稱[：:]\s*(.+)/i],
        dateRe:     [/消費日期[：:]\s*(\d{4}\/\d{2}\/\d{2})/i],
      });
    },
  },

  // ── 聯邦銀行 ─────────────────────────────────────────────────────────────────
  {
    name: '聯邦銀行',
    senderMatch:  function(f) { return /unibank|unionbank/i.test(f); },
    subjectMatch: function(s) { return /聯邦/i.test(s) && /消費|刷卡/i.test(s); },
    parse: function(body, subject, msgDate) {
      var blocks = smartSplit(body,
        ['消費日期[：:]', '消費時間[：:]'],
        ['消費金額[：:]']
      );
      return parseBlocks(blocks, msgDate, {
        amountRe:   [/消費金額[：:]\s*NT\$?\s*([\d,]+)/i, /NT\$\s*([\d,]+)/i],
        merchantRe: [/消費商店[：:]\s*(.+)/i],
        dateRe:     [/消費日期[：:]\s*(\d{4}\/\d{2}\/\d{2})/i],
      });
    },
  },

  // ── LINE Pay / 街口支付 ──────────────────────────────────────────────────────
  {
    name: 'LINE Pay',
    senderMatch:  function(f) { return /linepay|line\.me|jkopay/i.test(f); },
    subjectMatch: function(s) { return /LINE Pay|街口|全支付/i.test(s); },
    parse: function(body, subject, msgDate) {
      var blocks = smartSplit(body,
        ['交易時間[：:]', '付款時間[：:]'],
        ['NT\\$\\s*[\\d,]+']
      );
      return parseBlocks(blocks, msgDate, {
        amountRe:   [/NT\$\s*([\d,]+)/i, /消費金額\s*([\d,]+)/i, /付款金額\s*([\d,]+)/i],
        merchantRe: [/消費店家[：:]\s*(.+)/i, /付款至[：:]\s*(.+)/i, /交易商店[：:]\s*(.+)/i],
        dateRe:     [/交易時間[：:]\s*(\d{4}[-\/]\d{2}[-\/]\d{2})/i, /(\d{4}-\d{2}-\d{2})/i],
      });
    },
  },

];


// ─── 通用備援解析器 ───────────────────────────────────────────────────────────

function parseGeneric(body, subject, msgDate) {
  if (!/消費|刷卡|信用卡/.test(subject + body)) return [];

  // 以常見時間/日期欄位切割，再以金額備援
  var blocks = smartSplit(body,
    ['消費時間[：:]', '交易時間[：:]', '消費日期[：:]', '交易日期[：:]'],
    ['消費金額[：:]', 'NT\\$\\s*[\\d,]+']
  );

  return parseBlocks(blocks, msgDate, {
    amountRe: [
      /消費金額[：:\s]*NT\$?\s*([\d,]+)/i,
      /NT\$\s*([\d,]+)/i,
      /NTD\s*([\d,]+)/i,
      /新台幣\s*([\d,]+)\s*元/i,
      /金額[：:\s]*\$?\s*([\d,]+)/i,
    ],
    merchantRe: [
      /消費特店[：:]\s*(.+)/i, /消費商店[：:]\s*(.+)/i,
      /消費地點[：:]\s*(.+)/i, /特店[：:]\s*(.+)/i, /商店[：:]\s*(.+)/i,
    ],
    dateRe: [
      /(\d{4}\/\d{2}\/\d{2})/,
      /(\d{4}-\d{2}-\d{2})/,
    ],
  });
}


// ─── 區塊批次解析（所有 parser 共用）─────────────────────────────────────────

/**
 * 對每個區塊套用 extractAmount / extractText / extractDate，
 * 回傳有效交易的陣列。
 *
 * @param {string[]} blocks  - 已切割的區塊陣列
 * @param {Date}     msgDate - 郵件接收時間（日期備援）
 * @param {Object}   opts    - { amountRe, merchantRe, dateRe, inferYear }
 * @returns {Object[]} Transaction 陣列
 */
function parseBlocks(blocks, msgDate, opts) {
  var results = [];
  var fallbackDate = toDateStr(msgDate);

  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];

    var amount = extractAmount(block, opts.amountRe);
    if (!amount || amount <= 0) continue;

    var merchant = extractText(block, opts.merchantRe || []);

    var rawDate = extractDate(block, opts.dateRe || []);
    var date;
    if (!rawDate) {
      date = fallbackDate;
    } else if (opts.inferYear && /^\d{2}-\d{2}$/.test(rawDate)) {
      date = inferFullDate(rawDate, msgDate);
    } else {
      date = rawDate;
    }

    results.push(buildTx(amount, merchant, date));
  }

  return results;
}


// ─── 工具函式 ─────────────────────────────────────────────────────────────────

function extractAmount(text, patterns) {
  for (var i = 0; i < patterns.length; i++) {
    var m = text.match(patterns[i]);
    if (m) {
      var n = parseInt(m[1].replace(/,/g, ''), 10);
      if (n > 0) return n;
    }
  }
  return null;
}

function extractText(text, patterns) {
  for (var i = 0; i < patterns.length; i++) {
    var m = text.match(patterns[i]);
    if (m) {
      var t = m[1].trim().split(/[\n\r]/)[0].trim();
      if (t.length > 0 && t.length < 80) return t;
    }
  }
  return null;
}

function extractDate(text, patterns) {
  for (var i = 0; i < patterns.length; i++) {
    var m = text.match(patterns[i]);
    if (m) {
      var raw = m[1].replace(/\//g, '-');
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
      if (/^\d{2}-\d{2}$/.test(raw)) return raw; // MM-DD，需 inferFullDate
    }
  }
  return null;
}

// MM-DD 格式補上年份（用郵件接收年份推斷）
function inferFullDate(mmdd, msgDate) {
  var parts = mmdd.split('-');
  if (parts.length === 2) {
    var year = msgDate.getFullYear();
    return year + '-' + parts[0].padStart(2, '0') + '-' + parts[1].padStart(2, '0');
  }
  return toDateStr(msgDate);
}

function toDateStr(date) {
  var y = date.getFullYear();
  var mo = String(date.getMonth() + 1).padStart(2, '0');
  var d  = String(date.getDate()).padStart(2, '0');
  return y + '-' + mo + '-' + d;
}

function mapCategory(merchant) {
  if (!merchant) return CONFIG.defaultCategory;
  for (var pattern in CONFIG.categoryMap) {
    if (new RegExp(pattern, 'i').test(merchant)) return CONFIG.categoryMap[pattern];
  }
  return CONFIG.defaultCategory;
}

function buildTx(amount, merchant, date) {
  return {
    date:          date,
    type:          'expense',
    amount:        amount,        // 必須是 number
    category:      mapCategory(merchant),
    note:          merchant ? merchant.slice(0, 60) : '',
    source:        'email_import',
    paymentMethod: 'credit_card',
  };
}


// ─── 觸發器管理 ───────────────────────────────────────────────────────────────

/**
 * 執行一次此函式來安裝定時觸發器。
 */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'importCreditCardEmails') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('importCreditCardEmails')
    .timeBased()
    .everyMinutes(CONFIG.triggerIntervalMinutes)
    .create();
  Logger.log('✅ 觸發器已建立：每 ' + CONFIG.triggerIntervalMinutes + ' 分鐘執行一次 importCreditCardEmails()');
}

/**
 * 測試函式：解析最新一封符合條件的郵件，在 Logs 顯示【全部】解析結果（不寫入）。
 */
function testLatestEmail() {
  var threads = GmailApp.search(CONFIG.gmailSearchQuery, 0, 1);
  if (threads.length === 0) {
    Logger.log('找不到符合條件的郵件。請確認 gmailSearchQuery 設定。');
    return;
  }

  var msg = threads[0].getMessages()[0];
  Logger.log('寄件人：' + msg.getFrom());
  Logger.log('主旨：'   + msg.getSubject());
  Logger.log('─── 郵件內文（前 800 字）───');
  Logger.log(msg.getPlainBody().slice(0, 800));
  Logger.log('────────────────────────────');

  var transactions = parseEmail(msg);

  if (transactions.length === 0) {
    Logger.log('❌ 無法解析任何消費。');
    Logger.log('建議：複製上方郵件內文，確認你的銀行名稱/發信地址是否符合 BANK_PARSERS 的 senderMatch/subjectMatch 條件。');
    Logger.log('若需新增銀行，請仿照 BANK_PARSERS 內既有格式新增一個 parser。');
    return;
  }

  Logger.log('✅ 共解析出 ' + transactions.length + ' 筆消費：');
  for (var i = 0; i < transactions.length; i++) {
    Logger.log('  [' + (i+1) + '] ' + JSON.stringify(transactions[i]));
  }
  Logger.log('（此為預覽，尚未寫入 Cashio）');
}

/**
 * 清除已處理 ID 紀錄（讓所有郵件重新被掃描，用於重置或測試）。
 */
function clearProcessedIds() {
  PropertiesService.getScriptProperties().deleteProperty('processedIds');
  Logger.log('✅ 已清除 processedIds，所有符合郵件將在下次執行時重新處理。');
}
