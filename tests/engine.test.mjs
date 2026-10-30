import test from 'node:test';
import assert from 'node:assert/strict';
import {PATCHES,BOARD_SIZE,FINISH_TIME,createGame,getAvailablePatches,transformShape,canPlace,getScore,getWinner,getFilledCount,hasSevenSquare,applyAction,legalPlacements} from '../engine.js';

function ready(patchId='p01') {
  const state=createGame({seed:123});
  state.market=[patchId,...state.market.filter(id=>id!==patchId)];
  state.players[0].buttons=30;
  return state;
}
function filledBoard() {return Array.from({length:9},()=>Array.from({length:9},()=>({patchId:'test',color:'#fff'})));}

test('seeded setup has all 33 connected, nonduplicated patches and neutral pawn after 1x2',()=>{
  const first=createGame({seed:'same'}), second=createGame({seed:'same'});
  assert.deepEqual(first,second);
  assert.equal(new Set(first.market).size,33);
  assert.equal(first.market.at(-1),'p01');
  assert.equal(first.players[0].buttons,5);
  assert.equal(first.players[0].board.length,BOARD_SIZE);
  assert.equal(first.players[0].board.flat().filter(Boolean).length,0);
  assert.equal(getAvailablePatches(first).length,3);
  for (const patch of PATCHES) {
    const cells=new Set(patch.shape.map(([x,y])=>`${x},${y}`)), seen=new Set();
    const queue=[patch.shape[0]];
    for (let i=0;i<queue.length;i++) {
      const [x,y]=queue[i],key=`${x},${y}`;
      if(seen.has(key))continue;
      seen.add(key);
      for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])if(cells.has(`${x+dx},${y+dy}`))queue.push([x+dx,y+dy]);
    }
    assert.equal(seen.size,patch.shape.length,patch.id+' must be connected');
    assert.equal(cells.size,patch.shape.length,patch.id+' has distinct cells');
  }
});

test('rotations and flips normalize anchors and enumerate only unique orientations',()=>{
  const shape=[[0,0],[0,1],[1,1]];
  const original=structuredClone(shape);
  assert.deepEqual(transformShape(shape,4),transformShape(shape));
  assert.deepEqual(transformShape(shape,1),[[0,0],[1,0],[0,1]]);
  assert.deepEqual(transformShape(shape,0,true),[[1,0],[0,1],[1,1]]);
  assert.deepEqual(shape,original);
  assert.equal(legalPlacements(ready(),'p01').length,144);
  assert.equal(legalPlacements(ready(),'p04').length,64);
});

test('legal placement is atomic, pays cost, earns income and moves market relative to purchase',()=>{
  const state=ready('p07');
  state.market=['p02','p07','p04',...state.market.filter(id=>!['p02','p07','p04'].includes(id))];
  const saved=structuredClone(state);
  const result=applyAction(state,{type:'place',patchId:'p07',x:0,y:0});
  assert.deepEqual(state,saved);
  assert.equal(result.players[0].buttons,26);
  assert.equal(result.players[0].income,1);
  assert.equal(result.players[0].time,2);
  assert.equal(getFilledCount(result.players[0]),4);
  assert.equal(result.market[0],'p04');
  assert.equal(result.market.at(-1),'p02');
  assert.equal(result.market.includes('p07'),false);
  assert.equal(result.current,1);
  assert.equal(result.revision,1);
});

test('off-board, overlap, affordability and unavailable patches cannot mutate a game',()=>{
  const state=ready('p04');
  const saved=structuredClone(state);
  for(const action of [
    {type:'place',patchId:'p04',x:8,y:8},
    {type:'place',patchId:state.market[3],x:0,y:0},
    {type:'place',patchId:'p04',x:0,y:0,rotation:0.5},
    {type:'place',patchId:'p04',x:NaN,y:0},
    {type:'leather',x:0,y:0},
    {type:'unknown'},
  ]) assert.throws(()=>applyAction(state,action));
  assert.deepEqual(state,saved);
  state.players[0].buttons=0;
  assert.throws(()=>applyAction(state,{type:'place',patchId:'p04',x:0,y:0}),/纽扣不足/);
  state.players[0].buttons=10;
  state.players[0].board[0][0]={patchId:'test'};
  assert.throws(()=>applyAction(state,{type:'place',patchId:'p04',x:0,y:0}));
  assert.equal(canPlace(state.players[0].board,[[0,0]],-1,0),false);
});

