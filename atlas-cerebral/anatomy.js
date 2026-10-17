// Geometria anatômica procedural do encéfalo (sem dependência de DOM).
import { THREE, mergeVertices } from './deps.js';

/* ==========================================================================
   Coordenadas: +x = hemisfério ESQUERDO do paciente, +y = superior, +z = anterior.
   1 unidade ≈ 10 cm. Cada hemisfério é modelado em coordenadas locais
   onde +x é lateral e a face medial fica em x ≈ -0.335.
   ========================================================================== */

// ---------- utilidades ----------
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
function table(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) { const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[i - 1] + (ys[i] - ys[i - 1]) * t; }
  }
  return ys[ys.length - 1];
}

// ---------- ruído simplex 3D (Gustavson), com semente ----------
function createNoise3D(seed = 1) {
  const grad3 = new Float32Array([1,1,0,-1,1,0,1,-1,0,-1,-1,0,1,0,1,-1,0,1,1,0,-1,-1,0,-1,0,1,1,0,-1,1,0,1,-1,0,-1,-1]);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = (seed * 2654435761) >>> 0 || 1;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
  const F3 = 1 / 3, G3 = 1 / 6;
  return function (xin, yin, zin) {
    let n0 = 0, n1 = 0, n2 = 0, n3 = 0;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) { const g = pm12[ii + perm[jj + perm[kk]]] * 3; t0 *= t0; n0 = t0 * t0 * (grad3[g] * x0 + grad3[g + 1] * y0 + grad3[g + 2] * z0); }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) { const g = pm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; t1 *= t1; n1 = t1 * t1 * (grad3[g] * x1 + grad3[g + 1] * y1 + grad3[g + 2] * z1); }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) { const g = pm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; t2 *= t2; n2 = t2 * t2 * (grad3[g] * x2 + grad3[g + 1] * y2 + grad3[g + 2] * z2); }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) { const g = pm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; t3 *= t3; n3 = t3 * t3 * (grad3[g] * x3 + grad3[g + 1] * y3 + grad3[g + 2] * z3); }
    return 32 * (n0 + n1 + n2 + n3);
  };
}

