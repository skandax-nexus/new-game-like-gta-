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
 */
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(ROOT, process.env.REPORT_OUT || 'docs/sprint1/sim-01');
const DAYS = 540;

/**
 * Data change still pending at the Creative Director (review B2: RULES.storage.baseDays 90 -> 120). The tests read
 * RULES, so it lands without a code change; once src/data/rules.ts carries it the "requested" runs are skipped.
 */
const REQUESTED = { 'storage.baseDays': 120 };

/** Data requests already applied by the Creative Director (ba45410). */
const APPLIED = [
  '**CD-1** `RULES.population.laborHealthWeight` 0.5 -> 0 (applied in ba45410).',
  '**CD-2** `RULES.distribution.exportAboveDays` 120 -> 75 (applied in ba45410).',
  '**CD-5** `RULES.politics.offers.autonomy.taxShare` -0.25 -> -0.125, informational; the sim applies the §7.5 formula (applied in ba45410).',
  '**CD-6** `RULES.roads.repairWealthPerKm` and `RULES.politics.governor.loyaltyDrift` (applied in ba45410); the sim now reads them (commands.roadRepairCost, politics.governorLoyaltyTarget) instead of in-code constants.',
];

/** Open data requests to the Creative Director; {...} placeholders are filled with the measurements of this run. */
const DATA_REQUESTS = [
  '**CD-8** `RULES.storage.baseDays` 90 -> **120** (the Creative Director\'s own review item B2; tests/sim/strategic/economy.test.ts now reads the value). A balanced settlement needs ~126 days of storage to hold its kharif (35% of the year) and carry the lean months to the next one; at 90 every settlement without a granary spills grain at harvest and starves before the next. Measured below: passive sandbox player per realm ({passiveSummary}); The Broken Crown seeds 1-6 ({bcSummary}); the §13.2 calibration does not move (it measures annual production).',
  '**CD-3** Deficit realms (Giridurga -9%, Marudesha -8% by design) still starve every lean season unless someone buys or rations grain, and the flat +0.02/day starvation unrest walks them from famine to revolt to secession in ~45 days: with CD-8 a passive Marudesha player still loses the realm ({frontierPassive}). Please consider scaling that term by the unmet share of need (0.02 x deficit share) or raising their fertility; SIM-02 (campaign AI) is the other half - AI realms must use the market and the rationing rule. A deficit town that secedes never recovers: §7.3.1 production is linear in farm labor, so famine deaths shrink production as fast as need (Giridurg as a free town starved 150 days running in the passive Giridurga run); a rule for free towns in famine (shift labor to farming, or land-limited yields) would let them settle.',
  '**CD-4** Landmark rules are keyed by landmark id in code (Royal Granary spoilage x0.5, Cliff Cistern besieged consumption x0.6, Elephant Grove elephant recruit time x0.7, Great Road royal-road speed); please add `LandmarkDef` fields (`spoilageFactor`, `besiegedConsumption`, `recruitTime: { war_elephants: 0.7 }`, `roadSpeed`).',
  '**CD-7** Restate the DESIGN_SPEC worked examples with the real map and modifiers: Rajapura -> Giridurg is 114 km of road (4.3 days; the example assumed 81 km), 9.2 days across country (terrain + the river crossing); the Royal Host eats 195 grain/day and carries 23.5 days (27 with Suvarna supplyEfficiency 1.15); Giridurg (4,200 wall HP) falls in 52.5 days to one engineer formation at siegeStrength 1 (48 for Suvarna, 1.1); the Palace takes 144 days at constructionSpeed 1 (131 for Suvarna).',
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
  const dataLabel = (pending) => (pending ? `requested data (${Object.entries(REQUESTED).map(([k, v]) => `${k} ${v}`).join(', ')})` : `data as shipped (${Object.entries(original).map(([k, v]) => `${k} ${v}`).join(', ')})`);

  const issued = (w, cmd) => ({ factionId: w.playerFactionId, hour: w.calendar.totalHours, cmd });

  function play(label, setup, pending) {
    applyData(pending);
    const t0 = Date.now();
    const w = createWorld(setup);
    const hf = getRegionHeightfield(w);
    const pid = w.playerFactionId;
    const months = [];
    const events = [];
    const incidents = [];
    const starving = {};
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
      if (w.calendar.hour === 0) for (const s of Object.values(w.settlements)) if (s.starvationDays > 0) starving[s.id] = (starving[s.id] ?? 0) + 1;
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
    runs.push(play(`The Broken Crown - ${dataLabel(pending)}`, bc(1), pending));
    runs.push(play(`The Seven Hills - ${dataLabel(pending)}`, { kind: 'scenario', scenarioId: 'seven_hills', seed: 1, difficulty: 'normal' }, pending));
    runs.push(play(`Sandbox (default, Suvarna) - ${dataLabel(pending)}`, { kind: 'sandbox', sandbox: defaultSandbox(1) }, pending));
  }
  /** The Broken Crown seeds 1-6, outcome only (the campaign test's 6/6 'mixed'). */
  const brokenCrownSeeds = {};
  for (const pending of sets) {
    brokenCrownSeeds[pending ? 'requested' : 'current'] = [1, 2, 3, 4, 5, 6].map((seed) => {
      const r = play(`bc${seed}`, bc(seed), pending);
      return { seed, outcome: r.outcome, rajapura: r.final.heartland?.settlements.includes('rajapura') ?? false };
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
  const calibration = { current: { normal: calibrate(1, false), drought: calibrate(0.7, false) } };
  if (pendingDiffers) calibration.requested = { normal: calibrate(1, true), drought: calibrate(0.7, true) };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'campaign-report.json'), JSON.stringify({ generatedBy: 'scripts/sim/campaign-report.mjs', days: DAYS, shipped: original, requested: pendingDiffers ? REQUESTED : null, calibration, brokenCrownSeeds, passive, runs }, null, 1));

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
  md += `Data as shipped: ${Object.entries(original).map(([k, v]) => `\`RULES.${k}\` ${v}`).join(', ')} (CD-1, CD-2, CD-5 and CD-6 are applied). ${pendingDiffers ? `Requested data: ${Object.entries(REQUESTED).map(([k, v]) => `\`RULES.${k}\` ${v}`).join(', ')} (CD-8, see "Data requests").` : 'No data request is pending.'}\n\n`;
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
      .replace('{frontierPassive}', (() => {
        const p = (passive.requested ?? passive.current).find((x) => x.realm === 'frontier');
        return p ? `${p.outcome.status === 'defeat' ? `realm lost on day ${p.outcome.day}` : 'it holds'}; ${Object.entries(p.starving).map(([id, d]) => `${id} ${d}`).join(', ')} starving days` : '';
      })());
  md += `\n## Data requests (Creative Director, \`src/data/**\`)\n\nOpen:\n\n${DATA_REQUESTS.map((t, i) => `${i + 1}. ${fill(t)}`).join('\n')}\n\nApplied:\n\n${APPLIED.map((t) => `- ${t}`).join('\n')}\n\n## Contract requests (CTO)\n\n${CTO_REQUESTS.map((t) => `- ${t}`).join('\n')}\n`;
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
