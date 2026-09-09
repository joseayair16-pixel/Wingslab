/**
 * Cliente Redis en memoria para el entorno de tests (NODE_ENV === 'test').
 * Mantiene la interfaz de ioredis que usa el backend (get/set/setex/del/incr/
 * expire/ttl/exists/mget/zset/scan/ping/multi) sin depender de un servidor real.
 * Esto vuelve el suite de integración hermético: se ejecuta sin Docker/Redis.
 */

type InMemoryEntry = { value: string; expiresAt: number | null };
type ZSetEntry = { score: number; member: string };

export class InMemoryRedis {
  private store = new Map<string, InMemoryEntry>();
  private zsets = new Map<string, Map<string, ZSetEntry>>();
  status = 'ready';

  on(): this {
    return this;
  }

  private isExpired(entry: InMemoryEntry): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= Date.now();
  }

  private getEntry(key: string): InMemoryEntry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  private setWithArgs(key: string, value: string, args: unknown[]): 'OK' {
    let expiresAt: number | null = null;
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === 'EX') {
        expiresAt = Date.now() + Number(args[i + 1]) * 1000;
      } else if (arg === 'PX') {
        expiresAt = Date.now() + Number(args[i + 1]);
      }
    }
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const entry = this.getEntry(key);
    return entry ? entry.value : null;
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<'OK'> {
    return this.setWithArgs(key, value, args);
  }

  async setex(key: string, seconds: number, value: string): Promise<'OK'> {
    this.store.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) removed += 1;
      if (this.zsets.delete(key)) removed += 1;
    }
    return removed;
  }

  async incr(key: string): Promise<number> {
    const current = Number(this.getEntry(key)?.value ?? '0');
    const next = current + 1;
    this.store.set(key, { value: String(next), expiresAt: this.getEntry(key)?.expiresAt ?? null });
    return next;
  }

  async decr(key: string): Promise<number> {
    const current = Number(this.getEntry(key)?.value ?? '0');
    const next = current - 1;
    this.store.set(key, { value: String(next), expiresAt: this.getEntry(key)?.expiresAt ?? null });
    return next;
  }

  async exists(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.getEntry(key)) count += 1;
    }
    return count;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.getEntry(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.getEntry(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.max(0, Math.round((entry.expiresAt - Date.now()) / 1000));
  }

  async mget(...keys: string[]): Promise<Array<string | null>> {
    return keys.map((key) => this.getEntry(key)?.value ?? null);
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    if (!this.zsets.has(key)) this.zsets.set(key, new Map());
    const zset = this.zsets.get(key) as Map<string, ZSetEntry>;
    const added = zset.has(member) ? 0 : 1;
    zset.set(member, { score, member });
    return added;
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    const zset = this.zsets.get(key);
    if (!zset) return 0;
    let removed = 0;
    for (const member of members) {
      if (zset.delete(member)) removed += 1;
    }
    return removed;
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    const zset = this.zsets.get(key);
    if (!zset) return [];
    const sorted = [...zset.values()].sort((a, b) => a.score - b.score);
    const from = start < 0 ? Math.max(sorted.length + start, 0) : start;
    const to = stop < 0 ? sorted.length + stop : stop + 1;
    return sorted.slice(from, Math.max(from, to)).map((e) => e.member);
  }

  async zcard(key: string): Promise<number> {
    return this.zsets.get(key)?.size ?? 0;
  }

  async zrank(key: string, member: string): Promise<number | null> {
    const zset = this.zsets.get(key);
    if (!zset) return null;
    const sorted = [...zset.values()].sort((a, b) => a.score - b.score);
    const index = sorted.findIndex((e) => e.member === member);
    return index === -1 ? null : index;
  }

  async scan(_cursor: string): Promise<[string, string[]]> {
    const keys = [...this.store.keys()].filter((key) => this.getEntry(key) !== undefined);
    return ['0', keys];
  }

  async ping(): Promise<'PONG'> {
    return 'PONG';
  }

  async quit(): Promise<'OK'> {
    return 'OK';
  }

  multi(): InMemoryMulti {
    return new InMemoryMulti(this);
  }
}

class InMemoryMulti {
  private ops: Array<() => Promise<unknown>> = [];
  private redis: InMemoryRedis;

  constructor(redis: InMemoryRedis) {
    this.redis = redis;
  }

  incr(key: string): this {
    this.ops.push(() => this.redis.incr(key));
    return this;
  }

  expire(key: string, seconds: number): this {
    this.ops.push(() => this.redis.expire(key, seconds));
    return this;
  }

  async exec(): Promise<Array<[Error | null, unknown]>> {
    const results: Array<[Error | null, unknown]> = [];
    for (const op of this.ops) {
      try {
        results.push([null, await op()]);
      } catch (error) {
        results.push([error as Error, null]);
      }
    }
    return results;
  }
}