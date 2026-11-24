(function () {
  "use strict";

  const DAY = 240;
  const SOL = 360;
  const FORECAST = 60;
  const FIRST_STORM = 180;
  const STORM_LENGTH = 45;
  const FINAL_STORM = DAY - STORM_LENGTH;
  const W = 48;
  const H = 30;
  const STEP = 0.1;
  const EPS = 1e-7;
  const SAFE_TEMP = 16;
  const TARGET_TEMP = 22;
  const CAPACITY = 16;
  const CARGO_CAP = 8;
  const REACH = 3.05;
  const DRIVE_SPEED = 4.35;
  const PRECISION_SPEED = 1.55;
  const SAVE_FORMAT = 1;

  const RESOURCE_NAMES = { ice: "Лёд", ore: "Руда", water: "Вода", food: "Пища", parts: "Детали" };
  const TYPES = {
    solar: { name: "Солнечная панель", cost: 4, detail: "Дневная выработка" },
    battery: { name: "Аккумулятор", cost: 6, detail: "Ёмкость 16 ед. энергии" },
    refinery: { name: "Переработчик", cost: 5, detail: "1 лёд → 1 вода · 1 руда → 1 деталь · 5 сек" },
    sector: { name: "Герметичный сектор", cost: 5, detail: "Отопление · 1 ед. днём / 2 ночью" },
    greenhouse: { name: "Теплица", cost: 4, detail: "Вода → 2 ед. пищи за 30 сек при +16 °C" },
    habitat: { name: "Жилой отсек", cost: 5, detail: "2 места · 2 ед. мощности" },
    insulation: { name: "Утепление", cost: 3, detail: "Ночной расход сектора снижается до 1 ед." }
  };
  const SITES = {
    city: { id:"city", name:"Посадочная долина", x:11, y:15, solar:8, bounds:[3,7,21,24], note:"Главный склад экспедиции" },
    basin: { id:"basin", name:"Ледяная низина", x:34, y:22, solar:6, bounds:[26,16,44,28], note:"Местный лёд · 6 ед. мощности с панели" },
    plateau: { id:"plateau", name:"Солнечное плато", x:37, y:8, solar:9, bounds:[29,3,45,14], note:"Вода с первой базы · 9 ед. мощности с панели" }
  };
  const PAD = { id:"pad", name:"Посадочный терминал", x:9, y:18 };
  const DEPOSITS = [
    { id:"valley-ore", site:"city", x:6, y:13, type:"ore" },
    { id:"valley-ice", site:"city", x:15, y:15, type:"ice" },
    { id:"ridge-ore", site:"city", x:16, y:21, type:"ore" },
    { id:"valley-lake", site:"city", x:5, y:21, type:"ice" },
    { id:"basin-ore", site:"basin", x:29, y:19, type:"ore" },
    { id:"basin-ice", site:"basin", x:38, y:23, type:"ice" },
    { id:"plateau-ore", site:"plateau", x:41, y:7, type:"ore" }
  ];
  const CHAPTERS = ["Первый купол", "Город под куполами", "Второе поселение", "Большая буря"];
  const STOCK = () => ({ ice:0, ore:0, water:0, food:0, parts:0 });
  const clone = object => JSON.parse(JSON.stringify(object));
  const enough = (amount, need) => amount + EPS >= need;
  const countRooms = (base, type) => base.buildings.filter(item => item.room?.type === type);
  const hasType = (base, type) => base.buildings.some(item => item.type === type);
  const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const entityDist = (rover, item) => Math.hypot(rover.x - item.x - 0.5, rover.y - item.y - 0.5);
  const bypassPower = entry => entry.override === "off";
  const solarPower = (base, panel, conditions) => conditions.night ? 0 :
    SITES[base.id].solar * (conditions.storm ? 0.4 : panel.dirty ? 0.75 : 1);
  const byId = (state, id) => state.bases.find(base => base.id === id);
  const city = state => state.bases[0];
  const existsBase = (state, id) => state.bases.some(base => base.id === id);

  function makeBase(id) {
    return {
      id, stock: STOCK(), buildings: [], temp: 12, charge: 0, auto: false,
      priority: "greenhouse", supply: true, telemetry: { generation:0, load:0, demand:0, capacity:0, heat:false, life:false }
    };
  }

  function newGame() {
    const base = makeBase("city");
    base.stock.parts = 18;
    return {
      format: SAVE_FORMAT, elapsed: 0, nextId: 1, chapter: 1, bases: [base],
      rover: { x:11.5, y:17.25, cargo:{ ice:0, ore:0 }, angle:-Math.PI/2 },
      kit: { solar:1, refinery:1 }, drones: [], padStock: STOCK(), explored: [],
      selectedSite: null, trial: null, firstResult: null, finalResult: null,
      crew: false, logistics: false, log: [], eventSerial: 0
    };
  }

  function signal(state, kind, text, baseId = null) {
    state.log.unshift({ id: ++state.eventSerial, time: state.elapsed, kind, text, baseId });
    if (state.log.length > 48) state.log.length = 48;
  }

  function weather(state, time = state.elapsed) {
    const clock = time % SOL;
    const trial = state.trial;
    const scheduled = trial && time + EPS >= trial.warn && time < trial.start - EPS && trial.phase !== "failed";
    const storm = Boolean(trial && time + EPS >= trial.start && time < trial.stormEnd - EPS);
    return {
      clock, sol:Math.floor(time / SOL) + 1, night:clock >= DAY - EPS, storm,
      forecast: scheduled ? trial.start - time : null,
      sunset: clock < DAY ? DAY - clock : null,
      sunrise: SOL - clock,
      outside: clock < DAY ? Math.round(-36 + 15 * Math.sin(Math.PI * clock / DAY)) :
        Math.round(-42 - 29 * Math.sin(Math.PI * (clock - DAY) / (SOL - DAY)))
    };
  }

  function getPlace(state, x, y) {
    if (SITES.city.x === x && SITES.city.y === y) return { kind:"depot", base:city(state), item:SITES.city };
    if (PAD.x === x && PAD.y === y) return { kind:"pad", item:PAD };
    const deposit = DEPOSITS.find(item => item.x === x && item.y === y);
    if (deposit) return { kind:"deposit", item:deposit };
    for (const base of state.bases) {
      if (base.id !== "city" && x === SITES[base.id].x && y === SITES[base.id].y) {
        return { kind:"depot", base, item:SITES[base.id] };
      }
      const building = base.buildings.find(item => item.x === x && item.y === y);
      if (building) return { kind:"building", base, item:building };
    }
    const site = Object.values(SITES).find(item => item.id !== "city" && item.x === x && item.y === y);
    return site ? { kind:"site", item:site } : null;
  }

  function location(id) {
    return id === "pad" ? PAD : SITES[id];
  }

  function localDepot(state, id) {
    if (id === "pad") return state.crew ? state.padStock : null;
    return byId(state, id)?.stock || null;
  }

  function accessibleDeposit(state, deposit) {
    return deposit.site === "city" || (state.chapter >= 3 && state.selectedSite === deposit.site);
  }

  function costOf(state, base, type) {
    return base.id === "city" && state.kit[type] ? 0 : TYPES[type].cost;
  }

  function checkBuild(state, type, x, y) {
    if (!TYPES[type] || !Number.isInteger(x) || !Number.isInteger(y)) return { message:"Выбери клетку строительства." };
    if (type === "insulation" && !state.crew) return { message:"Утепление откроется после посадки экипажа." };
    const base = state.bases.find(candidate => {
      const [a,b,c,d] = SITES[candidate.id].bounds;
      return x >= a && y >= b && x <= c && y <= d;
    });
    if (!base) return { message:"Постройка должна находиться в зоне действующего склада." };
    const place = getPlace(state, x, y);
    if (["greenhouse","habitat","insulation"].includes(type)) {
      if (place?.item.type !== "sector") return { message:"Выбери герметичный сектор." };
      if (type === "insulation" ? place.item.insulated : place.item.room) return {
        message:type === "insulation" ? "Сектор уже утеплён." : "Сектор уже занят."
      };
    } else {
      if (place) return { message:"Клетка занята." };
      if (type === "sector") {
        const sectors = base.buildings.filter(item => item.type === "sector");
        const neighbors = sectors.length ? sectors : [SITES[base.id]];
        if (!neighbors.some(item => manhattan({x,y}, item) === 1)) {
          return { message:sectors.length ? "Присоедини сектор к существующему." : "Поставь первый сектор рядом со складом." };
        }
      }
    }
    if (entityDist(state.rover, {x,y}) > REACH) return { message:"Подведи ровер ближе." };
    const cost = costOf(state, base, type);
    if (!enough(base.stock.parts, cost)) return { message:`Нужно ${cost} дет., на складе ${Math.floor(base.stock.parts)}.` };
    return { base, place, cost };
  }

  function build(state, type, x, y) {
    const checked = checkBuild(state, type, x, y);
    if (checked.message) return bad(checked.message);
    const { base, place, cost } = checked;
    if (cost === 0) state.kit[type]--;
    else base.stock.parts -= cost;
    if (type === "insulation") place.item.insulated = true;
    else if (type === "habitat" || type === "greenhouse") {
      place.item.room = { type, occupied:false, enabled:true, override:null, powered:false, progress:0, input:null };
    } else {
      base.buildings.push({
        id:state.nextId++, x, y, type, dirty:false, insulated:false, room:null,
        enabled:true, powered:false, override:null, mode:"auto", progress:0, input:null
      });
    }
    return good(`${TYPES[type].name} · готово`);
  }

  function good(message, extra) {
    return { ok:true, message, ...extra };
  }

  function bad(message) {
    return { ok:false, message };
  }

  function commandsFor(base) {
    if (base.priority === "refinery") return [...base.buildings.filter(item => item.type === "refinery"), ...countRooms(base, "greenhouse").map(item => item.room)];
    return [...countRooms(base, "greenhouse").map(item => item.room), ...base.buildings.filter(item => item.type === "refinery")];
  }

  function criticalLoad(base, night) {
    const sectors = base.buildings.filter(item => item.type === "sector");
    const heat = sectors.reduce((sum, item) => sum + (night && !item.insulated ? 2 : 1), 0);
    const life = countRooms(base, "habitat").filter(item => item.room.enabled).length * 2;
    return { heat, life };
  }

  function feedFor(stock, item) {
    if (item.type === "greenhouse") return enough(stock.water, 1) ? "water" : null;
    if (item.mode === "ice" || item.mode === "ore") return enough(stock[item.mode], 1) ? item.mode : null;
    if (enough(stock.ice, 1) && (stock.water < 8 || !enough(stock.ore, 1))) return "ice";
    if (enough(stock.ore, 1)) return "ore";
    return enough(stock.ice, 1) ? "ice" : null;
  }

  function runnable(base, item) {
    return item.enabled && (item.type !== "greenhouse" || base.temp + EPS >= SAFE_TEMP) &&
      Boolean(item.input || feedFor(base.stock, item));
  }

  function generation(base, conditions) {
    return base.buildings.reduce((sum, item) => sum + (item.type === "solar" ? solarPower(base, item, conditions) : 0), 0);
  }

  function capacity(base) {
    return base.buildings.filter(item => item.type === "battery").length * CAPACITY;
  }

  function runProduction(base, item, dt) {
    if (!item.input) {
      const input = feedFor(base.stock, item);
      if (!input) return;
      base.stock[input] = Math.max(0, base.stock[input] - 1);
      item.input = input;
      item.progress = 0;
    }
    const threshold = item.type === "greenhouse" ? 30 : 5;
    item.progress += dt;
    if (item.progress + EPS < threshold) return;
    if (item.type === "greenhouse") base.stock.food += 2;
    else if (item.input === "ice") base.stock.water += 1;
    else base.stock.parts += 1;
    item.input = null;
    item.progress = 0;
    return true;
  }

  function balanceBase(base, conditions, dt, events) {
    const produced = generation(base, conditions);
    const cap = capacity(base);
    const demands = criticalLoad(base, conditions.night);
    const minute = dt / 60;
    const energy = produced * minute + base.charge;
    let remaining = energy;
    let load = 0;
    let demand = demands.life + demands.heat;
    function allocate(rate) {
      const cost = rate * minute;
      if (!enough(remaining, cost)) return false;
      remaining = Math.max(0, remaining - cost);
      load += rate;
      return true;
    }

    const rooms = countRooms(base, "habitat");
    for (const entry of rooms) entry.room.powered = entry.room.enabled && allocate(2);
    const heat = demands.heat > 0 && allocate(demands.heat);
    const partialCritical = load + EPS < demands.life + demands.heat;
    for (const item of commandsFor(base)) {
      const wantsPower = runnable(base, item) && !bypassPower(item);
      if (wantsPower) demand += 2;
      item.powered = wantsPower && !partialCritical && allocate(2);
      if (item.powered && runProduction(base, item, dt)) {
        events.push(item.type === "greenhouse" ? "harvest" : "refine");
      }
    }
    // Use any fractional energy in the final simulation step of a depleted battery.
    if (partialCritical) remaining = 0;
    base.charge = Math.min(cap, remaining);
    if (demands.heat) {
      const rate = heat ? 3 : conditions.night ? -4 : -1;
      base.temp = Math.min(TARGET_TEMP, Math.max(-80, base.temp + rate * minute));
    }
    const occupied = rooms.filter(item => item.room.occupied);
    const consumption = occupied.length * minute;
    base.supply = enough(base.stock.water, consumption) && enough(base.stock.food, consumption);
    base.stock.water = Math.max(0, base.stock.water - consumption);
    base.stock.food = Math.max(0, base.stock.food - consumption);
    const life = rooms.length > 0 && rooms.every(item => item.room.powered || (!item.room.occupied && occupied.length > 0));
    base.telemetry = { generation:produced, load, demand, capacity:cap, heat, life };
  }

  function energyProjection(base, state, activeCount, reserveHours = 0) {
    const end = (Math.floor(state.elapsed / SOL) + 1) * SOL;
    const cap = capacity(base);
    let charge = base.charge;
    let lowest = charge;
    let temp = base.temp;
    for (let time = state.elapsed; time < end - EPS; time += 1) {
      const dt = Math.min(1, end - time) / 60;
      const conditions = weather(state, time);
      const critical = criticalLoad(base, conditions.night);
      const needed = critical.life + critical.heat + 2 * activeCount;
      const produced = generation(base, conditions);
      const relief = charge + (produced - needed) * dt;
      lowest = Math.min(lowest, relief);
      charge = Math.min(cap, relief);
      temp = charge >= 0 || produced >= critical.heat + critical.life ?
        Math.min(TARGET_TEMP, temp + 3 * dt) : temp - (conditions.night ? 4 : 1) * dt;
      if (charge < -EPS) return { safe:false, lowest, temp };
    }
    return { safe:lowest >= reserveHours - EPS, lowest, temp };
  }

  function runAlex(base, state) {
    if (!base.auto || !state.crew) return;
    const refineries = base.buildings.filter(item => item.type === "refinery");
    const farms = countRooms(base, "greenhouse").map(item => item.room);
    const running = () => [...refineries, ...farms].filter(item => runnable(base, item) && !bypassPower(item)).length;
    let count = running();
    let budget = energyProjection(base, state, count);
    const siteName = SITES[base.id].name;
    const endangered = budget.temp < SAFE_TEMP && base.temp >= SAFE_TEMP;
    if (!budget.safe || endangered) {
      for (const item of [...refineries, ...farms]) {
        if (!runnable(base, item) || bypassPower(item)) continue;
        item.override = "off";
        const label = item.type === "refinery" ? "переработчик" : "теплицу";
        signal(state, "alex", `${siteName} · Приостановил ${label}: текущего резерва не хватает до рассвета.`, base.id);
        budget = energyProjection(base, state, --count);
        if (budget.safe) break;
      }
      return;
    }
    // Give food production first use of a recovered reserve and leave a small margin.
    for (const item of [...farms, ...refineries]) {
      if (!item.enabled || !bypassPower(item) || !runnable(base, item)) continue;
      if (!energyProjection(base, state, count + 1, 0.8).safe) continue;
      item.override = null;
      count++;
      const label = item.type === "refinery" ? "переработчик" : "теплицу";
      signal(state, "alex", `${siteName} · Вернул ${label} в работу: запас энергии восстановлен.`, base.id);
    }
  }

  function durations(origin, destination) {
    return Math.max(3, Math.hypot(origin.x - destination.x, origin.y - destination.y) / 2.8);
  }

  function droneEndpoints(drone) {
    const route = drone.route;
    const source = drone.kind === "mine" ? DEPOSITS.find(item => item.id === route.source) : location(route.source);
    return { from:source, to:location(route.target) };
  }

  function deployOutpost(state, siteId) {
    if (!existsBase(state, siteId)) {
      state.bases.push(makeBase(siteId));
      signal(state, "story", `${SITES[siteId].name} · Груз доставлен, склад развёрнут.`, siteId);
    }
    return byId(state, siteId);
  }

  function tickDrones(state, conditions, dt, events) {
    for (const drone of state.drones) {
      if (!drone.route || conditions.storm || drone.paused) continue;
      const { from, to } = droneEndpoints(drone);
      const route = drone.route;
      const flightTime = durations(from, to);
      if (drone.phase === "recall") {
        drone.progress = Math.max(0, drone.progress - dt);
        if (drone.progress <= EPS) {
          drone.phase = "ready";
          drone.paused = true;
        }
        continue;
      }
      if (drone.phase === "ready") {
        if (drone.cargo > 0) {
          drone.phase = "deliver";
          continue;
        }
        const source = drone.kind === "cargo" ? localDepot(state, route.source) : null;
        const count = drone.kind === "mine" ? CARGO_CAP : Math.min(CARGO_CAP, Math.floor((source?.[route.resource] || 0) + EPS));
        if (count < 1) continue;
        if (source) source[route.resource] = Math.max(0, source[route.resource] - count);
        drone.cargo = count;
        drone.phase = "deliver";
        drone.progress = 0;
        state.logistics = true;
      }
      drone.progress = Math.min(flightTime, drone.progress + dt);
      if (drone.progress + EPS < flightTime) continue;
      drone.progress = 0;
      if (drone.phase === "deliver") {
        let destination = localDepot(state, route.target);
        if (!destination && route.target === state.selectedSite && state.chapter >= 3) {
          destination = deployOutpost(state, route.target).stock;
        }
        if (!destination) {
          drone.paused = true;
          continue;
        }
        destination[route.resource] += drone.cargo;
        if (!drone.reported) {
          signal(state, "system", `${location(route.target).name} · Первый рейс доставил груз.`, route.target);
          drone.reported = true;
          events.push("delivery");
        }
        drone.cargo = 0;
        drone.phase = "return";
      } else if (drone.phase === "return") {
        drone.phase = "ready";
      }
    }
  }

  function dronePosition(drone) {
    if (!drone.route) {
      const loc = location(drone.home);
      return { x:loc.x+0.5, y:loc.y+0.4 };
    }
    const { from, to } = droneEndpoints(drone);
    const ratio = Math.min(1, drone.progress / durations(from, to));
    const t = drone.phase === "return" ? 1 - ratio : drone.phase === "ready" ? 0 : ratio;
    return { x:from.x+0.5 + (to.x - from.x) * t, y:from.y+0.5 + (to.y - from.y) * t };
  }

  function prepFirst(state) {
    const base = city(state);
    return [
      { label:"Разверни солнечную панель и переработчик", done:hasType(base,"solar") && hasType(base,"refinery") },
      { label:"Поставь аккумулятор", done:hasType(base,"battery") },
      { label:"Построй теплицу и жилой отсек в секторах", done:countRooms(base,"greenhouse").length > 0 && countRooms(base,"habitat").length > 0 },
      { label:"Прогрей купол до +16 °C", done:base.temp + EPS >= SAFE_TEMP },
      { label:"Запаси по 2 ед. воды и пищи", done:enough(base.stock.water,2) && enough(base.stock.food,2) }
    ];
  }

  function assess(base, first = false) {
    if (!base.telemetry.life) return "отказ питания жизнеобеспечения";
    if (!enough(base.temp, SAFE_TEMP)) return "температура купола ниже +16 °C";
    if (!first && !base.supply) return "закончилась вода или пища";
    return null;
  }

  function markDirty(state) {
    for (const base of state.bases) {
      for (const item of base.buildings) if (item.type === "solar") item.dirty = true;
    }
  }

  function advanceChapter(state, events) {
    const base = city(state);
    if (state.chapter === 2) {
      const occupied = countRooms(base, "habitat").filter(item => item.room.occupied).length;
      const farms = countRooms(base, "greenhouse").filter(item => item.room.powered).length;
      if (occupied >= 2 && farms >= 2 && state.logistics) {
        state.chapter = 3;
        signal(state, "story", "Город готов. Обследуй низину и плато, затем выбери площадку для второго поселения.", "city");
        events.push("chapter");
      }
    } else if (state.chapter === 3 && state.selectedSite) {
      const outpost = byId(state, state.selectedSite);
      if (outpost && countRooms(outpost,"habitat").some(item => item.room.occupied) &&
          countRooms(outpost,"greenhouse").length > 0 && outpost.telemetry.life && enough(outpost.temp,SAFE_TEMP) &&
          hasType(outpost,"solar") && hasType(outpost,"battery")) {
        state.chapter = 4;
        signal(state, "story", "Обе колонии заселены. Пополни запасы и назначь финальное испытание.");
        events.push("chapter");
      }
    }
  }

  function scheduleTrial(state) {
    if (state.finalResult) return bad("Кампания уже завершена.");
    if (state.trial) return bad("Испытание уже назначено.");
    if (state.chapter !== 1 && state.chapter !== 4) return bad("Испытание пока недоступно.");
    const first = state.chapter === 1;
    if (first && prepFirst(state).slice(0,4).some(item => !item.done)) return bad("Сначала подготовь и прогрей первый купол.");
    const stormAt = first ? FIRST_STORM : FINAL_STORM;
    let warnAt = Math.floor(state.elapsed / SOL) * SOL + stormAt - FORECAST;
    if (warnAt < state.elapsed - EPS) warnAt += SOL;
    const start = warnAt + FORECAST;
    const end = Math.floor(start / SOL) * SOL + SOL;
    state.trial = { kind:first?"first":"final", phase:"scheduled", warn:warnAt, start, stormEnd:first?start+STORM_LENGTH:end, end, failure:null, cleared:false };
    if (first) state.firstResult = null;
    return good("Испытание назначено. На панели появится прогноз.");
  }

  function trialAdvance(state, events) {
    const trial = state.trial;
    if (!trial) return;
    if (trial.phase === "scheduled" && state.elapsed + EPS >= trial.warn) {
      trial.phase = "warning";
      const first = trial.kind === "first";
      signal(state, first ? "alex" : "urgent", first ?
        "Алекс с орбиты · Буря через минуту. Проверь заряд и оставь питание отоплению и жилому отсеку." :
        "Штормовое предупреждение · Буря через минуту. Проверь обе колонии.");
      events.push("forecast");
      if (!first) events.push("checkpoint");
    }
    if (trial.phase === "warning" && state.elapsed + EPS >= trial.start) {
      trial.phase = "testing";
      signal(state, "urgent", "Пыльная буря началась. Дроны ожидают улучшения погоды.");
      events.push("storm");
    }
    if (!trial.cleared && state.elapsed + EPS >= trial.stormEnd) {
      markDirty(state);
      trial.cleared = true;
      if (trial.kind === "first") {
        signal(state, "system", "Буря прошла. На панелях осталась пыль.");
        events.push("clear");
      }
    }
  }

  function trialCheck(state, events, intervalStart) {
    const trial = state.trial;
    if (!trial || intervalStart + EPS < trial.start || intervalStart >= trial.end - EPS) return;
    const first = trial.kind === "first";
    if (first) {
      trial.failure ||= assess(city(state), true);
    } else {
      for (const base of state.bases) {
        const issue = assess(base);
        if (!issue) continue;
        trial.phase = "failed";
        state.finalResult = { success:false, base:base.id, issue };
        signal(state, "urgent", `${SITES[base.id].name} · ${issue}.`, base.id);
        events.push("defeat");
        return;
      }
    }

    if (state.elapsed + EPS < trial.end) return;
    if (!trial.cleared) markDirty(state);
    state.trial = null;
    if (first) {
      const base = city(state);
      const issue = trial.failure || (!enough(base.stock.water,2) || !enough(base.stock.food,2) ? "подготовь по 2 ед. воды и пищи" : null);
      state.firstResult = { success:!issue, issue };
      if (issue) {
        signal(state, "urgent", `Испытание не пройдено: ${issue}. Восстанови базу и назначь новую проверку.`, "city");
        events.push("setback");
        return;
      }
      countRooms(base, "habitat")[0].room.occupied = true;
      state.crew = true;
      state.chapter = 2;
      signal(state, "story", "Майя и Алекс приземлились. Открыты дроны, утепление и автоматическое управление энергией.", "city");
      events.push("landing", "chapter");
    } else {
      state.finalResult = { success:true, time:state.elapsed, colonies:state.bases.map(base => ({
        id:base.id, water:base.stock.water, food:base.stock.food, temp:base.temp, charge:base.charge
      })) };
      signal(state, "story", "Рассвет. Обе колонии выстояли. Грузовые рейсы возобновлены.");
      events.push("victory");
    }
  }

  function driveRover(rover, movement, dt) {
    const ax = Number(movement.x) || 0;
    const ay = Number(movement.y) || 0;
    const vector = Math.hypot(ax, ay);
    const speed = (movement.slow ? PRECISION_SPEED : DRIVE_SPEED) / Math.max(1, vector);
    const targetX = ax * speed;
    const targetY = ay * speed;
    const vx = Number.isFinite(rover.vx) ? rover.vx : 0;
    const vy = Number.isFinite(rover.vy) ? rover.vy : 0;
    const response = vector === 0 || movement.slow ? 24 : 17;
    const blend = 1 - Math.exp(-response * dt);
    // Integrate the velocity change so a short tap travels the same distance at different frame rates.
    const nextX = rover.x + targetX * dt + (vx - targetX) * blend / response;
    const nextY = rover.y + targetY * dt + (vy - targetY) * blend / response;
    rover.x = Math.min(W - 0.45, Math.max(0.45, nextX));
    rover.y = Math.min(H - 0.45, Math.max(0.45, nextY));
    rover.vx = rover.x === nextX ? vx + (targetX - vx) * blend : 0;
    rover.vy = rover.y === nextY ? vy + (targetY - vy) * blend : 0;
    if (!vector && Math.hypot(rover.vx, rover.vy) < 0.035) rover.vx = rover.vy = 0;
    if (vector > 0) {
      const current = Number.isFinite(rover.angle) ? rover.angle : 0;
      const heading = Math.atan2(ay, ax) - current;
      const turn = Math.atan2(Math.sin(heading), Math.cos(heading));
      rover.angle = current + turn * (1 - Math.exp(-13 * dt));
    }
    return Math.hypot(rover.vx, rover.vy);
  }

  function tick(state, dt, movement = null) {
    if (state.finalResult && !state.finalResult.success) return [];
    const events = [];
    const start = state.elapsed;
    if (movement) driveRover(state.rover, movement, dt);
    trialAdvance(state, events);
    const conditions = weather(state);
    // Reevaluate every two seconds and immediately at the start of an announced event.
    const reconsider = Math.floor((start + dt + EPS) / 2) !== Math.floor((start + EPS) / 2) || events.includes("checkpoint");
    for (const base of state.bases) {
      if (reconsider) runAlex(base, state);
      balanceBase(base, conditions, dt, events);
    }
    tickDrones(state, conditions, dt, events);
    state.elapsed = Math.round((start + dt) * 1e7) / 1e7;
    trialCheck(state, events, start);
    trialAdvance(state, events);
    if (state.chapter === 3) {
      for (const candidate of [SITES.basin,SITES.plateau]) {
        if (!state.explored.includes(candidate.id) && entityDist(state.rover, candidate) < 4) {
          state.explored.push(candidate.id);
          signal(state, "system", `${candidate.name} · Площадка обследована.`, candidate.id);
          events.push("survey");
        }
      }
    }
    advanceChapter(state, events);
    return events;
  }

  function mine(state, depositId) {
    const target = DEPOSITS.find(item => item.id === depositId);
    if (!target || !accessibleDeposit(state,target)) return bad("Месторождение пока недоступно.");
    if (entityDist(state.rover,target) > REACH) return bad("Подведи ровер ближе к месторождению.");
    const free = CARGO_CAP - state.rover.cargo.ice - state.rover.cargo.ore;
    if (free < 1) return bad("Грузовой отсек полон. Разгрузи ровер у склада.");
    state.rover.cargo[target.type] += free;
    return good(`В грузовом отсеке +${free} · ${RESOURCE_NAMES[target.type].toLowerCase()}`);
  }

  function unload(state, id) {
    const stock = localDepot(state,id);
    if (!stock) return bad("Склад ещё не развёрнут.");
    if (entityDist(state.rover,location(id)) > REACH) return bad("Подведи ровер ближе к складу.");
    if (!state.rover.cargo.ice && !state.rover.cargo.ore) return bad("Грузовой отсек пуст.");
    stock.ice += state.rover.cargo.ice;
    stock.ore += state.rover.cargo.ore;
    state.rover.cargo = { ice:0, ore:0 };
    return good("Сырьё выгружено на склад.");
  }

  function equipment(state, command) {
    const place = getPlace(state,command.x,command.y);
    if (place?.kind !== "building") return bad("Выбери установленный модуль.");
    const { base, item } = place;
    if (entityDist(state.rover,item) > REACH) return bad("Подведи ровер ближе к модулю.");
    const active = item.room || item;
    if (command.action === "clean") {
      if (item.type !== "solar" || !item.dirty) return bad("Панель чистая.");
      if (weather(state).storm) return bad("Очистка доступна после бури.");
      item.dirty = false;
      return good("Панель очищена.");
    }
    if (command.action === "mode") {
      if (item.type !== "refinery" || !["auto","ice","ore"].includes(command.mode)) return bad("Выбери режим переработки.");
      item.mode = command.mode;
      return good("Режим переработки изменён.");
    }
    if (command.action === "occupy") {
      if (!state.crew || active.type !== "habitat" || active.occupied) return bad("Заселение пока недоступно.");
      if (!active.powered || !enough(base.temp,SAFE_TEMP)) return bad("Нужны питание и температура от +16 °C.");
      if (!enough(base.stock.water,2) || !enough(base.stock.food,2)) return bad("Нужен запас от 2 ед. воды и пищи.");
      active.occupied = true;
      signal(state, "story", `${SITES[base.id].name} · Жилой отсек заселён.`, base.id);
      return good("В отсек прибыли два поселенца.");
    }
    if (command.action === "toggle" && ["greenhouse","refinery"].includes(active.type)) {
      if (bypassPower(active)) {
        active.override = null;
        active.enabled = false;
      } else {
        active.enabled = !active.enabled;
      }
      return good(active.enabled ? "Установка включена." : "Установка приостановлена.");
    }
    return bad("Действие недоступно.");
  }

  function configureDrone(state, command) {
    const drone = state.drones.find(item => item.id === command.id);
    if (!drone) return bad("Выбери дрон.");
    if (drone.cargo > 0) return bad("Дождись доставки текущего груза.");
    const { source, target, resource } = command;
    const supply = localDepot(state,target);
    const futureDepot = Boolean(state.selectedSite && target === state.selectedSite && !supply);
    if (!supply && !futureDepot) return bad("Выбери доступную точку назначения.");
    if (drone.kind === "mine") {
      const mineSite = DEPOSITS.find(item => item.id === source);
      if (!mineSite || !accessibleDeposit(state,mineSite) || futureDepot) return bad("Выбери месторождение и действующий склад.");
      drone.route = { source, target, resource:mineSite.type };
    } else {
      if (!localDepot(state,source) || source === target || !RESOURCE_NAMES[resource]) return bad("Выбери два разных пункта и тип груза.");
      if (futureDepot && (source !== "city" || resource !== "parts")) return bad("Для первого рейса отправь детали с городского склада.");
      drone.route = { source, target, resource };
    }
    drone.phase = "ready";
    drone.progress = 0;
    drone.paused = false;
    drone.reported = false;
    return good("Маршрут назначен.");
  }

  function dispatch(state, command) {
    if (state.finalResult && !state.finalResult.success) return bad("Повтори испытание с контрольной точки.");
    switch (command.type) {
      case "build": return build(state, command.building, command.x, command.y);
      case "mine": return mine(state,command.id);
      case "unload": return unload(state,command.id);
      case "equipment": return equipment(state,command);
      case "trial": return scheduleTrial(state);
      case "site": {
        if (state.chapter !== 3 || state.selectedSite) return bad("Площадка уже выбрана или пока закрыта.");
        if (!state.explored.includes(command.id)) return bad("Сначала обследуй площадку ровером.");
        state.selectedSite = command.id;
        signal(state, "story", `${SITES[command.id].name} выбрано. Отправь первый груз деталей из города.`, command.id);
        return good("Площадка закреплена за экспедицией.");
      }
      case "priority": {
        const base = byId(state,command.base);
        if (!base) return bad("Поселение ещё не построено.");
        base.priority = base.priority === "greenhouse" ? "refinery" : "greenhouse";
        return good(`Приоритет · ${TYPES[base.priority].name.toLowerCase()}`);
      }
      case "auto": {
        const base = byId(state,command.base);
        if (!state.crew || !base) return bad("Автоматизация пока недоступна.");
        base.auto = !base.auto;
        if (base.auto) {
          runAlex(base,state);
        } else {
          for (const item of commandsFor(base)) {
            if (bypassPower(item)) {
              item.override = null;
              item.enabled = false;
            }
          }
        }
        return good(base.auto ? "Алекс принял управление питанием." : "Ручное управление питанием.");
      }
      case "makeDrone": {
        const base = byId(state,command.base);
        if (!state.crew || !base || !["mine","cargo"].includes(command.kind)) return bad("Дроны пока недоступны.");
        if (entityDist(state.rover,SITES[base.id]) > REACH) return bad("Подведи ровер ближе к складу для сборки дрона.");
        if (!enough(base.stock.parts,6)) return bad("Для сборки дрона нужно 6 деталей.");
        base.stock.parts -= 6;
        const drone = { id:state.nextId++, kind:command.kind, home:base.id, route:null, cargo:0, progress:0, phase:"ready", paused:false, reported:false };
        state.drones.push(drone);
        return good("Дрон собран. Назначь ему маршрут.", { id:drone.id });
      }
      case "route": return configureDrone(state,command);
      case "holdDrone": {
        const drone = state.drones.find(item => item.id === command.id);
        if (!drone?.route) return bad("Сначала назначь маршрут.");
        drone.paused = !drone.paused;
        return good(drone.paused ? "Рейс приостановлен. Груз сохранён." : "Рейс возобновится при безопасной погоде.");
      }
      case "recallDrone": {
        const drone = state.drones.find(item => item.id === command.id);
        if (!drone?.route || weather(state).storm) return bad("Отзыв доступен при безопасной погоде.");
        if (drone.phase === "ready") {
          drone.paused = true;
        } else {
          const { from, to } = droneEndpoints(drone);
          if (drone.phase === "return") drone.progress = durations(from,to) - drone.progress;
          drone.phase = "recall";
          drone.paused = false;
        }
        return good("Дрон возвращается к точке отправления. Груз сохранён.");
      }
      default: return bad("Неизвестная команда.");
    }
  }

  function validateState(data) {
    if (!data || data.format !== SAVE_FORMAT || !Number.isFinite(data.elapsed) || data.elapsed < 0 ||
        !Number.isInteger(data.chapter) || data.chapter < 1 || data.chapter > 4 ||
        !Array.isArray(data.bases) || data.bases[0]?.id !== "city" || data.bases.length > 2 ||
        !data.rover || !Number.isFinite(data.rover.x) || !Number.isFinite(data.rover.y) ||
        !Array.isArray(data.drones) || !Array.isArray(data.log) || !Array.isArray(data.explored) ||
        !data.kit || !data.padStock || !data.rover.cargo) return false;
    for (const base of data.bases) {
      if (!SITES[base.id] || !Number.isFinite(base.temp) || !Number.isFinite(base.charge) ||
          !base.telemetry || !Array.isArray(base.buildings) || !base.stock ||
          Object.keys(RESOURCE_NAMES).some(key => !Number.isFinite(base.stock[key]) || base.stock[key] < 0) ||
          base.buildings.some(item => !TYPES[item.type] || !Number.isFinite(item.x) || !Number.isFinite(item.y))) return false;
    }
    if (data.drones.some(item => !SITES[item.home] || !["mine","cargo"].includes(item.kind) ||
         (item.route && (!location(item.route.target) || !RESOURCE_NAMES[item.route.resource] ||
         (item.kind === "mine" ? !DEPOSITS.some(s => s.id === item.route.source) : !location(item.route.source)))))) return false;
    return true;
  }

  function objectives(state) {
    const first = city(state);
    const next = byId(state,state.selectedSite);
    if (state.chapter === 1) return prepFirst(state);
    if (state.chapter === 2) return [
      { label:"Засели два жилых отсека", done:countRooms(first,"habitat").filter(item => item.room.occupied).length >= 2 },
      { label:"Запусти две теплицы одновременно", done:countRooms(first,"greenhouse").filter(item => item.room.powered).length >= 2 },
      { label:"Отправь добывающий или грузовой дрон", done:state.logistics }
    ];
    if (state.chapter === 3) return [
      { label:"Обследуй площадку ровером и закрепи её", done:Boolean(state.selectedSite) },
      { label:"Доставь детали для развёртывания склада", done:Boolean(next) },
      { label:"Построй купол, теплицу, жилой отсек и энергосеть", done:Boolean(next && hasType(next,"solar") && hasType(next,"battery") &&
        countRooms(next,"greenhouse").length && countRooms(next,"habitat").length) },
      { label:"Прогрей купол и засели отсек", done:Boolean(next && countRooms(next,"habitat").some(item => item.room.occupied)) }
    ];
    return [
      { label:"Проверь запасы, заряд и отопление обеих баз", done:Boolean(state.trial || state.finalResult) },
      { label:"Выдержи бурю и ночь до рассвета", done:Boolean(state.finalResult?.success) }
    ];
  }

  function powerEstimate(state, base) {
    const w = weather(state);
    const needed = criticalLoad(base,true);
    const load = needed.life + needed.heat;
    return { minutes: load ? base.charge / load : null, nightLoad:load,
      nextDawn: w.sunrise, capacity:capacity(base), occupants:countRooms(base,"habitat").filter(i => i.room.occupied).length * 2 };
  }

  const Engine = { DAY,SOL,STEP,EPS, W,H, SAFE_TEMP,TARGET_TEMP,CAPACITY,CARGO_CAP,REACH,DRIVE_SPEED,PRECISION_SPEED,driveRover,RESOURCE_NAMES,TYPES,SITES,PAD,DEPOSITS,CHAPTERS,
    newGame,tick,dispatch,weather,getPlace,checkBuild,validateState,objectives,powerEstimate,dronePosition,byId,location,localDepot,entityDist,clone,accessibleDeposit,feedFor,costOf };
  if (typeof module === "object" && module.exports) module.exports = Engine;
  else globalThis.TerraformiaEngine = Engine;
}());
