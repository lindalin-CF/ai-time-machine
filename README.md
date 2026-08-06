# AI Portal Screenshot Library

每週自動蒐集各家 AI / LLM portal 首頁截圖的 **UI 靈感庫**，用 KUMO 設計語言呈現，
整套跑在 **Cloudflare Workers** 上。每個星期一，一台無頭瀏覽器會造訪清單上的每個 AI portal、
擷取首頁、存檔、抽出品牌色票，再用視覺模型寫一段設計短評。

> 概念沿用自舊 repo `linda-in-design-resume`，但這是一份乾淨重建版：拿掉不相關檔案、
> 改用 KUMO 視覺、並把後端接上完整的 Cloudflare 產品。

---

## 這個專案用到的 Cloudflare 產品

| 產品 | 在這裡的角色 |
|---|---|
| **Workers** | 應用主體：HTTP 路由、每週 cron、Workflow / Queue 進入點（也是最終部署目標） |
| **Static Assets** | 提供 KUMO 風格前端 gallery（`public/`） |
| **Browser Rendering** | 無頭 Chromium，實際去各 portal 擷取首頁截圖 |
| **R2** | 存截圖 PNG（`shots/<week>/<slug>.png`） |
| **D1** | 存 portal 清單、每週資料、每張截圖的中繼資料（色票、分析、尺寸） |
| **KV** | 快取 API 回應（預設 300 秒），首頁載入更快 |
| **Workers AI** | 視覺模型（`@cf/meta/llama-3.2-11b-vision-instruct`）為每張截圖寫設計分析 |
| **Workflows** | 每週擷取流程的持久化編排：可逐步重試、逐 portal 進行 |
| **Queues** | 一個 portal 一則訊息，失敗自動重試，另接死信佇列（DLQ） |
| **Cron Triggers** | 每週一 09:00 UTC 自動觸發擷取 |

---

## 運作流程

```
Cron（每週一 09:00 UTC）
   └─> CAPTURE_WORKFLOW（Workflows）
          ├─ step: 準備當週 + 讀取 portal 清單（D1）
          ├─ step: 每個 portal 送一則訊息到 CAPTURE_QUEUE（Queues）
          └─ step: 等待後回寫當週完成數（D1）

Queue consumer（每則訊息 = 擷取一個 portal）
   └─> capturePortal()
          ├─ Browser Rendering 擷取截圖
          ├─ 存進 R2
          ├─ Workers AI 產生設計分析
          ├─ 寫入 D1
          └─ 清掉 KV 快取
```

前端（Static Assets）只讀 `/api/*`，資料來自 D1（經 KV 快取）。
截圖圖片透過 `/img/*` 直接從 R2 串流。

---

## 專案結構

```
ai-portal-library/
├─ wrangler.jsonc        # 正式設定（含全部 binding）— 部署用這個
├─ wrangler.dev.jsonc    # 本機預覽用（拿掉 AI binding，見下方說明）
├─ schema.sql            # D1 資料表結構
├─ seed.sql              # 由 scripts/gen-seed.mjs 產生的種子資料（17 個 portal + 範例週）
├─ scripts/gen-seed.mjs  # 從原始 manifest 產生 seed.sql
├─ public/               # 前端（KUMO gallery）
│  ├─ index.html
│  ├─ styles.css
│  ├─ app.js
│  └─ samples/*.svg      # 首次真正擷取前，先用這些範例圖佔位
└─ src/                  # Worker 原始碼
   ├─ index.ts           # fetch / scheduled / queue 進入點
   ├─ api.ts             # /api/* 路由 + R2 圖片串流
   ├─ db.ts              # D1 查詢 + 色票工具
   ├─ capture.ts         # Browser Rendering + Workers AI + R2 擷取邏輯
   ├─ workflow.ts        # CaptureWorkflow（Workflows）
   └─ types.ts           # 共用型別 + Env binding
```

---

## 本機開發

```bash
npm install

# 建立本機 D1 + 灌入種子資料
npm run db:init:local
npm run seed:gen        # 重新產生 seed.sql（可選）
npm run seed:local

# 啟動本機預覽
npm run dev
```

> **注意：Workers AI 在本機 `wrangler dev` 會走遠端代理，需要登入（`wrangler login`）。**
> 若你只想快速預覽 gallery（不跑擷取），可以用不含 AI binding 的設定：
>
> ```bash
> npx wrangler dev -c wrangler.dev.jsonc --port 8787
> ```
>
> 這樣 D1 / KV / R2 / 前端都在本機跑，用種子資料就能看到完整畫面。

