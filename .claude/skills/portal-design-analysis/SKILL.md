---
name: portal-design-analysis
description: 依 AI Surface Library 規範分析 AI portal 的桌面截圖，產出可追溯到指標、證據等級與位置的 Design analysis。使用者提供 portal 桌面截圖並要求 design analysis、跑規範、或比較不同週次截圖時使用。
version: 1.3
---

# AI Portal 桌面截圖 Design Analysis 規範

## 0. 輸出語言：一律英文

本規範說明文字是中文，但**分析產出的所有內容一律用英文**，不受以下因素影響：

- 對話或 Project 的語言設定（例如在要求繁體中文回覆的 Project 裡執行時，分析本身仍是英文；只有分析以外的對話說明可以用對話語言）
- portal 介面本身的語言（例如 Kimi、Qwen、DeepSeek 的中文介面）
- 截圖者補充情境（輸入第 5 項）使用的語言

範圍包含：公開摘要 `summary`、`summary_sentences`、JSON 所有字串值（`value`、`note`、`status_reason`、`context` 各欄位的說明與 `notes`）。

介面上的非英文文字（placeholder、建議 prompt、問候語、限制聲明等）處理方式：

- JSON 的 `value` 寫英文翻譯，並加上語言標註，例如 `"Ask me anything (translated from Chinese)"`。原文只可放在同一指標的 `original_text` 欄位，供比對用，網站不顯示。
- 公開摘要只寫英文描述，不出現非拉丁字母，例如 "The interface is in Chinese."
- 第 2 節排除區的內容，翻譯與原文都不得記錄。

## 1. 目的與範圍

本規範把一張 AI portal 登入後的**桌面版截圖**轉成一組可重複、可比較的觀察指標，再由指標產生一段公開顯示的英文摘要。

範圍限制：

- 只分析桌面截圖（1280×800 viewport、縮放比 1、僅首屏、不捲動）。mobile 截圖不分析，也不從桌面版推論行動版。
- 只使用兩種證據：**E1**（對截圖做像素取樣或計算）與 **E2**（看圖觀察）。
- 不做任何需要網頁結構（E3：DOM、computed style、accessibility tree）或使用行為資料（E4：分析數據、易用性測試、眼動追蹤）才能成立的結論。

## 2. 隱私：排除區（最高優先，任何其他規則都不能覆蓋）

截圖來自截圖者本人登入的帳號，畫面上會有個人與組織資訊。分析**完全迴避**這些內容：不引用、不翻譯、不描述、不計數、不比較。

### 2.1 什麼屬於排除區

- **帳號資訊**：姓名、大頭照（照片或縮寫字母）、email、使用者名稱、組織或公司名稱、租戶名稱。
- **帳號專屬清單**：對話或聊天標題、專案、資料夾、自訂 GPT／Gem／agent、釘選項目、組織建立或共用的 agent、共用空間、最近檔案。
- **主內容區中的個人資訊**：例如問候語裡的名字、個人化推薦中出現的人名或文件名。

判別原則：所有帳號都會看到的產品固定導覽（例如 New chat、Search、Library）**不屬於**排除區；無法確定某項是產品內建還是帳號專屬時，**一律視為排除區**。

### 2.2 怎麼處理

| 情況 | 處理方式 |
|---|---|
| 排除區整塊（例如帳號區、agent 清單） | 只能在 L1 記錄它存在與 bbox，名稱固定寫 `account-specific area (excluded)`。不描述內容、外觀、圖示、顏色或項目數 |
| 主內容區文字裡混有個人資訊 | 以 `[name]`、`[file]` 等代稱取代後再翻譯記錄，例如 `"Good morning, [name] (translated from Chinese)"`；`original_text` 也同樣以代稱取代 |
| 各指標的取樣與計數（C1–C4、H1、L4、D3、D5 等） | 一律跳過排除區，不從排除區取樣、不把排除區元素列入名次或計數 |
| 跨週像素比對發現排除區有變動 | 只設 `excluded_region_changed: true`，不列位置、不描述 |
| 公開摘要 | 完全不提排除區的存在、內容或變動 |
| 唯一例外 | 帳號區中的帳號類型標籤（例如 Work、School）與方案字樣（例如 Premium），可記錄在 `context.account_type` 與 `context.plan_tier_visible`，只供跨週比較判斷干擾用，不得出現在摘要 |