// ---------- esfera a partir de cubo (malha uniforme, indexada) ----------
function cubeSphere(N) {
  const faces = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  const pos = new Float32Array(6 * (N + 1) * (N + 1) * 3);
  const idx = [];
  let o = 0;
  faces.forEach(([n, u, v], f) => {
    const base = f * (N + 1) * (N + 1);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const a = (2 * i) / N - 1, b = (2 * j) / N - 1;
      const x = n[0] + a * u[0] + b * v[0], y = n[1] + a * u[1] + b * v[1], z = n[2] + a * u[2] + b * v[2];
      const x2 = x * x, y2 = y * y, z2 = z * z;
      pos[o++] = x * Math.sqrt(1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3);
      pos[o++] = y * Math.sqrt(1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3);
      pos[o++] = z * Math.sqrt(1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3);
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = base + j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return mergeVertices(g, 1e-5);
}

/* ==========================================================================
   ANATOMIA DO HEMISFÉRIO — marcos (projeção lateral, eixos z/y locais)
   ========================================================================== */
const centralZ = (y) => table([0, 0.15, 0.35, 0.62], [0.15, 0.08, 0.0, -0.08], y) + 0.016 * Math.sin(y * 26 + 0.5);
const sylY = (z) => table([-0.45, -0.33, -0.15, 0.15, 0.42], [0.2, 0.09, 0.0, -0.07, -0.24], z);
const occB = (y) => -0.5 - 0.1 * clamp((y + 0.25) / 0.63, 0, 1.2);
const ySFS = (z) => 0.37 - 0.22 * (z - 0.2);
const yIFS = (z) => 0.17 - 0.2 * (z - 0.25);
const yIPS = (z) => 0.33 + 0.12 * (z + 0.2);
const calcY = (z) => -0.06 * (z + 0.86) / 0.41;
const zPO = (y) => -0.45 - 0.17 * clamp((y + 0.06) / 0.44, 0, 1.2);

// forma base do hemisfério a partir de uma direção unitária
function hemiShape(ux, uy, uz, out) {
  const z = uz * (uz > 0 ? 0.8 : 0.86);
  const wz = 1 + 0.07 * Math.exp(-(((z + 0.25) / 0.4) ** 2)) - 0.1 * smooth(0.25, 0.8, z) - 0.1 * smooth(-0.5, -0.86, z);
  let x;
  if (ux >= 0) x = -0.1 + ux * 0.47 * wz;
  else x = -0.1 - 0.235 * Math.tanh((-ux * 0.94 * wz) / 0.235);
  let y;
  if (uy >= 0) {
    const h = 0.56 * (1 - 0.18 * smooth(0.15, 0.8, z) - 0.14 * smooth(-0.35, -0.86, z));
    y = uy * h;
  } else {
    const lat = smooth(-0.35, 0.45, ux);
    const tz = (z + 0.04) / 0.42;
    const B = 0.21 + 0.25 * Math.exp(-(tz * tz * tz * tz)) * lat + 0.07 * Math.exp(-(((z + 0.55) / 0.25) ** 2));
    y = (-B * Math.tanh(-uy * 1.9)) / Math.tanh(1.9);
    // lobo temporal ligeiramente mais largo embaixo
    if (ux > 0) x += 0.035 * lat * Math.exp(-(tz * tz * tz * tz)) * smooth(0, -0.6, uy);
  }
  out[0] = x; out[1] = y; out[2] = z;
}

// classificação: lobo e área funcional
const ID = {
  frontal: 1, parietal: 2, temporal: 3, occipital: 4, cerebellum: 5, brainstem: 6, callosum: 7, thalamus: 8, hippocampus: 9,
  prefrontal: 10, motor: 11, somato: 12, broca: 13, wernicke: 14, auditory: 15, visual: 16, basal: 17, ventricles: 18, amygdala: 19, hypothalamus: 20, pituitary: 21,
};
function classify(x, y, z, isLeft, out) {
  const zc = centralZ(y), sy = sylY(z);
  const medial = x < -0.25;
  let lobe;
  const temporal = medial ? (y < -0.14 && z > -0.5 && z < 0.3) : (y < sy && z < 0.46 && (z < 0.1 || x > -0.14));
  if (z < occB(y)) lobe = ID.occipital;
  else if (temporal) lobe = ID.temporal;
  else if (z > zc) lobe = ID.frontal;
  else lobe = ID.parietal;

  let area = 0;
  if (lobe === ID.frontal) {
    const dz = z - zc;
    if (dz < 0.13 && y > sy + 0.03) area = ID.motor;
    else if (isLeft && !medial && x > -0.1 && y > sy + 0.01 && y < yIFS(z) && dz > 0.13 && dz < 0.32) area = ID.broca;
    else if (dz > 0.32) area = ID.prefrontal;
  } else if (lobe === ID.parietal) {
    if (z - zc > -0.125) area = ID.somato;
  } else if (lobe === ID.temporal) {
    if (!medial && y > sy - 0.12 && z > -0.2 && z < 0.08) area = ID.auditory;
    else if (isLeft && !medial && y > sy - 0.12 && z > -0.47 && z <= -0.2) area = ID.wernicke;
  } else if (lobe === ID.occipital) {
    if (z < -0.77 || (x < -0.18 && Math.abs(y - calcY(z)) < 0.09)) area = ID.visual;
  }
  out[0] = lobe; out[1] = area;
}

// sulcos explícitos
let Gw = 0, Gd = 0;
function groove(dist, w, depth, weight) {
  if (weight <= 0.001 || dist >= w) return;
  const t = 1 - dist / w, v = t * t * weight;
  if (v > Gw) Gw = v;
  if (v * depth > Gd) Gd = v * depth;
}

// deslocamento cortical (giros e sulcos) — negativo = para dentro
function cortexDisp(x, y, z, nA, nB) {
  const F = 6.3;
  const wx = nA(x * 1.6 + 11.3, y * 1.6, z * 1.6) * 0.11;
  const wy = nA(x * 1.6, y * 1.6 + 23.1, z * 1.6) * 0.11;
  const wz = nA(x * 1.6, y * 1.6, z * 1.6 + 37.7) * 0.11;
  const qx = x + wx, qy = y + wy, qz = z + wz;
  const zc = centralZ(y), sy = sylY(z);

  const nIso = nA(qx * F, qy * F, qz * F);
  const nAni = nB(qx * F * 1.1, qy * F * 1.25, qz * F * 0.42); // giros alongados ântero-posteriores
  const wF = smooth(zc + 0.15, zc + 0.3, z) * smooth(sy + 0.02, sy + 0.1, y);
  const wT = smooth(sy - 0.02, sy - 0.1, y) * smooth(-0.52, -0.36, z);
  const wA = Math.max(wF, wT) * 0.8;
  const nn = nIso * (1 - wA) + nAni * wA;
  const g = Math.min(Math.abs(nn) / 0.36, 1);
  const ridge = 1 - (1 - g) * (1 - g);
  const lat = smooth(-0.31, -0.22, x);
  const med = 1 - lat;

  let d = 0.04 * (ridge - 1);
  const n3 = nB(qx * 15 + 5.1, qy * 15, qz * 15);
  d -= 0.006 * Math.max(0, 1 - Math.abs(n3) / 0.16) * ridge; // sulcos terciários
  const re = Math.hypot((z + 0.02) / 0.42, (y - 0.04) / 0.25);
  d *= 1 - med * (1 - smooth(0.62, 0.8, re)); // zona calosa (substância branca) lisa
  d *= 0.6 + 0.4 * lat;

  Gw = 0; Gd = 0;
  const lx = smooth(-0.12, 0.08, x);
  // central (Rolando)
  groove(Math.abs(z - zc) * 0.92, 0.026, 0.062, smooth(-0.03, 0.04, y) * (lat + med * smooth(0.3, 0.42, y)));
  // pré e pós-central
  groove(Math.abs(z - zc - 0.135) * 0.92, 0.02, 0.04, smooth(0.04, 0.1, y) * smooth(0.56, 0.46, y) * lat);
  groove(Math.abs(z - zc + 0.125) * 0.92, 0.02, 0.04, smooth(0.02, 0.09, y) * smooth(0.54, 0.44, y) * lat);
  // fissura lateral (Sylvius)
  groove(Math.abs(y - sy), 0.034, 0.09, smooth(-0.48, -0.4, z) * smooth(0.47, 0.4, z) * lx);
  // temporais superior e inferior
  groove(Math.abs(y - sy + 0.12), 0.02, 0.045, smooth(-0.52, -0.44, z) * smooth(0.36, 0.28, z) * lx);
  groove(Math.abs(y - sy + 0.24), 0.018, 0.03, smooth(-0.52, -0.44, z) * smooth(0.26, 0.18, z) * lx);
  // frontais superior e inferior
  groove(Math.abs(y - ySFS(z)) * 0.95, 0.019, 0.04, smooth(zc + 0.12, zc + 0.16, z) * smooth(0.7, 0.6, z) * lat);
  groove(Math.abs(y - yIFS(z)) * 0.95, 0.018, 0.035, smooth(zc + 0.13, zc + 0.17, z) * smooth(0.64, 0.55, z) * lx);
  // intraparietal
  groove(Math.abs(y - yIPS(z)), 0.02, 0.04, smooth(-0.6, -0.54, z) * smooth(zc - 0.12, zc - 0.16, z) * lat);
  // face medial: calcarino, parieto-occipital, cíngulo
  groove(Math.abs(y - calcY(z)), 0.022, 0.05, smooth(-0.9, -0.84, z) * smooth(-0.4, -0.46, z) * med);
  groove(Math.abs(z - zPO(y)), 0.022, 0.05, smooth(-0.1, -0.04, y) * smooth(0.48, 0.4, y) * med);
  groove(Math.abs(re - 1) * 0.25, 0.02, 0.04, smooth(-0.02, 0.04, y) * smooth(-0.44, -0.38, z) * med);

  return d * (1 - Gw * 0.9) - Gd;
}

/* ==========================================================================
   CORES (lineares)
   ========================================================================== */
const lin = (hex) => new THREE.Color(hex);
const TISSUE = {
  crown: lin('#d99a8b'), sulcus: lin('#4a1519'),
  cereCrown: lin('#d0907f'), cereSulcus: lin('#4a171b'),
  stem: lin('#dcb4a4'), stemDeep: lin('#8a554d'),
  white: lin('#f1e7dc'), thal: lin('#cf9e94'),
  hippo: lin('#c98a80'), hippoDeep: lin('#8e5149'), basal: lin('#b99088'), csf: lin('#8cbbe0'), csfDeep: lin('#4f7fa8'),
  amyg: lin('#c4877e'), hypo: lin('#c9928a'), pit: lin('#d4a090'), pitDeep: lin('#9a6458'),
};

/* ==========================================================================
   CONSTRUÇÃO DAS MALHAS
   ========================================================================== */
function makeAttrs(g, n) {
  return { color: new Float32Array(n * 3), lobe: new Float32Array(n), area: new Float32Array(n), cav: new Float32Array(n) };
}
function setAttrs(g, a) {
  g.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
  g.setAttribute('aLobe', new THREE.BufferAttribute(a.lobe, 1));
  g.setAttribute('aArea', new THREE.BufferAttribute(a.area, 1));
  g.setAttribute('aCav', new THREE.BufferAttribute(a.cav, 1));
}

function buildHemisphere(N, seed, isLeft, stats) {
  const g = cubeSphere(N);
  const P = g.attributes.position.array, n = g.attributes.position.count;
  const tmp = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    hemiShape(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], tmp);
    P[i * 3] = tmp[0]; P[i * 3 + 1] = tmp[1]; P[i * 3 + 2] = tmp[2];
  }
  g.computeVertexNormals();
  const Nr = g.attributes.normal.array;
  const nA = createNoise3D(seed), nB = createNoise3D(seed + 101), nC = createNoise3D(seed + 202);
  const a = makeAttrs(g, n);
  const cls = [0, 0];
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const d = cortexDisp(x, y, z, nA, nB);
    classify(x, y, z, isLeft, cls);
    a.lobe[i] = cls[0]; a.area[i] = cls[1];
    const cav = clamp(1 + d / 0.05);
    a.cav[i] = cav;
    c.copy(TISSUE.sulcus).lerp(TISSUE.crown, Math.pow(cav, 0.55));
    const v = 1 + 0.07 * nC(x * 3, y * 3, z * 3) + 0.03 * nC(x * 11, y * 11, z * 11);
    a.color[i * 3] = c.r * v; a.color[i * 3 + 1] = c.g * v * 0.99; a.color[i * 3 + 2] = c.b * v;
    const nx = Nr[i * 3], ny = Nr[i * 3 + 1], nz = Nr[i * 3 + 2];
    if (stats) {
      for (const id of [cls[0], cls[1]]) {
        if (!id) continue;
        const s = stats[id] || (stats[id] = { p: new THREE.Vector3(), n: new THREE.Vector3(), count: 0 });
        s.p.x += x; s.p.y += y; s.p.z += z; s.n.x += nx; s.n.y += ny; s.n.z += nz; s.count++;
      }
    }
    P[i * 3] = x + nx * d; P[i * 3 + 1] = y + ny * d; P[i * 3 + 2] = z + nz * d;
  }
  setAttrs(g, a);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function buildHemiProxy() {
  const g = cubeSphere(40);
  const P = g.attributes.position.array, tmp = [0, 0, 0];
  for (let i = 0; i < P.length; i += 3) { hemiShape(P[i], P[i + 1], P[i + 2], tmp); P[i] = tmp[0]; P[i + 1] = tmp[1]; P[i + 2] = tmp[2]; }
  g.computeBoundingSphere();
  return g;
}