test('the player behind may act repeatedly, and the most recent arrival wins tied-time priority',()=>{
  let state=ready('p01');
  state.players[1].time=4;
  state=applyAction(state,{type:'place',patchId:'p01',x:0,y:0});
  assert.equal(state.current,0);
  state.market=['p02',...state.market.filter(id=>id!=='p02')];
  state=applyAction(state,{type:'place',patchId:'p02',x:3,y:0});
  assert.equal(state.players[0].time,4);
  assert.equal(state.current,0);
  state=applyAction(state,{type:'advance'});
  assert.equal(state.players[0].time,5);
  assert.equal(state.current,1);
});

test('new patch income counts immediately on crossed markers and never repeats',()=>{
  let state=ready('p07');
  state.players[0].time=4;
  state.players[0].income=2;
  state.players[1].time=9;
  state=applyAction(state,{type:'place',patchId:'p07',x:0,y:0});
  assert.equal(state.players[0].time,6);
  assert.equal(state.players[0].income,3);
  assert.equal(state.players[0].buttons,29);
  state=applyAction(state,{type:'advance'});
  assert.equal(state.players[0].buttons,33);
  assert.equal(state.players[0].time,10);
});

test('advance earns each actual step and crosses every income and leather marker once',()=>{
  let state=createGame({seed:10});
  state.players[0].time=19;
  state.players[0].income=2;
  state.players[1].time=49;
  state=applyAction(state,{type:'advance'});
  assert.equal(state.players[0].buttons,5+31+2*5);
  assert.equal(state.players[0].time,50);
  assert.equal(state.pendingLeather,5);
  assert.equal(state.current,0);
  assert.equal(state.leatherAvailable.length,0);
  assert.throws(()=>applyAction(state,{type:'advance'}),/皮革/);
  for(let x=0;x<5;x++)state=applyAction(state,{type:'leather',x,y:0});
  assert.equal(state.pendingLeather,0);
  assert.equal(state.current,1);
  assert.equal(getFilledCount(state.players[0]),5);
});

test('a full board consumes all unplaceable special patches and never deadlocks',()=>{
  let state=createGame({seed:5});
  state.players[0].board=filledBoard();
  state.players[0].board[8][8]=null;
  state.players[0].time=19;
  state.players[1].time=32;
  state=applyAction(state,{type:'advance'});
  assert.equal(state.pendingLeather,2);
  state=applyAction(state,{type:'leather',x:8,y:8});
  assert.equal(state.pendingLeather,0);
  assert.equal(state.current,1);
});

test('7x7 tile is claimed once after completing a square, including with leather',()=>{
  let state=createGame({seed:1});
  for(let y=0;y<7;y++)for(let x=0;x<7;x++)state.players[0].board[y][x]={patchId:'test'};
  state.players[0].board[6][6]=null;
  state.pendingLeather=1;
  assert.equal(hasSevenSquare(state.players[0].board),false);
  state=applyAction(state,{type:'leather',x:6,y:6});
  assert.equal(state.bonusOwner,0);
  assert.equal(state.players[0].bonus,true);
  assert.equal(getScore(state.players[0]),5+7-32*2);
  state.current=1;
  state.players[1].board=filledBoard();
  state.players[1].board[8][8]=null;
  state.pendingLeather=1;
  state=applyAction(state,{type:'leather',x:8,y:8});
  assert.equal(state.bonusOwner,0);
  assert.equal(state.players[1].bonus,false);
});

test('finish caps movement, scores empty cells and resolves ties by arrival order',()=>{
  let state=createGame({seed:2});
  state.players[0].time=51;
  state.players[1].time=53;
  state.finishOrder=[1];
  state=applyAction(state,{type:'advance'});
  assert.equal(state.players[0].time,FINISH_TIME);
  assert.equal(state.players[0].buttons,7);
  assert.equal(state.finished,true);
  assert.equal(getWinner(state),0);
  state.players[1].buttons=7;
  assert.equal(getWinner(state),1);
  assert.equal(getScore(state.players[0]),7-162);
  assert.throws(()=>applyAction(state,{type:'advance'}),/已结束/);
});

test('game completion waits for earned leather patches',()=>{
  let state=createGame({seed:7});
  state.players[0].time=43;
  state.players[1].time=53;
  state.finishOrder=[1];
  state=applyAction(state,{type:'advance'});
  assert.equal(state.pendingLeather,2);
  assert.equal(state.finished,false);
  assert.equal(getWinner(state),null);
  state=applyAction(state,{type:'leather',x:0,y:0});
  assert.equal(state.finished,false);
  state=applyAction(state,{type:'leather',x:1,y:0});
  assert.equal(state.finished,true);
  assert.deepEqual(state.finishOrder,[1,0]);
});
