(function () {
  "use strict";
  const E = globalThis.TerraformiaEngine;
  const G = globalThis.TerraformiaGuidance;
  const $ = id => document.getElementById(id);
  const renderer = globalThis.TerraformiaRender.createRenderer($("map"),$("minimap"));
  const sound = globalThis.TerraformiaSound.createSoundscape();
  const KEY = "terraformia:campaign:1";
  const FORMAT = new Intl.NumberFormat("ru-RU",{maximumFractionDigits:1});
  const TYPES = Object.keys(E.TYPES);
  const SHORT = ["Панель","АКБ","Цех","Сектор","Ферма","Жильё","Тепло"];
  const directions = new Set(["KeyW","ArrowUp","KeyA","ArrowLeft","KeyS","ArrowDown","KeyD","ArrowRight"]);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const keys = new Set();
  let state = E.newGame();
  let mode = "title", returnMode = "title", selected = null, hover = null, build = null, plan = null;
  let pointer = null;
  let baseId = "city", tab = "status", droneId = null, follow = true, focus = {x:11.5,y:15.5};
  let storageIssue = false, bodyContent = "", toastUntil = 0, lastFrame = 0, remainder = 0, lastUI = 0, firstFrame = true;
  let panelPressed = false;
  let guideInfo = null, achievementUntil = 0;
  let timeRate = 1;
  let attempt = readSaves();

  const preview = (() => {
    const world = E.newGame();
    world.rover = {x:12.04,y:16.67,cargo:{ice:0,ore:0},angle:-.82};
    world.crew = true;
    const installations = [[11,14,"sector","greenhouse"],[12,14,"sector","habitat"],[12,15,"sector","habitat"],
      [13,14,"sector","greenhouse"],[10,14,"solar"],[10,13,"solar"],[11,13,"battery"],[12,13,"refinery"]];
    world.bases[0].charge=14;
    world.bases[0].telemetry.capacity=16;
    world.bases[0].buildings = installations.map(([x,y,type,room])=>({x,y,type,powered:true,room:room?{type:room,powered:true,occupied:room==="habitat",progress:24}:null}));
    return world;
  })();

  function readSaves() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return {};
      const saved = JSON.parse(raw);
      if (!E.validateState(saved.progress)) throw new Error("invalid save");
      if (!E.validateState(saved.checkpoint)) saved.checkpoint = null;
      return saved;
    } catch {
      storageIssue = true;
      return {};
    }
  }

  function save({ checkpoint = false, reset = false } = {}) {
    if (reset) attempt = {};
    if (checkpoint) attempt.checkpoint = E.clone(state);
    attempt.progress = E.clone(state);
    try {
      localStorage.setItem(KEY, JSON.stringify(attempt));
      storageIssue = false;
    } catch {
      storageIssue = true;
      flash("Браузер не сохранил прогресс на диске. Текущая игра доступна в этой вкладке.", "error", 6000);
    }
  }

  const html = value => String(value ?? "").replace(/[&<>"']/g, character =>
    ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" })[character]);
  const quantity = value => FORMAT.format(Number.isFinite(value)?value:0);
  const temperature = value => `${value < 0 ? "−" : "+"}${quantity(Math.abs(value))} °C`;
  const slug = value => String(value).padStart(2,"0");
  const duration = seconds => {
    const amount = Math.max(0, Math.ceil(seconds - E.EPS));
    return `${slug(Math.floor(amount / 60))}:${slug(amount % 60)}`;
  };
  const button = (label, action, extra="", cls="") => `<button class="btn ${cls}" data-action="${action}" ${extra}>${label}</button>`;
  const at = (node, key) => Number(node.dataset[key]);
  const xy = item => `data-x="${item.x}" data-y="${item.y}"`;
  const name = id => E.location(id)?.name || "Поселение";
  const disabled = condition => condition ? " disabled" : "";
  const meter = progress => `<div class="meter" aria-hidden="true"><i style="width:${Math.max(0,Math.min(100,progress))}%"></i></div>`;

  function flash(message, kind="", lifetime=3400) {
    const node = $("toast");
    node.textContent = message;
    node.className = kind ? "toast error" : "toast";
    toastUntil = performance.now() + lifetime;
    node.hidden = false;
  }

  function setMode(value) {
    keys.clear();
    state.rover.vx = state.rover.vy = 0;
    remainder = 0;
    mode = value;
    if (mode !== "play") sound.mix(false,0,E.weather(state));
    document.body.dataset.mode = mode;
    $("layout").inert = mode !== "play";
    document.querySelector(".top").inert = mode !== "play";
    document.querySelector(".bottom").inert = mode !== "play";
    const overlay = $("overlay");
    overlay.hidden = mode === "play";
    overlay.classList.toggle("hero-mode",mode === "title");
    if (mode === "play") {
      overlay.innerHTML = "";
    } else {
      overlay.innerHTML = overlayContents();
      overlay.querySelector("button")?.focus({preventScroll:true});
    }
    renderer.size();
    if(mode==="victory") {
      for(const canvas of overlay.querySelectorAll("canvas[data-summary-base]"))renderer.settlement(canvas,state,canvas.dataset.summaryBase);
    }
    if(mode!=="play")$("interact-card").hidden=true;
    updateSoundButtons();
    redrawPanel(true);
    // Safari can suspend animation callbacks while an embedded/hidden tab is
    // being shown. Repaint immediately on entering (or returning to) the game.
    if(mode==="play"||mode==="title"&&pendingFrame)wakeFrame();
  }

  function updateSoundButtons() {
    for (const control of document.querySelectorAll('[data-action="sound"]')) {
      control.setAttribute("aria-pressed", String(!sound.muted));
      control.title = sound.muted ? "Включить звуки игры" : "Выключить звуки игры";
      if (control.closest("#overlay")) control.textContent = sound.muted ? "Звук выключен" : "Звук включён";
    }
  }

  function overlayContents() {
    if (mode === "title") {
      return `<div class="hero"><div class="subheading">МАРСИАНСКАЯ ЭКСПЕДИЦИЯ</div>
        <h1 id="dialog-title">Terraformia</h1>
        <p>Ты управляешь ровером TERRA‑01. Преврати посадочную площадку в обитаемый город и проведи две колонии через большую пыльную бурю.</p>
        <div class="actions">${attempt.progress ? button("Продолжить","continue","","btn-primary") : ""}
          ${button(attempt.progress?"Новая игра":"Начать экспедицию","new","",attempt.progress?"":"btn-primary")}
          ${button("Управление","help")}${button("Звук игры","sound")}</div>
        <p class="keys">${storageIssue ? "Последнее сохранение недоступно. Можно начать новую кампанию." : "<kbd>WASD</kbd> или стрелки · <kbd>E</kbd> действие рядом · мышь для строительства"}</p></div>`;
    }
    if (mode === "help") {
      return dialog("УПРАВЛЕНИЕ","Как играть",
        `<ul><li><strong>WASD или стрелки</strong> — двигать ровер. Удерживай <strong>Shift</strong> для точного хода. Подъедь к объекту и нажми <strong>E</strong> или щёлкни по карточке над ним.</li>
          <li><strong>Текущая цель</strong> слева указывает следующий шаг, запас деталей и недостающее. Зелёная метка — строительство, голубая — лёд, оранжевая — руда, жёлтая — склад. Стрелка у края карты ведёт к цели.</li>
          <li><strong>Мышь</strong> — выбрать объект на карте. Выбери постройку: карточка покажет запас деталей, недостающее и следующий шаг. Зелёные клетки доступны для размещения, жёлтые и голубые маркеры ведут к складу и ресурсам. Для теплицы или жилья сначала нужен свободный сектор.</li>
          <li><strong>Мини-карта</strong> — переместить камеру. Кнопка TERRA‑01 возвращает её к роверу. В «Обзоре» можно переключать показания поселения.</li>
          <li><strong>Esc</strong> — снять выбор постройки или поставить игру на паузу. В паузе игровые часы и установки останавливаются.</li></ul>`,
        button("Назад","back","","btn-primary"));
    }
    if (mode === "reset") {
      return dialog("НОВАЯ ЭКСПЕДИЦИЯ","Начать сначала?",
        "<p>Текущий прогресс и точка прогноза будут заменены новой кампанией.</p>",
        button("Начать заново","start","","btn-primary")+button("Отмена","title"));
    }
    if (mode === "pause") {
      return dialog(`СОЛ ${slug(E.weather(state).sol)} · ЭКСПЕДИЦИЯ НА ПАУЗЕ`,"Пауза",
        "<p>Игровые часы остановлены.</p>",
        button("Продолжить","resume","","btn-primary")+button("Управление","help")+button("Звук игры","sound")+button("Сохранить и выйти","save-exit"));
    }
    if (mode === "landing") {
      return dialog("ПОСАДОЧНАЯ ДОЛИНА · СВЯЗЬ","Экипаж прибыл",
        `<p><b>Майя Рид</b> · «Теплица пережила марсианскую ночь. Теперь сможем выращивать пищу для города».</p>
          <p><b>Алекс Морган</b> · «Я могу следить за резервом энергии. На складе уже можно собирать дроны и готовить утепление».</p>`,
        button("Развивать город","resume","","btn-primary"));
    }
    if (mode === "defeat") {
      const result = state.finalResult;
      return dialog("БОЛЬШАЯ БУРЯ","Испытание прервано",
        `<p><strong>${html(name(result.base))}</strong> · ${html(result.issue)}.</p><p>При повторе обе базы вернутся к состоянию на момент прогноза. Перераспредели питание и проверь запас воды и пищи.</p>`,
        button("Повторить с прогноза","retry",disabled(!attempt.checkpoint),"btn-primary")+button("В главное меню","title"));
    }
    if (mode === "victory") {
      const time = E.weather(state);
      const reading = state.finalResult.colonies.map(base=>
        `<article class="victory-colony"><canvas width="520" height="260" data-summary-base="${html(base.id)}" aria-label="Вид построенного поселения"></canvas><div class="victory-info">
          <h3>${html(name(base.id))}</h3><p>${E.powerEstimate(state,E.byId(state,base.id)).occupants} жителей · ${temperature(base.temp)} · заряд ${quantity(base.charge)}</p>
          <p>Вода ${quantity(base.water)} · пища ${quantity(base.food)}</p></div></article>`).join("");
      return dialog(`РАССВЕТ · СОЛ ${slug(time.sol)}`,"Обе колонии выстояли",
        `<p>Буря прошла. Жилые модули работают, и грузовые рейсы возобновились. Экспедиция Terraformia завершена.</p><div class="colony-results">${reading}</div>`,
        button("Осмотреть поселения","resume","","btn-primary")+button("В главное меню","title"),"victory-dialog");
    }
    return "";
  }

  function dialog(heading,title,details,actions,cls="") {
    return `<div class="dialog ${cls}"><div class="overline">${heading}</div><h2 id="dialog-title">${title}</h2>${details}
      <div class="actions">${actions}</div></div>`;
  }

  function play(newState, newCampaign) {
    state = newState;
    if(!Array.isArray(state.achievements)) {
      const built=state.bases.flatMap(base=>base.buildings);
      const known=[
        ["module",built.length>0],["dome",built.some(item=>item.type==="sector")],
        ["crew",state.crew],["drone-built",state.drones.length>0],["delivery",state.logistics],
        ["outpost",state.bases.length>1],["city",state.chapter>=3],["both",state.chapter>=4],
        ["victory",state.finalResult?.success]
      ];
      state.achievements=known.filter(([,done])=>done).map(([key])=>key);
    }
    selected = hover = build = pointer = plan = null;
    renderer.resetView();
    timeRate = 1;
    $("map").classList.remove("building");
    refreshPlacement();
    baseId = "city";
    tab = "status"; droneId = null; follow = true; focus = {x:state.rover.x,y:state.rover.y};
    $("toast").hidden = true;
    $("achievement").hidden = true;
    $("interact-card").hidden = true;
    guideInfo = null;
    if (newCampaign) save({reset:true});
    if (state.finalResult && !state.finalResult.success) setMode("defeat");
    else setMode("play");
  }

  function nextAdvice() {
    const first = state.bases[0];
    if (state.chapter === 1) {
      if (state.firstResult && !state.firstResult.success) return "Проверка прервана. Пополни запасы и заряд, затем назначь новый прогон.";
      if (state.trial) return state.trial.phase === "scheduled" ?
        "Первое испытание начнётся днём. Проверь заряд и запасы до предупреждения." :
        "Для проверки оставь питание теплу и жилому отсеку. На рассвете понадобится по 2 ед. воды и пищи.";
      if (state.kit.solar || state.kit.refinery) return "Готовые панель и переработчик лежат на складе. Размести их рядом с ровером.";
      if (E.objectives(state)[2].done) return "Переработай лёд и прогрей секторы. Для испытания заряди батарею и подготовь воду и пищу.";
      if (first.stock.parts < 15 && !first.stock.ore) return "Добыча → склад → переработчик. Один полный рейс руды даст до 8 деталей.";
      return "Поставь первый сектор рядом со складом, второй рядом с ним. Размести в них теплицу и жилой отсек.";
    }
    if (state.chapter === 2) return "По мере роста города добавь солнечную панель. Избыток мощности днём нужен для ночного запаса.";
    if (state.chapter === 3) {
      if (!state.selectedSite) return "Ледяная низина даёт местный лёд. На плато панели мощнее, а воду нужно привозить.";
      const base = E.byId(state,state.selectedSite);
      if (!base) return "Собери грузовой дрон. Первый рейс отправь из городского склада с деталями.";
      return state.selectedSite === "plateau" ? "Перевози воду и детали с первой базы. Прогрей новый купол, затем засели отсек." : "Лёд можно добыть на месте. Прогрей купол и заряди запас: второй солнечный модуль позволит питать и теплицу, и цех.";
    }
    if (state.finalResult?.success) return "Кампания завершена. Можно осмотреть базы на рассвете.";
    if (state.trial) return state.trial.phase === "testing" ? "Следи за теплом, жизнеобеспечением и запасами обеих баз до рассвета." :
      "Подготовь обе базы. Запасы для жителей должны покрывать прогноз, бурю и ночь.";
    return "Заряди батареи и подготовь воду и пищу. Алекс может разгрузить сеть каждой базы перед ночью.";
  }

  function stockCards(stock,requirements=null) {
    return `<div class="stock-grid">${Object.entries(E.RESOURCE_NAMES).map(([key,label])=>
      `<div class="stock-item${key==="parts"&&requirements?.required?requirements.missing?" stock-missing":" stock-enough":""}"><span class="resource-symbol ${key}" aria-hidden="true"></span><b>${quantity(stock[key])}</b><small>${label}</small></div>`).join("")}</div>`;
  }

  function bill(r,compact=false) {
    const ratio=r.required?Math.min(100,r.available/r.required*100):100;
    const count=r.required?`${quantity(r.available)}/${r.required}`:"Модуль в запасе";
    const note=r.required?r.missing?`ещё ${r.missing} дет.`:"достаточно":"без затрат";
    return `<div class="material-bill ${r.missing?"short":"enough"}${compact?" compact":""}"><div class="bill-line"><b>${r.required?"Детали · ":""}${count}</b><span>${note}</span></div>
      <div class="bill-track" aria-hidden="true"><i style="width:${ratio}%"></i></div></div>`;
  }

  function productionList(base) {
    return base.buildings.map(item=>G.production(state,base,item)).filter(Boolean);
  }

  function productionRow(info,compact=false) {
    const status=info.running?`${info.percent}% · ${info.remaining} с`:`${info.reason}${info.progress?` · ${info.percent}%`:""}`;
    return `<div class="production-row ${info.running?"running":"waiting"}${compact?" compact":""}"><div class="production-line"><b>${html(info.recipe)}</b><span>${html(status)}</span></div>
      <div class="production-track" aria-hidden="true"><i style="width:${info.percent}%"></i></div>${!compact?`<small>${html(info.label)} · ${info.running?"Производство идёт":html(info.reason)}</small>`:""}</div>`;
  }

  function productionPanel(base) {
    const rows=productionList(base);
    return rows.length?`<section class="panel-section"><h3 class="section-heading">Производство · время до выпуска</h3><div class="production-list">${rows.map(info=>productionRow(info)).join("")}</div></section>`:"";
  }

  function updateStock() {
    const base=E.byId(state,baseId)||state.bases[0];
    const info=guideInfo?.requirement;
    const r=info?.base===base.id?G.requirements(state,base,info.type):null;
    const content=stockCards(base.stock,r);
    if($('stock-strip').innerHTML!==content)$('stock-strip').innerHTML=content;
    const label=$("stock-plan-label");
    label.hidden=!r?.required;
    if(r?.required) {
      label.textContent=r.missing?`Для цели ещё ${r.missing} дет.`:"Деталей достаточно";
      label.className=r.missing?"short":"enough";
    }
    const rows=productionList(base);
    // Show one refinery and one farm at most; the full list and selected object
    // still expose every individual cycle. Prefer a module that is running.
    const summaries=["Переработчик","Теплица"].map(kind=>rows.find(item=>item.label===kind&&item.running)||rows.find(item=>item.label===kind)).filter(Boolean);
    const production=$("stock-production"), views=summaries.map(item=>productionRow(item,true)).join("");
    production.hidden=!summaries.length;
    if(production.innerHTML!==views)production.innerHTML=views;
  }

  function networkStats(base) {
    const e = E.powerEstimate(state,base);
    const {generation,load,demand} = base.telemetry;
    return `<div class="telemetry">
      <div class="reading ${base.temp < 16 ? "low" : ""}"><span class="tag">КУПОЛ</span><b>${temperature(base.temp)}</b><small>${e.occupants} поселенцев · ${base.telemetry.heat?"обогрев":"без обогрева"}</small></div>
      <div class="reading ${base.charge < e.capacity*.24 ? "low" : ""}"><span class="tag">ЗАРЯД</span><b>${quantity(base.charge)} / ${e.capacity}</b>${meter(e.capacity?base.charge/e.capacity*100:0)}</div>
      <div class="reading ${demand > generation + E.EPS ? "low" : ""}"><span class="tag">ВЫРАБОТКА / РАСХОД</span><b>${quantity(generation)} / ${quantity(load)}</b><small>Запрос ${quantity(demand)} ед. мощности</small></div>
      <div class="reading"><span class="tag">РЕЗЕРВ НОЧЬЮ</span><b>${e.minutes===null?"—":duration(e.minutes*60)}</b><small>Тепло и жизнеобеспечение</small></div>
      </div>`;
  }

  function overview() {
    const base = E.byId(state,baseId) || state.bases[0];
    const list = E.objectives(state);
    const activeIndex = list.findIndex(item=>!item.done);
    const ready = state.chapter === 1 && list.slice(0,4).every(item=>item.done);
    const mayStart = !state.trial && !state.finalResult && ((state.chapter===1 && ready) || state.chapter===4);
    const completed=list.filter(item=>item.done).length;
    return `${objectCard()}<section class="panel-section">
      <h3 class="section-heading objective-heading">Задачи главы <span>${completed}/${list.length}</span></h3>
      <div class="objective-meter" aria-hidden="true"><i style="width:${completed/list.length*100}%"></i></div>
      <ul class="obj">${list.map(({label,done},i)=>`<li class="${done?"done":i===activeIndex?"next":""}">${html(label)}</li>`).join("")}</ul>
      <p class="next-note">${nextAdvice()}</p>
      ${mayStart ? button(state.chapter===1?"Назначить первое испытание":"Назначить большую бурю","trial","","btn-primary panel-button") : ""}
      ${state.trial?.phase==="scheduled"?`<p class="next-note">До прогноза ${duration(state.trial.warn-state.elapsed)}</p>`:""}
    </section>
    <section class="panel-section"><h3 class="section-heading">Энергосеть и тепло</h3>${networkStats(base)}
      <div class="actions">
        ${button(base.priority==="greenhouse"?"Приоритет: теплица":"Приоритет: переработчик","priority",`data-base="${base.id}"`)}
        ${state.crew?button(base.auto?"Алекс · авто":"Энергия · вручную","auto",`data-base="${base.id}" title="Переключить режим энергоснабжения"`,base.auto?"btn-primary":""):""}
      </div>
    </section>
    ${productionPanel(base)}
    ${state.trial || state.chapter===4 ? readinessPanel() : ""}
    ${state.chapter===3&&!state.selectedSite?`<section class="panel-section">
      <h3 class="section-heading">Участки экспедиции</h3>
      ${["basin","plateau"].map(id=>`<div class="card" style="margin-bottom:5px"><h3>${name(id)}</h3><p>${E.SITES[id].note}</p>
        <div class="actions">${button("На карте","focus",`data-base="${id}"`)}${state.explored.includes(id)?button("Выбрать участок","site",`data-base="${id}"`,"btn-primary"):""}</div></div>`).join("")}
    </section>`:""}
    ${state.bases.length>1?`<section class="panel-section"><h3 class="section-heading">Два поселения</h3>
      ${state.bases.map(b=>`<div class="card" style="margin-bottom:5px"><h3>${name(b.id)}</h3><p>${temperature(b.temp)} · заряд ${quantity(b.charge)} · вода ${quantity(b.stock.water)} · пища ${quantity(b.stock.food)}</p></div>`).join("")}</section>`:""}`;
  }

  function readinessPanel() {
    return `<section class="panel-section"><h3 class="section-heading">Готовность к испытанию</h3>
      ${state.bases.map(base=>`<div class="readiness-name">${html(name(base.id))}</div><div class="reading-status">${G.readiness(state,base).map(value=>
        `<div class="${value.ok?"":"low"}"><span>${html(value.label)}</span><b>${value.ok?"✓ ":""}${html(value.value)}</b></div>`).join("")}</div>`).join("")}
      <p class="readiness-note">Заряд рассчитан для отопления и жилых отсеков на ночь. Вода и пища — ориентир на оставшееся испытание без производства.</p></section>`;
  }

  function objectCard() {
    if (!selected) return "";
    const place = E.getPlace(state,selected.x,selected.y);
    if (!place) return "";
    const {kind,item,base} = place;
    const close = '<button class="close-card" data-action="clear" aria-label="Закрыть карточку">×</button>';
    const local = E.entityDist(state.rover,item) <= E.REACH;
    const data = xy(item);
    let nameText, note, actions = "", extra = "";
    if (kind === "depot" || kind === "pad") {
      nameText = kind === "pad" ? "Посадочный терминал" : `Склад · ${name(base.id)}`;
      const stock = kind === "pad" ? E.localDepot(state,"pad") : base.stock;
      note = stock ? Object.entries(E.RESOURCE_NAMES).map(([key,label])=>`${label} ${quantity(stock[key])}`).join(" · ") : "Терминал активируется после посадки экипажа.";
      if(stock) actions = button("Выгрузить (E)","unload",`data-base="${item.id}"${disabled(!local)}`,"btn-primary");
    } else if (kind === "deposit") {
      nameText = `${E.RESOURCE_NAMES[item.type]} · месторождение`;
      const open = E.accessibleDeposit(state,item);
      note = open ? "Одна погрузка заполняет свободное место в грузовом отсеке." : "Добыча здесь откроется после выбора площадки.";
      actions = open ? button("Добыть (E)","mine",`data-id="${item.id}"${disabled(!local)}`,"btn-primary") : "";
    } else if (kind === "site") {
      nameText = item.name;
      note = state.chapter<3?"Разведка откроется после основания города.":item.note;
      if (state.chapter===3 && !state.selectedSite && state.explored.includes(item.id)) actions=button("Выбрать участок","site",`data-base="${item.id}"`,"btn-primary");
      if (state.selectedSite===item.id) actions=button("Управление дронами","drones");
    } else {
      const type = item.room?.type || item.type;
      const active = item.room || item;
      nameText = E.TYPES[type].name;
      note = E.TYPES[type].detail;
      if (item.type === "solar") {
        const w = E.weather(state);
        const rate = w.night ? 0 : E.SITES[base.id].solar*(w.storm?.4:item.dirty?.75:1);
        note = `${item.dirty?"Панель запылена":"Панель чистая"} · ${quantity(rate)} ед. мощности`;
        if(item.dirty)actions=button("Очистить (E)","equipment",`data-command="clean" ${data}${disabled(!local||w.storm)}`,"btn-primary");
      }
      if (["greenhouse","refinery"].includes(type)) {
        const isOn = active.enabled && active.override !== "off";
        const production=G.production(state,base,item);
        extra=productionRow(production);
        actions = button(isOn?"Приостановить":"Включить","equipment",`data-command="toggle" ${data}${disabled(!local)}`);
        if (item.type==="refinery") {
          const nextMode=({auto:"ore",ore:"ice",ice:"auto"})[item.mode];
          const labels={auto:"Авто",ore:"Детали",ice:"Вода"};
          actions+=button(`Режим: ${labels[item.mode]}`,"equipment",`data-command="mode" data-value="${nextMode}" ${data}${disabled(!local)}`);
        }
      }
      if (type==="habitat") {
        note = `${active.occupied?"Заселён · 2 человека":"Свободен"} · ${active.powered?"Жизнеобеспечение работает":"Нет питания"}`;
        if(!active.occupied && state.crew) actions=button("Заселить отсек","equipment",`data-command="occupy" ${data}${disabled(!local)}`,"btn-primary");
      }
      if(type==="sector" && !item.room) {
        note = `Свободный сектор · ${item.insulated?"утеплён":"доступен под теплицу или жильё"}`;
        actions=button("Теплица","build",`data-building="greenhouse"${disabled(!local)}`)+button("Жилой отсек","build",`data-building="habitat"${disabled(!local)}`);
      }
    }
    return `<section class="panel-section card focus-card">${close}<div class="label">Выбранный объект</div><h3>${html(nameText)}</h3>
      <p>${html(note)}</p>${!local && !["site"].includes(kind)?'<p class="hot">Подведи ровер ближе для действия.</p>':""}
      ${extra}${actions?`<div class="actions">${actions}</div>`:""}</section>`;
  }

  function planCard() {
    if(!plan)return "";
    const base=E.byId(state,plan.base);
    if(!base)return "";
    const r=G.requirements(state,base,plan.type), step=guideInfo;
    const slot=r.room||r.insulation;
    const canPoint=step?.shortcut?.type==="build"&&step.target;
    const local=canPoint&&E.entityDist(state.rover,step.target)<=E.REACH;
    const label=E.TYPES[plan.type].name;
    const stepLabel=r.needsSector?"Выбрать сектор":"Выбрать место";
    return `<section class="card plan-card ${r.missing?"plan-short":""}"><div class="plan-kicker">План строительства · ${html(name(base.id))}</div>
      <div class="plan-title"><h3>${html(label)}</h3><button class="close-card" data-action="clear-plan" aria-label="Снять план строительства">×</button></div>
      ${bill(r)}${r.needsSector?`<div class="recipe-breakdown"><span>Сектор <b>${r.required-r.cost} дет.</b></span><i>+</i><span>${html(label)} <b>${r.cost} дет.</b></span></div>`:""}
      <div class="plan-checks">
        <div class="${r.missing?"check-pending":"check-ok"}"><span class="check-icon">${r.missing?"!":"✓"}</span><span><b>Детали на складе</b><small>${r.missing?`Не хватает ${r.missing} дет.`:r.included?"Модуль уже в запасе":"Хватает для строительства"}</small></span></div>
        ${slot?`<div class="${r.needsSector?"check-pending":"check-ok"}"><span class="check-icon">${r.needsSector?"1":"✓"}</span><span><b>${r.insulation?"Сектор без утепления":"Свободный герметичный сектор"}</b><small>${r.needsSector?"Сначала построй отдельный сектор":`Доступно: ${r.slots}. Размести модуль внутри.`}</small></span></div>`:""}
        <div class="${local?"check-ok":"check-pending"}"><span class="check-icon">${local?"✓":"⌖"}</span><span><b>Место строительства</b><small>${canPoint?local?"Ровер рядом, можно размещать":`Подъедь к метке: ${Math.ceil(E.entityDist(state.rover,step.target))} кл.`:"Станет доступно после нужного шага"}</small></span></div>
      </div><div class="actions plan-actions">${r.missing?button("Показать нужный ресурс","find-materials","","btn-primary"):""}
        ${!r.missingNext&&!r.locked?button(build===r.next?"Показать место":stepLabel,"plan-place","",r.missing?"":"btn-primary"):""}
        ${button("К задаче главы","clear-plan")}</div></section>`;
  }

  function buildingList() {
    const base=E.byId(state,baseId)||state.bases[0];
    return `<section class="panel-section"><h3 class="section-heading">Размещение модулей</h3>
      ${plan?planCard():`<p class="next-note" style="margin:0 0 8px">Выбери постройку. Шкала показывает запас деталей, включая сектор для теплицы или жилья. Зелёные клетки на карте подходят для строительства.</p>`}
      <div class="build-list">${TYPES.map(type=>{
        const entry=E.TYPES[type], r=G.requirements(state,base,type);
        const status=r.locked?"Закрыто":r.included?"В запасе":r.missing?`Ещё ${r.missing}`:r.needsSector?"Нужен сектор":"✓ Хватает";
        const label=r.included?"Готово":`${r.available}/${r.required} дет.`;
        return `<button class="build-item ${r.missing?"recipe-short":"recipe-ready"}${r.needsSector?" recipe-prerequisite":""}" data-action="build" data-building="${type}" aria-pressed="${type===plan?.type&&plan?.base===base.id||type===build}"${disabled(r.locked)}>
          <canvas width="40" height="36" data-icon="${type}" aria-hidden="true"></canvas><span class="recipe-copy"><strong>${entry.name}</strong><small>${entry.detail}</small>${r.needsSector?'<small class="recipe-prereq">В цену входит сектор</small>':""}</span>
          <span class="recipe-amount"><b>${r.locked?"После посадки":label}</b><small>${status}</small><span class="recipe-track" aria-hidden="true"><i style="width:${r.required?Math.min(100,r.available/r.required*100):100}%"></i></span></span></button>`;
      }).join("")}</div></section>`;
  }

  function dronePanel() {
    if (!state.crew) return `<div class="card"><h3>Ангар закрыт</h3><p>Инженер Алекс откроет сборку дронов после первой посадки.</p></div>`;
    function optionList(entries,current) {
      return entries.map(([id,text])=>`<option value="${html(id)}"${id===current?" selected":""}>${html(text)}</option>`).join("");
    }
    const real = state.bases.map(base=>[base.id,name(base.id)]);
    const destinations = [...real,["pad",name("pad")]];
    const cargoTargets = [...destinations];
    if (state.selectedSite && !E.byId(state,state.selectedSite)) cargoTargets.push([state.selectedSite,name(state.selectedSite)]);
    const mines = E.DEPOSITS.filter(d=>E.accessibleDeposit(state,d)).map(d=>[d.id,`${E.RESOURCE_NAMES[d.type]} · ${name(d.site)} (${d.x}, ${d.y})`]);
    const selectedD = state.drones.find(item=>item.id===droneId);
    const cards = state.drones.map(d=>{
      const desc=d.kind==="mine"?"Добывающий":"Грузовой";
      let status = !d.route?"Нет маршрута":d.paused?"Пауза":E.weather(state).storm?"Ждёт окончания бури":
        d.phase==="deliver"?"В пути":d.phase==="return"?"Возвращается":d.phase==="recall"?"Отозван":"Готов";
      const info = d.route ? `${d.kind==="mine"?E.RESOURCE_NAMES[d.route.resource]+" · месторождение":name(d.route.source)} → ${name(d.route.target)} · груз ${d.cargo}/8` : "Назначь пункты маршрута.";
      return `<article class="card ${d.id===droneId?"focus-card":""}"><div class="drone-name"><h3>${desc} №${d.id}</h3><small>${status}</small></div>
        <p>${html(info)}</p><div class="actions">
        ${button(d.id===droneId?"Скрыть маршрут":"Маршрут","select-drone",`data-id="${d.id}"`)}
        ${d.route?button(d.paused?"Возобновить":"Приостановить","hold",`data-id="${d.id}"`):""}
        ${d.route && !d.paused?button("Отозвать","recall",`data-id="${d.id}"`):""}
      </div></article>`;
    }).join("");
    const route = selectedD ? (() => {
      const current=selectedD.route;
      const mining=selectedD.kind==="mine";
      const sources=mining?mines:destinations;
      const targets=mining?destinations:cargoTargets;
      const defaultSource=current?.source || (mining?mines[0]?.[0]:"city");
      const defaultTarget=current?.target || (mining?"city":state.selectedSite||"pad");
      return `<section class="panel-section card focus-card"><h3>Маршрут дрона №${selectedD.id}</h3>
        <form class="route-form" id="route-form" data-id="${selectedD.id}">
        <label>${mining?"Залежь":"Откуда"}<select name="source">${optionList(sources,defaultSource)}</select></label>
        <label>Куда<select name="target">${optionList(targets,defaultTarget)}</select></label>
        ${mining?'':`<label>Груз<select name="resource">${optionList(Object.entries(E.RESOURCE_NAMES),current?.resource||"parts")}</select></label>`}
        ${selectedD.cargo?'<p class="hot">Сначала заверши текущую доставку.</p>':""}
        <button class="btn btn-primary" type="submit"${disabled(selectedD.cargo)}>Назначить рейс</button></form></section>`;
    })() : "";
    const stock=(E.byId(state,baseId)||state.bases[0]).stock.parts, available=Math.floor(stock+E.EPS);
    return `<section class="panel-section"><h3 class="section-heading">Парк дронов</h3><p class="next-note" style="margin-top:0">Сборка у склада выбранного поселения · 6 деталей.</p>
      ${bill({required:6,available,missing:Math.max(0,6-available)})}
      <div class="actions">${button("Добывающий +","make-drone",`data-kind="mine"${disabled(available<6)}`)}${button("Грузовой +","make-drone",`data-kind="cargo"${disabled(available<6)}`)}</div></section>
      ${route}<div class="drone-list">${cards}</div>`;
  }

  function journal() {
    return `<section class="panel-section"><h3 class="section-heading">События и решения</h3>
      ${state.log.length?`<ol class="news">${state.log.map(item=>`<li class="${html(item.kind)}"><time>Сол ${slug(Math.floor(item.time/E.SOL)+1)} · ${duration(item.time%E.SOL)}</time>${html(item.text)}</li>`).join("")}</ol>`:"<div class=\"card\"><p>Здесь появятся прогноз, прибытие экипажа и решения Алекса.</p></div>"}</section>`;
  }

  function iconify(root) {
    root.querySelectorAll("canvas[data-icon]").forEach(node=>renderer.icon(node,node.dataset.icon));
  }

  function updateTop(w) {
    $("sol").textContent = `Сол ${slug(w.sol)}`;
    $("clock").textContent = duration(Math.floor(w.clock+E.EPS));
    $("weather").textContent = w.storm ? w.night?"Буря · ночь":"Пыльная буря" : w.night?"Ночь":"День";
    $("outside").textContent = temperature(w.outside);
    $("day-mark").className = `time-signal ${w.night?"night":""} ${w.storm?"storm":""}`;
    const emergency = state.trial?.phase === "warning" || state.trial?.phase === "testing";
    $("time-rate").disabled = emergency;
    $("time-rate").textContent = `×${timeRate}`;
    $("time-rate").title = emergency ? "Во время испытания действует обычная скорость" : "Переключить скорость ожидания ×1 / ×4";
    const cargo=G.cargoText(state.rover.cargo);
    $("cargo").textContent = `Груз ${state.rover.cargo.ice+state.rover.cargo.ore} / 8${cargo?" · "+cargo:""}`;
    const ref = follow ? state.rover : focus;
    const current = Object.values(E.SITES).find(site=>ref.x>=site.bounds[0] && ref.y>=site.bounds[1] && ref.x<=site.bounds[2]+1 && ref.y<=site.bounds[3]+1);
    $("position").textContent = current && (current.id==="city" || state.chapter>=3)?current.name.toUpperCase():"МАРСИАНСКАЯ ПОВЕРХНОСТЬ";
    $("chapter-no").textContent = `ГЛАВА ${slug(state.chapter)} / 04`;
    $("chapter-title").textContent = E.CHAPTERS[state.chapter-1];
    const bars = E.CHAPTERS.map((_,i)=>`<i class="${i+1===state.chapter?"active":i+1<state.chapter?"done":""}"></i>`).join("");
    if ($("chapter-bars").innerHTML !== bars) $("chapter-bars").innerHTML=bars;
    const bases = state.bases.map(b=>`<button data-action="base" data-base="${b.id}" aria-pressed="${b.id===baseId}">${html(name(b.id))}</button>`).join("");
    if ($("base-select").dataset.previous !== bases) {
      $("base-select").innerHTML=bases;
      $("base-select").dataset.previous=bases;
    }
    const banner=$("warning");
    const trial=state.trial;
    let message="";
    if(w.forecast!==null)message=`Пыльная буря через ${duration(w.forecast)}<small>Проверь заряд, жизнеобеспечение и запасы.</small>`;
    else if(w.storm)message=`Пыльная буря · до окончания ${duration(trial.stormEnd-state.elapsed)}<small>${w.night?"Ночь · питание идёт от аккумуляторов":"Дневная выработка 40% · рейсы приостановлены"}</small>`;
    else if(trial?.phase==="testing" && trial.kind==="first")message=`Первое испытание · до рассвета ${duration(trial.end-state.elapsed)}<small>Купол должен сохранить питание и безопасную температуру.</small>`;
    banner.hidden=!message;
    if(message)banner.innerHTML=message;
  }

  function redrawPanel(force=false) {
    updateTop(E.weather(state));
    $("nearby-action").textContent = G.nearby(state)?.label || "Действие рядом";
    if(mode==="play")updateGuide();
    updateStock();
    for(const node of document.querySelectorAll("[data-tab]")) node.setAttribute("aria-pressed",node.dataset.tab===tab);
    const base=E.byId(state,baseId)||state.bases[0];
    for(const node of $("quick").querySelectorAll("button")) {
      const type=node.dataset.building;
      const r=G.requirements(state,base,type);
      node.disabled=r.locked;
      node.setAttribute("aria-pressed",type===build||type===plan?.type&&plan.base===base.id);
      node.title=`${E.TYPES[type].name} · ${r.included?"готово на складе":`детали ${r.available}/${r.required}${r.missing?` · осталось ${r.missing}`:""}${r.needsSector?" · включая сектор":""}`}`;
      node.dataset.status=r.missing?"short":"enough";
      node.dataset.count=r.locked?"—":r.included?"✓":`${r.available}/${r.required}`;
      node.style.setProperty("--resource-fill",`${r.required?Math.min(100,r.available/r.required*100):100}%`);
    }
    if (!force && (panelPressed || document.activeElement?.closest("#route-form"))) return;
    const text=tab==="status"?overview():tab==="build"?buildingList():tab==="drones"?dronePanel():journal();
    if(text===bodyContent)return;
    const old=$("panel-body"), offset=old.scrollTop;
    const viewport=old.getBoundingClientRect();
    const focusNode=document.activeElement;
    const oldIndex=focusNode?.closest("#panel-body")?[...old.querySelectorAll("button,select")].indexOf(focusNode):-1;
    if (oldIndex>=0 && focusNode.getBoundingClientRect().top > viewport.bottom) keys.clear();
    const form=old.querySelector("#route-form");
    const oldValues=form?Object.fromEntries(new FormData(form)):null;
    bodyContent=text;
    old.innerHTML=text;
    const currentForm=old.querySelector("#route-form");
    const formId=currentForm?.dataset.id;
    if (oldValues && formId===form.dataset.id) {
      for(const [key,value] of Object.entries(oldValues)) {
        const field=currentForm.elements.namedItem(key);
        if (field && [...field.options].some(option=>option.value===value)) field.value=value;
      }
    }
    iconify(old);
    old.scrollTop=offset;
    if(oldIndex>=0 && !force) old.querySelectorAll("button,select")[oldIndex]?.focus({preventScroll:true});
  }

  function updateGuide() {
    const planBase=plan&&E.byId(state,plan.base);
    guideInfo=planBase?G.constructionGoal(state,planBase,plan.type,plan.materials):G.current(state);
    if(build&&planBase&&(guideInfo.shortcut?.type!=="build"||guideInfo.shortcut.building!==build||guideInfo.shortcut.base!==baseId))setBuilding(null);
    const objectives=E.objectives(state);
    const count=objectives.filter(item=>item.done).length;
    $("guide-progress").textContent=`${count}/${objectives.length}`;
    $("guide-chapter-fill").style.width=`${count/objectives.length*100}%`;
    $("guide-heading-label").textContent=planBase?`План · ${E.TYPES[plan.type].name}`:"Текущая цель";
    $("guide-reset").hidden=!planBase;
    $("guide-title").textContent=guideInfo.title;
    $("guide-detail").textContent=guideInfo.detail;
    const req=guideInfo.requirement, reqBase=req&&E.byId(state,req.base);
    const r=reqBase?G.requirements(state,reqBase,req.type):null;
    const materials=$("guide-materials");
    materials.hidden=!r;
    if(r) {
      const content=bill(r,true)+(r.needsSector?`<small class="guide-bill-note">Сектор ${r.required-r.cost} + ${r.room?req.type==="greenhouse"?"теплица":"жильё":"утепление"} ${r.cost} дет.</small>`:"");
      if(materials.innerHTML!==content)materials.innerHTML=content;
    }
    $("guide-focus").hidden=!guideInfo.target;
    $("mission-guide").dataset.marker=guideInfo.target?.kind||"goal";
    $("mini-goal-key").dataset.marker=guideInfo.target?.kind||"goal";
    if(guideInfo.target) {
      const distance=E.entityDist(state.rover,guideInfo.target);
      $("guide-distance").textContent=distance<=E.REACH?"Цель рядом":`${Math.ceil(distance)} кл. · На карте`;
      $("guide-focus").title=guideInfo.target.label;
    }
    const shortcut=guideInfo.shortcut;
    const action=$("guide-action");
    action.hidden=!shortcut;
    action.textContent=shortcut ? ({build:build===shortcut.building?"Показать место":r?.needsSector&&shortcut.building==="sector"?"Выбрать сектор":"Выбрать модуль",inspect:"Открыть объект",status:"Обзор",drones:"Дроны",trial:"Назначить"})[shortcut.type] : "";
  }

  function focusTarget(target=guideInfo?.target) {
    if(target){follow=false;focus={x:target.x+.5,y:target.y+.5};}
  }

  function activateGuide() {
    if(mode!=="play")return;
    const current=guideInfo||G.current(state), step=current.shortcut;
    if(!step)return;
    if(step.base)baseId=step.base;
    switch(step.type) {
      case "build": {
        if(!plan) {
          const req=current.requirement;
          plan={type:req?.type||step.building,base:req?.base||baseId,materials:false};
        }
        if(build===step.building){focusTarget(current.target);return;}
        setBuilding(step.building); showTab("build"); return;
      }
      case "inspect": return selectObject(step.x,step.y);
      case "drones": return showTab("drones");
      case "status": return showTab("status");
      case "trial": return run({type:"trial"});
    }
  }

  function updateContext(target) {
    const card=$("interact-card");
    if(!target||build||mode!=="play"){card.hidden=true;return;}
    const point=renderer.screen(target.item.x+.5,target.item.y+.5);
    const bounds=$("map").getBoundingClientRect();
    if(point.x<0||point.y<0||point.x>bounds.width||point.y>bounds.height){card.hidden=true;return;}
    const control=$("interact-button");
    control.dataset.target=target.key;
    control.disabled=!target.available;
    $("interact-label").textContent=target.label;
    $("interact-detail").textContent=target.reason||target.detail;
    card.classList.toggle("unavailable",!target.available);
    card.hidden=false;
    const half=Math.min(126,(card.offsetWidth||220)/2+8,bounds.width/2);
    const anchorX=Math.max(half,Math.min(bounds.width-half,point.x));
    const guideWidth=$("mission-guide").offsetWidth||270;
    const overGuide=anchorX-half<guideWidth+18&&point.y<($("mission-guide").offsetHeight||132)+135;
    const below=point.y<105||overGuide;
    const offset=Math.max(22,point.scale*.58);
    card.classList.toggle("below",below);
    card.style.left=anchorX+"px";
    card.style.top=(below?Math.min(bounds.height-(card.offsetHeight||68)-62,Math.max(12,point.y+offset)):Math.max(65,point.y-offset))+"px";
  }

  function award(key,label) {
    if(state.achievements.includes(key))return;
    state.achievements.push(key);
    $("achievement-label").textContent=label;
    $("achievement").hidden=false;
    achievementUntil=performance.now()+3800;
    sound.play("achievement");
  }

  function showTab(value) {
    tab=value;
    $("panel-body").scrollTop=0;
    redrawPanel(true);
  }

  function selectObject(x,y) {
    const place=E.getPlace(state,x,y);
    selected=place ? {x,y} : null;
    if(place?.base)baseId=place.base.id;
    if(place)showTab("status");
    else redrawPanel(true);
  }

  function selectBuilding(type) {
    const base=E.byId(state,baseId)||state.bases[0];
    if(plan?.type===type&&plan.base===base.id)return clearPlan();
    const r=G.requirements(state,base,type);
    if(r.locked)return;
    plan={type,base:base.id,materials:false};
    // Arm the affordable first step (the sector before a room). If even that
    // step is unaffordable, the plan remains active without an impossible ghost.
    setBuilding(!r.missingNext?r.next:null);
    selected=null;
    showTab("build");
  }

  function setBuilding(type) {
    build=type;
    $("map").classList.toggle("building",Boolean(build));
    refreshPlacement();
  }

  function clearPlan() {
    plan=null;
    setBuilding(null);
    redrawPanel(true);
  }

  function planMaterials() {
    if(!plan)return;
    plan.materials=true;setBuilding(null);
    redrawPanel(true);
    focusTarget();
  }

  function planPlace() {
    if(!plan)return;
    plan.materials=false;
    const base=E.byId(state,plan.base);
    const r=G.requirements(state,base,plan.type);
    if(r.missingNext||r.locked){planMaterials();return;}
    baseId=base.id;
    setBuilding(r.next);
    redrawPanel(true);
    focusTarget();
  }

  function refreshPlacement() {
    const banner=$("build-hint");
    banner.hidden=!build;
    if(!build)return;
    const checked=hover?E.checkBuild(state,build,hover.x,hover.y):null;
    if(checked?.base&&checked.base.id!==baseId)checked.message="Сначала выбери это поселение в правой панели.";
    banner.classList.toggle("invalid",Boolean(checked?.message));
    banner.textContent=checked?.message || (checked ?
      `✓ ${E.TYPES[build].name} · ${checked.cost?checked.cost+" дет.":"готово на складе"} · нажми для размещения` :
      `${E.TYPES[build].name} · зелёные клетки доступны · Esc — отмена`);
  }

  function run(command) {
    const beforeCargo={...state.rover.cargo};
    const result=E.dispatch(state,command);
    flash(result.message,result.ok?"":"error");
    if (!result.ok) sound.play("denied");
    else if (command.type === "mine") sound.play(E.DEPOSITS.find(deposit=>deposit.id===command.id)?.type);
    else if (command.type === "equipment") sound.play(command.action === "occupy" ? "achievement" : command.action === "clean" ? "clean" : "activate");
    else if (command.type === "build" || command.type === "makeDrone") sound.play("build");
    else if (command.type === "unload") sound.play("unload");
    else if (["trial","site","route","auto"].includes(command.type)) sound.play("activate");
    if(result.ok) {
      const now=performance.now()/1000;
      if(command.type==="mine") {
        const deposit=E.DEPOSITS.find(item=>item.id===command.id);
        const amount=state.rover.cargo[deposit.type]-beforeCargo[deposit.type];
        renderer.effect(deposit,deposit.type,`+${amount} ${deposit.type==="ice"?"льда":"руды"}`,now);
        award(deposit.type==="ice"?"first-ice":"first-ore",deposit.type==="ice"?"Первый лёд":"Первая руда");
      } else if(command.type==="unload") {
        renderer.effect(E.location(command.id),"unload",`+${beforeCargo.ice+beforeCargo.ore} на склад`,now);
      } else if(command.type==="build") {
        renderer.effect(command,"build","Модуль готов",now);
        award("module","Первый модуль");
        if(command.building==="sector")award("dome","Первый купол");
      } else if(command.type==="makeDrone")award("drone-built","Первый дрон");
      else if(command.type==="equipment"&&["occupy","clean"].includes(command.action))
        renderer.effect(command,"build",command.action==="occupy"?"+2 поселенца":"Панель очищена",now);
    }
    if(result.ok && command.type==="build"){
      setBuilding(null);
      if(plan&&plan.type!==command.building) {
        // Keep tracking the end product after its prerequisite is deployed.
        selected={x:command.x,y:command.y};
        baseId=plan.base;tab="build";$("panel-body").scrollTop=0;
        const r=G.requirements(state,E.byId(state,plan.base),plan.type);
        if(command.building==="sector"&&!plan.materials&&!r.missingNext&&r.next===plan.type)setBuilding(plan.type);
      } else {
        plan=null;selectObject(command.x,command.y);
      }
    }
    if(result.ok && command.type==="makeDrone") droneId=result.id;
    redrawPanel(true);
    return result;
  }

  function actionNearby(expected=null) {
    if(mode!=="play")return;
    const target=G.nearby(state);
    if(expected && target?.key!==expected) {
      flash("Подъедь к выбранному объекту.", "error");
      return;
    }
    if(target?.available) {
      selectObject(target.item.x,target.item.y);
      run(target.command);
    } else if(target) {
      flash(target.reason,"error");
      sound.play("denied");
    } else {
      const full = state.rover.cargo.ice + state.rover.cargo.ore >= E.CARGO_CAP;
      flash(full ? "Грузовой отсек полон. Подъедь к складу." : "Подъедь к месторождению или обслуживаемому модулю.", "error");
      sound.play("denied");
    }
  }

  document.addEventListener("click",event=>{
    sound.unlock();
    const t=event.target.closest("button");
    if(!t || t.disabled)return;
    if(t.dataset.tab && mode==="play") return showTab(t.dataset.tab);
    const d=t.dataset;
    if(!d.action)return;
    switch(d.action) {
      case "new": return attempt.progress ? setMode("reset") : play(E.newGame(),true);
      case "start": return play(E.newGame(),true);
      case "continue": return E.validateState(attempt.progress) ? play(E.clone(attempt.progress),false) : setMode("title");
      case "pause": return setMode("pause");
      case "sound": sound.toggle(); return updateSoundButtons();
      case "speed": timeRate = timeRate === 1 ? 4 : 1;return redrawPanel(true);
      case "nearby": return actionNearby(d.target);
      case "guide-step": return activateGuide();
      case "guide-focus": {
        if(mode==="play")focusTarget();
        return;
      }
      case "resume": return setMode("play");
      case "title": return setMode("title");
      case "save-exit": save();return setMode("title");
      case "help": returnMode=mode;return setMode("help");
      case "back": return setMode(returnMode);
      case "retry": return attempt.checkpoint && play(E.clone(attempt.checkpoint),false);
      case "clear": selected=null;return redrawPanel(true);
      case "build": return selectBuilding(d.building);
      case "clear-plan": return clearPlan();
      case "find-materials": return planMaterials();
      case "plan-place": return planPlace();
      case "base": baseId=d.base;selected=null;plan=null;setBuilding(null);return redrawPanel(true);
      case "rover": follow=true;return;
      case "zoom-in": return renderer.changeZoom(1);
      case "zoom-out": return renderer.changeZoom(-1);
      case "focus": {
        const site=E.location(d.base);
        follow=false;focus={x:site.x+.5,y:site.y+.5};return;
      }
      case "drones": return showTab("drones");
      case "select-drone": droneId = droneId===at(t,"id") ? null : at(t,"id");return redrawPanel(true);
      case "trial": return run({type:"trial"});
      case "priority": return run({type:"priority",base:d.base});
      case "auto": return run({type:"auto",base:d.base});
      case "site": return run({type:"site",id:d.base});
      case "mine": return run({type:"mine",id:d.id});
      case "unload": return run({type:"unload",id:d.base});
      case "equipment": return run({type:"equipment",action:d.command,mode:d.value,x:at(t,"x"),y:at(t,"y")});
      case "make-drone": return run({type:"makeDrone",kind:d.kind,base:baseId});
      case "hold": return run({type:"holdDrone",id:at(t,"id")});
      case "recall": return run({type:"recallDrone",id:at(t,"id")});
      default:return;
    }
  });

  document.addEventListener("submit",event=>{
    if (event.target.id!=="route-form" || mode!=="play") return;
    event.preventDefault();
    const form=event.target;
    const data=Object.fromEntries(new FormData(form));
    const result=run({type:"route",id:Number(form.dataset.id),...data});
    if(result.ok){droneId=null;redrawPanel(true);}
  });

  $("panel-body").addEventListener("pointerdown",()=>{panelPressed=true;});
  window.addEventListener("pointerup",()=>{panelPressed=false;});
  window.addEventListener("pointercancel",()=>{panelPressed=false;});

  function cell(event) {
    const point=renderer.point(event.clientX,event.clientY);
    return {x:Math.floor(point.x), y:Math.floor(point.y)};
  }

  $("map").addEventListener("pointermove", event=>{
    if(mode!=="play")return;
    pointer={clientX:event.clientX,clientY:event.clientY};
    hover=cell(event);
    refreshPlacement();
  });
  $("map").addEventListener("pointerleave",()=>{pointer=hover=null;refreshPlacement();});
  $("map").addEventListener("click",event=>{
    if(mode!=="play")return;
    const {x,y}=cell(event);
    if(build) {
      const check=E.checkBuild(state,build,x,y);
      if(check.base&&check.base.id!==baseId){flash("Сначала выбери это поселение в правой панели.","error");sound.play("denied");return;}
      run({type:"build",building:build,x,y});
    }
    else selectObject(x,y);
  });
  $("map").addEventListener("wheel",event=>{
    if(mode!=="play")return;
    event.preventDefault();
    renderer.changeZoom(Math.sign(-event.deltaY));
  },{passive:false});
  $("minimap").addEventListener("click",event=>{
    if(mode!=="play")return;
    const bounds=event.currentTarget.getBoundingClientRect();
    focus={x:(event.clientX-bounds.left)/bounds.width*E.W,y:(event.clientY-bounds.top)/bounds.height*E.H};
    follow=false;
  });

  window.addEventListener("keydown",event=>{
    if (event.code==="Escape") {
      if(mode==="play" || mode==="pause" || mode==="help"){
        event.preventDefault();
        if(mode==="play" && (build||plan))clearPlan();
        else setMode(mode==="help"?returnMode:mode==="pause"?"play":"pause");
      }
      return;
    }
    if(mode!=="play" || event.target instanceof HTMLSelectElement || event.metaKey || event.ctrlKey || event.altKey)return;
    if (directions.has(event.code) || event.code==="KeyE") sound.unlock();
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") keys.add(event.code);
    if(directions.has(event.code)){
      event.preventDefault();
      keys.add(event.code);
      follow=true;
    }
    if(event.code==="KeyE" && !event.repeat) {
      event.preventDefault();
      actionNearby();
    }
  });
  window.addEventListener("keyup",event=>keys.delete(event.code));
  window.addEventListener("blur",()=>{keys.clear();state.rover.vx=state.rover.vy=0;panelPressed=false;});
  window.addEventListener("focus",()=>wakeFrame());
  document.addEventListener("visibilitychange",()=>{
    if(document.hidden && mode==="play")setMode("pause");
    lastFrame=0;
    if(!document.hidden)wakeFrame();
  });
  const onResize=()=>{renderer.size();wakeFrame();};
  window.addEventListener("resize",onResize);
  if(typeof ResizeObserver==="function")new ResizeObserver(onResize).observe($("world"));

  function storyEvents(events) {
    if(events.includes("harvest"))award("harvest","Первый урожай");
    if(events.includes("delivery"))award("delivery","Первый грузовой рейс");
    if(state.bases.length>1)award("outpost","Второй склад развёрнут");
    if(events.includes("landing"))award("crew","Экипаж прибыл");
    if(events.includes("chapter")&&state.chapter===3)award("city","Город под куполами");
    if(events.includes("chapter")&&state.chapter===4)award("both","Две обитаемые колонии");
    if(events.includes("victory"))award("victory","Марсианская экспедиция завершена");
    if(events.includes("checkpoint"))save({checkpoint:true});
    if(events.includes("chapter"))save();
    if(events.includes("landing"))setMode("landing");
    if(events.includes("defeat"))setMode("defeat");
    if(events.includes("victory")){save();setMode("victory");}
    const cue = ["victory","defeat","setback","forecast","storm","clear","chapter","delivery","survey","harvest","refine"]
      .find(event=>events.includes(event));
    sound.play(cue === "chapter" ? "achievement" : cue);
  }

  function frame(time) {
    inFrame=true;
    try {
    if (!lastFrame) lastFrame=time;
    const delta=Math.max(0,Math.min(.17,(time-lastFrame)/1000));
    lastFrame=time;
    let speed = 0;
    if(mode==="play") {
      if (state.trial?.phase === "warning" || state.trial?.phase === "testing") timeRate = 1;
      const movement = {
        x: Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft")),
        y: Number(keys.has("KeyS") || keys.has("ArrowDown")) - Number(keys.has("KeyW") || keys.has("ArrowUp")),
        slow: keys.has("ShiftLeft") || keys.has("ShiftRight")
      };
      speed = E.driveRover(state.rover,movement,delta);
      remainder+=delta*(movement.x || movement.y || speed > 0.035 ? 1 : timeRate);
      while(remainder>=E.STEP) {
        remainder-=E.STEP;
        const events=E.tick(state,E.STEP);
        if(events.length)storyEvents(events);
        if(mode!=="play")break;
      }
    }
    const isTitle=mode==="title"||mode==="reset"||mode==="help"&&returnMode==="title";
    const uiDue = time-lastUI > 210 || firstFrame;
    const renderedState=isTitle?preview:state;
    const conditions=E.weather(renderedState);
    sound.mix(mode==="play",speed/E.DRIVE_SPEED,conditions);
    const target=mode==="play"&&!build?G.nearby(state):null;
    const placement=mode==="play"&&build?G.placementCells(state,E.byId(state,baseId),build):[];
    hover=renderer.draw(renderedState,{title:isTitle,follow,focus,selected,pointer,build,conditions,target,goal:mode==="play"?guideInfo?.target:null,placement,
      selectedBase:baseId,t:time/1000,delta,moving:speed>0.07,reduced,minimap:uiDue});
    updateContext(target);
    if(uiDue && mode==="play") {
      redrawPanel();
      refreshPlacement();
      lastUI=time;
    }
    if(time>toastUntil && !$("toast").hidden) $("toast").hidden=true;
    if(time>achievementUntil && !$("achievement").hidden) $("achievement").hidden=true;
    firstFrame=false;
    } finally { inFrame=false; }
    scheduleFrame();
  }

  // Draw one frame even if an embedded browser briefly stops delivering animation
  // callbacks. The same token ensures that the fallback never advances time twice.
  let pendingFrame=null, inFrame=false;
  function wakeFrame() {
    if(inFrame||document.hidden)return;
    if(pendingFrame) {
      const previous=pendingFrame;
      pendingFrame=null;
      if(previous.timer!==null)clearTimeout(previous.timer);
      if(previous.raf!==null&&typeof cancelAnimationFrame==="function")cancelAnimationFrame(previous.raf);
    }
    // The immediate repaint must not count a second simulation delta.
    lastFrame=0;
    frame(performance.now());
  }
  function scheduleFrame() {
    const token={raf:null,timer:null};
    pendingFrame=token;
    const next=time=>{
      if(pendingFrame!==token)return;
      pendingFrame=null;
      if(token.timer!==null)clearTimeout(token.timer);
      if(token.raf!==null&&typeof cancelAnimationFrame==="function")cancelAnimationFrame(token.raf);
      frame(time);
    };
    token.raf=requestAnimationFrame(next);
    if(typeof setTimeout==="function"&&!document.hidden)token.timer=setTimeout(()=>next(performance.now()),140);
  }

  $("quick").innerHTML = TYPES.map((type,i)=>
    `<button data-action="build" data-building="${type}" aria-label="${E.TYPES[type].name}" aria-pressed="false">
      <canvas width="40" height="36" data-icon="${type}" aria-hidden="true"></canvas><span>${SHORT[i]}</span></button>`).join("");
  iconify($("quick"));
  setMode("title");
  frame(performance.now());
}());
