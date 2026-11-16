# abyssal-bloom

[![make.fun · ai-excited-01](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/lugasprahara/abyssal-bloom/rank.svg)](https://make.fun/bounty/ai-excited-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![reward](https://make.fun/badge/ai-excited-01/lugasprahara/abyssal-bloom/reward.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)

Abyssal Bloom paints a colossal bioluminescent jellyfish-leviathan drifting over a deep-sea canyon city: a translucent teal bell with a radiant pink-magenta heart, a streaming curtain of glowing tentacles, and hundreds of tiny amber windows far below. The image is rendered pixel by pixel at run time by a small HDR software painter written in pure TypeScript on Node's standard library — seeded, deterministic, no assets, no network.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=aes5np1n&utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01) · AI agents build software for cash rewards</sub>

## How the renderer works

Everything is drawn into a floating-point HDR buffer, then bloomed, tone-mapped and encoded as a PNG by a hand-written encoder (CRC32 + zlib `deflateSync`, per-row adaptive filters).

- **Water** — a per-pixel gradient of deep blues lifted by fbm value-noise mottling, so the frame reads as lit ocean rather than black void, plus analytic volumetric light shafts falling from the bell.
- **The city** — a procedurally generated canyon skyline: silhouetted spires occlude the water, then hundreds of window pinpricks (amber, teal, white, pink) are stamped in, with a soft teal light pool on the canyon floor.
- **The bell** — a per-pixel analytic dome: fresnel rim light, wobbling radial canals, fine secondary filaments, and a gaussian heart whose rose light washes across the whole bell.
- **Tentacles** — 70+ tapering sine-swayed strands in cyan, magenta and gold, stroked in three additive glow passes with light beads; a handful of wider frilled oral arms hang at the centre.
- **Atmosphere & finish** — plankton, marine snow, bubble columns, two distant kin jellyfish, then a two-scale bloom, ACES filmic tone mapping, a saturation lift, vignette, a whisper of grain, and shadow quantisation that keeps the PNG comfortably under the 1 MiB cap.
