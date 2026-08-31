// 墨戰 · 對局房間
//
// 一個房號對應一個 Durable Object。它只做三件事：
//   1. 記住誰在房裡
//   2. 開局時發同一顆種子給所有人
//   3. 把每個人的即時狀態轉發給其他人
//
// 它不模擬任何遊戲邏輯——世界由種子決定，各自在自己的瀏覽器裡跑。
// 所以就算延遲兩百毫秒也完全不影響公平性。
//
// 用 WebSocket Hibernation API：閒置時物件會休眠，不計 duration 費用，
// 但連線保持著。代價是記憶體狀態會被丟掉，所以每個人的資料存在
// 該條連線的 attachment 裡，房間層級的資料存在 storage。

const MAX_PLAYERS = 4;
const BROADCAST_GAP = 220;        // 毫秒。轉發不需要比這更密

const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.lastCast = 0;
    this.ctx.blockConcurrencyWhile(async () => {
      this.room = (await this.ctx.storage.get('room'))
        || { phase: 'lobby', mode: 'endless', seed: 0, kind: 'versus', code: '' };
      if (!this.room.kind) this.room.kind = 'versus';
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') !== 'websocket')
      return jsonRes({ ok: false, error: '需要 WebSocket' }, 426);

    if (this.ctx.getWebSockets().length >= MAX_PLAYERS)
      return jsonRes({ ok: false, error: '房間滿了' }, 409);

    const code = url.pathname.slice(url.pathname.lastIndexOf('/') + 1).toUpperCase();
    if (code) this.room.code = code;
    const kindWanted = url.searchParams.get('kind');
    if (!this.ctx.getWebSockets().length && (kindWanted === 'coop' || kindWanted === 'versus'))
      this.room.kind = kindWanted;                 // 第一個進來的人決定房型
    const name = (url.searchParams.get('name') || '').trim().slice(0, 8) || '無名氏';
    // 由客戶端帶自己的 id 進來，它才知道名單裡哪一個是自己。
    // 伺服器只負責清洗，不接受奇怪字元。
    const pid = (url.searchParams.get('id') || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)
      || crypto.randomUUID().slice(0, 8);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      id: pid,
      name, joined: Date.now(),
      t: 0, kills: 0, lv: 1, hp: 1, stacks: 0, peak: 0, done: false
    });

    this.cast(true);
    this.announce();
    return new Response(null, { status: 101, webSocket: client });
  }

  // 最早進來的那個人是房主。他離開就換下一位，不會卡住整間房。
  hostId() {
    const all = this.ctx.getWebSockets()
      .map(ws => ws.deserializeAttachment())
      .filter(Boolean)
      .sort((a, b) => a.joined - b.joined);
    return all.length ? all[0].id : null;
  }

  snapshot() {
    const host = this.hostId();
    const players = this.ctx.getWebSockets()
      .map(ws => ws.deserializeAttachment())
      .filter(Boolean)
      .sort((a, b) => a.joined - b.joined)
      .map(a => ({
        id: a.id, name: a.name, t: a.t, kills: a.kills, lv: a.lv,
        hp: a.hp, stacks: a.stacks, peak: a.peak, done: a.done, host: a.id === host
      }));
    return { type: 'state', phase: this.room.phase, mode: this.room.mode,
             kind: this.room.kind, host, players };
  }

  // 向目錄回報自己還活著。節流到每 15 秒一次就夠，目錄的過期門檻是 45 秒。
  announce() {
    const now = Date.now();
    if (now - (this.lastAnn || 0) < 15000 && this.ctx.getWebSockets().length) return;
    this.lastAnn = now;
    const players = this.ctx.getWebSockets().length;
    const first = this.ctx.getWebSockets()
      .map(w => w.deserializeAttachment()).filter(Boolean)
      .sort((a, b) => a.joined - b.joined)[0];
    if (!this.env.DIR || !this.room.code) return;
    const body = JSON.stringify({
      code: this.room.code, host: first ? first.name : '', mode: this.room.mode,
      kind: this.room.kind, players, playing: this.room.phase === 'play'
    });
    this.ctx.waitUntil(
      this.env.DIR.get(this.env.DIR.idFromName('index'))
        .fetch('https://dir/', { method: 'POST', body })
        .catch(() => {})
    );
  }

  cast(force) {
    const now = Date.now();
    if (!force && now - this.lastCast < BROADCAST_GAP) return;
    this.lastCast = now;
    const msg = JSON.stringify(this.snapshot());
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch {}
    }
  }

  sendAll(obj) {
    const msg = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch {}
    }
  }

  async webSocketMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const me = ws.deserializeAttachment();
    if (!me) return;

    if (m.type === 'tick') {
      // 只收數字，而且夾在合理範圍內——這是唯一會被高頻呼叫的路徑
      const num = (v, lo, hi) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
      };
      me.t = num(m.t, 0, 36000);
      me.kills = Math.round(num(m.kills, 0, 999999));
      me.lv = Math.round(num(m.lv, 1, 999));
      me.hp = num(m.hp, 0, 1);
      me.stacks = Math.round(num(m.stacks, 0, 999999));
      ws.serializeAttachment(me);
      this.cast(false);
      return;
    }

    // ── 合作模式的三種封包，走最短路徑，不做任何驗證以外的處理 ──
    if (m.type === 'w') {                   // 主機廣播世界快照
      if (me.id !== this.hostId()) return;
      const out = JSON.stringify(m);
      for (const ws2 of this.ctx.getWebSockets()) {
        if (ws2 === ws) continue;
        try { ws2.send(out); } catch {}
      }
      return;
    }
    if (m.type === 'in' || m.type === 'dmg') {   // 訪客回報輸入與命中，只給主機
      m.from = me.id; m.name = me.name;
      const out = JSON.stringify(m);
      for (const ws2 of this.ctx.getWebSockets()) {
        const a2 = ws2.deserializeAttachment();
        if (a2 && a2.id === this.hostId()) { try { ws2.send(out); } catch {} }
      }
      return;
    }

    if (m.type === 'dead') {
      me.done = true;
      me.peak = Math.round(Number(m.peak) || 0);
      ws.serializeAttachment(me);
      const alive = this.ctx.getWebSockets()
        .map(w => w.deserializeAttachment())
        .filter(a => a && !a.done).length;
      if (alive === 0) {
        this.room.phase = 'over';
        await this.ctx.storage.put('room', this.room);
      }
      this.cast(true);
      return;
    }

    // 以下只有房主能做
    if (me.id !== this.hostId()) return;

    if (m.type === 'kind') {
      if (m.kind === 'coop' || m.kind === 'versus') {
        this.room.kind = m.kind;
        await this.ctx.storage.put('room', this.room);
        this.cast(true);
        this.lastAnn = 0; this.announce();
      }
      return;
    }

    if (m.type === 'mode') {
      if (['timed', 'endless', 'rpg'].includes(m.mode)) {
        this.room.mode = m.mode;
        await this.ctx.storage.put('room', this.room);
        this.cast(true);
      }
      return;
    }

    if (m.type === 'start') {
      this.room.phase = 'play';
      this.room.seed = (Math.random() * 0x7FFFFFFF) | 0;
      await this.ctx.storage.put('room', this.room);
      for (const w of this.ctx.getWebSockets()) {
        const a = w.deserializeAttachment();
        if (!a) continue;
        Object.assign(a, { t: 0, kills: 0, lv: 1, hp: 1, stacks: 0, peak: 0, done: false });
        w.serializeAttachment(a);
      }
      this.sendAll({ type: 'start', seed: this.room.seed, mode: this.room.mode,
                     kind: this.room.kind, host: this.hostId() });
      this.cast(true);
      this.lastAnn = 0; this.announce();
      return;
    }

    if (m.type === 'lobby') {
      this.room.phase = 'lobby';
      await this.ctx.storage.put('room', this.room);
      this.cast(true);
    }
  }

  async webSocketClose(ws) {
    // attachment 隨著連線一起消失，這裡只要通知其他人重畫名單
    this.cast(true);
    this.lastAnn = 0; this.announce();
  }

  async webSocketError(ws) {
    this.cast(true);
  }
}