function cerebShape(ux, uy, uz, out) {
  let x = ux * 0.54, y = uy * 0.25, z = uz * 0.34;
  const ax = Math.abs(ux);
  y *= 0.82 + 0.3 * smooth(0.05, 0.5, ax);
  const notch = Math.exp(-((ux / 0.13) ** 2));
  if (uz < 0) z *= 1 - 0.16 * notch * smooth(0, -0.5, uz);
  if (uy < 0) y *= 1 - 0.22 * notch;
  if (uz > 0) z *= 1 - 0.7 * Math.exp(-((ux / 0.3) ** 2)) * smooth(0.0, 0.6, uz);
  if (uy > 0) y *= 0.8; // tentório achata a face superior
  out[0] = x; out[1] = y; out[2] = z;
}

function buildCerebellum(N, seed) {
  const g = cubeSphere(N);
  const P = g.attributes.position.array, n = g.attributes.position.count, tmp = [0, 0, 0];
  for (let i = 0; i < n; i++) { cerebShape(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], tmp); P.set(tmp, i * 3); }
  g.computeVertexNormals();
  const Nr = g.attributes.normal.array;
  const nA = createNoise3D(seed), nC = createNoise3D(seed + 7);
  const a = makeAttrs(g, n);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const th = Math.atan2(y + 0.02, 0.34 - z); // folhas convergem para o pedúnculo (anterior)
    const f = Math.sin(th * 44 + nA(x * 3, y * 3, z * 3) * 1.5 + x * x * 5);
    const gg = Math.min(Math.abs(f) / 0.65, 1);
    let d = 0.011 * (1 - (1 - gg) * (1 - gg) - 1);
    const f2 = Math.sin(th * 6.5 + 0.6 + nA(x * 1.5 + 9, y * 1.5, z * 1.5) * 0.4);
    const t2 = Math.max(0, 1 - Math.abs(f2) / 0.1);
    d -= 0.026 * t2 * t2; // fissuras maiores
    const pv = Math.max(0, 1 - Math.abs(Math.abs(x) - 0.11) / 0.035);
    d -= 0.02 * pv * pv * smooth(0.1, -0.2, z); // sulcos paravermianos
    const cav = clamp(1 + d / 0.035);
    a.cav[i] = cav; a.lobe[i] = ID.cerebellum; a.area[i] = ID.cerebellum;
    c.copy(TISSUE.cereSulcus).lerp(TISSUE.cereCrown, Math.pow(cav, 0.7));
    const v = 1 + 0.06 * nC(x * 4, y * 4, z * 4);
    a.color[i * 3] = c.r * v; a.color[i * 3 + 1] = c.g * v; a.color[i * 3 + 2] = c.b * v;
    P[i * 3] = x + Nr[i * 3] * d; P[i * 3 + 1] = y + Nr[i * 3 + 1] * d; P[i * 3 + 2] = z + Nr[i * 3 + 2] * d;
  }
  setAttrs(g, a);
  g.computeVertexNormals();
  return g;
}

