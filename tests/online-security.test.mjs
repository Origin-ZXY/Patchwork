import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomVerification } from '../online-security.js';

test('async SDK callback enables single-use verification and closed dialogs cannot revive it', async t => {
  const descriptors = new Map(['window', 'document', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of descriptors) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  let callbacks, renders = 0, resets = 0, removes = 0;
  const api = {
    ready() { throw new Error('ready is invalid on an async script'); },
    render(container, options) { callbacks = options; renders++; return 'widget'; },
    reset() { resets++; }, remove() { removes++; },
  };
  globalThis.window = {};
  globalThis.document = { createElement: () => ({ remove() {} }), head: { append(script) {
    assert.match(script.src, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit&onload=patchworkTurnstileReady/);
    queueMicrotask(() => { window.turnstile = api; window.patchworkTurnstileReady(); });
  } } };
  globalThis.fetch = async () => Response.json({ required: true, siteKey: 'unit-site-key' });
  const changes = [], verification = new RoomVerification({}, (ready, message) => changes.push({ ready, message }));
  await verification.mount(); assert.equal(renders, 1); assert.equal(verification.ready, false);
  assert.equal(callbacks.action, 'patchwork_room'); assert.equal(callbacks['response-field'], false);
  callbacks.callback('single-use'); assert.equal(verification.ready, true);
  assert.equal(verification.take(), 'single-use'); assert.equal(verification.ready, false);
  assert.throws(() => verification.take(), /人机验证/);
  verification.reset(); assert.equal(resets, 1);
  callbacks.callback('second'); callbacks['expired-callback'](); assert.equal(verification.ready, false);
  verification.destroy(); assert.equal(removes, 1); const before = changes.length;
  callbacks.callback('late'); assert.equal(changes.length, before); assert.equal(verification.ready, false);
  let finish;
  globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
  const closed = new RoomVerification({}, () => {}), mounting = closed.mount(); closed.destroy();
  finish(Response.json({ required: true, siteKey: 'unit-site-key' })); await mounting; assert.equal(renders, 1);
});
