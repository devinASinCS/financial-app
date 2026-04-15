# Cloudflare Worker Setup — Notion Sync

## What this does

This Worker acts as a CORS proxy between your browser app and the Notion API.
Your financial data is saved to a Notion page as JSON blocks.

---

## Step 1 — Create a Notion Integration

1. Go to https://www.notion.so/my-integrations
2. Click **New integration**
3. Name it: `Finance App Sync`
4. Select your workspace
5. Click **Submit** and copy the **Internal Integration Token** (starts with `secret_...`)

---

## Step 2 — Create a Notion Page for backup storage

1. Open Notion and create a new blank page (e.g., "Finance App Backup")
2. Share the page with your integration:
   - Click ··· (top right) → **Add connections** → select `Finance App Sync`
3. Copy the **Page ID** from the URL:
   - URL looks like: `https://www.notion.so/Finance-App-Backup-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
   - The Page ID is the 32-character hex string at the end (with or without dashes)

---

## Step 3 — Deploy the Cloudflare Worker

### Option A: Cloudflare Dashboard (no CLI needed)

1. Go to https://dash.cloudflare.com → **Workers & Pages** → **Create**
2. Choose **Create Worker**, give it a name (e.g., `finance-notion-sync`)
3. Click **Deploy**, then **Edit code**
4. Paste the contents of `worker.js` into the editor
5. Click **Deploy**
6. Go to **Settings** → **Variables** → **Add variable** (as secrets):
   - `NOTION_TOKEN` = your integration token (`secret_xxx...`)
   - `NOTION_PAGE_ID` = the Page ID from Step 2
7. Your Worker URL will be: `https://finance-notion-sync.<your-subdomain>.workers.dev`

### Option B: Wrangler CLI

```bash
# Install wrangler
npm install -g wrangler

# Login
npx wrangler login

# From the cloudflare-worker/ directory:
cd cloudflare-worker

# Set secrets (you'll be prompted to enter the values)
npx wrangler secret put NOTION_TOKEN
npx wrangler secret put NOTION_PAGE_ID

# Deploy
npx wrangler deploy
```

---

## Step 4 — Configure the app

1. Open the app → **⚙️ 設定** page
2. Paste your Worker URL into the **Cloudflare Worker URL** field
3. Click **儲存**
4. Click **🔌 測試連線** to verify everything works
5. Click **⬆ 上傳到 Notion** to do your first backup

---

## Free tier limits

- Cloudflare Workers: **100,000 requests/day** (free)
- Notion API: **3 requests/second** per integration (free)
- Both are more than sufficient for personal use.

---

## Security notes

- Your Notion API token is stored as a Cloudflare Worker secret — never exposed to the browser.
- The Worker URL acts as your personal access key. Keep it private.
- Data is stored in your own Notion workspace — Cloudflare never stores your financial data.
