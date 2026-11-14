// Simulated players, to check that different ways of living give different lives.
// node sim/bots.js [nSeeds]
const L = require("../life.js");

function alloc(life, plan) {
  // plan(life) returns {self, map(c)->drops}; applied greedily in priority order
  for (const c of L.alive(life)) c.drops = 0;
  life.selfDrops = 0;
  const wants = plan(life); // [[id|'self', n], ...] in priority order
  for (const [id, n] of wants) {
    const cur = id === "self" ? life.selfDrops : (L.alive(life).find((c) => c.id === id) || {}).drops || 0;
    L.setDrops(life, id, cur + n);
  }
}
const by = (life, kind) => L.alive(life, kind);

const BOTS = {
  workaholic: {
    plan: (life) => [...by(life, "work").map((c) => [c.id, 8]), ["self", 2], ...by(life, "partner").map((c) => [c.id, 1]), ...by(life, "child").map((c) => [c.id, 1])],
    pick: (e) => (["promo", "move", "house", "meet", "child"].includes(e.id) ? 0 : e.choices.length - 1),
  },
  family: {
    plan: (life) => [...by(life, "partner").map((c) => [c.id, 3]), ...by(life, "child").map((c) => [c.id, 2]), ...by(life, "work").map((c) => [c.id, 3]), ["self", 1], ...by(life, "parent").map((c) => [c.id, 1]), ...by(life, "friend").map((c) => [c.id, 1])],
    pick: (e) => (["promo", "move", "midlife"].includes(e.id) ? (e.id === "midlife" ? 1 : 1) : 0),
  },
  balanced: {
    plan: (life) => [...by(life, "work").map((c) => [c.id, 3]), ["self", 2], ...by(life, "partner").map((c) => [c.id, 2]), ...by(life, "child").map((c) => [c.id, 1]), ...by(life, "friend").map((c) => [c.id, 1]), ...by(life, "parent").map((c) => [c.id, 1]), ...by(life, "dream").map((c) => [c.id, 1])],
    pick: (e) => (e.id === "move" ? 1 : e.id === "midlife" ? 1 : 0),
  },
  loner_dreamer: {
    plan: (life) => [...by(life, "work").map((c) => [c.id, 3]), ["self", 3], ...by(life, "dream").map((c) => [c.id, 4]), ...by(life, "parent").map((c) => [c.id, 1])],
    pick: (e) => (["meet", "friend", "child", "old"].includes(e.id) ? 1 : 0),
  },
  pure_loner: {
    plan: (life) => [...by(life, "work").map((c) => [c.id, 4]), ["self", 4]],
    pick: (e) => (["meet", "friend", "child", "old", "dream"].includes(e.id) ? 1 : e.choices.length - 1),
  },
  social: {
    plan: (life) => [...by(life, "work").map((c) => [c.id, 3]), ["self", 1], ...by(life, "friend").map((c) => [c.id, 2]), ...by(life, "partner").map((c) => [c.id, 1])],
    pick: (e) => (["move", "child"].includes(e.id) ? 1 : 0),
  },
  random: {
    plan: (life) => { const ch = [["self", 0], ...L.alive(life).map((c) => [c.id, 0])]; const out = []; for (let k = 0; k < 12; k++) out.push([ch[Math.floor(life.R() * ch.length)][0], 1]); return out; },
    pick: (e, life) => Math.floor(life.R() * e.choices.length),
  },
};

function play(bot, seed) {
  const life = L.createLife(seed);
  let years = 0;
  while (life.alive && years < 120) {
    while (life.pending.length) L.choose(life, 0, bot.pick(life.pending[0], life));
    alloc(life, bot.plan);
    L.advanceYear(life);
    years++;
  }
  const ep = L.epitaph(life);
  const h = life.history;
  return { ...ep, meanWarmth: h.reduce((s, x) => s + x.warmth, 0) / Math.max(1, h.length), lonely: life.yearsLonely, peak: life.peakMoney };
}

const N = +process.argv[2] || 300;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
console.log("bot            | age p10/50/90 | <60 died | money at death (median) | funeral (median) | kids | withered | warmth | lonely yrs | top epitaphs");
for (const [name, bot] of Object.entries(BOTS)) {
  const rs = []; for (let s = 1; s <= N; s++) rs.push(play(bot, s * 7919));
  const lines = {}; for (const r of rs) lines[r.line] = (lines[r.line] || 0) + 1;
  const top = Object.entries(lines).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${Math.round(100 * v / N)}% ${k}`).join(" | ");
  const moneyNum = (s) => s.includes("debt") ? -parseFloat(s.slice(1)) : s.endsWith("M") ? 1000 * parseFloat(s.slice(1)) : parseFloat(s.slice(1));
  console.log(`${name.padEnd(14)} | ${(()=>{const a=rs.map(r=>r.age).sort((x,y)=>x-y);return `${a[Math.floor(N*0.1)]}/${a[Math.floor(N*0.5)]}/${a[Math.floor(N*0.9)]}`})().padStart(13)} | ${String(Math.round(100 * rs.filter((r) => r.age < 60).length / N) + "%").padStart(8)} | ${String(Math.round(med(rs.map((r) => moneyNum(r.money))))).padStart(23)} | ${String(med(rs.map((r) => r.funeral))).padStart(16)} | ${med(rs.map((r) => r.children))} | ${String(med(rs.map((r) => r.withered.length))).padStart(8)} | ${med(rs.map((r) => Math.round(r.meanWarmth)))} | ${String(med(rs.map((r) => r.lonely))).padStart(10)} | ${top}`);
}
