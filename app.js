import {createGame,upgradeTimeBoard,getAvailablePatches,getPatch,transformShape,canPlace,getScore,getWinner,getFilledCount,applyAction,legalPlacements,INCOME_SPOTS,LEATHER_SPOTS,LEATHER_PATCH} from './engine.js';
import {chooseAction} from './ai.js';
import {esc,buttonIcon,clockIcon,patchSVG,boardSVG,previewSVG} from './art.js';
import {RoomClient,hostedMultiplayerRedirect,readInvitation,invitationURL} from './room-client.js';
import {RoomVerification} from './online-security.js';
import {timeBoardSVG,normalizeTimeBoardSide,timeBoardSideName} from './time-board.js';

const $=id=>document.getElementById(id);
const SAVE='patchwork-table-classic-v2';
const BOARD_SIDE_SAVE='patchwork-time-board-side-v1';
const client=new RoomClient();
let mode='ai',difficulty='normal',state,selected=null,rotation=0,flipped=false,anchor=null,hover=null;
let aiTimer=null,toastTimer=null,modalKind='',busy=false,lastResult=-1,onlineRevision=null;
let roomVerification=null;
let tutorial=null;
let marketLayoutKey='';
let classicUpgrade='';
let timeBoardSide='quilt';
try{timeBoardSide=normalizeTimeBoardSide(localStorage.getItem(BOARD_SIDE_SAVE));}catch{}

