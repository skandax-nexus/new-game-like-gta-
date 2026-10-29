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
 *   - The Broken Crown, seed 1, with the current data and with the data changes requested from the Creative Director;
 *   - The Seven Hills, seed 1, and the default sandbox, seed 1 (with the requested data).
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

/** Data changes requested from the Creative Director (mirrors tests/sim/strategic/helpers.ts). */
const PENDING = { laborHealthWeight: 0, exportAboveDays: 75 };

/** The data requests this report backs (numbers in the tables above them). */
const DATA_REQUESTS = [
  '**CD-1** `RULES.population.laborHealthWeight` 0.5 -> **0**: the §13.2 bands were calibrated with labor = population x 0.45; health-weighted labor removes 10-18% of farm labor (calibration table, "current data" columns).',
  '**CD-2** `RULES.distribution.exportAboveDays` 120 -> **75**: grain villages hover at 40-170 reserve days, so at 120 they rarely export and Rajapura (break-even on its own fields) starves every lean season - The Broken Crown loses the capital with the current data and ends `out_restored` with CD-1 + CD-2 (Outcomes). Auto-resolved survival over seeds 1-10 with CD-1: 120 days -> 1/10, 90 -> 9/10, 75 -> 10/10, 60 -> 10/10; at 90 the result moves with tactical battle outcomes (a capital that empties days before the second rabi harvest revolts - CD-3), 75 leaves a margin.',
  '**CD-3** Deficit realms (Giridurga -9%, Marudesha -8% by design) revolt every lean season under the flat +0.02/day starvation unrest unless their AI buys or rations grain; consider scaling that term by the unmet share of need (0.02 x deficit share) or raising their fertility. Until SIM-02 manages grain, most AI settlements secede within the first year (Incidents).',
  '**CD-4** Landmark rules are keyed by landmark id in code (Royal Granary spoilage x0.5, Cliff Cistern besieged consumption x0.6, Elephant Grove elephant recruit time x0.7, Great Road royal-road speed); please add `LandmarkDef` fields (`spoilageFactor`, `besiegedConsumption`, `recruitTime: { war_elephants: 0.7 }`, `roadSpeed`).',
  '**CD-5** negotiate_rebels autonomy: `offers.autonomy.taxShare` -0.25 disagrees with the §7.5 tax formula (1 - 0.5 x autonomy, so +0.25 autonomy = -12.5% tax); the sim uses the formula - please pick one.',
  '**CD-6** Constants still in code, please move them to RULES: road repair 20 wealth per km per missing condition point (`commands.ROAD_REPAIR_WEALTH_PER_KM`); governor loyalty drifts 10%/month toward 0.5 + 0.15 (interest met) or - 0.1 (not met) - 0.2 x province unrest + 0.2 x (legitimacy - 0.5) (`politics.governorLoyaltyTarget`).',
  '**CD-7** Restate the DESIGN_SPEC worked examples with the real map and modifiers: Rajapura -> Giridurg is 114 km of road (4.3 days; the example assumed 81 km), 9.2 days across country (terrain + the river crossing); the Royal Host eats 195 grain/day and carries 23.5 days (27 with Suvarna supplyEfficiency 1.15); Giridurg (4,200 wall HP) falls in 52.5 days to one engineer formation at siegeStrength 1 (48 for Suvarna, 1.1); the Palace takes 144 days at constructionSpeed 1 (131 for Suvarna).',
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
  const { RULES } = await server.ssrLoadModule('/src/data/rules.ts');
  const { getEventDef } = await server.ssrLoadModule('/src/data/events.ts');
  const { defaultSandbox } = await server.ssrLoadModule('/src/data/campaign.ts');
  const { createWorld, getRegionHeightfield, tickWorld } = worldMod;

  const original = { laborHealthWeight: RULES.population.laborHealthWeight, exportAboveDays: RULES.distribution.exportAboveDays };
  const applyData = (pending) => {
    RULES.population.laborHealthWeight = pending ? PENDING.laborHealthWeight : original.laborHealthWeight;
    RULES.distribution.exportAboveDays = pending ? PENDING.exportAboveDays : original.exportAboveDays;
  };

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
        tickWorld(w, [issued(w, { kind: 'event_choice', eventInstanceId: inst.id, choiceId: def.choices[0].id })], out, hf);
        events.push({ day: Math.floor(w.calendar.totalHours / 24), id: def.id, title: def.title, choice: def.choices[0].label });
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

  const runs = [
    play('The Broken Crown - current data', { kind: 'scenario', scenarioId: 'broken_crown', seed: 1, difficulty: 'normal' }, false),
    play('The Broken Crown - requested data (CD-1, CD-2)', { kind: 'scenario', scenarioId: 'broken_crown', seed: 1, difficulty: 'normal' }, true),
    play('The Seven Hills - requested data', { kind: 'scenario', scenarioId: 'seven_hills', seed: 1, difficulty: 'normal' }, true),
    play('Sandbox (River of Kings) - requested data', { kind: 'sandbox', sandbox: defaultSandbox(1) }, true),
  ];
  const calibration = {
    current: { normal: calibrate(1, false), drought: calibrate(0.7, false) },
    requested: { normal: calibrate(1, true), drought: calibrate(0.7, true) },
  };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'campaign-report.json'), JSON.stringify({ generatedBy: 'scripts/sim/campaign-report.mjs', days: DAYS, pending: PENDING, calibration, runs }, null, 1));

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
    svg += `<text x="${(W + L) / 2}" y="${H - 4}" text-anchor="middle">month</text><text x="12" y="${T + 10}">${yLabel}</text>`;
    ids.forEach((id, k) => {
      const pts = run.months.map((m, i) => (m[key][id] === undefined ? null : `${x(i).toFixed(1)},${y(m[key][id]).toFixed(1)}`)).filter(Boolean);
      if (pts.length > 1) svg += `<polyline fill="none" stroke="${COLORS[k % COLORS.length]}" stroke-width="2" points="${pts.join(' ')}"/>`;
      svg += `<rect x="${L + 8 + k * 92}" y="${T + 2}" width="10" height="10" fill="${COLORS[k % COLORS.length]}"/><text x="${L + 22 + k * 92}" y="${T + 11}">${id}</text>`;
    });
    return svg + '</svg>';
  }
  const bc = runs[1];
  writeFileSync(resolve(OUT, 'campaign-reserve-days.svg'), lineChart('The Broken Crown (requested data): lowest reserve days per month', bc, 'reserveDays', 180, 'days', 30));
  writeFileSync(resolve(OUT, 'campaign-unrest.svg'), lineChart('The Broken Crown (requested data): highest unrest per month', bc, 'unrest', 1, 'unrest', 0.75));
  writeFileSync(resolve(OUT, 'campaign-reserve-days-current-data.svg'), lineChart('The Broken Crown (current data): lowest reserve days per month', runs[0], 'reserveDays', 180, 'days', 30));

  // ---------------------------------------------------------------------------------------------------- Markdown
  const pct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
  const r0 = (v) => (v === undefined || v === null ? '' : Math.round(v).toLocaleString('en-US'));
  let md = `# SIM-01 campaign report (540 days)\n\nGenerated by \`node scripts/sim/campaign-report.mjs\` (headless, the real simulation; every player event answered with its first - safe default - choice, every engagement autoresolved, no other player input). Raw data: \`campaign-report.json\`.\n\n`;
  md += `Requested data (the Creative Director's call, see "Data requests" below): CD-1 \`RULES.population.laborHealthWeight\` 0.5 -> ${PENDING.laborHealthWeight}; CD-2 \`RULES.distribution.exportAboveDays\` 120 -> ${PENDING.exportAboveDays}.\n\n`;
  md += `## Outcomes\n\n| Run | Outcome | Day | Score | Player settlements at the end | Battles | Revolts | Secessions | Real seconds |\n|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of runs) {
    const pidSettlements = Object.values(r.final).find((x) => x.settlements.length >= 0);
    void pidSettlements;
    const player = r.label.startsWith('The Seven') ? 'highland' : 'heartland';
    md += `| ${r.label} | ${r.outcome.status} (${r.outcome.outcomeId ?? '-'}) | ${r.outcome.day} | ${r.score} | ${r.final[player]?.settlements.join(', ') || '-'} | ${r.battles.length} | ${r.incidents.filter((i) => i.kind === 'revolt').length} | ${r.incidents.filter((i) => i.kind === 'secession').length} | ${r.seconds.toFixed(1)} |\n`;
  }
  md += `\n## DESIGN_SPEC §13.2 grain calibration (annual civilian balance, measured with the daily economy)\n\n| Realm | Target (normal) | Current data, M = 1 | Requested data, M = 1 | Current data, M = 0.7 | Requested data, M = 0.7 |\n|---|---|---|---|---|---|\n`;
  const targets = { heartland: '+15%', highland: '-9%', forest: '+3%', frontier: '-8%' };
  for (const k of Object.keys(calibration.current.normal)) {
    md += `| ${k} | ${targets[k] ?? '-'} | ${pct(calibration.current.normal[k])} | ${pct(calibration.requested.normal[k])} | ${pct(calibration.current.drought[k])} | ${pct(calibration.requested.drought[k])} |\n`;
  }
  md += `\n## Data requests (Creative Director, \`src/data/**\`)\n\n${DATA_REQUESTS.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n`;
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
  md += `\n## Charts\n\n![reserve days](campaign-reserve-days.svg)\n\n![unrest](campaign-unrest.svg)\n\n![reserve days, current data](campaign-reserve-days-current-data.svg)\n`;
  writeFileSync(resolve(OUT, 'campaign-report.md'), md);
  console.log(`campaign report -> ${OUT}`);
  for (const r of runs) console.log(`  ${r.label}: ${r.outcome.status} ${r.outcome.outcomeId ?? ''} day ${r.outcome.day}, ${r.battles.length} battles, ${r.seconds.toFixed(1)} s`);
} finally {
  await server.close();
}
