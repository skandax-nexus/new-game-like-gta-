/**
 * Regenerates the icon/emblem mask tokens in src/ui/theme.css from src/render/style/emblems.ts.
 * OWNER: Art Director. Run from the repo root:
 *   node_modules/.bin/esbuild docs/art/tools/gen-theme-icons.ts --bundle --platform=node --format=esm \
 *     --outfile=.asset-cache/gen-theme-icons.mjs && node .asset-cache/gen-theme-icons.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { themeIconTokens } from '../../../src/render/style/emblems';

const file = 'src/ui/theme.css';
const begin = '  /* @generated icons:begin (docs/art/tools/gen-theme-icons.ts) */';
const end = '  /* @generated icons:end */';
const css = readFileSync(file, 'utf8');
const a = css.indexOf(begin);
const b = css.indexOf(end);
if (a < 0 || b < a) throw new Error('theme.css: generated icon markers not found');
writeFileSync(file, `${css.slice(0, a + begin.length)}\n${themeIconTokens()}\n${css.slice(b)}`);
console.log('theme.css icon tokens regenerated');
