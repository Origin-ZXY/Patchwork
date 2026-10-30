import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestGate } from '../server/request-security.js';
import { RoomStore } from '../server/rooms.js';

test('request gate bounds memory and recovers after expiration', () => {
  let now = 0; const gate = new RequestGate({ now: () => now, maximumKeys: 2 });
  gate.check('read', 'a', 2); gate.check('read', 'a', 2);
  assert.throws(() => gate.check('read', 'a', 2), error => error.status === 429 && error.retryAfter === 60);
  gate.check('read', 'b', 2);
  assert.throws(() => gate.check('read', 'c', 2), { status: 429 }); assert.equal(gate.counters.size, 2);
  now = 60001; gate.check('read', 'c', 2); assert.ok(gate.counters.size <= 2);
});

test('local room capacity releases expired empty tables and preserves ongoing games', () => {
  let now = 0; const store = new RoomStore({ maximumRooms: 2, now: () => now });
  const host = store.create(), other = store.create();
  assert.throws(() => store.create(), { status: 429 });
  assert.throws(() => store.join(host.code), { status: 403 });
  const guest = store.join(host.code, { inviteKey: host.room.inviteKey }); assert.equal(guest.room.inviteKey, undefined);
  store.start(host.code, host.token); now = 30 * 60000 + 1;
  assert.throws(() => store.snapshot(other.code, other.token), { status: 404 });
  assert.equal(store.snapshot(host.code, guest.token).status, 'playing'); assert.equal(store.create().seat, 0);
});
