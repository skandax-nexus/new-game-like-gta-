/**
 * Audio lab: `?scene=lab&lab=audio`. OWNER: Audio Developer (AUD-01).
 *
 * A listening room for the procedural audio: eight bronze-bell emitters on sandstone plinths in a ring
 * around the listener (the orbit camera is the listener - orbit to hear HRTF / equal-power panning and
 * air absorption), and a mixer panel: score moods + intensity, stingers, district and world ambience,
 * every SFX (positional at an emitter, UI sounds flat), a live log-frequency spectrum, stereo meters and
 * runtime stats (raga, tala, section, tempo, buffered score, voices, bank, main-thread ms).
 * The lab also attaches the app profiler to the AudioManager (system 'audio').
 *
 *   __SAMRAJYA__.call('audio.stats')                     AudioManager.stats()
 *   __SAMRAJYA__.call('audio.sfx', 'parry_ring', 3)      play at emitter 3 (or flat for UI kinds)
 *   __SAMRAJYA__.call('audio.mood', 'battle', 0.8)       __SAMRAJYA__.call('audio.stinger', 'age_up')
 *   __SAMRAJYA__.call('audio.district', 'd_temple')      __SAMRAJYA__.call('audio.env', 'monsoon')
 *   __SAMRAJYA__.call('audio.burst', 80)                 80 random positional SFX (voice cap / stealing)
 *   __SAMRAJYA__.call('audio.resume')                    resume the AudioContext
 */
import * as THREE from 'three';
import type { AppContext } from '../app/contracts';
import { DEBUG_UNHANDLED } from '../app/contracts';
import { AUDIO_MOODS, AUDIO_STINGERS, type AudioMood, type AudioStinger, SFX_KINDS, type SfxKind } from '../core/events';
import type { EnvironmentState, WeatherKind } from '../core/types';
import { HERO_DISTRICTS } from '../data/hero';
import { MATERIALS, METALS } from '../render/style/palette';
import type { LabHost, LabInstance, LabModule } from '../scenes/lab/types';
import { h, shield } from '../ui/dom';
import { SFX_META } from './sfx/meta';

const EMITTERS = 8;
const RING_R = 11;

type EnvPreset = 'dawn' | 'noon' | 'dusk' | 'night' | 'monsoon' | 'storm';
const ENV_PRESETS: Record<EnvPreset, { hour: number; season: EnvironmentState['season']; kind: WeatherKind; rain: number; wind: number }> = {
  dawn: { hour: 6.2, season: 'vasanta', kind: 'clear', rain: 0, wind: 3 },
  noon: { hour: 13, season: 'grishma', kind: 'hazy', rain: 0, wind: 5 },
  dusk: { hour: 18.4, season: 'sharad', kind: 'clear', rain: 0, wind: 2 },
  night: { hour: 23, season: 'sharad', kind: 'clear', rain: 0, wind: 2 },
  monsoon: { hour: 16, season: 'varsha', kind: 'monsoon_rain', rain: 0.85, wind: 8 },
  storm: { hour: 15, season: 'varsha', kind: 'storm', rain: 1, wind: 16 },
};

function envOf(p: EnvPreset): Pick<EnvironmentState, 'hour' | 'season' | 'weather'> {
  const e = ENV_PRESETS[p];
  return {
    hour: e.hour,
    season: e.season,
    weather: { kind: e.kind, cloudCover: e.rain > 0 ? 0.9 : 0.2, rain: e.rain, windDirection: 0.6, windSpeed: e.wind, temperatureC: 30, humidity: 0.6, visibility: 6000, flood: 0, daysRemaining: 3 } as EnvironmentState['weather'],
  };
}

