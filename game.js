/* LifeSucks — drawing and controls. The life itself is in life.js. */
(function () {
  "use strict";
  const L = window.LifeModel;
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------- state
  const params = new URLSearchParams(location.search);
  let seed = parseInt(params.get("seed"), 10);
  if (!Number.isFinite(seed) || seed <= 0) seed = 1 + Math.floor(Math.random() * 999999);
  let life = null;
  let shownLog = 0;
  let particles = [];
  let busy = false;

  const canvas = $("world");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, DPR = 1;

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  }
  window.addEventListener("resize", resize);

  // ------------------------------------------------------------- layout
  // where each kind of person lives around the root (angle from straight up, reach)
  const PLACE = {
    parent: (i) => ({ a: -1.15 + 0.26 * i, r: 0.34 }),
    partner: (i) => ({ a: -0.12 + (i % 2 ? 0.22 : -0.08) * Math.min(i, 3), r: 0.44 + 0.04 * (i % 3) }),
    child: (i) => ({ a: -0.42 + 0.28 * (i % 4), r: 0.72 + 0.08 * Math.floor(i / 4) }),
    friend: (i) => ({ a: 0.42 + 0.16 * (i % 6), r: 0.52 + 0.13 * (i % 2) + 0.06 * Math.floor(i / 6) }),
    work: (i) => ({ a: 1.22, r: 0.5 + 0.05 * i }),
    dream: (i) => ({ a: -0.72 - 0.12 * (i % 3), r: 0.8 }),
  };

  function rootPos(w, h) { return { x: w * 0.5, y: h - 46 }; }

  function nodePos(c, w, h) {
    if (!c.ui) {
      const i = life.channels.filter((x) => x.kind === c.kind && x.id < c.id).length;
      const p = PLACE[c.kind](i);
      c.ui = { a: p.a + (c.wobble - 0.5) * 0.08, r: p.r + (c.slot - 0.5) * 0.05, dD: 0 };
      if (c.kind === "child") {
        const partner = L.alive(life, "partner")[0];
        c.ui.anchor = partner ? partner.id : null;
      }
    }
    const R = rootPos(w, h);
    const x = R.x + Math.sin(c.ui.a) * c.ui.r * w * 0.62;
    const y = R.y - Math.cos(c.ui.a) * c.ui.r * (h - 90);
    return { x: Math.max(40, Math.min(w - 40, x)), y: Math.max(36, Math.min(h - 60, y)) };
  }

  function startPos(c, w, h) {
    if (c.kind === "child" && c.ui && c.ui.anchor) {
      const a = life.channels.find((x) => x.id === c.ui.anchor);
      if (a && a.alive) return nodePos(a, w, h);
    }
    return rootPos(w, h);
  }

  function curve(c, w, h) {
    const S = startPos(c, w, h), E = nodePos(c, w, h);
    const dx = E.x - S.x, dy = E.y - S.y;
    const len = Math.hypot(dx, dy);
    const wv = (c.wobble - 0.5) * 0.6;
    return {
      S, E,
      C1: { x: S.x + dx * 0.15 + len * wv * 0.5, y: S.y - len * 0.42 },
      C2: { x: E.x - dx * 0.25 - len * wv * 0.4, y: E.y + len * 0.28 },
    };
  }

  function bez(k, t) {
    const u = 1 - t;
    return {
      x: u * u * u * k.S.x + 3 * u * u * t * k.C1.x + 3 * u * t * t * k.C2.x + t * t * t * k.E.x,
      y: u * u * u * k.S.y + 3 * u * u * t * k.C1.y + 3 * u * t * t * k.C2.y + t * t * t * k.E.y,
    };
  }

  // ------------------------------------------------------------- drawing
  function mix(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }
  const rgb = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a == null ? 1 : a})`;

  function drawWorld(g, w, h, opts) {
    const warmT = Math.max(0, Math.min(1, life.warmth / 80));
    // the room: warm when you are loved, cold when you are not
    const top = mix([16, 22, 28], [26, 24, 16], warmT);
    const bot = mix([10, 13, 16], [14, 20, 14], warmT);
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, rgb(top)); bg.addColorStop(1, rgb(bot));
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const R = rootPos(w, h);
    const glow = g.createRadialGradient(R.x, R.y, 10, R.x, R.y, Math.max(w, h) * 0.7);
    glow.addColorStop(0, rgb(mix([120, 140, 160], [230, 180, 90], warmT), 0.16 + 0.12 * warmT));
    glow.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = glow; g.fillRect(0, 0, w, h);

    const vineCol = mix([128, 160, 172], [222, 196, 120], warmT);
    // dry wood first, behind everything
    for (const c of life.channels) {
      if (c.alive) continue;
      const since = life.age - c.ended;
      if (since > 28) continue;
      const k = curve(c, w, h);
      const fade = Math.max(0, 1 - since / 28);
      g.strokeStyle = c.endReason === "died" ? rgb([200, 204, 210], 0.35 * fade) :
        c.endReason === "retired" ? rgb([140, 150, 140], 0.35 * fade) : rgb([122, 92, 60], 0.75 * fade);
      g.lineWidth = 1 + 1.6 * Math.min(1.5, c.Dpeak);
      g.setLineDash(c.endReason === "died" ? [2, 5] : []);
      g.beginPath(); g.moveTo(k.S.x, k.S.y); g.bezierCurveTo(k.C1.x, k.C1.y, k.C2.x, k.C2.y, k.E.x, k.E.y); g.stroke();
      g.setLineDash([]);
      g.fillStyle = rgb(c.endReason === "died" ? [210, 214, 220] : [150, 112, 74], 0.7 * fade);
      g.font = "11px 'IBM Plex Mono', monospace";
      g.textAlign = "center";
      const label = c.kind === "work" ? "old job" : c.kind === "dream" ? c.dream : c.name;
      g.fillText(label + (c.endReason === "died" ? " †" : ""), k.E.x, k.E.y - 10);
    }
    // living channels
    for (const c of life.channels) {
      if (!c.alive) continue;
      c.ui = c.ui || null;
      const k = curve(c, w, h);
      const D = opts && opts.still ? c.D : (c.ui.dD += (c.D - c.ui.dD) * 0.08, c.ui.dD);
      const thin = D < 0.3;
      g.strokeStyle = c.kind === "work" ? rgb([170, 190, 200], 0.85) : thin ? rgb([185, 140, 96], 0.85) : rgb(vineCol, 0.92);
      g.lineWidth = 1.2 + 7.5 * D / (D + 0.7);
      g.lineCap = "round";
      g.beginPath(); g.moveTo(k.S.x, k.S.y); g.bezierCurveTo(k.C1.x, k.C1.y, k.C2.x, k.C2.y, k.E.x, k.E.y); g.stroke();
      // leaves along strong vines
      if (!thin && c.kind !== "work") {
        g.fillStyle = rgb(mix([90, 130, 110], [130, 170, 100], warmT), 0.55);
        const n = Math.floor(2 + 5 * D);
        for (let i = 1; i < n; i++) {
          const t = i / n, p = bez(k, t), side = i % 2 ? 1 : -1;
          g.beginPath(); g.ellipse(p.x + side * (4 + 3 * D), p.y, 2 + 2.5 * D, 1.2 + 1.2 * D, side * 0.6, 0, Math.PI * 2); g.fill();
        }
      }
      // the node itself
      const r = 4 + 5 * D / (D + 0.6);
      if (c.kind === "work") {
        const lamp = g.createRadialGradient(k.E.x, k.E.y, 2, k.E.x, k.E.y, 40);
        lamp.addColorStop(0, "rgba(200,225,235,0.5)"); lamp.addColorStop(1, "rgba(200,225,235,0)");
        g.fillStyle = lamp; g.beginPath(); g.arc(k.E.x, k.E.y, 40, 0, Math.PI * 2); g.fill();
        g.fillStyle = "rgba(210,228,236,0.95)"; g.fillRect(k.E.x - 6, k.E.y - 6, 12, 12);
      } else {
        g.fillStyle = thin ? rgb([200, 150, 100]) : c.kind === "dream" ? rgb([160, 200, 240]) : rgb(mix([190, 210, 200], [245, 214, 140], warmT));
        g.beginPath(); g.arc(k.E.x, k.E.y, r, 0, Math.PI * 2); g.fill();
      }
      if (c.kind === "child") {
        for (const gk of c.grandkids) {
          const ang = -1.2 + gk.slot * 2.4;
          const bx = k.E.x + Math.sin(ang) * 22, by = k.E.y - Math.cos(ang) * 22;
          g.strokeStyle = rgb(vineCol, 0.6); g.lineWidth = 1;
          g.beginPath(); g.moveTo(k.E.x, k.E.y); g.lineTo(bx, by); g.stroke();
          g.fillStyle = rgb([245, 214, 140], 0.9); g.beginPath(); g.arc(bx, by, 3, 0, Math.PI * 2); g.fill();
        }
      }
      g.fillStyle = thin ? "rgba(214,170,128,0.95)" : "rgba(231,227,214,0.92)";
      g.font = "11px 'IBM Plex Mono', monospace";
      g.textAlign = "center";
      const label = c.kind === "work" ? "work" : c.kind === "dream" ? c.dream : c.name;
      g.fillText(label, k.E.x, k.E.y - r - 7);
    }
    // particles: attention going out, warmth coming home
    if (!(opts && opts.still)) {
      for (const p of particles) {
        const c = life.channels.find((x) => x.id === p.id);
        if (!c || !c.alive) { p.dead = true; continue; }
        const k = curve(c, w, h);
        const q = bez(k, p.out ? p.t : 1 - p.t);
        g.fillStyle = p.out ? "rgba(170,230,190,0.85)" : p.money ? "rgba(200,225,235,0.8)" : "rgba(255,206,120,0.95)";
        g.beginPath(); g.arc(q.x, q.y, p.out ? 1.6 : 2.2, 0, Math.PI * 2); g.fill();
      }
    }
    // you
    const hr = 9 + 5 * (life.health / 100);
    const yg = g.createRadialGradient(R.x, R.y, 2, R.x, R.y, hr * 3);
    yg.addColorStop(0, rgb(mix([170, 190, 200], [255, 220, 150], warmT), 0.9)); yg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = yg; g.beginPath(); g.arc(R.x, R.y, hr * 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = life.alive ? rgb(mix([200, 210, 215], [255, 232, 180], warmT)) : "rgba(150,150,150,0.9)";
    g.beginPath(); g.arc(R.x, R.y, hr, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(231,227,214,0.8)"; g.font = "11px 'IBM Plex Mono', monospace"; g.textAlign = "center";
    g.fillText(life.alive ? "you" : "you †", R.x, R.y + hr + 16);
  }

  function spawnParticles() {
    if (!life || !life.alive) return;
    for (const c of L.alive(life)) {
      if (Math.random() < c.drops * 0.035) particles.push({ id: c.id, t: 0, out: true, v: 0.008 + Math.random() * 0.006 });
      const back = c.kind === "work" ? 0 : Math.max(0, L.warmthFrom(life, c));
      if (Math.random() < back * 0.05) particles.push({ id: c.id, t: 0, out: false, v: 0.006 + Math.random() * 0.005 });
      if (c.kind === "work" && Math.random() < c.D * 0.05) particles.push({ id: c.id, t: 0, out: false, money: true, v: 0.01 });
    }
    for (const p of particles) { p.t += p.v; if (p.t >= 1) p.dead = true; }
    particles = particles.filter((p) => !p.dead).slice(-900);
  }

  function frame() {
    if (life) {
      spawnParticles();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      drawWorld(ctx, W, H);
    }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------- panel
  function kindLabel(c) {
    if (c.kind === "partner") return `partner, ${c.theirAge}`;
    if (c.kind === "child") { const a = life.age - c.born; return a < 18 ? `child, ${a}` : `grown child, ${a}`; }
    if (c.kind === "parent") return `${c.name === "Mum" ? "mother" : "father"}, ${c.theirAge}`;
    if (c.kind === "friend") return c.reunion ? "old friend" : "friend";
    if (c.kind === "dream") return "dream";
    if (c.kind === "work") return `€${Math.round(L.wage(life))}k a year`;
    return c.kind;
  }
  const ORDER = { partner: 0, child: 1, parent: 2, friend: 3, dream: 4, work: 5 };

  function dots(n) { return n <= 6 ? "●".repeat(n) || "·" : `●×${n}`; }

  function renderPanel() {
    $("age").textContent = life.age;
    $("hBar").style.width = life.health + "%";
    $("hBar").style.background = life.health < 30 ? "#c98a62" : "";
    $("hVal").textContent = Math.round(life.health);
    $("wBar").style.width = life.warmth + "%";
    $("wBar").style.background = life.warmth < 25 ? "#8fa9b8" : "";
    $("wVal").textContent = Math.round(life.warmth);
    const m = Math.round(life.money);
    $("mVal").textContent = m >= 1000 ? `€${(m / 1000).toFixed(2)}M` : m >= 0 ? `€${m}k` : `€${-m}k in debt`;
    const B = L.budget(life), used = L.usedDrops(life);
    const free = Math.max(0, B - used);
    $("left").textContent = `${"●".repeat(free)}${"○".repeat(Math.min(used, B))}`;
    $("left").title = `${free} of ${B} drops left`;

    const rows = $("rows");
    rows.innerHTML = "";
    const items = [{ id: "self", name: "Yourself", kind: "rest, sleep, being alone", drops: life.selfDrops, D: null }]
      .concat(L.alive(life).sort((a, b) => ORDER[a.kind] - ORDER[b.kind]).map((c) => ({
        id: c.id, name: c.kind === "dream" ? c.dream[0].toUpperCase() + c.dream.slice(1) : c.kind === "work" ? "Work" : c.name,
        kind: kindLabel(c), drops: c.drops, D: c.D })));
    for (const it of items) {
      const li = document.createElement("li");
      if (it.D != null && it.D < 0.3) li.classList.add("fading");
      li.innerHTML = `<div class="who"><span class="nm"></span><span class="kd"></span>${it.D != null ? `<div class="bond"><i style="width:${Math.min(100, it.D / 2 * 100)}%"></i></div>` : ""}</div>
        <div class="pour"><button aria-label="less">−</button><span class="drops"></span><button aria-label="more">+</button></div>`;
      li.querySelector(".nm").textContent = it.name;
      li.querySelector(".kd").textContent = it.kind + (it.D != null && it.D < 0.3 ? " · fading" : "");
      li.querySelector(".drops").textContent = dots(it.drops);
      const [minus, plus] = li.querySelectorAll("button");
      minus.onclick = () => { L.setDrops(life, it.id, it.drops - 1); renderPanel(); };
      plus.onclick = () => { L.setDrops(life, it.id, it.drops + 1); renderPanel(); };
      minus.disabled = it.drops <= 0 || busy;
      plus.disabled = used >= B || busy;
      rows.appendChild(li);
    }
    $("live").disabled = busy || !life.alive;
    $("live5").disabled = busy || !life.alive;

    const log = $("log");
    for (; shownLog < life.log.length; shownLog++) {
      const e = life.log[shownLog];
      const li = document.createElement("li");
      li.className = e.tone;
      li.innerHTML = `<span>${e.age}</span>`;
      li.appendChild(document.createTextNode(e.text));
      log.insertBefore(li, log.firstChild);
    }
    while (log.children.length > 40) log.removeChild(log.lastChild);
  }

  // ------------------------------------------------------------- events
  function showEvent() {
    if (!life.pending.length) { $("event").classList.add("hidden"); return false; }
    const e = life.pending[0];
    $("eAge").textContent = `Age ${life.age}`;
    $("eTitle").textContent = e.title;
    $("eText").textContent = e.text;
    const box = $("eChoices");
    box.innerHTML = "";
    e.choices.forEach((ch, i) => {
      const b = document.createElement("button");
      b.textContent = ch.label;
      if (i === 0) b.classList.add("primary");
      b.onclick = () => { L.choose(life, 0, i); renderPanel(); if (!showEvent()) $("event").classList.add("hidden"); };
      box.appendChild(b);
    });
    $("event").classList.remove("hidden");
    return true;
  }

  // ------------------------------------------------------------- years
  function flash(text) {
    const f = $("yearflash");
    f.textContent = text; f.style.opacity = 1;
    clearTimeout(flash.t); flash.t = setTimeout(() => (f.style.opacity = 0.35), 900);
  }

  function liveYears(n) {
    if (busy || !life.alive) return;
    busy = true;
    let k = 0;
    const tick = () => {
      L.advanceYear(life);
      k += 1;
      flash(`Age ${life.age}`);
      renderPanel();
      if (!life.alive) { busy = false; renderPanel(); setTimeout(endGame, 1400); return; }
      if (life.pending.length || k >= n) { busy = false; renderPanel(); showEvent(); return; }
      setTimeout(tick, 420);
    };
    tick();
  }

  // ------------------------------------------------------------- the end
  function shareUrl() { return location.origin + location.pathname + "?seed=" + seed; }

  function drawPortrait() {
    // drawn at 2x so the saved picture is sharp
    const pc = $("portrait"), g = pc.getContext("2d");
    const S = 2, w = pc.width / S, h = pc.height / S, band = 130;
    g.setTransform(S, 0, 0, S, 0, 0);
    drawWorld(g, w, h - band, { still: true });
    const ep = L.epitaph(life);
    g.fillStyle = "#0b100d"; g.fillRect(0, h - band, w, band);
    g.textAlign = "left";
    g.fillStyle = "#e7e3d6"; g.font = "500 24px Fraunces, Georgia, serif";
    g.fillText(`Died at ${ep.age}.`, 20, h - band + 38);
    g.fillStyle = "#e5b45a"; g.font = "italic 300 16px Fraunces, Georgia, serif";
    g.fillText(ep.line, 20, h - band + 64);
    g.fillStyle = "#a9b1a8"; g.font = "12px 'IBM Plex Mono', monospace";
    g.fillText(`${ep.funeral === 0 ? "No one" : ep.funeral} at the funeral · ${ep.money} left behind`, 20, h - band + 90);
    g.fillStyle = "#5d675f"; g.font = "10px 'IBM Plex Mono', monospace";
    g.fillText(`LifeSucks · life #${seed} · anttiluode.github.io/LifeSucks`, 20, h - band + 114);
  }

  function endGame() {
    const ep = L.epitaph(life);
    $("edAge").textContent = `Died at ${ep.age}.`;
    $("edLine").textContent = ep.line;
    const kids = ep.children ? ` · ${ep.children} ${ep.children === 1 ? "child" : "children"}${ep.grandchildren ? `, ${ep.grandchildren} grandchildren` : ""}` : "";
    $("edStats").textContent = `${ep.funeral === 0 ? "No one" : ep.funeral} came to the funeral · ${ep.money} left behind${kids} · ${ep.diedOf}`;
    $("edCame").textContent = ep.funeralNames.length ? ep.funeralNames.join(", ") + (ep.funeral > ep.funeralNames.length ? ", and others" : "") : (ep.funeral ? "people from work, and others" : "no one");
    const wl = $("edWither"); wl.innerHTML = "";
    if (!ep.withered.length) wl.innerHTML = "<li>nothing — or nothing was ever let in</li>";
    for (const x of ep.withered.slice(-10)) {
      const li = document.createElement("li");
      li.textContent = `${x.name} — ${x.reason} `;
      const s = document.createElement("span"); s.textContent = `at ${x.age}`; li.appendChild(s);
      wl.appendChild(li);
    }
    $("endSeed").textContent = `life #${seed}`;
    drawPortrait();
    $("end").classList.remove("hidden");
  }

  $("savePic").onclick = () => {
    $("portrait").toBlob((b) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b); a.download = `lifesucks-${seed}.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  };
  $("copyText").onclick = async () => {
    const t = L.epitaph(life).share + " " + shareUrl();
    try { await navigator.clipboard.writeText(t); $("copyText").textContent = "Copied"; }
    catch (e) { prompt("Copy this:", t); }
    setTimeout(() => ($("copyText").textContent = "Copy epitaph"), 1600);
  };
  function restart(newSeed) {
    seed = newSeed;
    history.replaceState(null, "", "?seed=" + seed);
    begin();
  }
  $("again").onclick = () => restart(1 + Math.floor(Math.random() * 999999));
  $("same").onclick = () => restart(seed);

  // ------------------------------------------------------------- start
  function begin() {
    life = L.createLife(seed);
    shownLog = 0; particles = []; busy = false;
    $("log").innerHTML = "";
    $("end").classList.add("hidden");
    $("start").classList.add("hidden");
    resize();
    renderPanel();
    flash("Age 18");
    showEvent();
  }
  $("seedLabel").textContent = `life #${seed}`;
  $("begin").onclick = begin;
  $("live").onclick = () => liveYears(1);
  $("live5").onclick = () => liveYears(5);
  document.addEventListener("keydown", (e) => {
    if (e.key === " " && life && $("event").classList.contains("hidden") && $("start").classList.contains("hidden") && $("end").classList.contains("hidden")) {
      e.preventDefault(); liveYears(1);
    }
  });

  // a life is already drawn behind the title card
  life = L.createLife(seed);
  resize();
  renderPanel();
  requestAnimationFrame(frame);
})();
