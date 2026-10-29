"""
Shader node-tree builder for procedural materials (baked later by lib/bake.py). OWNER: Technical Art Director.

    nb = NodeBuilder(material)            # wraps material.node_tree (clears it by default)
    uv = nb.uv()                          # UV output socket
    vec, w = nb.torus4d(uv, scale=8)      # seamless 4D mapping of a 0..1 tile (Clifford torus)
    n = nb.noise(vec, w=w, scale=1, detail=6, roughness=0.55)   # 4D noise when w is given
    c = nb.ramp(n.fac, [(0.0, '#7d3426'), (1.0, '#c88d72')])
    nb.principled(base_color=c, roughness=0.8, normal=nb.bump(height, strength=0.4))

Every helper accepts either a socket or a constant. Positions are auto-laid-out left-to-right so
the graph stays readable when opened in Blender for debugging.

Seamless tiling: torus4d maps (u, v) to (R cos 2pi u, R sin 2pi u, R cos 2pi v) + w = R sin 2pi v,
i.e. a flat torus in 4D, so 4D Noise/Voronoi evaluated there repeats exactly on [0,1]^2 with no
stretching. `scale` = feature frequency per tile.
"""
from __future__ import annotations

import math
from typing import Any, Sequence

import bpy

from .texgen import hex_to_linear

Socket = Any


