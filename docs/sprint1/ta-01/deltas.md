# TA-01 - WP1 mean baseColor vs target

Measured by `scripts/shots/ta-01.cjs` from the PUBLISHED WebP of every tier (sharp decode, linear mean per channel,
re-encoded to sRGB). Delta = (measured - target) / target per sRGB channel, luminance delta on linear luminance.
Tolerance +-6 %. The decal atlas has no single target (n/a).

| id | class | target | ultra | high | mobile | ultra dR/dG/dB % | ultra dLum % | worst tier abs % | pass |
|---|---|---|---|---|---|---|---|---|---|
| bamboo_lattice | S | #b39a63 | #b39a63 | #b39a63 | #b39a63 | 0.02 / 0.09 / 0.06 | 0.16 | 0.16 | PASS |
| basalt_dressed | C | #57534f | #57534f | #57534f | #57534f | 0 / 0.16 / -0.09 | 0.22 | 1.02 | PASS |
| brick_fired_old | S | #9c5a40 | #9c5a40 | #9c5a40 | #9c5a40 | 0.04 / 0.07 / 0.05 | 0.12 | 0.21 | PASS |
| granite_rubble | C | #8a8680 | #8a8680 | #8a8680 | #8a8680 | 0.06 / 0.09 / 0.05 | 0.17 | 0.68 | PASS |
| ground_dry_earth | T | #a88a68 | #a88a68 | #a88a68 | #a98a68 | 0.06 / 0.04 / -0.13 | 0.08 | 0.75 | PASS |
| laterite_block | C | #8f5240 | #8f5240 | #8f5240 | #8f5240 | -0.01 / 0.14 / 0.07 | 0.14 | 0.53 | PASS |
| lime_plaster_weathered | H | #e4dac6 | #e4dac6 | #e4dac6 | #e4dac6 | 0.05 / 0.02 / 0.14 | 0.08 | 0.35 | PASS |
| mud_brick_sundried | C | #a88866 | #a88866 | #a88866 | #a98966 | 0.02 / 0.13 / -0.13 | 0.19 | 0.82 | PASS |
| mud_plaster | S | #a8835f | #a8835f | #a8835f | #a8835f | -0.01 / 0.15 / -0.08 | 0.2 | 0.2 | PASS |
| roof_tile_terracotta | S | #a6644a | #a6644a | #a6644a | #a6644a | 0 / 0.23 / -0.1 | 0.24 | 0.25 | PASS |
| sandstone_buff | H | #c2a985 | #c2a985 | #c2a985 | #c2a986 | 0.01 / 0.1 / 0.12 | 0.16 | 0.55 | PASS |
| sandstone_carved_red | S | #a8644c | #a8644c | #a8644c | #a8644c | 0.05 / 0.11 / 0.12 | 0.18 | 0.18 | PASS |
| sandstone_polished_mauryan | C | #cdbb9a | #cdbb9a | #cdbb9a | #cdbb9a | -0.07 / 0.13 / 0.01 | 0.17 | 0.48 | PASS |
| sandstone_red_ashlar | C | #a46450 | #a46450 | #a46450 | - | 0 / 0.16 / -0.07 | 0.18 | 0.18 | PASS |
| stone_slab_roof | C | #7c7770 | #7c7770 | #7c7770 | - | 0.05 / 0.1 / -0.01 | 0.17 | 0.18 | PASS |
| thatch_grass | S | #a8935e | #a8935e | #a8935e | #a8935e | 0 / 0.1 / 0.15 | 0.17 | 0.17 | PASS |
| thatch_palm | C | #9c8a5c | #9c8a5c | #9c8a5c | - | -0.05 / 0.13 / -0.03 | 0.16 | 0.16 | PASS |
| timber_sal_weathered | C | #5e4631 | #5e4631 | #5e4631 | #5e4631 | -0.1 / 0.36 / -0.34 | 0.36 | 1 | PASS |
| timber_teak_carved | S | #6b4a2e | #6b4a2e | #6b4a2e | #6b4a2e | -0.05 / 0.22 / 0.06 | 0.22 | 0.22 | PASS |
| timber_weathered_grey | C | #80776a | #80776a | #80776a | - | 0.12 / 0.06 / -0.01 | 0.15 | 0.15 | PASS |
| terrain_alluvial_silt | T | #8d7d64 | #8d7d64 | #8d7d64 | #8e7e65 | 0.02 / 0.07 / -0.15 | 0.11 | 1.02 | PASS |
| terrain_black_soil | T | #3e3a33 | #3e3a33 | #3e3a33 | #3e3b33 | -0.65 / 0.48 / -0.89 | 0.26 | 1.37 | PASS |
| terrain_farmland_tilled | T | #7e6a50 | #7e6a50 | #7e6a50 | #7e6a50 | -0.01 / 0.2 / 0.11 | 0.29 | 0.76 | PASS |
| terrain_flagstone | T | #a09582 | #a09582 | #a09582 | #a09682 | -0.07 / 0.23 / 0.19 | 0.34 | 0.65 | PASS |
| terrain_forest_litter | T | #5a4a35 | #5a4a35 | #5a4a35 | #5a4a35 | -0.09 / 0.17 / 0.1 | 0.18 | 0.79 | PASS |
| terrain_grass_dry | T | #9a8a5a | #9a8a5a | #9a8a5a | #9a8a5a | 0.06 / 0.1 / -0.09 | 0.18 | 0.67 | PASS |
| terrain_grass_lush | T | #5f6f3a | #606c3c | #606c3c | #606d3c | 1 / -2.5 / 3.45 | -3.72 | 4.01 | PASS |
| terrain_laterite_soil | T | #8e5a44 | #8e5a44 | #8d5a44 | #8d5a44 | -0.03 / 0.2 / 0.32 | 0.22 | 1.06 | PASS |
| terrain_mud_wet | T | #4f4636 | #4f4636 | #4f4636 | #4f4736 | -0.22 / 0.38 / -0.2 | 0.4 | 1.49 | PASS |
| terrain_paddy_mud | T | #5b5443 | #5b5443 | #5b5443 | #5b5543 | -0.23 / 0.28 / -0.54 | 0.24 | 1.43 | PASS |
| terrain_pebbles | T | #8c8273 | #8c8273 | #8c8273 | #8c8273 | -0.06 / 0.13 / -0.03 | 0.16 | 0.45 | PASS |
| terrain_river_sand | T | #c4b18e | #c4b18e | #c4b18e | #c4b28e | 0.02 / 0.08 / -0.23 | 0.11 | 0.73 | PASS |
| terrain_road_earth | T | #9a7e5e | #9a7e5e | #9a7e5e | #9b7f5e | -0.02 / 0.16 / -0.3 | 0.2 | 0.95 | PASS |
| terrain_rock_basalt | T | #5a5650 | #5a5650 | #5a5650 | #5a5650 | -0.24 / 0.33 / -0.08 | 0.36 | 0.78 | PASS |
| terrain_rock_granite | T | #87827a | #87827a | #87827a | #87837a | 0.04 / 0.13 / 0.02 | 0.23 | 0.77 | PASS |
| terrain_rock_sandstone | T | #a88a6c | #a88a6c | #a88a6c | #a98a6c | 0.12 / 0.04 / -0.05 | 0.14 | 0.72 | PASS |
| terrain_salt_crust | T | #d9d2c4 | #d9d2c4 | #d9d2c4 | - | 0.1 / -0.04 / 0.13 | 0 | 0.13 | PASS |
| decals_settlement | A | n/a | #7f705d | #7f705c | #7f6f5b | n/a | n/a | n/a | n/a |