function buildCerebProxy() {
  const g = cubeSphere(24);
  const P = g.attributes.position.array, tmp = [0, 0, 0];
  for (let i = 0; i < P.length; i += 3) { cerebShape(P[i], P[i + 1], P[i + 2], tmp); P.set(tmp, i); }
  return g;
}

// tubo paramétrico genérico com seção elíptica: f(t, θ) → ponto
function buildTube(M, K, curve, section, tissue) {
  const pos = new Float32Array((M + 1) * K * 3);
  const T = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0), Nn = new THREE.Vector3(), C = new THREE.Vector3();
  const cavArr = new Float32Array((M + 1) * K);
  for (let r = 0; r <= M; r++) {
    const t = r / M;
    curve.getPointAt(t, C); curve.getTangentAt(t, T);
    Nn.crossVectors(T, X).normalize();
    for (let k = 0; k < K; k++) {
      const th = (k / K) * Math.PI * 2;
      const [w, h, cav] = section(t, th);
      const o = (r * K + k) * 3;
      pos[o] = C.x + X.x * Math.cos(th) * w + Nn.x * Math.sin(th) * h;
      pos[o + 1] = C.y + X.y * Math.cos(th) * w + Nn.y * Math.sin(th) * h;
      pos[o + 2] = C.z + X.z * Math.cos(th) * w + Nn.z * Math.sin(th) * h;
      cavArr[r * K + k] = cav;
    }
  }
  const idx = [];
  for (let r = 0; r < M; r++) for (let k = 0; k < K; k++) {
    const a = r * K + k, b = r * K + ((k + 1) % K), c = a + K, d = b + K;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  const n = (M + 1) * K, at = makeAttrs(g, n), col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    at.cav[i] = cavArr[i];
    col.copy(tissue[1]).lerp(tissue[0], cavArr[i]);
    at.color[i * 3] = col.r; at.color[i * 3 + 1] = col.g; at.color[i * 3 + 2] = col.b;
  }
  return { g, at };
}

