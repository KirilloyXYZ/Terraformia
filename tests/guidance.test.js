"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const E=require("../engine.js");
const G=require("../guidance.js");

function at(state,item) {
  state.rover.x=item.x+.5;
  state.rover.y=item.y+.5;
}

function command(state,value) {
  const result=E.dispatch(state,value);
  assert.ok(result.ok,result.message);
}

function wait(state,seconds) {
  for(let i=0;i<Math.round(seconds/E.STEP);i++)E.tick(state,E.STEP);
}

test("карточка лёд/руда показывает фактический свободный объём и выгрузку",()=>{
  const state=E.newGame();
  const ore=E.DEPOSITS[0];
  at(state,ore);
  state.rover.cargo.ice=3;
  const target=G.nearby(state);
  assert.ok(target.available);
  assert.equal(target.command.id,ore.id);
  assert.match(target.detail,/\+5/);
  command(state,target.command);
  assert.equal(state.rover.cargo.ore,5);
  assert.equal(G.nearby(state).available,false);
  assert.match(G.nearby(state).reason,/Груз полон/);
  at(state,E.SITES.city);
  assert.equal(G.nearby(state).command.type,"unload");
  command(state,G.nearby(state).command);
  assert.equal(state.bases[0].stock.ore,5);
  assert.equal(state.bases[0].stock.ice,3);
  assert.equal(G.nearby(state),null);
  at(state,{x:46,y:0});
  assert.equal(G.nearby(state),null);
});

test("маркер строительства предлагает допустимые клетки и не меняет состояние",()=>{
  const state=E.newGame();
  for(const type of ["solar","refinery","battery","sector","habitat"]) {
    const before=JSON.stringify(state);
    const objective=G.current(state);
    assert.equal(JSON.stringify(state),before);
    assert.equal(objective.shortcut?.building,type);
    assert.ok(objective.target);
    at(state,objective.target);
    assert.equal(E.checkBuild(state,type,objective.target.x,objective.target.y).message,undefined);
    command(state,{type:"build",building:type,x:objective.target.x,y:objective.target.y});
  }
  assert.match(G.current(state).title,/Добудь руду|Построй/);
});

test("рецепт комнаты учитывает новый сектор только когда он нужен",()=>{
  const state=E.newGame(), base=state.bases[0];
  base.stock.parts=6;
  const before=JSON.stringify(state);
  let req=G.requirements(state,base,"greenhouse");
  assert.deepEqual([req.available,req.required,req.missing,req.next,req.missingNext],[6,9,3,"sector",0]);
  assert.equal(req.needsSector,true);
  const step=G.constructionGoal(state,base,"greenhouse");
  assert.equal(step.shortcut.building,"sector");
  assert.equal(step.requirement.type,"greenhouse");
  assert.equal(step.target.kind,"build");
  assert.equal(JSON.stringify(state),before,"Просмотр рецепта не тратит детали");
  at(state,step.target);
  command(state,{type:"build",building:"sector",x:step.target.x,y:step.target.y});
  req=G.requirements(state,base,"greenhouse");
  assert.deepEqual([req.available,req.required,req.missing,req.next,req.slots],[1,4,3,"greenhouse",1]);
  base.stock.parts+=3;
  const room=G.constructionGoal(state,base,"greenhouse");
  assert.equal(room.shortcut.building,"greenhouse");
  assert.deepEqual([room.target.x,room.target.y],[step.target.x,step.target.y]);
  command(state,{type:"build",building:"greenhouse",x:room.target.x,y:room.target.y});
  assert.equal(base.stock.parts,0);
  assert.equal(G.requirements(state,base,"habitat").required,10);
  assert.equal(G.requirements(state,base,"solar").required,0,"Стартовый модуль бесплатен");
});

test("недостающие детали ведут по реальной цепочке добычи и производства",()=>{
  const state=E.newGame(), base=state.bases[0];
  // Deploy the starter kit and leave the colony short of the full greenhouse bill.
  for(const type of ["solar","refinery"]) {
    const s=G.constructionGoal(state,base,type);
    at(state,s.target);command(state,{type:"build",building:type,x:s.target.x,y:s.target.y});
  }
  base.stock.parts=6;
  let step=G.constructionGoal(state,base,"greenhouse",true);
  assert.equal(step.title,"Добудь руду");
  assert.equal(step.target.kind,"ore");
  assert.match(step.detail,/ещё 3 дет/);
  at(state,step.target);command(state,G.nearby(state).command);
  step=G.constructionGoal(state,base,"greenhouse",true);
  assert.equal(step.target.kind,"unload");
  at(state,step.target);command(state,G.nearby(state).command);
  wait(state,1);
  step=G.constructionGoal(state,base,"greenhouse",true);
  assert.equal(step.target.kind,"production");
  wait(state,16);
  assert.ok(base.stock.parts>=9);
  step=G.constructionGoal(state,base,"greenhouse",true);
  assert.equal(step.shortcut.building,"sector");
});

