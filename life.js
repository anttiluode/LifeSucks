/*
 * LifeSucks — the life model.
 *
 * A life is a vine. You are the root. Every person, job and dream in your life is a
 * channel with a conductance D. Each year you have a handful of attention drops to pour
 * into channels. Channels are kept open only by what flows through them:
 *
 *     Q      = your drops + what they give back (recip * D)
 *     target = Dmax * Q / (Q + Qh)
 *     dD     = eta / (1 + D / Dwood)^2 * (target - D)     <- thick old wood changes slowly
 *
 * A channel whose D falls below D_CLOSE closes by itself. Nothing in the code decides
 * "you got divorced" or "your son stopped calling"; the flux just stopped.
 *
 * Warmth (love) comes back through open channels. Money comes back through work.
 * Health falls without warmth and rest. Money cannot buy warmth.
 *
 * Pure model, no drawing. Runs in the browser (window.LifeModel) and in node (require).
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- randomness
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const NAMES = ["Aino", "Mateo", "Lea", "Noah", "Iris", "Kai", "Sara", "Elias", "Mira", "Leo",
    "Nora", "Otto", "Ada", "Jonas", "Emma", "Ilja", "Selma", "Ravi", "Maya", "Tomas", "Lumi",
    "Hugo", "Alma", "Eino", "Zoe", "Samir", "Ella", "Oskar", "Yuki", "Veera", "Daniel", "Ines",
    "Aleksi", "Freya", "Omar", "Helmi", "Luca", "Anni", "Felix", "Rosa", "Jari", "Chloe", "Teo",
    "Sofia", "Vilja", "Amir", "Lotta", "Arttu", "Mei", "Pablo"];
  const DREAMS = ["painting", "music", "the garden", "a novel", "running", "a small boat",
    "pottery", "chess", "photography", "a podcast", "woodwork", "birdwatching", "a band",
    "coding a game", "the choir", "mountain hiking"];

  // ---------------------------------------------------------------- constants
  const DMAX = 2.0, QH = 1.5, DWOOD = 0.8, ETA = 0.5, D_CLOSE = 0.08;
  const NEED = 4.5;                   // warmth a person needs per year

  // per kind: cap = warmth at full channel, recip = how much they give back by themselves
  const KIND = {
    partner: { cap: 3.4, recip: 0.55, Dh: 0.6, d0: 0.25, person: true },
    friend: { cap: 1.2, recip: 0.45, Dh: 0.5, d0: 0.22, person: true },
    parent: { cap: 1.2, recip: 0.85, Dh: 0.5, d0: 1.3, person: true },
    child: { cap: 2.0, recip: 0.8, Dh: 0.6, d0: 0.6, person: true },
    dream: { cap: 2.6, recip: 0.25, Dh: 0.7, d0: 0.22, person: false },
    work: { cap: 0.0, recip: 0.0, Dh: 0.7, d0: 0.3, person: false },
  };

  function budgetFor(age, health) {
    let b = age < 60 ? 12 : age < 70 ? 10 : age < 80 ? 8 : 6;
    if (health < 30) b -= 2;
    return Math.max(3, b);
  }

  // ---------------------------------------------------------------- creation
  function createLife(seed) {
    const R = rng(seed || 1);
    const used = new Set();
    function name() {
      for (let k = 0; k < 200; k++) {
        const n = NAMES[Math.floor(R() * NAMES.length)];
        if (!used.has(n)) { used.add(n); return n; }
      }
      return NAMES[Math.floor(R() * NAMES.length)] + " " + Math.floor(R() * 9 + 1);
    }
    const life = {
      seed: seed || 1, R, name, age: 18, health: 80, warmth: 60, money: 2, alive: true,
      channels: [], nextId: 1, log: [], pending: [], flags: {}, house: false,
      lastWage: 0, pension: 0, retired: false, promo: 1.0, moveYears: 0, moveMult: 1.0,
      peakMoney: 2, history: [], diedOf: null, yearsLonely: 0, everPartner: false,
    };
    // the life you are born into
    const momAge = 44 + Math.floor(R() * 10), dadAge = momAge + Math.floor(R() * 5) - 1;
    add(life, "parent", "Mum", { theirAge: momAge, D: 1.2 + R() * 0.3 });
    if (R() < 0.85) add(life, "parent", "Dad", { theirAge: dadAge, D: 0.8 + R() * 0.6 });
    add(life, "friend", name(), { D: 0.6 + R() * 0.3 });
    if (R() < 0.6) add(life, "friend", name(), { D: 0.35 + R() * 0.3 });
    add(life, "work", "work", { D: 0.25 });
    // a reasonable first allocation
    for (const c of life.channels) c.drops = c.kind === "parent" ? 1 : c.kind === "friend" ? 2 : c.kind === "work" ? 3 : 0;
    life.selfDrops = 2;
    say(life, "You are 18. The world is wide and cold, and you have a little warmth to spend.");
    queueEvents(life);
    return life;
  }

  function add(life, kind, name, opts) {
    const k = KIND[kind];
    const c = {
      id: life.nextId++, kind, name, D: (opts && opts.D) != null ? opts.D : k.d0, Dpeak: 0,
      drops: (opts && opts.drops) || 0, alive: true, born: life.age, ended: null, endReason: null,
      theirAge: (opts && opts.theirAge) || null, grandkids: [], parentId: (opts && opts.parentId) || null,
      dream: (opts && opts.dream) || null, wobble: life.R(), slot: life.R(),
    };
    c.Dpeak = c.D;
    life.channels.push(c);
    return c;
  }

  function say(life, text, tone) {
    life.log.push({ age: life.age, text, tone: tone || "plain" });
  }

  function alive(life, kind) {
    return life.channels.filter((c) => c.alive && (!kind || c.kind === kind));
  }

  function budget(life) { return budgetFor(life.age, life.health); }

  function usedDrops(life) {
    return life.selfDrops + alive(life).reduce((s, c) => s + c.drops, 0);
  }

  function setDrops(life, id, n) {
    const B = budget(life);
    if (id === "self") {
      const other = usedDrops(life) - life.selfDrops;
      life.selfDrops = Math.max(0, Math.min(n, B - other, 8));
      return;
    }
    const c = life.channels.find((x) => x.id === id && x.alive);
    if (!c) return;
    const other = usedDrops(life) - c.drops;
    c.drops = Math.max(0, Math.min(n, B - other, 8));
  }

  function clampDrops(life) {
    const B = budget(life);
    let over = usedDrops(life) - B;
    // take from the biggest pours first (self last)
    while (over > 0) {
      const top = alive(life).filter((c) => c.drops > 0).sort((a, b) => b.drops - a.drops)[0];
      if (top) top.drops -= 1; else if (life.selfDrops > 0) life.selfDrops -= 1; else break;
      over -= 1;
    }
  }

  // ---------------------------------------------------------------- one year
  function recipOf(life, c) {
    if (c.kind === "child") return (life.age - c.born) < 18 ? 0.8 : 0.35;
    return KIND[c.kind].recip;
  }

  function warmthFrom(life, c) {
    const k = KIND[c.kind];
    if (c.kind === "work") return 0.45 * c.D / (c.D + 0.7) - 0.3 * Math.max(0, c.drops - 3);   // meaning minus stress
    let w = k.cap * c.D / (c.D + k.Dh);
    if (c.kind === "child" && life.age - c.born < 18) w *= 0.75;   // small children are joy and exhaustion
    if (c.kind === "child") w += c.grandkids.length * 0.9 * c.D / (c.D + 0.6);
    return w;
  }

  function wage(life) {
    const w = alive(life, "work")[0];
    if (!w) return life.retired ? life.pension : 0;
    return (16 + 50 * w.D / (w.D + 0.7)) * Math.min(life.promo, 2.4) * Math.min(life.moveMult, 1.7);
  }

  function youngKids(life) {
    return alive(life, "child").filter((c) => life.age - c.born < 18).length;
  }

  function advanceYear(life) {
    if (!life.alive) return;
    clampDrops(life);
    const R = life.R;
    const report = { closed: [], warmthIn: 0, moneyIn: 0 };

    // 1. flux through every channel, and canalization
    for (const c of alive(life)) {
      const dist = life.moveYears > 0 && (c.kind === "friend" || c.kind === "parent") ? 0.45 : 1.0;
      const Q = c.drops * dist + recipOf(life, c) * c.D;
      const target = DMAX * Q / (Q + QH);
      let eta = ETA / Math.pow(1 + c.D / DWOOD, 2);
      if (life.house && (c.kind === "partner" || c.kind === "child") && target < c.D) eta *= 0.6;
      c.D += eta * (target - c.D);
      c.Dpeak = Math.max(c.Dpeak, c.D);
      if (c.kind === "child") for (const g of c.grandkids) g.D = c.D;
    }

    // 2. warmth, money, health
    let warm = 0;
    for (const c of alive(life)) warm += warmthFrom(life, c);
    warm += 1.4 * (1 - Math.exp(-life.selfDrops / 2)) + (life.house ? 0.5 : 0);   // time alone helps, up to a point
    report.warmthIn = warm;
    life.warmth = Math.max(0, Math.min(100, life.warmth + (warm - NEED) * 2.5));

    const income = wage(life);
    if (alive(life, "work").length) life.lastWage = income;
    const p = alive(life, "partner")[0];
    const partnerIncome = p ? 16 * p.D / (p.D + 0.6) : 0;
    // you spend more as you earn more (lifestyle), children cost, a house costs
    const costs = 10 + 0.5 * (income + partnerIncome) + 6 * youngKids(life) + (p ? 3 : 0) + (life.house ? 3 : 0);
    const interest = life.money > 0 ? 0.02 * life.money : 0.04 * life.money;
    life.money += income + partnerIncome - costs + interest;
    report.moneyIn = income + partnerIncome - costs + interest;
    life.peakMoney = Math.max(life.peakMoney, life.money);

    const workDrops = alive(life, "work").reduce((s, c) => s + c.drops, 0);
    let dh = 3.0 * (1 - Math.exp(-life.selfDrops / 2));            // rest, sleep, a walk: saturates
    dh -= life.age < 30 ? 0 : (life.age - 30) * 0.075;              // the body ages anyway
    dh -= Math.max(0, workDrops - 5) * 0.5;                        // overwork
    if (life.warmth < 30) { dh -= (30 - life.warmth) * 0.12; life.yearsLonely += 1; }   // loneliness is a health risk
    if (life.warmth > 60) dh += 1.0;
    if (life.money < 0) dh -= 1.5;
    life.health = Math.max(0, Math.min(100, life.health + dh));

    // 3. channels that stopped carrying anything close by themselves
    for (const c of alive(life)) {
      if (c.D >= D_CLOSE) continue;
      close(life, c, closeReason(life, c));
      report.closed.push(c);
    }

    // 4. everyone gets older; some leave by other doors
    life.age += 1;
    if (life.moveYears > 0) life.moveYears -= 1;
    for (const c of alive(life)) {
      if (c.theirAge != null) c.theirAge += 1;
      if (c.kind === "child" && life.age - c.born === 18) say(life, `${c.name} moved out.`, "soft");
      if ((c.kind === "parent" || c.kind === "partner") && c.theirAge != null) {
        const pd = 0.0003 * Math.exp(0.088 * (c.theirAge - 18));
        if (R() < pd) {
          close(life, c, "died");
          life.warmth = Math.max(0, life.warmth - 12);
          if (c.kind === "parent" && R() < 0.6) {
            const inh = 10 + Math.floor(R() * 60);
            life.money += inh;
            say(life, `${c.name} left you €${inh}k.`, "soft");
          }
        }
      }
    }
    // retirement: the light moves whether you like it or not
    const w = alive(life, "work")[0];
    if (w && life.age >= 66) {
      life.pension = 0.45 * life.lastWage;
      life.retired = true;
      close(life, w, "retired");
    }

    // 5. do you see next year?
    const pDie = 0.00008 * Math.exp(0.105 * (life.age - 18)) * Math.exp((60 - life.health) / 22);
    if (life.health <= 0 || R() < pDie || life.age >= 104) {
      clampDrops(life);
      die(life);
      return report;
    }
    life.history.push({ age: life.age, health: life.health, warmth: life.warmth, money: life.money,
      open: alive(life).filter((c) => KIND[c.kind].person).length });
    clampDrops(life);
    queueEvents(life);
    return report;
  }

  function closeReason(life, c) {
    if (c.kind === "partner") return "drifted apart";
    if (c.kind === "friend") return "lost touch";
    if (c.kind === "child") return "stopped calling";
    if (c.kind === "dream") return "gave it up";
    if (c.kind === "work") return "let go";
    return "faded";
  }

  function close(life, c, reason) {
    c.alive = false;
    c.ended = life.age;
    c.endReason = reason;
    c.drops = 0;
    const txt = {
      "drifted apart": `You and ${c.name} drifted apart.`,
      "lost touch": `You lost touch with ${c.name}.`,
      "stopped calling": `${c.name} stopped calling.`,
      "gave it up": `You gave up ${c.dream || "the dream"}.`,
      "let go": "You were let go from work.",
      "retired": "You retired. The work light went out.",
      "died": `${c.name} died.`,
      "faded": `${c.name} faded from your life.`,
    }[reason] || `${c.name}: ${reason}.`;
    say(life, txt, reason === "died" ? "grief" : reason === "retired" ? "soft" : "loss");
    if (c.kind === "partner" && reason === "drifted apart" && life.money > 0) {
      life.money *= 0.7;
    }
    if (c.kind === "work" && reason === "let go") life.promo = 1.0;
  }

  function die(life) {
    life.alive = false;
    life.diedAt = life.age;
    life.diedOf = life.health <= 0 ? (life.warmth < 20 ? "loneliness wore the body down" : "the body gave out")
      : life.age >= 85 ? "old age" : life.health < 35 ? "illness" : "a sudden illness";
    say(life, `You died at ${life.age}.`, "end");
  }

  // ---------------------------------------------------------------- events
  // Each event is a small fork. Its effects only add or remove channels, or nudge
  // numbers; everything that follows still comes from the flux.
  function queueEvents(life) {
    const R = life.R, a = life.age;
    const ev = [];
    const p = alive(life, "partner")[0];
    const kids = alive(life, "child");
    const friends = alive(life, "friend");
    const work = alive(life, "work")[0];
    const social = friends.reduce((s, c) => s + c.D, 0) + (work ? 0.3 * work.D : 0);

    if (!p && a < 70 && R() < 0.12 + 0.07 * social) {
      const n = life.name();
      ev.push({ id: "meet", title: `You meet ${n}.`, text: "Something about them stays with you after you part.",
        choices: [
          { label: "Let them in", fx: (L) => { add(L, "partner", n, { theirAge: a + Math.floor(R() * 7) - 3 }).drops = 2; L.everPartner = true; say(L, `You let ${n} in.`, "warm"); } },
          { label: "Not now", fx: (L) => say(L, `You let ${n} pass.`) },
        ] });
    }
    if (a < 75 && friends.length < 6 && R() < 0.10 + 0.05 * social) {
      const n = life.name();
      ev.push({ id: "friend", title: `${n} wants to be friends.`, text: "They invite you somewhere on Saturday.",
        choices: [
          { label: "Go", fx: (L) => { add(L, "friend", n).drops = 1; say(L, `${n} became a friend.`, "warm"); } },
          { label: "Too busy", fx: (L) => say(L, `You were too busy for ${n}.`) },
        ] });
    }
    if (p && p.D > 0.8 && a >= 22 && a <= 44 && kids.length < 4 && R() < 0.28) {
      ev.push({ id: "child", title: kids.length ? "Another child?" : "A child?", text: `${p.name} asks quietly, one evening.`,
        choices: [
          { label: "Yes", fx: (L) => { const n = L.name(); const c = add(L, "child", n, { theirAge: 0 }); c.drops = 2; say(L, `${n} was born.`, "warm"); } },
          { label: "Not yet", fx: (L) => say(L, "Not yet, you said.") },
        ] });
    }
    if (work && work.D > 1.0 && a < 60 && R() < 0.14) {
      ev.push({ id: "promo", title: "A promotion.", text: "More money. More hours. They expect you to say yes.",
        choices: [
          { label: "Take it", fx: (L) => { L.promo *= 1.25; const w = alive(L, "work")[0]; if (w) w.drops = Math.min(8, w.drops + 2); L.warmth = Math.max(0, L.warmth - 4); say(L, "You took the promotion.", "money"); } },
          { label: "Decline", fx: (L) => say(L, "You declined the promotion.") },
        ] });
    }
    if (work && a >= 22 && a <= 50 && R() < 0.06) {
      ev.push({ id: "move", title: "A job in another city.", text: "Better pay. Far from everyone you know.",
        choices: [
          { label: "Go", fx: (L) => { L.moveYears = 6; L.moveMult *= 1.3; say(L, "You moved for work. Friends and family are far now.", "money"); } },
          { label: "Stay", fx: (L) => say(L, "You stayed.") },
        ] });
    }
    if (work && R() < 0.03 + (work.D < 0.45 ? 0.10 : 0)) {
      ev.push({ id: "layoff", title: "Layoffs.", text: "Your name is on the list.",
        choices: [{ label: "…", fx: (L) => { const w = alive(L, "work")[0]; if (w) { w.D *= 0.35; } L.money -= 8; L.promo = 1.0; say(L, "You lost your job, and found a worse one.", "loss"); } }] });
    }
    if (!work && !life.retired && a < 64 && R() < 0.5) {
      ev.push({ id: "job", title: "A job.", text: "Not the one you wanted. It pays.",
        choices: [
          { label: "Take it", fx: (L) => { add(L, "work", "work", { D: 0.3 }).drops = 3; say(L, "You took a job.", "money"); } },
          { label: "Not yet", fx: (L) => say(L, "You kept looking.") },
        ] });
    }
    if (!life.house && life.money >= 90 && a < 65 && R() < 0.35) {
      ev.push({ id: "house", title: "A house with a garden.", text: "€90k. Room for everyone you love, if you have them.",
        choices: [
          { label: "Buy it", fx: (L) => { L.money -= 90; L.house = true; say(L, "You bought a house.", "warm"); } },
          { label: "Keep the money", fx: (L) => say(L, "You kept the money.") },
        ] });
    }
    if (!alive(life, "dream").length && a < 70 && R() < 0.09) {
      const d = DREAMS[Math.floor(R() * DREAMS.length)];
      ev.push({ id: "dream", title: `You keep thinking about ${d}.`, text: "It would take time you don't have.",
        choices: [
          { label: "Start", fx: (L) => { add(L, "dream", d, { dream: d }).drops = 1; say(L, `You started ${d}.`, "warm"); } },
          { label: "Someday", fx: (L) => say(L, `${d[0].toUpperCase() + d.slice(1)}: someday.`) },
        ] });
    }
    const lost = life.channels.filter((c) => !c.alive && c.kind === "friend" && c.endReason === "lost touch" && c.Dpeak > 0.7);
    if (lost.length && R() < 0.08) {
      const c = lost[Math.floor(R() * lost.length)];
      ev.push({ id: "old", title: `${c.name} sends a message.`, text: `"It's been years. Coffee?"`,
        choices: [
          { label: "Reply", fx: (L) => { const n = add(L, "friend", c.name, { D: 0.3 + 0.35 * c.Dpeak }); n.drops = 1; n.reunion = true; say(L, `You and ${c.name} found each other again.`, "warm"); } },
          { label: "Leave it", fx: (L) => say(L, `You didn't reply to ${c.name}.`) },
        ] });
    }
    const sickParent = alive(life, "parent").find((c) => c.theirAge > 70 && R() < 0.10);
    if (sickParent) {
      ev.push({ id: "ill", title: `${sickParent.name} is ill.`, text: "They say it's nothing. It isn't nothing.",
        choices: [
          { label: "Be there", fx: (L) => { sickParent.D += 0.6; L.health = Math.max(0, L.health - 4); const w = alive(L, "work")[0]; if (w) w.D *= 0.85; say(L, `You stayed with ${sickParent.name}.`, "warm"); } },
          { label: "Send money", fx: (L) => { L.money -= 6; sickParent.D += 0.1; say(L, `You sent ${sickParent.name} money.`); } },
        ] });
    }
    const teen = kids.find((c) => a - c.born >= 13 && a - c.born <= 17 && c.D < 0.7 && R() < 0.25);
    if (teen) {
      ev.push({ id: "teen", title: `${teen.name} is in trouble.`, text: "A call from the school. Then another one.",
        choices: [
          { label: "Drop everything", fx: (L) => { teen.D += 0.7; L.health = Math.max(0, L.health - 3); const w = alive(L, "work")[0]; if (w) w.D *= 0.8; say(L, `You dropped everything for ${teen.name}.`, "warm"); } },
          { label: "Pay for help", fx: (L) => { L.money -= 10; teen.D += 0.15; say(L, `You paid for ${teen.name}'s help.`); } },
        ] });
    }
    const parentOfGrand = kids.find((c) => a - c.born >= 24 && c.D > 0.6 && c.grandkids.length < 3 && R() < 0.14);
    if (parentOfGrand) {
      const n = life.name();
      parentOfGrand.grandkids.push({ name: n, D: parentOfGrand.D, slot: life.R() });
      say(life, `${parentOfGrand.name} had a baby: ${n}. You are a grandparent.`, "warm");
    }
    if (p && p.theirAge > 60 && R() < 0.05) {
      ev.push({ id: "pill", title: `${p.name} is unwell.`, text: "The doctor speaks slowly.",
        choices: [
          { label: "Care for them", fx: (L) => { p.D += 0.5; L.health = Math.max(0, L.health - 5); say(L, `You cared for ${p.name}.`, "warm"); } },
          { label: "Hire a nurse", fx: (L) => { L.money -= 15; p.D += 0.1; say(L, `You hired a nurse for ${p.name}.`); } },
        ] });
    }
    if (a >= 42 && a <= 52 && !life.flags.midlife && R() < 0.25) {
      life.flags.midlife = true;
      ev.push({ id: "midlife", title: "Is this it?", text: "You wake at 4 a.m. with the question.",
        choices: [
          { label: "Buy a sports car", fx: (L) => { L.money -= 35; L.warmth = Math.min(100, L.warmth + 6); say(L, "You bought a sports car. It helped for a while.", "money"); } },
          { label: "Call someone you love", fx: (L) => { const c = alive(L).filter((x) => KIND[x.kind].person).sort((x, y) => x.D - y.D)[0]; if (c) { c.D += 0.5; say(L, `You called ${c.name}. You talked for hours.`, "warm"); } else say(L, "There was no one to call.", "loss"); } },
        ] });
    }
    // at most two forks a year, so the year still feels like a year
    life.pending = ev.slice(0, 2);
  }

  function choose(life, eventIndex, choiceIndex) {
    const e = life.pending[eventIndex];
    if (!e) return;
    e.choices[choiceIndex].fx(life);
    life.pending.splice(eventIndex, 1);
    clampDrops(life);
  }

  // ---------------------------------------------------------------- the end
  function funeral(life) {
    let n = 0;
    const who = [];
    for (const c of alive(life)) {
      if (!KIND[c.kind].person) continue;
      if (c.D > 0.35) { n += 1; who.push(c.name); }
      if (c.kind === "child" && c.D > 0.35) n += c.grandkids.length;
    }
    const w = life.channels.find((c) => c.kind === "work");
    if (w && w.Dpeak > 1.3) n += 2;
    const d = alive(life, "dream")[0];
    if (d && d.D > 1.0) n += 3;
    return { count: n, names: who };
  }

  function epitaph(life) {
    const f = funeral(life);
    const kids = life.channels.filter((c) => c.kind === "child");
    const grand = kids.reduce((s, c) => s + c.grandkids.length, 0);
    const withered = life.channels.filter((c) => !c.alive && c.endReason !== "died" && c.endReason !== "retired");
    const dream = life.channels.find((c) => c.kind === "dream" && c.alive && c.D > 0.9);
    const m = Math.round(life.money);
    let line;
    if (dream && f.count < 6) line = `Kept at ${dream.dream} until the end.`;
    else if (m > 400 && f.count <= 3) line = "Built something the bank could see.";
    else if (f.count >= 12) line = "The house was never quiet.";
    else if (withered.length >= 6) line = "So many doors, each left a little open.";
    else if (life.diedAt >= 85 && life.warmth > 50) line = "Old, warm, and not alone.";
    else if (life.warmth < 20) line = "The rooms went cold slowly.";
    else if (m < 0) line = "Gave more than there was.";
    else line = "Lived, mostly in the middle of things.";
    const money = m >= 1000 ? `€${(m / 1000).toFixed(1)}M` : m >= 0 ? `€${m}k` : `€${-m}k in debt`;
    return {
      age: life.diedAt, line, money, funeral: f.count, funeralNames: f.names, diedOf: life.diedOf,
      children: kids.length, grandchildren: grand,
      withered: withered.map((c) => ({ name: c.kind === "dream" ? c.dream : c.name, kind: c.kind, reason: c.endReason, age: c.ended })),
      share: `I lived ${life.diedAt} years in LifeSucks. ${f.count === 0 ? "No one" : f.count} came to the funeral. ${money} left behind. "${line}"`,
    };
  }

  const api = { createLife, advanceYear, setDrops, budget, usedDrops, choose, alive, funeral, epitaph, warmthFrom, wage, KIND, rng };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LifeModel = api;
})(typeof window !== "undefined" ? window : globalThis);