function buildBrainstem(M, K) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.06, -0.07), new THREE.Vector3(0, -0.24, -0.06), new THREE.Vector3(0, -0.42, -0.06),
    new THREE.Vector3(0, -0.58, -0.1), new THREE.Vector3(0, -0.72, -0.13), new THREE.Vector3(0, -0.86, -0.15),
  ]);
  const noise = createNoise3D(5);
  const { g, at } = buildTube(M, K, curve, (t, th) => {
    let r = table([0, 0.18, 0.34, 0.44, 0.58, 0.72, 1], [0.13, 0.115, 0.125, 0.12, 0.085, 0.064, 0.056], t);
    const end = Math.min(1, Math.sqrt(Math.max(0, (1 - t) / 0.035)), Math.sqrt(t / 0.03));
    const pons = 0.075 * Math.exp(-(((t - 0.38) / 0.1) ** 2));
    const front = Math.max(0, Math.sin(th));
    let h = r + pons * Math.pow(front, 1.4);
    // fissura mediana anterior e pirâmides bulbares
    const dth = th - Math.PI / 2;
    const fiss = Math.exp(-((dth / 0.1) ** 2)) * smooth(0.45, 0.55, t);
    h -= 0.012 * fiss;
    const pyr = Math.exp(-(((Math.abs(dth) - 0.35) / 0.2) ** 2)) * smooth(0.48, 0.58, t) * smooth(0.8, 0.7, t);
    h += 0.01 * pyr;
    // fibras pontinas transversas
    h += 0.0025 * Math.sin(t * 160) * Math.exp(-(((t - 0.38) / 0.09) ** 2)) * front;
    // pedúnculos cerebrais (topo, anterior)
    const ped = Math.exp(-(((Math.abs(dth) - 0.6) / 0.35) ** 2)) * smooth(0.22, 0.05, t);
    h += 0.03 * ped;
    const w = r * 1.12 * (1 + 0.04 * noise(t * 6, th, 0));
    const cav = clamp(0.85 - 0.6 * fiss + 0.1 * Math.sin(t * 160) * Math.exp(-(((t - 0.38) / 0.09) ** 2)));
    return [w * end, h * end, cav];
  }, [TISSUE.stem, TISSUE.stemDeep]);
  at.lobe.fill(ID.brainstem); at.area.fill(ID.brainstem);
  setAttrs(g, at);
  g.computeVertexNormals();
  return g;
}