### 2.3 隱私旗標

若截圖中出現排除區內容，`context.privacy_flag` 設為 `true`（不附任何細節）。這是給截圖者的提醒：截圖本身是公開的，可能需要重截或換帳號。分析規範只能保證**分析內容**不含這些資訊，無法處理截圖本身。

## 3. 輸入資料

必要：

1. 桌面截圖 PNG
2. portal 名稱、公司、slug
3. 截圖週次（YYYY-MM-DD）

選填：

4. 同一 portal 前一週的分析 JSON（用於第 9 節比較）
5. 截圖者補充的情境（例如「這週有關掉 cookie banner」「用的是免費方案帳號」）
6. 同一 portal 前一週的桌面截圖 PNG（用於第 9.2 節像素比對）

## 4. 執行環境

- **能執行程式時**（例如 Claude 的 code execution）：E1 指標用 Python（PIL / numpy / scipy）實際取樣計算，並在輸出中附取樣座標與 hex 值。
- **不能執行程式時**：所有 E1 指標的 `value` 一律填 `"not_measured"`，第 9.2 節像素比對略過。**禁止目測估計顏色、對比比值或精確像素值。**

## 5. 前置檢查（Step 0）

依序檢查，任一項不通過就停止分析，輸出 `status: "not_analyzable"` 與原因：

1. 圖片尺寸：預期 1280×800。若為 2560×1600 等整數倍，換算 `scale = width / 1280`，所有像素量測除以 scale 後再報。若比例不是 16:10 或無法判斷 scale，所有尺寸類指標（L2、H2、H3、C5 字高、D4）填 `not_measured`，其餘照做。
2. 是否為登入後介面：畫面主體是 landing page、登入表單或錯誤頁 → 不可分析。
3. 是否有遮擋主內容的彈窗、onboarding 或 cookie banner：遮擋主輸入區 → 不可分析；只遮擋邊角 → 可分析，但在 context 記錄。
4. 標出排除區（第 2 節），後續所有步驟都跳過這些區域。

## 6. 記錄截圖變因（Step 1）

填入 `context`，這些不是設計本身，而是會讓畫面改變的外部因素：

| 欄位 | 值 | 說明 |
|---|---|---|
| `color_scheme` | `light` / `dark` | 依背景主色判斷 |
| `modal_present` | `none` / `partial` | Step 0 已排除完全遮擋 |
| `account_type` | `personal` / `work` / `school` / `unknown` | 只依畫面上明示的標籤判斷，例如 "Work" 字樣；不寫組織名稱 |
| `plan_tier_visible` | 畫面上看到的方案字樣（英文），否則 `unknown` | 例如 "Plus"、"Premium"、"Upgrade"；不寫組織名稱 |
| `personalized_content` | `true` / `false` | 主內容區是否有個人化內容（排除區以外）。只寫類型，例如 "greeting includes [name]" |
| `time_dependent_content` | `true` / `false` + 簡述 | 例如早安／晚安問候。問候語是否會輪換無法從單張截圖判斷，不在此猜測 |
| `hover_or_focus_visible` | `true` / `false` + 元件類型 | 某元件呈現亮起、底色或外框，而且不像是「目前選取」的狀態（例如游標停在某個圖示上）。只寫元件類型，例如 "sidebar toggle icon"；信心通常為 `low` |
| `ui_language` | 語言代碼 | 依介面文字判斷 |
| `privacy_flag` | `true` / `false` | 見第 2.3 節 |
| `notes` | 截圖者補充情境 | 輸入第 5 項，翻成英文；含個人資訊時依第 2 節以代稱取代 |

## 7. 指標（Step 2–5）

