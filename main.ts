// Abyssal Bloom — a colossal bioluminescent jellyfish-leviathan over a deep-sea
// canyon city, painted pixel by pixel into an HDR buffer by a tiny software
// renderer (Node standard library only, deterministic, no assets, no network).
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// writes entry.png (1024x1024) into MAKEFUN_OUTPUT_DIR (default /output).

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — one stream, fixed seed, reproducible art.
// ---------------------------------------------------------------------------
let rngState = 0xab155eed | 0;
function rnd(): number {
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rr(a: number, b: number): number {
  return a + rnd() * (b - a);
}
function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function smooth(a: number, b: number, v: number): number {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// HDR frame buffer (linear-ish float RGB) and additive painting tools.
// ---------------------------------------------------------------------------
const buf = new Float32Array(W * H * 3);

function addPx(x: number, y: number, r: number, g: number, b: number): void {
  const i = (y * W + x) * 3;
  buf[i] += r;
  buf[i + 1] += g;
  buf[i + 2] += b;
}

// Soft radial stamp with a (1-d^2)^2 falloff — the workhorse brush.
function stamp(cx: number, cy: number, rad: number, r: number, g: number, b: number, a: number): void {
  const x0 = Math.max(0, Math.floor(cx - rad));
  const x1 = Math.min(W - 1, Math.ceil(cx + rad));
  const y0 = Math.max(0, Math.floor(cy - rad));
  const y1 = Math.min(H - 1, Math.ceil(cy + rad));
  const inv = 1 / (rad * rad);
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const d2 = (dx * dx + dy * dy) * inv;
      if (d2 >= 1) continue;
      const w = 1 - d2;
      const f = a * w * w;
      addPx(x, y, r * f, g * f, b * f);
    }
  }
}

// A glowing segment: stamps marched along the line, radius/alpha interpolated.
function stroke(
  x0: number, y0: number, x1: number, y1: number,
  rad0: number, rad1: number,
  r: number, g: number, b: number, a: number,
): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(len / Math.max(1.2, rad0 * 0.55)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    stamp(
      lerp(x0, x1, t), lerp(y0, y1, t),
      lerp(rad0, rad1, t),
      r, g, b, a,
    );
  }
}

// ---------------------------------------------------------------------------
// Value noise (fbm) for painterly water mottling.
// ---------------------------------------------------------------------------
const NZ = 48;
const nzGrid = new Float32Array(NZ * NZ);
for (let i = 0; i < nzGrid.length; i++) nzGrid[i] = rnd();
function vnoise(x: number, y: number): number {
  const gx = ((x % NZ) + NZ) % NZ;
  const gy = ((y % NZ) + NZ) % NZ;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const x1 = (x0 + 1) % NZ;
  const y1 = (y0 + 1) % NZ;
  const v00 = nzGrid[y0 * NZ + x0];
  const v10 = nzGrid[y0 * NZ + x1];
  const v01 = nzGrid[y1 * NZ + x0];
  const v11 = nzGrid[y1 * NZ + x1];
  return lerp(lerp(v00, v10, sx), lerp(v01, v11, sx), sy);
}
function fbm(x: number, y: number): number {
  return (
    vnoise(x, y) * 0.55 +
    vnoise(x * 2.13 + 7.3, y * 2.13 + 3.1) * 0.28 +
    vnoise(x * 4.31 + 13.7, y * 4.31 + 9.2) * 0.17
  );
}

// ---------------------------------------------------------------------------
// Layer 1 — the water: lifted deep-blue gradient, mottling, bell ambience.
// ---------------------------------------------------------------------------
const BELL_X = 512;
const BELL_Y = 332;

