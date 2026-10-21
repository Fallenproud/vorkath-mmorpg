# PBR texture sources (Ultra pilot)

All three material sets are **CC0 1.0 (public domain)** from Poly Haven (https://polyhaven.com/license).
No attribution is required; credit is given here anyway.

| Layer | Poly Haven asset | Page | Author(s) | Used for |
|---|---|---|---|---|
| 0 | `dark_rock` (Dark Rock) | https://polyhaven.com/a/dark_rock | Amal Kumar | Fissured plateau rock on flat scar terrain |
| 1 | `dark_rock_02` (Dark Rock 02) | https://polyhaven.com/a/dark_rock_02 | Amal Kumar | Stratified rock on steep slopes and cliff faces |
| 2 | `burned_ground_01` (Burned Ground 01) | https://polyhaven.com/a/burned_ground_01 | Rob Tuytel | Ash / burnt soil patches and basin hardpan |

## Files downloaded (2K JPG, Poly Haven API `https://api.polyhaven.com/files/<id>`)

For each asset: `Diffuse` (2k jpg), `nor_gl` (2k jpg, OpenGL convention, +Y up) and `arm` (2k jpg).
`arm` is R = ambient occlusion, G = roughness, B = metalness.

Example URL pattern: `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/<id>/<id>_diff_2k.jpg`
(`_nor_gl_2k.jpg`, `_arm_2k.jpg`).

Measured mean linear albedo and ARM of the sources (used by the shader to keep the Vorkath palette):

| Asset | mean linear RGB | mean AO | mean roughness | mean metalness |
|---|---|---|---|---|
| dark_rock | 0.0155, 0.0119, 0.0089 | 0.90 | 0.80 | 0.00 |
| dark_rock_02 | 0.0433, 0.0343, 0.0255 | 0.91 | 0.82 | 0.00 |
| burned_ground_01 | 0.1369, 0.1012, 0.0723 | 0.60 | 0.52 | 0.01 |

## Build

`scripts/textures/build-textures.sh` converts them to three KTX2 texture arrays in `public/textures/`:

| File | Content | Size | Codec |
|---|---|---|---|
| `vk_pbr_diff.ktx2` | sRGB albedo, 2048 px, 3 layers | 2.17 MB | ETC1S (Basis LZ) |
| `vk_pbr_nor.ktx2` | tangent normals, 1024 px, 3 layers | 3.55 MB | UASTC + zstd |
| `vk_pbr_arm.ktx2` | AO / roughness / metalness, 1024 px, 3 layers | 0.53 MB | ETC1S |

Encoder: KhronosGroup/KTX-Software `toktx` v4.4.2. The Basis transcoder in `public/basis/` is copied unchanged from three.js (`examples/jsm/libs/basis`, Apache-2.0).