function buildCallosum() {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.05, 0.2), new THREE.Vector3(0, 0.0, 0.3), new THREE.Vector3(0, 0.09, 0.33),
    new THREE.Vector3(0, 0.17, 0.2), new THREE.Vector3(0, 0.2, 0.0), new THREE.Vector3(0, 0.18, -0.22),
    new THREE.Vector3(0, 0.1, -0.33),
  ]);
  const { g, at } = buildTube(160, 48, curve, (t, th) => {
    const end = Math.min(1, Math.sqrt(t / 0.03), Math.sqrt((1 - t) / 0.03));
    const w = 0.15 * (0.75 + 0.25 * smooth(0, 0.3, t));
    const h = 0.024 + 0.02 * Math.exp(-(((t - 0.22) / 0.1) ** 2)) + 0.032 * smooth(0.82, 0.97, t);
    return [w * end, h * end, 0.95];
  }, [TISSUE.white, TISSUE.white]);
  at.lobe.fill(ID.callosum); at.area.fill(ID.callosum);
  setAttrs(g, at);
  g.computeVertexNormals();
  return g;
}

function buildThalamus() {
  const g = new THREE.SphereGeometry(1, 64, 40);
  const P = g.attributes.position.array, n = g.attributes.position.count;
  for (let i = 0; i < n; i++) {
    let x = P[i * 3] * 0.065, y = P[i * 3 + 1] * 0.06, z = P[i * 3 + 2] * 0.11;
    z += 0.02 * (P[i * 3 + 2] < 0 ? -P[i * 3 + 1] : 0); // pulvinar mais volumoso atrás
    P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
  }
  const at = makeAttrs(g, n);
  for (let i = 0; i < n; i++) {
    at.cav[i] = 0.9; at.lobe[i] = ID.thalamus; at.area[i] = ID.thalamus;
    at.color[i * 3] = TISSUE.thal.r; at.color[i * 3 + 1] = TISSUE.thal.g; at.color[i * 3 + 2] = TISSUE.thal.b;
  }
  setAttrs(g, at);
  g.computeVertexNormals();
  return g;
}

