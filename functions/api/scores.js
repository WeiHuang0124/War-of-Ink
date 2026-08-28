// /api/scores  —  Cloudflare Pages Function
// GET  → 取前 20 名
// POST → 送出一筆成績，回傳最新榜單
//
// 需要在 Pages 專案綁一個名為 DB 的 D1 資料庫。

const TOP_N = 20;      // 榜單顯示幾筆
const KEEP  = 500;     // 資料表最多保留幾筆
const GOAL  = 300;     // 遊戲長度（秒），伺服器端的硬上限

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });

async function fetchTop(db) {
  const { results } = await db
    .prepare(
      `SELECT id, name, survived, kills, level, won
         FROM scores
        ORDER BY survived DESC, kills DESC, id ASC
        LIMIT ?`
    )
    .bind(TOP_N)
    .all();
  return results ?? [];
}

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ ok: false, error: '資料庫尚未綁定' }, 500);
  try {
    return json({ ok: true, top: await fetchTop(env.DB) });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: '資料庫尚未綁定' }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: '格式錯誤' }, 400);
  }

  // ── 名號：去掉控制字元、限長、空白就給預設 ──
  let name = String(body.name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 8);
  if (!name) name = '無名氏';

  // ── 數值：夾在合理範圍內，順便擋掉明顯造假 ──
  const num = (v, lo, hi) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
  };
  const survived = num(body.survived, 0, GOAL);
  const kills = Math.round(num(body.kills, 0, 8000));
  const level = Math.round(num(body.level, 1, 90));
  const won = survived >= GOAL - 0.5 ? 1 : 0;

  // 合理性：每秒殺不了 30 隻，等級也不可能高於撿到的墨珠數
  if (kills > survived * 30 + 20) return json({ ok: false, error: '成績不合理' }, 422);
  if (level > kills + 2) return json({ ok: false, error: '成績不合理' }, 422);
  if (survived < 3) return json({ ok: false, error: '太短了，不收' }, 422);

  try {
    const ins = await env.DB
      .prepare(
        `INSERT INTO scores (name, survived, kills, level, won, created)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(name, survived, kills, level, won, Date.now())
      .run();

    // 只留前 KEEP 名，資料表不會無限長大
    await env.DB
      .prepare(
        `DELETE FROM scores
          WHERE id NOT IN (
            SELECT id FROM scores
             ORDER BY survived DESC, kills DESC, id ASC
             LIMIT ?
          )`
      )
      .bind(KEEP)
      .run();

    return json({
      ok: true,
      id: ins.meta?.last_row_id ?? null,
      top: await fetchTop(env.DB)
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}
