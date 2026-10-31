/**
 * Age panel landmark cards: every landmark of src/data/ages.ts has its own illustration band (interim ink
 * silhouettes, src/ui/components/landmarkArt.ts), authored in a band-shaped 240 x 88 viewBox fitted with
 * `xMidYMax meet` (Art Director review UI-02 round 2, B1f): nothing is cropped, every subject stands on the ground
 * strip and its finial stays >= 4 px below the band top.
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installDom, ShimElement } from './domShim';
import { LANDMARKS } from '../../../src/data/ages';

let dom: ReturnType<typeof installDom>;
beforeAll(() => {
  dom = installDom();
});
afterAll(() => dom.uninstall());

describe('landmark art', () => {
  it('one distinct illustration per landmark in the 240 x 88 band, fitted without cropping', async () => {
    const { landmarkArt, LANDMARK_ART_IDS, LM_BAND } = await import('../../../src/ui/components/landmarkArt');
    expect(LM_BAND).toMatchObject({ w: 240, h: 88, ground: 76 });
    for (const lm of LANDMARKS) expect(LANDMARK_ART_IDS, lm.id).toContain(lm.id);
    const sigs = new Set<string>();
    for (const lm of LANDMARKS) {
      const el = landmarkArt(lm.id) as unknown as ShimElement;
      expect(el.getAttribute('viewBox')).toBe('0 0 240 88');
      // 'meet' keeps the whole viewBox visible on any card aspect (the old 'slice' cut ~40% of the height).
      expect(el.getAttribute('preserveAspectRatio')).toBe('xMidYMax meet');
      const paths = el.querySelectorAll('path').map((p) => p.getAttribute('d') ?? '');
      expect(paths.length, lm.id).toBeGreaterThan(0);
      // Absolute M / L / C / Q / Z only, so bounds below are measurable.
      for (const d of paths) expect(d, lm.id).toMatch(/^[MLCQZ0-9 .\-e]+$/);
      sigs.add(paths.join('|'));
    }
    expect(sigs.size).toBe(LANDMARKS.length);
  });

  it('every subject stands on the ground strip, finials >= 4 px below the band top', async () => {
    const { landmarkArtBounds, LM_BAND } = await import('../../../src/ui/components/landmarkArt');
    for (const lm of LANDMARKS) {
      const b = landmarkArtBounds(lm.id);
      // Reaches the ground line (stands on it) ...
      expect(b.maxY, lm.id).toBeGreaterThanOrEqual(LM_BAND.ground - 0.5);
      // ... and its highest point (conservative: curve control points included) is >= 5 viewBox units below the top (AD: >= 4 px).
      // At the narrowest card (phone portrait, ~1 px per unit) that is >= 4 px; wider cards only add sky.
      expect(b.minY, lm.id).toBeGreaterThanOrEqual(5);
    }
  });

  it('no banned vocabulary in the art source (lions, torii, pishtaq, pediments, merlons on halls, road markings)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../../src/ui/components/landmarkArt.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const word of ['lions?', 'torii', 'pishtaq', 'pediments?', 'merlons?', 'crenel\\w*', 'dash\\w*']) expect(code.toLowerCase(), word).not.toMatch(new RegExp(`\\b${word}\\b`));
  });
});