// estruturas internas — coordenadas locais do hemisfério (+x lateral, face medial em x≈-0.335)
function tubeStructure(points, radius, id, tissue, flat = 1) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const { g, at } = buildTube(140, 40, curve, (t, th) => {
    const end = Math.min(1, Math.sqrt(t / 0.05), Math.sqrt(Math.max(0, (1 - t) / 0.05)));
    const r = radius(t);
    return [r * end, r * flat * end, 0.75 + 0.25 * Math.sin(th)];
  }, tissue);
  at.lobe.fill(id); at.area.fill(id);
  setAttrs(g, at);
  g.computeVertexNormals();
  return g;
}
function ellipsoidStructure(rx, ry, rz, cx, cy, cz, id, color) {
  const g = new THREE.SphereGeometry(1, 48, 32);
  g.scale(rx, ry, rz); g.translate(cx, cy, cz);
  const n = g.attributes.position.count, at = makeAttrs(g, n);
  for (let i = 0; i < n; i++) {
    at.cav[i] = 0.85; at.lobe[i] = id; at.area[i] = id;
    at.color[i * 3] = color.r; at.color[i * 3 + 1] = color.g; at.color[i * 3 + 2] = color.b;
  }
  setAttrs(g, at);
  return g;
}
function buildInternals() {
  const hippo = tubeStructure(
    [[-0.04, -0.2, 0.12], [-0.07, -0.19, 0.02], [-0.1, -0.16, -0.1], [-0.13, -0.1, -0.21], [-0.17, -0.02, -0.28]],
    (t) => table([0, 0.15, 0.5, 1], [0.046, 0.042, 0.03, 0.018], t), ID.hippocampus, [TISSUE.hippo, TISSUE.hippoDeep], 0.8);
  const ventMain = tubeStructure(
    [[-0.27, 0.03, 0.27], [-0.27, 0.1, 0.18], [-0.26, 0.14, 0.02], [-0.24, 0.12, -0.16], [-0.2, 0.06, -0.3], [-0.19, 0.04, -0.45]],
    (t) => table([0, 0.2, 0.6, 0.85, 1], [0.04, 0.052, 0.042, 0.05, 0.024], t), ID.ventricles, [TISSUE.csf, TISSUE.csfDeep], 1.3);
  const ventTemp = tubeStructure(
    [[-0.2, 0.06, -0.3], [-0.15, -0.04, -0.27], [-0.08, -0.13, -0.16], [-0.04, -0.15, -0.03], [-0.03, -0.16, 0.06]],
    (t) => table([0, 0.3, 1], [0.034, 0.026, 0.02], t), ID.ventricles, [TISSUE.csf, TISSUE.csfDeep], 1.1);
  const caudate = tubeStructure(
    [[-0.21, 0.04, 0.24], [-0.2, 0.11, 0.13], [-0.19, 0.15, 0.0], [-0.17, 0.12, -0.14], [-0.14, 0.06, -0.24], [-0.1, -0.04, -0.24], [-0.06, -0.1, -0.14]],
    (t) => table([0, 0.15, 0.4, 1], [0.052, 0.046, 0.024, 0.012], t), ID.basal, [TISSUE.basal, TISSUE.hippoDeep], 1);
  const putamen = ellipsoidStructure(0.035, 0.07, 0.12, -0.1, -0.01, 0.04, ID.basal, TISSUE.basal);
  // amígdala: à frente da cabeça do hipocampo, no polo temporal medial
  const amygdala = ellipsoidStructure(0.036, 0.034, 0.042, -0.05, -0.17, 0.19, ID.amygdala, TISSUE.amyg);
  return [hippo, ventMain, ventTemp, caudate, putamen, amygdala];
}

