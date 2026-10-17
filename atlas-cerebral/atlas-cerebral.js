/* <atlas-cerebral> — atlas 3D interativo do encéfalo humano, como Web Component.
   Uso em qualquer site:
     <script type="module" src="/atlas-cerebral/atlas-cerebral.js"></script>
     <atlas-cerebral style="height: 100vh"></atlas-cerebral>
   Atributos: no-autorotate · no-labels · mode="areas" · poster="url" · quality="low|high"
   Eventos:   atlas-ready · atlas-select (detail: { key, id, name } | null)
   Métodos:   select(key) · reset() · setCut('sagittal'|'coronal'|'axial'|null) · setMode('estruturas'|'areas') */
import { THREE, OrbitControls, RoomEnvironment } from './deps.js';
import {
  ID, clamp, classify, hemiShape, cerebShape, cubeSphere,
  buildHemisphere, buildHemiProxy, buildCerebellum, buildCerebProxy,
  buildBrainstem, buildCallosum, buildThalamus, buildInternals, buildMidline, buildWhiteMatter,
} from './anatomy.js';
import { REGIONS, LISTS, SUB, VIEW_OVERRIDE, SOURCES } from './content.pt-BR.js';

const KEY_OF = Object.fromEntries(Object.entries(ID).map(([k, v]) => [v, k]));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// cortes fixos no cérebro (não acompanham a câmera). Mantém o lado onde n·p + pos ≥ 0.
const CUTS = {
  sagittal: { n: [-1, 0, 0], min: -0.6, max: 0.6, def: 0.08, dir: [1, 0.16, 0.06], ends: ['orelha direita', 'orelha esquerda'] },
  coronal: { n: [0, 0, -1], min: -0.82, max: 0.74, def: -0.05, dir: [0.18, 0.16, 1], ends: ['nuca', 'testa'] },
  axial: { n: [0, -1, 0], min: -0.7, max: 0.5, def: 0.03, dir: [0.12, 1, 0.42], ends: ['pescoço', 'topo da cabeça'] },
};
const VIEWS = {
  lateral: [4.1, 0.1, 0.0], frontal: [0.0, 0.25, 4.1], superior: [0.0, 4.2, 0.02],
  posterior: [0.0, 0.25, -4.1], inferior: [0.0, -4.2, 0.02],
};
const CAP_DEFS = [
  { key: 'gray', color: '#9c6660', kind: 'gray' }, { key: 'white', color: '#d6c3ad', kind: 'white' },
  { key: 'cerebGray', color: '#93605a', kind: 'gray' }, { key: 'cerebWhite', color: '#d3bfa9', kind: 'white' },
  { key: 'stem', color: '#d2b9a4', id: ID.brainstem, kind: 'white' }, { key: 'callosum', color: '#e2d4c3', id: ID.callosum, kind: 'white' },
  { key: 'thalamus', color: '#c99a8f', id: ID.thalamus, kind: 'deep' }, { key: 'hypothalamus', color: '#c48f86', id: ID.hypothalamus, kind: 'deep' },
  { key: 'basal', color: '#b4938a', id: ID.basal, kind: 'basal' }, { key: 'hippocampus', color: '#cf8e85', id: ID.hippocampus, kind: 'deep' },
  { key: 'amygdala', color: '#c5867c', id: ID.amygdala, kind: 'deep' }, { key: 'pituitary', color: '#d6a08e', id: ID.pituitary, kind: 'deep' },
  { key: 'ventricles', color: '#7fb5e0', id: ID.ventricles, kind: 'csf' },
];

// ruído 3D barato para texturas procedurais no shader
const NOISE_GLSL = `
float atlasH3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float atlasVN(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(atlasH3(i), atlasH3(i + vec3(1, 0, 0)), f.x), mix(atlasH3(i + vec3(0, 1, 0)), atlasH3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(atlasH3(i + vec3(0, 0, 1)), atlasH3(i + vec3(1, 0, 1)), f.x), mix(atlasH3(i + vec3(0, 1, 1)), atlasH3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float atlasFbm(vec3 p) { return 0.5 * atlasVN(p) + 0.25 * atlasVN(p * 2.03) + 0.125 * atlasVN(p * 4.07); }
// pontinhos de vasos perfurantes vistos no corte (células com um ponto aleatório)
float atlasPuncta(vec2 p, float scale, float density) {
  vec2 c = floor(p * scale), f = fract(p * scale);
  float r = atlasH3(vec3(c, 3.7));
  if (r < 1.0 - density) return 0.0;
  vec2 o = vec2(atlasH3(vec3(c, 9.1)), atlasH3(vec3(c, 5.3))) * 0.6 + 0.2;
  return 1.0 - smoothstep(0.05, 0.13, length(f - o));
}`;
// textura de cada tipo de superfície de corte (vP = coordenadas no plano, em unidades do modelo)
const CAP_TEX = {
  gray: `
    float n = atlasFbm(vec3(vP * 55.0, 1.0));
    col *= 0.78 + 0.3 * n;
    col = mix(col, vec3(0.42, 0.1, 0.12), 0.75 * atlasPuncta(vP, 70.0, 0.08));`,
  white: `
    float n = atlasFbm(vec3(vP * 30.0, 2.0));
    float fib = atlasVN(vec3(vP.x * 18.0 + n * 6.0, vP.y * 160.0 + n * 12.0, 4.0)); // estrias de fibras
    col *= 0.8 + 0.22 * n + 0.1 * fib;
    col = mix(col, vec3(0.55, 0.14, 0.15), 0.8 * atlasPuncta(vP, 55.0, 0.06));`,
  deep: `
    float n = atlasFbm(vec3(vP * 70.0, 3.0));
    col *= 0.85 + 0.22 * n;
    col = mix(col, vec3(0.45, 0.12, 0.13), 0.7 * atlasPuncta(vP, 80.0, 0.07));`,
  basal: `
    float n = atlasFbm(vec3(vP * 60.0, 5.0));
    float st = smoothstep(0.55, 0.85, atlasVN(vec3(vP.x * 25.0 + n * 3.0, vP.y * 90.0, 7.0))); // pontes de substância branca (estriado)
    col = mix(col * (0.86 + 0.2 * n), vec3(0.93, 0.88, 0.82), st * 0.75);`,
  csf: `
    float n = atlasFbm(vec3(vP * 20.0, 6.0));
    col *= 0.88 + 0.18 * n;`,
};
const LABELS = {
  0: [ID.frontal, ID.parietal, ID.temporal, ID.occipital, ID.cerebellum, ID.brainstem],
  1: [ID.prefrontal, ID.motor, ID.somato, ID.broca, ID.wernicke, ID.auditory, ID.visual],
};
const INTERNAL = new Set([ID.callosum, ID.thalamus, ID.hippocampus, ID.basal, ID.ventricles, ID.brainstem, ID.amygdala, ID.hypothalamus, ID.pituitary]);
const HEMI_X = 0.347, SPLIT_X = 0.42, IDLE_MS = 4000;
// geometria do layout (px): borda direita do painel lateral e largura ocupada pelo painel de informações
const SIDE_R = 304, INFO_W = 362, MOBILE_W = 860;

