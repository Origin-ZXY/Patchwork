import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,applyAction,getWinner,getFilledCount} from '../engine.js';
import {chooseAction} from '../ai.js';

test('AI chooses only legal, affordable actions and reaches completion across seeded games',()=>{
  for(let seed=0;seed<10;seed++) {
    let state=createGame({seed}), turns=0;
    while(!state.finished && turns++<200) {
      const saved=structuredClone(state);
      const action=chooseAction(state,{difficulty:seed%2?'normal':'easy'});
      assert.deepEqual(state,saved,'AI is read-only');
      assert.ok(action,'a live game has an available action');
      state=applyAction(state,action);
      for(const player of state.players) {
        assert.ok(player.buttons>=0,'no overspending');
        assert.ok(player.time>=0 && player.time<=53);
        assert.ok(getFilledCount(player)<=81);
      }
    }
    assert.equal(state.finished,true,'seed '+seed+' completes');
    assert.ok(turns<200);
    assert.ok([0,1].includes(getWinner(state)));
    assert.equal(chooseAction(state),null);
    assert.deepEqual(state.players.map(player=>player.time),[53,53]);
  }
});

test('AI places special patches before taking any other action and handles a crowded board',()=>{
  const state=createGame({seed:3});
  state.players[0].board=Array.from({length:9},()=>Array.from({length:9},()=>({patchId:'test'})));
  state.players[0].board[8][8]=null;
  state.pendingLeather=1;
  assert.deepEqual(chooseAction(state),{type:'leather',x:8,y:8});
  const next=applyAction(state,chooseAction(state));
  assert.equal(getFilledCount(next.players[0]),81);
});

test('unaffordable or nonfitting patches trigger advance instead of stalling',()=>{
  const state=createGame({seed:9});
  state.players[0].buttons=0;
  state.market=['p28','p32','p27'];
  assert.deepEqual(chooseAction(state),{type:'advance'});
  state.players[0].buttons=100;
  state.players[0].board=Array.from({length:9},()=>Array.from({length:9},()=>({patchId:'test'})));
  assert.deepEqual(chooseAction(state),{type:'advance'});
});