// estruturas da linha média (coordenadas do encéfalo): hipotálamo e hipófise com a haste
function buildMidline() {
  const hypothalamus = ellipsoidStructure(0.05, 0.034, 0.06, 0, -0.115, 0.03, ID.hypothalamus, TISSUE.hypo);
  const stalk = tubeStructure([[0, -0.12, 0.06], [0, -0.2, 0.1], [0, -0.27, 0.13]], () => 0.011, ID.pituitary, [TISSUE.pit, TISSUE.pitDeep]);
  const gland = ellipsoidStructure(0.036, 0.026, 0.032, 0, -0.29, 0.14, ID.pituitary, TISSUE.pit);
  return { hypothalamus, pituitary: [stalk, gland] };
}

// limite entre substância cinzenta e branca: acompanha os giros ~3 mm abaixo da superfície
function buildWhiteMatter(N, seed) {
  const g = cubeSphere(N);
  const P = g.attributes.position.array, n = g.attributes.position.count, tmp = [0, 0, 0];
  for (let i = 0; i < n; i++) { hemiShape(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], tmp); P.set(tmp, i * 3); }
  g.computeVertexNormals();
  const Nr = g.attributes.normal.array;
  const nA = createNoise3D(seed), nB = createNoise3D(seed + 101); // mesmas sementes do córtex
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const d = cortexDisp(x, y, z, nA, nB);
    const med = 1 - smooth(-0.31, -0.22, x);
    const re = Math.hypot((z + 0.02) / 0.42, (y - 0.04) / 0.25);
    const callosal = med * (1 - smooth(0.62, 0.8, re)); // na face medial, o corpo caloso é substância branca exposta
    const din = (0.7 * d - 0.042) * (1 - callosal) - 0.006 * callosal;
    P[i * 3] += Nr[i * 3] * din; P[i * 3 + 1] += Nr[i * 3 + 1] * din; P[i * 3 + 2] += Nr[i * 3 + 2] * din;
  }
  return g;
}

export {
  buildMidline, buildWhiteMatter,
  ID, TISSUE, clamp, smooth, table, classify, hemiShape, cerebShape, cubeSphere,
  buildHemisphere, buildHemiProxy, buildCerebellum, buildCerebProxy,
  buildBrainstem, buildCallosum, buildThalamus, buildInternals,
};
