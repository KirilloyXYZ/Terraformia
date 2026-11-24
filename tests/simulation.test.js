"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../engine.js");

test("плавный разгон не зависит от частоты кадров, а диагональ сохраняет скорость", () => {
  const atFps = (fps, input) => {
    const rover = E.newGame().rover;
    for (let i = 0; i < fps; i++) E.driveRover(rover, input, 1 / fps);
    return rover;
  };
  const initial = E.newGame().rover;
  const held = atFps(60, { x:1, y:0 });
  const highRefresh = atFps(144, { x:1, y:0 });
  const diagonal = atFps(60, { x:1, y:1 });
  const slow = atFps(60, { x:1, y:0, slow:true });
  assert.ok(Math.abs(held.x - highRefresh.x) < 1e-8);
  assert.ok(Math.abs(held.x - initial.x - Math.hypot(diagonal.x - initial.x, diagonal.y - initial.y)) < 1e-8);
  assert.ok(slow.x - initial.x < 0.4 * (held.x - initial.x));
  const startSpeed = E.driveRover(initial, { x:1 }, 1 / 60);
  assert.ok(startSpeed > 0 && startSpeed < E.DRIVE_SPEED / 2);
});

test("после отпускания клавиши ровер мягко останавливается в пределах клетки", () => {
  const rover = E.newGame().rover;
  E.driveRover(rover, { x:1 }, 1);
  const x = rover.x;
  const braking = E.driveRover(rover, {}, 1 / 60);
  assert.ok(braking > 0 && braking < E.DRIVE_SPEED);
  for (let i = 0; i < 52; i++) E.driveRover(rover, {}, 1 / 60);
  assert.equal(rover.vx, 0);
  assert.ok(rover.x > x && rover.x - x < 0.25);
});

function command(state, args) {
  const result = E.dispatch(state,args);
  assert.equal(result.ok,true,`${JSON.stringify(args)} · ${result.message}`);
  return result;
}

function seconds(state, span) {
  const events = [];
  for (let i=0; i<Math.round(span/E.STEP); i++) {
    for (const event of E.tick(state,E.STEP)) events.push(event);
  }
  return events;
}

function until(state, condition, limit, label) {
  for (let elapsed=0; elapsed<=limit; elapsed+=E.STEP) {
    if (condition()) return;
    E.tick(state,E.STEP);
  }
  const info = state.bases.map(base=>({
    id:base.id, stock:base.stock, temp:base.temp, charge:base.charge, load:base.telemetry.load,
    facilities:base.buildings.map(b=>b.room||b.type)
  }));
  assert.fail(`${label}: сол ${E.weather(state).sol}, ${state.elapsed}s, глава ${state.chapter} · ${JSON.stringify(info)}`);
}

function travel(state, x, y) {
  for (let step=0; step<180; step++) {
    const dx=x+.5-state.rover.x, dy=y+.5-state.rover.y;
    if (Math.hypot(dx,dy)<.035) break;
    E.tick(state,E.STEP,{x:dx/(4.35*E.STEP),y:dy/(4.35*E.STEP)});
  }
  assert.ok(Math.hypot(x+.5-state.rover.x,y+.5-state.rover.y)<.05,`cannot reach ${x},${y}`);
}

function build(state, building, x, y) {
  travel(state,x,y);
  command(state,{type:"build",building,x,y});
}

function equip(state, action, x, y, mode) {
  travel(state,x,y);
  command(state,{type:"equipment",action,x,y,mode});
}

function load(state, id, base, trips=1) {
  const deposit=E.DEPOSITS.find(item=>item.id===id);
  for(let trip=0; trip<trips; trip++){
    travel(state,deposit.x,deposit.y);
    command(state,{type:"mine",id});
    travel(state,E.location(base).x,E.location(base).y);
    command(state,{type:"unload",id:base});
  }
}

function battery(state,base) {
  return E.powerEstimate(state,base).capacity;
}

function addDrone(state, kind, source, target, resource) {
  travel(state,E.SITES.city.x,E.SITES.city.y);
  const {id}=command(state,{type:"makeDrone",base:"city",kind});
  command(state,{type:"route",id,source,target,resource});
  return id;
}

