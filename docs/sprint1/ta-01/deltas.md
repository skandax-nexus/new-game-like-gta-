# TA-01 - WP1 mean baseColor vs target

Measured by `scripts/shots/ta-01.cjs` from the PUBLISHED WebP of every tier (sharp decode, linear mean per channel,
re-encoded to sRGB). Delta = (measured - target) / target per sRGB channel, luminance delta on linear luminance.
Tolerance +-6 %. The decal atlas has no single target (n/a).

| id | class | target | ultra | high | mobile | ultra dR/dG/dB % | ultra dLum % | worst tier abs % | pass |
|---|---|---|---|---|---|---|---|---|---|
| bamboo_lattice | S | #b39a63 | #b39a63 | #b39a63 | #b39a63 | 0.02 / 0.09 / 0.04 | 0.15 | 0.15 | PASS |
| basalt_dressed | C | #57534f | #57534f | #57534f | #57534f | 0.01 / 0.15 / -0.05 | 0.21 | 0.82 | PASS |
| brick_fired_old | S | #9c5a40 | #9c5a40 | #9c5a40 | #9c5a40 | 0.03 / 0.06 / 0.03 | 0.09 | 0.2 | PASS |
| granite_rubble | C | #8a8680 | #8a8680 | #8a8680 | #8a8680 | -0.03 / 0.14 / -0.1 | 0.19 | 0.69 | PASS |
| ground_dry_earth | T | #a88a68 | #a88a68 | #a88a68 | #a88a68 | 0.06 / 0.03 / -0.08 | 0.08 | 0.74 | PASS |
| laterite_block | C | #8f4a34 | #8f4a34 | #8f4a34 | #8f4a34 | -0.01 / 0.17 / 0.18 | 0.15 | 0.76 | PASS |
| lime_plaster_weathered | H | #e4dac6 | #e7d7c6 | #e7d7c6 | #e7d7c6 | 1.17 / -1.27 / -0.15 | -1.42 | 1.42 | PASS |
| mud_brick_sundried | C | #a88866 | #a88866 | #a88866 | #a98966 | 0.03 / 0.12 / -0.15 | 0.19 | 0.82 | PASS |
| mud_plaster | S | #a8835f | #a8835f | #a8835f | #a8835f | 0.01 / 0.16 / -0.05 | 0.22 | 0.22 | PASS |
| roof_tile_terracotta | S | #a65a3c | #a65a3c | #a65a3c | #a65a3c | 0.02 / 0.28 / -0.11 | 0.28 | 0.28 | PASS |
| sandstone_buff | H | #c2a985 | #c2a985 | #c2a985 | #c2aa85 | -0.02 / 0.15 / 0.09 | 0.22 | 0.63 | PASS |
| sandstone_carved_red | S | #a8644c | #a8644c | #a8644c | #a8644c | 0.06 / 0.11 / 0.13 | 0.18 | 0.18 | PASS |
| sandstone_polished_mauryan | C | #cdbb9a | #cdbb9a | #cdbb9a | #cdbb9a | -0.13 / 0.06 / 0.09 | 0.02 | 0.37 | PASS |
| sandstone_red_ashlar | C | #a46450 | #a46450 | #a46450 | - | -0.08 / 0.2 / -0.29 | 0.13 | 0.37 | PASS |
| stone_slab_roof | C | #7c7770 | #7c7770 | #7c7770 | - | 0.06 / 0.04 / -0.01 | 0.08 | 0.08 | PASS |
| thatch_grass | S | #a8935e | #a8935e | #a8935e | #a8935e | 0.04 / 0.11 / 0.21 | 0.21 | 0.21 | PASS |
| thatch_palm | C | #9c8a5c | #9c8a5c | #9b8a5c | - | -0.13 / 0.17 / 0.2 | 0.19 | 0.63 | PASS |
| timber_sal_weathered | C | #5e4631 | #5e4631 | #5e4631 | #5e4631 | -0.16 / 0.27 / -0.47 | 0.2 | 1.01 | PASS |
| timber_teak_carved | S | #6b4a2e | #6b4a2e | #6b4a2e | #6b4a2e | -0.06 / 0.23 / 0.05 | 0.23 | 0.23 | PASS |
| timber_weathered_grey | C | #80776a | #80776a | #80776a | - | 0.13 / 0.07 / 0.01 | 0.17 | 0.17 | PASS |
| terrain_alluvial_silt | T | #8d7d64 | #8d7d64 | #8d7d64 | #8e7e65 | 0.02 / 0.08 / -0.15 | 0.11 | 1.06 | PASS |
| terrain_black_soil | T | #3e3a33 | #3e3a33 | #3d3a33 | #3e3a33 | -0.68 / 0.44 / -0.77 | 0.21 | 0.97 | PASS |
| terrain_farmland_tilled | T | #7e6a50 | #7e6a50 | #7e6a50 | #7e6a50 | -0.01 / 0.19 / 0.1 | 0.28 | 0.78 | PASS |
| terrain_flagstone | T | #a09582 | #a09582 | #a09582 | #a09582 | -0.02 / 0.15 / 0.08 | 0.22 | 0.43 | PASS |
| terrain_forest_litter | T | #5a4a35 | #5a4a35 | #5a4a35 | #5a4a35 | -0.03 / 0.13 / 0.15 | 0.16 | 0.94 | PASS |
| terrain_grass_dry | T | #9a8a5a | #9a8a5a | #9a8a5a | #9a8b5a | 0.01 / 0.13 / 0.03 | 0.21 | 0.81 | PASS |
| terrain_grass_lush | T | #5f6f3a | #5f6f3b | #5e6d3a | #5e6c3a | 0.39 / -0.17 / 1.44 | -0.1 | 4.74 | PASS |
| terrain_laterite_soil | T | #8e5038 | #8e5038 | #8d5038 | #8d5038 | 0 / 0.32 / 0.56 | 0.35 | 1.02 | PASS |
| terrain_mud_wet | T | #4f4636 | #4f4636 | #4f4636 | #4f4736 | -0.26 / 0.35 / -0.22 | 0.33 | 1.25 | PASS |
| terrain_paddy_mud | T | #5b5443 | #5b5443 | #5b5443 | #5b5544 | -0.1 / 0.14 / -0.23 | 0.13 | 1.18 | PASS |
| terrain_pebbles | T | #8c8273 | #8c8273 | #8c8273 | #8c8273 | -0.06 / 0.13 / -0.03 | 0.16 | 0.51 | PASS |
| terrain_river_sand | T | #c4b18e | #c4b18e | #c4b18e | #c4b28e | 0.02 / 0.09 / -0.22 | 0.13 | 0.71 | PASS |
| terrain_road_earth | T | #9a7e5e | #9a7e5e | #9a7e5e | #9b7f5e | -0.02 / 0.16 / -0.3 | 0.19 | 0.93 | PASS |
| terrain_rock_basalt | T | #5a5650 | #5a5650 | #5a5650 | #5a5750 | 0.07 / 0.16 / -0.36 | 0.22 | 1.17 | PASS |
| terrain_rock_granite | T | #87827a | #87827a | #87827a | #87837a | 0 / 0.22 / -0.06 | 0.33 | 1.06 | PASS |
| terrain_rock_sandstone | T | #a88a6c | #a88a6c | #a88a6c | #a88b6c | -0.02 / 0.18 / -0.09 | 0.24 | 0.83 | PASS |
| terrain_salt_crust | T | #d9d2c4 | #d9d2c4 | #d9d2c4 | - | 0.11 / -0.03 / 0.11 | 0.02 | 0.11 | PASS |
| decals_settlement | A | n/a | #7f705d | #7f705c | #7f6f5b | n/a | n/a | n/a | n/a |
