/**
 * Cashio Email Auto-Importer
 * ==========================
 * 自動從 Gmail 信用卡消費通知郵件匯入交易到 Cashio。
 *
 * 設定步驟：
 * 1. 前往 https://script.google.com → 建立新專案
 * 2. 將此檔案全部內容貼入 Code.gs
 * 3. 修改下方 CONFIG 區塊，填入你的 Worker URL
 * 4. 執行一次 setupTrigger() 安裝自動觸發器
 * 5. 依提示授權 Gmail 存取權限
 *
 * 測試：
 * - 執行 testLatestEmail() 可預覽最新一封符合的郵件會被解析成什麼
 * - 執行 importCreditCardEmails() 可手動觸發一次完整匯入
 */

// ─── 使用者設定區 ─────────────────────────────────────────────────────────────
const CONFIG = {
  // Cashio 設定頁裡的 Cloudflare Worker URL（相同網址）
  workerUrl: 'https://YOUR_WORKER.YOUR_NAME.workers.dev',

  // 選填：安全金鑰。若有在 Cloudflare Worker 環境變數設定 ADD_TX_SECRET，
  // 請在這裡填入相同的值，否則留空即可。
  secret: '',

  // Gmail 搜尋條件，用來找信用卡消費通知郵件。
  // 可依你的銀行調整 subject 關鍵字。
  gmailSearchQuery: 'subject:(消費通知 OR 刷卡通知 OR 消費提醒 OR 信用卡消費 OR 消費明細) newer_than:3d',

  // 自動執行間隔（分鐘）— setupTrigger() 會套用此設定
  triggerIntervalMinutes: 15,

  // 無法辨識特店時的預設分類
  defaultCategory: '其他',

  // 特店關鍵字 → 支出分類對應表
  // Key 為正則表達式（不分大小寫），Value 為 Cashio 的支出分類名稱
  categoryMap: {
    '7-ELEVEN|全家|FamilyMart|萊爾富|OK便利|超商':         '日常購物',
    '麥當勞|McDonald|KFC|肯德基|摩斯|漢堡王|Burger King':  '餐飲',
    '星巴克|Starbucks|路易莎|Louisa|cama|咖啡|飲料':       '餐飲',
    '餐廳|飯店食堂|小吃|火鍋|燒肉|牛排|拉麵|壽司|便當':    '餐飲',
    '誠品|博客來|momo|蝦皮|Shopee|PChome|Yahoo購物|蔦屋':  '網路購物',
    '中油|台塑|加油|油站|CPC|Sinopec':                     '交通',
    '捷運|MRT|高鐵|THSR|台鐵|TRA|公車|Bus|Uber|計程車':   '交通',
    'Apple|Google Play|App Store|Netflix|Spotify|YouTube': '訂閱服務',
    '藥局|藥妝|屈臣氏|Watsons|康是美|Cosmed':              '醫療保健',
    '全聯|家樂福|Carrefour|大潤發|COSTCO|好市多|愛買':     '超市賣場',
    '電費|水費|瓦斯|電信|中華電信|台哥大|遠傳|台電':       '帳單費用',
  },
};
// ─────────────────────────────────────────────────────────────────────────────


/**
 * 主函式 — 由定時觸發器每 N 分鐘自動呼叫。
 * 掃描 Gmail 中符合條件的新郵件，解析後寫入 Cashio。
 */
