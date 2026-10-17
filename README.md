# Atlas Cerebral 3D — `<atlas-cerebral>`

Atlas 3D interativo do encéfalo humano, empacotado como **Web Component**: funciona em qualquer site (HTML puro, WordPress, Webflow, React, Next, Vue) sem build.

- `index.html`: demonstração em tela cheia
- `exemplo-embed.html`: o componente dentro de uma página comum, controlado por botões externos

## Como colocar em outro site

1. Copie a pasta `atlas-cerebral/` para o site (por exemplo, `/atlas-cerebral/`).
2. No HTML:

```html
<!-- fontes do visual (opcionais; sem elas o componente usa Georgia/system-ui) -->
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">

<script type="module" src="/atlas-cerebral/atlas-cerebral.js"></script>
<atlas-cerebral style="height: 100vh"></atlas-cerebral>
```

Os arquivos precisam ser servidos por HTTP, porque módulos ES não abrem via `file://`. Qualquer hospedagem estática serve.

### React / Next

```tsx
'use client'
import { useEffect } from 'react'

export function Atlas() {
  useEffect(() => { import('/atlas-cerebral/atlas-cerebral.js') }, [])
  return <atlas-cerebral style={{ height: '100vh', display: 'block' }} />
}
```

## Opções

| Atributo | Efeito |
|---|---|
| `no-autorotate` | não gira sozinho quando ocioso |
| `no-labels` | começa sem os nomes sobre o modelo |
| `mode="areas"` | abre direto nas áreas funcionais |
| `poster="/img/cerebro.webp"` | imagem exibida enquanto o 3D carrega |
| `quality="low"` ou `"high"` | força a resolução da malha (padrão: automática pelo tamanho da tela) |
| `<div slot="title">…</div>` | substitui o título do canto superior (vazio = sem título) |

O tamanho é o do elemento: defina `height` (ou `aspect-ratio`) no CSS. O layout se adapta à largura do próprio componente, e abaixo de 860 px usa o layout de celular.

## API (JavaScript)

```js
const atlas = document.querySelector('atlas-cerebral');
await atlas.ready;                  // modelo construído
atlas.select('hippocampus');        // foca e isola uma parte
atlas.setCut('coronal');            // 'sagittal' | 'coronal' | 'axial' | null
atlas.setMode('areas');             // 'estruturas' | 'areas'
atlas.reset();                      // visão geral

atlas.addEventListener('atlas-select', (e) => console.log(e.detail)); // { key, id, name } ou null
```

Chaves: `frontal`, `parietal`, `temporal`, `occipital`, `cerebellum`, `brainstem`, `callosum`, `thalamus`, `hippocampus`, `basal`, `ventricles`, `amygdala`, `hypothalamus`, `pituitary`, `prefrontal`, `motor`, `somato`, `broca`, `wernicke`, `auditory`, `visual`.

## Estrutura

| Arquivo | Conteúdo |
|---|---|
| `atlas-cerebral/atlas-cerebral.js` | componente: cena, interface, interação, API |
| `atlas-cerebral/anatomy.js` | geometria anatômica procedural (hemisférios, giros e sulcos, cerebelo, tronco, estruturas internas) |
| `atlas-cerebral/content.pt-BR.js` | textos das regiões; copie e traduza para outro idioma |
| `atlas-cerebral/deps.js` | único ponto de dependências (three.js 0.160 via jsDelivr); troque para auto-hospedar |

## Comportamento

- **Isolar:** clicar numa parte deixa a parte sólida e o resto em raio‑X; a parte é sempre desenhada à frente e enquadrada inteira no espaço livre.
- **Ver por dentro:** três cortes fixos ("Ao meio", "De frente", "Por cima"), com a fatia preenchida (substância cinzenta, branca e cada estrutura interna).
- **Rotação:** gira devagar quando ninguém mexe; para ao interagir e volta após 4 s. Desligada para quem usa `prefers-reduced-motion`.
- **Desempenho:** o 3D só é construído quando o componente entra na tela; pixel ratio limitado a 2; malha mais leve em telas pequenas.

## Texturas

- **Por fora:** relevo fino de tecido úmido, manchas sutis, sombreamento nos sulcos e vasos da pia-máter, tudo procedural no shader (sem arquivos de imagem).
- **Por dentro:** a massa branca acompanha os giros a cerca de 3 mm da superfície. As fatias têm textura própria: pontinhos de vasos, estrias de fibras na massa branca e listras no corpo estriado.

## Conteúdo e fontes

Cada região traz "onde fica", funções, "quando algo dá errado", uma curiosidade e links para as fontes. Os textos foram escritos para este projeto a partir de fatos de fontes universitárias, sem copiar texto:

- [OpenStax · Anatomy & Physiology 2e, cap. 13](https://openstax.org/books/anatomy-and-physiology-2e/pages/13-2-the-central-nervous-system) (Rice University, CC BY 4.0)
- [Neuroscience Online](https://nba.uth.tmc.edu/neuroscience/) (McGovern Medical School, UTHealth Houston)
- [Queensland Brain Institute · Sistema límbico](https://qbi.uq.edu.au/brain/brain-anatomy/limbic-system) (University of Queensland)
- [Neuroanatomia em 3D · Tel Aviv University](https://www.neuroanatomy.sites.tau.ac.il/3d-models), só como link "para estudar mais": o material deles é CC BY-NC-ND (proíbe adaptar e uso comercial)

Não use modelos, texturas ou textos extraídos de outros atlas (TAU, Neurotorium, Anatly etc.) sem licença: são protegidos por direito autoral.

## Limitações

O modelo é uma reconstrução anatômica procedural: as proporções e os marcos (sulcos central, lateral e calcarino, lobos, áreas de Brodmann) são aproximados, não vêm de uma ressonância real. Para precisão de exame de imagem, troque a geometria de `anatomy.js` por malhas segmentadas de um atlas aberto, mantendo os atributos `aLobe`/`aArea`; a interação continua funcionando.
