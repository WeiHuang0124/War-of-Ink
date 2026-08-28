# 墨戰

五分鐘生存射擊。純靜態前端 + Cloudflare Pages Functions + D1 排行榜。

```
index.html               遊戲本體（單一檔案，無相依套件）
_headers                 快取規則，避免玩家拿到舊版 HTML
schema.sql               排行榜資料表
functions/api/scores.js  /api/scores 端點（GET 取榜、POST 上榜）
```

## 一次性設定

**1. 推上 GitHub**

```bash
git init
git add .
git commit -m "墨戰 v0.4"
git remote add origin git@github.com:<你的帳號>/<repo>.git
git push -u origin main
```

**2. 建 D1 資料庫**

```bash
npx wrangler login
npx wrangler d1 create ink-scores
npx wrangler d1 execute ink-scores --remote --file=./schema.sql
```

第二行會印出 database_id，先留著。

**3. 建 Pages 專案**

Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git，選這個 repo。

- Framework preset：**None**
- Build command：**留空**
- Build output directory：**/**

**4. 綁 D1**

Pages 專案 → Settings → Functions → D1 database bindings → Add：

- Variable name：**`DB`**（一定要叫這個，程式裡讀的是 `env.DB`）
- D1 database：選 `ink-scores`

Production 和 Preview 兩個環境都要各綁一次。綁完要**重新部署一次**才會生效——Dashboard → Deployments → 最新那筆 → Retry deployment。

## 之後的更新

```bash
# 改完 index.html
git add -A && git commit -m "調平衡" && git push
```

約 30 秒後自動上線。每筆部署都有獨立預覽網址，出事在 Deployments 頁面一鍵 Rollback。

改遊戲時記得同步把 `index.html` 裡的 `VER` 常數往上加，右下角會顯示，玩家回報 bug 時你才知道在講哪一版。

## 排行榜行為

- 依「撐住的秒數」排序，同秒數比「化開的墨」數量
- 資料表只保留前 500 筆，不會無限長大
- 名號上限 8 字，空白自動填「無名氏」
- 伺服器端擋掉明顯造假：撐不到 3 秒不收、每秒殺超過 30 隻不收、等級高於擊殺數不收

## 關於防作弊

分數是瀏覽器算完再送出的，所以**擋不住認真的人**——他打開 DevTools 就能直接 POST 任意數字。上面那些檢查只能擋隨手亂試的。

真的要防，唯一可靠的做法是伺服器重跑一遍：客戶端把整局的輸入序列（每幀的移動方向、升級選擇）送上去，Worker 用同一份確定性邏輯重播，算出來的分數對得上才收。工程量不小，等真的有人來刷再說。
