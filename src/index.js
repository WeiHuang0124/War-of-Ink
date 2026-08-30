// 墨戰 — Worker 進入點
//
// /api/scores  GET  → 取前 20 名
//              POST → 送出一筆成績，回傳最新榜單
// 其他路徑一律交給靜態資產（public/）。

const TOP_N = 20;   // 榜單抓幾筆
const KEEP  = 500;  // 資料表最多保留幾筆
const GOAL  = 300;   // 計時模式長度（秒）
const CAP   = 21600; // 無盡模式收到六小時為止

export { Room } from './room.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });

const MODES = ['timed', 'endless', 'rpg'];
const asMode = v => (MODES.includes(v) ? v : 'timed');

async function fetchTop(db, mode) {
  const { results } = await db
    .prepare(
      `SELECT id, name, survived, kills, level, won
         FROM scores
        WHERE mode = ?
        ORDER BY survived DESC, kills DESC, id ASC
        LIMIT ?`
    )
    .bind(mode, TOP_N)
    .all();
  return results ?? [];
}

async function handleGet(request, env) {
  const mode = asMode(new URL(request.url).searchParams.get('mode'));
  try {
    return json({ ok: true, mode, top: await fetchTop(env.DB, mode) });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

async function handlePost(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: '格式錯誤' }, 400);
  }

  // 名號：去掉控制字元、限長、空白給預設
  let name = String(body.name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 8);
  if (!name) name = '無名氏';

  // 數值：夾在合理範圍內
  const num = (v, lo, hi) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
  };
  const mode = asMode(body.mode);
  const survived = num(body.survived, 0, mode === 'timed' ? GOAL : CAP);
  const kills = Math.round(num(body.kills, 0, 400000));
  const level = Math.round(num(body.level, 1, 400));
  const won = mode === 'timed' && survived >= GOAL - 0.5 ? 1 : 0;

  // 合理性：擋掉隨手亂試的假成績
  if (survived < 3) return json({ ok: false, error: '太短了，不收' }, 422);
  if (kills > survived * 30 + 20) return json({ ok: false, error: '成績不合理' }, 422);
  if (level > kills + 2) return json({ ok: false, error: '成績不合理' }, 422);

  try {
    const ins = await env.DB
      .prepare(
        `INSERT INTO scores (name, survived, kills, level, won, created, mode)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(name, survived, kills, level, won, Date.now(), mode)
      .run();

    // 只留前 KEEP 名，資料表不會無限長大
    await env.DB
      .prepare(
        `DELETE FROM scores
          WHERE mode = ?
            AND id NOT IN (
              SELECT id FROM scores
               WHERE mode = ?
               ORDER BY survived DESC, kills DESC, id ASC
               LIMIT ?
            )`
      )
      .bind(mode, mode, KEEP)
      .run();

    return json({
      ok: true,
      id: ins.meta?.last_row_id ?? null,
      mode,
      top: await fetchTop(env.DB, mode)
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 對局房間：/api/room/XXXX 升級成 WebSocket
    if (url.pathname.startsWith('/api/room/')) {
      if (!env.ROOM) return json({ ok: false, error: '房間服務尚未啟用' }, 500);
      const code = url.pathname.slice('/api/room/'.length).toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(code)) return json({ ok: false, error: '房號格式錯誤' }, 400);
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(request);
    }

    if (url.pathname === '/api/scores') {
      if (!env.DB) return json({ ok: false, error: '資料庫尚未綁定' }, 500);
      if (request.method === 'GET') return handleGet(request, env);
      if (request.method === 'POST') return handlePost(request, env);
      return json({ ok: false, error: '不支援的方法' }, 405);
    }

    // 其餘交給 public/ 底下的靜態檔案
    return env.ASSETS.fetch(request);
  }
};