function firstDome() {
  const state=E.newGame();
  const base=state.bases[0];
  build(state,"solar",10,14);
  build(state,"refinery",12,14);
  build(state,"battery",11,14);
  build(state,"sector",12,15);
  load(state,"valley-ore","city");
  until(state,()=>base.stock.parts>=15,88,"переработка руды");
  build(state,"sector",12,16);
  build(state,"habitat",12,15);
  build(state,"greenhouse",12,16);
  load(state,"valley-ice","city",2);
  until(state,()=>base.stock.food>=4 && base.stock.water>=3,160,"первый урожай и запасы");
  equip(state,"toggle",12,16);
  until(state,()=>base.charge>=13.5 && base.temp>=16,550,"заряд первого аккумулятора");
  command(state,{type:"trial"});
  const original=state.trial;
  until(state,()=>state.chapter===2 || state.firstResult?.success===false,680,"прохождение первой ночи");
  assert.equal(state.chapter,2,JSON.stringify(state.firstResult)+" · "+JSON.stringify(original));
  assert.equal(state.crew,true);
  assert.equal(base.buildings.find(b=>b.x===12&&b.y===15).room.occupied,true);
  equip(state,"clean",10,14);
  return state;
}

function makeCity(state) {
  const base=state.bases[0];
  // Keep the city powered while new sectors increase the nightly load.
  load(state,"valley-ore","city",2);
  equip(state,"mode",12,14,"ore");
  until(state,()=>base.stock.parts>=10,125,"материалы на вторую панель и аккумулятор");
  build(state,"solar",10,15);
  build(state,"battery",10,16);
  load(state,"valley-ore","city",9);
  until(state,()=>base.stock.parts>=45,410,"материалы на расширение города");
  build(state,"sector",13,15);
  build(state,"sector",13,16);
  build(state,"habitat",13,15);
  build(state,"greenhouse",13,16);
  for(const [x,y] of [[12,15],[12,16],[13,15],[13,16]])build(state,"insulation",x,y);
  const ore=addDrone(state,"mine","valley-ore","city");
  const ice=addDrone(state,"mine","valley-ice","city");
  load(state,"valley-ice","city",3);
  if (!base.buildings.find(b=>b.x===12&&b.y===16).room.enabled) equip(state,"toggle",12,16);
  equip(state,"mode",12,14,"ice");
  until(state,()=>base.stock.water>=4 && base.stock.food>=8 && base.temp>=16 && base.telemetry.life,350,"снабжение и заселение города");
  equip(state,"occupy",13,15);
  until(state,()=>state.chapter===3,360,"город и автоматический рейс");
  return {ore,ice};
}

function foundOutpost(state, site) {
  const depot=E.SITES[site];
  travel(state,depot.x,depot.y);
  command(state,{type:"site",id:site});
  const source=state.bases[0];
  equip(state,"toggle",12,16);
  equip(state,"toggle",13,16);
  equip(state,"mode",12,14,"ore");
  until(state,()=>source.stock.parts>=54,340,"груз деталей для второго поселения");
  const cargo=addDrone(state,"cargo","city",site,"parts");
  until(state,()=>E.byId(state,site)?.stock.parts>=45,180,"развёртывание складского терминала");
  command(state,{type:"holdDrone",id:cargo});
  const outpost=E.byId(state,site);
  const {x,y}=depot;
  build(state,"solar",x-1,y);
  build(state,"solar",x-2,y);
  build(state,"battery",x-1,y-1);
  build(state,"sector",x+1,y);
  build(state,"sector",x+1,y+1);
  build(state,"habitat",x+1,y);
  build(state,"greenhouse",x+1,y+1);
  if(site==="basin") {
    build(state,"refinery",x-1,y+1);
    load(state,"basin-ice",site,5);
  }
  equip(state,"mode",12,14,"ice");
  load(state,"valley-ice","city",4);
  if(site==="plateau") {
    until(state,()=>source.stock.water>=20,390,"запас воды для плато");
    command(state,{type:"route",id:cargo,source:"city",target:site,resource:"water"});
  }
  until(state,()=>outpost.stock.water>=3 && outpost.stock.food>=4 && outpost.temp>=16 && outpost.telemetry.life,460,"тепло и запасы второго купола");
  equip(state,"occupy",x+1,y);
  until(state,()=>state.chapter===4,5,"открытие большой бури");
  return {outpost,cargo};
}

