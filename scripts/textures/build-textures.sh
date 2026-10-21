#!/usr/bin/env bash
# Builds the Ultra-tier PBR texture arrays (KTX2 / Basis Universal) from CC0 Poly Haven sources.
#
#   Sources (CC0, https://polyhaven.com/license):
#     dark_rock        (Amal Kumar)  layer 0  cracked, fissured plateau rock
#     dark_rock_02     (see site)    layer 1  stratified rock face
#     burned_ground_01 (see site)    layer 2  ash and burnt soil
#   Download the 2K JPGs listed in docs/pbr/SOURCES.md into $SRC, then run this script.
#
#   Requires: toktx (KhronosGroup/KTX-Software >= 4.3) on PATH, python3 with Pillow.
#   Output:   public/textures/vk_pbr_diff.ktx2  sRGB colour, 2048 px, ETC1S
#             public/textures/vk_pbr_nor.ktx2   tangent-space normals (GL), 1024 px, UASTC + zstd
#             public/textures/vk_pbr_arm.ktx2   R=AO G=roughness B=metalness, 1024 px, ETC1S
set -euo pipefail
SRC="${SRC:-$HOME/tex_src}"
OUT="${OUT:-$(cd "$(dirname "$0")/../.." && pwd)/public/textures}"
TMP="$(mktemp -d)"
mkdir -p "$OUT"
IDS=(dark_rock dark_rock_02 burned_ground_01)

python3 - "$SRC" "$TMP" <<'EOF'
import sys
from PIL import Image
src, tmp = sys.argv[1], sys.argv[2]
ids = ['dark_rock', 'dark_rock_02', 'burned_ground_01']
for i, id in enumerate(ids):
    for kind, size in (('diff', 2048), ('nor', 1024), ('arm', 1024)):
        im = Image.open(f'{src}/{id}_{kind}.jpg').convert('RGB')
        if im.size[0] != size:
            im = im.resize((size, size), Image.LANCZOS)
        # Rebuild from raw pixels so no colour-profile chunks (gAMA/cHRM/iCCP) leak into the encoder.
        Image.frombytes('RGB', im.size, im.tobytes()).save(f'{tmp}/{kind}_{i}.png')
EOF

toktx --t2 --layers 3 --encode etc1s --clevel 4 --qlevel 200 --genmipmap --assign_oetf srgb \
  "$OUT/vk_pbr_diff.ktx2" "$TMP"/diff_0.png "$TMP"/diff_1.png "$TMP"/diff_2.png
toktx --t2 --layers 3 --encode uastc --uastc_quality 2 --uastc_rdo_l 1.0 --zcmp 19 --genmipmap --assign_oetf linear --assign_primaries none \
  "$OUT/vk_pbr_nor.ktx2" "$TMP"/nor_0.png "$TMP"/nor_1.png "$TMP"/nor_2.png
toktx --t2 --layers 3 --encode etc1s --clevel 4 --qlevel 160 --genmipmap --assign_oetf linear --assign_primaries none \
  "$OUT/vk_pbr_arm.ktx2" "$TMP"/arm_0.png "$TMP"/arm_1.png "$TMP"/arm_2.png
rm -rf "$TMP"
ls -la "$OUT"