每個指標輸出一筆紀錄，欄位見第 10 節。`evidence` 必須是 `E1` 或 `E2`。座標一律用 `[x, y, w, h]`，以 CSS 像素計、取整到 10。所有指標都跳過第 2 節排除區。

**無文字標籤的圖示**：只描述形狀與位置（例如 "shield-shaped icon, top right"），不推測功能或意義。

### 7.1 版面（Layout）

| ID | 觀察項目 | 做法 | 判讀 | 證據 |
|---|---|---|---|---|
| L1 | 區域結構 | 列出可見區域：側欄、頂列、主內容、輸入區、頁尾、排除區，各給 bbox | 只描述；排除區依第 2.2 節命名 | E2 |
| L2 | 側欄寬度佔比 | 側欄寬 ÷ 1280，報百分比取整；無側欄報 0% | 只描述 | E1（有程式時量側欄邊界）或 E2 |
| L3 | 主輸入區位置 | 輸入框中心點 (x, y)；落在垂直上／中／下三等分哪段；中心點與主內容區中線差 ≤ 20px 為水平置中 | 只描述 | E2 |
| L4 | 可互動元素數 | 分區計數可辨識的按鈕、icon 按鈕、連結、chip、輸入框。hover 才出現的控制項不算；排除區內的元素不算 | 只描述；註明「近似計數，誤差約 ±2，不含排除區」 | E2 |
| L5 | 視覺雜亂度（選用） | 以 Aalto Interface Metrics 或 Feature Congestion 計算，排除區先以背景色遮蓋 | 只用於同 portal 跨週相對比較，不做絕對判斷 | E1 |

### 7.2 視覺層級（Visual hierarchy）

| ID | 觀察項目 | 做法 | 判讀 | 證據 |
|---|---|---|---|---|
| H1 | 視覺權重最高的前 3 個元素 | 依相對尺寸、對周邊的相對對比、飽和度、周圍留白排序；可互動與非互動元素都列入 | 三個名次的依據數值（尺寸、面積佔比、對比比值）並列寫出，讓讀者能自行比較；沒有數值可引用時信心標 `low` | E2 |
| H2 | 主輸入區面積佔比 | 輸入框 w×h ÷ (1280×800)，百分比取到小數一位 | 只描述 | E1 或 E2 |
| H3 | 字級層級數 | 量可見文字字高並估算字級（見 7.6 節），估算字級差 ≥ 2px 視為不同層級 | 只描述；`note` 寫明量測的是哪種文字（Latin / CJK / 其他） | E2 |

### 7.3 色彩與字體（Colour & typography）

| ID | 觀察項目 | 做法 | 判讀 | 證據 |
|---|---|---|---|---|
| C1 | 主色盤 | 取樣主背景、主要文字、次要文字、強調色（如送出按鈕填色）的 hex，附取樣座標 | 只描述 | E1 |
| C2 | 主要內文對比 | 主內容區最大量的內文文字 vs 其背景，用 7.5 節公式 | 一般文字 ≥ 4.5 → `approx_pass`；大字（估算字級 ≥ 24px，或 ≥ 18.66px 粗體）≥ 3 → `approx_pass`；否則 `approx_fail` | E1 |
| C3 | 最低對比文字 | 在 placeholder、次要文字、區段標籤、聲明文字中找對比最低者並計算。logo、純裝飾文字、排除區文字不列入 | 同 C2 | E1 |
| C4 | 非文字對比 | 對主輸入框與送出按鈕（若可見）分別量：(1) 邊框或填色 vs 相鄰背景；(2) 是否有其他可辨識線索：元件內文字（例如 placeholder）對比 ≥ 4.5，或填色與背景對比 ≥ 3 | (1) ≥ 3 → `approx_pass`；(1) < 3 但 (2) 成立 → `approx_unclear`，`note` 寫明「邊界本身不足 3:1，但可由某線索辨識；是否符合需看實際樣式判定」；(1)(2) 都不成立 → `approx_fail`。`note` 另註明「反鋸齒可能使取樣色偏淡」 | E1 |
| C5 | 字體分類與字級 | 無襯線／襯線／等寬；內文與最大標題的估算字級（px） | 字體名稱除非畫面上有文字明示，否則填 `cannot_determine` | E2 |

