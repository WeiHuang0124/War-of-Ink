# 墨戰

五分鐘生存射擊,另有無盡模式。Cloudflare Worker 同時提供靜態頁面和排行榜 API,一次部署。

## v0.6

- 場外修行：每場結束換「筆意」,可永久加點(底墨/開鋒/疾步/廣納/重抽/護心/先機),存在瀏覽器 localStorage
- 添筆時可重抽卡片,次數來自修行的「重抽」
- 厚印每級在印章外包一層甲,兩級起加鉚釘,四級起加金邊
- 厚印與滋潤回血都有苔綠的上飄墨點
- 透紙穿透時在敵人身上畫出貫穿裂口
- 迴筆改成線段判定,筆身隨等級變長變粗(1級39px → 4級90px),傷害同步成長

## v0.5

- 起手射速放慢,前期更吃走位
- 左上角加了潑墨的冷卻讀取盤
- 潑墨改成印章躍起砸地,落地震螢幕、炸雙圈朱墨
- 新增無盡模式,難度持續爬升,墨王越來越密
- 墨王從一種變四種:巨墨(放射彈)、飛白(死後裂成八隻)、枯筆(不停催生小墨)、硯獸(蓄力衝刺)
- 排行榜依模式分成兩個榜

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
