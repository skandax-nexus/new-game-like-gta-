# TA-01 - review statistics (published WebP)

- **B2**: the cache QA mean (asset.json `material.qa.meanColor`, float64 means since round 1) against the mean of the
  shipped ultra WebP (max abs difference in sRGB levels; > 2 fails).
- **AD-4**: HSV saturation p98, value p98 and the lime share (hue 70-110 deg, S > 0.55, V > 0.40).
- **B6**: ORM.r (the splat height-blend proxy) 5th / 95th percentile and span for every terrain layer (>= 0.3).

| id | cache QA mean | shipped mean | max diff (levels) | sat p98 | value p98 | lime % | ORM.r p5 / p95 / span |
|---|---|---|---|---|---|---|---|
| bamboo_lattice | #b39a63 | #b39a63 | 0 | 0.556 | 0.776 | 0 | n/a |
| basalt_dressed | #57534f | #57534f | 0 | 0.121 | 0.4 | 0 | n/a |
| brick_fired_old | #9c5a40 | #9c5a40 | 0 | 0.676 | 0.733 | 0 | n/a |
| granite_rubble | #8a8680 | #8a8680 | 0 | 0.2 | 0.6 | 0 | n/a |
| ground_dry_earth | #a88a68 | #a88a68 | 0 | 0.432 | 0.698 | 0 | 0.659 / 0.965 / **0.306** |
| laterite_block | #8f5240 | #8f5240 | 0 | 0.652 | 0.682 | 0 | n/a |
| lime_plaster_weathered | #e4dac6 | #e4dac6 | 0 | 0.364 | 0.925 | 0 | n/a |
| mud_brick_sundried | #a88866 | #a88866 | 0 | 0.418 | 0.694 | 0 | n/a |
| mud_plaster | #a8835f | #a8835f | 0 | 0.461 | 0.694 | 0 | n/a |
| roof_tile_terracotta | #a6644a | #a6644a | 0 | 0.621 | 0.753 | 0 | n/a |
| sandstone_buff | #c2a985 | #c2a985 | 0 | 0.361 | 0.918 | 0 | n/a |
| sandstone_carved_red | #a8644c | #a8644c | 0 | 0.613 | 0.788 | 0 | n/a |
| sandstone_polished_mauryan | #cdbb9a | #cdbb9a | 0 | 0.265 | 0.824 | 0 | n/a |
| sandstone_red_ashlar | #a46450 | #a46450 | 0 | 0.579 | 0.71 | 0 | n/a |
| stone_slab_roof | #7c7770 | #7c7770 | 0 | 0.315 | 0.58 | 0 | n/a |
| thatch_grass | #a8935e | #a8935e | 0 | 0.503 | 0.765 | 0 | n/a |
| thatch_palm | #9c8a5c | #9c8a5c | 0 | 0.5 | 0.682 | 0 | n/a |
| timber_sal_weathered | #5e4631 | #5e4631 | 0 | 0.621 | 0.412 | 0 | n/a |
| timber_teak_carved | #6b4a2e | #6b4a2e | 0 | 0.663 | 0.475 | 0 | n/a |
| timber_weathered_grey | #80776a | #80776a | 0 | 0.233 | 0.561 | 0 | n/a |
| terrain_alluvial_silt | #8d7d64 | #8d7d64 | 0 | 0.311 | 0.608 | 0 | 0.6 / 0.945 / **0.345** |
| terrain_black_soil | #3e3a33 | #3e3a33 | 0 | 0.25 | 0.275 | 0 | 0.294 / 0.988 / **0.694** |
| terrain_farmland_tilled | #7e6a50 | #7e6a50 | 0 | 0.434 | 0.608 | 0 | 0.596 / 0.941 / **0.345** |
| terrain_flagstone | #a09582 | #a09582 | 0 | 0.292 | 0.663 | 0 | 0.612 / 0.973 / **0.361** |
| terrain_forest_litter | #5a4a35 | #5a4a35 | 0 | 0.521 | 0.498 | 0 | 0.616 / 0.953 / **0.337** |
| terrain_grass_dry | #9a8a5a | #9a8a5a | 0 | 0.453 | 0.686 | 0 | 0.576 / 0.906 / **0.329** |
| terrain_grass_lush | #606c3c | #606c3c | 0 | 0.491 | 0.49 | 0 | 0.545 / 0.851 / **0.306** |
| terrain_laterite_soil | #8e5a44 | #8e5a44 | 0 | 0.69 | 0.635 | 0 | 0.576 / 0.906 / **0.329** |
| terrain_mud_wet | #4f4636 | #4f4636 | 0 | 0.358 | 0.345 | 0 | 0.561 / 0.953 / **0.392** |
| terrain_paddy_mud | #5b5443 | #5b5443 | 0 | 0.303 | 0.38 | 0 | 0.565 / 0.922 / **0.357** |
| terrain_pebbles | #8c8273 | #8c8273 | 0 | 0.282 | 0.784 | 0 | 0.525 / 0.961 / **0.435** |
| terrain_river_sand | #c4b18e | #c4b18e | 0 | 0.3 | 0.812 | 0 | 0.612 / 0.965 / **0.353** |
| terrain_road_earth | #9a7e5e | #9a7e5e | 0 | 0.422 | 0.651 | 0 | 0.627 / 0.976 / **0.349** |
| terrain_rock_basalt | #5a5650 | #5a5650 | 0 | 0.141 | 0.388 | 0 | 0.631 / 0.965 / **0.333** |
| terrain_rock_granite | #87827a | #87827a | 0 | 0.174 | 0.592 | 0 | 0.627 / 0.961 / **0.333** |
| terrain_rock_sandstone | #a88a6c | #a88a6c | 0 | 0.373 | 0.686 | 0 | 0.612 / 0.98 / **0.369** |
| terrain_salt_crust | #d9d2c4 | #d9d2c4 | 0 | 0.111 | 0.875 | 0 | 0.612 / 0.969 / **0.357** |
| decals_settlement | #7f705d | #7f705d | 0 | 0.677 | 0.91 | 0 | n/a |

## Review round 2

**AD-4 terrain_grass_lush** (shipped lossy WebP; target sat p98 <= 0.50, lime 0 %, blade hue 65-85 deg, V p98 <= 0.55):

| tier | file | sat p98 | value p98 | lime % | hue p5 / p50 / p95 (deg) |
|---|---|---|---|---|---|
| ultra | textures/terrain_grass_lush/baseColor_1024.webp | 0.491 | 0.49 | 0 | 72 / 75 / 79 |
| high | textures/terrain_grass_lush/baseColor_512.webp | 0.491 | 0.482 | 0 | 72 / 75 / 78 |
| mobile | textures/terrain_grass_lush/baseColor_256.webp | 0.487 | 0.471 | 0 | 72 / 75 / 78 |

**AD-11 terrain_rock_sandstone** (ultra baseColor; target hue within +-6 deg of #a88a6c, saturation <= 0.45, lamina value contrast <= 8 %):

- hue deviation from #a88a6c (30 deg): p5 -1 / p95 3.5 deg
- HSV saturation p98: 0.373
- value contrast at the lamina scale (|V - 0.3 m local mean| / mean), p90: 4.6 %

**B4 terrain_rock_basalt** flow top (recessed band = lowest 8 % of the height) mean HSV value vs #5a5650:

- 0.346 vs 0.353: -2 % (target -10 % .. +8 %)