### 7.4 主要動作引導（Primary action，含 Human-AI Interaction G1／G2）

| ID | 觀察項目 | 做法 | 判讀 | 證據 |
|---|---|---|---|---|
| D1 | 主要動作識別 | 指出畫面上最像主要動作的元素（通常為 prompt 輸入框） | 有多個候選時全部列出，信心標 `low` | E2 |
| D2 | 主要動作顯著度 | 彙整：D1 在 H1 的名次、H2 面積、C4 結果 | D1 不在 H1 第 1 名時，寫出排在它前面的元素與依據 | E2 |
| D3 | 競爭元素數 | 主內容區中**可互動**、且視覺權重與 D1 相當或更高的元素數（實心填色按鈕、大型卡片、橫幅）。非互動元素不算，交由 H1、D2 處理 | 只描述 | E2 |
| D4 | 輸入區控制項可見尺寸 | 量輸入框內部及緊鄰的所有控制項（新增、附件、麥克風、語音、送出等）的可見 w×h（px） | 任一邊 < 24px 的控制項，`note` 寫「可見尺寸小於 24px，實際點擊區未知」；送出按鈕不可見時寫 "No send button visible in this state; it may appear after typing, which a screenshot cannot show." 不判定通過與否 | E1（程式量邊界）或 E2 |
| D5 | 能力提示（G1：讓使用者知道系統能做什麼） | 記錄：placeholder、建議 prompt／chip 數量與短文字、工具或模式切換、模型選擇器、上傳入口。排除區清單（自訂 agent、釘選項目等）不列入 | 記錄有無、數量、短文字（每則 ≤ 10 字，非英文依第 0 節翻譯）；不評價內容好壞 | E2 |
| D6 | 限制聲明（G2：讓使用者知道系統多常出錯） | 是否可見「可能出錯」類文字；位置（輸入框下方／頁尾／無） | 記錄有無、位置、短文字（非英文依第 0 節翻譯）；對比引用 C3（若 C3 就是它） | E2 |
| D7 | 主標題／問候語 | 記錄主內容區最大標題或問候語的文字（英文翻譯，個人資訊以代稱取代），以及它是否提示一個具體任務（例如「試著要我回顧會議」） | `value` 寫翻譯文字；`suggests_task` 為 `true` / `false` | E2 |

### 7.5 對比計算（C2–C4 共用）

1. **背景色**：取文字 bbox 外擴 4px 的外環像素，取中位數。
2. **文字色**：取 bbox 內與背景色亮度差最大的前 5% 像素，取中位數（避開反鋸齒邊緣）。
3. **相對亮度**：每個 sRGB 通道 `c = v / 255`；`c ≤ 0.04045` 時 `c / 12.92`，否則 `((c + 0.055) / 1.055) ^ 2.4`；`L = 0.2126R + 0.7152G + 0.0722B`。
4. **對比比值**：`(L_亮 + 0.05) / (L_暗 + 0.05)`，報到小數一位，不四捨五入進門檻（4.47 報 4.4，不算達標）。
5. 輸出附上 `samples: { "foreground": "#hex", "background": "#hex" }` 與 bbox。

### 7.6 字級估算（H3、C2 大字判定、C5 共用）

截圖量得的是字形高度，不是 CSS font-size，兩者換算因文字種類而異：

- **Latin**：量大寫字母高度（cap height），估算字級 ≈ 大寫高度 ÷ 0.7。
- **CJK**（中日韓）：量漢字字形高度，估算字級 ≈ 字形高度 ÷ 0.9。
- 其他文字：記錄字形高度，字級填 `cannot_determine`。

結果一律標為估算值，`evidence` 為 E2。估算字級剛好落在大字門檻附近（±2px）時，C2 以一般文字門檻（4.5）判定，並在 `note` 說明。

