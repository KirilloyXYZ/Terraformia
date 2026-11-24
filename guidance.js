(function () {
  "use strict";
  const E = typeof module === "object" && module.exports ? require("./engine.js") : globalThis.TerraformiaEngine;
  const totalCargo = state => state.rover.cargo.ore + state.rover.cargo.ice;
  const close = (state, item) => E.entityDist(state.rover,item) <= E.REACH;
  const closest = (state, items) => [...items].sort((a,b)=>E.entityDist(state.rover,a)-E.entityDist(state.rover,b))[0];
  const rooms = (base, type) => base.buildings.filter(item=>item.room?.type===type);
  const count = (base,type) => base.buildings.filter(item=>item.type===type).length;
  const affordable = (base,amount) => base.stock.parts + E.EPS >= amount;
  const rounded = value => Math.max(0,Math.floor(value+E.EPS));
  const goal = (title,detail,target=null,shortcut=null) => ({title,detail,target,shortcut});
  const marker = (item,label,kind="goal",tag="") => item ? {x:item.x,y:item.y,label,kind,tag} : null;

  // The bill is for the intended building, including a prerequisite sector only
  // if there is no suitable existing one. Costs and stock are always the engine's.
  function requirements(state,base,type) {
    const room=type==="greenhouse"||type==="habitat";
    const insulation=type==="insulation";
    const slots=base.buildings.filter(item=>item.type==="sector"&&(insulation?!item.insulated:!item.room));
    const needsSector=(room||insulation)&&!slots.length;
    const cost=E.costOf(state,base,type), required=cost+(needsSector?E.costOf(state,base,"sector"):0);
    const next=needsSector?"sector":type, nextCost=E.costOf(state,base,next);
    const available=rounded(base.stock.parts);
    return {type,base:base.id,cost,required,available,missing:Math.max(0,required-available),
      next,nextCost,missingNext:Math.max(0,nextCost-available),room,insulation,needsSector,slots:slots.length,
      locked:insulation&&!state.crew,included:!cost,ready:available>=required&&!needsSector&&(!insulation||state.crew)};
  }

  // Only mark cells accepted by the real build validator, not merely by the grid.
  function placementCells(state,base,type) {
    if(!base||!E.TYPES[type])return [];
    const cells=[], [left,top,right,bottom]=E.SITES[base.id].bounds;
    for(let y=Math.max(top,Math.floor(state.rover.y-E.REACH-1));y<=Math.min(bottom,Math.ceil(state.rover.y+E.REACH));y++) {
      for(let x=Math.max(left,Math.floor(state.rover.x-E.REACH-1));x<=Math.min(right,Math.ceil(state.rover.x+E.REACH));x++) {
        if(close(state,{x,y})&&!E.checkBuild(state,type,x,y).message)cells.push({x,y});
      }
    }
    return cells;
  }

  // Read the actual production cycle, including a batch that already consumed
  // its input and is suspended because of cold, power or a manual pause.
  function production(state,base,building) {
    const item=building.room||building;
    if(item.type!=="greenhouse"&&item.type!=="refinery")return null;
    const farm=item.type==="greenhouse", total=farm?30:5;
    const input=item.input||E.feedFor(base.stock,item);
    const progress=Math.max(0,Math.min(total,Number(item.progress)||0));
    const recipe=farm?"Вода → 2 пищи":input==="ore"||!input&&item.mode==="ore"?"Руда → 1 деталь":
      input==="ice"||!input&&item.mode==="ice"?"Лёд → 1 вода":"Лёд / руда → вода / детали";
    let reason="";
    if(item.override==="off")reason="Алекс остановил";
    else if(!item.enabled)reason="Пауза";
    else if(farm&&base.temp+E.EPS<E.SAFE_TEMP)reason="Нужно +16 °C";
    else if(!input)reason=farm?"Нет воды":item.mode==="ore"?"Нет руды":item.mode==="ice"?"Нет льда":"Нет сырья";
    else if(!item.powered)reason="Нет питания";
    return {label:farm?"Теплица":"Переработчик",recipe,progress,total,percent:Math.min(100,Math.floor(progress/total*100+E.EPS)),
      remaining:Math.max(1,Math.ceil(total-progress-E.EPS)),running:!reason,reason,input,building};
  }

  function cargoText(cargo) {
    return [["ice","лёд"],["ore","руда"]].filter(([key])=>cargo[key]>0)
      .map(([key,label])=>`${label} ${cargo[key]}`).join(" · ");
  }

  function nearby(state) {
    const amount=totalCargo(state);
    const free=E.CARGO_CAP-amount;
    const weather=E.weather(state);
    const entries=[];
    function add(item,key,label,detail,command,reason="") {
      const distance=E.entityDist(state.rover,item);
      if(distance<=E.REACH) entries.push({item,key,label,detail,command,reason,distance,available:!reason});
    }
    for(const depot of [...state.bases.map(base=>E.SITES[base.id]),...(state.crew?[E.PAD]:[])]) {
      // An empty depot has no useful action; leave the map open for construction.
      if(amount>0) add(depot,`unload:${depot.id}`,"Выгрузить ресурсы",cargoText(state.rover.cargo),{type:"unload",id:depot.id});
    }
    for(const deposit of E.DEPOSITS) {
      if(!E.accessibleDeposit(state,deposit))continue;
      const ice=deposit.type==="ice";
      add(deposit,`mine:${deposit.id}`,ice?"Добыть лёд":"Добыть руду",
        `+${free} ${ice?"льда":"руды"} · груз ${amount}/${E.CARGO_CAP}`,
        {type:"mine",id:deposit.id},free<1?"Груз полон. Вернись к складу.":"");
    }
    for(const base of state.bases) for(const item of base.buildings) {
      const id=`${item.x},${item.y}`;
      if(item.type==="solar" && item.dirty) {
        add(item,`clean:${id}`,"Очистить панель","Восстановить дневную выработку",
          {type:"equipment",action:"clean",x:item.x,y:item.y},weather.storm?"Дождись окончания бури.":"");
      }
      if(state.crew && item.room?.type==="habitat" && !item.room.occupied) {
        const reason=base.temp<E.SAFE_TEMP?"Прогрей купол до +16 °C.":!item.room.powered?"Нужно питание жилого отсека.":
          base.stock.water<2-E.EPS||base.stock.food<2-E.EPS?"Нужно по 2 ед. воды и пищи.":"";
        add(item,`occupy:${id}`,"Заселить отсек","Прибудут два поселенца",
          {type:"equipment",action:"occupy",x:item.x,y:item.y},reason);
      }
    }
    entries.sort((a,b)=>a.distance-b.distance);
    const nearest=entries[0],available=entries.find(entry=>entry.available);
    return available&&available.distance<=nearest.distance+.65?available:nearest||null;
  }

  function readiness(state,base) {
    const conditions=E.weather(state);
    const power=E.powerEstimate(state,base);
    const nightSeconds=conditions.night?conditions.sunrise:E.SOL-E.DAY;
    const window=state.trial?Math.max(0,state.trial.end-Math.max(state.elapsed,state.trial.warn)):225;
    const needed=state.chapter===1?2:Math.max(2,Math.ceil(power.occupants/2*window/60));
    const values=[
      {label:"Тепло",value:Math.round(base.temp)+" °C",ok:base.temp>=E.SAFE_TEMP-E.EPS && base.telemetry.life},
      {label:"Заряд",value:`${Math.floor(base.charge*10)/10}/${Math.ceil(power.nightLoad*nightSeconds/60)}`,ok:base.charge+E.EPS>=power.nightLoad*nightSeconds/60},
      {label:"Вода",value:`${rounded(base.stock.water)}/${needed}`,ok:base.stock.water+E.EPS>=needed},
      {label:"Пища",value:`${rounded(base.stock.food)}/${needed}`,ok:base.stock.food+E.EPS>=needed}
    ];
    return values;
  }

  function equipmentGoal(item,title,detail) {
    return goal(title,detail,marker(item,title),{type:"inspect",x:item.x,y:item.y});
  }

  function unloadGoal(state,base) {
    return goal("Выгрузи сырьё",`${cargoText(state.rover.cargo)}. Подъедь к складу и нажми E.`,
      marker(E.SITES[base.id],"Склад","unload","ВЫГРУЗКА"));
  }

  function rawGoal(state,base,type) {
    const depot=E.SITES[base.id];
    const refinery=base.buildings.find(item=>item.type==="refinery");
    if(totalCargo(state)>0 && (state.rover.cargo[type]>0 || totalCargo(state)>=E.CARGO_CAP)) return unloadGoal(state,base);
    if(!refinery&&base.id==="city"&&affordable(base,E.costOf(state,base,"refinery")))return buildingGoal(state,base,"refinery");
    if(refinery && (base.stock[type]>=1-E.EPS || refinery.input===type)) {
      if(refinery.mode!=="auto" && refinery.mode!==type && refinery.input!==type)
        return equipmentGoal(refinery,"Выбери режим переработки",type==="ice"?"В карточке цеха переключи режим на «Вода».":"В карточке цеха переключи режим на «Детали».");
      if(!refinery.enabled) return equipmentGoal(refinery,"Включи переработчик","Подъедь к цеху и включи его в карточке объекта.");
      if(refinery.powered || !E.weather(state).night && base.telemetry.generation>0)
        return goal(type==="ice"?"Получи воду":"Получи детали",`Переработчик обработает сырьё. ${type==="ore"&&refinery.mode==="auto"&&refinery.input==="ice"?"После текущего цикла можно выбрать режим «Детали». ":""}Можно ускорить ожидание ×4.`,marker(refinery,"Переработчик","production","ПЕРЕРАБОТКА"),{type:"inspect",x:refinery.x,y:refinery.y});
      return goal("Обеспечь питание цеха","Проверь панели, запас энергии и приоритет переработки.",marker(refinery,"Переработчик","production","ЦЕХ"),{type:"inspect",x:refinery.x,y:refinery.y});
    }
    const deposit=closest(state,E.DEPOSITS.filter(item=>item.type===type && item.site===base.id && E.accessibleDeposit(state,item)));
    if(deposit) return goal(type==="ice"?"Найди лёд":"Добудь руду",
      "Подъедь к отмеченной залежи, нажми E и отвези груз на склад.",marker(deposit,type==="ice"?"Лёд":"Руда",type,type==="ice"?"ДОБЫЧА ЛЬДА":"ДОБЫЧА РУДЫ"));
    return goal("Организуй снабжение","Сырьё и материалы можно доставить грузовым дроном.",marker(depot,"Склад"),{type:"drones",base:base.id});
  }

  function freightGoal(state,destination,resource) {
    const city=state.bases[0];
    const drone=state.drones.find(d=>d.kind==="cargo" && d.route?.source==="city" && d.route.target===destination && d.route.resource===resource);
    if(drone?.paused) return goal("Возобнови доставку","Открой маршрут грузового дрона и возобнови рейс.",marker(E.SITES[destination],"Пункт назначения"),{type:"drones",base:"city"});
    if(drone && (drone.cargo || city.stock[resource]>=1-E.EPS))
      return goal("Дождись доставки",`Грузовой рейс: ${E.RESOURCE_NAMES[resource].toLowerCase()}. Ускорь ожидание ×4 при ясной погоде.`,
        marker(E.SITES[destination],"Пункт назначения"),{type:"drones",base:"city"});
    const emptyCargo=state.drones.some(d=>d.kind==="cargo"&&!d.route);
    const reusable=state.drones.some(d=>d.kind==="cargo"&&!d.cargo);
    if(!drone && !emptyCargo && !reusable && !affordable(city,6)) return rawGoal(state,city,"ore");
    if(drone && city.stock[resource]<1-E.EPS && !drone.cargo)
      return resource==="parts"?rawGoal(state,city,"ore"):rawGoal(state,city,"ice");
    return goal(drone||emptyCargo||reusable?"Назначь грузовой рейс":"Собери грузовой дрон",
      `В разделе «Дроны» задай маршрут из Посадочной долины в ${E.SITES[destination].name.toLowerCase()}, груз — ${E.RESOURCE_NAMES[resource].toLowerCase()}.`,
      marker(E.SITES.city,"Склад долины"),{type:"drones",base:"city"});
  }

  function materialsGoal(state,base) {
    return base.id==="city"?rawGoal(state,base,"ore"):freightGoal(state,base.id,"parts");
  }

  function plannedCell(state,base,type) {
    const site=E.SITES[base.id];
    const [left,top,right,bottom]=site.bounds;
    const offset={solar:[-1,-1],refinery:[1,-1],battery:[-1,1],sector:[1,0]}[type]||[1,0];
    const candidates=[];
    for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++) {
      const score=(x-site.x-offset[0])**2+(y-site.y-offset[1])**2;
      // Preserve the four connections around the depot for the first sector.
      const penalty=!["sector","habitat","greenhouse","insulation"].includes(type) &&
        Math.abs(x-site.x)+Math.abs(y-site.y)===1?50:0;
      candidates.push({x,y,score:score+penalty});
    }
    candidates.sort((a,b)=>a.score-b.score);
    for(const cell of candidates) {
      const projection={...state,rover:{...state.rover,x:cell.x+.5,y:cell.y+.5}};
      if(!E.checkBuild(projection,type,cell.x,cell.y).message)return cell;
    }
    return null;
  }

  function buildingGoal(state,base,type) {
    const cost=E.costOf(state,base,type), info={type,base:base.id};
    if(!affordable(base,cost))return {...materialsGoal(state,base),requirement:info};
    const site=E.SITES[base.id];
    const titles={solar:"Поставь солнечную панель",battery:"Поставь аккумулятор",refinery:"Разверни переработчик",
      sector:"Построй герметичный сектор",greenhouse:"Размести теплицу",habitat:"Размести жилой отсек",insulation:"Утепли сектор"};
    const cell=plannedCell(state,base,type);
    if(!cell)return {...goal(titles[type],type==="sector"?"Первый сектор должен граничить со складом, следующие — с существующим сектором. Нужна свободная клетка.":"Нужна подходящая свободная клетка в зоне склада.",null,{type:"build",building:type,base:base.id}),requirement:info};
    const local=close(state,cell);
    const verbs=["greenhouse","habitat","insulation"].includes(type)?
      (local?"Выбери модуль и нажми на выделенный сектор.":"Подъедь к выделенному сектору и размести модуль."):
      (local?"Выбери постройку и нажми на отмеченную клетку.":"Подъедь к отмеченной клетке и размести модуль.");
    const tags={solar:"ПАНЕЛЬ",battery:"АККУМУЛЯТОР",refinery:"ЦЕХ",sector:"СЕКТОР",greenhouse:"ТЕПЛИЦА",habitat:"ЖИЛЬЁ",insulation:"УТЕПЛЕНИЕ"};
    return {...goal(titles[type],`${cost?cost+" дет.":"Готовый модуль из запаса"}. ${verbs}`,
      marker(cell,"Рекомендуемое место","build",tags[type]),{type:"build",building:type,base:base.id}),requirement:info};
  }

  function roomGoal(state,base,type) {
    return constructionGoal(state,base,type);
  }

  function constructionGoal(state,base,type,seekMaterials=false) {
    const r=requirements(state,base,type), info={type,base:base.id};
    if(r.locked)return {...goal("Утепление пока закрыто","Сначала пройди испытание и дождись посадки экипажа."),requirement:info};
    // One plan can cover several purchases, but a player may also build the
    // prerequisite as soon as they have enough for that first step.
    if(r.missingNext||(seekMaterials&&r.missing)) {
      const step=materialsGoal(state,base);
      return {...step,detail:`Для постройки «${E.TYPES[type].name}» нужно ещё ${r.missing} дет. ${step.detail}`,requirement:info};
    }
    const step=buildingGoal(state,base,r.next);
    if(r.needsSector&&step.shortcut?.type==="build") {
      return {...step,title:`Сначала герметичный сектор`,detail:`${E.TYPES[type].name}: нужен ${r.insulation?"неутеплённый":"свободный"} сектор. ${step.target?close(state,step.target)?"Поставь сектор в отмеченной клетке.":"Подъедь к отмеченной клетке.":step.detail}`,requirement:info};
    }
    return {...step,requirement:info};
  }

  function support(state,base) {
    const power=E.powerEstimate(state,base);
    if(power.capacity+E.EPS < power.nightLoad*(E.SOL-E.DAY)/60)return buildingGoal(state,base,"battery");
    const steady=E.SITES[base.id].solar*count(base,"solar");
    const daytimeHeat=count(base,"sector");
    const load=daytimeHeat+2*(rooms(base,"habitat").length+rooms(base,"greenhouse").length+count(base,"refinery"));
    if(steady<load)return buildingGoal(state,base,"solar");
    return null;
  }

  function waterGoal(state,base) {
    if(base.id==="plateau")return freightGoal(state,base.id,"water");
    if(!count(base,"refinery"))return buildingGoal(state,base,"refinery");
    return rawGoal(state,base,"ice");
  }

  function suppliesGoal(state,base,water,food) {
    if(base.stock.water+E.EPS<water)return waterGoal(state,base);
    if(base.stock.food+E.EPS<food) {
      const farm=rooms(base,"greenhouse").find(b=>b.room.enabled)||rooms(base,"greenhouse")[0];
      if(!farm)return roomGoal(state,base,"greenhouse");
      if(!farm.room.enabled)return equipmentGoal(farm,"Включи теплицу","Подъедь к теплице и включи производство.");
      if(base.temp<E.SAFE_TEMP-E.EPS)return goal("Прогрей купол","Теплица начинает работать при +16 °C. Проверь питание отопления.",marker(farm,"Теплица"));
      if(farm.room.override==="off" || !farm.room.powered && base.telemetry.generation<base.telemetry.demand)
        return support(state,base)||goal("Обеспечь питание теплицы","Проверь энергию и приоритет теплицы, чтобы возобновить выращивание пищи.",marker(farm,"Теплица"),{type:"status",base:base.id});
      return goal("Дождись урожая","Теплица производит 2 ед. пищи за 30 игровых секунд. Ускорь ожидание ×4 при безопасных условиях.",marker(farm,"Теплица","production","УРОЖАЙ"),{type:"inspect",x:farm.x,y:farm.y});
    }
    return null;
  }

  function occupyGoal(state,base) {
    const room=rooms(base,"habitat").find(b=>!b.room.occupied);
    if(!room)return roomGoal(state,base,"habitat");
    if(base.temp<E.SAFE_TEMP-E.EPS || !room.room.powered)
      return support(state,base)||goal("Прогрей жилой модуль","Для заселения нужно питание и не менее +16 °C.",marker(room,"Жилой отсек"));
    const supplies=suppliesGoal(state,base,2,2);
    return supplies||equipmentGoal(room,"Засели жилой отсек","Подъедь к модулю и нажми E.");
  }

  function current(state) {
    const city=state.bases[0], weather=E.weather(state);
    if(state.finalResult?.success)return goal("Обе колонии выстояли","Экспедиция завершена. Исследуй построенные поселения.");
    if(state.finalResult)return goal("Испытание прервано","Вернись к прогнозу и подготовь запасы.");
    if(state.trial) {
      if(state.trial.phase==="scheduled"||state.trial.phase==="warning"){
        for(const base of state.bases) {
          const supply=readiness(state,base).slice(2);
          if(supply.some(value=>!value.ok)){
            const power=E.powerEstimate(state,base);
            const needed=state.chapter===1?2:Math.max(2,Math.ceil(power.occupants/2*Math.max(0,state.trial.end-Math.max(state.elapsed,state.trial.warn))/60));
            const step=suppliesGoal(state,base,needed,needed);
            if(step)return step;
          }
        }
        return goal("Подготовься к прогнозу","Заряди батареи, накопи воду и пищу. При необходимости останови лишнее производство.",null,{type:"status"});
      }
      return goal(weather.storm?"Сохрани жизнь колоний":"Дождись рассвета",
        weather.storm?"Дроны ожидают окончания бури. Сохраняй питание жилых отсеков и отопления.":"Следи за зарядом, водой и пищей до конца испытания.",null,{type:"status"});
    }
    if(totalCargo(state)>=E.CARGO_CAP) {
      const base=closest(state,state.bases.map(b=>E.SITES[b.id]));
      return unloadGoal(state,E.byId(state,base.id));
    }
    if(state.chapter===1) {
      for(const type of ["solar","refinery","battery"])if(!count(city,type))return buildingGoal(state,city,type);
      for(const type of ["habitat","greenhouse"])if(!rooms(city,type).length)return roomGoal(state,city,type);
      const power=E.powerEstimate(state,city);
      const supplies=suppliesGoal(state,city,4,4);
      if(supplies)return supplies;
      if(city.temp<E.SAFE_TEMP-E.EPS)return goal("Прогрей первый купол","Дождись температуры от +16 °C.",marker(E.SITES.city,"Склад"));
      const farm=rooms(city,"greenhouse").find(item=>item.room.enabled);
      if(farm)return equipmentGoal(farm,"Сохрани запасы перед ночью","Пища и вода готовы. Приостанови теплицу, чтобы сохранить запас воды и заряд для испытания.");
      if(city.charge+E.EPS<Math.min(power.capacity,power.nightLoad*2+1.5)) {
        return support(state,city)||goal("Заряди аккумулятор","Проверь дневную выработку. После урожая можно приостановить теплицу, чтобы накопить заряд.",marker(E.SITES.city,"Склад"));
      }
      return goal("Назначь первое испытание","Проверь запас воды, пищи и заряда. Переживи бурю и ночь до прибытия экипажа.",null,{type:"trial"});
    }
    if(state.chapter===2) {
      const solar=city.buildings.find(b=>b.type==="solar"&&b.dirty);
      if(solar&&!weather.storm)return equipmentGoal(solar,"Очисти панель","После бури выработка снижена. Подъедь к панели и нажми E.");
      for(const type of ["habitat","greenhouse"])if(rooms(city,type).length<2)return roomGoal(state,city,type);
      const extra=support(state,city);
      if(extra)return extra;
      if(rooms(city,"habitat").filter(b=>b.room.occupied).length<2)return occupyGoal(state,city);
      const offFarm=rooms(city,"greenhouse").find(b=>!b.room.enabled);
      if(offFarm)return equipmentGoal(offFarm,"Запусти вторую теплицу","Для развития города обе теплицы должны работать одновременно.");
      if(!state.logistics) {
        if(!state.drones.length&&!affordable(city,6))return materialsGoal(state,city);
        return goal("Наладь первый рейс","Собери дрон рядом со складом или назначь маршрут существующему дрону.",marker(E.SITES.city,"Склад"),{type:"drones",base:"city"});
      }
      const supplies=suppliesGoal(state,city,3,4);
      return supplies||goal("Запусти обе теплицы","Проверь питание и воду. Город готов, когда обе теплицы работают.",null,{type:"status"});
    }
    if(state.chapter===3) {
      if(!state.selectedSite) {
        const discovered=state.explored.filter(id=>E.SITES[id]&&id!=="city");
        const site=closest(state,[E.SITES.basin,E.SITES.plateau].filter(s=>!state.explored.includes(s.id)));
        if(discovered.length)return goal("Выбери второе поселение","Низина располагает льдом. Плато даёт больше энергии. Выбор доступен в «Обзоре».",marker(E.SITES[discovered[0]],"Обследованный участок"),{type:"status"});
        return goal("Обследуй Марс","Подъедь к выбранной площадке; после разведки она появится среди участков.",marker(site,site?.name));
      }
      const base=E.byId(state,state.selectedSite);
      if(!base)return freightGoal(state,state.selectedSite,"parts");
      for(const type of ["solar","battery"])if(!count(base,type))return buildingGoal(state,base,type);
      for(const type of ["habitat","greenhouse"])if(!rooms(base,type).length)return roomGoal(state,base,type);
      const extra=support(state,base);
      if(extra)return extra;
      return occupyGoal(state,base);
    }
    for(const base of state.bases) {
      const extra=support(state,base);
      if(extra)return extra;
      const supply=suppliesGoal(state,base,Math.max(4,Math.ceil(E.powerEstimate(state,base).occupants*1.875)),Math.max(4,Math.ceil(E.powerEstimate(state,base).occupants*1.875)));
      if(supply)return supply;
      if(readiness(state,base).some(item=>!item.ok))
        return goal("Подготовь "+E.SITES[base.id].name,"Проверь отопление, заряд батарей и запасы. Останови лишнее производство, когда запас готов.",marker(E.SITES[base.id],"Склад"),{type:"status",base:base.id});
    }
    return goal("Назначь большую бурю","Обе базы подготовлены по основным запасам. Следи за энергией и водой до рассвета.",null,{type:"trial"});
  }

  const Guidance={nearby,current,readiness,cargoText,requirements,constructionGoal,placementCells,production};
  if(typeof module==="object"&&module.exports)module.exports=Guidance;
  else globalThis.TerraformiaGuidance=Guidance;
}());
