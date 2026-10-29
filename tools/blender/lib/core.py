"""
Core helpers: scene reset, deterministic seeding, units, the AssetContext (paths, dependencies,
metadata sidecar `asset.json`). OWNER: Technical Art Director.

Contract with tools/assets/build.mjs (env vars, all optional for direct runs):
    SAMRAJYA_ASSET_ID     asset id (default: script file stem)
    SAMRAJYA_ASSET_OUT    output directory (default: <repo>/.asset-cache/<id>)
    SAMRAJYA_ASSET_CACHE  cache root holding dependency outputs (default: <repo>/.asset-cache)
    SAMRAJYA_DRAFT        "1" = fast iteration mode (quarter-res textures, few samples)
    SAMRAJYA_PREVIEW      "0" = skip the Cycles preview render (default on)

Each script ends with ctx.finish(), which writes <out>/asset.json:
    { schema, id, kind, draft, blender, files: [{role, path, ...}], material|model|hdri: {...} }
build.mjs validates it, optimizes the files and generates src/assets/manifest.ts from it.
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import math
import os
import random
import sys
import time
from pathlib import Path
from typing import Any, Iterator

import bpy
import numpy as np

SCHEMA_VERSION = 1
KINDS = ("material", "model", "hdri")
REPO_ROOT = Path(__file__).resolve().parents[3]

_T0 = time.time()


def log(*parts: Any) -> None:
    """Timestamped log line (stdout is captured by build.mjs into .asset-cache/<id>/build.log)."""
    print(f"[{time.time() - _T0:7.2f}s]", *parts, flush=True)


@contextlib.contextmanager
def timer(label: str) -> Iterator[None]:
    t = time.time()
    yield
    log(f"{label}: {time.time() - t:.2f}s")


def stable_seed(*parts: Any) -> int:
    """Deterministic 32-bit seed from any printable parts (never use hash(): it is salted per run)."""
    h = hashlib.sha256("|".join(str(p) for p in parts).encode()).digest()
    return int.from_bytes(h[:4], "little")


def seed_all(seed: int) -> np.random.Generator:
    """Seed python `random` and return a numpy PCG64 generator. Blender noise nodes are deterministic."""
    random.seed(seed)
    return np.random.Generator(np.random.PCG64(seed))


def reset_scene(fps: int = 30) -> bpy.types.Scene:
    """Empty factory scene, metric units (1 BU = 1 m), Cycles CPU, fixed fps, AgX view."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    us = scn.unit_settings
    us.system = "METRIC"
    us.scale_length = 1.0
    us.length_unit = "METERS"
    scn.render.fps = fps
    scn.render.fps_base = 1.0
    scn.frame_start = 1
    scn.frame_end = 1
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.render.threads_mode = "AUTO"
    scn.view_settings.view_transform = "AgX"
    scn.view_settings.look = "AgX - Medium High Contrast"
    scn.view_settings.exposure = 0.0
    scn.sequencer_colorspace_settings.name = "sRGB"
    return scn


class Dependency:
    """Outputs of another asset (already built into the cache by the runner)."""

    def __init__(self, asset_id: str, directory: Path) -> None:
        self.id = asset_id
        self.dir = directory
        meta_path = directory / "asset.json"
        if not meta_path.exists():
            raise RuntimeError(
                f"dependency '{asset_id}' has no {meta_path} - build it first (npm run assets -- {asset_id})"
            )
        self.meta: dict[str, Any] = json.loads(meta_path.read_text())

    def file(self, role: str) -> Path:
        for f in self.meta.get("files", []):
            if f["role"] == role:
                return self.dir / f["path"]
        raise KeyError(f"dependency '{self.id}' has no file with role '{role}'")

    def has(self, role: str) -> bool:
        return any(f["role"] == role for f in self.meta.get("files", []))


class AssetContext:
    """Per-script context: identity, output paths, quality mode, rng and the metadata sidecar."""

    def __init__(self, script_file: str, kind: str, seed: int | None = None, fps: int = 30) -> None:
        if kind not in KINDS:
            raise ValueError(f"kind must be one of {KINDS}")
        script = Path(script_file).resolve()
        self.script = script
        self.id = os.environ.get("SAMRAJYA_ASSET_ID") or script.stem
        self.kind = kind
        self.category = script.parent.name
        self.cache_dir = Path(os.environ.get("SAMRAJYA_ASSET_CACHE") or (REPO_ROOT / ".asset-cache"))
        self.out_dir = Path(os.environ.get("SAMRAJYA_ASSET_OUT") or (self.cache_dir / self.id))
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.draft = os.environ.get("SAMRAJYA_DRAFT", "0") == "1"
        self.preview = os.environ.get("SAMRAJYA_PREVIEW", "1") != "0"
        self.seed = stable_seed(self.id) if seed is None else seed
        self.scene = reset_scene(fps)
        self.rng = seed_all(self.seed)
        self.files: list[dict[str, Any]] = []
        self.meta: dict[str, Any] = {}
        log(f"asset '{self.id}' kind={kind} draft={self.draft} out={self.out_dir}")

    # -------------------------------------------------------------- quality knobs
    def res(self, final: int, draft: int | None = None) -> int:
        """Texture resolution: `final`, or `draft` (default final/4, min 128) in draft mode."""
        if not self.draft:
            return final
        return draft if draft is not None else max(128, final // 4)

    def samples(self, final: int, draft: int | None = None) -> int:
        if not self.draft:
            return final
        return draft if draft is not None else max(4, final // 8)

    # -------------------------------------------------------------- paths / deps
    def path(self, name: str) -> Path:
        return self.out_dir / name

    def dep(self, asset_id: str) -> Dependency:
        return Dependency(asset_id, self.cache_dir / asset_id)

    # -------------------------------------------------------------- metadata
    def add_file(self, role: str, path: Path | str, **info: Any) -> None:
        p = Path(path)
        rel = p.relative_to(self.out_dir) if p.is_absolute() else p
        self.files = [f for f in self.files if f["role"] != role]
        self.files.append({"role": role, "path": str(rel).replace(os.sep, "/"), **info})

    def finish(self) -> Path:
        for f in self.files:
            if not (self.out_dir / f["path"]).exists():
                raise RuntimeError(f"declared output missing: {f['path']}")
        doc = {
            "schema": SCHEMA_VERSION,
            "id": self.id,
            "kind": self.kind,
            "category": self.category,
            "draft": self.draft,
            "blender": bpy.app.version_string,
            "seed": self.seed,
            "files": self.files,
            self.kind: self.meta,
        }
        out = self.path("asset.json")
        out.write_text(json.dumps(doc, indent=2, sort_keys=True))
        log(f"wrote {out}")
        return out


def begin(script_file: str, kind: str, seed: int | None = None, fps: int = 30) -> AssetContext:
    """Start an asset script: resets the scene, seeds RNGs, resolves output paths."""
    return AssetContext(script_file, kind, seed, fps)


def blender_to_gltf(v: tuple[float, float, float]) -> tuple[float, float, float]:
    """Blender (+Z up, -Y forward) -> glTF/three (+Y up): (x, y, z) -> (x, z, -y)."""
    return (v[0], v[2], -v[1])


def deg(x: float) -> float:
    return math.radians(x)


__all__ = [
    "AssetContext",
    "Dependency",
    "REPO_ROOT",
    "begin",
    "blender_to_gltf",
    "deg",
    "log",
    "reset_scene",
    "seed_all",
    "stable_seed",
    "timer",
]

if sys.version_info < (3, 10):  # pragma: no cover
    raise RuntimeError("Blender 4.2+ Python (3.11+) required")
