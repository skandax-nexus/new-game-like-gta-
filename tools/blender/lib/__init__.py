"""
SAMRAJYA technical-art library for headless Blender (bpy as a Python module).
OWNER: Technical Art Director (with the CTO).

Every asset is a deterministic Python script in tools/blender/assets/<category>/<id>.py that imports
these helpers. Run one directly with:

    /root/.venvs/blender/bin/python tools/blender/assets/materials/sandstone_carved_red.py

or through the pipeline runner (`npm run assets [-- <id>]`), which also optimizes and publishes.

Modules
    core      scene reset, deterministic seeding, units, AssetContext (paths, metadata, dependencies)
    texgen    numpy texture synthesis: periodic noise, warps, blur, height->normal/cavity, PNG/EXR IO
    ornament  Indian stone-carving motifs as height fields (ashlar, lotus medallions, padma, beads...)
    nodes     shader node-tree builder (+ seamless 4D "torus" noise mapping for tiling textures)
    materials PBR material creation / texture-set materials / glTF proxy materials
    mesh      modeling utilities (bevel, solidify, array, displace, UVs, cleanup, normals)
    bake      Cycles CPU baking (texture sets, selected-to-active normal/AO, heightfield tiles)
    lod       LOD generation (decimate ratios), triangle counts
    rig       armatures, bone chains, skinning
    anim      keyframed looping clips with standard names
    export    glTF export (+Y up, separate clips, extras) and bounds
    render    Cycles preview renders (camera framing, sun + sky) -> PNG for the Read-tool critique loop
    sky       physical sky (Blender multiple-scattering sky) baked to equirect HDR (EXR) per time of day
"""