const ICON = {
  split: '<svg viewBox="0 0 24 24"><path d="M9 4.5C5.5 4.5 3 7.6 3 12s2.5 7.5 6 7.5V4.5z"/><path d="M15 4.5c3.5 0 6 3.1 6 7.5s-2.5 7.5-6 7.5V4.5z"/></svg>',
  cut: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 2.5v19"/><path d="M12 4a8 8 0 0 1 0 16" fill="currentColor" fill-opacity=".25" stroke="none"/></svg>',
  color: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.8-1.8 0-1.3-1-1.7-1-2.7 0-1 .8-1.6 1.8-1.6H17a4 4 0 0 0 4-4C21 6.4 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/></svg>',
  label: '<svg viewBox="0 0 24 24"><path d="M4 7h11l5 5-5 5H4z"/><circle cx="8.5" cy="12" r="1.2"/></svg>',
  rotate: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4.5h-4.5"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10v9h11v-9"/></svg>',
};
const CUT_ICON = {
  sagittal: '<svg viewBox="0 0 52 36"><path class="b" d="M25 5C15 5 8 11 8 19c0 7 6 12 13 12h4V5zM27 5c10 0 17 6 17 14 0 7-6 12-13 12h-4V5z"/><path class="k" d="M26 2v32"/></svg>',
  coronal: '<svg viewBox="0 0 52 36"><path class="b" d="M6 20C6 10 15 4 26 4s20 5 20 14c0 6-4 9-9 9H14c-5 0-8-3-8-7z"/><path class="k" d="M27 1v34"/></svg>',
  axial: '<svg viewBox="0 0 52 36"><path class="b" d="M6 20C6 10 15 4 26 4s20 5 20 14c0 6-4 9-9 9H14c-5 0-8-3-8-7z"/><path class="k" d="M2 14h48"/></svg>',
};

const STYLE = /* css */ `
:host {
  --bg: #07090d; --panel: rgba(16,19,26,.74); --panel-solid: #10131a;
  --line: rgba(255,255,255,.08); --line-strong: rgba(255,255,255,.16);
  --text: #e9ecf2; --muted: #8b93a5; --accent: #f1a99b;
  --serif: 'Instrument Serif', Georgia, serif; --sans: Inter, system-ui, sans-serif;
  display: block; position: relative; height: 640px; min-height: 480px; overflow: hidden;
  container: atlas / inline-size;
  background: radial-gradient(120% 90% at 58% 40%, #1a1f2b 0%, #0b0e14 55%, var(--bg) 100%);
  color: var(--text); font: 14px/1.4 var(--sans); -webkit-font-smoothing: antialiased;
}
* { box-sizing: border-box; }
button { font: inherit; color: inherit; }
.stage { position: absolute; inset: 0; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; outline: none; cursor: grab; }
canvas:active { cursor: grabbing; }
.poster { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: opacity .6s; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 16px;
  backdrop-filter: blur(18px) saturate(140%); -webkit-backdrop-filter: blur(18px) saturate(140%); }
.dot { width: 10px; height: 10px; border-radius: 50%; flex: none; box-shadow: 0 0 0 3px rgba(255,255,255,.05); }

.brand { position: absolute; top: 22px; left: 24px; pointer-events: none; transition: opacity .3s; }
.eyebrow { font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: var(--muted); }
.brand h1 { margin: 4px 0 0; font: 400 32px/1.05 var(--serif); letter-spacing: -.01em; }
.brand h1 em { color: var(--accent); }

/* painel lateral: explorar | ver por dentro */
#side { position: absolute; left: 20px; top: 96px; width: 272px; max-height: calc(100% - 180px); overflow: auto; padding: 10px; scrollbar-width: thin; }
.seg { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; background: rgba(255,255,255,.04); border-radius: 11px; margin-bottom: 8px; }
.seg button { border: 0; background: transparent; padding: 8px 6px; border-radius: 8px; cursor: pointer; color: var(--muted); font-size: 12.5px; font-weight: 500; }
.seg button.on { background: rgba(255,255,255,.1); color: var(--text); }
#list { list-style: none; margin: 0; padding: 0; }
#list button { width: 100%; display: flex; align-items: center; gap: 10px; text-align: left; padding: 8px 10px; border: 0; border-radius: 9px; background: transparent; cursor: pointer; }
#list button:hover, #list button:focus-visible { background: rgba(255,255,255,.05); outline: none; }
#list button.on { background: rgba(255,255,255,.1); }
#list .name { flex: 1; font-size: 13.5px; }
#list .sub { color: var(--muted); font-size: 11px; }
#cutpanel { padding: 4px 4px 2px; }
.back { border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 4px 6px; border-radius: 8px; font-size: 12.5px; }
.back:hover { color: var(--text); background: rgba(255,255,255,.05); }
#cutpanel h2 { font: 400 24px/1.1 var(--serif); margin: 6px 4px 4px; }
.help { margin: 0 4px 12px; color: var(--muted); font-size: 12.5px; line-height: 1.5; }
.cut-opts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.cut-opts button { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 9px 4px 8px; border-radius: 12px;
  border: 1px solid var(--line); background: rgba(255,255,255,.03); cursor: pointer; transition: border-color .15s, background .15s; }
.cut-opts button:hover { background: rgba(255,255,255,.06); }
.cut-opts button.on { border-color: rgba(241,169,155,.6); background: rgba(241,169,155,.12); }
.cut-opts svg { width: 46px; height: 32px; }
.cut-opts .b { fill: rgba(241,169,155,.18); stroke: #d9a59a; stroke-width: 1.4; }
.cut-opts .k { stroke: #fff; stroke-width: 1.8; stroke-dasharray: 3 2.5; fill: none; }
.cut-opts span { font-size: 12.5px; font-weight: 500; }
.cut-opts small { font-size: 10.5px; color: var(--muted); line-height: 1.25; text-align: center; }
.cut-move { margin: 16px 4px 0; }
.lab { font-size: 10px; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
#cut-range { width: 100%; margin: 0; accent-color: var(--accent); }
.ticks { display: flex; justify-content: space-between; font-size: 11.5px; color: #c3c9d6; margin-top: 4px; }
.legend { display: grid; gap: 6px; margin: 14px 4px 4px; padding-top: 12px; border-top: 1px solid var(--line); font-size: 12px; color: #c3c9d6; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 8px; vertical-align: -1px; }

/* informações */
#info { position: absolute; right: 20px; top: 20px; width: 330px; padding: 22px 22px 18px; max-height: calc(100% - 110px); overflow: auto;
  opacity: 0; transform: translateX(16px); pointer-events: none; transition: opacity .35s ease, transform .35s ease; }
#info.show { opacity: 1; transform: none; pointer-events: auto; }
#info .tag { display: flex; align-items: center; gap: 8px; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); padding-right: 30px; }
#info h2 { font: 400 32px/1.05 var(--serif); margin: 10px 0 2px; }
#info .latin { font-style: italic; color: var(--muted); margin-bottom: 14px; }
#info p { line-height: 1.6; color: #c9cfdb; margin: 0 0 14px; }
#info h3 { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); font-weight: 500; margin: 16px 0 8px; }
#info ul { margin: 0; padding-left: 18px; line-height: 1.65; color: #c9cfdb; }
#info .fact { margin-top: 16px; padding: 12px 14px; border-radius: 12px; background: rgba(255,255,255,.04); border: 1px solid var(--line); line-height: 1.55; color: #c9cfdb; }
#info .fact b { color: var(--text); font-weight: 600; }
#info ul.src { padding-left: 0; list-style: none; font-size: 12px; line-height: 1.5; }
#info ul.src li { margin-bottom: 6px; }
#info ul.src a { color: #9fb7e8; text-decoration: none; border-bottom: 1px solid rgba(159,183,232,.3); }
#info ul.src a:hover { color: #c7d6f5; }
#info .close { position: absolute; top: 14px; right: 14px; width: 30px; height: 30px; border-radius: 50%; border: 1px solid var(--line); background: transparent; cursor: pointer; color: var(--muted); }
#info .close:hover { color: var(--text); border-color: var(--line-strong); }

/* barra de ferramentas */
#toolbar { position: absolute; left: calc(50% + 0px); bottom: 18px; transform: translateX(-50%); display: flex; align-items: center; gap: 6px; padding: 6px; max-width: calc(100% - 24px); }
#toolbar .group { display: flex; align-items: center; gap: 2px; }
.glabel { font-size: 10px; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); margin: 0 8px; }
#toolbar .sep { width: 1px; height: 26px; background: var(--line); margin: 0 4px; flex: none; }
#toolbar button { display: inline-flex; align-items: center; gap: 7px; border: 0; background: transparent; padding: 9px 12px; border-radius: 10px;
  cursor: pointer; color: #c3c9d6; font-size: 12.5px; font-weight: 500; white-space: nowrap; transition: background .15s, color .15s; }
#toolbar button:hover { background: rgba(255,255,255,.06); color: var(--text); }
#toolbar button.on { background: rgba(241,169,155,.16); color: #ffd9d1; }
#toolbar button.icon { padding: 9px; }
#toolbar button.primary { background: rgba(255,255,255,.08); color: var(--text); }
#toolbar svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; flex: none; }
.seg-sm { display: flex; gap: 2px; padding: 3px; border-radius: 11px; background: rgba(255,255,255,.04); }
.seg-sm button { padding: 7px 10px !important; font-size: 12px !important; border-radius: 8px !important; }

/* rótulos 3D */
#labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.pin { position: absolute; left: 0; top: 0; display: flex; align-items: center; gap: 7px; padding: 5px 10px 5px 8px; border-radius: 999px;
  background: rgba(10,12,17,.72); border: 1px solid var(--line-strong); font-size: 12px; font-weight: 500; white-space: nowrap;
  pointer-events: auto; cursor: pointer; color: var(--text); transition: opacity .25s; backdrop-filter: blur(6px); }
.pin::before { content: ''; position: absolute; left: -16px; top: 50%; width: 16px; height: 1px; background: rgba(255,255,255,.45); }
.pin::after { content: ''; position: absolute; left: -20px; top: calc(50% - 3px); width: 6px; height: 6px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 3px rgba(255,255,255,.18); }
.pin:hover { border-color: rgba(255,255,255,.4); }
.pin.off { opacity: 0; pointer-events: none; }

#tip { position: absolute; pointer-events: none; padding: 7px 11px; border-radius: 9px; background: rgba(10,12,17,.9); border: 1px solid var(--line-strong);
  font-size: 12.5px; font-weight: 500; transform: translate(14px, 14px); opacity: 0; transition: opacity .15s; white-space: nowrap; display: flex; gap: 8px; align-items: center; }
#tip.show { opacity: 1; }
#loader { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(7,9,13,.92); transition: opacity .6s ease; z-index: 5; }
#loader.hide { opacity: 0; pointer-events: none; }
#loader .ttl { font: 400 26px var(--serif); text-align: center; }
#loader .bar { width: 220px; height: 2px; background: rgba(255,255,255,.08); border-radius: 2px; margin: 18px auto 10px; overflow: hidden; }
#loader .bar i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .3s ease; }
#loader .msg { color: var(--muted); font-size: 12px; text-align: center; }

@container atlas (max-width: 1180px) { .glabel { display: none; } }
@container atlas (max-width: 1000px) { #toolbar .lbl.opt { display: none; } }
@container atlas (max-width: 860px) {
  .brand { top: 14px; left: 16px; } .brand h1 { font-size: 24px; }
  #side { left: 12px; right: 12px; top: auto; bottom: 70px; width: auto; max-height: 52%; padding: 8px; }
  #side.explore #list { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
  #side.explore #list button { white-space: nowrap; padding: 8px 10px; }
  #side.explore .sub { display: none; }
  #info { left: 12px; right: 12px; top: auto; bottom: 70px; width: auto; max-height: 50%; z-index: 3; background: var(--panel-solid); }
  #toolbar { left: 12px; right: 12px; transform: none; bottom: 12px; justify-content: space-between; overflow-x: auto; scrollbar-width: none; max-width: none; }
  #toolbar #views, #toolbar .sep.v, #toolbar .lbl { display: none; }
  .busy .brand { opacity: 0; }
  .pin { font-size: 11px; }
}
`;

