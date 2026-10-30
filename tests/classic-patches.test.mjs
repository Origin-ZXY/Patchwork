import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PATCHES, PATCH_SET_ID, GAME_VERSION, createGame, isCompatibleGame, applyAction, getFilledCount } from '../engine.js';
import { createRoomRecord, joinRoomRecord, startRoomRecord, snapshotRoom, applyRoomAction } from '../server/room-core.js';

// A separately recorded component catalogue, in ASCII rather than engine coordinates.
const reference = JSON.parse(readFileSync(new URL('./fixtures/classic-patches.json', import.meta.url), 'utf8'));
const fromRows = rows => rows.flatMap((row,y) => [...row].flatMap((cell,x) => cell === '#' ? [[x,y]] : []));
function canonical(shape) {
  const alternatives = [];
  for (const mirror of [-1,1]) for (let turn=0;turn<4;turn++) {
    const cells = shape.map(([x,y]) => {
      let a=x*mirror,b=y;
      for (let t=0;t<turn;t++) [a,b]=[-b,a];
      return [a,b];
    });
    const left=Math.min(...cells.map(([x])=>x)),top=Math.min(...cells.map(([,y])=>y));
    alternatives.push(cells.map(([x,y])=>[x-left,y-top]).sort((a,b)=>a[1]-b[1]||a[0]-b[0]).map(cell=>cell.join(',')).join(';'));
  }
  return alternatives.sort()[0];
}

test('classic catalogue includes each of the 33 components exactly once and matches independent totals', () => {
  assert.equal(PATCHES.length,33);
  assert.equal(new Set(PATCHES.map(p=>p.id)).size,33);
  assert.deepEqual(PATCHES.map(p=>p.classicId).sort(),reference.patches.map(p=>p.classicId).sort());
  const totals=PATCHES.reduce((sum,p)=>({cells:sum.cells+p.shape.length,cost:sum.cost+p.cost,time:sum.time+p.time,income:sum.income+p.income}),{cells:0,cost:0,time:0,income:0});
  assert.deepEqual(totals,{cells:166,cost:133,time:107,income:38});
});

for (const expected of reference.patches) {
  test(`classic patch ${expected.classicId}: shape, cost, time, income and actual purchase match the component`, () => {
    const patch=PATCHES.find(p=>p.classicId===expected.classicId);
    assert.ok(patch,`Missing classic component ${expected.classicId}`);
    const cells=fromRows(expected.rows);
    assert.equal(canonical(patch.shape),canonical(cells),'shape including rotation/reflection');
    for (const key of ['cost','time','income']) assert.equal(patch[key],expected[key],key);
    const game=createGame({seed:'classic-reference'});
    game.market=[patch.id,...game.market.filter(id=>id!==patch.id)];
    game.players[0].buttons=100;
    const next=applyAction(game,{type:'place',patchId:patch.id,x:0,y:0});
    assert.equal(getFilledCount(next.players[0]),cells.length,'placed cells');
    assert.equal(next.players[0].time,expected.time,'actual time movement');
    assert.equal(next.players[0].income,expected.income,'actual recurring income');
    assert.equal(next.players[0].buttons,100-expected.cost+(expected.time>=5?expected.income:0),'payment and first income crossing');
    assert.equal(canonical(next.players[0].board.flatMap((row,y)=>row.flatMap((cell,x)=>cell?[[x,y]]:[]))),canonical(cells));
  });
}

test('free classic cross can be bought with zero buttons, covers six cells and earns one recurring income', () => {
  const patch=PATCHES.find(p=>p.classicId==='H'),game=createGame({seed:4});
  game.players[0].buttons=0;
  game.market=[patch.id,...game.market.filter(id=>id!==patch.id)];
  const next=applyAction(game,{type:'place',patchId:patch.id,x:0,y:0});
  assert.equal(next.players[0].buttons,0);
  assert.equal(next.players[0].time,3);
  assert.equal(next.players[0].income,1);
  assert.equal(getFilledCount(next.players[0]),6);
});

test('old custom-patch games cannot be played with the classic component catalogue', () => {
  const game=createGame({seed:3});
  assert.equal(game.version,GAME_VERSION);
  assert.equal(game.patchSet,PATCH_SET_ID);
  assert.equal(isCompatibleGame(game),true);
  assert.equal(isCompatibleGame(null),false);
  const old=structuredClone(game);old.version=1;delete old.patchSet;
  const before=structuredClone(old);
  assert.equal(isCompatibleGame(old),false);
  assert.throws(()=>applyAction(old,{type:'advance'}),/经典版新局/);
  assert.deepEqual(old,before);
  const wrongSet={...game,patchSet:'custom'};
  assert.equal(isCompatibleGame(wrongSet),false);
});

test('old online rooms fail with an actionable expiry response without changing their stored game', () => {
  const token='host-token-abcdefghijklmnop',guest='guest-token-abcdefghijklmnop';
  let room=createRoomRecord({code:'ABCDEF',token,name:'甲'});
  room=joinRoomRecord(room,{token:guest,name:'乙',inviteKey:room.inviteKey});
  room=startRoomRecord(room,token,{seed:7});
  room.game.version=1;delete room.game.patchSet;
  const original=structuredClone(room);
  for (const operation of [()=>snapshotRoom(room,token),()=>snapshotRoom(room),()=>applyRoomAction(room,token,{revision:room.revision,action:{type:'advance'}})]) {
    assert.throws(operation,error=>error.status===410&&/经典版/.test(error.message));
  }
  assert.deepEqual(room,original);
});
