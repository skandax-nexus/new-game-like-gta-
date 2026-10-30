/**
 * Age panel landmark cards: every landmark of src/data/ages.ts has its own illustration band (interim ink
 * silhouettes, src/ui/components/landmarkArt.ts) - no two landmarks share the generic pillar glyph any more.
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
  it('one distinct silhouette per landmark, 5:3 band', async () => {
    const { landmarkArt, LANDMARK_ART_IDS } = await import('../../../src/ui/components/landmarkArt');
    for (const lm of LANDMARKS) expect(LANDMARK_ART_IDS, lm.id).toContain(lm.id);
    const sigs = new Set<string>();
    for (const lm of LANDMARKS) {
      const el = landmarkArt(lm.id) as unknown as ShimElement;
      expect(el.getAttribute('viewBox')).toBe('0 0 120 72');
      const paths = el.querySelectorAll('path').map((p) => p.getAttribute('d') ?? '');
      expect(paths.length, lm.id).toBeGreaterThan(0);
      sigs.add(paths.join('|'));
    }
    expect(sigs.size).toBe(LANDMARKS.length);
  });
});
