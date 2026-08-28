# v0.5 資料庫升級

你的 `scores` 表已經有資料了，所以不要重建，用 ALTER 加欄位就好。

D1 → ink-scores → Console，**一次貼一行**執行：

```sql
ALTER TABLE scores ADD COLUMN mode TEXT NOT NULL DEFAULT 'timed';
```

```sql
DROP INDEX IF EXISTS idx_rank;
```

```sql
CREATE INDEX idx_rank ON scores (mode, survived DESC, kills DESC, id ASC);
```

驗證：

```sql
SELECT name, survived, mode FROM scores;
```

舊資料的 mode 會自動填 `timed`，也就是歸到五分鐘榜，這是對的。

做完再 `git push` 部署新版程式。順序不能反——先部署後改表的話，中間送出的成績會因為找不到 mode 欄位而失敗。
