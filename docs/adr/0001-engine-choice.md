# ADR 0001 - Engine for the prototype: three.js/WebGL2 now, Unreal Engine 5 as the scale-up path

- Status: Accepted (CTO)
- Context: GDD §9 recommends Unreal Engine 5 as the primary candidate "benchmark before commitment";
  GDD §16 step 4 asks to "compare Unreal Engine 5 with one alternative using the same test scenario".

## Decision

Build the MVP / technical prototype in **TypeScript + three.js r170 (WebGL2) + Vite**, with an
**engine-agnostic simulation layer** (`src/core` contract + `src/sim` + `src/data`) that a future UE5
client can reuse or port 1:1. Re-evaluate UE5 at the vertical-slice gate (GDD §12, months 4-8) using
the same benchmark scenario.

## Comparison (same test scenario: 1,000-5,000 combatants on a 1 km river-crossing battlefield,
formation AI, morale, PC + mid-range mobile)

| Criterion | Unreal Engine 5 | three.js / WebGL2 (chosen for the prototype) |
|---|---|---|
| Visual ceiling | Highest (Nanite, Lumen, VSM, Niagara, MetaHuman) | High for stylized-realistic: PBR, IBL, ACES, GTAO, bloom, soft shadows, instancing; no GI/virtual geometry |
| Crowd rendering | Mass Entity / instanced skeletal meshes / vertex anim textures | InstancedMesh + vertex-shader animation (implemented), ~9 draw calls for 5,000 soldiers |
| PC + mobile reach | Separate builds per platform, store submission, large downloads | One URL runs on PC and phone browsers instantly; single-file HTML build |
| Iteration speed for an AI-agent studio | Editor-centric binary assets, C++ compile cycles; not runnable in our CI container (no GPU, no editor) | Text-only, hot reload, `tsc`/Vitest in seconds; headless Chromium (SwiftShader) screenshots in CI |
| Testability here | Not available in this environment | Full: typecheck, unit/determinism tests, smoke screenshots |
| Determinism / sim reuse | C++ sim; fixed-step possible | Pure TS sim with deterministic math - portable to C++/UE5 or runnable server-side (Node) |
| Mobile performance | Strong with scalability profiles, but heavy | Must be managed: quality tiers, dynamic resolution, LOD, instancing (implemented) |
| Cost/licensing | 5% royalty above revenue threshold | MIT |
| Risk | Team ramp-up, build size, store pipelines | WebGL2 limits (no compute in WebGL2; WebGPU later), browser memory limits on iOS |

## Rationale

1. The GDD's first gates (proof of concept, vertical slice) are about *proving large-scale formation
   battles, the morale model and the living strategic simulation*, not photoreal rendering. A browser
   build proves these on PC **and** mobile at once, which the GDD asks to design in "from the
   beginning rather than treating it as a late port" (§10).
2. Our studio is made of AI agents working in a container without a GPU or the UE5 editor. three.js is
   fully buildable, testable and screenshot-verifiable here; UE5 is not.
3. Fast iteration on systems design (economy, morale, AI) matters more than rendering features at this
   stage; TypeScript + Vitest gives seconds-long loops and reproducible simulation tests (§15).

## How the architecture maps onto a future UE5 port

| Prototype (TS) | UE5 equivalent |
|---|---|
| `core/types.ts` domain contract | `USTRUCT`s / data assets; same field names |
| `sim/strategic/*`, `sim/tactical/*` (pure, deterministic, three-free) | C++ subsystem (`UWorldSubsystem`) or port the TS sim to C++ line by line; or keep a headless TS/Node sim as server authority |
| `data/*` (typed tables) | DataTables / DataAssets (CSV/JSON export of the same records) |
| `SoldierBuffers` SoA + formation-authoritative casualties | Mass Entity fragments (transform, anim state, formation id) + processors; vertex-animation textures or ISM/HISM |
| `render/*` procedural architecture + terrain function | PCG framework graphs + World Partition landscape generated from the same heightfield function |
| `GameLoop` fixed step + interpolation | Fixed-tick subsystem + interpolation in actors |
| `core/save.ts` versioned JSON | `USaveGame` + versioned archive; JSON import for prototype saves |
| `window.__SAMRAJYA__` QA API | Automation framework / Gauntlet tests |
| Quality tiers | Scalability groups + device profiles |

Exit criteria to switch the production client to UE5 (to be measured at the vertical-slice gate):
target visual bar needs GI / virtual geometry; mobile store distribution is required; crowd scenes
above 5,000 on the reference PC; team composition includes human artists using DCC tools.