function importCreditCardEmails() {
  const props        = PropertiesService.getScriptProperties();
  const processedIds = new Set(JSON.parse(props.getProperty('processedIds') || '[]'));

  const threads = GmailApp.search(CONFIG.gmailSearchQuery, 0, 50);
  let imported = 0;
  let failed   = 0;

  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      const msgId = msg.getId();
      if (processedIds.has(msgId)) continue;

      const parsed = parseEmail(msg);

      // 無論是否成功解析，都記錄為已處理，避免重複嘗試
      processedIds.add(msgId);

      if (!parsed) continue;

      const ok = postTransaction(parsed);
      if (ok) {
        imported++;
        Logger.log('✅ 已匯入：' + JSON.stringify(parsed));
      } else {
        failed++;
        Logger.log('❌ 寫入失敗：' + JSON.stringify(parsed));
      }
    }
  }

  // 只保留最近 1000 個 ID，避免無限增長
  const idsToStore = [...processedIds].slice(-1000);
  props.setProperty('processedIds', JSON.stringify(idsToStore));

  Logger.log('完成：匯入 ' + imported + ' 筆，失敗 ' + failed + ' 筆');
}


/**
 * 嘗試用各家銀行解析器解析郵件，返回交易物件或 null。
 */
function parseEmail(msg) {
  const from    = msg.getFrom().toLowerCase();
  const subject = msg.getSubject();
  const body    = msg.getPlainBody();
  const date    = msg.getDate();

  for (const parser of BANK_PARSERS) {
    if (parser.senderMatch(from) || parser.subjectMatch(subject)) {
      const result = parser.parse(body, subject, date);
      if (result) return result;
    }
  }

  return parseGeneric(body, subject, date);
}


/**
 * 將解析好的交易 POST 到 Cloudflare Worker 的 add_transaction 端點。
 */
