import { RoomError } from './room-core.js';

export const roomCapacity = value => /^\d+$/.test(String(value ?? '')) ? Math.max(1, Math.min(100, Number(value))) : 20;

/** A bounded, cheap first gate. Each Worker isolate owns its own counters. */
export class RequestGate {
  constructor({ now = () => Date.now(), maximumKeys = 4096 } = {}) {
    this.now = now; this.maximumKeys = maximumKeys; this.counters = new Map();
  }

  check(category, identity, maximum, windowMs = 60000) {
    const now = this.now(), key = `${category}:${identity}`;
    let counter = this.counters.get(key);
    if (!counter || now >= counter.until) {
      if (this.counters.size >= this.maximumKeys) {
        for (const [id, value] of this.counters) if (now >= value.until) this.counters.delete(id);
        if (this.counters.size >= this.maximumKeys) throw this.error(60);
      }
      counter = { count: 0, until: now + windowMs }; this.counters.set(key, counter);
    }
    if (++counter.count > maximum) throw this.error(Math.ceil((counter.until - now) / 1000));
  }

  error(seconds) {
    const error = new RoomError('操作太频繁，请稍后重试', 429);
    error.retryAfter = Math.max(1, seconds); return error;
  }
}
