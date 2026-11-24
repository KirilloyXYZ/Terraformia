(function () {
  "use strict";
  const E = globalThis.TerraformiaEngine;
  const TAU = Math.PI * 2;
  const MODEL_COLORS = {
    solar:"#597c91", battery:"#9dd4c0", refinery:"#e6a077", sector:"#c4c7a9",
    greenhouse:"#a0d7a1", habitat:"#edc89b", insulation:"#e3a989"
  };
  const TERRAIN_SCALE=34;
  const LANDMARKS=[
    {x:2.2,y:14.8,label:"Старый зонд",angle:.42},
    {x:24.1,y:7.2,label:"Станция наблюдения",angle:-.73}
  ];

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function randomSource(seed) {
    let value = seed >>> 0;
    return () => {
      value = (Math.imul(value,1664525) + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }

  function field(columns, rows, random) {
    const values = Float32Array.from({length:(columns+1)*(rows+1)},random);
    return (x,y) => {
      const gx = clamp(x / E.W * columns,0,columns-1e-6);
      const gy = clamp(y / E.H * rows,0,rows-1e-6);
      const tx = Math.floor(gx);
      const ty = Math.floor(gy);
      const fx = gx - tx;
      const fy = gy - ty;
      const sx = fx*fx*(3-2*fx);
      const sy = fy*fy*(3-2*fy);
      const idx = ty*(columns+1)+tx;
      const top = values[idx]*(1-sx)+values[idx+1]*sx;
      const bottom = values[idx+columns+1]*(1-sx)+values[idx+columns+2]*sx;
      return (1-sy)*top + sy*bottom;
    };
  }

  function ground() {
    const canvas = document.createElement("canvas");
    const width = E.W * TERRAIN_SCALE;
    const height = E.H * TERRAIN_SCALE;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha:false });
    const rnd = randomSource(187407);
    const broad = field(10,7,rnd), medium = field(34,24,rnd), fine = field(125,83,rnd);
    const craters = [[4.0,5.5,2.4],[19.7,5.6,2.5],[24.6,13.2,3.2],[17.3,25.8,2.7],
      [43.0,18.7,2.4],[8.2,26.7,2.0],[45.4,3.9,2.2],[28.8,27.9,2.1],[0.9,17.8,2.0],[31.1,11.8,1.2],
      [5.1,17.3,1.55],[18.4,14.1,1.65],[39.0,26.0,1.1]];
    const relief = new Float32Array(width*height);
    const mineral = new Float32Array(width*height);
    const zones = new Float32Array(width*height);
    for (let row = 0; row < height; row++) {
      const y = row / TERRAIN_SCALE;
      for (let col=0; col<width; col++) {
        const x = col / TERRAIN_SCALE;
        const n = broad(x,y);
        const m = medium(x,y);
        const g = fine(x,y);
        const delta = x*.54-y+1.1*Math.sin(y*.65)+n*3.5;
        const ridge = Math.exp(-delta*delta*.26);
        const sediment = Math.sin(.9*x+2.2*y+n*10)*.026 + Math.sin(.36*x+1.5*y+n*8)*.07;
        const ravine = x-(24.7+1.8*Math.sin(y*.36)+.9*Math.sin(y*.83));
        const gorge = Math.exp(-ravine*ravine*1.0)*Math.exp(-(((y-13.5)/11)**2));
        let altitude = n*.58+m*.27+g*.105+sediment+ridge*.43-gorge*.28;
        let tone = m*.48+g*.27+n*.25;
        for (const [cx,cy,r] of craters) {
          const d2 = (x-cx)*(x-cx) + ((y-cy)*1.07)*((y-cy)*1.07);
          if (d2 > 1.8*r*r) continue;
          const d = Math.sqrt(d2)/r;
          const rim = (d-.91)*11.5;
          altitude += Math.exp(-rim*rim)*(.22+.065*m) - Math.max(0,1-d)*.36;
          tone -= Math.max(0,1-d)*.18;
        }
        const basin = Math.pow(Math.exp(-(((x-35.5)/10)**2+((y-23)/5.5)**2)),.78);
        const plateau = Math.exp(-(((x-38)/9.0)**2+((y-7.4)/5.5)**2));
        const shelves = Math.sin(altitude*31+m*3)*.018*plateau;
        const frostCracks=basin*Math.abs(Math.sin((x+n*1.9)*2.9+(y+m*1.6)*1.8));
        const i = row*width+col;
        zones[i] = basin - .9*plateau;
        relief[i] = altitude + plateau*.43-basin*.22+shelves;
        mineral[i] = tone + (frostCracks>.94?.17:0);
      }
    }
    const pix = ctx.createImageData(width,height);
    for (let y=0; y<height; y++) {
      for (let x=0; x<width; x++) {
        const i = y*width+x;
        const h = relief[i];
        const left = relief[x ? i-1 : i];
        const above = relief[y ? i-width : i];
        const hill = clamp((h-left)*590+(h-above)*830,-55,53);
        const grain = (rnd() - .5)*18;
        const stratum = mineral[i];
        const frost = Math.max(0,zones[i]);
        const raised = Math.max(0,-zones[i]);
        const sun = (x/width)*7 + (1-y/height)*9;
        const shade = 92*h + 24*stratum + hill + grain + sun;
        const p = i*4;
        pix.data[p] = 96+shade+27*raised-40*frost;
        pix.data[p+1] = 48+.79*shade+26*raised+26*frost;
        pix.data[p+2] = 35+.53*shade+12*raised+51*frost;
        pix.data[p+3] = 255;
      }
    }
    ctx.putImageData(pix,0,0);
    ctx.save();
    ctx.scale(TERRAIN_SCALE,TERRAIN_SCALE);
    // Weathered streaks in dunes and rock shelves, all baked into the static map.
    for(let i=0;i<470;i++) {
      const x=rnd()*E.W,y=rnd()*E.H;
      if(medium(x,y)<.43)continue;
      const length=.27+rnd()*1.1, slant=.16+.35*Math.sin(y*.63+x*.19);
      ctx.strokeStyle=rnd()>.53?"#f5c38d2c":"#593e382e";
      ctx.lineWidth=.014+rnd()*.028;ctx.beginPath();ctx.moveTo(x,y);
      ctx.quadraticCurveTo(x+length*.55,y+slant*.35,x+length,y+slant);ctx.stroke();
    }
    const buildArea=(x,y)=>Object.values(E.SITES).some(s=>x>=s.bounds[0]&&x<=s.bounds[2]+1&&y>=s.bounds[1]&&y<=s.bounds[3]+1);
    for (let i=0;i<3100;i++) {
      const x = rnd()*E.W, y = rnd()*E.H;
      if (rnd() > (broad(x,y)*.72+.12)) continue;
      const radius = .012 + rnd()**4*(buildArea(x,y)?.19:.44);
      const cold=x>28&&y>19;
      boulder(ctx,x,y,radius,cold,rnd());
    }
    // Exposed ice veins and shallow fractures give the lowland a distinct surface.
    for(let i=0;i<54;i++) {
      const x=27+rnd()*19,y=17+rnd()*12;
      if(broad(x,y)<.42)continue;
      ctx.strokeStyle="#c7dde068";ctx.lineWidth=.024;ctx.beginPath();ctx.moveTo(x,y);
      let px=x,py=y;
      for(let j=0;j<4;j++){px+=(rnd()-.27)*.47;py+=(rnd()-.4)*.43;ctx.lineTo(px,py);}
      ctx.stroke();
    }
    ctx.restore();
    return canvas;
  }

  function boulder(ctx,x,y,r,cold,variant) {
    ellipse(ctx,x+r*.51,y+r*.65,r*1.5,r*.64,"#33282b65");
    const a=[x-r,y], b=[x-r*.33,y-r*.69], c=[x+r*.68,y-r*.52], d=[x+r,y+r*.22], e=[x+r*.22,y+r*.63];
    ctx.fillStyle=cold?"#647477":"#725044";
    polygon(ctx,[a,b,c,d,e,[x-r*.73,y+r*.43]]);
    ctx.fillStyle=cold?"#9cacae":variant>.45?"#dda780":"#bd8c67";
    polygon(ctx,[a,b,c,[x+r*.24,y+r*.09]]);
    ctx.fillStyle=cold?"#788c90":"#93705b";
    polygon(ctx,[c,d,e,[x+r*.24,y+r*.09]]);
    ctx.strokeStyle=cold?"#c9d9d897":"#edb58b88";
    ctx.lineWidth=Math.max(.01,r*.065);ctx.beginPath();ctx.moveTo(...b);ctx.lineTo(...c);ctx.stroke();
  }

  function ellipse(ctx,x,y,rx,ry,fill,line=null,lw=.025) {
    ctx.beginPath();
    ctx.ellipse(x,y,rx,ry,0,0,TAU);
    if (fill) { ctx.fillStyle=fill; ctx.fill(); }
    if (line) { ctx.strokeStyle=line; ctx.lineWidth=lw; ctx.stroke(); }
  }

  function polygon(ctx, coords, line=null, width=.02) {
    ctx.beginPath();
    coords.forEach(([x,y],i)=> i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
    ctx.closePath();
    ctx.fill();
    if (line) { ctx.strokeStyle=line; ctx.lineWidth=width; ctx.stroke(); }
  }

  function rect(ctx,x,y,w,h,fill,line=null,lw=.023) {
    ctx.fillStyle=fill;
    ctx.fillRect(x,y,w,h);
    if (line) { ctx.strokeStyle=line; ctx.lineWidth=lw; ctx.strokeRect(x,y,w,h); }
  }

  function shadow(ctx,r=.43) {
    ellipse(ctx,.10,.18,r,r*.56,"#1a121805");
    ellipse(ctx,.09,.14,r*.96,r*.52,"#221a1f50");
    ellipse(ctx,.03,.10,r*.77,r*.41,"#1c191d56");
  }

  function glow(ctx,x,y,r,color) {
    const g=ctx.createRadialGradient(x,y,0,x,y,r);
    g.addColorStop(0,color);
    g.addColorStop(1,color.slice(0,7)+"00");
    ellipse(ctx,x,y,r,r,g);
  }

  function moduleModel(ctx, type, item={}, phase=0) {
    shadow(ctx,type==="sector"?.60:.40);
    if (type === "solar") {
      rect(ctx,-.25,.09,.54,.13,"#4f514c");
      rect(ctx,-.06,-.13,.11,.34,"#736455");
      ctx.fillStyle = "#9bafa3";
      polygon(ctx,[[-.38,-.29],[.35,-.29],[.43,.18],[-.30,.18]],"#52444b",.027);
      ctx.fillStyle = item.dirty ? "#514951" : "#23394c";
      polygon(ctx,[[-.35,-.25],[.32,-.25],[.39,.14],[-.28,.14]]);
      for (let y=0; y<2; y++) {
        for (let x=0; x<4; x++) {
          const left = -.323+x*.163 + y*.031;
          const top = -.226+y*.175;
          const tone = ctx.createLinearGradient(left,top,left+.16,top+.15);
          tone.addColorStop(0,item.dirty?"#7f6662":"#587796");
          tone.addColorStop(1,item.dirty?"#524551":"#2c4967");
          ctx.fillStyle=tone;
          polygon(ctx,[[left,top],[left+.144,top],[left+.168,top+.145],[left+.026,top+.145]]);
        }
      }
      ctx.fillStyle=item.dirty?"#493a373d":"#eaf7f42f";
      polygon(ctx,[[-.35,-.25],[-.21,-.25],[.09,.14],[-.08,.14]]);
      if (item.dirty) ellipse(ctx,-.02,-.05,.25,.08,"#a5765c55");
      rect(ctx,-.023,.17,.10,.05,"#c9cabb");
      return;
    }
    if (type === "battery" || type === "refinery") {
      const battery = type === "battery";
      const blank = battery ? "#728c7e" : "#ac805e";
      rect(ctx,-.31,-.10,.63,.41,"#4e4845","#3f3b3b");
      ctx.fillStyle="#695b55";
      polygon(ctx,[[-.31,-.32],[.27,-.32],[.39,-.19],[.39,.22],[.27,.30],[-.32,.30]],"#3c383c");
      rect(ctx,-.31,-.29,.59,.44,blank,"#c7b4a284");
      rect(ctx,-.26,-.22,.49,.31,battery?"#394c49":"#504d48");
      if (battery) {
        for(let i=0;i<3;i++){
          rect(ctx,-.22+i*.15,-.17,.12,.20,"#6f8884","#b0c3ad44");
          const ratio=clamp((item.chargeRatio??1)*3-i,0,1);
          if(ratio>0)rect(ctx,-.205+i*.15,.015-.17*ratio,.09,.17*ratio,"#a0ddb2");
          rect(ctx,-.21+i*.15,-.16,.10,.035,"#bdd3c0");
        }
        rect(ctx,-.19,.188,.40,.044,"#9ee7b7");
      } else {
        ellipse(ctx,-.12,-.065,.115,.115,"#747a72","#b1aa93");
        ellipse(ctx,-.12,-.065,.061,.061,item.powered?"#ccbc6b":"#474b46");
        ctx.strokeStyle="#d8d5bb";
        ctx.lineWidth=.018;
        for(let blade=0;blade<5;blade++){
          const spin=(item.powered?phase*8:0)+blade*TAU/5;
          ctx.beginPath();ctx.moveTo(-.12+.03*Math.cos(spin),-.065+.03*Math.sin(spin));
          ctx.lineTo(-.12+.089*Math.cos(spin+.36),-.065+.089*Math.sin(spin+.36));ctx.stroke();
        }
        rect(ctx,.035,-.173,.144,.218,"#ac9a7b");
        for (let i=0;i<4;i++) rect(ctx,.065,-.156+i*.048,.087,.015,"#66574c");
        rect(ctx,-.18,.182,.37,.046,item.powered?"#b0ebce":"#dd9a75");
        if(item.input&&item.powered) {
          rect(ctx,-.24,.264,.48,.043,"#574b40");
          rect(ctx,-.24,.264,.48*clamp(item.progress/5,0,1),.043,"#cce9b9");
        }
      }
      return;
    }
    if (type === "sector") {
      ctx.fillStyle="#77695b";
      polygon(ctx,[[-.38,-.36],[.39,-.36],[.48,-.21],[.48,.22],[.33,.35],[-.31,.35],[-.47,.20],[-.47,-.20]],"#463d41",.026);
      ellipse(ctx,0,-.046,.444,.321,"#3c544d",item.insulated?"#e8ac7b":"#9cafa0",.037);
      if (item.room?.type === "greenhouse") {
        const maturity=item.room.input?clamp(item.room.progress/30,0,1):item.room.powered?.55:.32;
        for(let i=0;i<5;i++) {
          rect(ctx,-.305+i*.123,-.166,.086,.205,"#736955");
          for(let j=0;j<4;j++) {
            const x=-.270+i*.123,y=-.139+j*.05;
            ellipse(ctx,x,y,.019+.018*maturity,.012+.015*maturity,item.room.powered?"#92bf69":"#6f9369");
            ellipse(ctx,x+.009,y-.006,.011+.008*maturity,.008+.004*maturity,item.room.powered?"#c1de87":"#9ab08b");
          }
        }
      } else if (item.room?.type === "habitat") {
        rect(ctx,-.23,-.164,.46,.226,"#b09b7d");
        rect(ctx,-.14,-.149,.125,.183,"#d7d2ae");
        rect(ctx,.036,-.149,.122,.18,"#7e9b98");
        if (item.room.occupied) glow(ctx,.025,-.02,.48,item.room.powered?"#ffd08a83":"#fa93765c");
      } else {
        rect(ctx,-.20,-.175,.40,.235,"#81938a");
        rect(ctx,-.16,-.13,.32,.08,"#b1b8a1");
      }
      const roof=ctx.createLinearGradient(-.3,-.38,.24,.24);
      roof.addColorStop(0,"#f2fce6a0");
      roof.addColorStop(.40,"#9ec7bb21");
      roof.addColorStop(.75,"#aacbc040");
      roof.addColorStop(1,"#527d76a0");
      ellipse(ctx,0,-.075,.417,.295,roof,"#d3e6c8c4",.025);
      ctx.strokeStyle="#ecf4e9b5";ctx.lineWidth=.014;
      ctx.beginPath();ctx.ellipse(-.04,-.099,.35,.244,0,Math.PI*1.09,Math.PI*1.79);ctx.stroke();
      ctx.strokeStyle="#c1d8c68c";
      ctx.lineWidth=.011;
      ctx.beginPath();
      ctx.ellipse(0,-.064,.22,.282,0,0,TAU);
      ctx.moveTo(-.367,-.08);
      ctx.quadraticCurveTo(0,.015,.381,-.08);
      ctx.stroke();
      rect(ctx,-.075,.232,.149,.14,"#c7b39a","#575750");
      if(item.room?.powered) ellipse(ctx,.098,.215,.036,.027,"#aff0be");
      return;
    }
    if (type === "depot") {
      ctx.fillStyle="#64645c";
      polygon(ctx,[[-.48,-.40],[.32,-.40],[.49,-.22],[.49,.30],[.31,.39],[-.44,.39],[-.53,.25],[-.53,-.25]],"#bab09a",.029);
      rect(ctx,-.40,-.35,.74,.48,"#d9c5aa","#333638",.036);
      rect(ctx,-.37,-.30,.68,.36,"#b9bda6","#f1d6b6a5");
      for(let i=0;i<6;i++) rect(ctx,-.33+i*.104,-.283,.025,.313,"#899b93");
      rect(ctx,-.23,.112,.42,.24,"#657069");
      for(let i=0;i<5;i++) rect(ctx,-.20+i*.075,.148,.036,.18,"#a39983");
      ellipse(ctx,.38,-.27,.046,.028,"#f9d77c");
    }
  }

  function rocks(ctx, deposit, available) {
    const colors = deposit.type === "ice" ? ["#465e69","#90c2c0","#cbe4d4","#527c84"] : ["#534643","#b37a64","#e3ad7d","#7c594b"];
    const random = randomSource(deposit.x*3915+deposit.y*1081);
    ctx.globalAlpha = available ? 1 : .63;
    for(let i=0;i<10;i++){
      const cx=(random()-.5)*.80, cy=(random()-.5)*.72;
      const s=.08+random()*.11;
      ellipse(ctx,cx+.05,cy+.065,s*1.2,s*.55,"#291d294f");
      ctx.fillStyle=colors[0];
      polygon(ctx,[[cx-s,cy+.05],[cx-s*.45,cy-s*.8],[cx+s*.32,cy-s],[cx+s,cy-s*.04],[cx+s*.54,cy+s*.72],[cx-s*.55,cy+s*.66]]);
      ctx.fillStyle=colors[1];
      polygon(ctx,[[cx-s,cy+.05],[cx-s*.45,cy-s*.8],[cx+s*.32,cy-s],[cx+s*.34,cy-s*.12]]);
      ctx.fillStyle=colors[2];
      polygon(ctx,[[cx-s*.43,cy-s*.78],[cx+s*.32,cy-s],[cx+s*.89,cy-s*.16],[cx+s*.29,cy-s*.18]]);
      ctx.fillStyle=colors[3];
      polygon(ctx,[[cx+s*.34,cy-s*.12],[cx+s*.95,cy-s*.08],[cx+s*.54,cy+s*.68],[cx-s*.53,cy+s*.67]]);
    }
    ctx.globalAlpha=1;
  }

  function roverModel(ctx, night, moving, carry, phase) {
    shadow(ctx,.49);
    if (night) {
      const cone = ctx.createLinearGradient(.32,0,1.75,0);
      cone.addColorStop(0,"#ffe2a673");
      cone.addColorStop(1,"#ffdf9610");
      ctx.fillStyle=cone;
      polygon(ctx,[[.28,-.22],[1.7,-.54],[1.7,.51],[.28,.16]]);
    }
    for(const side of [-1,1]) {
      const y = side*.236;
      for(let x=-.34; x<.35; x+=.31) {
        rect(ctx,x-.06,y-.06,.17,.12,"#242629","#625353",.019);
        rect(ctx,x-.035,y-.046,.118,.034,"#53565c");
        const tread = moving ? Math.sin(phase*22)*.035 : 0;
        rect(ctx,x+.017+tread,y-.055,.034,.106,"#777275");
      }
    }
    const hull=ctx.createLinearGradient(-.25,-.21,.16,.21);
    hull.addColorStop(0,"#f0ebd1");hull.addColorStop(.49,"#bfc8bd");hull.addColorStop(1,"#788882");
    ctx.fillStyle=hull;
    polygon(ctx,[[-.39,-.16],[.30,-.16],[.43,-.083],[.43,.10],[.26,.164],[-.39,.164]],"#3c3c3c",.028);
    rect(ctx,-.37,-.127,.33,.254,"#858c87");
    rect(ctx,-.34,-.102,.267,.207,carry?"#ad825a":"#4c5b5b");
    for(let i=0;i<3;i++) rect(ctx,-.30+i*.061,-.079,.032,.155,carry?"#d4a67e":"#778584");
    if(carry){
      for(let i=0;i<Math.min(4,Math.ceil(carry/2));i++){
        rect(ctx,-.316+(i%2)*.112,-.08+Math.floor(i/2)*.09,.09,.069,"#e4bd80","#795f51",.009);
        rect(ctx,-.30+(i%2)*.112,-.063+Math.floor(i/2)*.09,.06,.011,"#725849");
      }
    }
    rect(ctx,.002,-.12,.24,.24,"#e9d0a4");
    rect(ctx,.119,-.083,.156,.168,"#53686a","#f4dfb5");
    ellipse(ctx,.024,.0,.05,.046,"#f8b78b","#88766e");
    ellipse(ctx,.393,-.064,.039,.034,"#fce7b0");
    ellipse(ctx,.393,.067,.039,.034,"#fce7b0");
    rect(ctx,.04,-.14,.20,.017,"#faf0d6");
    rect(ctx,-.052,.126,.34,.022,"#dd9a63");
    ctx.fillStyle="#43504d";ctx.font="750 .083px ui-monospace, monospace";ctx.textAlign="center";ctx.textBaseline="middle";
    ctx.fillText("01",.092,.026);
  }

  function droneModel(ctx, carrying, phase=0, flying=true) {
    ellipse(ctx,.065,.17,.31,.125,"#2b202949");
    for(const x of [-.19,.19]) for(const y of [-.15,.15]) {
      ctx.strokeStyle="#bacfc7aa"; ctx.lineWidth=.023;
      ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(x,y);ctx.stroke();
      ellipse(ctx,x,y,.096,.077,"#2d43439b","#d2ece4a4",.014);
      ctx.strokeStyle="#c8dcd5af";ctx.lineWidth=.016;ctx.beginPath();
      const spin=flying?phase*15+x*6:0;
      ctx.moveTo(x-.072*Math.cos(spin),y-.059*Math.sin(spin));ctx.lineTo(x+.072*Math.cos(spin),y+.059*Math.sin(spin));ctx.stroke();
    }
    ellipse(ctx,0,0,.142,.10,carrying?"#e7b182":"#bcd3c7","#38494b");
    ellipse(ctx,.018,-.013,.032,.023,"#7af0c3");
  }

  function padModel(ctx, landed) {
    ellipse(ctx,0,0,.54,.47,"#928272","#b4ae90",.025);
    ellipse(ctx,0,-.01,.44,.375,null,"#d2bf9f",.018);
    ctx.strokeStyle="#d7bc94";
    ctx.lineWidth=.036;
    ctx.beginPath();ctx.moveTo(-.143,-.17);ctx.lineTo(-.143,.174);ctx.moveTo(.136,-.17);ctx.lineTo(.136,.174);
    ctx.moveTo(-.143,0);ctx.lineTo(.136,0);ctx.stroke();
    if(landed) {
      shadow(ctx,.48);
      ctx.fillStyle="#d1d5c3";
      polygon(ctx,[[-.31,.12],[-.24,-.25],[0,-.46],[.27,-.21],[.29,.15],[0,.30]],"#4b5858");
      polygon(ctx,[[-.30,.12],[-.39,.26],[-.23,.27],[-.14,.10]],"#999b90");
      polygon(ctx,[[.30,.12],[.39,.26],[.23,.27],[.14,.10]],"#999b90");
      ellipse(ctx,0,-.204,.102,.084,"#769899","#e4dec6");
      glow(ctx,0,.25,.22,"#e6bc8475");
    }
  }

  function label(ctx,text,x,y,accent="#dfe6d4", min=0) {
    ctx.font = `650 ${.160 * Math.max(1,min)}px ui-monospace, monospace`;
    ctx.textAlign="center";
    ctx.textBaseline="middle";
    const width=ctx.measureText(text).width+.17;
    ctx.fillStyle="#162224d9";
    ctx.fillRect(x-width/2,y-.109,width,.218);
    ctx.fillStyle=accent;
    ctx.fillText(text,x,y+.002);
  }

  function dashed(ctx, x, y, radius, color, tick=0) {
    ctx.strokeStyle=color;
    ctx.lineWidth=.023;
    ctx.setLineDash([.097,.072]);
    ctx.lineDashOffset=tick;
    ctx.beginPath();ctx.arc(x,y,radius,0,TAU);ctx.stroke();
    ctx.setLineDash([]);
  }

  function border(ctx,x,y,color) {
    ctx.strokeStyle=color;
    ctx.lineWidth=.027;
    const pad=.025;
    const end=.975;
    const arm=.18;
    ctx.beginPath();
    ctx.moveTo(x+pad,y+pad+arm);ctx.lineTo(x+pad,y+pad);ctx.lineTo(x+pad+arm,y+pad);
    ctx.moveTo(x+end-arm,y+pad);ctx.lineTo(x+end,y+pad);ctx.lineTo(x+end,y+pad+arm);
    ctx.moveTo(x+end,y+end-arm);ctx.lineTo(x+end,y+end);ctx.lineTo(x+end-arm,y+end);
    ctx.moveTo(x+pad+arm,y+end);ctx.lineTo(x+pad,y+end);ctx.lineTo(x+pad,y+end-arm);
    ctx.stroke();
  }

  function roads(ctx, state) {
    function path() {
      const start=E.SITES.city, pad=E.PAD;
      ctx.beginPath();
      ctx.moveTo(start.x+.5,start.y+.5);
      ctx.quadraticCurveTo(9.2,16.2,pad.x+.5,pad.y+.5);
      for(const deposit of E.DEPOSITS.filter(d=>E.accessibleDeposit(state,d))){
        const site=E.SITES[deposit.site];
        if(!E.byId(state,site.id))continue;
        ctx.moveTo(site.x+.5,site.y+.5);
        ctx.quadraticCurveTo((site.x+deposit.x)*.5+.3,site.y+(deposit.y-site.y)*.22,deposit.x+.5,deposit.y+.5);
      }
      if (state.chapter<3) return;
      ctx.moveTo(start.x+.5,start.y+.5);
      ctx.bezierCurveTo(19,16,23,18,27,16.3);
      ctx.quadraticCurveTo(30,13,E.SITES.plateau.x+.5,E.SITES.plateau.y+.5);
      ctx.moveTo(23,17.1);
      ctx.quadraticCurveTo(29.6,21.5,E.SITES.basin.x+.5,E.SITES.basin.y+.5);
    }
    ctx.lineCap="round";
    path();
    ctx.strokeStyle="#e2b78a40";
    ctx.lineWidth=.66;ctx.stroke();
    ctx.strokeStyle="#77574260";
    ctx.lineWidth=.37;ctx.stroke();
    ctx.strokeStyle="#ddb88b39";
    ctx.lineWidth=.23;ctx.stroke();
    ctx.lineCap="butt";
  }

  function foundationPaths(ctx,base,night) {
    const site=E.SITES[base.id];
    const sectors=base.buildings.filter(b=>b.type==="sector");
    const neighbors=[site,...sectors];
    for(const item of base.buildings){
      ctx.fillStyle="#cab7982e";
      ctx.fillRect(item.x+.025,item.y+.025,.95,.95);
      ctx.strokeStyle="#edd7ac25";ctx.lineWidth=.016;
      ctx.strokeRect(item.x+.05,item.y+.05,.9,.9);
      if(item.type!=="sector")continue;
      for(const next of neighbors){
        if(Math.abs(item.x-next.x)+Math.abs(item.y-next.y)!==1)continue;
        ctx.lineCap="round";ctx.beginPath();ctx.moveTo(item.x+.5,item.y+.5);ctx.lineTo(next.x+.5,next.y+.5);
        ctx.strokeStyle="#635c52";ctx.lineWidth=.24;ctx.stroke();
        ctx.strokeStyle=night?"#aabca9":"#cec5ae";ctx.lineWidth=.155;ctx.stroke();
        ctx.strokeStyle="#827c6e";ctx.lineWidth=.045;ctx.stroke();
        if(night)glow(ctx,(item.x+next.x+1)*.5,(item.y+next.y+1)*.5,.21,"#e7d5a14d");
      }
    }
    ctx.lineCap="butt";
  }

  function oldProbe(ctx,landmark) {
    ctx.save();ctx.translate(landmark.x,landmark.y);ctx.rotate(landmark.angle);
    ellipse(ctx,.13,.13,.55,.30,"#32282a59");
    rect(ctx,-.24,-.22,.48,.42,"#877665","#c0b29a",.022);
    rect(ctx,-.18,-.17,.36,.32,"#b9ad90");
    rect(ctx,-.58,-.135,.30,.25,"#586169","#aa9b81");
    rect(ctx,.28,-.135,.30,.25,"#585d63","#aa9b81");
    for(const x of [-.54,-.44,-.34,.32,.42,.52])rect(ctx,x,-.108,.065,.195,"#7c7b74","#435456",.012);
    ellipse(ctx,.09,-.06,.14,.115,"#cbc4ab","#655d52");
    ctx.beginPath();ctx.moveTo(.09,-.06);ctx.lineTo(.28,-.38);ctx.strokeStyle="#e9d2af";ctx.lineWidth=.026;ctx.stroke();
    ellipse(ctx,.29,-.385,.037,.026,"#d9c9ab");
    ctx.restore();
  }

  function createRenderer(canvas, overview) {
    const terrain=ground();
    const ctx=canvas.getContext("2d", {alpha:false});
    const mini=overview.getContext("2d",{alpha:false});
    let width=1,height=1,scale=54, x0=0,y0=0, zoom=1, dpr=1;
    let previousScene = null;
    const tracks=[], effects=[];
    let lastTrack=null;
    const view={x:11.5,y:17.25};
    const rnd = randomSource(229);
    const dust = Array.from({length:195},()=>[rnd(),rnd(),rnd(),rnd()]);

    function size() {
      const bounds=canvas.getBoundingClientRect();
      width=Math.max(1,bounds.width);
      height=Math.max(1,bounds.height);
      dpr=clamp(globalThis.devicePixelRatio || 1,1,2);
      if (canvas.width !== Math.round(width*dpr) || canvas.height !== Math.round(height*dpr)) {
        canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
      }
    }

    function point(clientX,clientY) {
      const rect=canvas.getBoundingClientRect();
      return {x:(clientX-rect.left-x0)/scale,y:(clientY-rect.top-y0)/scale};
    }

    function screen(x,y) {
      return {x:x0+x*scale,y:y0+y*scale,scale};
    }

    function effect(item,kind,message,start) {
      if(!item||!Number.isFinite(item.x)||!Number.isFinite(item.y))return;
      effects.push({x:item.x+.5,y:item.y+.5,kind,message,start});
      if(effects.length>16)effects.shift();
    }

    function drawTracks(state,moving) {
      if(moving && (!lastTrack||Math.hypot(state.rover.x-lastTrack.x,state.rover.y-lastTrack.y)>.15)) {
        lastTrack={x:state.rover.x,y:state.rover.y,angle:state.rover.angle};
        tracks.push(lastTrack);
        if(tracks.length>330)tracks.shift();
      }
      for(const [i,track] of tracks.entries()){
        const p=screen(track.x,track.y);
        if(p.x<-scale||p.x>width+scale||p.y<-scale||p.y>height+scale)continue;
        ctx.save();ctx.translate(track.x,track.y);ctx.rotate(track.angle);
        ctx.globalAlpha=.14+.28*i/tracks.length;
        rect(ctx,-.11,-.29,.17,.104,"#372b2d");
        rect(ctx,-.11,.186,.17,.104,"#372b2d");
        ctx.globalAlpha*=.65;rect(ctx,-.085,-.285,.025,.087,"#ead2b1");
        rect(ctx,-.085,.19,.025,.087,"#ead2b1");ctx.restore();
      }
    }

    function worldEffect(weather,t,quiet) {
      ctx.setTransform(dpr,0,0,dpr,0,0);
      if (weather.night) {
        const night=ctx.createLinearGradient(0,0,width*.65,height);
        night.addColorStop(0,"#263658af");night.addColorStop(1,"#111e3bb1");
        ctx.fillStyle=night;ctx.fillRect(0,0,width,height);
      } else if (weather.clock>208) {
        ctx.fillStyle=`rgba(178,94,52,${.08+.11*(weather.clock-208)/32})`;ctx.fillRect(0,0,width,height);
      }
      if(weather.storm){
        ctx.fillStyle=weather.night?"#89695572":"#d4a06b7b";
        ctx.fillRect(0,0,width,height);
        for(const [x,y,r,a] of dust){
          const sway=quiet?0:(t*(.055+.084*r));
          const drift=(x+sway)%1.06-.03;
          const px=drift*width,py=((y+sway*.18)%1.03)*height;
          ctx.strokeStyle=`rgba(255,215,166,${.07+.28*a})`;
          ctx.lineWidth=.6+r*1.65;ctx.beginPath();ctx.moveTo(px,py);
          ctx.lineTo(px+3+r*29,py+1+r*6);ctx.stroke();
        }
      }
      const radius = Math.max(width,height)*.7;
      const shade=ctx.createRadialGradient(width*.52,height*.47,Math.min(width,height)*.25,width*.54,height*.48,radius);
      shade.addColorStop(0,"#120c1900");shade.addColorStop(1,"#110e1c73");
      ctx.fillStyle=shade;ctx.fillRect(0,0,width,height);
    }

    const goalColor=goal=>({build:"#a5f0c1",ore:"#ffbe88",ice:"#a7e9ff",unload:"#ffdc92",production:"#a7e4d2"})[goal?.kind]||"#ffda9d";

    function drawMini(state,active,goal) {
      const mw=overview.width,mh=overview.height;
      mini.drawImage(terrain,0,0,mw,mh);
      mini.fillStyle="#211e2360";mini.fillRect(0,0,mw,mh);
      for(const deposit of E.DEPOSITS) {
        if(deposit.site!=="city"&&state.chapter<3)continue;
        mini.fillStyle=deposit.type==="ice"?"#badfe9":"#e7b188";
        mini.fillRect((deposit.x+.5)/E.W*mw-1.3,(deposit.y+.5)/E.H*mh-1.3,2.6,2.6);
      }
      for(const site of Object.values(E.SITES)){
        if(site.id!=="city" && state.chapter<3)continue;
        const isLive=E.byId(state,site.id);
        mini.fillStyle = isLive ? "#99e0c8" : "#e7ab88";
        mini.strokeStyle="#272a29";
        const px=(site.x+.5)/E.W*mw,py=(site.y+.5)/E.H*mh;
        mini.fillRect(px-2,py-2,4.8,4.8);mini.strokeRect(px-2,py-2,4.8,4.8);
        if(site.id===active){
          mini.strokeStyle="#b1efdd";
          mini.beginPath();mini.arc(px+.4,py+.4,6,0,TAU);mini.stroke();
        }
      }
      mini.strokeStyle="#f2dac4af";
      mini.lineWidth=1;
      mini.strokeRect(-x0/scale/E.W*mw,-y0/scale/E.H*mh,width/scale/E.W*mw,height/scale/E.H*mh);
      mini.fillStyle="#fff4d5";mini.beginPath();
      mini.arc(state.rover.x/E.W*mw,state.rover.y/E.H*mh,2.7,0,TAU);mini.fill();
      if(goal){
        const px=(goal.x+.5)/E.W*mw,py=(goal.y+.5)/E.H*mh;
        mini.fillStyle=goalColor(goal);polygon(mini,[[px,py-4.5],[px+4.5,py],[px,py+4.5],[px-4.5,py]],"#554733",1);
      }
    }

    function markerLabel(text,x,y,color) {
      if(!text)return;
      ctx.save();ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.font="700 10px ui-monospace, monospace";ctx.textAlign="center";ctx.textBaseline="middle";
      const w=ctx.measureText(text).width+14;
      x=clamp(x,w/2+8,width-w/2-8); y=clamp(y,19,height-18);
      ctx.fillStyle="#182321ee";ctx.fillRect(x-w/2,y-10,w,20);
      ctx.strokeStyle=color;ctx.lineWidth=.8;ctx.strokeRect(x-w/2,y-10,w,20);
      ctx.fillStyle=color;ctx.fillText(text,x,y+1);ctx.restore();
    }

    function goalMarker(goal,t,quiet) {
      if(!goal||width<64||height<84)return;
      const p=screen(goal.x+.5,goal.y+.5);
      const color=goalColor(goal);
      const pulse=quiet?0:.5+.5*Math.sin(t*3.1);
      const visible=p.x>20&&p.x<width-20&&p.y>48&&p.y<height-87;
      if(visible){
        ctx.save();
        if(goal.kind==="build"){
          ctx.fillStyle=color+"21";ctx.fillRect(goal.x+.04,goal.y+.04,.92,.92);
          border(ctx,goal.x,goal.y,color);
        }
        ctx.strokeStyle=color;ctx.lineWidth=.038;
        const r=.57+.08*pulse;
        ctx.beginPath();ctx.arc(goal.x+.5,goal.y+.5,r,0,TAU);ctx.stroke();
        ctx.fillStyle=color;
        const x=goal.x+.5,y=goal.y-.25-pulse*.04;
        polygon(ctx,[[x,y-.13],[x+.115,y],[x,y+.13],[x-.115,y]],"#273a31",.02);
        ctx.restore();
        const labelY=p.y>82+scale*.55?p.y-scale*.91-10:p.y+scale*.77+13;
        markerLabel(goal.tag,p.x,labelY,color);
        return;
      }
      ctx.setTransform(dpr,0,0,dpr,0,0);
      const cx=width*.5,cy=height*.50;
      const dx=p.x-cx,dy=p.y-cy;
      const angle=Math.atan2(dy,dx);
      const factor=Math.min((cx-27)/(Math.abs(dx)||1),(Math.max(28,cy-92))/(Math.abs(dy)||1));
      const x=clamp(cx+dx*factor,24,width-24),y=clamp(cy+dy*factor,49,Math.max(49,height-84));
      ctx.save();ctx.translate(x,y);ctx.rotate(angle);
      ellipse(ctx,0,0,15,15,"#232e2cdd",color,1.4);
      ctx.fillStyle=color;polygon(ctx,[[8,0],[-5,-6],[-2,0],[-5,6]]);
      ctx.restore();
      markerLabel(goal.tag,x,y>height*.52?y-27:y+27,color);
      ctx.setTransform(scale*dpr,0,0,scale*dpr,x0*dpr,y0*dpr);
    }

    function drawEffects(t,quiet) {
      for(let index=effects.length-1;index>=0;index--) {
        const entry=effects[index], age=Math.max(0,t-entry.start);
        if(age>1.45){effects.splice(index,1);continue;}
        const progress=age/1.45,p=screen(entry.x,entry.y);
        if(p.x<-50||p.y<-40||p.x>width+50||p.y>height+50)continue;
        const color=entry.kind==="ice"?"#caf4fc":entry.kind==="ore"?"#ffcca0":"#d4f0c2";
        ctx.save();ctx.setTransform(dpr,0,0,dpr,0,0);
        if(!quiet)for(let i=0;i<11;i++){
          const angle=i*2.399+entry.x, radial=(8+i%3*5)*Math.sin(Math.min(1,age*2.4)*Math.PI*.5);
          ctx.globalAlpha=Math.max(0,(1-age*1.3))*.85;
          ctx.fillStyle=color;ctx.fillRect(p.x+Math.cos(angle)*radial,p.y+Math.sin(angle)*radial-age*9,2.7,2.7);
        }
        ctx.globalAlpha=1-Math.max(0,progress-.63)/.37;
        ctx.font="750 13px ui-monospace, monospace";ctx.textAlign="center";ctx.textBaseline="middle";
        const textY=p.y-19-(quiet?0:25*progress);
        const textWidth=ctx.measureText(entry.message).width+16;
        ctx.fillStyle="#172623e6";ctx.fillRect(p.x-textWidth/2,textY-10,textWidth,20);
        ctx.fillStyle=color;ctx.fillText(entry.message,p.x,textY);
        ctx.restore();
      }
    }

    function draw(state, options) {
      const {title,follow,focus,selected,pointer,build,conditions,selectedBase,t,delta,moving,reduced,minimap,target,goal,placement=[]}=options;
      const eased = previousScene === title && !reduced ? 1 - Math.exp(-15 * delta) : 1;
      const targetScale = title ? clamp(width/12,55,116) : clamp(width/14.5,44,72)*zoom;
      scale += (targetScale - scale) * eased;
      const halfX=width/(2*scale),halfY=height/(2*scale);
      const tx= title ? 11.0-width*.195/scale : follow ? state.rover.x : focus.x;
      const ty= title ? 15.0 : follow ? state.rover.y : focus.y;
      view.x = clamp(view.x + (tx - view.x) * eased,halfX,Math.max(halfX,E.W-halfX));
      view.y = clamp(view.y + (ty - view.y) * eased,halfY,Math.max(halfY,E.H-halfY));
      previousScene = title;
      x0 = width/2 - view.x*scale;
      y0 = height/2 - view.y*scale;
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.fillStyle="#302527";ctx.fillRect(0,0,width,height);
      ctx.setTransform(scale*dpr,0,0,scale*dpr,x0*dpr,y0*dpr);
      ctx.drawImage(terrain,0,0,E.W,E.H);
      roads(ctx,state);
      for(const landmark of LANDMARKS)oldProbe(ctx,landmark);
      if(!title)drawTracks(state,moving&&!reduced);

      for (const base of state.bases) {
        const site=E.SITES[base.id];
        if (build && base.id===selectedBase) {
          const [a,b,c,d]=site.bounds;
          ctx.fillStyle="#b4ecbf13";
          ctx.fillRect(a,b,c-a+1,d-b+1);
          ctx.strokeStyle="#a6dab66b";ctx.lineWidth=.021;ctx.setLineDash([.13,.14]);
          ctx.strokeRect(a,b,c-a+1,d-b+1);ctx.setLineDash([]);
        }
        if (!title && !build) {
          const az=conditions.night ? "#95e1cd88" : "#afe9cb93";
          dashed(ctx,site.x+.5,site.y+.5,.68,az);
        }
        foundationPaths(ctx,base,conditions.night);
        const capacity=base.telemetry.capacity||base.buildings.filter(b=>b.type==="battery").length*E.CAPACITY;
        for(const item of base.buildings){
          ctx.save();ctx.translate(item.x+.5,item.y+.5);
          const model=item.type==="battery"?{...item,chargeRatio:capacity?base.charge/capacity:0}:item;
          moduleModel(ctx,item.type,model,reduced?0:t);
          ctx.restore();
        }
        ctx.save();ctx.translate(site.x+.5,site.y+.5);moduleModel(ctx,"depot");ctx.restore();
      }

      for (const deposit of E.DEPOSITS) {
        if (deposit.site!=="city" && state.chapter<3 && !title) continue;
        ctx.save();ctx.translate(deposit.x+.5,deposit.y+.5);rocks(ctx,deposit,E.accessibleDeposit(state,deposit));ctx.restore();
      }
      ctx.save();ctx.translate(E.PAD.x+.5,E.PAD.y+.5);padModel(ctx,state.crew || title);ctx.restore();

      if(state.chapter>=3) for (const site of [E.SITES.basin,E.SITES.plateau]) {
        if(E.byId(state,site.id))continue;
        const chosen=state.selectedSite===site.id;
        const explored=state.explored.includes(site.id);
        ellipse(ctx,site.x+.5,site.y+.5,.45,.45,"#152d2c63");
        dashed(ctx,site.x+.5,site.y+.5,.46,chosen?"#a7f0cd":explored?"#e6b29a":"#c9bc98bb");
        rect(ctx,site.x+.43,site.y+.43,.14,.14,chosen?"#a7f0cd":"#f2bf9c");
      }

      if(!title && state.chapter>=2) {
        for(const drone of state.drones) {
          if(!drone.route || drone.phase==="ready")continue;
          const {x,y}=E.dronePosition(drone);
          ctx.save();ctx.translate(x,y);droneModel(ctx,drone.cargo,reduced?0:t,!drone.paused&&!conditions.storm&&!reduced);ctx.restore();
        }
      }
      ctx.save();ctx.translate(state.rover.x,state.rover.y);ctx.rotate(state.rover.angle);
      const movingDust = moving && !reduced && !title;
      if (movingDust) for(let i=0;i<8;i++){
        const wave=(t*(i%2?1.8:1.1)+i*.153)%1;
        ellipse(ctx,-.42-wave*.55,Math.sin(i*8+t*3)*.165,.034+wave*.09,.02+wave*.056,`rgba(239,178,128,${.31*(1-wave)})`);
      }
      roverModel(ctx,conditions.night,movingDust,state.rover.cargo.ore+state.rover.cargo.ice,t);
      ctx.restore();

      worldEffect(conditions,t,reduced);
      ctx.setTransform(scale*dpr,0,0,scale*dpr,x0*dpr,y0*dpr);
      if(conditions.night) {
        ctx.save();ctx.globalCompositeOperation="screen";
        for(const base of state.bases){
          const depot=E.SITES[base.id];
          if(base.telemetry.heat||base.telemetry.life)glow(ctx,depot.x+.5,depot.y+.5,.64,"#ffd6a041");
          for(const item of base.buildings)if(item.room?.powered){
            glow(ctx,item.x+.5,item.y+.5,.78,item.room.type==="greenhouse"?"#b5de8b5c":"#ffd08b63");
          }
        }
        ctx.translate(state.rover.x,state.rover.y);ctx.rotate(state.rover.angle);
        const light=ctx.createLinearGradient(.36,0,2.15,0);
        light.addColorStop(0,"#e4ca8f9a");light.addColorStop(1,"#f9d99400");
        ctx.fillStyle=light;polygon(ctx,[[.35,-.18],[2.15,-.66],[2.15,.66],[.35,.18]]);
        ctx.restore();
      }
      if (title) return null;
      const cursor = pointer ? point(pointer.clientX,pointer.clientY) : null;
      const hover = cursor ? { x:Math.floor(cursor.x), y:Math.floor(cursor.y) } : null;
      if (build) {
        const startX=Math.max(0,Math.floor(-x0/scale));
        const startY=Math.max(0,Math.floor(-y0/scale));
        ctx.strokeStyle="#f6ddc345";ctx.lineWidth=.01;ctx.beginPath();
        for(let x=startX;x<=Math.min(E.W,(width-x0)/scale+1);x++){ctx.moveTo(x,startY);ctx.lineTo(x,Math.min(E.H,(height-y0)/scale));}
        for(let y=startY;y<=Math.min(E.H,(height-y0)/scale+1);y++){ctx.moveTo(startX,y);ctx.lineTo(Math.min(E.W,(width-x0)/scale),y);}
        ctx.stroke();
        for(const cell of placement){
          ctx.fillStyle="#92e8b31c";ctx.fillRect(cell.x+.035,cell.y+.035,.93,.93);
          border(ctx,cell.x,cell.y,"#b1edcf84");
        }
      }
      for(const base of state.bases) {
        const site=E.SITES[base.id];
        label(ctx,base.id==="city"?"СКЛАД ДОЛИНЫ":"СКЛАД",site.x+.5,site.y+.98,"#bce4d4",51/scale);
      }
      for(const deposit of E.DEPOSITS) {
        if(deposit.site!=="city" && state.chapter<3)continue;
        label(ctx,E.RESOURCE_NAMES[deposit.type].toUpperCase(),deposit.x+.5,deposit.y+1.02,deposit.type==="ice"?"#c1e6e0":"#f2c2a5",50/scale);
      }
      if(state.chapter>=3)for(const id of ["basin","plateau"]){
        const site=E.SITES[id];
        if(!E.byId(state,id)) label(ctx,id==="basin"?"НИЗИНА":"ПЛАТО",site.x+.5,site.y+1.17,"#eac5af",50/scale);
      }
      if(scale>41)for(const landmark of LANDMARKS) {
        if(Math.hypot(landmark.x-view.x,landmark.y-view.y)<7)
          label(ctx,landmark.label,landmark.x,landmark.y+.73,"#d2c6ae",49/scale);
      }
      goalMarker(goal,t,reduced);
      if(target&&!build) {
        const color=target.available?"#d2f8dfba":"#efb57caa";
        dashed(ctx,target.item.x+.5,target.item.y+.5,.64,color,reduced?0:t*.1);
      }
      if(selected)border(ctx,selected.x,selected.y,"#b5f0d5");
      if(hover){
        const checked=build?E.checkBuild(state,build,hover.x,hover.y):null;
        const color = build && (checked.message||checked.base?.id!==selectedBase) ? "#f3a481" : "#b1edcf";
        if(build&&hover.x>=0&&hover.x<E.W&&hover.y>=0&&hover.y<E.H){
          ctx.fillStyle=color+"3d";ctx.fillRect(hover.x,hover.y,1,1);
          ctx.save();ctx.translate(hover.x+.5,hover.y+.5);ctx.globalAlpha=.59;
          if(build==="greenhouse"||build==="habitat")moduleModel(ctx,"sector",{room:{type:build,powered:true,occupied:build==="habitat"}});
          else if(build==="insulation")moduleModel(ctx,"sector",{insulated:true});
          else moduleModel(ctx,build);
          ctx.restore();
        }
        if(build || E.getPlace(state,hover.x,hover.y))border(ctx,hover.x,hover.y,color);
      }
      dashed(ctx,state.rover.x,state.rover.y+.014,.53,"#c6eed5a4",reduced?0:t*.15);
      drawEffects(t,reduced);
      if(minimap)drawMini(state,selectedBase,goal);
      return hover;
    }

    function changeZoom(delta) {
      zoom=clamp(zoom*Math.pow(1.16,delta),.72,1.42);
    }

    function icon(canvas,type) {
      const ctx=canvas.getContext("2d");
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.save();
      ctx.translate(canvas.width/2,canvas.height/2);
      ctx.scale(canvas.width*.82,canvas.height*.90);
      if(type==="greenhouse" || type==="habitat"){
        moduleModel(ctx,"sector",{room:{type,powered:true,occupied:true}});
      } else if(type==="insulation"){
        moduleModel(ctx,"sector",{insulated:true});
      } else {
        moduleModel(ctx,type);
      }
      ctx.restore();
    }

    function settlement(canvas,state,id) {
      const base=E.byId(state,id);
      if(!base)return;
      const panel=canvas.getContext("2d",{alpha:false});
      const site=E.SITES[id], places=[site,...base.buildings];
      const xA=Math.min(...places.map(p=>p.x))-1.1,yA=Math.min(...places.map(p=>p.y))-1.1;
      const xB=Math.max(...places.map(p=>p.x))+2.1,yB=Math.max(...places.map(p=>p.y))+2.1;
      const viewScale=Math.min(canvas.width/(xB-xA),canvas.height/(yB-yA));
      const tx=canvas.width/2-viewScale*(xA+xB)/2,ty=canvas.height/2-viewScale*(yA+yB)/2;
      panel.setTransform(viewScale,0,0,viewScale,tx,ty);
      panel.fillStyle="#8b6e53";panel.fillRect(-tx/viewScale,-ty/viewScale,canvas.width/viewScale,canvas.height/viewScale);
      panel.drawImage(terrain,0,0,E.W,E.H);
      roads(panel,state);
      foundationPaths(panel,base,false);
      for(const item of [...places]) {
        panel.save();panel.translate(item.x+.5,item.y+.5);
        moduleModel(panel,item===site?"depot":item.type,item);panel.restore();
      }
      panel.setTransform(1,0,0,1,0,0);
      const shade=panel.createLinearGradient(0,0,0,canvas.height);
      shade.addColorStop(0,"#f4bd7720");shade.addColorStop(1,"#1827274a");
      panel.fillStyle=shade;panel.fillRect(0,0,canvas.width,canvas.height);
    }

    size();
    return {size,draw,point,screen,changeZoom,icon,effect,settlement,
      resetView(){previousScene=null;lastTrack=null;tracks.length=0;effects.length=0;}};
  }

  globalThis.TerraformiaRender = { createRenderer, MODEL_COLORS };
}());