function postTransaction(tx) {
  if (!CONFIG.workerUrl || CONFIG.workerUrl.indexOf('YOUR_WORKER') !== -1) {
    Logger.log('❌ 尚未設定 CONFIG.workerUrl，請先填入你的 Worker URL');
    return false;
  }

  const payload = { action: 'add_transaction', transaction: tx };
  if (CONFIG.secret) payload.secret = CONFIG.secret;

  try {
    const res  = UrlFetchApp.fetch(CONFIG.workerUrl, {
      method:           'post',
      contentType:      'application/json',
      payload:          JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const json = JSON.parse(res.getContentText());
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


// ─── 各家銀行解析器 ───────────────────────────────────────────────────────────

const BANK_PARSERS = [

  // ── 國泰世華銀行 ────────────────────────────────────────────────────────────
  {
    name: '國泰世華',
    senderMatch:  function(f) { return /cathaylife|cathaybk|cathayunited|cathay-united/i.test(f); },
    subjectMatch: function(s) { return /國泰|Cathay/i.test(s) && /消費|刷卡/i.test(s); },
    parse: function(body, subject, msgDate) {
      var amount   = extractAmount(body, [/消費金額[：:]\s*NT\$?\s*([\d,]+)/i, /NT\$\s*([\d,]+)/i]);
      var merchant = extractText(body,   [/消費特店[：:]\s*(.+)/i, /消費商店[：:]\s*(.+)/i, /消費地點[：:]\s*(.+)/i]);
      var date     = extractDate(body,   [/消費時間[：:]\s*(\d{4}\/\d{2}\/\d{2})/i,
                                          /交易時間[：:]\s*(\d{4}\/\d{2}\/\d{2})/i]) || toDateStr(msgDate);
      if (!amount) return null;
      return buildTx(amount, merchant, date);
    },
  },

  // ── 玉山銀行 ────────────────────────────────────────────────────────────────
  {
    name: '玉山銀行',
    senderMatch:  function(f) { return /esunbank|e\.sun|esun\.com/i.test(f); },
    subjectMatch: function(s) { return /玉山/i.test(s) && /消費|刷卡/i.test(s); },
    parse: function(body, subject, msgDate) {
      var amount   = extractAmount(body, [/消費金額\s*NT\$?\s*([\d,]+)/i, /NT\$\s*([\d,]+)/i]);
      var merchant = extractText(body,   [/消費商店\s+(.+)/i, /特店名稱\s+(.+)/i, /消費店家\s+(.+)/i]);
      var date     = extractDate(body,   [/消費時間\s+(\d{4}\/\d{2}\/\d{2})/i,
                                          /交易日期\s+(\d{4}\/\d{2}\/\d{2})/i]) || toDateStr(msgDate);
      if (!amount) return null;
      return buildTx(amount, merchant, date);
    },
  },

  // ── 中國信託銀行 ─────────────────────────────────────────────────────────────
  {
    name: '中信銀行',
    senderMatch:  function(f) { return /ctbcbank|ctbc|chinatrust/i.test(f); },
    subjectMatch: function(s) { return /中信|中國信託/i.test(s) && /消費|刷卡/i.test(s); },
    parse: function(body, subject, msgDate) {
      var amount   = extractAmount(body, [/消費金額[：:]\s*NT\$?\s*([\d,]+)/i,
                                          /金額[：:]\s*NT\$?\s*([\d,]+)/i, /NT\$?\s*([\d,]+)/i]);
      var merchant = extractText(body,   [/消費地點[：:]\s*(.+)/i, /特店[：:]\s*(.+)/i, /商店[：:]\s*(.+)/i]);
      // 中信有時只有 MM/DD 格式
      var dateStr  = extractDate(body,   [/消費日期[：:]\s*(\d{4}\/\d{2}\/\d{2})/i,
                                          /交易日期[：:]\s*(\d{4}\/\d{2}\/\d{2})/i,
                                          /(\d{2}\/\d{2})/]);
      var date     = dateStr && dateStr.length === 5
                       ? inferFullDate(dateStr, msgDate)
                       : (dateStr || toDateStr(msgDate));
      if (!amount) return null;
      return buildTx(amount, merchant, date);
    },
  },

  // ── 台新銀行 ─────────────────────────────────────────────────────────────────
  {
    name: '台新銀行',
    senderMatch:  function(f) { return /taishinbank|taishin/i.test(f); },
    subjectMatch: function(s) { return /台新/i.test(s) && /消費|刷卡/i.test(s); },
    parse: function(body, subject, msgDate) {
      var amount   = extractAmount(body, [/消費金額[：:]\s*NTD?\s*([\d,]+)/i,
                                          /NT\$\s*([\d,]+)/i, /NTD\s*([\d,]+)/i]);
      var merchant = extractText(body,   [/消費商店[：:]\s*(.+)/i, /交易商店[：:]\s*(.+)/i]);
      var date     = extractDate(body,   [/交易時間[：:]\s*(\d{4}-\d{2}-\d{2})/i,
                                          /(\d{4}\/\d{2}\/\d{2})/i,
                                          /(\d{4}-\d{2}-\d{2})/i]) || toDateStr(msgDate);
      if (!amount) return null;
      return buildTx(amount, merchant, date);
    },
  },

  // ── 富邦銀行 ─────────────────────────────────────────────────────────────────
  {
    name: '富邦銀行',
    senderMatch:  function(f) { return /fubon|taipeibank|tpfubon/i.test(f); },
    subjectMatch: function(s) { return /富邦/i.test(s) && /消費|刷卡/i.test(s); },
    parse: function(body, subject, msgDate) {
      var amount   = extractAmount(body, [/消費金額[：:]\s*NT\$?\s*([\d,]+)/i, /NT\$\s*([\d,]+)/i]);
      var merchant = extractText(body,   [/消費商店[：:]\s*(.+)/i, /消費地點[：:]\s*(.+)/i]);
      var date     = extractDate(body,   [/消費日期[：:]\s*(\d{4}\/\d{2}\/\d{2})/i]) || toDateStr(msgDate);
      if (!amount) return null;
      return buildTx(amount, merchant, date);
    },
  },

  // ── 永豐銀行 ─────────────────────────────────────────────────────────────────
  {
    name: '永豐銀行',
    senderMatch:  function(f) { return /sinopac|banksinopac/i.test(f); },
    subjectMatch: function(s) { return /永豐/i.test(s) && /消費|刷卡/i.test(s); },
    parse: function(body, subject, msgDate) {
      var amount   = extractAmount(body, [/消費金額[：:]\s*NT\$?\s*([\d,]+)/i, /NT\$\s*([\d,]+)/i]);
      var merchant = extractText(body,   [/消費商店[：:]\s*(.+)/i, /商店名稱[：:]\s*(.+)/i]);
      var date     = extractDate(body,   [/消費日期[：:]\s*(\d{4}\/\d{2}\/\d{2})/i]) || toDateStr(msgDate);
      if (!amount) return null;
      return buildTx(amount, merchant, date);
    },
  },

  // ── 聯邦銀行 ─────────────────────────────────────────────────────────────────
  {
    name: '聯邦銀行',
    senderMatch:  function(f) { return /unibank|unionbank/i.test(f); },
    subjectMatch: function(s) { return /聯邦/i.test(s) && /消費|刷卡/i.test(s); },
    parse: function(body, subject, msgDate) {
      var amount   = extractAmount(body, [/消費金額[：:]\s*NT\$?\s*([\d,]+)/i, /NT\$\s*([\d,]+)/i]);
      var merchant = extractText(body,   [/消費商店[：:]\s*(.+)/i]);
      var date     = extractDate(body,   [/消費日期[：:]\s*(\d{4}\/\d{2}\/\d{2})/i]) || toDateStr(msgDate);
      if (!amount) return null;
      return buildTx(amount, merchant, date);
    },
  },

  // ── LINE Pay / 街口支付 ──────────────────────────────────────────────────────
  {
    name: 'LINE Pay',
    senderMatch:  function(f) { return /linepay|line\.me|jkopay/i.test(f); },
    subjectMatch: function(s) { return /LINE Pay|街口|全支付/i.test(s); },
    parse: function(body, subject, msgDate) {
      var amount   = extractAmount(body, [/NT\$\s*([\d,]+)/i, /消費金額\s*([\d,]+)/i, /付款金額\s*([\d,]+)/i]);
      var merchant = extractText(body,   [/消費店家[：:]\s*(.+)/i, /付款至[：:]\s*(.+)/i, /交易商店[：:]\s*(.+)/i]);
      var date     = toDateStr(msgDate);
      if (!amount) return null;
      return buildTx(amount, merchant, date);
    },
  },

];


// ─── 通用備援解析器（無法辨識銀行時使用）──────────────────────────────────────

function parseGeneric(body, subject, msgDate) {
  // 必須看起來像消費通知
  if (!/消費|刷卡|信用卡/.test(subject + body)) return null;

  var amount = extractAmount(body, [
    /消費金額[：:\s]*NT\$?\s*([\d,]+)/i,
    /NT\$\s*([\d,]+)/i,
    /NTD\s*([\d,]+)/i,
    /新台幣\s*([\d,]+)\s*元/i,
    /金額[：:\s]*\$?\s*([\d,]+)/i,
  ]);
  if (!amount || amount < 1) return null;

  var merchant = extractText(body, [
    /消費特店[：:]\s*(.+)/i,
    /消費商店[：:]\s*(.+)/i,
    /消費地點[：:]\s*(.+)/i,
    /特店[：:]\s*(.+)/i,
    /商店[：:]\s*(.+)/i,
  ]);
  var date = extractDate(body, [
    /(\d{4}\/\d{2}\/\d{2})/,
    /(\d{4}-\d{2}-\d{2})/,
  ]) || toDateStr(msgDate);

  return buildTx(amount, merchant, date);
}


// ─── 工具函式 ─────────────────────────────────────────────────────────────────

function extractAmount(body, patterns) {
  for (var i = 0; i < patterns.length; i++) {
    var m = body.match(patterns[i]);
    if (m) {
      var n = parseInt(m[1].replace(/,/g, ''), 10);
      if (n > 0) return n;
    }
  }
  return null;
}

function extractText(body, patterns) {
  for (var i = 0; i < patterns.length; i++) {
    var m = body.match(patterns[i]);
    if (m) {
      var text = m[1].trim().split(/[\n\r]/)[0].trim();
      if (text.length > 0 && text.length < 80) return text;
    }
  }
  return null;
}

function extractDate(body, patterns) {
  for (var i = 0; i < patterns.length; i++) {
    var m = body.match(patterns[i]);
    if (m) {
      var normalized = m[1].replace(/\//g, '-');
      if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
      if (/^\d{2}-\d{2}$/.test(normalized)) return normalized; // MM-DD，需 inferFullDate
    }
  }
  return null;
}

// MM/DD 格式補上年份（用郵件接收年份推斷）
function inferFullDate(mmdd, msgDate) {
  var parts = mmdd.replace(/-/g, '/').split('/');
  if (parts.length === 2) {
    var year = msgDate.getFullYear();
    return year + '-' + parts[0].padStart(2, '0') + '-' + parts[1].padStart(2, '0');
  }
  return toDateStr(msgDate);
}

function toDateStr(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function mapCategory(merchant) {
  if (!merchant) return CONFIG.defaultCategory;
  for (var pattern in CONFIG.categoryMap) {
    if (new RegExp(pattern, 'i').test(merchant)) return CONFIG.categoryMap[pattern];
  }
  return CONFIG.defaultCategory;
}

function buildTx(amount, merchant, date) {
  var note     = merchant ? merchant.slice(0, 60) : '';
  var category = mapCategory(merchant);
  return {
    date:          date,
    type:          'expense',
    amount:        amount,        // 必須是 number
    category:      category,
    note:          note,
    source:        'email_import',
    paymentMethod: 'credit_card',
  };
}


// ─── 觸發器管理 ───────────────────────────────────────────────────────────────

/**
 * 執行一次此函式來安裝定時觸發器。
 * 之後 importCreditCardEmails() 會每隔 N 分鐘自動執行。
 */
function setupTrigger() {
  // 先刪除已存在的同名觸發器
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'importCreditCardEmails') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('importCreditCardEmails')
    .timeBased()
    .everyMinutes(CONFIG.triggerIntervalMinutes)
    .create();

  Logger.log('✅ 觸發器已建立：每 ' + CONFIG.triggerIntervalMinutes + ' 分鐘執行一次 importCreditCardEmails()');
}

/**
 * 測試函式：解析最新一封符合條件的郵件，在 Logs 顯示結果（不實際寫入）。
 */
function testLatestEmail() {
  var threads = GmailApp.search(CONFIG.gmailSearchQuery, 0, 1);
  if (threads.length === 0) {
    Logger.log('找不到符合條件的郵件。請確認 gmailSearchQuery 設定是否正確。');
    return;
  }

  var msg = threads[0].getMessages()[0];
  Logger.log('寄件人：' + msg.getFrom());
  Logger.log('主旨：'   + msg.getSubject());
  Logger.log('郵件內文（前 600 字）：\n' + msg.getPlainBody().slice(0, 600));
  Logger.log('---');

  var parsed = parseEmail(msg);
  if (parsed) {
    Logger.log('✅ 解析結果：\n' + JSON.stringify(parsed, null, 2));
    Logger.log('\n（此為預覽，尚未寫入 Cashio）');
  } else {
    Logger.log('❌ 無法解析此郵件。');
    Logger.log('請檢查銀行解析器的 senderMatch / subjectMatch 條件，或在 BANK_PARSERS 新增你的銀行。');
  }
}

/**
 * 清除已處理 ID 紀錄，讓所有郵件重新被掃描（用於重置或測試）。
 */
function clearProcessedIds() {
  PropertiesService.getScriptProperties().deleteProperty('processedIds');
  Logger.log('✅ 已清除 processedIds，所有符合郵件將在下次執行時重新處理。');
}