function freshGame(names=['你','缝纫师']) {
  let game;
  for(let attempt=0;attempt<25;attempt++) {
    game=createGame({seed:Date.now()+attempt,names});
    if(getAvailablePatches(game).filter(p=>p.cost<=5).length>=2)break;
  }
  return game;
}
function loadLocal() {
  try {
    const saved=JSON.parse(localStorage.getItem(SAVE))??JSON.parse(localStorage.getItem('patchwork-table-classic-v1'));
    const upgraded=upgradeTimeBoard(saved?.state);
    if(upgraded&&upgraded.players?.length===2&&upgraded.players.every(p=>p.board?.length===9)&&['ai','hotseat'].includes(saved.mode)){
      getAvailablePatches(upgraded).forEach(p=>{if(!p)throw Error();});
      if(upgraded!==saved.state)classicUpgrade='时间轴已按官方勘误校准，当前对局进度已保留。';
      state=upgraded;mode=saved.mode;difficulty=['easy','normal','hard'].includes(saved.difficulty)?saved.difficulty:'normal';return;
    }
    if(saved||localStorage.getItem('patchwork-table-v2'))classicUpgrade='时间轴已按官方勘误校准。旧版存档已保留，当前开始经典版新局。';
  }catch{}
  mode='ai';state=freshGame();
}
function save() {
  if(mode==='online'||tutorial)return;
  try{localStorage.setItem(SAVE,JSON.stringify({state,mode,difficulty}));$('saveStatus').textContent='对局已自动保存在此设备';}
  catch{$('saveStatus').textContent='浏览器未允许保存，关闭页面后对局可能丢失';}
}
function toast(message) {
  $('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$('toast').hidden=true,3600);
}
function clearSelection(){selected=null;rotation=0;flipped=false;anchor=null;hover=null;}
function mainSeat(){return mode==='online'?(client.session?.seat??0):mode==='hotseat'?state.current:0;}
function canAct(){return !busy&&!state.finished&&tutorial?.step!==5&&(mode==='hotseat'||tutorial||(mode==='ai'&&state.current===0)||(mode==='online'&&client.room?.status==='playing'&&client.connected&&client.session?.seat===state.current));}
function shape(){return selected?transformShape((selected==='leather'?LEATHER_PATCH:getPatch(selected)).shape,rotation,flipped):[];}
function advanceDistance(){return Math.max(0,Math.min(53,state.players[1-state.current].time+1)-state.players[state.current].time);}
function signed(value){return value<0?'−'+Math.abs(value):String(value);}
function statHTML(player,compact=false) {
  return `<span class="stat" title="可花费的纽扣">${buttonIcon(compact?15:17)}<strong>${player.buttons}</strong><span class="stat-label">纽扣</span></span><span class="stat" title="每次经过收入点获得的纽扣">${buttonIcon(compact?13:15)}<strong>+${player.income}</strong><span class="stat-label">收入</span></span><span class="stat" title="时间位置">${clockIcon(compact?14:16)}<strong>${player.time}</strong><small>/ 53</small></span>`;
}
function render() {
  if(state.pendingLeather&&canAct())selected='leather';
  const seat=mainSeat(),other=1-seat,p=state.players[seat],opponent=state.players[other],acting=canAct();
  const isMine=state.current===seat;
  $('mainName').textContent=mode==='hotseat'?p.name+'的拼布':'你的拼布';
  $('mainDot').classList.toggle('red',seat===1);
  $('mainTag').textContent=state.finished?'已完成':mode==='online'&&client.room?.status==='waiting'?'未开始':isMine?'行动中':'等待中';
  $('mainFilled').textContent=`已缝 ${getFilledCount(p)} / 81 格`;
  $('mainStats').innerHTML=statHTML(p);
  $('mainScore').textContent=`${state.finished?'最终':'预计'}得分 ${signed(getScore(p))}`;
  $('mainBoard').innerHTML=boardSVG(p,{prefix:'main'})+`<div class="board-hits" role="group" aria-label="选择布料左上角的放置位置">${Array.from({length:81},(_,i)=>{const x=i%9,y=Math.floor(i/9);return `<button type="button" data-x="${x}" data-y="${y}" aria-label="${String.fromCharCode(65+x)}${y+1}${p.board[y][x]?'，已占用':''}" ${acting?'':'disabled'}></button>`;}).join('')}</div><svg class="board-preview" viewBox="0 0 396 396" aria-hidden="true" id="placementPreview"></svg>`;
  $('opponentName').textContent=mode==='online'?(client.room?.players[other]?.name??'等待朋友加入'):opponent.name;
  $('opponentType').textContent=mode==='ai'?`AI · ${{easy:'轻松',normal:'标准',hard:'挑战'}[difficulty]}`:mode==='online'?(client.room?.players[other]?.connected?'在线':'未连接'):'同屏玩家';
  $('opponentStats').innerHTML=statHTML(opponent,true);
  $('opponentBoard').innerHTML=boardSVG(opponent,{prefix:'opponent'});
  $('opponentFilled').textContent=`${getFilledCount(opponent)} / 81 格`;
  $('opponentScore').textContent=`${state.finished?'最终':'预计'} ${signed(getScore(opponent))} 分`;
  $('turnLabel').textContent=state.finished?'最后一针，已经缝好':mode==='online'&&client.room?.status==='waiting'?'等待朋友入座':tutorial?'教学棋桌 · 亲手试一试':isMine?'轮到'+(mode==='hotseat'?p.name:'你')+'缝制':opponent.name+'正在缝制';
  $('tableCode').textContent=mode==='online'?`ROOM · ${client.session?.code??''}`:'经典版 · 33 块布料';
  $('modeLabel').innerHTML=`<i></i>${tutorial?'教学练习':mode==='ai'?'人机练习':mode==='hotseat'?'同屏双人':client.connected?'房间 '+esc(client.session?.code??''):'正在重新连接'}`;
  $('saveStatus').textContent=tutorial?'教学使用独立棋局，退出即恢复原局':mode==='online'?'对局由房间同步 · 刷新可恢复座位':'对局自动保存在此设备';
  renderTime();renderDraft();renderSelection();renderPreview();
  $('marketCount').textContent=`${state.market.length} 块待选`;
  $('bonusTile').classList.toggle('claimed',state.bonusOwner!==null);
  $('bonusText').textContent=state.bonusOwner===null?'率先铺满任意 7 × 7 区域，获得 7 分。':state.players[state.bonusOwner].name+'已拿走这份 7 分奖励。';
  $('recentLog').innerHTML=state.log.slice(-2).reverse().map(entry=>`<span>${esc(entry.text)}</span>`).join('');
  if(modalKind==='opponent')showOpponent();
  if(modalKind==='market')showMarket();
  if(modalKind==='time')showTimeBoard();
  updateTutorial();scheduleAI();
  const resultKey=mode==='online'?client.room?.code+':'+client.room?.revision:state.seed+':'+state.revision;
  if(state.finished&&lastResult!==resultKey&&!tutorial){lastResult=resultKey;setTimeout(()=>showResult(),250);}
}

function renderTime() {
  $('timeBoard').innerHTML=timeBoardSVG(state,{side:timeBoardSide,seat:mainSeat(),prefix:'table-time'});
  document.querySelectorAll('.time-heading [data-time-side]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.timeSide===timeBoardSide)));
  $('viewTimeBoardBtn').setAttribute('aria-label','放大查看'+timeBoardSideName(timeBoardSide)+'时间棋盘');
}
function showTimeBoard() {
  const buttons=['quilt','plain'].map(side=>'<button type="button" data-time-side="'+side+'" aria-pressed="'+(side===timeBoardSide)+'">'+timeBoardSideName(side)+'</button>').join('');
  modal('time',`<h2 class="modal-title">经典版双面时间棋盘</h2><p class="modal-intro">落后的人先行动。双面共用相同的收入点与皮革补丁，随时切换都保留对局进度。</p><div class="time-side-switch time-side-switch-large" role="group" aria-label="放大棋盘外观">${buttons}</div><div class="large-time-board">${timeBoardSVG(state,{side:timeBoardSide,seat:mainSeat(),prefix:'detail-time'})}</div><div class="time-event-list"><p><strong>纽扣收入</strong> 进入第 ${INCOME_SPOTS.join('、')} 格时领取。</p><p><strong>皮革补丁</strong> 第 ${LEATHER_SPOTS.join('、')} 格，首位到达或经过者获得。</p></div><p class="rules-source">采用经典版及官方皮革补丁勘误。<a href="https://www.lookout-spiele.de/en/games/patchwork.html" target="_blank" rel="noopener">查看官方规则与勘误</a></p><div class="modal-footer"><button class="primary-button" data-close>回到棋桌</button></div>`);
}
function patchAttributes(patch) {
  return `<span class="patch-attributes"><span><small>花费</small><strong>${patch.cost} <em>纽扣</em></strong></span><span><small>耗时</small><strong>${patch.time} <em>格</em></strong></span><span><small>收入</small><strong>+${patch.income}</strong></span></span>`;
}
function renderDraft() {
  const act=canAct(),p=state.players[state.current];
  const key=state.market.join('|'),previousScroll=key===marketLayoutKey?$('patchChoices').scrollLeft:0;
  marketLayoutKey=key;
  if(state.pendingLeather) {
    $('patchChoices').innerHTML=`<div class="empty-choices"><span class="leather-preview">${patchSVG(LEATHER_PATCH,{prefix:'leather-choice',width:65,height:65})}</span><div><strong>这一小块，刚刚好。</strong><br>还需放置 ${state.pendingLeather} 块皮革补丁，免费填补一个空格。</div></div>`;
    $('draftTitle').textContent='先把小补丁缝好';$('draftHint').textContent='补丁放置完成后，才会继续对局。';
  } else {
    $('draftTitle').textContent=state.finished?'这一局，已完成。':'布料市场';
    $('draftHint').textContent='前 3 块可以购买；后续布料可横向滑动，或点「查看全部」提前规划。';
    const patches=state.market.map(getPatch);
    $('patchChoices').innerHTML=patches.length?patches.map((patch,i)=>{
      const available=i<3,affordable=p.buttons>=patch.cost,fits=available&&legalPlacements(state,patch.id).length>0;
      const enabled=act&&affordable&&fits&&(!tutorial||(tutorial.step===0&&i===0));
      return `<button class="patch-card ${available?'market-available':'market-later'} ${selected===patch.id?'is-selected':''} ${available&&!affordable?'is-unaffordable':''}" ${available?`data-patch="${patch.id}" ${enabled?'':'disabled'} aria-pressed="${selected===patch.id}"`:`data-inspect="${patch.id}"`} aria-label="${available?'选择':'查看'}${patch.name}，花费${patch.cost}纽扣，时间${patch.time}，收入${patch.income}${available?(!affordable?'，纽扣不足':!fits?'，棋盘放不下':''):'，后续布料'}"><span class="patch-name">${esc(patch.name)}<small>${String(i+1).padStart(2,'0')}<i class="patch-badge">${available?'可选':'后续'}</i></small></span><span class="patch-art">${patchSVG(patch,{width:142,height:68,prefix:'choice'+i})}</span>${patchAttributes(patch)}</button>`;
    }).join(''):'<div class="empty-choices">布料已经选完。<br>前进领取纽扣，完成最后的缝制时光。</div>';
  }
  $('patchChoices').scrollLeft=previousScroll;
  $('rotateBtn').disabled=!act||!selected||selected==='leather';
  $('flipBtn').disabled=!act||!selected||selected==='leather';
  $('advanceBtn').disabled=!act||!!state.pendingLeather||!!tutorial&&tutorial.step!==4;
  $('advanceAmount').textContent='+'+advanceDistance();
}
function renderSelection() {
  document.body.classList.toggle('has-selection',!!selected&&canAct());
  const act=canAct(),pos=anchor??hover,patch=selected?(selected==='leather'?LEATHER_PATCH:getPatch(selected)):null;
  const valid=patch&&pos&&canPlace(state.players[mainSeat()].board,shape(),pos.x,pos.y);
  $('placeBtn').disabled=!act||!anchor||!valid||!!tutorial&&tutorial.step!==3;
  $('placeBtn').textContent=busy?'正在同步…':state.finished?'对局已结束':!act?'等待对方缝制':!patch?'先选一块布料':!anchor?'在拼布板上选位置':!valid?'这里放不下':'缝在这里';
  $('boardInstruction').classList.toggle('is-error',!!patch&&!!pos&&!valid);
  $('boardInstruction').textContent=!act&&!state.finished?'趁这会儿，想想下一块布放在哪里。':patch?pos?(valid?'位置合适，点击「缝在这里」确认。':'布料不能重叠或超出边界，换一个位置试试。'):'点选布料左上角的位置；R 旋转，F 翻转。':'从下方挑选一块布料，开始你的下一针。';
}
function renderPreview() {
  const preview=$('placementPreview');if(!preview)return;
  const pos=anchor??hover;
  preview.innerHTML=selected&&pos&&canAct()?previewSVG(shape(),pos.x,pos.y,{valid:canPlace(state.players[mainSeat()].board,shape(),pos.x,pos.y)}):'';
  renderSelection();
}
function selectPatch(id) {
  if(!canAct()||state.pendingLeather)return;
  if(tutorial&&(tutorial.step!==0||id!=='p01'))return;
  selected=id;rotation=0;flipped=false;anchor=null;hover=null;
  tutorialEvent('select');renderDraft();renderPreview();updateTutorial();

}
function orient(kind) {
  if(!selected||!canAct()||selected==='leather')return;
  if(kind==='rotate')rotation=(rotation+1)%4;else flipped=!flipped;
  tutorialEvent(kind);renderPreview();updateTutorial();
}
async function commit() {
  if(!selected||!anchor||!canAct())return;
  if(tutorial&&tutorial.step!==3)return;
  const action=selected==='leather'?{type:'leather',...anchor}:{type:'place',patchId:selected,...anchor,rotation,flipped};
  await act(action);
}
async function act(action) {
  if(!canAct())return;
  if(tutorial&&((action.type==='advance'&&tutorial.step!==4)||(action.type==='place'&&tutorial.step!==3)))return;
  try {
    if(mode==='online'&&!tutorial){busy=true;renderSelection();await client.send(action);busy=false;clearSelection();render();}
    else {state=applyAction(state,action);clearSelection();tutorialEvent(action.type);save();render();}
  }catch(error){busy=false;toast(error.message);render();}
}
function scheduleAI() {
  if(aiTimer||mode!=='ai'||tutorial||state.finished||state.current!==1)return;
  aiTimer=setTimeout(()=>{
    aiTimer=null;if(mode!=='ai'||tutorial||state.finished||state.current!==1)return;
    try{state=applyAction(state,chooseAction(state,{difficulty}));clearSelection();save();render();}
    catch(error){toast('AI 暂停：'+error.message);}
  },650);
}

function clearVerification(){roomVerification?.destroy();roomVerification=null;}
function modal(kind,html) {clearVerification();modalKind=kind;$('modal').dataset.view=kind;$('modalContent').innerHTML=html;if(!$('modal').open)$('modal').showModal();}
function closeModal(){clearVerification();$('modal').close();modalKind='';}
function showOpponent() {
  const player=state.players[1-mainSeat()];
  modal('opponent',`<h2 class="modal-title">${esc(player.name)}的拼布</h2><p class="modal-intro">已缝 ${getFilledCount(player)} / 81 格 · 纽扣 ${player.buttons} · 收入 +${player.income} · 时间 ${player.time} / 53</p><div class="large-opponent-board modal-quilt">${boardSVG(player,{prefix:'opponent-detail'})}</div><div class="modal-footer"><span class="opponent-modal-score">${state.finished?'最终':'预计'}得分 ${signed(getScore(player))}</span><button class="primary-button" data-close>回到棋桌</button></div>`);
}
function showMarket() {
  const p=state.players[state.current];
  modal('market',`<h2 class="modal-title">整圈布料，一眼看清。</h2><p class="modal-intro">还剩 ${state.market.length} 块，按市场顺序排列。前 3 块可以购买；后续布料的费用、耗时和收入都在下方。</p><div class="market-overview-grid">${state.market.map((id,i)=>{const patch=getPatch(id),enabled=i<3&&canAct()&&p.buttons>=patch.cost&&legalPlacements(state,id).length>0&&!tutorial;return `<${enabled?'button':'article'} class="market-inspect-card ${i<3?'market-available':'market-later'}" ${enabled?`data-market-pick="${id}"`:''}><span class="patch-name">${esc(patch.name)}<small>${String(i+1).padStart(2,'0')}<i class="patch-badge">${i<3?'可选':'后续'}</i></small></span><span class="patch-art">${patchSVG(patch,{width:142,height:80,prefix:'overview'+i})}</span>${patchAttributes(patch)}</${enabled?'button':'article'}>`;}).join('')}</div>`);
}
function showPatchDetail(id) {
  const patch=getPatch(id),i=state.market.indexOf(id);if(!patch||i<0)return;
  modal('patch',`<h2 class="modal-title">${esc(patch.name)}</h2><p class="modal-intro">市场中的第 ${i+1} 块${i<3?' · 目前可选':' · 后续布料，暂时不能购买'}，覆盖 ${patch.shape.length} 格。</p><div class="large-patch-preview">${patchSVG(patch,{width:320,height:240,prefix:'patch-detail'})}</div>${patchAttributes(patch)}<div class="modal-footer"><button class="outline-button" data-all-market>查看全部布料</button><button class="primary-button" data-close>回到棋桌</button></div>`);
}
function showNewGame() {
  modal('new',`<p class="modal-eyebrow">A FRESH PIECE OF CANVAS</p><h2 class="modal-title">再铺开一张新布。</h2><p class="modal-intro">独自练练手，或者找一位朋友，把这段时光慢慢缝好。开始新局会替换当前练习存档。</p><div class="mode-options"><button class="mode-option" data-new="ai"><span>01</span><span><strong>和缝纫师切磋</strong><small>随时开始，和 AI 完成一局拼布对决</small></span><span>→</span></button><button class="mode-option" data-new="hotseat"><span>02</span><span><strong>坐在一起，轮流缝制</strong><small>共用一个屏幕，双人轮流操作</small></span><span>→</span></button><button class="mode-option" data-open-online><span>03</span><span><strong>邀请远方的朋友</strong><small>创建房间，用安全邀请链接加入</small></span><span>→</span></button></div><label class="difficulty-row">缝纫师的水平<select id="difficultySelect"><option value="easy" ${difficulty==='easy'?'selected':''}>轻松 · 初次拿针</option><option value="normal" ${difficulty==='normal'?'selected':''}>标准 · 熟练缝纫师</option><option value="hard" ${difficulty==='hard'?'selected':''}>挑战 · 精打细算</option></select></label>`);
}
function startLocal(nextMode) {
  if(tutorial)exitTutorial();
  difficulty=$('difficultySelect')?.value??difficulty;
  client.leave();onlineRevision=null;mode=nextMode;state=freshGame(nextMode==='hotseat'?['蓝方','红方']:['你','缝纫师']);
  clearSelection();lastResult=-1;closeModal();save();render();
}
function showRules() {
  modal('rules',`<p class="modal-eyebrow">HOW TO PATCHWORK</p><h2 class="modal-title">好拼布，也要好打算。</h2><p class="modal-intro">两个人各有一张 9 × 9 拼布板。用有限的时间和纽扣，缝出分数更高的一张。</p><ol class="rules-list"><li><strong>时间落后的人先行动。</strong>时间相同，刚到达的玩家先行动，所以不一定轮流。</li><li><strong>选布，或前进。</strong>只能买标记后方的三块布之一；也可以前进到对手前一格，每实际前进一格拿一颗纽扣。</li><li><strong>先摆好，再缝上。</strong>可旋转、翻转，不能重叠或超出棋盘。确认后，支付纽扣并推进时间。</li><li><strong>留意时间轴上的礼物。</strong>经过纽扣领取当前收入；第一个到达皮革标记的玩家获得 1 × 1 补丁，须立即放置。</li><li><strong>完整的 7 × 7，额外加 7 分。</strong>只有第一个填满任意 7 × 7 区域的玩家可以获得。</li><li><strong>两个人到达 53 时结算。</strong>剩余纽扣 + 奖励 − 每空一格 2 分；同分时，先到终点的人胜。</li></ol><p class="rules-source">33 块常规布料的形状、费用、耗时和收入已按经典版组件校准，中文名称和织物图案为原创。时间轴采用经典版官方修订点位，可在拼布面与素色面之间切换。玩法参考 <a href="https://www.lookout-spiele.de/en/games/patchwork.html" target="_blank" rel="noopener">Lookout Spiele 官方规则</a>。</p><div class="modal-footer"><button class="outline-button" data-start-tutorial>亲手学一遍</button><button class="primary-button" data-close>开始缝制</button></div>`);
}
function showLog() {
  modal('log',`<p class="modal-eyebrow">EVERY STITCH COUNTS</p><h2 class="modal-title">针脚记录</h2><p class="modal-intro">这一局的每一次选择，都留在这里。</p><ol class="log-list">${state.log.slice().reverse().map(e=>`<li>${esc(e.text)}</li>`).join('')}</ol>`);
}
function showResult() {
  if(!state.finished||tutorial)return;
  const winner=getWinner(state);
  modal('result',`<p class="modal-eyebrow">THE LAST STITCH</p><h2 class="modal-title">${esc(state.players[winner].name)}缝下了这一局。</h2><p class="modal-intro">不只看填了多少，也要算留下多少。${getScore(state.players[0])===getScore(state.players[1])?'双方同分，先到终点的玩家获胜。':''}</p><div class="result-grid">${state.players.map((p,i)=>`<div class="result-player ${i===winner?'winner':''}"><h3>${esc(p.name)}</h3><strong>${signed(getScore(p))}</strong><p>剩余纽扣　${p.buttons}<br>7 × 7 奖励　${p.bonus?'+7':'0'}<br>空格扣分　−${(81-getFilledCount(p))*2}</p><small>${i===winner?'这一局的获胜者':'下次会缝得更好'}</small></div>`).join('')}</div><div class="modal-footer"><button class="outline-button" data-close>看看拼布</button>${mode==='online'?client.session?.seat===0?'<button class="primary-button" data-rematch>再缝一局</button>':'<span class="modal-intro">等待房主开启新局</span>':'<button class="primary-button" data-new="'+mode+'">再缝一局</button>'}</div>`);
}

function showOnline() {
  const destination=hostedMultiplayerRedirect(location.href);
  if(destination){location.assign(destination);return;}
  if(tutorial)exitTutorial();
  if(client.session){showRoom();return;}
  const {code,inviteKey}=readInvitation(location.href);
  modal('online',`<p class="modal-eyebrow">TWO NEEDLES, ONE TABLE</p><h2 class="modal-title">给朋友留个座位。</h2><p class="modal-intro">创建棋桌后，把完整邀请链接发给朋友。邀请口令会自动随链接带上。</p><div class="room-fields"><label>你在棋桌上的名字<input id="playerName" value="拼布玩家" maxlength="16" autocomplete="nickname"></label><button class="primary-button" data-create-room disabled>创建房间</button></div><div class="field-divider">已经有朋友开好了房间？</div><div class="join-row"><input id="roomCodeInput" value="${esc(code)}" placeholder="6 位房间码" maxlength="6" aria-label="6 位房间码" autocapitalize="characters" spellcheck="false"><button class="outline-button" data-join-room disabled>加入房间</button></div><label class="invite-field">邀请链接或口令<input id="roomInviteInput" value="${esc(inviteKey)}" placeholder="粘贴房主发来的完整邀请链接或口令" autocomplete="off" spellcheck="false" maxlength="512"></label><div class="room-verification" id="roomVerification"></div><p class="verification-status" id="verificationStatus" role="status"></p><p class="room-error" id="roomError" role="status"></p><p class="rules-source">最多 20 张棋桌。未开始的房间 30 分钟后过期。完成验证后即可开房或加入，刷新可以回到原座位。</p>`);
  roomVerification=new RoomVerification($('roomVerification'),(ready,message)=>{
    if($('verificationStatus'))$('verificationStatus').textContent=message;
    $('modalContent').querySelectorAll('[data-create-room],[data-join-room]').forEach(button=>button.disabled=busy||!ready);
  });
  roomVerification.mount();
}
function showRoom() {
  const room=client.room;if(!room)return;
  const host=client.session.seat===0,both=!!room.players[1];
  modal('online',`<p class="modal-eyebrow">YOUR PATCHWORK ROOM</p><h2 class="modal-title">${room.status==='waiting'?'棋桌已经铺好。':'朋友已在棋桌对面。'}</h2><p class="modal-intro">朋友需要完整邀请链接才能入座。请保留各自的窗口，刷新后可以回来继续。</p><div class="room-code">${esc(room.code)}</div>${host&&room.status==='waiting'&&client.session.inviteKey?'<button class="outline-button" data-copy-invite style="width:100%">复制安全邀请链接</button>':''}<div class="seats">${room.players.map((p,i)=>`<div class="seat">${p?esc(p.name):'为朋友留的座位'}<small>${p?(i===client.session.seat?'你 · ':'')+(i===0?'房主':'朋友'):'等待加入'}</small></div>`).join('')}</div><p class="room-error" id="roomError" role="status"></p><div class="modal-footer"><button class="outline-button" data-leave-room>离开房间</button>${room.status==='waiting'?host?`<button class="primary-button" data-start-room ${both?'':'disabled'}>${both?'开始对局':'等待朋友加入'}</button>`:'<button class="primary-button" disabled>等待房主开始</button>':'<button class="primary-button" data-close>回到棋桌</button>'}</div>`);
}
async function roomOperation(operation) {
  if(busy)return;
  busy=true;let failure='';
  const buttons=[...$('modalContent').querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  try {
    await operation();
  }catch(error){failure=error.message;}
  finally{busy=false;if(modalKind==='online'&&client.session)showRoom();else{buttons.forEach(b=>b.disabled=false);roomVerification?.reset();}render();if(failure){if($('roomError'))$('roomError').textContent=failure;else toast(failure);}}
}
client.addEventListener('change',event=>{
  const room=event.detail;if(!room)return;
  if(!tutorial) {
    mode='online';
    if(room.game){const key=room.code+':'+room.revision;if(onlineRevision!==key){state=room.game;clearSelection();onlineRevision=key;}}
    else state=createGame({seed:'waiting',names:room.players.map(p=>p?.name??'等待朋友')});
    if(modalKind==='online'){if(room.status==='playing')closeModal();else showRoom();}
    render();
  }
});
client.addEventListener('connection',()=>{if(mode==='online'&&!tutorial){render();}});
client.addEventListener('error',event=>toast(event.detail));

const lessons=[
  ['先挑一块布。','点击下方第一块「小布条」。只有标记后的三块布料可以选择。','patchChoices'],
  ['换个方向，就有新思路。','点击「旋转」，把横着的小布条转成竖着。','rotateBtn'],
  ['找到第一针的位置。','点击你的拼布板，选择一个空格作为布料的左上角。','mainFrame'],
  ['看准了，就缝在这里。','金色轮廓表示可以放下。点击「缝在这里」完成购买和放置。','placeBtn'],
  ['时间，也是一种资源。','对手还在你前面。点击「前进，领取纽扣」，走到对手前一格。','advanceBtn'],
  ['你已经会缝第一块了。','经过纽扣会领收入，抢到皮革可补单格。现在回到原局，试着把 9 × 9 缝得更满。','exitTutorial'],
];
function startTutorial() {
  if(tutorial){closeModal();return;}
  clearTimeout(aiTimer);aiTimer=null;
  tutorial={backup:{state,mode,difficulty},step:0};
  state=createGame({seed:'learn-to-stitch'});state.market=['p01',...state.market.filter(id=>id!=='p01')];state.players[0].buttons=8;state.players[1].time=3;
  mode='hotseat';clearSelection();closeModal();document.body.classList.add('tutorial-mode');render();

}
function tutorialEvent(event) {
  if(!tutorial)return;
  const expected=['select','rotate','anchor','place','advance'];
  if(expected[tutorial.step]===event)tutorial.step++;
}
function updateTutorial() {
  document.querySelectorAll('.tutorial-target').forEach(el=>el.classList.remove('tutorial-target'));
  $('tutorialBar').hidden=!tutorial;if(!tutorial)return;
  const lesson=lessons[tutorial.step];
  $('tutorialNumber').textContent=String(tutorial.step+1).padStart(2,'0');
  $('tutorialTitle').textContent=lesson[0];$('tutorialText').textContent=lesson[1];
  $(lesson[2])?.classList.add('tutorial-target');$('exitTutorial').textContent=tutorial.step===5?'回到原局':'退出教学';
}
function exitTutorial() {
  if(!tutorial)return;
  const backup=tutorial.backup;tutorial=null;mode=backup.mode;difficulty=backup.difficulty;state=mode==='online'&&client.room?.game?client.room.game:backup.state;
  clearSelection();document.body.classList.remove('tutorial-mode');render();
}

$('patchChoices').addEventListener('click',e=>{const card=e.target.closest('button');if(!card||card.disabled)return;if(card.dataset.inspect)showPatchDetail(card.dataset.inspect);else if(card.dataset.patch)selectPatch(card.dataset.patch);});
$('viewOpponentBtn').onclick=showOpponent;
$('viewMarketBtn').onclick=showMarket;
$('viewTimeBoardBtn').onclick=showTimeBoard;
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-time-side]');if(!button)return;
  timeBoardSide=normalizeTimeBoardSide(button.dataset.timeSide);
  try{localStorage.setItem(BOARD_SIDE_SAVE,timeBoardSide);}catch{}
  renderTime();if(modalKind==='time')showTimeBoard();
});
$('marketPrevBtn').onclick=()=>$('patchChoices').scrollBy({left:-450,behavior:'smooth'});
$('marketNextBtn').onclick=()=>$('patchChoices').scrollBy({left:450,behavior:'smooth'});
$('mainBoard').addEventListener('pointerover',e=>{const cell=e.target.closest('[data-x]');if(cell&&selected&&!anchor){hover={x:+cell.dataset.x,y:+cell.dataset.y};renderPreview();}});
$('mainBoard').addEventListener('pointerleave',()=>{hover=null;renderPreview();});
$('mainBoard').addEventListener('focusin',e=>{const cell=e.target.closest('[data-x]');if(cell&&!anchor){hover={x:+cell.dataset.x,y:+cell.dataset.y};renderPreview();}});
$('mainBoard').addEventListener('keydown',e=>{
  const c=e.target.closest('[data-x]');if(!c)return;
  const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
  if(delta){e.preventDefault();const x=Math.max(0,Math.min(8,+c.dataset.x+delta[0])),y=Math.max(0,Math.min(8,+c.dataset.y+delta[1]));$('mainBoard').querySelector(`[data-x="${x}"][data-y="${y}"]`)?.focus();}
});
$('mainBoard').addEventListener('click',e=>{
  const cell=e.target.closest('[data-x]');if(!cell||!selected||!canAct())return;
  if(tutorial&&tutorial.step<2){toast('先旋转一下布料，再选放置位置。');return;}
  const next={x:+cell.dataset.x,y:+cell.dataset.y};
  if(anchor?.x===next.x&&anchor?.y===next.y){commit();return;}
  anchor=next;tutorialEvent('anchor');renderPreview();updateTutorial();
});
$('rotateBtn').onclick=()=>orient('rotate');$('flipBtn').onclick=()=>orient('flip');$('placeBtn').onclick=commit;
$('advanceBtn').onclick=()=>act({type:'advance'});
$('newGameBtn').onclick=showNewGame;$('onlineBtn').onclick=showOnline;$('tutorialBtn').onclick=startTutorial;$('rulesBtn').onclick=showRules;$('logBtn').onclick=showLog;$('exitTutorial').onclick=exitTutorial;$('tableNav').onclick=()=>{if($('modal').open)closeModal();};
$('modal').addEventListener('close',()=>{clearVerification();modalKind='';});
$('modal').addEventListener('click',event=>{if(event.target===$('modal')){const r=$('modal').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeModal();}});
$('modalContent').addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button||button.disabled)return;
  if(button.hasAttribute('data-new'))startLocal(button.dataset.new);
  else if(button.hasAttribute('data-open-online'))showOnline();
  else if(button.hasAttribute('data-close'))closeModal();
  else if(button.hasAttribute('data-all-market'))showMarket();
  else if(button.hasAttribute('data-market-pick')){const id=button.dataset.marketPick;closeModal();selectPatch(id);}
  else if(button.hasAttribute('data-start-tutorial'))startTutorial();
  else if(button.hasAttribute('data-create-room')){const name=$('playerName').value;roomOperation(()=>client.create(name,roomVerification.take()));}
  else if(button.hasAttribute('data-join-room')){const name=$('playerName').value,code=$('roomCodeInput').value,invite=$('roomInviteInput').value;roomOperation(()=>client.join(code,name,invite,roomVerification.take()));}
  else if(button.hasAttribute('data-start-room'))roomOperation(()=>client.start());
  else if(button.hasAttribute('data-rematch'))roomOperation(async()=>{lastResult=-1;await client.rematch();closeModal();});
  else if(button.hasAttribute('data-leave-room')){client.leave();onlineRevision=-1;loadLocal();clearSelection();closeModal();render();}
  else if(button.hasAttribute('data-copy-invite')){
    const url=new URL(invitationURL(location.origin+location.pathname,client.session.code,client.session.inviteKey));
    navigator.clipboard.writeText(url.href).then(()=>toast('邀请链接已复制，发给你的朋友吧。')).catch(()=>{modal('invite',`<h2 class="modal-title">复制这段邀请链接</h2><input style="width:100%" readonly value="${esc(url.href)}" aria-label="邀请链接"><div class="modal-footer"><button class="primary-button" data-open-online>回到房间</button></div>`);});
  }
});
document.addEventListener('keydown',event=>{
  if($('modal').open||/INPUT|SELECT|TEXTAREA/.test(event.target.tagName))return;
  if(event.key.toLowerCase()==='r'){event.preventDefault();orient('rotate');}
  if(event.key.toLowerCase()==='f'){event.preventDefault();orient('flip');}
  if(event.key==='Escape'){if(tutorial)return;if(!state.pendingLeather){clearSelection();renderDraft();renderPreview();}}
});

loadLocal();save();render();
if(classicUpgrade)toast(classicUpgrade);
const entryParams=new URL(location.href).searchParams;
const wantsOnline=entryParams.has('room')||entryParams.get('online')==='1';
const hostedDestination=hostedMultiplayerRedirect(location.href);
if(hostedDestination){if(wantsOnline)location.replace(hostedDestination);}
else client.restore().then(restored=>{if(!restored&&wantsOnline)showOnline();});