function prepareFinal(state,outpost) {
  const first=state.bases[0], site=E.SITES[outpost.id];
  // Produce a demonstrable reserve on both bases, then prioritize critical loads.
  const farm = (x,y)=>first.buildings.find(b=>b.x===x&&b.y===y).room;
  if(!farm(12,16).enabled)equip(state,"toggle",12,16);
  if(!farm(13,16).enabled)equip(state,"toggle",13,16);
  equip(state,"mode",12,14,"ice");
  load(state,"valley-ice","city",5);
  if(outpost.id==="basin") load(state,"basin-ice","basin",4);
  command(state,{type:"auto",base:"city"});
  command(state,{type:"auto",base:outpost.id});
  if(outpost.id==="plateau") {
    const freight=state.drones.find(d=>d.kind==="cargo");
    until(state,()=>outpost.stock.water>=28,780,"водный резерв плато");
    command(state,{type:"holdDrone",id:freight.id});
  }
  until(state,()=>first.stock.food>=15 && first.stock.water>=13 && outpost.stock.food>=10 && outpost.stock.water>=8 &&
    E.weather(state).clock<100 && E.weather(state).clock>=14 && first.temp>=17 && outpost.temp>=17,1650,"резерв обеих баз к прогнозу");

  command(state,{type:"trial"});
  for (const [base,positions] of [[first,[[12,16],[13,16]]],[outpost,[[site.x+1,site.y+1]]]]) {
    if (base.auto) command(state,{type:"auto",base:base.id});
    for(const [x,y] of positions) {
      if(base.buildings.find(b=>b.x===x&&b.y===y).room.enabled)equip(state,"toggle",x,y);
    }
  }
  for(const base of [first,outpost]) {
    const factory=base.buildings.find(b=>b.type==="refinery"&&b.enabled);
    if(factory)equip(state,"toggle",factory.x,factory.y);
  }
  const events = seconds(state,state.trial.warn-state.elapsed+.1);
  assert.ok(events.includes("checkpoint"));
  assert.equal(state.trial.phase,"warning");
  assert.ok(E.validateState(JSON.parse(JSON.stringify(state))));
  return E.clone(state);
}

test("ресурсы, подключение сектора и отказ строительства без списания",()=>{
  const s=E.newGame(), base=s.bases[0];
  assert.equal(E.dispatch(s,{type:"build",building:"sector",x:10,y:17}).ok,false);
  assert.equal(base.stock.parts,18);
  build(s,"solar",10,14);
  build(s,"refinery",12,14);
  assert.equal(base.stock.parts,18);
  load(s,"valley-ore","city");
  seconds(s,40.2);
  assert.equal(base.stock.parts,26);
  assert.equal(base.stock.ore,0);
  build(s,"battery",11,14);
  build(s,"sector",12,15);
  build(s,"sector",12,16);
  build(s,"habitat",12,15);
  build(s,"greenhouse",12,16);
  assert.equal(base.stock.parts,1);
  const before=E.clone(base.stock);
  const result=E.dispatch(s,{type:"build",building:"solar",x:12,y:17});
  assert.equal(result.ok,false);
  assert.deepEqual(base.stock,before);
});

test("дневная буря, запыление и очистка панели восстанавливают 8 ед.",()=>{
  const s=E.newGame(), b=s.bases[0];
  build(s,"solar",10,14);
  s.trial={kind:"first",phase:"warning",warn:120,start:180,stormEnd:225,end:360,cleared:false,failure:null};
  s.elapsed=179.9;
  seconds(s,.2);
  assert.equal(b.telemetry.generation,3.2);
  seconds(s,45);
  assert.equal(b.telemetry.generation,6);
  equip(s,"clean",10,14);
  seconds(s,.1);
  assert.equal(b.telemetry.generation,8);
});

