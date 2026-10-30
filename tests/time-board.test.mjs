import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGame,applyAction,upgradeTimeBoard,isCompatibleGame,GAME_VERSION,TIME_BOARD_ID,INCOME_SPOTS,LEATHER_SPOTS} from '../engine.js';
import {TIME_BOARD_SIDES,getTimeBoardGeometry,timeBoardSVG,normalizeTimeBoardSide} from '../time-board.js';

const official=JSON.parse(readFileSync(new URL('./fixtures/classic-time-board.json',import.meta.url),'utf8'));
test('official corrected timeline has nine income boundaries and five leather spaces',()=>{
  assert.deepEqual(INCOME_SPOTS,official.incomeOnEntering);
  assert.deepEqual(LEATHER_SPOTS,official.leatherOnReaching);
  assert.equal(LEATHER_SPOTS.includes(20),false);
  assert.equal(LEATHER_SPOTS.includes(50),true);
});

for(const spot of official.incomeOnEntering) {
  test(`income boundary ${spot-1} → ${spot} pays once on entering, not one space early`,()=>{
    let game=createGame({seed:spot});game.players[0].income=3;
    game.players[0].time=spot-2;game.players[1].time=spot-2;
    game=applyAction(game,{type:'advance'});
    assert.equal(game.players[0].time,spot-1);
    assert.equal(game.players[0].buttons,6);
    game.current=0;game.players[1].time=spot-1;
    game=applyAction(game,{type:'advance'});
    assert.equal(game.players[0].time,spot);
    assert.equal(game.players[0].buttons,10);
    if(spot<53){
      game.current=0;game.players[1].time=spot;
      game=applyAction(game,{type:'advance'});
      assert.equal(game.players[0].buttons,11);
    }
  });
}
for(const spot of official.leatherOnReaching) {
  test(`leather at ${spot} is awarded on arrival once, only to the first player`,()=>{
    let game=createGame({seed:spot});
    game.players[0].time=spot-2;game.players[1].time=spot-2;
    game=applyAction(game,{type:'advance'});
    assert.equal(game.pendingLeather,0);
    assert.equal(game.leatherAvailable.includes(spot),true);
    game.current=0;game.players[1].time=spot-1;
    game=applyAction(game,{type:'advance'});
    assert.equal(game.pendingLeather,1);
    assert.equal(game.leatherAvailable.includes(spot),false);
    game=applyAction(game,{type:'leather',x:0,y:0});
    assert.equal(game.current,1);
    game=applyAction(game,{type:'advance'});
    assert.equal(game.players[1].time,spot+1);
    assert.equal(game.pendingLeather,0);
  });
}
test('the former digital event at 20 no longer gives leather',()=>{
  let game=createGame({seed:20});game.players[0].time=19;game.players[1].time=19;
  game=applyAction(game,{type:'advance'});
  assert.equal(game.players[0].time,20);
  assert.equal(game.pendingLeather,0);
  assert.deepEqual(game.leatherAvailable,official.leatherOnReaching);
});

test('both faces have all 54 ordered positions, identical events, and cannot mutate progress',()=>{
  const game=createGame({seed:'faces'});game.players[0].time=26;game.players[1].time=26;
  game.leatherAvailable=game.leatherAvailable.filter(spot=>spot!==26);
  const before=structuredClone(game),svg={};
  for(const side of TIME_BOARD_SIDES){
    const cells=getTimeBoardGeometry(side);
    assert.deepEqual(cells.map(cell=>cell.index),Array.from({length:54},(_,i)=>i));
    assert.equal(new Set(cells.map(cell=>cell.center.join(','))).size,54);
    assert.ok(cells.every(cell=>cell.center.every(value=>Number.isFinite(value)&&value>=7&&value<=265)));
    svg[side]=timeBoardSVG(game,{side});
    assert.equal((svg[side].match(/data-time-space=/g)||[]).length,54);
    assert.deepEqual([...svg[side].matchAll(/data-income-at="(\d+)"/g)].map(m=>Number(m[1])),official.incomeOnEntering);
    assert.deepEqual([...svg[side].matchAll(/data-leather-at="(\d+)"/g)].map(m=>Number(m[1])),official.leatherOnReaching);
    assert.match(svg[side],/data-leather-at="26" data-available="false"/);
    assert.equal((svg[side].match(/data-position="26"/g)||[]).length,2);
    assert.doesNotMatch(svg[side],/NaN|undefined/);
  }
  assert.notEqual(svg.quilt,svg.plain);
  assert.deepEqual(game,before);
  assert.equal(normalizeTimeBoardSide('plain'),'plain');
  assert.equal(normalizeTimeBoardSide('untrusted'),'quilt');
});

test('the patchwork face has no overlapping cells and every consecutive pair touches',()=>{
  const cells=getTimeBoardGeometry('quilt');
  for(let i=0;i<cells.length;i++)for(let j=i+1;j<cells.length;j++){
    const a=cells[i].rect,b=cells[j].rect;
    const width=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
    const height=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
    assert.ok(width<=0||height<=0,`overlap ${i}/${j}`);
    if(j===i+1)assert.ok(width===0&&height>0||height===0&&width>0,`broken path ${i}/${j}`);
  }
});

function previousClassic(time=12){
  const game=createGame({seed:'saved-classic'});
  game.version=2;delete game.timeBoard;game.leatherAvailable=[20,26,32,38,44];
  game.players[0].time=time;game.players[1].time=time+1;
  game.players[0].buttons=17;game.players[0].board[0][0]={patchId:'leather'};
  return game;
}
test('early classic saves retain boards, finances, market and turn when upgrading timeline',()=>{
  const previous=previousClassic(),before=structuredClone(previous),game=upgradeTimeBoard(previous);
  assert.ok(isCompatibleGame(game));
  assert.equal(game.version,GAME_VERSION);assert.equal(game.timeBoard,TIME_BOARD_ID);
  assert.deepEqual(game.players,previous.players);assert.deepEqual(game.market,previous.market);
  assert.equal(game.current,previous.current);assert.equal(game.seed,previous.seed);
  assert.deepEqual(game.leatherAvailable,official.leatherOnReaching);
  assert.deepEqual(previous,before);
  assert.equal(upgradeTimeBoard(game),game);
});
test('a save that could have consumed the old event is never silently reinterpreted',()=>{
  assert.equal(upgradeTimeBoard(previousClassic(19)),null);
  assert.equal(upgradeTimeBoard(previousClassic(20)),null);
  assert.equal(upgradeTimeBoard({...previousClassic(),pendingLeather:1}),null);
  assert.equal(upgradeTimeBoard({...previousClassic(),version:1}),null);
  assert.equal(upgradeTimeBoard(null),null);
  const game=createGame({seed:7});delete game.timeBoard;
  assert.equal(isCompatibleGame(game),false);
  assert.throws(()=>applyAction(game,{type:'advance'}),/棋盘规则已更新/);
});