const TEMPLATE = /* html */ `
<div class="stage">
  <canvas tabindex="0" aria-label="Modelo 3D interativo do encéfalo humano. Arraste para girar, role para aproximar e clique numa parte para ver detalhes."></canvas>
  <div id="labels"></div>
  <header class="brand"><slot name="title"><div class="eyebrow">Neurociência · Atlas interativo</div><h1>Encéfalo <em>humano</em></h1></slot></header>

  <aside id="side" class="panel explore">
    <section id="explore">
      <div class="seg" role="tablist">
        <button id="mode-0" class="on" role="tab">Estruturas</button>
        <button id="mode-1" role="tab">Áreas funcionais</button>
      </div>
      <ul id="list"></ul>
    </section>
    <section id="cutpanel" hidden>
      <button class="back" id="cut-back">← Voltar às estruturas</button>
      <h2>Ver por dentro</h2>
      <p class="help">Escolha como fatiar o cérebro. Depois arraste a barra para mover a fatia.</p>
      <div class="cut-opts">
        <button data-cut="sagittal">${CUT_ICON.sagittal}<span>Ao meio</span><small>esquerda e direita</small></button>
        <button data-cut="coronal">${CUT_ICON.coronal}<span>De frente</span><small>como fatias de pão</small></button>
        <button data-cut="axial">${CUT_ICON.axial}<span>Por cima</span><small>como tirar a tampa</small></button>
      </div>
      <div class="cut-move">
        <div class="lab">Mover a fatia</div>
        <input id="cut-range" type="range" min="0" max="1000" value="500" aria-label="Posição da fatia">
        <div class="ticks"><span id="end-a"></span><span id="end-b"></span></div>
      </div>
      <div class="legend">
        <span><i style="background:#9c6660"></i>Substância cinzenta · corpos dos neurônios</span>
        <span><i style="background:#d6c3ad"></i>Substância branca · conexões entre neurônios</span>
        <span><i style="background:#7fb5e0"></i>Ventrículos · cavidades com líquido</span>
      </div>
    </section>
  </aside>

  <section id="info" class="panel" aria-live="polite">
    <button class="close" id="info-close" aria-label="Fechar">✕</button>
    <div class="tag"><span class="dot" id="info-dot"></span><span id="info-tag"></span></div>
    <h2 id="info-title"></h2>
    <div class="latin" id="info-latin"></div>
    <p id="info-desc"></p>
    <h3>Onde fica</h3>
    <p id="info-where"></p>
    <h3>Funções principais</h3>
    <ul id="info-fn"></ul>
    <h3>Quando algo dá errado</h3>
    <p id="info-clinical"></p>
    <div class="fact" id="info-fact"></div>
    <h3>Fontes</h3>
    <ul class="src" id="info-src"></ul>
  </section>

  <nav id="toolbar" class="panel" aria-label="Controles do modelo">
    <div class="group" id="views" role="group" aria-label="Vistas">
      <span class="glabel">Vista</span>
      <div class="seg-sm">
        <button data-view="lateral">Lado</button><button data-view="frontal">Frente</button><button data-view="superior">Topo</button>
        <button data-view="posterior">Trás</button><button data-view="inferior">Base</button>
      </div>
    </div>
    <span class="sep v"></span>
    <div class="group" role="group" aria-label="Ferramentas">
      <button id="btn-cut" title="Fatiar o cérebro para ver o interior">${ICON.cut}<span class="lbl">Ver por dentro</span></button>
      <button id="btn-split" title="Afastar os hemisférios">${ICON.split}<span class="lbl opt">Separar</span></button>
      <button id="btn-atlas" title="Colorir por região">${ICON.color}<span class="lbl opt">Cores</span></button>
      <button id="btn-labels" class="on" title="Mostrar nomes no modelo">${ICON.label}<span class="lbl opt">Nomes</span></button>
    </div>
    <span class="sep"></span>
    <div class="group" role="group" aria-label="Câmera">
      <button id="btn-rotate" class="icon on" title="Girar quando ninguém mexe" aria-label="Girar quando ninguém mexe">${ICON.rotate}</button>
      <button id="btn-reset" class="primary" title="Voltar à visão geral (Esc)">${ICON.home}<span class="lbl">Visão geral</span></button>
    </div>
  </nav>

  <div id="tip"><span class="dot" id="tip-dot"></span><span id="tip-text"></span></div>
  <div id="loader"><div>
    <div class="ttl">Esculpindo o córtex…</div>
    <div class="bar"><i id="load-bar"></i></div>
    <div class="msg" id="load-msg">Preparando</div>
  </div></div>
</div>`;

