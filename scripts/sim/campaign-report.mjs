#!/usr/bin/env node
/**
 * SIM-01 540-day campaign report (OWNER: Simulation Engineer - Strategic World Simulation).
 *
 *   node scripts/sim/campaign-report.mjs            -> docs/sprint1/sim-01/campaign-report.{md,json} + SVG charts
 *   REPORT_OUT=some/dir node scripts/sim/campaign-report.mjs
 *
 * Loads the real TypeScript simulation through Vite's SSR module loader (no extra dependencies) and plays whole
 * campaigns headless with every player event answered with its first (safe default) choice and every engagement
 * autoresolved - the same rules as tests/sim/strategic/helpers.ts:
 *   - The Broken Crown seed 1, The Seven Hills seed 1 and the default sandbox seed 1, with the data as shipped;
 *   - the same runs with the data change still pending at the Creative Director (REQUESTED below), when it differs;
 *   - The Broken Crown seeds 1-6 (outcome only) and a passive sandbox player as each realm (outcome, starving days).
 * Records per month: the player's ledger (tax, trade, tribute, army, buildings, administration, net, treasury, royal
 * reserve, stability, legitimacy), reserve days (minimum of the month) and unrest (maximum) per own settlement;
 * battles, events, rebellions, secessions and captures; the outcome; the §13.2 grain calibration with both data sets.
 * Rework round 2 adds: what the supply selectors tell the player (cut-off towns, why an army starves - review S4), the
 * per-faction road-block rule against the old first-by-id answer (review S3) and fed sieges of Giridurg (review S1).
 */
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(ROOT, process.env.REPORT_OUT || 'docs/sprint1/sim-01');
const DAYS = 540;

/**
 * Data change still pending at the Creative Director, as {'rules.path': value}. The tests read RULES, so a request
 * lands without a code change; once src/data/rules.ts carries it the "requested" runs are skipped. None is pending in
 * rework round 2 (CD-8, storage 120 days, shipped in 87fb245 / 76f7d0c).
 */
const REQUESTED = {};
/** Shipped values printed in the run labels. */
const SHOWN = ['storage.baseDays'];

/** Data requests already applied by the Creative Director. */
const APPLIED = [
  '**CD-1** `RULES.population.laborHealthWeight` 0.5 -> 0 (applied in ba45410).',
  '**CD-2** `RULES.distribution.exportAboveDays` 120 -> 75 (applied in ba45410).',
  '**CD-5** `RULES.politics.offers.autonomy.taxShare` -0.25 -> -0.125, informational; the sim applies the §7.5 formula (applied in ba45410).',
  '**CD-6** `RULES.roads.repairWealthPerKm` and `RULES.politics.governor.loyaltyDrift` (applied in ba45410); the sim reads them (commands.roadRepairCost, politics.governorLoyaltyTarget).',
  '**CD-7** DESIGN_SPEC worked examples restated with the shipped map and modifiers (76f7d0c) - but see CD-9 for the siege example.',
  '**CD-8** `RULES.storage.baseDays` 90 -> 120 (87fb245, DESIGN_SPEC §7.3.4 in 76f7d0c). Measured with the shipped data below: passive sandbox player per realm ({passiveSummary}); The Broken Crown seeds 1-6 ({bcSummary}).',
];

/** Decisions the Creative Director recorded instead of a data change (DESIGN_SPEC §14.4, 76f7d0c). */
const DECIDED = [
  '**CD-3** Starvation unrest stays a flat +0.02/day for now (design debt with the deficit-realm item). Passive Marudesha with the shipped data: {frontierPassive}.',
  '**Camped armies beside a hungry own town** keep the 30-day floor and do not forage it; the UI must explain it - armySupplyView.reason / reasons now do (review S4, section "Supply readability").',
];

/** Open requests to the Creative Director; {...} placeholders are filled with the measurements of this run. */
const DATA_REQUESTS = [
  '**CD-9** (review S1) DESIGN_SPEC §7.8 says Giridurg falls in "52.5 days with one fed engineer formation at siegeStrength 1, 48 for Suvarna at 1.1" - that is 4,200 / 80 with the formation at full strength. The same section charges besiegers **0.4%/day siege attrition** (`RULES.supply.attrition.siege` 0.004), so a fed formation of 40 thins to ~33 men and the walls fall later: in the real tick, Suvarna (1.1) on seeds 1-6: {siegeDays} (x1.1 = {siegeNorm} at siegeStrength 1). With the attrition switched off the same runs take exactly {siegeNoAttrition} days (52.8 at siegeStrength 1). Please choose: (a) restate the example as "≈ 50-55 days for Suvarna, 55-60 at siegeStrength 1 (siege attrition included)", or (b) keep 52.5 and exempt a depot-fed siege camp from siege attrition (a rule change: SIM-01 would read e.g. `RULES.supply.attrition.siegeFed` 0). SIM-01 recommends (a): camp disease is the price of a long siege, and two engineer formations (26 days) are the designed remedy.',
  '**CD-4** Landmark rules are keyed by landmark id in code (Royal Granary spoilage x0.5, Cliff Cistern besieged consumption x0.6, Elephant Grove elephant recruit time x0.7, Great Road royal-road speed); please add `LandmarkDef` fields (`spoilageFactor`, `besiegedConsumption`, `recruitTime: { war_elephants: 0.7 }`, `roadSpeed`).',
];