test("ночь останавливает генерацию, разряд охлаждает купол",()=>{
  const s=E.newGame(), b=s.bases[0];
  build(s,"solar",10,14);
  build(s,"battery",11,14);
  build(s,"sector",12,15);
  build(s,"habitat",12,15);
  s.elapsed=240;b.temp=22;b.charge=8;
  seconds(s,60);
  assert.equal(b.telemetry.generation,0);
  assert.ok(Math.abs(b.charge-4)<1e-6);
  assert.equal(b.temp,22);
  b.charge=0;
  seconds(s,30);
  assert.ok(Math.abs(b.temp-20)<1e-6);
});

test("Алекс разгружает сеть при дефиците, возобновляет работу и уступает управление",()=>{
  const s=E.newGame(), b=s.bases[0];
  b.stock.parts=40;
  build(s,"solar",10,14);
  build(s,"refinery",12,14);
  build(s,"battery",11,14);
  build(s,"sector",12,15);
  build(s,"sector",12,16);
  build(s,"habitat",12,15);
  build(s,"greenhouse",12,16);
  s.crew=true;b.temp=22;b.stock.ice=24;b.stock.water=15;
  s.elapsed=270;b.charge=16;
  command(s,{type:"auto",base:"city"});
  assert.equal(s.log.length,0);
  b.charge=4;
  seconds(s,2);
  assert.ok(s.log.some(entry=>entry.kind==="alex" && /Приостановил/.test(entry.text)));
  const ref=b.buildings.find(item=>item.type==="refinery");
  assert.equal(ref.override,"off");
  b.charge=16;s.elapsed=320;
  seconds(s,2);
  assert.equal(ref.override,null);
  assert.ok(s.log.some(entry=>entry.kind==="alex" && /Вернул/.test(entry.text)));
  command(s,{type:"auto",base:"city"});
  const lines=s.log.length;b.charge=0;
  seconds(s,4);
  assert.equal(s.log.length,lines);
});

test("груз сохраняется при паузе, отзыве и восстановлении снимка",()=>{
  let s=E.newGame();s.crew=true;s.chapter=3;s.selectedSite="basin";s.bases[0].stock.parts=14;
  const droneId=addDrone(s,"cargo","city","basin","parts");
  seconds(s,1);
  assert.equal(s.drones[0].cargo,8);
  assert.equal(s.bases[0].stock.parts,0);
  command(s,{type:"holdDrone",id:droneId});
  const restored=JSON.parse(JSON.stringify(s));
  assert.ok(E.validateState(restored));
  s=restored;
  const progress=s.drones[0].progress;
  seconds(s,20);
  assert.equal(s.drones[0].progress,progress);
  assert.equal(s.drones[0].cargo,8);
  command(s,{type:"recallDrone",id:droneId});
  seconds(s,3);
  assert.equal(s.drones[0].paused,true);
  assert.equal(s.drones[0].cargo,8);
  command(s,{type:"holdDrone",id:droneId});
  seconds(s,40);
  assert.equal(s.bases[1].stock.parts,8);
  assert.equal(s.drones[0].cargo,0);
});

test("кампания от новой игры: низина, отказ второй базы, повтор и победа",()=>{
  const state=firstDome();
  makeCity(state);
  const {outpost}=foundOutpost(state,"basin");
  const checkpoint=prepareFinal(state,outpost);
  const fail=E.clone(checkpoint);
  E.byId(fail,"basin").charge=0;
  E.byId(fail,"basin").stock.food=0;
  until(fail,()=>fail.finalResult,230,"сбой второй колонии");
  assert.equal(fail.finalResult.success,false);
  assert.equal(fail.finalResult.base,"basin");
  const retry=JSON.parse(JSON.stringify(checkpoint));
  until(retry,()=>retry.finalResult,235,"финальный рассвет в низине");
  assert.equal(retry.finalResult.success,true,JSON.stringify(retry.finalResult));
  assert.equal(retry.finalResult.colonies.length,2);
});

test("кампания от новой игры: плато, импорт воды и победа обеих баз",()=>{
  const state=firstDome();
  makeCity(state);
  const {outpost}=foundOutpost(state,"plateau");
  const checkpoint=prepareFinal(state,outpost);
  until(checkpoint,()=>checkpoint.finalResult,235,"финальный рассвет на плато");
  assert.equal(checkpoint.finalResult.success,true,JSON.stringify(checkpoint.finalResult));
  assert.ok(checkpoint.finalResult.colonies.every(base=>base.temp>=16 && base.water>0));
});