test("подсветка доступных клеток совпадает с валидатором и не расходует материалы",()=>{
  const state=E.newGame(), base=state.bases[0];
  const before=JSON.stringify(state);
  const cells=G.placementCells(state,base,"sector");
  assert.ok(cells.length>0);
  for(const cell of cells)assert.equal(E.checkBuild(state,"sector",cell.x,cell.y).message,undefined);
  assert.equal(JSON.stringify(state),before);
  assert.equal(G.placementCells(state,base,"greenhouse").length,0);
  at(state,cells[0]);command(state,{type:"build",building:"sector",...cells[0]});
  assert.deepEqual(G.placementCells(state,base,"greenhouse"),[cells[0]]);
  base.stock.parts=0;
  assert.equal(G.placementCells(state,base,"greenhouse").length,0);
});

test("прогресс переработки показывает фактический цикл и недостающее снабжение",()=>{
  const state=E.newGame(), base=state.bases[0];
  for(const type of ["solar","refinery"]) {
    const s=G.constructionGoal(state,base,type);at(state,s.target);
    command(state,{type:"build",building:type,x:s.target.x,y:s.target.y});
  }
  const refinery=base.buildings.find(b=>b.type==="refinery");
  assert.equal(G.production(state,base,refinery).reason,"Нет сырья");
  base.stock.ore=1;wait(state,2);
  let p=G.production(state,base,refinery);
  assert.equal(p.running,true);assert.equal(p.recipe,"Руда → 1 деталь");
  assert.equal(p.percent,40);assert.equal(p.remaining,3);
  at(state,refinery);command(state,{type:"equipment",action:"toggle",x:refinery.x,y:refinery.y});
  wait(state,2);p=G.production(state,base,refinery);
  assert.equal(p.reason,"Пауза");assert.equal(p.percent,40);
  command(state,{type:"equipment",action:"toggle",x:refinery.x,y:refinery.y});wait(state,3);
  assert.equal(base.stock.parts,19);assert.equal(G.production(state,base,refinery).reason,"Нет сырья");
});

test("недоступное взаимодействие объясняет недостаточные ресурсы для заселения",()=>{
  const state=E.newGame(), base=state.bases[0];
  state.crew=true;
  base.stock.parts=30;
  at(state,{x:12,y:15});
  command(state,{type:"build",building:"sector",x:12,y:15});
  command(state,{type:"build",building:"habitat",x:12,y:15});
  assert.equal(G.nearby(state).available,false);
  assert.match(G.nearby(state).reason,/16/);
  base.temp=22;
  base.buildings[0].room.powered=true;
  assert.match(G.nearby(state).reason,/2 ед/);
  base.stock.water=base.stock.food=3;
  assert.equal(G.nearby(state).available,true);
  command(state,G.nearby(state).command);
  assert.ok(base.buildings[0].room.occupied);
});

test("навигация ведёт к разведке и к реальному маршруту второй базы",()=>{
  const state=E.newGame();
  state.chapter=3;
  state.crew=true;
  assert.equal(G.current(state).title,"Обследуй Марс");
  assert.ok(G.current(state).target);
  state.explored.push("plateau");
  assert.equal(G.current(state).title,"Выбери второе поселение");
  command(state,{type:"site",id:"plateau"});
  assert.equal(G.current(state).shortcut.type,"drones");
  assert.match(G.current(state).detail,/детали/);
  at(state,E.SITES.city);
  const result=E.dispatch(state,{type:"makeDrone",kind:"cargo",base:"city"});
  assert.ok(result.ok);
  command(state,{type:"route",id:result.id,source:"city",target:"plateau",resource:"parts"});
  assert.match(G.current(state).title,/Дождись доставки/);
  wait(state,20);
  const next=E.byId(state,"plateau");
  assert.ok(next);
  assert.equal(G.current(state).shortcut?.base,"plateau");
});

test("первый купол можно подготовить и пройти, следуя текущим целям",()=>{
  const state=E.newGame();
  const base=state.bases[0];
  for(let attempt=0;attempt<1500 && !state.trial;attempt++) {
    const objective=G.current(state);
    const shortcut=objective.shortcut;
    if(shortcut?.type==="build") {
      assert.ok(objective.target);
      at(state,objective.target);
      command(state,{type:"build",building:shortcut.building,x:objective.target.x,y:objective.target.y});
    } else if(["Добудь руду","Найди лёд","Выгрузи сырьё"].includes(objective.title)) {
      at(state,objective.target);
      command(state,G.nearby(state).command);
    } else if(objective.title==="Сохрани запасы перед ночью") {
      at(state,objective.target);
      command(state,{type:"equipment",action:"toggle",x:objective.target.x,y:objective.target.y});
    } else if(shortcut?.type==="trial") {
      assert.ok(E.objectives(state).every(item=>item.done));
      command(state,{type:"trial"});
      break;
    }
    wait(state,3);
  }
  assert.ok(state.trial,JSON.stringify({objective:G.current(state),stock:base.stock,charge:base.charge,temp:base.temp}));
  const until=state.trial.end-state.elapsed;
  wait(state,until+1);
  assert.equal(state.chapter,2,JSON.stringify(state.firstResult));
});
