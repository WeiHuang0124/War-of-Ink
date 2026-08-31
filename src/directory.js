// 房間目錄。每個房間是獨立的 Durable Object，彼此看不到對方，
// 所以要有一個共用的目錄讓大廳列得出「現在有哪些房」。
//
// 房間會定期回報自己還活著；超過 45 秒沒回報的就當它沒了。
// 這比讓房間主動註銷可靠——瀏覽器分頁被關掉時不會有人來註銷。

const STALE = 45000;

const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });

export class Directory {
  constructor(ctx) {
    this.ctx = ctx;
    this.ctx.blockConcurrencyWhile(async () => {
      this.rooms = (await this.ctx.storage.get('rooms')) || {};
    });
  }

  prune() {
    const now = Date.now();
    let changed = false;
    for (const k of Object.keys(this.rooms)) {
      const r = this.rooms[k];
      if (!r || now - r.at > STALE || r.players <= 0) { delete this.rooms[k]; changed = true; }
    }
    return changed;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'POST') {
      let b;
      try { b = await request.json(); } catch { return jsonRes({ ok: false }, 400); }
      const code = String(b.code || '').toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(code)) return jsonRes({ ok: false }, 400);
      if (b.players > 0) {
        this.rooms[code] = {
          code,
          host: String(b.host || '').slice(0, 8),
          mode: ['timed', 'endless', 'rpg'].includes(b.mode) ? b.mode : 'endless',
          kind: b.kind === 'coop' ? 'coop' : 'versus',
          players: Math.max(0, Math.min(4, b.players | 0)),
          playing: !!b.playing,
          at: Date.now()
        };
      } else {
        delete this.rooms[code];
      }
      this.prune();
      await this.ctx.storage.put('rooms', this.rooms);
      return jsonRes({ ok: true });
    }

    if (this.prune()) await this.ctx.storage.put('rooms', this.rooms);
    const list = Object.values(this.rooms)
      .sort((a, b) => b.at - a.at)
      .slice(0, 24)
      .map(r => ({ code: r.code, host: r.host, mode: r.mode, kind: r.kind,
                   players: r.players, playing: r.playing }));
    return jsonRes({ ok: true, rooms: list });
  }
}