/** Contract request to the CTO that the review raised (B3 narrative). */
const CTO_REQUESTS = [
  '**CTO-1** `src/core/types.ts` Effect: add `{ kind: \'defect_character\'; character: ScopeRef; to: ScopeRef; withArmies: boolean }` (\'Let him go\' sets `claimant_defected`, yet Prince Devavarman stays in the Suvarna court). SIM-01 then implements it in events.applyEffect: the character changes faction, leaves offices, council seat, heir role and governorship (as on death), his dynasty membership stays; with `withArmies` the armies he commands change owner with him; the Creative Director adds it to `evt_bc_gates_of_ratnapura/let_go`.',
];

const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const worldMod = await server.ssrLoadModule('/src/sim/strategic/world.ts');
  const econMod = await server.ssrLoadModule('/src/sim/strategic/economy.ts');
  const seasonsMod = await server.ssrLoadModule('/src/sim/strategic/seasons.ts');
  const statsMod = await server.ssrLoadModule('/src/sim/strategic/statistics.ts');
  const eventsMod = await server.ssrLoadModule('/src/sim/strategic/events.ts');
  const selectorsMod = await server.ssrLoadModule('/src/sim/strategic/selectors.ts');
  const networkMod = await server.ssrLoadModule('/src/sim/strategic/network.ts');
  const stateMod = await server.ssrLoadModule('/src/sim/strategic/state.ts');
  const armiesMod = await server.ssrLoadModule('/src/sim/strategic/armies.ts');
  const siegeMod = await server.ssrLoadModule('/src/sim/strategic/siege.ts');
  const { RULES } = await server.ssrLoadModule('/src/data/rules.ts');
  const { getEventDef } = await server.ssrLoadModule('/src/data/events.ts');
  const { defaultSandbox } = await server.ssrLoadModule('/src/data/campaign.ts');
  const { createWorld, getRegionHeightfield, tickWorld } = worldMod;

  const getPath = (path) => path.split('.').reduce((o, k) => o[k], RULES);
  const setPath = (path, v) => {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], RULES)[last] = v;
  };
  const original = Object.fromEntries(Object.keys(REQUESTED).map((k) => [k, getPath(k)]));
  /** True while the shipped data still differs from the request (otherwise the requested runs are skipped). */
  const pendingDiffers = Object.entries(REQUESTED).some(([k, v]) => original[k] !== v);
  const applyData = (pending) => {
    for (const k of Object.keys(REQUESTED)) setPath(k, pending ? REQUESTED[k] : original[k]);
  };
  const shipped = Object.fromEntries(SHOWN.map((k) => [k, getPath(k)]));
  const dataLabel = (pending) => (pending ? `requested data (${Object.entries(REQUESTED).map(([k, v]) => `${k} ${v}`).join(', ')})` : `data as shipped (${Object.entries({ ...shipped, ...original }).map(([k, v]) => `${k} ${v}`).join(', ')})`);

  const issued = (w, cmd) => ({ factionId: w.playerFactionId, hour: w.calendar.totalHours, cmd });

  /** Road blocks on this day: edge-faction pairs where the old first-by-id answer differs from the rule; blockedFor misses. */
  function roadRuleDay(w, acc) {
    const ids = Object.keys(w.armies).sort();
    const facs = Object.keys(w.factions).sort().filter((f) => w.factions[f].alive);
    for (const eid of Object.keys(w.roads.edges).sort()) {
      const e = w.roads.edges[eid];
      const near = ids.map((id) => w.armies[id]).filter((a) => networkMod.holdsRoad(a) && networkMod.nearEdge(e, a.x, a.z, networkMod.ROAD_BLOCK_RADIUS));
      const oldFirst = near[0] ?? null;
      let differs = false;
      for (const F of facs) {
        const old = !!oldFirst && stateMod.hostileToArmy(w, F, oldFirst);
        const rule = near.some((a) => stateMod.hostileToArmy(w, F, a)) && !near.some((a) => a.factionId === F);
        if (old !== rule) {
          differs = true;
          acc.edgeFactionDays++;
        }
        if (networkMod.blockedFor(w, e, F) !== rule) acc.mismatches++;
      }
      if (differs) acc.edgeDays++;
    }
  }

  /** Daily: what the S4 selectors tell the player about own towns cut off and own armies the draw does not feed. */
  function readabilityDay(w, pid, day, acc) {
    for (const s of Object.values(w.settlements)) {
      if (s.ownerFactionId !== pid) continue;
      const v = selectorsMod.settlementVitals(w, s.id);
      if (!v.cutOff) continue;
      const key = `${s.name}: ${v.cutOffReasons.join(' + ')}${v.cutOffBy ? ` (${v.cutOffBy})` : ''}`;
      (acc.cutOff[key] ??= []).push(day);
    }
    for (const a of Object.values(w.armies)) {
      if (a.factionId !== pid) continue;
      const v = selectorsMod.armySupplyView(w, a.id);
      if (!v || a.supply.starvationDays <= 0) continue;
      const key = `${a.name}: ${v.reasons.length ? v.reasons.join('; ') : `(${v.sourceKind ?? 'no source'})`}`;
      (acc.starving[key] ??= []).push(day);
    }
  }

  function play(label, setup, pending, opts = {}) {
    applyData(pending);
    const t0 = Date.now();
    const w = createWorld(setup);
    const hf = getRegionHeightfield(w);
    const pid = w.playerFactionId;
    const months = [];
    const events = [];
    const incidents = [];
    const starving = {};
    const roadRule = { edgeDays: 0, edgeFactionDays: 0, mismatches: 0 };
    const readability = { cutOff: {}, starving: {} };
    const startOwned = Object.values(w.settlements).filter((s) => s.ownerFactionId === pid).map((s) => s.id);
    let cur = null;
    const startMonth = () => {
      cur = { month: months.length + 1, calendar: `${w.calendar.year}/${w.calendar.month + 1}`, reserveDays: {}, unrest: {}, stage: {} };
    };
    startMonth();
    const out = [];
    for (let h = 0; h < DAYS * 24 && w.victory.status === 'ongoing'; h++) {
      out.length = 0;
      tickWorld(w, [], out, hf);
      for (const inst of w.events.pending.slice()) {
        if (inst.scope.factionId !== pid) continue;
        const def = getEventDef(inst.defId);
        if (!def || !def.choices[0]) continue;
        // Placeholders ({settlement}, ...) filled the way the event modal shows them.
        const text = eventsMod.formatEventText(w, inst);
        tickWorld(w, [issued(w, { kind: 'event_choice', eventInstanceId: inst.id, choiceId: def.choices[0].id })], out, hf);
        events.push({ day: Math.floor(w.calendar.totalHours / 24), id: def.id, title: text.title, choice: text.choices[0]?.label ?? def.choices[0].label });
      }
      for (const eng of Object.values(w.engagements)) {
        if (eng.status === 'pending_player') tickWorld(w, [issued(w, { kind: 'engagement_decision', engagementId: eng.id, decision: 'autoresolve' })], out, hf);
      }
      const day = Math.floor(w.calendar.totalHours / 24);
      for (const e of out) {
        if (e.kind === 'rebels_spawned') incidents.push({ day, kind: 'revolt', text: `${w.settlements[e.settlementId]?.name}: ${e.soldiers} rebels` });
        if (e.kind === 'secession') incidents.push({ day, kind: 'secession', text: `${w.settlements[e.settlementId]?.name} left ${e.from}` });
        if (e.kind === 'settlement_captured') incidents.push({ day, kind: 'capture', text: `${w.settlements[e.settlementId]?.name}: ${e.from ?? 'free'} -> ${e.to}` });
        if (e.kind === 'war_declared') incidents.push({ day, kind: 'war', text: `${e.a} declared war on ${e.b}` });
        if (e.kind === 'peace_made') incidents.push({ day, kind: 'peace', text: `${e.a} and ${e.b} made peace` });
        if (e.kind === 'succession') incidents.push({ day, kind: 'succession', text: `${e.factionId}: ${w.characters[e.newRulerId]?.name}${e.crisis ? ' (crisis)' : ''}` });
        if (e.kind === 'monsoon_roll') incidents.push({ day, kind: 'monsoon', text: `M = ${e.strength.toFixed(2)} (${e.result})` });
      }
      if (w.calendar.hour === 0) {
        for (const s of Object.values(w.settlements)) if (s.starvationDays > 0) starving[s.id] = (starving[s.id] ?? 0) + 1;
        if (opts.roads) roadRuleDay(w, roadRule);
        if (opts.readability) readabilityDay(w, pid, day, readability);
      }
      for (const s of Object.values(w.settlements)) {
        if (s.ownerFactionId !== pid) continue;
        const rd = econMod.reserveDays(s);
        cur.reserveDays[s.id] = Math.min(cur.reserveDays[s.id] ?? Infinity, Number.isFinite(rd) ? rd : 999);
        cur.unrest[s.id] = Math.max(cur.unrest[s.id] ?? 0, s.unrest);
        const order = ['calm', 'grumbling', 'protest', 'tax_refusal', 'unrest', 'revolt', 'secession'];
        if (order.indexOf(s.rebellionStage) > order.indexOf(cur.stage[s.id] ?? 'calm')) cur.stage[s.id] = s.rebellionStage;
      }
      if (out.some((e) => e.kind === 'new_month')) {
        const f = w.factions[pid];
        cur.ledger = { ...f.ledger };
        cur.treasury = f.treasury;
        cur.foodReserve = f.foodReserve;
        cur.stability = f.stability;
        cur.legitimacy = f.legitimacy;
        cur.settlements = Object.values(w.settlements).filter((s) => s.ownerFactionId === pid).length;
        cur.soldiers = Object.values(w.armies).filter((a) => a.factionId === pid).reduce((n, a) => n + a.units.reduce((m, u) => m + u.soldiers, 0), 0);
        months.push(cur);
        startMonth();
      }
    }
    const battles = w.battleHistory.map((b) => ({
      day: b.day,
      chronicle: b.chronicle,
      winner: b.winner === null ? null : b.sides[b.winner].factionId,
      killed: b.sides[0].killed + b.sides[1].killed,
    }));
    const score = statsMod.computeScore(w, pid).total;
    const result = {
      label,
      pendingData: pending,
      seed: setup.seed ?? setup.sandbox?.seed,
      outcome: { status: w.victory.status, outcomeId: w.victory.outcomeId, day: w.victory.endedDay ?? Math.floor(w.calendar.totalHours / 24) },
      score,
      final: Object.fromEntries(Object.values(w.factions).map((f) => [f.id, { alive: f.alive, treasury: Math.round(f.treasury), settlements: Object.values(w.settlements).filter((s) => s.ownerFactionId === f.id).map((s) => s.id) }])),
      months,
      battles,
      events,
      incidents,
      statistics: w.statistics[pid] ?? {},
      player: pid,
      startOwned,
      starving,
      court: Object.values(w.characters).filter((c) => c.factionId === pid && c.alive).length,
      roadRule: opts.roads ? roadRule : null,
      readability: opts.readability ? readability : null,
      seconds: (Date.now() - t0) / 1000,
    };
    applyData(false);
    return result;
  }

  /** Annual civilian grain balance per realm (the calibration test's measurement). */
  function calibrate(m, pending) {
    applyData(pending);
    const w = createWorld({ kind: 'sandbox', sandbox: { ...defaultSandbox(11), startMonth: 3 } });
    w.armies = {};
    w.events.scheduled = [];
    w.events.pending = [];
    const adv = { newDay: false, newMonth: false, newYear: false, seasonChanged: false };
    const out = [];
    const cons = {};
    for (let d = 0; d < 360; d++) {
      seasonsMod.advanceCalendar(w.calendar, 24, adv);
      w.monsoon.strength = m;
      for (const s of Object.values(w.settlements)) {
        const o = s.ownerFactionId ?? 'independent';
        cons[o] = (cons[o] ?? 0) + s.population * 0.1;
      }
      out.length = 0;
      econMod.updateEconomyDaily(w, out);
    }
    const res = {};
    for (const k of Object.keys(w.factions)) res[k] = (w.statistics[k]?.grain_harvested ?? 0) / cons[k] - 1;
    applyData(false);
    return res;
  }

  const sets = pendingDiffers ? [false, true] : [false];
  const bc = (seed) => ({ kind: 'scenario', scenarioId: 'broken_crown', seed, difficulty: 'normal' });
  const runs = [];
  for (const pending of sets) {
    runs.push(play(`The Broken Crown - ${dataLabel(pending)}`, bc(1), pending, { readability: true }));
    runs.push(play(`The Seven Hills - ${dataLabel(pending)}`, { kind: 'scenario', scenarioId: 'seven_hills', seed: 1, difficulty: 'normal' }, pending, { readability: true }));
    runs.push(play(`Sandbox (default, Suvarna) - ${dataLabel(pending)}`, { kind: 'sandbox', sandbox: defaultSandbox(1) }, pending, { readability: true }));
  }
  /** The Broken Crown seeds 1-6, outcome only (the campaign test's 6/6 'mixed'). */
  const brokenCrownSeeds = {};
  for (const pending of sets) {
    brokenCrownSeeds[pending ? 'requested' : 'current'] = [1, 2, 3, 4, 5, 6].map((seed) => {
      const r = play(`bc${seed}`, bc(seed), pending, { roads: true });
      return { seed, outcome: r.outcome, rajapura: r.final.heartland?.settlements.includes('rajapura') ?? false, roadRule: r.roadRule };
    });
  }
  /** A passive sandbox player as each realm (seed 1): outcome and starving days of the starting settlements. */
  const REALMS = ['heartland', 'highland', 'forest', 'frontier'];
  const passive = {};
  for (const pending of sets) {
    passive[pending ? 'requested' : 'current'] = REALMS.map((pid) => {
      const r = play(`passive ${pid}`, { kind: 'sandbox', sandbox: { ...defaultSandbox(1), playerFactionId: pid, rivalFactionIds: REALMS.filter((x) => x !== pid) } }, pending);
      const own = Object.fromEntries(r.startOwned.map((id) => [id, r.starving[id] ?? 0]));
      return { realm: pid, outcome: r.outcome, end: r.final[pid]?.settlements ?? [], starving: own, starvingAll: r.starving, court: r.court };
    });
  }
  /**
   * Review S1: Suvarna's engineer formation besieging an uncontested Giridurg (every Giridurga field army removed), fed
   * by a 6,000-grain depot 70 m from the camp, in the real tick; also with the 0.4%/day siege attrition switched off.
   */
  function fedSiege(seed, attrition) {
    const att = RULES.supply.attrition;
    const keep = att.siege;
    if (!attrition) att.siege = 0;
    try {
      const w = createWorld(bc(seed));
      const hf = getRegionHeightfield(w);
      const g = w.settlements.giridurg;
      for (const a of Object.values(w.armies)) if (a.factionId === 'highland') delete w.armies[a.id];
      const a = armiesMod.makeArmy(w, 'army_eng', 'Engineers', 'heartland', g.x + g.radius + 100, g.z, [{ unitClass: 'engineers', formations: 1 }], null);
      w.armies[a.id] = a;
      a.order = { kind: 'besiege', settlementId: 'giridurg' };
      siegeMod.beginSiege(w, a, g, [], hf);
      w.depots.depot_siege = { id: 'depot_siege', factionId: 'heartland', x: a.x + 70, z: a.z, settlementId: null, food: 6000, capacity: 6000, condition: 1, escortArmyId: null, raided: false, readyOnDay: 0 };
      const out = [];
      let day = 0;
      let starved = 0;
      while (g.wallHp > 0 && day < 150) {
        for (let h = 0; h < 24; h++) {
          out.length = 0;
          tickWorld(w, [], out, hf);
          for (const inst of w.events.pending.slice()) {
            if (inst.scope.factionId !== w.playerFactionId) continue;
            const def = getEventDef(inst.defId);
            if (def?.choices[0]) tickWorld(w, [issued(w, { kind: 'event_choice', eventInstanceId: inst.id, choiceId: def.choices[0].id })], out, hf);
          }
        }
        day++;
        if (a.supply.starvationDays > 0) starved++;
      }
      return { seed, days: day, soldiers: a.units.reduce((n, u) => n + u.soldiers, 0), starvedDays: starved, depotLeft: Math.round(w.depots.depot_siege.food), source: a.supply.sourceId };
    } finally {
      att.siege = keep;
    }
  }
  const sieges = { attrition: [1, 2, 3, 4, 5, 6].map((seed) => fedSiege(seed, true)), noAttrition: [1, 2, 3, 4, 5, 6].map((seed) => fedSiege(seed, false)) };

  const calibration = { current: { normal: calibrate(1, false), drought: calibrate(0.7, false) } };
  if (pendingDiffers) calibration.requested = { normal: calibrate(1, true), drought: calibrate(0.7, true) };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'campaign-report.json'), JSON.stringify({ generatedBy: 'scripts/sim/campaign-report.mjs', days: DAYS, shipped: { ...shipped, ...original }, requested: pendingDiffers ? REQUESTED : null, calibration, brokenCrownSeeds, passive, sieges, runs }, null, 1));

  // ---------------------------------------------------------------------------------------------------- SVG charts
  const COLORS = ['#b5532a', '#2f6f8f', '#6b8e23', '#8e5ba8', '#c99a2e', '#4a4a4a', '#b03060', '#2e8b57'];
  function lineChart(title, run, key, yMax, yLabel, guide) {
    const W = 760;
    const H = 300;
    const L = 52;
    const B = 34;
    const T = 30;
    const ids = [...new Set(run.months.flatMap((m) => Object.keys(m[key])))].sort();
    const n = Math.max(1, run.months.length - 1);
    const x = (i) => L + ((W - L - 16) * i) / n;
    const y = (v) => T + (H - T - B) * (1 - Math.min(yMax, Math.max(0, v)) / yMax);
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="sans-serif" font-size="11">`;
    svg += `<rect width="${W}" height="${H}" fill="#fbf7ef"/><text x="${L}" y="18" font-size="13" font-weight="bold">${title}</text>`;
    for (let k = 0; k <= 4; k++) {
      const v = (yMax * k) / 4;
      svg += `<line x1="${L}" x2="${W - 16}" y1="${y(v)}" y2="${y(v)}" stroke="#ddd"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v * 100) / 100}</text>`;
    }
    if (guide !== undefined) svg += `<line x1="${L}" x2="${W - 16}" y1="${y(guide)}" y2="${y(guide)}" stroke="#c00" stroke-dasharray="4 3"/>`;
    run.months.forEach((m, i) => {
      if (i % 3 === 0) svg += `<text x="${x(i)}" y="${H - B + 16}" text-anchor="middle">${m.month}</text>`;
    });
    svg += `<text x="${(W + L) / 2}" y="${H - 4}" text-anchor="middle">month</text><text x="14" y="${(T + H - B) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(T + H - B) / 2})">${yLabel}</text>`;
    ids.forEach((id, k) => {
      const pts = run.months.map((m, i) => (m[key][id] === undefined ? null : `${x(i).toFixed(1)},${y(m[key][id]).toFixed(1)}`)).filter(Boolean);
      if (pts.length > 1) svg += `<polyline fill="none" stroke="${COLORS[k % COLORS.length]}" stroke-width="2" points="${pts.join(' ')}"/>`;
      svg += `<rect x="${L + 8 + k * 92}" y="${T + 2}" width="10" height="10" fill="${COLORS[k % COLORS.length]}"/><text x="${L + 22 + k * 92}" y="${T + 11}">${id}</text>`;
    });
    return svg + '</svg>';
  }
  const bcCurrent = runs[0];
  const bcRequested = pendingDiffers ? runs[3] : null;
  writeFileSync(resolve(OUT, 'campaign-reserve-days.svg'), lineChart(`The Broken Crown (${dataLabel(false)}): lowest reserve days per month`, bcCurrent, 'reserveDays', 210, 'days', 30));
  writeFileSync(resolve(OUT, 'campaign-unrest.svg'), lineChart(`The Broken Crown (${dataLabel(false)}): highest unrest per month`, bcCurrent, 'unrest', 1, 'unrest', 0.75));
  if (bcRequested) writeFileSync(resolve(OUT, 'campaign-reserve-days-requested-data.svg'), lineChart(`The Broken Crown (${dataLabel(true)}): lowest reserve days per month`, bcRequested, 'reserveDays', 210, 'days', 30));

  // ---------------------------------------------------------------------------------------------------- Markdown
  const pct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
  const r0 = (v) => (v === undefined || v === null ? '' : Math.round(v).toLocaleString('en-US'));
  let md = `# SIM-01 campaign report (540 days)\n\nGenerated by \`node scripts/sim/campaign-report.mjs\` (headless, the real simulation; every player event answered with its first - safe default - choice, every engagement autoresolved, no other player input). Raw data: \`campaign-report.json\`.\n\n`;
  md += `Data as shipped: ${Object.entries({ ...shipped, ...original }).map(([k, v]) => `\`RULES.${k}\` ${v}`).join(', ')} (CD-1, CD-2, CD-5, CD-6 and CD-8 are applied). ${pendingDiffers ? `Requested data: ${Object.entries(REQUESTED).map(([k, v]) => `\`RULES.${k}\` ${v}`).join(', ')} (see "Data requests").` : 'No data change is pending (CD-9 asks for a rule decision, not a value).'}\n\n`;
  md += `## Outcomes\n\n| Run | Outcome | Day | Score | Player settlements at the end | Battles | Revolts | Secessions | Real seconds |\n|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of runs) {
    md += `| ${r.label} | ${r.outcome.status} (${r.outcome.outcomeId ?? '-'}) | ${r.outcome.day} | ${r.score} | ${r.final[r.player]?.settlements.join(', ') || '-'} | ${r.battles.length} | ${r.incidents.filter((i) => i.kind === 'revolt').length} | ${r.incidents.filter((i) => i.kind === 'secession').length} | ${r.seconds.toFixed(1)} |\n`;
  }
  const seedLine = (list) => list.map((x) => `seed ${x.seed}: ${x.outcome.status} (${x.outcome.outcomeId ?? '-'}) day ${x.outcome.day}${x.rajapura ? '' : ', Rajapura lost'}`).join('; ');
  md += `\n### The Broken Crown, seeds 1-6 (every event auto-resolved)\n\n`;
  for (const [k, list] of Object.entries(brokenCrownSeeds)) md += `- ${dataLabel(k === 'requested')}: ${list.filter((x) => x.outcome.outcomeId === 'out_restored' || x.outcome.outcomeId === 'out_iron').length}/6 mixed - ${seedLine(list)}\n`;
  md += `\n### A passive sandbox player as each realm (seed 1, normal monsoon, no input; review B2)\n\nStarving days = days with an empty store over the 540 days, whoever held the settlement, for each settlement the realm owned at the start (a seceded town keeps counting). Living court = the realm's living characters at the end (review B4: ruler, spouse, heir, general).\n\n| Data | Realm | Outcome | Day | Settlements at the end | Starving days (settlements owned at the start) | Living court |\n|---|---|---|---|---|---|---|\n`;
  for (const [k, list] of Object.entries(passive)) {
    for (const p of list) md += `| ${k === 'requested' ? 'requested' : 'shipped'} | ${p.realm} | ${p.outcome.status} (${p.outcome.outcomeId ?? '-'}) | ${p.outcome.day} | ${p.end.join(', ') || '-'} | ${Object.entries(p.starving).map(([id, d]) => `${id} ${d}`).join(', ')} | ${p.court} |\n`;
  }
  md += `\n## Siege logistics in the real tick (review S1)\n\nSuvarna's engineer formation (40 men, siegeStrength 1.1) besieging an uncontested Giridurg (4,200 wall HP), fed by a 6,000-grain depot 70 m from the camp; every event auto-resolved. Walls down = wallHp 0.\n\n| Seed | Walls down (day) | x1.1 (siegeStrength 1) | Engineers left | Starving days | Depot left | Source on the last day | Without siege attrition: walls down |\n|---|---|---|---|---|---|---|---|\n`;
  sieges.attrition.forEach((r, i) => {
    const n = sieges.noAttrition[i];
    md += `| ${r.seed} | ${r.days} | ${(r.days * 1.1).toFixed(1)} | ${r.soldiers} | ${r.starvedDays} | ${r.depotLeft} | ${r.source} | ${n.days} (${n.soldiers} men) |\n`;
  });
  md += `\nBefore this round besiegers never resupplied: the reviewer measured 40 -> 18 men by day 35 and the formation gone on day 99 with the walls at 777; the same probe on the old code (seed 5) gave 21 men on day 35 and 3 men on day 100 with the walls at 392. A host garrisoned in a besieged town now eats from its store with no floor: tests/sim/strategic/siege.test.ts (the Host of the Seven Peaks keeps 732 men for 30 days while Giridurg's store falls by its 151/day need).\n`;
  md += `\n## Road blocks: the per-faction rule against the old first-by-id answer (review S3)\n\nEach day of The Broken Crown seeds 1-6 (shipped data): edge-days where the old answer (only the first stationary army by id counted) would differ from the §7.7 rule for at least one realm (edge-faction days in brackets), and the days where \`network.blockedFor\` differs from the rule.\n\n| Seed | Edge-days the old answer got wrong | blockedFor vs rule |\n|---|---|---|\n`;
  for (const x of brokenCrownSeeds.current) md += `| ${x.seed} | ${x.roadRule.edgeDays} (${x.roadRule.edgeFactionDays}) | ${x.roadRule.mismatches} |\n`;
  md += `\n## Supply readability: what the selectors tell the player (review S4)\n\nFrom \`settlementVitals\` (cutOff, cutOffBy, cutOffReasons) and \`armySupplyView\` (sourceKind, reasons) each day of the main runs: own towns cut off from the capital, and own armies on their starving days, with the reasons shown. Day ranges are merged.\n\n`;
  const ranges = (days) => {
    const out = [];
    for (const d of days) {
      const last = out[out.length - 1];
      if (last && d === last[1] + 1) last[1] = d;
      else out.push([d, d]);
    }
    return out.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ');
  };
  for (const r of runs) {
    if (!r.readability) continue;
    md += `### ${r.label}\n\n`;
    const cut = Object.entries(r.readability.cutOff);
    const st = Object.entries(r.readability.starving);
    md += cut.length ? cut.map(([k, d]) => `- cut off - ${k}: days ${ranges(d)}`).join('\n') + '\n' : '- no own town cut off\n';
    md += st.length ? st.map(([k, d]) => `- starving - ${k}: days ${ranges(d)}`).join('\n') + '\n' : '- no own army starved\n';
    md += '\n';
  }
  md += `\n## DESIGN_SPEC §13.2 grain calibration (annual civilian balance, measured with the daily economy)\n\n| Realm | Target (normal) | ${dataLabel(false)}, M = 1 | M = 0.7 |${calibration.requested ? ` ${dataLabel(true)}, M = 1 | M = 0.7 |` : ''}\n|---|---|---|---|${calibration.requested ? '---|---|' : ''}\n`;
  const targets = { heartland: '+15%', highland: '-9%', forest: '+3%', frontier: '-8%' };
  for (const k of Object.keys(calibration.current.normal)) {
    md += `| ${k} | ${targets[k] ?? '-'} | ${pct(calibration.current.normal[k])} | ${pct(calibration.current.drought[k])} |${calibration.requested ? ` ${pct(calibration.requested.normal[k])} | ${pct(calibration.requested.drought[k])} |` : ''}\n`;
  }
  const summarizePassive = (key) => (passive[key] ?? []).map((p) => `${p.realm} ${p.outcome.status === 'defeat' ? `lost day ${p.outcome.day}` : 'holds'}`).join(', ');
  const fill = (t) =>
    t
      .replace('{passiveSummary}', pendingDiffers ? `shipped: ${summarizePassive('current')}; requested: ${summarizePassive('requested')}` : summarizePassive('current'))
      .replace('{bcSummary}', Object.entries(brokenCrownSeeds).map(([k, list]) => `${k === 'requested' ? 'requested' : 'shipped'} ${list.filter((x) => x.outcome.outcomeId === 'out_restored' || x.outcome.outcomeId === 'out_iron').length}/6 mixed`).join(', '))
      .replace('{siegeDays}', sieges.attrition.map((r) => r.days).join(', ') + ' days')
      .replace('{siegeNorm}', sieges.attrition.map((r) => (r.days * 1.1).toFixed(1)).join(', '))
      .replace('{siegeNoAttrition}', [...new Set(sieges.noAttrition.map((r) => r.days))].join(' / '))
      .replace('{frontierPassive}', (() => {
        const p = (passive.requested ?? passive.current).find((x) => x.realm === 'frontier');
        return p ? `${p.outcome.status === 'defeat' ? `realm lost on day ${p.outcome.day}` : 'it holds'}; ${Object.entries(p.starving).map(([id, d]) => `${id} ${d}`).join(', ')} starving days` : '';
      })());
  md += `\n## Data requests (Creative Director, \`src/data/**\` and DESIGN_SPEC)\n\nOpen:\n\n${DATA_REQUESTS.map((t, i) => `${i + 1}. ${fill(t)}`).join('\n')}\n\nDecided (DESIGN_SPEC §14.4):\n\n${DECIDED.map((t) => `- ${fill(t)}`).join('\n')}\n\nApplied:\n\n${APPLIED.map((t) => `- ${fill(t)}`).join('\n')}\n\n## Contract requests (CTO)\n\n${CTO_REQUESTS.map((t) => `- ${t}`).join('\n')}\n`;
  for (const r of runs) {
    md += `\n## ${r.label}\n\n### Monthly ledger (player)\n\n| Month | Date | Tax | Trade | Tribute | Army | Buildings | Admin | Net | Treasury | Royal reserve | Stability | Legitimacy | Settlements | Soldiers |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
    for (const m of r.months) {
      const l = m.ledger ?? {};
      md += `| ${m.month} | ${m.calendar} | ${r0(l.taxIncome)} | ${r0(l.tradeIncome)} | ${r0(l.tribute)} | ${r0(l.armyUpkeep)} | ${r0(l.buildingUpkeep)} | ${r0(l.administration)} | ${r0(l.net)} | ${r0(m.treasury)} | ${r0(m.foodReserve)} | ${(m.stability ?? 0).toFixed(2)} | ${(m.legitimacy ?? 0).toFixed(2)} | ${m.settlements} | ${r0(m.soldiers)} |\n`;
    }
    const ids = [...new Set(r.months.flatMap((m) => Object.keys(m.reserveDays)))].sort();
    md += `\n### Lowest reserve days in the month / highest unrest / worst stage\n\n| Month | ${ids.join(' | ')} |\n|---|${ids.map(() => '---').join('|')}|\n`;
    for (const m of r.months) md += `| ${m.month} | ${ids.map((id) => (m.reserveDays[id] === undefined ? '-' : `${Math.round(m.reserveDays[id])} d / ${m.unrest[id].toFixed(2)}${m.stage[id] && m.stage[id] !== 'calm' ? ` ${m.stage[id]}` : ''}`)).join(' | ')} |\n`;
    md += `\n### Battles (${r.battles.length})\n\n`;
    for (const b of r.battles) md += `- day ${b.day}: ${b.chronicle}\n`;
    if (r.battles.length === 0) md += '- none\n';
    md += `\n### Incidents\n\n`;
    for (const i of r.incidents) md += `- day ${i.day} - ${i.kind}: ${i.text}\n`;
    if (r.incidents.length === 0) md += '- none\n';
    md += `\n### Player events (${r.events.length}, first choice taken)\n\n`;
    for (const e of r.events) md += `- day ${e.day}: ${e.title} -> ${e.choice}\n`;
    md += `\n### Statistics\n\n${Object.entries(r.statistics).filter(([k]) => !k.startsWith('mtd_')).map(([k, v]) => `\`${k}\` ${Math.round(v)}`).join(' · ')}\n`;
  }
  md += `\n## Charts\n\n![reserve days](campaign-reserve-days.svg)\n\n![unrest](campaign-unrest.svg)\n${bcRequested ? '\n![reserve days, requested data](campaign-reserve-days-requested-data.svg)\n' : ''}`;
  writeFileSync(resolve(OUT, 'campaign-report.md'), md);
  console.log(`campaign report -> ${OUT}`);
  for (const r of runs) console.log(`  ${r.label}: ${r.outcome.status} ${r.outcome.outcomeId ?? ''} day ${r.outcome.day}, ${r.battles.length} battles, ${r.seconds.toFixed(1)} s`);
} finally {
  await server.close();
}