const CSS = `
.aud-lab{position:absolute;top:8px;right:8px;bottom:8px;width:min(430px,calc(100vw - 16px));overflow-y:auto;overscroll-behavior:contain;
  background:var(--ui-panel);border:1px solid var(--ui-border-soft);border-radius:10px;padding:10px 12px 14px;color:var(--ui-text);
  font:13px/1.35 var(--font-body);box-shadow:0 10px 40px var(--c-shadow);pointer-events:auto;
  padding-bottom:max(14px, env(safe-area-inset-bottom));}
.aud-lab h3{margin:12px 0 6px;font:600 12px/1 var(--font-body);letter-spacing:.12em;text-transform:uppercase;color:var(--c-gold-soft)}
.aud-lab h2{margin:0 0 4px;font:600 17px/1.2 var(--font-display);color:var(--c-gold)}
.aud-lab .row{display:flex;flex-wrap:wrap;gap:6px}
.aud-lab button{min-height:44px;min-width:44px;padding:6px 10px;border-radius:8px;border:1px solid var(--ui-border-faint);
  background:rgba(255,255,255,.04);color:var(--ui-text);font:500 12.5px/1.15 var(--font-body);cursor:pointer}
.aud-lab button:hover{border-color:var(--ui-border)}
.aud-lab button.on{background:linear-gradient(180deg,var(--c-saffron-bright),var(--c-saffron-deep));color:var(--ui-text-dark);border-color:var(--c-gold)}
.aud-lab button.ui{border-color:rgba(134,184,234,.45)}
.aud-lab .sfx button{min-width:0;flex:1 1 calc(33% - 6px);font-size:11.5px}
.aud-lab .stat{font:11.5px/1.45 ui-monospace,Menlo,monospace;color:var(--ui-text-dim);white-space:pre-wrap;margin-top:6px}
.aud-lab canvas{display:block;width:100%;height:96px;border-radius:6px;background:var(--c-indigo-night);border:1px solid var(--ui-border-faint)}
.aud-lab input[type=range]{width:100%;height:44px;accent-color:var(--c-saffron)}
.aud-lab .start{width:100%;margin:6px 0;font-weight:600}
@media (max-width:560px){.aud-lab{top:auto;left:8px;right:8px;width:auto;height:52vh}}
`;