function paintWater(): void {
  for (let y = 0; y < H; y++) {
    const v = y / H;
    // three-stop vertical gradient: abyss top -> mid water -> lit depths
    let r: number, g: number, b: number;
    if (v < 0.46) {
      const t = v / 0.46;
      r = lerp(0.012, 0.02, t);
      g = lerp(0.052, 0.128, t);
      b = lerp(0.128, 0.252, t);
    } else {
      const t = (v - 0.46) / 0.54;
      r = lerp(0.02, 0.03, t);
      g = lerp(0.128, 0.155, t);
      b = lerp(0.252, 0.235, t);
    }
    for (let x = 0; x < W; x++) {
      const m = fbm(x * 0.011, y * 0.011) - 0.5;
      const dx = (x - BELL_X) / 560;
      const dy = (y - BELL_Y) / 470;
      const halo = Math.exp(-(dx * dx + dy * dy) * 1.9);
      addPx(
        x, y,
        r + m * 0.016 + halo * 0.028,
        g + m * 0.042 + halo * 0.115,
        b + m * 0.052 + halo * 0.125,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 2 — volumetric light shafts falling from the bell into the canyon.
// ---------------------------------------------------------------------------
function paintShafts(): void {
  // beams: [rim origin x, floor drift, width, strength]
  const beams: Array<[number, number, number, number]> = [
    [356, -46, 54, 0.85],
    [438, -18, 40, 1.0],
    [520, 6, 62, 0.9],
    [606, 26, 42, 1.0],
    [676, 52, 50, 0.8],
  ];
  for (let y = 400; y < H; y++) {
    const t = (y - 400) / (H - 400);
    const fade = (1 - t) * (1 - t) * smooth(400, 470, y);
    if (fade <= 0.001) continue;
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (const [ox, drift, wdt, str] of beams) {
        const c = ox + drift * t;
        const d = (x - c) / (wdt * (1 + t * 0.9));
        s += str * Math.exp(-d * d * 2.6);
      }
      const tex = 0.78 + 0.22 * Math.sin(x * 0.11 + y * 0.017 + Math.sin(x * 0.021) * 2.0);
      const v = s * fade * tex * 0.052;
      if (v > 0.0015) addPx(x, y, v * 0.36, v * 0.78, v * 0.85);
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 3 — the canyon city: silhouetted spires, then a blizzard of windows.
// ---------------------------------------------------------------------------
interface Spire {
  x: number;
  w: number;
  top: number;
}
const spires: Spire[] = [];

function canyonLift(x: number): number {
  const l = Math.exp(-Math.pow((x - 30) / 170, 2));
  const rgt = Math.exp(-Math.pow((x - 994) / 170, 2));
  return 128 * Math.max(l, rgt);
}

function buildCity(): void {
  let x = -6;
  while (x < W + 4) {
    const w = rr(17, 58);
    const cx = x + w / 2;
    const spire = rnd() < 0.24;
    let h = 64 + rnd() * 118 + canyonLift(cx) + (spire ? rr(48, 118) : 0);
    h = Math.min(h, 268);
    spires.push({ x, w: spire ? Math.min(w, rr(10, 20)) : w, top: H - h });
    x += w + rr(1, 9);
  }
}

function paintCity(): void {
  // canyon floor shadow band
  for (let y = 972; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      buf[i] *= 0.1;
      buf[i + 1] *= 0.1;
      buf[i + 2] *= 0.1;
      buf[i] += 0.004;
      buf[i + 1] += 0.01;
      buf[i + 2] += 0.022;
    }
  }
  // silhouettes occlude the water behind them
  for (const s of spires) {
    const x0 = Math.max(0, Math.floor(s.x));
    const x1 = Math.min(W - 1, Math.ceil(s.x + s.w));
    const y0 = Math.max(0, Math.floor(s.top));
    for (let y = y0; y < H; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * W + x) * 3;
        buf[i] = buf[i] * 0.13 + 0.007;
        buf[i + 1] = buf[i + 1] * 0.13 + 0.018;
        buf[i + 2] = buf[i + 2] * 0.13 + 0.04;
      }
    }
    // a cold rim of city-glow along the roofline
    for (let x = x0; x <= x1; x++) {
      addPx(x, y0, 0.05, 0.1, 0.11);
    }
  }
  // teal light pool pooled on the canyon floor between the spires
  for (let i = 0; i < 26; i++) {
    const px = BELL_X + (rnd() - 0.5) * 430;
    const py = 978 + (rnd() - 0.5) * 26;
    stamp(px, py, rr(26, 60), 0.1, 0.5, 0.48, 0.028);
  }
  // windows — hundreds of warm pinpricks with a few cool accents
  for (const s of spires) {
    const area = s.w * (H - s.top);
    const count = Math.floor(area / 105);
    for (let i = 0; i < count; i++) {
      if (rnd() > 0.66) continue;
      const wx = s.x + 1.5 + rnd() * Math.max(1, s.w - 3);
      const wy = s.top + 4 + rnd() * (H - s.top - 8);
      const pick = rnd();
      let r = 1.0, g = 0.6, b = 0.18; // amber
      if (pick > 0.86) { r = 0.35; g = 0.95; b = 0.85; } // teal
      else if (pick > 0.76) { r = 1.0; g = 0.94; b = 0.84; } // warm white
      else if (pick > 0.7) { r = 1.0; g = 0.45; b = 0.7; } // pink
      const a = rr(0.3, 1.05);
      stamp(wx, wy, 1.25, r, g, b, a);
    }
    // a beacon on some spire tips
    if (s.w < 22 && rnd() < 0.6) {
      stamp(s.x + s.w / 2, s.top - 1, 2.6, 1.0, 0.72, 0.3, 0.8);
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 4 — two distant kin, small and dim, for depth.
// ---------------------------------------------------------------------------
function paintKin(cx: number, cy: number, s: number, dim: number): void {
  stamp(cx, cy, 52 * s, 0.1, 0.5, 0.55, 0.16 * dim);
  stamp(cx, cy - 4 * s, 30 * s, 0.16, 0.62, 0.62, 0.2 * dim);
  stamp(cx, cy - 2 * s, 12 * s, 1.0, 0.3, 0.5, 0.22 * dim);
  const rimY = cy + 16 * s;
  for (let i = 0; i < 7; i++) {
    const ox = (i / 6 - 0.5) * 62 * s;
    const len = (66 + (i % 3) * 22) * s;
    let px = cx + ox;
    let py = rimY;
    const ph = i * 1.7;
    for (let t = 0.06; t <= 1.001; t += 0.09) {
      const nx = cx + ox + Math.sin(t * 5 + ph) * 6 * s * t + 8 * s * t;
      const ny = rimY + t * len;
      stroke(px, py, nx, ny, 2.4 * s, 0.8 * s, 0.3, 0.85, 0.9, 0.1 * dim);
      px = nx;
      py = ny;
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 5 — THE BELL. A per-pixel analytic dome: teal tissue, wobbling radial
// canals, fresnel rim, and a radiant pink-magenta heart washing rose light
// across the whole dome.
// ---------------------------------------------------------------------------
const BELL_RX = 312;
const BELL_RY = 232;

function rimEdge(nx: number): number {
  // scalloped lower edge of the dome, as a normalised ellipse ordinate
  return Math.sqrt(Math.max(0, 1 - nx * nx)) * (0.945 + 0.055 * Math.sin(nx * 13 + 0.8));
}
function rimYAt(x: number): number {
  const nx = (x - BELL_X) / BELL_RX;
  return BELL_Y + BELL_RY * rimEdge(nx);
}

function paintBell(): void {
  // outer glow first: teal aura + rose breath around the animal
  stamp(BELL_X, BELL_Y + 10, 430, 0.08, 0.42, 0.46, 0.26);
  stamp(BELL_X, BELL_Y - 6, 300, 0.85, 0.18, 0.4, 0.15);

  const x0 = Math.floor(BELL_X - BELL_RX - 4);
  const x1 = Math.ceil(BELL_X + BELL_RX + 4);
  const y0 = Math.floor(BELL_Y - BELL_RY - 4);
  const y1 = Math.ceil(BELL_Y + BELL_RY + 4);
  for (let y = y0; y <= y1; y++) {
    const yn = (y - BELL_Y) / BELL_RY;
    for (let x = x0; x <= x1; x++) {
      const nx = (x - BELL_X) / BELL_RX;
      const d2 = nx * nx + yn * yn;
      if (d2 > 1) continue;
      if (yn > rimEdge(nx)) continue; // below the scalloped rim is open water

      const ang = Math.atan2(yn, nx);
      // radial canals: stripes around the dome centre, bending as they run,
      // and dissolving into the heart's glow instead of converging on it
      const wob = Math.sin(ang * 5 + 1.2) * 0.9 + Math.sin(ang * 11 + 4.0) * 0.35;
      const canal = 0.5 + 0.5 * Math.sin(ang * 26 + wob * 3.4);
      const fine = 0.5 + 0.5 * Math.sin(ang * 92 + wob * 6.0);
      const canalFade = smooth(0.04, 0.4, Math.sqrt(d2));
      // tissue depth: darker grooves between canals, lit ridges on them
      let tissue = 0.78 + canal * 0.3 * canalFade + fine * 0.08;
      // vertical shading: crown brighter, skirt deeper
      tissue *= 1.06 - yn * 0.22;
      // radial falloff: the dome's flanks fall into moodier shadow
      tissue *= 1.1 - d2 * 0.38;
      // painterly blotching inside the dome
      tissue *= 0.92 + fbm(x * 0.02 + 31, y * 0.02 + 7) * 0.16;

      // base teal body — deep and translucent, so the heart reads as an
      // organ glowing inside tissue rather than a lamp behind glass
      let r = 0.04 * tissue;
      let g = 0.22 * tissue;
      let b = 0.28 * tissue;

      // the heart: nested gaussians centred a little above dome centre.
      // Kept deliberately blue-poor so the core saturates pink-magenta —
      // a heart with too much blue in it tone-maps to a white disc.
      const hx = (x - BELL_X) / 78;
      const hy = (y - (BELL_Y - 22)) / 64;
      const hd = hx * hx + hy * hy;
      const heart = Math.exp(-hd);
      const core = Math.exp(-hd * 5.5);
      // rose wash bleeding from the heart across the whole dome
      const wash = Math.exp(-hd * 0.35);
      r += wash * 0.34 + heart * 0.85 + core * 0.8;
      g += wash * 0.02 + heart * 0.08 + core * 0.14;
      b += wash * 0.09 + heart * 0.34 + core * 0.4;

      // the gonad ring: four deep-magenta lobes in a clover around the heart,
      // the anatomy that gives a real jellyfish bell its inner pattern
      const gdx = x - BELL_X;
      const gdy = (y - (BELL_Y - 22)) * 1.25;
      const gdist = Math.hypot(gdx, gdy);
      const gang = Math.atan2(gdy, gdx);
      const ring = Math.exp(-Math.pow(gdist - 52, 2) / (2 * 13 * 13));
      const lobes = 0.5 + 0.5 * Math.cos(gang * 4 + 0.7);
      const gonad = ring * (0.35 + lobes * 0.65) * smooth(1.6, 0.5, hd);
      r += gonad * 0.5;
      g += gonad * 0.04;
      b += gonad * 0.26;

      // fresnel: the silhouette edge catches the light
      const fres = smooth(0.68, 1.0, d2);
      r += fres * 0.1;
      g += fres * 0.3;
      b += fres * 0.32;

      // warm scalloped rim light along the skirt
      const rimBand = smooth(0.1, 0.015, Math.abs(yn - rimEdge(nx))) * smooth(-0.2, 0.35, yn);
      r += rimBand * 0.3;
      g += rimBand * 0.24;
      b += rimBand * 0.13;

      // soften the silhouette edge so the dome melts into the water
      const edgeFade = 0.4 + 0.6 * smooth(1.0, 0.8, d2);
      const gain = 0.42 * edgeFade;
      addPx(x, y, r * gain, g * gain, b * gain);
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 6 — the tentacle curtain: 70+ tapering, swaying strands in cyan,
// magenta and gold, each stroked in three additive glow passes, some strung
// with light beads; plus a few wide frilled oral arms at the centre.
// ---------------------------------------------------------------------------
interface StrandSpec {
  nx: number;
  len: number;
  swayAmp: number;
  swayFreq: number;
  phase: number;
  drift: number;
  r: number;
  g: number;
  b: number;
  bright: number;
  beads: boolean;
  width: number;
}

function strandPoint(s: StrandSpec, t: number): [number, number] {
  const x0 = BELL_X + s.nx * BELL_RX * 0.97;
  const y0 = rimYAt(x0) - 4;
  const x = x0 + Math.sin(t * s.swayFreq + s.phase) * s.swayAmp * t + s.drift * t * t;
  const y = y0 + t * s.len;
  return [x, y];
}

function paintStrand(s: StrandSpec): void {
  const passes: Array<[number, number]> = [
    [3.1, 0.05],
    [1.55, 0.1],
    [0.78, 0.24],
  ];
  const steps = 46;
  for (const [scale, alpha] of passes) {
    let [px, py] = strandPoint(s, 0);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const [nx2, ny2] = strandPoint(s, t);
      const rad = Math.max(0.55, s.width * (1 - t * 0.82) * scale);
      stroke(px, py, nx2, ny2, rad, rad, s.r, s.g, s.b, alpha * s.bright);
      px = nx2;
      py = ny2;
    }
  }
  if (s.beads) {
    const n = 5 + Math.floor(rnd() * 4);
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1) + rr(-0.02, 0.02);
      const [bx, by] = strandPoint(s, clamp(t, 0, 1));
      stamp(bx, by, rr(1.6, 2.6), s.r, s.g, s.b, 0.55 * s.bright);
      stamp(bx, by, 5.2, s.r, s.g, s.b, 0.1 * s.bright);
    }
  }
}

function paintTentacles(): void {
  const palette: Array<[number, number, number, number]> = [
    // r, g, b, weight — cyan leads, magenta answers, gold sparks
    [0.3, 0.92, 1.0, 0.46],
    [1.0, 0.32, 0.78, 0.3],
    [0.25, 1.0, 0.82, 0.14],
    [1.0, 0.76, 0.32, 0.1],
  ];
  const strands: StrandSpec[] = [];
  const N = 74;
  for (let i = 0; i < N; i++) {
    const nx = -0.94 + (i / (N - 1)) * 1.88 + rr(-0.014, 0.014);
    let pick = rnd();
    let col = palette[0];
    for (const p of palette) {
      if (pick <= p[3]) { col = p; break; }
      pick -= p[3];
    }
    strands.push({
      nx,
      len: rr(330, 600) * (1 - Math.abs(nx) * 0.18),
      swayAmp: rr(9, 30),
      swayFreq: rr(2.4, 4.6),
      phase: rr(0, Math.PI * 2),
      drift: rr(-34, 34),
      r: col[0], g: col[1], b: col[2],
      bright: rr(0.65, 1.2),
      beads: rnd() < 0.42,
      width: rr(1.7, 3.1),
    });
  }
  // draw outer (dimmer, longer) strands first, heart strands last
  strands.sort((a, b2) => Math.abs(b2.nx) - Math.abs(a.nx));
  for (const s of strands) paintStrand(s);

  // frilled oral arms: wide, slow, magenta ribbons at the centre
  for (let i = 0; i < 6; i++) {
    const arm: StrandSpec = {
      nx: (i / 5 - 0.5) * 0.44,
      len: rr(240, 330),
      swayAmp: rr(16, 26),
      swayFreq: rr(3.4, 5.2),
      phase: rr(0, Math.PI * 2),
      drift: rr(-12, 12),
      r: 1.0, g: 0.3, b: 0.62,
      bright: 0.8,
      beads: false,
      width: rr(6.5, 9.5),
    };
    const steps = 40;
    let [px, py] = strandPoint(arm, 0);
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const [nx2, ny2] = strandPoint(arm, t);
      const frill = 1 + Math.sin(t * 34 + arm.phase) * 0.24;
      const rad = Math.max(1, arm.width * (1 - t * 0.7) * frill);
      stroke(px, py, nx2, ny2, rad, rad, arm.r, arm.g, arm.b, 0.05);
      stroke(px, py, nx2, ny2, rad * 0.45, rad * 0.45, 1.0, 0.5, 0.72, 0.08);
      px = nx2;
      py = ny2;
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 7 — atmosphere: plankton, marine snow, bubble columns.
// ---------------------------------------------------------------------------
function paintAtmosphere(): void {
  // plankton — a fine glitter everywhere, denser in the bell's halo
  for (let i = 0; i < 3000; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const dx = (x - BELL_X) / 620;
    const dy = (y - BELL_Y) / 560;
    const near = Math.exp(-(dx * dx + dy * dy));
    if (rnd() > 0.3 + near * 0.7) continue;
    const pick = rnd();
    let r = 0.55, g = 0.9, b = 1.0;
    if (pick > 0.82) { r = 1.0; g = 0.55; b = 0.8; }
    else if (pick > 0.7) { r = 1.0; g = 0.85; b = 0.55; }
    stamp(x, y, rr(0.7, 1.7), r, g, b, rr(0.05, 0.4));
  }
  // a few hero sparkles
  for (let i = 0; i < 130; i++) {
    stamp(rnd() * W, rnd() * H, rr(1.3, 2.1), 0.8, 0.95, 1.0, rr(0.3, 0.65));
  }
  // marine snow — big, slow, barely-there motes
  for (let i = 0; i < 240; i++) {
    stamp(rnd() * W, rnd() * H, rr(2.4, 5.2), 0.6, 0.8, 0.95, rr(0.016, 0.045));
  }
  // bubble columns breathing up the canyon walls
  const columns = [86, 168, 872, 952];
  for (const cx of columns) {
    let y = H - rr(30, 90);
    while (y > rr(240, 420)) {
      const rad = rr(2.6, 8);
      const bx = cx + Math.sin(y * 0.05 + cx) * 7 + rr(-3, 3);
      const n = 12;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        stamp(bx + Math.cos(a) * rad, y + Math.sin(a) * rad, 0.95, 0.65, 0.9, 1.0, 0.13);
      }
      stamp(bx - rad * 0.35, y - rad * 0.35, 1.1, 0.9, 1.0, 1.0, 0.3);
      y -= rad * 2 + rr(6, 30);
    }
  }
}

// ---------------------------------------------------------------------------
// Finish — two-scale bloom over a soft brightness threshold.
// ---------------------------------------------------------------------------
function downsample(sw: number, sh: number, dw: number, dh: number, src: Float32Array): Float32Array {
  const out = new Float32Array(dw * dh * 3);
  const fx = sw / dw;
  const fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      const xa = Math.floor(x * fx);
      const xb = Math.floor((x + 1) * fx);
      const ya = Math.floor(y * fy);
      const yb = Math.floor((y + 1) * fy);
      for (let yy = ya; yy < yb; yy++) {
        for (let xx = xa; xx < xb; xx++) {
          const i = (yy * sw + xx) * 3;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; n++;
        }
      }
      const o = (y * dw + x) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return out;
}

function boxBlur(src: Float32Array, w: number, h: number, rad: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let k = -rad; k <= rad; k++) {
        const xx = clamp(x + k, 0, w - 1);
        const i = (y * w + xx) * 3;
        r += src[i]; g += src[i + 1]; b += src[i + 2]; n++;
      }
      const o = (y * w + x) * 3;
      tmp[o] = r / n; tmp[o + 1] = g / n; tmp[o + 2] = b / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let k = -rad; k <= rad; k++) {
        const yy = clamp(y + k, 0, h - 1);
        const i = (yy * w + x) * 3;
        r += tmp[i]; g += tmp[i + 1]; b += tmp[i + 2]; n++;
      }
      const o = (y * w + x) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return out;
}

function upsampleAdd(small: Float32Array, sw: number, sh: number, weight: number): void {
  for (let y = 0; y < H; y++) {
    const gy = (y / H) * sh - 0.5;
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    const ya = clamp(y0, 0, sh - 1);
    const yb = clamp(y0 + 1, 0, sh - 1);
    for (let x = 0; x < W; x++) {
      const gx = (x / W) * sw - 0.5;
      const x0 = Math.floor(gx);
      const fx = gx - x0;
      const xa = clamp(x0, 0, sw - 1);
      const xb = clamp(x0 + 1, 0, sw - 1);
      const i00 = (ya * sw + xa) * 3;
      const i10 = (ya * sw + xb) * 3;
      const i01 = (yb * sw + xa) * 3;
      const i11 = (yb * sw + xb) * 3;
      const o = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) {
        const top = lerp(small[i00 + c], small[i10 + c], fx);
        const bot2 = lerp(small[i01 + c], small[i11 + c], fx);
        buf[o + c] += lerp(top, bot2, fy) * weight;
      }
    }
  }
}

function paintBloom(): void {
  const scales: Array<[number, number, number]> = [
    // size, blur radius, weight
    [256, 3, 0.42],
    [64, 2, 0.55],
  ];
  for (const [size, rad, weight] of scales) {
    let small = downsample(W, H, size, size, buf);
    // keep only the bright cores — the bloom belongs to the light, not the water
    for (let i = 0; i < small.length; i++) {
      small[i] = Math.max(0, small[i] - 0.5) * 1.5;
    }
    small = boxBlur(small, size, size, rad);
    small = boxBlur(small, size, size, rad);
    upsampleAdd(small, size, size, weight);
  }
}

// ---------------------------------------------------------------------------
// Finish — ACES filmic tone map, saturation, vignette, grain, shadow quantise.
// ---------------------------------------------------------------------------
function aces(x: number): number {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1);
}

function finishToBytes(): Uint8Array {
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      let r = aces(buf[i] * 1.12);
      let g = aces(buf[i + 1] * 1.12);
      let b = aces(buf[i + 2] * 1.12);
      // gentle lift so the depths stay blue, never crushed
      r = Math.pow(r, 0.88);
      g = Math.pow(g, 0.88);
      b = Math.pow(b, 0.88);
      // saturation around luma
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = luma + (r - luma) * 1.22;
      g = luma + (g - luma) * 1.22;
      b = luma + (b - luma) * 1.22;
      // vignette
      const dx = (x - W / 2) / (W / 2);
      const dy = (y - H / 2) / (H / 2);
      const vig = 1 - 0.36 * smooth(0.42, 1.32, Math.sqrt(dx * dx + dy * dy));
      r *= vig; g *= vig; b *= vig;
      // deterministic per-pixel grain (integer hash, no RNG stream)
      const hash = ((x * 374761393 + y * 668265263) * 1274126177) >>> 0;
      const grain = (((hash >> 9) & 255) / 255 - 0.5) * 0.02;
      const o = (y * W + x) * 3;
      out[o] = toByte(r + grain);
      out[o + 1] = toByte(g + grain);
      out[o + 2] = toByte(b + grain);
    }
  }
  return out;
}

function toByte(v: number): number {
  let n = Math.round(clamp(v, 0, 1) * 255);
  // quantise deep shadows in steps of 2 — invisible in the abyss, kind to deflate
  if (n < 64) n = Math.round(n / 2) * 2;
  return n;
}

// ---------------------------------------------------------------------------
// Hand-written PNG encoder: CRC32, adaptive per-row filters, zlib deflate.
// ---------------------------------------------------------------------------
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(px: Uint8Array): Buffer {
  const stride = W * 3;
  const raw = Buffer.alloc((stride + 1) * H);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  const cand = new Uint8Array(stride);
  for (let y = 0; y < H; y++) {
    cur.set(px.subarray(y * stride, (y + 1) * stride));
    let bestType = 0;
    let bestScore = Infinity;
    let bestRow: Uint8Array | null = null;
    for (const type of [0, 1, 2, 4]) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 3 ? cur[i - 3] : 0;
        const b = prev[i];
        const c = i >= 3 ? prev[i - 3] : 0;
        let f: number;
        if (type === 0) f = cur[i];
        else if (type === 1) f = (cur[i] - a) & 0xff;
        else if (type === 2) f = (cur[i] - b) & 0xff;
        else {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          f = (cur[i] - pred) & 0xff;
        }
        cand[i] = f;
        score += f < 128 ? f : 256 - f;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        bestRow = cand.slice();
      }
    }
    const off = y * (stride + 1);
    raw[off] = bestType;
    raw.set(bestRow as Uint8Array, off + 1);
    prev.set(cur);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
function main(): void {
  paintWater();
  paintShafts();
  paintKin(150, 150, 0.85, 1.35);
  paintKin(884, 196, 0.55, 1.15);
  buildCity();
  paintCity();
  paintBell();
  paintTentacles();
  paintAtmosphere();
  paintBloom();
  const png = encodePNG(finishToBytes());
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'entry.png'), png);
}

main();