開啟後首頁會顯示 17 個 portal 的範例卡片（`BY SAMPLE`）。
真正的截圖會在第一次 cron 或手動觸發後才出現。

---

## 部署到 Cloudflare Workers

### 1. 先登入
```bash
npx wrangler login
```

### 2. 建立各項資源
```bash
# D1
npx wrangler d1 create ai-portal-library

# KV
npx wrangler kv namespace create CACHE

# R2
npx wrangler r2 bucket create ai-portal-shots

# Queues（主佇列 + 死信佇列）
npx wrangler queues create ai-portal-capture
npx wrangler queues create ai-portal-capture-dlq
```

### 3. 把回傳的 ID 填進 `wrangler.jsonc`
- `d1_databases[0].database_id` ← 換掉 `REPLACE_WITH_YOUR_D1_DATABASE_ID`
- `kv_namespaces[0].id` ← 換掉 `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`

### 4. 建立正式 D1 結構 + 種子資料
```bash
npm run db:init:remote
npm run seed:remote
```

### 5. 部署
```bash
npm run deploy
```

Browser Rendering、Workers AI、Workflows、Queues 這些 binding 在部署時會自動掛上，
不需要額外開資源。部署後每週一 09:00 UTC 就會自動擷取。

### 6. Workers AI 一次性授權（重要）

Meta 的視覺模型（Llama 3.2 Vision）第一次使用前，需要對你的帳號同意一次授權，
否則設計分析會全部退回預設文字。部署後先打一次：

```bash
curl -X POST https://<your-worker>.workers.dev/api/ai/agree
```

回傳 `{"agreed":true,...}` 即可。（程式也內建自動同意，但手動打一次最保險。）

### 7.（可選）手動先跑一次擷取
```bash
curl -X POST https://<your-worker>.workers.dev/api/capture/run
```

---

## 重跑單一 / 指定 portal

某個 portal 擷取失敗（例如需要登入或載入超時）時，可以只重跑它，不必整批重來：

```bash
# 單一
curl -X POST https://<your-worker>.workers.dev/api/capture/portal \
  -H 'content-type: application/json' -d '{"slug":"gemini"}'

# 多個
curl -X POST https://<your-worker>.workers.dev/api/capture/portal \
  -H 'content-type: application/json' -d '{"slugs":["gemini","you"]}'
```

省略 `week` 時預設為本週。這條路徑會把工作丟進同一個 Queue，走一樣的
Browser Rendering → R2 → Workers AI → D1 流程（含自動重試）。

## 管理 portal 清單

清單存在 D1 的 `portals` 資料表。新增或移除只要改資料庫即可，不用改程式：

```bash
# 新增一個 portal
npx wrangler d1 execute ai-portal-library --remote --command \
  "INSERT INTO portals (slug,name,company,url,brand,wait_for,full_page,active,sort_order)
   VALUES ('newbot','New Bot','Some Co','https://example.com/','#ff6633',4000,1,1,99);"

# 停用某個 portal（不會刪掉歷史截圖）
npx wrangler d1 execute ai-portal-library --remote --command \
  "UPDATE portals SET active=0 WHERE slug='newbot';"
```

`brand` 是品牌主色（hex），色票會自動從它推導。

---

## API

| 路由 | 說明 |
|---|---|
| `GET /api/stats` | 總截圖數、portal 數、週數 |
| `GET /api/portals` | portal 清單 |
| `GET /api/weeks` | 已封存的週次（新到舊） |
| `GET /api/captures?week=YYYY-MM-DD` | 指定週（省略則為最新週）的所有截圖 |
| `POST /api/capture/run` | 手動觸發一次擷取（body 可帶 `{ "week": "YYYY-MM-DD" }`） |
| `GET /img/<r2-key>` | 從 R2 串流截圖圖片 |

---

## 設計說明

視覺採用 Cloudflare 的 **KUMO** 設計語言（暖色編輯風）：
主色橘 `#ff6633`、暖棕文字、Kunst Grotesk 系字體、角落方塊與點陣底紋等品牌元素。
原始 sample 是深色版；此版重新以 KUMO 呈現。若之後想要深色模式，可再加上 KUMO 的 dark variant。