function build(ctx: AppContext, host: LabHost): LabInstance {
  const audio = ctx.audio;
  audio.attachProfiler(ctx.profiler);
  const bus = ctx.bus;
  const { scene } = host;

  // ------------------------------------------------------------------------------------- 3D emitters
  const root = new THREE.Group();
  root.name = 'audio_lab';
  const stone = host.own(new THREE.MeshStandardMaterial({ color: new THREE.Color(MATERIALS.sandstone), roughness: 0.82 }));
  const bronze = host.own(new THREE.MeshStandardMaterial({ color: new THREE.Color(METALS.bronzeAged), roughness: 0.42, metalness: 1, emissive: new THREE.Color('#ff9a3c'), emissiveIntensity: 0 }));
  const plinthGeo = host.own(new THREE.CylinderGeometry(0.75, 0.9, 1.1, 32));
  const bellGeo = host.own(new THREE.LatheGeometry([[0, 0.95], [0.12, 0.92], [0.2, 0.8], [0.3, 0.5], [0.42, 0.18], [0.5, 0.02], [0.46, 0]].map(([r, y]) => new THREE.Vector2(r, y)), 40));
  const centerGeo = host.own(new THREE.TorusGeometry(1.3, 0.06, 12, 64));
  const emitters: { pos: THREE.Vector3; mat: THREE.MeshStandardMaterial; glow: number }[] = [];
  for (let i = 0; i < EMITTERS; i++) {
    const a = (i / EMITTERS) * Math.PI * 2;
    const r = RING_R * (i % 2 ? 1.35 : 0.85);
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const plinth = new THREE.Mesh(plinthGeo, stone);
    plinth.position.set(x, 0.55, z);
    plinth.castShadow = plinth.receiveShadow = true;
    const mat = host.own(bronze.clone());
    const bell = new THREE.Mesh(bellGeo, mat);
    bell.position.set(x, 1.1, z);
    bell.castShadow = true;
    root.add(plinth, bell);
    emitters.push({ pos: new THREE.Vector3(x, 1.6, z), mat, glow: 0 });
  }
  const ring = new THREE.Mesh(centerGeo, bronze);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  root.add(ring);
  scene.add(root);
  if (ctx.params.hour === null) host.setEnvironment({ hour: 17.6 });
  host.frame({ x: 0, y: 1.6, z: 0 }, 24, 25, 22);

  // --------------------------------------------------------------------------------------- panel
  const style = h('style', null, CSS);
  const panel = shield(h('div', { class: 'aud-lab' }));
  const state = { mood: 'menu' as AudioMood, intensity: 0.3, district: '' as string, env: 'dusk' as EnvPreset };
  const moodButtons = new Map<AudioMood, HTMLButtonElement>();
  const districtButtons = new Map<string, HTMLButtonElement>();
  const envButtons = new Map<EnvPreset, HTMLButtonElement>();
  const mark = <K>(m: Map<K, HTMLButtonElement>, k: K): void => {
    for (const [key, b] of m) b.classList.toggle('on', key === k);
  };

  const setMood = (m: AudioMood, i = state.intensity): void => {
    state.mood = m;
    state.intensity = i;
    slider.value = String(Math.round(i * 100));
    bus.emit('audio:mood', { mood: m, intensity: i });
    mark(moodButtons, m);
  };
  const setDistrict = (id: string): void => {
    const d = HERO_DISTRICTS.find((x) => x.id === id);
    state.district = id;
    if (d) {
      audio.setMusicContext({ district: id, heroMood: d.mood });
      bus.emit('audio:ambience', { layers: d.ambience.map((key) => ({ key, gain: 1 })) });
    } else if (id === 'battle') bus.emit('audio:ambience', { layers: [{ key: 'battle_roar', gain: 0.9 }, { key: 'battle_drums', gain: 0.7 }] });
    else bus.emit('audio:ambience', { layers: [] });
    mark(districtButtons, id);
  };
  const setEnv = (p: EnvPreset): void => {
    state.env = p;
    audio.setEnvironment(envOf(p));
    host.setEnvironment({ hour: ENV_PRESETS[p].hour, weather: ENV_PRESETS[p].kind, season: ENV_PRESETS[p].season });
    mark(envButtons, p);
  };
  const playSfx = (kind: SfxKind, emitter = Math.floor(Math.random() * EMITTERS)): void => {
    const meta = SFX_META[kind];
    if (meta.bus === 'ui') bus.emit('audio:sfx', { sfx: kind });
    else {
      const e = emitters[emitter % EMITTERS]!;
      e.glow = 1;
      bus.emit('audio:sfx', { sfx: kind, position: { x: e.pos.x, y: e.pos.y, z: e.pos.z } });
    }
  };

  const startBtn = h('button', { class: 'start on', onclick: () => void audio.resume() }, 'Start audio (tap)');
  const slider = h('input', { type: 'range', min: '0', max: '100', value: '30', oninput: () => setMood(state.mood, Number(slider.value) / 100) }) as HTMLInputElement;
  const spec = h('canvas', { width: 400, height: 96 }) as HTMLCanvasElement;
  const statEl = h('div', { class: 'stat' }, '');
  panel.append(
    h('h2', null, 'Procedural audio lab'),
    h('div', { class: 'stat' }, 'Orbit the camera: the listener is the camera. Everything is synthesized - no files.'),
    startBtn,
    spec,
    statEl,
    h('h3', null, 'Score mood'),
    h('div', { class: 'row' }, ...AUDIO_MOODS.map((m) => {
      const b = h('button', { onclick: () => setMood(m, m === 'battle' || m === 'siege' || m === 'hero_combat' ? Math.max(0.7, state.intensity) : state.intensity) }, m.replace('_', ' '));
      moodButtons.set(m, b);
      return b;
    })),
    h('div', { class: 'stat' }, 'Intensity (alap -> jor -> gat, war layer)'),
    slider,
    h('h3', null, 'Stingers'),
    h('div', { class: 'row' }, ...AUDIO_STINGERS.map((s) => h('button', { onclick: () => bus.emit('audio:stinger', { stinger: s }) }, s.replace(/_/g, ' ')))),
    h('h3', null, 'World (season / weather / hour)'),
    h('div', { class: 'row' }, ...(Object.keys(ENV_PRESETS) as EnvPreset[]).map((p) => {
      const b = h('button', { onclick: () => setEnv(p) }, p);
      envButtons.set(p, b);
      return b;
    })),
    h('h3', null, 'District / battle ambience'),
    h('div', { class: 'row' }, ...[...HERO_DISTRICTS.map((d) => [d.id, d.name] as const), ['battle', 'Battle bed'] as const, ['', 'None'] as const].map(([id, name]) => {
      const b = h('button', { onclick: () => setDistrict(id) }, name);
      districtButtons.set(id, b);
      return b;
    })),
    h('h3', null, `SFX (${SFX_KINDS.length}) - positional at a bell, UI flat`),
    h('div', { class: 'row sfx' }, ...SFX_KINDS.map((k) => h('button', { class: SFX_META[k].bus === 'ui' ? 'ui' : '', onclick: () => playSfx(k) }, k.replace(/_/g, ' ')))),
  );
  ctx.uiRoot.append(style, panel);
  setEnv('dusk');
  setMood('menu', 0.3);
  setDistrict('d_rajaghat');

  // -------------------------------------------------------------------------------------- meters
  const g2 = spec.getContext('2d');
  const freq = new Uint8Array(1024);
  const wave = new Float32Array(2048);
  let tStat = 0;
  let tListener = 0;
  const fwd = new THREE.Vector3();
  const draw = (): void => {
    const an = audio.analyser;
    if (!g2 || !an) return;
    an.getByteFrequencyData(freq);
    an.getFloatTimeDomainData(wave);
    const W = spec.width;
    const H = spec.height;
    g2.fillStyle = '#0f1026';
    g2.fillRect(0, 0, W, H);
    const sr = audio.context?.sampleRate ?? 48000;
    const bins = an.frequencyBinCount;
    const bars = 64;
    for (let i = 0; i < bars; i++) {
      const f0 = 30 * Math.pow(20000 / 30, i / bars);
      const f1 = 30 * Math.pow(20000 / 30, (i + 1) / bars);
      let m = 0;
      for (let b = Math.floor((f0 / (sr / 2)) * bins); b <= Math.min(bins - 1, Math.ceil((f1 / (sr / 2)) * bins)); b++) m = Math.max(m, freq[b] ?? 0);
      const hgt = (m / 255) * (H - 14);
      const grd = i / bars;
      g2.fillStyle = `hsl(${30 + grd * 20}, 85%, ${38 + (m / 255) * 30}%)`;
      g2.fillRect((i * W) / bars + 1, H - 12 - hgt, W / bars - 2, hgt);
    }
    let pk = 0;
    let s2 = 0;
    for (let i = 0; i < wave.length; i++) {
      const x = wave[i] ?? 0;
      pk = Math.max(pk, Math.abs(x));
      s2 += x * x;
    }
    const rmsDb = 10 * Math.log10(s2 / wave.length + 1e-12);
    const pkDb = 20 * Math.log10(pk + 1e-12);
    g2.fillStyle = '#c9b994';
    g2.font = '10px monospace';
    g2.fillText(`30 Hz`, 2, H - 2);
    g2.fillText(`1k`, W * 0.53, H - 2);
    g2.fillText(`20k`, W - 22, H - 2);
    g2.fillText(`peak ${pkDb.toFixed(1)} dB  rms ${rmsDb.toFixed(1)} dB`, 4, 11);
  };

  return {
    update(dt: number) {
      for (const e of emitters) {
        e.glow = Math.max(0, e.glow - dt * 1.6);
        e.mat.emissiveIntensity = e.glow * 1.4;
      }
      tListener += dt;
      if (tListener > 0.1) {
        tListener = 0;
        const cam = host.camera;
        cam.getWorldDirection(fwd);
        bus.emit('audio:listener', { x: cam.position.x, y: cam.position.y, z: cam.position.z, fx: fwd.x, fy: fwd.y, fz: fwd.z });
      }
      draw();
      tStat += dt;
      if (tStat > 0.25) {
        tStat = 0;
        const s = audio.stats();
        startBtn.style.display = s.state === 'running' || !s.enabled ? 'none' : '';
        const sc = s.music.score;
        statEl.textContent = [
          `${s.state}  ${s.sampleRate} Hz  tier ${s.tier}  ${s.hrtf ? 'HRTF' : 'equal-power'}  ${s.workers}`,
          sc ? `${sc.raga} · ${sc.tala} · ${sc.section} · ${sc.bpm} bpm · I ${sc.intensity}` : 'score: warming up',
          `score buffered ${s.music.bufferedSec.toFixed(2)} s  underruns ${s.music.underruns}  worker ${s.music.workerMsPerChunk} ms/chunk`,
          `voices sfx ${s.voices.sfx} amb ${s.voices.ambience} ui ${s.voices.flat} / cap ${s.voices.cap}  stolen ${s.voices.stolen}`,
          `bank ${s.bank.keys} keys ${s.bank.mb} MB (${s.bank.renders} renders)  main ${s.mainMs.avg.toFixed(3)} ms avg / ${s.mainMs.max.toFixed(3)} max`,
          `ambience: ${s.ambience.map((a) => `${a.key} ${a.gain}`).join(', ') || '-'}`,
        ].join('\n');
        host.setInfo([`Mood ${state.mood} ${state.intensity.toFixed(2)} · ${state.env} · ${state.district || 'no district'}`]);
      }
    },
    dispose() {
      bus.emit('audio:ambience', { layers: [] });
      panel.remove();
      style.remove();
      scene.remove(root);
      root.clear();
    },
    debugCommand(name: string, args: readonly unknown[]) {
      switch (name) {
        case 'audio.stats':
          return audio.stats();
        case 'audio.resume':
          return audio.resume().then(() => audio.stats().state);
        case 'audio.sfx': {
          const k = args[0];
          if (typeof k === 'string' && (SFX_KINDS as readonly string[]).includes(k)) playSfx(k as SfxKind, typeof args[1] === 'number' ? args[1] : undefined);
          return true;
        }
        case 'audio.mood': {
          const m = args[0];
          if (typeof m === 'string' && (AUDIO_MOODS as readonly string[]).includes(m)) setMood(m as AudioMood, typeof args[1] === 'number' ? args[1] : state.intensity);
          return state.mood;
        }
        case 'audio.stinger': {
          const s = args[0];
          if (typeof s === 'string' && (AUDIO_STINGERS as readonly string[]).includes(s)) bus.emit('audio:stinger', { stinger: s as AudioStinger });
          return true;
        }
        case 'audio.district':
          setDistrict(typeof args[0] === 'string' ? args[0] : '');
          return state.district;
        case 'audio.env': {
          const p = args[0];
          if (typeof p === 'string' && p in ENV_PRESETS) setEnv(p as EnvPreset);
          return state.env;
        }
        case 'audio.burst': {
          const n = typeof args[0] === 'number' ? args[0] : 40;
          const kinds = SFX_KINDS.filter((k) => SFX_META[k].bus !== 'ui');
          for (let i = 0; i < n; i++) playSfx(kinds[i % kinds.length]!, i);
          return n;
        }
      }
      return DEBUG_UNHANDLED;
    },
  };
}

export const LAB: LabModule = {
  id: 'audio',
  title: 'Audio lab - procedural score, ambience, SFX and 3D audio',
  description: 'Orbit to move the listener. Moods, stingers, districts, weather and every SFX.',
  sceneSize: 120,
  setup: (ctx, host) => build(ctx, host),
};
