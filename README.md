# 墨戰

五分鐘生存射擊。Cloudflare Worker 同時提供靜態頁面和排行榜 API,一次部署。

```
wrangler.jsonc        部署設定（要填 database_id）
src/index.js          Worker：/api/scores + 靜態資產轉發
public/index.html     遊戲本體，單一檔案無相依套件
public/_headers       快取規則，避免玩家拿到舊版 HTML
schema.sql            排行榜資料表
```

`public/` 底下的東西會直接由邊緣節點提供,其他路徑才進 Worker。

## 設定

**1. 填 database_id**

Cloudflare Dashboard → Storage & Databases → D1 → `ink-scores` → Overview,複製 Database ID,貼進 `wrangler.jsonc` 裡取代「貼上你的-database-id」。

**2. 建資料表**

D1 的 Console 分頁,一次貼一行執行:

```sql
DROP TABLE IF EXISTS scores;
```
```sql
CREATE TABLE scores (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, survived REAL NOT NULL, kills INTEGER NOT NULL, level INTEGER NOT NULL, won INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
```
```sql
CREATE INDEX idx_rank ON scores (survived DESC, kills DESC, id ASC);
```

（Console 會把多行壓成一行,`--` 註解會把後面整段吃掉,所以不要直接貼 `schema.sql`。那個檔案是給 `wrangler d1 execute` 用的。）

**3. Worker 專案設定**

Deploy command `npx wrangler deploy`、Root directory `/`,預設就對。D1 綁定寫在 `wrangler.jsonc` 裡,Dashboard 不用另外設。

## 更新流程

```bash
git add -A && git commit -m "調平衡" && git push
```

推上去自動重新部署。改遊戲時順手把 `public/index.html` 裡的 `VER` 常數往上加,右下角會顯示,玩家回報 bug 時才知道在講哪一版。

## 本機開發

```bash
npx wrangler dev
```

會連到遠端的 D1,排行榜在本機就能測。

## 排行榜行為

- 依撐住的秒數排序,同秒數比化開的墨數量
- 只保留前 500 筆
- 名號上限 8 字,空白填「無名氏」
- 伺服器擋掉:撐不到 3 秒、每秒殺超過 30 隻、等級高於擊殺數

## 關於防作弊

分數是瀏覽器算完送出的,擋不住認真的人——開 DevTools 就能 POST 任意數字。上面的檢查只擋隨手亂試。

真要防,得讓客戶端送整局的輸入序列,Worker 用同一份確定性邏輯重播驗算。工程量不小,等真的有人來刷再說。