class NodeBuilder:
    def __init__(self, material: bpy.types.Material, clear: bool = True) -> None:
        material.use_nodes = True
        self.mat = material
        self.nt = material.node_tree
        self.nodes = self.nt.nodes
        self.links = self.nt.links
        if clear:
            self.nodes.clear()
        self._x = -1600
        self._col = 0
        existing = next((n for n in self.nodes if n.type == "OUTPUT_MATERIAL"), None)
        self.output = existing or self.nodes.new("ShaderNodeOutputMaterial")
        self.output.location = (600, 0)
        self.bsdf = next((n for n in self.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not clear:
            self._x = -2600  # keep added nodes left of the existing graph

    # ------------------------------------------------------------------ plumbing
    def node(self, kind: str, **props: Any) -> bpy.types.Node:
        n = self.nodes.new(kind)
        n.location = (self._x, -self._col * 220)
        self._col += 1
        if self._col > 6:
            self._col = 0
            self._x += 260
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def link(self, src: Socket, dst: Socket) -> None:
        if src is None:
            return
        if isinstance(src, bpy.types.NodeSocket):
            self.links.new(src, dst)
        elif isinstance(src, str):
            c = hex_to_linear(src)
            dst.default_value = (float(c[0]), float(c[1]), float(c[2]), 1.0)
        elif isinstance(src, (tuple, list)):
            dst.default_value = tuple(src) if len(src) == len(dst.default_value) else (*src, 1.0)
        else:
            dst.default_value = src

    def set_inputs(self, n: bpy.types.Node, **inputs: Any) -> bpy.types.Node:
        for name, val in inputs.items():
            if val is None:
                continue
            self.link(val, n.inputs[name])
        return n

    # ------------------------------------------------------------------ inputs
    def uv(self, name: str = "") -> Socket:
        n = self.node("ShaderNodeUVMap")
        if name:
            n.uv_map = name
        return n.outputs["UV"]

    def texcoord(self, which: str = "Object") -> Socket:
        return self.node("ShaderNodeTexCoord").outputs[which]

    def geometry(self, which: str) -> Socket:
        return self.node("ShaderNodeNewGeometry").outputs[which]

    def attribute(self, name: str, which: str = "Color") -> Socket:
        n = self.node("ShaderNodeAttribute")
        n.attribute_name = name
        return n.outputs[which]

    def image(self, image: bpy.types.Image, vector: Socket | None = None, non_color: bool = True,
              interpolation: str = "Cubic", extension: str = "REPEAT") -> bpy.types.Node:
        n = self.node("ShaderNodeTexImage")
        n.image = image
        n.interpolation = interpolation
        n.extension = extension
        image.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
        if vector is not None:
            self.link(vector, n.inputs["Vector"])
        return n

    def ao(self, distance: float = 0.2, samples: int = 16, only_local: bool = True) -> Socket:
        n = self.node("ShaderNodeAmbientOcclusion", samples=samples, only_local=only_local)
        n.inputs["Distance"].default_value = distance
        return n.outputs["AO"]

    # ------------------------------------------------------------------ math
    def math(self, op: str, a: Socket, b: Socket = 0.0, c: Socket = 0.0, clamp: bool = False) -> Socket:
        n = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.link(a, n.inputs[0])
        self.link(b, n.inputs[1])
        if len(n.inputs) > 2:
            self.link(c, n.inputs[2])
        return n.outputs[0]

    def vmath(self, op: str, a: Socket, b: Socket = (0, 0, 0), scale: float | None = None) -> bpy.types.Node:
        n = self.node("ShaderNodeVectorMath", operation=op)
        self.link(a, n.inputs[0])
        self.link(b, n.inputs[1])
        if scale is not None:
            n.inputs["Scale"].default_value = scale
        return n

    def map_range(self, x: Socket, a0: float, a1: float, b0: float = 0.0, b1: float = 1.0, clamp: bool = True,
                  interp: str = "LINEAR") -> Socket:
        n = self.node("ShaderNodeMapRange", interpolation_type=interp, clamp=clamp)
        self.link(x, n.inputs["Value"])
        n.inputs["From Min"].default_value = a0
        n.inputs["From Max"].default_value = a1
        n.inputs["To Min"].default_value = b0
        n.inputs["To Max"].default_value = b1
        return n.outputs["Result"]

    def mix(self, a: Socket, b: Socket, fac: Socket, blend: str = "MIX", data_type: str = "RGBA",
            clamp: bool = True) -> Socket:
        n = self.node("ShaderNodeMix", data_type=data_type, blend_type=blend, clamp_result=clamp)
        if data_type == "RGBA":
            self.link(fac, n.inputs[0])
            self.link(a, n.inputs[6])
            self.link(b, n.inputs[7])
            return n.outputs[2]
        self.link(fac, n.inputs[0])
        self.link(a, n.inputs[2])
        self.link(b, n.inputs[3])
        return n.outputs[0]

    def ramp(self, fac: Socket, stops: Sequence[tuple[float, str | tuple]], interp: str = "LINEAR") -> Socket:
        n = self.node("ShaderNodeValToRGB")
        cr = n.color_ramp
        cr.interpolation = interp
        while len(cr.elements) > 1:
            cr.elements.remove(cr.elements[-1])
        for i, (pos, col) in enumerate(stops):
            el = cr.elements[0] if i == 0 else cr.elements.new(pos)
            el.position = pos
            if isinstance(col, str):
                c = hex_to_linear(col)
                el.color = (float(c[0]), float(c[1]), float(c[2]), 1.0)
            else:
                el.color = (*col[:3], 1.0)
        self.link(fac, n.inputs["Fac"])
        return n.outputs["Color"]

    def separate(self, color: Socket) -> bpy.types.Node:
        n = self.node("ShaderNodeSeparateColor")
        self.link(color, n.inputs["Color"])
        return n

    # ------------------------------------------------------------------ procedural textures
    def torus4d(self, uv: Socket, scale: float = 1.0) -> tuple[Socket, Socket]:
        """Seamless 4D mapping of a 0..1 tile; returns (vector, w). `scale` = features per tile."""
        R = scale / (2.0 * math.pi)
        sep = self.node("ShaderNodeSeparateXYZ")
        self.link(uv, sep.inputs[0])
        tau = 2.0 * math.pi
        au = self.math("MULTIPLY", sep.outputs[0], tau)
        av = self.math("MULTIPLY", sep.outputs[1], tau)
        cx = self.math("MULTIPLY", self.math("COSINE", au), R)
        sx = self.math("MULTIPLY", self.math("SINE", au), R)
        cy = self.math("MULTIPLY", self.math("COSINE", av), R)
        sy = self.math("MULTIPLY", self.math("SINE", av), R)
        comb = self.node("ShaderNodeCombineXYZ")
        self.link(cx, comb.inputs[0])
        self.link(sx, comb.inputs[1])
        self.link(cy, comb.inputs[2])
        return comb.outputs[0], sy

    def noise(self, vector: Socket, w: Socket | None = None, scale: float = 1.0, detail: float = 4.0,
              roughness: float = 0.5, distortion: float = 0.0, lacunarity: float = 2.0,
              noise_type: str = "FBM") -> bpy.types.Node:
        n = self.node("ShaderNodeTexNoise", noise_dimensions="4D" if w is not None else "3D")
        if hasattr(n, "noise_type"):
            n.noise_type = noise_type
        self.set_inputs(n, Vector=vector, Scale=scale, Detail=detail, Roughness=roughness,
                        Distortion=distortion, Lacunarity=lacunarity)
        if w is not None:
            self.link(w, n.inputs["W"])
        return n

    def voronoi(self, vector: Socket, w: Socket | None = None, scale: float = 1.0, feature: str = "F1",
                distance: str = "EUCLIDEAN", randomness: float = 1.0, detail: float = 0.0) -> bpy.types.Node:
        n = self.node("ShaderNodeTexVoronoi", voronoi_dimensions="4D" if w is not None else "3D",
                      feature=feature, distance=distance)
        self.set_inputs(n, Vector=vector, Scale=scale, Randomness=randomness)
        if "Detail" in n.inputs:
            n.inputs["Detail"].default_value = detail
        if w is not None:
            self.link(w, n.inputs["W"])
        return n

    def bump(self, height: Socket, strength: float = 1.0, distance: float = 0.01, normal: Socket | None = None) -> Socket:
        n = self.node("ShaderNodeBump")
        self.set_inputs(n, Height=height, Strength=strength, Distance=distance)
        if normal is not None:
            self.link(normal, n.inputs["Normal"])
        return n.outputs["Normal"]

    def normal_map(self, color: Socket, strength: float = 1.0, uv_map: str = "") -> Socket:
        n = self.node("ShaderNodeNormalMap", space="TANGENT")
        if uv_map:
            n.uv_map = uv_map
        self.set_inputs(n, Color=color, Strength=strength)
        return n.outputs["Normal"]

    # ------------------------------------------------------------------ outputs
    def principled(self, base_color: Socket = (0.5, 0.5, 0.5), roughness: Socket = 0.8, metallic: Socket = 0.0,
                   normal: Socket | None = None, alpha: Socket | None = None, emission: Socket | None = None,
                   emission_strength: float = 0.0, specular: float = 0.5) -> bpy.types.Node:
        n = self.nodes.new("ShaderNodeBsdfPrincipled")
        n.location = (300, 0)
        self.set_inputs(n, **{"Base Color": base_color, "Roughness": roughness, "Metallic": metallic})
        n.inputs["Specular IOR Level"].default_value = specular
        if normal is not None:
            self.link(normal, n.inputs["Normal"])
        if alpha is not None:
            self.link(alpha, n.inputs["Alpha"])
        if emission is not None:
            self.link(emission, n.inputs["Emission Color"])
            n.inputs["Emission Strength"].default_value = emission_strength
        self.links.new(n.outputs["BSDF"], self.output.inputs["Surface"])
        self.bsdf = n
        return n


__all__ = ["NodeBuilder"]