## 8. 禁止的推論與改寫

分析與摘要中**不得出現**下列類型的句子。遇到時依右欄改寫，改寫不了就刪除。

| 禁止類型 | 例子 | 改寫方向 |
|---|---|---|
| 易用性判斷 | user-friendly、easy to use、intuitive | 改成具體觀察，例如「主內容區僅有輸入框與 4 個建議 chip」 |
| 使用者行為預測 | users will quickly find…、draws the user's eye first | 改成可觀察的描述；JSON `note` 寫 "Prompt input covers 7.2% of the viewport, highest visual weight on screen."，頁面摘要寫 "The message box is the largest item on the screen." |
| 設計意圖與效果 | designed to encourage…、effective、successfully guides | 刪除 |
| 轉換或商業結果 | improves engagement、drives conversion | 刪除 |
| 未量測的可讀性結論 | font size could be improved for readability | 只報 C2、C3、C5 的數值與門檻結果 |
| 行動版推論 | on mobile this would… | 刪除 |
| 通用評語 | well-structured、clean and modern、simple yet effective | 刪除，或換成 L1、C5 的具體描述 |
| 錯誤元件名稱 | 把聊天輸入框叫 search bar、把登入後介面叫 landing page | 用 prompt input、logged-in home screen |
| 圖示意義推測 | the shield icon shows data is protected | 只描述形狀與位置 |
| 把變動說成改版 | Copilot redesigned its greeting、updated the sidebar | 用中性字眼：the greeting text differs from… |

## 9. 跨週比較（Step 6）

只在輸入第 4 項（前一週 JSON）存在時執行。

### 9.1 可比較前提與干擾判定

**前提**：兩週的 viewport、scale、`color_scheme`、`account_type` 相同，且 `modal_present` 皆非遮擋主內容。前提不成立 → 所有變動標 `confounded`，只列出不做解讀。

**干擾判定**：下列 context 欄位若與前一週不同，對應指標的變動標 `possibly_confounded`：

| context 欄位不同 | 受影響指標 |
|---|---|
| `plan_tier_visible` | L1、L4、D3、D4、D5、D6 |
| `personalized_content` | H1、D7 |
| `time_dependent_content` | H1、H3、D7 |
| `ui_language` | H3、C5、D5、D6、D7 |
| `hover_or_focus_visible` | C1，以及與該元件重疊的所有指標 |

**問候語輪換**：D7 文字改變一律標 `possibly_confounded`，`note` 寫 "Greetings may rotate between visits; a single screenshot cannot rule this out."

### 9.2 像素比對（有前一週 PNG 且能執行程式時）

1. 兩張圖尺寸必須相同，否則略過本節。
2. 逐像素計算 RGB 差值總和，> 30 視為變動像素。
3. 變動像素以 12px 膨脹後取連通區域，每個區域記錄 bbox。
4. 每個區域：
   - 落在排除區內 → 只設 `excluded_region_changed: true`。
   - 與某指標的 bbox 重疊 → 歸入該指標，用於核對第 9.3 節的判定。
   - 對應不到任何指標 → 列入 `unmapped_changes`：`{ "location": [x,y,w,h], "description": "neutral English description" }`，描述只寫看得到的差異（例如 "icon is brighter"），不推測意義；若看起來像 hover，另標 `hover_or_focus_visible`。
5. `unmapped_changes` 是規範涵蓋不足的訊號，累積多次同類型時應回頭修改規範。

### 9.3 報告門檻

未達門檻的差異一律不報：

| 指標 | 視為變動的條件 |
|---|---|
| L1 | 區域新增、消失，或 bbox 任一邊變動 ≥ 40px（排除區內部變動不算） |
| L2 | 差 ≥ 5 個百分點 |
| L3 | 垂直三等分落段改變，或水平置中與否改變 |
| L4 | 任一分區差 ≥ 3 |
| H1 | 前 3 名的元素或順序改變 |
| H2 | 差 ≥ 1.0 個百分點 |
| C2–C4 | 判定結果改變，或比值差 ≥ 0.5 |
| C1 | 任一取樣色的 RGB 通道差 ≥ 16 |
| D3、D5 數量 | 數量改變 |
| D5 文字、D6、D7 | 有無、位置或文字改變 |

