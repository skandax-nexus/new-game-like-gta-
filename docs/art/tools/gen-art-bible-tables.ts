/**
 * Regenerates the "@gen" tables of docs/ART_BIBLE.md from src/render/style (the code is canonical).
 * OWNER: Art Director. Run from the repo root:
 *   node_modules/.bin/esbuild docs/art/tools/gen-art-bible-tables.ts --bundle --platform=node --format=esm \
 *     --outfile=.asset-cache/gen-art-bible-tables.mjs && node .asset-cache/gen-art-bible-tables.mjs
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, writeFileSync } from 'node:fs';
import * as S from '../../../src/render/style/index';
import { FACTIONS } from '../../../src/data/factions';
const out: string[] = [];
const t = (h: string[], rows: (string | number)[][]) => { out.push('| ' + h.join(' | ') + ' |', '|' + h.map(() => '---').join('|') + '|', ...rows.map((r) => '| ' + r.join(' | ') + ' |'), ''); };
const sw = (h: string) => '`' + h + '`';
out.push('### LIGHTING');
const L = S.LIGHTING_PRESETS as any;
t(['Preset', 'Sun elev/az (deg)', 'Sun color', 'Sun int.', 'Softness (deg)', 'Sky HDRI', 'Sky irradiance', 'key:fill', 'Exposure'], S.LIGHTING_PRESET_IDS.map((id: string) => { const p = L[id]; return [`**${id}**`, `${p.sun.elevationDeg} / ${p.sun.azimuthDeg}`, sw(p.sun.color), p.sun.intensity, p.sun.softnessDeg, p.sky.hdri, p.sky.irradiance, p.keyFill, p.exposure]; }));
t(['Preset', 'Hemi sky / ground / int.', 'Fog color / inscatter', 'Fog density (1/m)', 'Height falloff (1/m)', 'Max opacity', 'Mist top m / density', 'Shafts'], S.LIGHTING_PRESET_IDS.map((id: string) => { const p = L[id]; return [`**${id}**`, `${sw(p.hemi.sky)} / ${sw(p.hemi.ground)} / ${p.hemi.intensity}`, `${sw(p.fog.color)} / ${sw(p.fog.inscatter)}`, p.fog.density, p.fog.heightFalloff, p.fog.maxOpacity, `${p.fog.mist.topM} / ${p.fog.mist.density}`, p.shafts.strength]; }));
t(['Preset', 'Bloom str / radius / thr (exposed)', 'AO int / radius m', 'Grade (contrast, sat, warmth, lift, vignette, tint)', 'LUT', 'Wetness', 'Practicals', 'Ambient FX (dust, mist, fireflies, leaves)'], S.LIGHTING_PRESET_IDS.map((id: string) => { const p = L[id]; const g = p.grade; return [`**${id}**`, `${p.bloom.strength} / ${p.bloom.radius} / ${p.bloom.threshold}`, `${p.ao.intensity} / ${p.ao.radiusM}`, `${g.contrast}, ${g.saturation}, ${g.warmth}, ${g.lift}, ${g.vignette}, [${g.tint.join(', ')}]`, p.lut ?? '-', p.wetness, p.practicals, `${p.ambientFx.dustMotes}, ${p.ambientFx.mist}, ${p.ambientFx.fireflies}, ${p.ambientFx.leaves}`]; }));
const N = (p: any) => `${p.sunElevationDeg}/${p.sunAzimuthDeg}, air ${p.air}, aerosol ${p.aerosol}, ozone ${p.ozone}, clouds ${p.clouds}`;
const P = (p: any) => `${p.turbidity} / ${p.rayleigh} / ${p.mieCoefficient} / ${p.mieDirectionalG}`;
t(['Preset', 'Nishita bake (elev/az, air, aerosol, ozone, clouds)', 'Preetham fallback (turbidity / rayleigh / mie / g)'], S.LIGHTING_PRESET_IDS.map((id: string) => [`**${id}**`, N(L[id].sky.nishita), P(L[id].sky.preetham)]));
out.push('### OVERLAYS');
const O = S.WEATHER_OVERLAYS as any;
t(['Overlay', 'Sun x', 'Softness', 'Sky irr. x', 'Fog color', 'Fog density x', 'Falloff', 'Exposure x', 'Grade', 'Wetness', 'Bloom x', 'Shafts x'], Object.keys(O).map((k) => { const o = O[k]; return [`**${k}**`, o.sunIntensityMul, o.sunSoftnessDeg, o.envIntensityMul, sw(o.fogColor), o.fogDensityMul, o.fogHeightFalloff, o.exposureMul, `c ${o.grade.contrast} s ${o.grade.saturation} w ${o.grade.warmth}`, o.wetness, o.bloomStrengthMul, o.shaftsMul]; }));
out.push('### MOODS');
const M = S.HERO_MOODS as any;
t(['Mood', 'Base', 'Hour', 'Overrides', 'DoF focus m / f-stop / max blur px', 'Notes'], Object.keys(M).map((k) => { const m = M[k]; return [`**${k}**`, m.base, m.hour, '`' + JSON.stringify(m.overrides).replace(/"/g, '').slice(0, 140) + '`', `${m.dof.focusM} / ${m.dof.fStop} / ${m.dof.maxBlurPx}`, m.notes]; }));
out.push('### ZOOM');
const Z = S.ZOOM_BANDS as any[];
t(['Band', 'Distance m', 'FOV / pitch', 'LOD bias', 'Detail normal / macro / parallax', 'Team boost / rim / outline px / banner x', 'Cards / footprint / tokens', 'Grass / tree impostor from m', 'Fog x / aerial / cloud shadows / shafts x'], Z.map((z) => [`**${z.id}**`, z.distanceM, `${z.camera.fovDeg} / ${z.camera.pitchDeg}`, z.lodBias, `${z.material.detailNormal} / ${z.material.macro} / ${z.material.parallax}`, `${z.readability.teamColorBoost} / ${z.readability.unitRim} / ${z.readability.outlinePx} / ${z.readability.bannerScale}`, `${z.readability.formationCards ? 'yes' : 'no'} / ${z.readability.footprintOpacity} / ${z.readability.tokens}`, `${z.vegetation.grassDensity} / ${z.vegetation.treeImpostorFromM}`, `${z.atmosphere.fogDensityScale} / ${z.atmosphere.aerialPerspective} / ${z.atmosphere.cloudShadows} / ${z.atmosphere.shaftsScale}`]));
t(['Band', 'AO x / radius m', 'Bloom x', 'DoF strength / f / max px', 'Vignette + / sat x / contrast x', 'Sharpen / grain / CA', 'Shadow dist m / split lambda / softness / contact'], Z.map((z) => [`**${z.id}**`, `${z.post.aoScale} / ${z.post.aoRadiusM}`, z.post.bloomScale, `${z.post.dof.strength} / ${z.post.dof.fStop} / ${z.post.dof.maxBlurPx}`, `${z.post.vignetteAdd} / ${z.post.saturationMul} / ${z.post.contrastMul}`, `${z.post.sharpen} / ${z.post.grain} / ${z.post.chromaticAberration}`, `${z.shadows.distanceM} / ${z.shadows.cascadeSplitLambda} / ${z.shadows.softnessScale} / ${z.shadows.contact ? 'yes' : 'no'}`]));
out.push('### FACTIONS');
const FA = S.FACTION_ART as any;
t(['Faction (id)', 'Team primary / secondary / accent', 'Cloth dye / 2nd', 'Garment base', 'Metal / trim', 'Banner', 'Architecture', 'Colorblind P / D / T'], Object.keys(FACTIONS).map((id) => { const f = FACTIONS[id]; const a = FA[f.archetype]; return [`**${f.name}** (${id})`, `${sw(f.colors.primary)} / ${sw(f.colors.secondary)} / ${sw(f.colors.accent)}`, `${sw(a.clothDye)} / ${sw(a.clothDyeSecondary)}`, sw(a.garmentBase), `${sw(a.metal)} / ${sw(a.trimMetal)}`, `${f.banner} on ${a.banner.shape}, ${a.banner.poleTop}${a.banner.tassels ? ', tassels' : ''}`, a.architecture, `${sw(a.colorblind.protan)} / ${sw(a.colorblind.deutan)} / ${sw(a.colorblind.tritan)}`]; }));
t(['Faction', 'Look', 'Silhouette signature (200 m)'], Object.keys(FACTIONS).map((id) => { const f = FACTIONS[id]; const a = FA[f.archetype]; return [`**${f.shortName ?? id}**`, a.look, a.signature]; }));
out.push('### STYLES');
const AS = S.ARCHITECTURE_STYLES as any;
t(['Style', 'Wall / wall2 / roof / trim / stone / wood / paint', 'Material sets', 'Signature pieces', 'Look'], Object.keys(AS).map((k) => { const a = AS[k]; return [`**${k}**`, [a.wall, a.wall2, a.roof, a.trim, a.stone, a.wood, a.paint].map(sw).join(' '), a.materials.join(', '), a.signature.join(', '), a.look]; }));
out.push('### MATERIALS');
const MP = S.MATERIAL_PRESETS as any;
t(['Preset', 'Asset id', 'Base color', 'Rough (range)', 'Metal', 'Normal', 'Porosity', 'Tile m', 'Extras', 'Notes'], Object.keys(MP).map((k) => { const m = MP[k]; const ex = [m.sheen ? `sheen ${m.sheen.intensity}` : '', m.subsurface ? `sss ${sw(m.subsurface.color)} ${m.subsurface.strength}` : '', m.clearcoat ? `clearcoat ${m.clearcoat.strength}/${m.clearcoat.roughness}` : ''].filter(Boolean).join(', '); return [`**${k}**`, m.assetId ?? '-', sw(m.baseColor), `${m.roughness} (${m.roughnessRange.join('-')})`, m.metalness, m.normalScale, m.porosity, m.tileMeters, ex || '-', m.notes]; }));
out.push('### TERRAIN');
const TL = S.TERRAIN_LAYERS as any;
t(['Layer', 'Asset id', 'Base color', 'Rough', 'Tile m', 'Height bias', 'Normal', 'Porosity', 'Triplanar', 'Notes'], Object.keys(TL).map((k) => { const l = TL[k]; return [`**${k}**`, l.assetId, sw(l.baseColor), l.roughness, l.tileMeters, l.heightBias, l.normalScale, l.porosity, l.triplanar ? 'yes' : '-', l.notes]; }));
out.push('### BIOMES');
const BT = S.BIOME_TERRAIN as any;
t(['Biome', 'Layers 0-3', 'Base weights', 'Rock slope', 'Bank slope', 'Macro m / str', 'Trees / shrubs / grass', 'Fallback color'], Object.keys(BT).map((k) => { const b = BT[k]; return [`**${k}**`, b.layers.join(', '), b.base.join(' / '), b.rockSlope.join('-'), b.bankSlope.join('-'), `${b.macro.wavelengthM} / ${b.macro.strength}`, `${b.vegetation.trees} / ${b.vegetation.shrubs} / ${b.vegetation.grass}`, sw(S.BIOME_COLORS[k])]; }));
out.push('### WATER');
const WP = S.WATER_PRESETS as any;
t(['Water', 'Deep / shallow / scatter', 'Absorption /m', 'Visibility m', 'Rough', 'Normals tile/str/speed', 'Flow m/s', 'Foam', 'Refl. strength / glint', 'Notes'], Object.keys(WP).map((k) => { const w = WP[k]; return [`**${k}**`, `${sw(w.deepColor)} ${sw(w.shallowColor)} ${sw(w.scatterColor)}`, w.absorption.join(', '), w.visibilityM, w.roughness, `${w.normal.tileM}+${w.normal.secondTileM} / ${w.normal.strength} / ${w.normal.speed}`, w.flowMps, `${w.foam.shoreWidthM} m, thr ${w.foam.flowThreshold}, cov ${w.foam.coverage}`, `${w.reflection.strength} / ${w.sunGlint}`, w.notes]; }));
out.push('### TREES');
const TS = S.TREE_SPECIES as any;
t(['Species', 'Zones', 'Height m', 'Crown m', 'Bark', 'Leaf vas/gri/var/sha/hem/shi', 'Foliage gri', 'Flowering', 'Wind trunk/branch/leaf (Hz)', 'Tris LOD0/1/2', 'Silhouette'], Object.keys(TS).map((k) => { const s = TS[k]; return [`**${s.label}** (*${s.botanical}*)`, s.zones.map((z: string) => z.split('_').map((w: string) => w[0]).join('').toUpperCase()).join(' '), s.heightM.join('-'), s.crownDiameterM.join('-'), sw(s.trunk.bark), ['vasanta', 'grishma', 'varsha', 'sharad', 'hemanta', 'shishira'].map((x) => sw(s.leaf[x])).join(' '), s.foliage.grishma, s.flowering ? `${s.flowering.seasons.join('+')} ${sw(s.flowering.color)} ${s.flowering.coverage}` : '-', `${s.wind.trunkAmp}@${s.wind.trunkFreqHz} / ${s.wind.branchAmp}@${s.wind.branchFreqHz} / ${s.wind.leafAmp}@${s.wind.leafHz}`, s.tris.join(' / '), s.silhouette]; }));
out.push('### CROPS');
const C = S.CROPS as any;
t(['Crop', 'Height m', 'Row m', 'vasanta', 'grishma', 'varsha', 'sharad', 'hemanta', 'shishira', 'Notes'], Object.keys(C).map((k) => { const c = C[k]; const st = (x: string) => `${sw(c.states[x].color)} ${c.states[x].growth}`; return [`**${c.label}**`, c.heightM, c.rowM, st('vasanta'), st('grishma'), st('varsha'), st('sharad'), st('hemanta'), st('shishira'), c.notes]; }));
const G = S.GROUND_PLANTS as any;
t(['Ground plant', 'Height m', 'Sharad color', 'Wind bend', 'Notes'], Object.keys(G).map((k) => { const g = G[k]; return [`**${g.label}** (*${g.botanical}*)`, g.heightM.join('-'), sw(g.color.sharad), g.windBend, g.notes]; }));

// ---- patch the markers in docs/ART_BIBLE.md
const secs = new Map<string, string[]>();
let cur = '';
for (const line of out) {
  const m = /^### ([A-Z]+)$/.exec(line);
  if (m) {
    cur = m[1]!;
    secs.set(cur, []);
    continue;
  }
  if (cur) secs.get(cur)!.push(line);
}
const file = 'docs/ART_BIBLE.md';
let doc = readFileSync(file, 'utf8');
doc = doc.replace(/<!-- @gen:([A-Z]+) begin[\s\S]*?<!-- @gen:\1 end -->/g, (_m, n: string) => `<!-- @gen:${n} -->`);
let count = 0;
doc = doc.replace(/<!-- @gen:([A-Z]+) -->/g, (_m, n: string) => {
  count++;
  const body = (secs.get(n) ?? [`(missing section ${n})`]).join('\n').replace(/^\n+|\n+$/g, '');
  return `<!-- @gen:${n} begin (generated from src/render/style; do not edit by hand) -->\n${body}\n<!-- @gen:${n} end -->`;
});
writeFileSync(file, doc);
console.log(`ART_BIBLE.md: ${count} generated tables refreshed`);