class AtlasCerebral extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = `<style>${STYLE}</style>${TEMPLATE}`;
    this.ready = new Promise((r) => { this._resolveReady = r; });
  }

  connectedCallback() {
    if (this._booted) return;
    this._booted = true;
    const poster = this.getAttribute('poster');
    if (poster) {
      const img = Object.assign(document.createElement('img'), { src: poster, alt: '', className: 'poster' });
      this.shadowRoot.querySelector('.stage').prepend(img);
      this._poster = img;
    }
    // só constrói o 3D quando o componente entra na tela
    this._io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { this._io.disconnect(); this._init().catch((err) => this._fail(err)); }
    }, { rootMargin: '200px' });
    this._io.observe(this);
  }

  disconnectedCallback() {
    this._io?.disconnect();
    this._ro?.disconnect();
    cancelAnimationFrame(this._raf);
    this._cleanup?.();
  }

  _fail(err) {
    console.error(err);
    this.shadowRoot.getElementById('load-msg').textContent = 'Não foi possível carregar o modelo 3D neste navegador.';
  }

  async _init() {
    const host = this, root = this.shadowRoot;
    const $ = (id) => root.getElementById(id);
    const W = () => host.clientWidth, H = () => host.clientHeight;
    const isMobile = () => W() <= MOBILE_W;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('WebGL indisponível');

    /* ---------------- cena ---------------- */
    const canvas = root.querySelector('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, stencil: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(W(), H(), false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.autoClear = false;
    renderer.localClippingEnabled = true;

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    scene.environmentIntensity = 0.4;

    const camera = new THREE.PerspectiveCamera(32, W() / H(), 0.05, 50);
    const HOME = { pos: new THREE.Vector3(3.2, 1.25, 2.3), target: new THREE.Vector3(0, -0.2, -0.02) };
    camera.position.copy(HOME.pos);

    const controls = new OrbitControls(camera, canvas);
    controls.target.copy(HOME.target);
    Object.assign(controls, {
      enableDamping: true, dampingFactor: 0.07, minDistance: 0.3, maxDistance: 7,
      zoomToCursor: false, autoRotate: false, autoRotateSpeed: 0.45, rotateSpeed: 0.7,
    });

    const key = new THREE.DirectionalLight(0xfff1ea, 2.4); key.position.set(3, 4, 2.5);
    const fill = new THREE.DirectionalLight(0xb9c8ff, 0.7); fill.position.set(-3, 1, -1);
    const rim = new THREE.DirectionalLight(0xffd6cc, 1.4); rim.position.set(0, 2, -4);
    const hemiLight = new THREE.HemisphereLight(0xffeee8, 0x2a1d22, 0.45);
    for (const l of [key, fill, rim, hemiLight]) { l.layers.enableAll(); scene.add(l); }

    { // sombra de contato
      const cv = document.createElement('canvas'); cv.width = cv.height = 256;
      const cx = cv.getContext('2d');
      const gr = cx.createRadialGradient(128, 128, 0, 128, 128, 128);
      gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = gr; cx.fillRect(0, 0, 256, 256);
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
      sh.rotation.x = -Math.PI / 2; sh.position.set(0, -1.12, -0.1);
      scene.add(sh);
    }

    /* ---------------- materiais: sólido + fantasma (raio-X) ---------------- */
    const palette = Array.from({ length: 24 }, () => new THREE.Color(0x888888));
    for (const [id, r] of Object.entries(REGIONS)) palette[id] = new THREE.Color(r.color);
    const U = {
      uMode: { value: 0 }, uHover: { value: -1 }, uIso: { value: -1 }, uAtlas: { value: 0 },
      uFocus: { value: 0 }, uTime: { value: 0 }, uCut: { value: 0 }, uPal: { value: palette },
    };
    const cutPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1000);

    const patchShader = () => (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aLobe; attribute float aArea; attribute float aCav;
          flat varying float vLobe; flat varying float vArea; varying float vCav; varying vec3 vObj;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vLobe = aLobe; vArea = aArea; vCav = aCav; vObj = position;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uMode, uHover, uIso, uAtlas, uFocus, uTime, uCut; uniform vec3 uPal[24];
          varying vec3 vObj;
          ${NOISE_GLSL}
          flat varying float vLobe; flat varying float vArea; varying float vCav;
          float gH, gI; vec3 gRc;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            float rid = uMode < 0.5 ? vLobe : vArea;
            int ri = int(clamp(rid + 0.5, 0.0, 23.0));
            gRc = uPal[ri];
            float has = step(0.5, rid);
            gH = has * (1.0 - step(0.5, abs(rid - uHover)));
            gI = has * (1.0 - step(0.5, abs(rid - uIso)));
            #ifdef GHOST
              if (uIso < 0.5 || gI > 0.5 || uCut > 0.5) discard;
            #else
              if (uIso > 0.5 && gI < 0.5 && uCut < 0.5) discard;
            #endif
            vec3 col = diffuseColor.rgb;
            vec3 atlasCol = gRc * (0.32 + 0.68 * pow(vCav, 0.8));
            col = mix(col, atlasCol, uAtlas * has * 0.88);
            col = mix(col, col * vec3(0.62, 0.62, 0.66), uAtlas * (1.0 - has) * uMode);
            col = mix(col, gRc * (0.45 + 0.55 * vCav), gH * (0.5 - 0.3 * uAtlas));
            #ifdef GHOST
              float lum = dot(col, vec3(0.299, 0.587, 0.114));
              col = mix(col, vec3(lum) * vec3(0.85, 0.92, 1.05), 0.55);
            #else
              float dimC = uCut * step(0.5, uIso) * (1.0 - gI);
              col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))) * 0.55, dimC * 0.7);
              if (!gl_FrontFacing) col = vec3(0.78, 0.64, 0.55) * (0.75 + 0.25 * vCav);
              else {
                // manchas sutis do tecido
                col *= 0.93 + 0.12 * atlasFbm(vObj * 38.0);
                col *= 0.55 + 0.45 * smoothstep(0.0, 0.9, vCav); // oclusão nos sulcos
                // vasos da pia-máter sobre o córtex (veias arroxeadas, ramos finos)
                if (vLobe > 0.5 && vLobe < 4.5) {
                  vec3 q = vObj + 0.08 * vec3(atlasVN(vObj * 4.0), atlasVN(vObj * 4.0 + 7.3), atlasVN(vObj * 4.0 + 3.1));
                  float a = atlasFbm(q * 2.4) - 0.4375, b = atlasFbm(q * 6.5 + 11.0) - 0.4375; // 0.4375 = média do fbm
                  float va = 1.0 - smoothstep(0.0, fwidth(a) * 1.5 + 0.006, abs(a));
                  float vb = 1.0 - smoothstep(0.0, fwidth(b) * 1.2 + 0.0035, abs(b));
                  float vessel = max(va, vb * 0.5) * smoothstep(0.2, 0.7, vCav);
                  col = mix(col, vec3(0.32, 0.05, 0.11), vessel * 0.75);
                }
              }
            #endif
            diffuseColor.rgb = col;
          }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          #ifndef GHOST
          if (gl_FrontFacing) {
            // relevo fino de tecido úmido (bump procedural por derivadas de tela)
            vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
            float hb = atlasFbm(vObj * 60.0);
            float dhx = dFdx(hb), dhy = dFdy(hb);
            vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
            float det = dot(dpdx, r1);
            vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
            normal = normalize(abs(det) * normal - 0.0016 * grad);
          }
          #endif`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            vec3 vd = normalize(vViewPosition);
            float fr = pow(1.0 - clamp(abs(dot(normal, vd)), 0.0, 1.0), 2.5);
            float pulse = 0.8 + 0.2 * sin(uTime * 4.0);
            #ifdef GHOST
              diffuseColor.a = mix(1.0, 0.018 + 0.26 * fr + 0.12 * gH, uFocus);
              totalEmissiveRadiance += vec3(0.55, 0.68, 0.9) * fr * 0.18 * uFocus + gRc * gH * 0.3 * pulse;
            #else
              totalEmissiveRadiance += gRc * (gH * (0.06 + 0.3 * fr) * pulse + gI * uFocus * (0.03 + 0.3 * fr));
              totalEmissiveRadiance += vec3(1.0, 0.72, 0.66) * fr * 0.05 * (1.0 - uFocus);
            #endif
          }`);
    };
    const matSolid = new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.5, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.42,
      sheen: 0.35, sheenRoughness: 0.5, sheenColor: new THREE.Color('#ffc4b8'),
      side: THREE.DoubleSide, clippingPlanes: [cutPlane],
    });
    matSolid.onBeforeCompile = patchShader();
    matSolid.customProgramCacheKey = () => 'atlas-solid';
    const matGhost = new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.4, metalness: 0, transparent: true, depthWrite: true, clippingPlanes: [cutPlane],
    });
    matGhost.defines = { GHOST: '' };
    matGhost.onBeforeCompile = patchShader();
    matGhost.customProgramCacheKey = () => 'atlas-ghost';
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });

    const ghosts = [], pickables = [], solids = [];
    function addPart(parent, geo, order, id) {
      const solid = new THREE.Mesh(geo, matSolid);
      const ghost = new THREE.Mesh(geo, matGhost);
      ghost.renderOrder = order; ghost.visible = false; ghost.layers.set(1);
      solid.add(ghost); ghosts.push(ghost);
      parent.add(solid); solids.push(solid);
      if (id) { solid.userData.id = id; pickables.push(solid); }
      return solid;
    }

    /* Preenchimento da fatia via stencil: faces de trás somam, da frente subtraem;
       onde sobra ≠ 0 o plano está dentro do volume e a "tampa" é pintada. */
    const capGeo = new THREE.PlaneGeometry(6, 6);
    const caps = CAP_DEFS.map((d, i) => {
      const mat = new THREE.MeshStandardMaterial({
        color: d.color, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, depthFunc: THREE.LessEqualDepth,
        stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
        stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
      });
      mat.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vP;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position.xy;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vP;\n' + NOISE_GLSL)
          .replace('#include <color_fragment>', `#include <color_fragment>
            { vec3 col = diffuseColor.rgb; ${CAP_TEX[d.kind]} diffuseColor.rgb = col; }`);
      };
      mat.customProgramCacheKey = () => 'atlas-cap-' + d.kind;
      if (d.kind === 'csf') { mat.roughness = 0.25; }
      const mesh = new THREE.Mesh(capGeo, mat);
      mesh.layers.set(2 + i); mesh.renderOrder = 2;
      scene.add(mesh);
      return { ...d, layer: 2 + i, base: new THREE.Color(d.color), mat, mesh };
    });
    const capByKey = Object.fromEntries(caps.map((c) => [c.key, c]));
    const stencilMat = (side, op) => new THREE.MeshBasicMaterial({
      side, colorWrite: false, depthWrite: false, depthTest: false, clippingPlanes: [cutPlane],
      stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilFail: op, stencilZFail: op, stencilZPass: op,
    });
    const stencilBack = stencilMat(THREE.BackSide, THREE.IncrementWrapStencilOp);
    const stencilFront = stencilMat(THREE.FrontSide, THREE.DecrementWrapStencilOp);
    function addStencil(holder, geo, k) {
      for (const m of [stencilBack, stencilFront]) {
        const st = new THREE.Mesh(geo, m);
        st.layers.set(capByKey[k].layer); st.renderOrder = 1;
        holder.add(st);
      }
    }
    function buildInnerShell(N, shape, inset) {
      const g = cubeSphere(N);
      const P = g.attributes.position.array, tmp = [0, 0, 0];
      for (let i = 0; i < P.length; i += 3) { shape(P[i], P[i + 1], P[i + 2], tmp); P[i] = tmp[0]; P[i + 1] = tmp[1]; P[i + 2] = tmp[2]; }
      g.computeVertexNormals();
      const Nr = g.attributes.normal.array;
      for (let i = 0; i < P.length; i++) P[i] -= Nr[i] * inset;
      return g;
    }

    /* ---------------- montagem ---------------- */
    const brain = new THREE.Group();
    scene.add(brain);
    const hemi = { L: new THREE.Group(), R: new THREE.Group() };
    hemi.L.position.x = HEMI_X;
    hemi.R.position.x = -HEMI_X; hemi.R.scale.x = -1;
    brain.add(hemi.L, hemi.R);

    const regionStats = {}, anchors = {}, boxes = {}, pins = {};
    const bar = $('load-bar'), msg = $('load-msg');
    const step = async (p, m) => { bar.style.width = p + '%'; msg.textContent = m; await nextFrame(); };
    const q = host.getAttribute('quality');
    const low = q === 'low' || (q !== 'high' && Math.min(screen.width, screen.height) < 700);
    const N = low ? 150 : 224;

    await step(8, 'Hemisfério esquerdo · giros e sulcos');
    const gL = buildHemisphere(N, 7, true, regionStats);
    addStencil(addPart(hemi.L, gL, 3), gL, 'gray');
    await step(42, 'Hemisfério direito');
    const gR = buildHemisphere(N, 19, false, null);
    addStencil(addPart(hemi.R, gR, 3), gR, 'gray');
    await step(60, 'Substância branca');
    const whiteN = low ? 120 : 170;
    const whiteG = { L: buildWhiteMatter(whiteN, 7), R: buildWhiteMatter(whiteN, 19) };
    const proxyG = buildHemiProxy();
    for (const h of [hemi.L, hemi.R]) {
      const holder = new THREE.Object3D(); h.add(holder); addStencil(holder, whiteG[h === hemi.L ? 'L' : 'R'], 'white');
      const p = new THREE.Mesh(proxyG, proxyMat); p.userData.cortex = h === hemi.L ? 'L' : 'R'; h.add(p); pickables.push(p);
    }

    await step(72, 'Cerebelo · folhas');
    const cereb = new THREE.Group();
    cereb.position.set(0, -0.33, -0.41); cereb.rotation.x = -0.26;
    const cerebG = buildCerebellum(low ? 100 : 136, 3);
    addStencil(addPart(cereb, cerebG, 2), cerebG, 'cerebGray');
    { const holder = new THREE.Object3D(); cereb.add(holder); addStencil(holder, buildInnerShell(40, cerebShape, 0.06), 'cerebWhite'); }
    const cp = new THREE.Mesh(buildCerebProxy(), proxyMat); cp.userData.id = ID.cerebellum; cereb.add(cp); pickables.push(cp);
    brain.add(cereb);

    await step(86, 'Tronco encefálico, tálamo e corpo caloso');
    const stem = addPart(brain, buildBrainstem(170, 96), 2, ID.brainstem);
    addStencil(stem, stem.geometry, 'stem');
    const cc = addPart(brain, buildCallosum(), 1, ID.callosum);
    addStencil(cc, cc.geometry, 'callosum');
    const thG = buildThalamus();
    for (const sx of [1, -1]) {
      const th = addPart(brain, thG, 1, ID.thalamus); th.position.set(0.075 * sx, -0.02, -0.07);
      addStencil(th, thG, 'thalamus');
    }
    const mid = buildMidline();
    addStencil(addPart(brain, mid.hypothalamus, 1, ID.hypothalamus), mid.hypothalamus, 'hypothalamus');
    for (const g of mid.pituitary) addStencil(addPart(brain, g, 2, ID.pituitary), g, 'pituitary');

    await step(94, 'Hipocampo, núcleos da base e ventrículos');
    const capKeyOf = { [ID.hippocampus]: 'hippocampus', [ID.basal]: 'basal', [ID.ventricles]: 'ventricles', [ID.amygdala]: 'amygdala' };
    const internals = buildInternals();
    for (const h of [hemi.L, hemi.R]) internals.forEach((g) => {
      const id = g.attributes.aLobe.array[0];
      addStencil(addPart(h, g, 1, id), g, capKeyOf[id]);
    });

    // direção de foco do córtex = normal média da região
    for (const [id, s] of Object.entries(regionStats)) anchors[id] = { normal: s.n.clone().normalize() };

    // caixas reais de cada região (para enquadrar 100%) — sem o hemisfério direito
    brain.updateMatrixWorld(true);
    {
      const v = new THREE.Vector3();
      for (const m of solids) {
        let o = m, left = false, right = false;
        while (o) { if (o === hemi.L) left = true; if (o === hemi.R) right = true; o = o.parent; }
        if (right && !INTERNAL.has(m.userData.id)) continue; // córtex: só o lado esquerdo; estruturas internas: o par
        const P = m.geometry.attributes.position, L = m.geometry.attributes.aLobe.array, A = m.geometry.attributes.aArea.array;
        for (let i = 0; i < P.count; i++) {
          const a = L[i], b = A[i];
          if (a <= 0 && b <= 0) continue;
          v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld);
          for (const id of a === b ? [a] : [a, b]) {
            if (id <= 0) continue;
            (boxes[id] || (boxes[id] = { box: new THREE.Box3(), left })).box.expandByPoint(v);
          }
        }
      }
    }
    // pontos dos rótulos: vértice de superfície da região mais próximo do centro dela
    {
      const P = gL.attributes.position.array, Nn = gL.attributes.normal.array;
      const L = gL.attributes.aLobe.array, A = gL.attributes.aArea.array;
      // âncora na face externa (x local > 0): centro dos vértices laterais da região e o vértice mais próximo dele
      const ids = [...LABELS[0], ...LABELS[1]].filter((id) => regionStats[id]);
      const acc = {};
      for (let i = 0; i < L.length; i++) {
        if (P[i * 3] < 0.05) continue;
        for (const id of [L[i], A[i]]) {
          if (!ids.includes(id)) continue;
          const c = acc[id] || (acc[id] = { x: 0, y: 0, z: 0, n: 0, d: Infinity, i: -1 });
          c.x += P[i * 3]; c.y += P[i * 3 + 1]; c.z += P[i * 3 + 2]; c.n++;
        }
      }
      for (const c of Object.values(acc)) { c.x /= c.n; c.y /= c.n; c.z /= c.n; }
      for (let i = 0; i < L.length; i++) {
        if (P[i * 3] < 0.05) continue;
        for (const id of [L[i], A[i]]) {
          const c = acc[id];
          if (!c) continue;
          const d = (P[i * 3] - c.x) ** 2 + (P[i * 3 + 1] - c.y) ** 2 + (P[i * 3 + 2] - c.z) ** 2;
          if (d < c.d) { c.d = d; c.i = i; }
        }
      }
      for (const [id, c] of Object.entries(acc)) {
        const local = new THREE.Vector3(P[c.i * 3], P[c.i * 3 + 1], P[c.i * 3 + 2]);
        pins[id] = { obj: hemi.L, local, normal: local.clone().sub(new THREE.Vector3(0, -0.05, 0)).normalize() };
      }
      pins[ID.cerebellum] = { obj: cereb, local: new THREE.Vector3(0.3, -0.06, -0.2), normal: new THREE.Vector3(0.6, -0.2, -0.8).normalize() };
      pins[ID.brainstem] = { obj: brain, local: new THREE.Vector3(0.06, -0.62, -0.02), normal: new THREE.Vector3(0.7, 0, 0.7).normalize() };
    }

    /* ---------------- estado e câmera ---------------- */
    const state = { mode: 0, atlas: 0, hover: -1, listHover: -1, sel: -1, split: false, userSplit: false, cut: null, cutPos: 0, labels: !host.hasAttribute('no-labels') };
    const anim = { atlas: 0, split: 0, focus: 0, labels: 1 };
    let isoId = -1, tween = null, down = null, lastActive = -Infinity;
    let idleRotate = !reducedMotion && !host.hasAttribute('no-autorotate');
    const markActive = () => { lastActive = performance.now(); };

    function flyTo(pos, target, dur = 1400) {
      if (reducedMotion) dur = 1;
      tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone(), start: performance.now(), dur };
    }
    const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
    const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _d0 = new THREE.Vector3(), _d1 = new THREE.Vector3();
    function updateTween(now) {
      if (!tween) return;
      const k = clamp((now - tween.start) / tween.dur), e = ease(k);
      controls.target.lerpVectors(tween.t0, tween.t1, e);
      _d0.subVectors(tween.p0, tween.t0); _d1.subVectors(tween.p1, tween.t1);
      const l0 = _d0.length(), l1 = _d1.length();
      _d0.normalize(); _d1.normalize();
      _q.setFromUnitVectors(_d0, _d1);
      _qi.identity().slerp(_q, e);
      camera.position.copy(_d0.applyQuaternion(_qi).multiplyScalar(l0 + (l1 - l0) * e)).add(controls.target);
      if (k >= 1) tween = null;
    }

    // enquadramento: a parte fica centralizada no espaço livre entre os painéis
    const viewOff = { x: 0, y: 0 };
    function desiredOffset() {
      if (isMobile()) return { x: 0, y: state.sel > 0 || state.cut ? H() * 0.25 : 0 };
      return { x: state.sel > 0 ? (INFO_W - SIDE_R) / 2 : -SIDE_R / 2, y: 0 };
    }
    function applyOffset() {
      camera.setViewOffset(W(), H(), viewOff.x, viewOff.y, W(), H());
      camera.updateProjectionMatrix();
    }
    function fitDistance(r) {
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const freeW = isMobile() ? W() - 32 : W() - SIDE_R - (state.sel > 0 ? INFO_W : 0) - 40;
      const freeH = isMobile() ? (state.sel > 0 || state.cut ? H() * 0.36 : H() - 220) : H() - 150;
      const tV = tanHalf * (freeH / H());
      const tH = tanHalf * camera.aspect * (Math.max(freeW, 120) / W());
      return Math.max(controls.minDistance + r, (r * 1.04) / Math.sin(Math.atan(Math.min(tV, tH))));
    }
    // visão geral: mantém a direção, mas afasta o suficiente para o encéfalo inteiro caber
    const homePos = (dir = HOME.pos.clone().sub(HOME.target)) =>
      HOME.target.clone().add(dir.setLength(Math.max(HOME.pos.distanceTo(HOME.target), fitDistance(0.98))));
    function fitView() {
      if (!W() || !H()) return;
      camera.aspect = W() / H();
      Object.assign(viewOff, desiredOffset());
      applyOffset();
      renderer.setSize(W(), H(), false);
    }
    this._ro = new ResizeObserver(fitView);
    this._ro.observe(host);
    fitView();
    camera.position.copy(homePos());

    /* ---------------- ações ---------------- */
    const setBtn = (id, on) => $(id).classList.toggle('on', !!on);

    function focusRegion(id) {
      const R = REGIONS[id];
      if (!R || !boxes[id]) return;
      state.sel = id;
      markActive();
      if (R.split && !state.split) setSplit(true, false);
      if (!R.split && state.split && !state.userSplit) setSplit(false, false);
      const bx = boxes[id];
      const center = bx.box.getCenter(new THREE.Vector3());
      if (bx.left && state.split) center.x += SPLIT_X;
      const radius = bx.box.getSize(new THREE.Vector3()).length() / 2;
      const ov = VIEW_OVERRIDE[id];
      const dir = state.cut ? new THREE.Vector3(...CUTS[state.cut].dir)
        : ov ? new THREE.Vector3(...ov.dir)
        : anchors[id].normal.clone().lerp(new THREE.Vector3(0, 0.25, 0), 0.15);
      dir.normalize();
      flyTo(center.clone().addScaledVector(dir, fitDistance(radius)), center);
      showInfo(id);
      renderList();
      host.dispatchEvent(new CustomEvent('atlas-select', { detail: { key: KEY_OF[id], id, name: R.name }, bubbles: true, composed: true }));
    }

    function resetView() {
      const had = state.sel > 0;
      state.sel = -1;
      hideInfo();
      if (!state.userSplit) setSplit(false, false);
      if (state.cut) setCut(null);
      flyTo(homePos(), HOME.target, 1300);
      renderList();
      if (had) host.dispatchEvent(new CustomEvent('atlas-select', { detail: null, bubbles: true, composed: true }));
    }

    function setSplit(on, byUser) {
      state.split = on;
      if (byUser) state.userSplit = on;
      setBtn('btn-split', on);
    }

    function setMode(m) {
      state.mode = m;
      setBtn('mode-0', m === 0); setBtn('mode-1', m === 1);
      U.uMode.value = m;
      setAtlas(m === 1 ? true : state.atlas);
      if (state.sel !== -1 && !LISTS[m].includes(state.sel)) resetView();
      renderList(); renderPins();
    }
    function setAtlas(on) { state.atlas = on ? 1 : 0; setBtn('btn-atlas', on); }

    function setCut(mode) {
      state.cut = mode || null;
      setBtn('btn-cut', !!mode);
      $('explore').hidden = !!mode;
      $('cutpanel').hidden = !mode;
      $('side').classList.toggle('explore', !mode);
      root.querySelectorAll('[data-cut]').forEach((b) => b.classList.toggle('on', b.dataset.cut === mode));
      if (!mode) return;
      const C = CUTS[mode];
      state.cutPos = C.def;
      $('cut-range').value = Math.round(((C.def - C.min) / (C.max - C.min)) * 1000);
      $('end-a').textContent = '← ' + C.ends[0]; $('end-b').textContent = C.ends[1] + ' →';
      markActive();
      const dir = new THREE.Vector3(...C.dir).normalize();
      let center = HOME.target.clone(), r = 1.0;
      if (state.sel > 0 && boxes[state.sel]) {
        center = boxes[state.sel].box.getCenter(new THREE.Vector3());
        r = boxes[state.sel].box.getSize(new THREE.Vector3()).length() / 2;
      }
      flyTo(center.clone().addScaledVector(dir, fitDistance(r)), center, 1200);
    }

    // lista
    const listEl = $('list');
    function renderList() {
      listEl.innerHTML = '';
      for (const id of LISTS[state.mode]) {
        const R = REGIONS[id];
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.className = state.sel === id ? 'on' : '';
        b.innerHTML = `<span class="dot" style="background:${R.color}"></span><span class="name">${R.name}</span>${SUB[id] ? `<span class="sub">${SUB[id]}</span>` : ''}`;
        b.onclick = () => focusRegion(id);
        b.onmouseenter = b.onfocus = () => { state.listHover = id; };
        b.onmouseleave = b.onblur = () => { state.listHover = -1; };
        li.appendChild(b); listEl.appendChild(li);
      }
    }

    // informações
    function showInfo(id) {
      const R = REGIONS[id];
      $('info-dot').style.background = R.color;
      $('info-tag').textContent = R.tag;
      $('info-title').textContent = R.name;
      $('info-latin').textContent = R.latin;
      $('info-desc').textContent = R.desc;
      $('info-where').textContent = R.where || '';
      $('info-fn').innerHTML = R.fn.map((f) => `<li>${f}</li>`).join('');
      $('info-clinical').textContent = R.clinical || '';
      $('info-fact').innerHTML = R.fact;
      $('info-src').innerHTML = (R.src || []).map((k) => SOURCES[k])
        .map((s) => `<li><a href="${s.url}" target="_blank" rel="noopener">${s.label}</a></li>`).join('');
      $('info').scrollTop = 0;
      $('info').classList.add('show');
    }
    const hideInfo = () => $('info').classList.remove('show');

    // rótulos 3D
    const pinEls = {};
    function renderPins() {
      $('labels').innerHTML = '';
      for (const id of LABELS[state.mode]) {
        if (!pins[id]) continue;
        const el = document.createElement('button');
        el.className = 'pin off';
        el.innerHTML = `<span class="dot" style="background:${REGIONS[id].color};width:8px;height:8px"></span>${REGIONS[id].name}`;
        el.onclick = () => focusRegion(+id);
        el.onmouseenter = () => { state.listHover = +id; };
        el.onmouseleave = () => { state.listHover = -1; };
        $('labels').appendChild(el);
        pinEls[id] = el;
      }
      for (const k of Object.keys(pinEls)) if (!LABELS[state.mode].includes(+k)) delete pinEls[k];
    }
    const _pw = new THREE.Vector3(), _pn = new THREE.Vector3(), _toCam = new THREE.Vector3(), _occ = new THREE.Raycaster();
    let pinFrame = 0;
    function updatePins() {
      const show = state.labels && state.sel < 0 && !state.cut && !tween;
      const doOcc = pinFrame++ % 4 === 0;
      for (const [id, el] of Object.entries(pinEls)) {
        const p = pins[id];
        p.obj.updateWorldMatrix(true, false);
        _pn.copy(p.normal).transformDirection(p.obj.matrixWorld);
        _pw.copy(p.local).applyMatrix4(p.obj.matrixWorld).addScaledVector(_pn, 0.06);
        _toCam.subVectors(camera.position, _pw);
        const dist = _toCam.length();
        let vis = show && _pn.dot(_toCam.normalize()) > 0.2;
        if (vis && doOcc) {
          // oclusão: algo entre a câmera e o ponto?
          _occ.set(camera.position, _toCam.clone().negate());
          const hit = _occ.intersectObjects(pickables, false)[0];
          el.dataset.occ = hit && hit.distance < dist - 0.06 ? '1' : '';
        }
        if (vis && el.dataset.occ) vis = false;
        _pw.project(camera);
        const x = (_pw.x * 0.5 + 0.5) * W(), y = (-_pw.y * 0.5 + 0.5) * H();
        el.style.transform = `translate(${x + 20}px, ${y - 13}px)`;
        el.classList.toggle('off', !vis || _pw.z > 1);
      }
    }

    /* ---------------- seleção pelo ponteiro ---------------- */
    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
    const cls = [0, 0], _lp = new THREE.Vector3(), _pp = new THREE.Vector3();
    let pointerInside = false, needPick = false, lastEvt = null;
    const setMouse = (e) => {
      const r = canvas.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    function regionOfPoint(o, point) {
      o.parent.worldToLocal(_lp.copy(point));
      classify(_lp.x, _lp.y, _lp.z, o.userData.cortex === 'L', cls);
      return state.mode === 0 ? cls[0] : cls[1] || -1;
    }
    const regionOfHit = (h) => (h.object.userData.cortex ? regionOfPoint(h.object, h.point) : h.object.userData.id);
    function pickCut(all) {
      const kept = all.filter((h) => cutPlane.distanceToPoint(h.point) >= -1e-4);
      const P = ray.ray.intersectPlane(cutPlane, _pp);
      if (P) {
        const tP = ray.ray.origin.distanceTo(P);
        if (!kept.length || tP < kept[0].distance) {
          // dentro de quais volumes está o ponto da fatia? (paridade de cruzamentos)
          const cnt = new Map();
          for (const h of kept) if (h.distance > tP) cnt.set(h.object, (cnt.get(h.object) || 0) + 1);
          let best = null;
          for (const [o, n] of cnt) {
            if (n % 2 === 0) continue;
            const pr = o.userData.cortex ? 0 : o.userData.id === ID.cerebellum ? 1 : 2;
            if (!best || pr > best.pr) best = { o, pr };
          }
          if (best) return best.o.userData.cortex ? regionOfPoint(best.o, P) : best.o.userData.id;
        }
      }
      return kept.length ? regionOfHit(kept[0]) : -1;
    }
    function pick() {
      ray.setFromCamera(mouse, camera);
      const hits = ray.intersectObjects(pickables, false);
      if (state.cut) return pickCut(hits);
      if (!hits.length) return -1;
      const ids = hits.map(regionOfHit);
      if (isoId > 0) {
        if (ids.includes(isoId)) return isoId;
        const inner = ids.find((id) => INTERNAL.has(id));
        if (inner) return inner;
      }
      return ids[0];
    }

    const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); return () => el.removeEventListener(ev, fn, opt); };
    const offs = [
      on(canvas, 'pointermove', (e) => { markActive(); setMouse(e); pointerInside = true; needPick = true; lastEvt = e; }),
      on(canvas, 'pointerleave', () => { pointerInside = false; state.hover = -1; $('tip').classList.remove('show'); }),
      on(canvas, 'pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; tween = null; markActive(); }),
      on(canvas, 'pointerup', (e) => {
        if (!down) return;
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        down = null;
        if (moved > 5) return;
        setMouse(e);
        const id = pick();
        if (id > 0 && REGIONS[id]) focusRegion(id);
      }),
      on(canvas, 'wheel', () => { tween = null; markActive(); }, { passive: true }),
      on(host, 'keydown', (e) => { markActive(); if (e.key === 'Escape') resetView(); }),
      on(host, 'touchstart', markActive, { passive: true }),
    ];
    this._cleanup = () => { offs.forEach((f) => f()); renderer.dispose(); };

    $('mode-0').onclick = () => setMode(0);
    $('mode-1').onclick = () => setMode(1);
    $('btn-split').onclick = () => setSplit(!state.split, true);
    $('btn-atlas').onclick = () => setAtlas(!state.atlas);
    $('btn-labels').onclick = () => { state.labels = !state.labels; setBtn('btn-labels', state.labels); };
    $('btn-cut').onclick = () => setCut(state.cut ? null : 'sagittal');
    $('cut-back').onclick = () => setCut(null);
    root.querySelectorAll('[data-cut]').forEach((b) => { b.onclick = () => setCut(b.dataset.cut); });
    $('cut-range').oninput = (e) => {
      const C = CUTS[state.cut];
      state.cutPos = C.min + (e.target.value / 1000) * (C.max - C.min);
      markActive();
    };
    $('btn-rotate').onclick = () => { idleRotate = !idleRotate; setBtn('btn-rotate', idleRotate); };
    $('btn-reset').onclick = resetView;
    $('info-close').onclick = resetView;
    root.querySelectorAll('[data-view]').forEach((b) => {
      b.onclick = () => { markActive(); flyTo(homePos(new THREE.Vector3(...VIEWS[b.dataset.view])), HOME.target, 1200); };
    });
    setBtn('btn-rotate', idleRotate);
    setBtn('btn-labels', state.labels);

    // API pública
    this.select = (k) => { const id = typeof k === 'number' ? k : ID[k]; if (id) focusRegion(id); };
    this.reset = resetView;
    this.setCut = (m) => setCut(m && CUTS[m] ? m : null);
    this.setMode = (m) => setMode(m === 'areas' || m === 1 ? 1 : 0);

    /* ---------------- loop ---------------- */
    const tipEl = $('tip'), stage = root.querySelector('.stage');
    const clock = new THREE.Clock();
    const _cn = new THREE.Vector3(), _cp = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
    const loop = (now) => {
      const dt = Math.min(clock.getDelta(), 0.05);
      const k = 1 - Math.exp(-dt * 7);

      if (needPick && pointerInside && !down) {
        needPick = false;
        const id = pick();
        state.hover = id;
        if (id > 0 && REGIONS[id]) {
          const r = canvas.getBoundingClientRect();
          tipEl.classList.add('show');
          $('tip-dot').style.background = REGIONS[id].color;
          $('tip-text').textContent = REGIONS[id].name;
          tipEl.style.left = lastEvt.clientX - r.left + 'px'; tipEl.style.top = lastEvt.clientY - r.top + 'px';
          canvas.style.cursor = 'pointer';
        } else { tipEl.classList.remove('show'); canvas.style.cursor = ''; }
      }

      const hov = state.listHover > 0 ? state.listHover : state.hover;
      U.uHover.value = hov > 0 ? hov : -1;
      anim.atlas += (state.atlas - anim.atlas) * k;
      anim.split += ((state.split ? 1 : 0) - anim.split) * k * 0.8;
      anim.focus += ((state.sel > 0 ? 1 : 0) - anim.focus) * k;
      U.uAtlas.value = anim.atlas;
      U.uFocus.value = anim.focus;
      U.uCut.value = state.cut ? 1 : 0;
      stage.classList.toggle('busy', state.sel > 0 || !!state.cut);
      if (state.sel > 0) isoId = state.sel; else if (anim.focus < 0.01) isoId = -1;
      U.uIso.value = isoId;
      for (const g of ghosts) g.visible = isoId > 0 && !state.cut;
      const want = desiredOffset();
      if (Math.abs(want.x - viewOff.x) + Math.abs(want.y - viewOff.y) > 0.3) {
        viewOff.x += (want.x - viewOff.x) * k; viewOff.y += (want.y - viewOff.y) * k; applyOffset();
      }
      controls.autoRotate = idleRotate && !state.cut && !tween && !down && now - lastActive > IDLE_MS;
      U.uTime.value = now / 1000;
      hemi.L.position.x = HEMI_X + SPLIT_X * anim.split;
      hemi.R.position.x = -HEMI_X - SPLIT_X * anim.split;

      updateTween(now);
      controls.update();
      if (state.cut) {
        cutPlane.set(_cn.set(...CUTS[state.cut].n), state.cutPos);
        for (const c of caps) {
          c.mesh.position.copy(cutPlane.normal).multiplyScalar(-cutPlane.constant);
          c.mesh.quaternion.setFromUnitVectors(_z, cutPlane.normal);
          const t = c.id ? (c.id === hov ? 0.4 : c.id === state.sel ? 0.5 * anim.focus : 0) : 0;
          c.mat.color.copy(c.base).lerp(palette[c.id || 0], t);
        }
      } else cutPlane.set(_cn.set(0, 1, 0), 1000);

      renderer.clear();
      if (isoId > 0 && !state.cut) {
        camera.layers.set(1); renderer.render(scene, camera);
        renderer.clearDepth(); // a parte isolada fica sempre à frente do fantasma
      }
      camera.layers.set(0); renderer.render(scene, camera);
      if (state.cut) for (const c of caps) { camera.layers.set(c.layer); renderer.render(scene, camera); }
      updatePins();
      this._raf = requestAnimationFrame(loop);
    };

    renderList(); renderPins();
    if (host.getAttribute('mode') === 'areas') setMode(1);
    await step(100, 'Pronto');
    $('loader').classList.add('hide');
    if (this._poster) this._poster.style.opacity = '0';
    this._raf = requestAnimationFrame(loop);
    this._resolveReady(this);
    host.dispatchEvent(new CustomEvent('atlas-ready', { bubbles: true, composed: true }));
  }
}

if (!customElements.get('atlas-cerebral')) customElements.define('atlas-cerebral', AtlasCerebral);
export { AtlasCerebral };