每筆變動輸出：`{ "id", "previous", "current", "status": "changed" | "possibly_confounded" | "confounded", "note" }`。沒有達門檻的變動時，`changes_vs_previous` 為空陣列。

## 10. 輸出格式（Step 7）

輸出兩部分，順序固定：先 JSON，再摘要。

### 10.1 JSON

```json
{
  "guideline_version": "1.3",
  "portal": "example",
  "week": "2026-09-21",
  "variant": "desktop",
  "viewport": "1280x800",
  "scope": "first screen only, single logged-in account",
  "status": "ok",
  "status_reason": null,
  "e1_available": true,
  "context": {
    "color_scheme": "light",
    "modal_present": "none",
    "account_type": "personal",
    "plan_tier_visible": "unknown",
    "personalized_content": { "value": false, "note": "" },
    "time_dependent_content": { "value": false, "note": "" },
    "hover_or_focus_visible": { "value": false, "note": "" },
    "ui_language": "en",
    "privacy_flag": true,
    "notes": ""
  },
  "metrics": [
    {
      "id": "C2",
      "value": "15.3:1",
      "result": "approx_pass",
      "evidence": "E1",
      "location": [420, 300, 440, 20],
      "samples": { "foreground": "#1F1F1F", "background": "#FFFFFF" },
      "confidence": "high",
      "note": ""
    }
  ],
  "changes_vs_previous": [],
  "excluded_region_changed": false,
  "unmapped_changes": [],
  "summary_sentences": [
    { "text": "...", "sources": ["L1"] }
  ],
  "summary": "..."
}
```

欄位規則：

- `value`：數值、英文描述字串，或 `"not_measured"` / `"cannot_determine"`。
- `original_text`：選填，僅在介面文字非英文時使用，存原文（個人資訊以代稱取代；排除區內容不得存）；網站不顯示。
- 所有字串值（含 `note`）一律英文，見第 0 節。
- `result`：僅 C2、C3、C4 使用，值為 `approx_pass` / `approx_unclear`（僅 C4）/ `approx_fail` / `null`。
- `confidence`：
  - `high`：E1 實際量測，或 E2 中清晰可讀的文字與明確存在的元素
  - `medium`：E2 觀察，有輕微模糊（元素小、部分被裁切、類別可能有兩種解讀）
  - `low`：E2 觀察，依據不足或有多種合理解讀
- 每個指標都要輸出，量不到就填 `not_measured` 並在 `note` 說明原因。
- `excluded_region_changed`、`unmapped_changes` 只在執行第 9.2 節時填寫，否則為 `null`。

### 10.2 公開摘要（summary）— 必須是 plain English

摘要會直接顯示在公開網站上，讀者不一定懂設計或無障礙術語。所以摘要只負責「好讀」，追溯資訊全部放在 JSON 的 `summary_sentences` 裡，不出現在頁面文字中。

**寫作規則**

- 英文，5 到 8 句短句；有跨週比較時可再加 1 句比較句。每句不超過 20 個字，一句只講一件事。
- 用日常用字，目標是一般國中生讀得懂。不用分號、不用括號裡再塞說明。
- 第一句固定：`This shows the desktop version of {portal name} for the week of {week}, before scrolling.`
- 之後依序涵蓋：整體版面、畫面上最顯眼的東西、文字與顏色、使用者從哪裡開始（含問候語、建議提示與「可能出錯」聲明）；有比較結果時最後一句寫變動。
- 只能使用 JSON 中已存在的數值與觀察，不得新增資訊。數字可以保留，但要換成一般人懂的說法（見下表）。
- 比較句只能根據 `changes_vs_previous`：`changed` 可以寫；`possibly_confounded` 只能用中性字眼寫（"differs from"），不得寫成改版；`confounded` 不寫。完全沒有變動時寫 "The main screen looks the same as the week of {previous week}."
- **頁面文字中不得出現**：指標 ID（L1、H2、C4…）、證據等級（E1、E2）、`approx_pass` 等欄位值、WCAG 條文編號、座標、hex 色碼、下表左欄的術語、以及第 2 節排除區的任何資訊（包括它的存在）。
- E1 未量測時寫：`Text and background colors were not measured for this capture.`
- C4 為 `approx_unclear` 時寫成 "The outline of the message box is faint, but the hint text inside it is easy to read." 這類中性描述，不說達標或未達標。
- 不得出現第 8 節任何禁止類型。

**術語改寫對照**

| 不要寫 | 改寫成 |
|---|---|
| viewport、first screen / above the fold | the screen, what you see before scrolling |
| prompt input、input field | the message box |
| CTA、primary action | the main thing to do, where you start |
| visual hierarchy、visual weight | what stands out most |
| sidebar occupies 20% of viewport width | the sidebar takes up about a fifth of the screen width |
| contrast ratio 15.3:1, approx_pass | the text is dark enough against the background to meet a common accessibility guideline |
| contrast ratio 3.9:1, approx_fail | this text is lighter than a common accessibility guideline recommends |
| non-text contrast of the input border | the outline of the message box is easy / hard to see |
| sans-serif typeface、type scale with 4 levels | a plain, modern font in four sizes |
| suggestion chips、capability hints | suggested prompts, buttons that show what it can do |
| error disclaimer | a note that it can make mistakes |
| visible target size 20×20px | the send button is small (about 20 pixels wide) |

**追溯欄位**：JSON 另外輸出 `summary_sentences`，每句一筆，記錄它依據哪些指標：

```json
"summary_sentences": [
  { "text": "The message box is the largest item on the screen.", "sources": ["H1", "H2"] },
  { "text": "Its outline is easy to see against the background.", "sources": ["C4"] }
]
```

`summary` 欄位就是這些句子依序串接的結果，網站只顯示 `summary`。

## 11. 自我檢查（輸出前逐項確認）

0. **排除區**：分析與摘要中沒有姓名、大頭照描述、email、組織名稱、對話標題、自訂或組織內部 agent 名稱、釘選項目名稱；`original_text` 也沒有。摘要沒有提到排除區。
1. 所有輸出內容都是英文（`original_text` 除外），即使對話語言、portal 介面語言或補充情境不是英文。
2. 每個指標都有紀錄，且 `evidence` 只有 E1 或 E2。
3. 沒有程式能力時，E1 指標全部是 `not_measured`，沒有任何估計的 hex 或比值。
4. H1 三個名次的依據數值都並列寫出，或標 `low`。
5. `summary_sentences` 每句都有 `sources`，且句中數值與 JSON 一致；頁面摘要中沒有指標 ID、E1／E2、欄位值、hex、座標或 10.2 對照表左欄的術語，每句不超過 20 字。
6. 摘要與 note 中沒有第 8 節的禁止類型，無標籤圖示沒有被賦予意義。
7. 有前一週資料時，每筆變動都達第 9.3 節門檻，干擾判定與問候語輪換規則已套用。

## Repo integration

本節只說明在 ai-time-machine repo 中的執行方式，不改變上述任何規則。

- E1 量測改用 `scripts/local-capture/analysis/measure.mjs`（`size`、`color`、`contrast`、`pair`、`diff`），取代第 4 節的 Python；方法與第 7.5、9.2 節相同。
- 流程：
  1. `node analysis/prepare.mjs <slug> [week]`：下載本週與前一週桌面截圖、前一週分析 JSON 到 `analysis/work/<slug>/<week>/`。
  2. 依本規範分析，把 JSON 寫成同一資料夾的 `analysis.json`。
  3. `node analysis/publish.mjs <slug> <week>`：本機驗證與隱私詞檢查（`analysis/private-terms.txt`）後上傳；網站只顯示 `summary`。
