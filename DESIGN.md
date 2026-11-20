---
name: AWS Cost Playground
description: Prancha de arquitetura AWS com o custo mensal escrito no próprio desenho.
---

<!-- SEED: definido antes da implementação (Issue #4). Quando existir código em web/, rode `impeccable document` em modo scan para levar os tokens reais ao frontmatter e gerar .impeccable/design.json. -->

# Design System: AWS Cost Playground

Fonte da verdade visual do `web/`. Os blocos `css` deste arquivo são os tokens normativos: a Issue do esqueleto os copia para `web/src/shared/ui/tokens.css` sem mudar nomes nem valores. Os nomes seguem `assets/app.css` da skill `design-taste-frontend`, para que o CSS base dela sirva sem renomear nada. Produto, público e escopo estão em [PRODUCT.md](PRODUCT.md) e no [PRD](docs/product/aws-cost-playground/PRD.md); aqui só entra o que é visual.

Origem: `ui-ux-pro-max` (estilo Minimalism & Swiss, IBM Plex Sans, densidade alta), `design-taste-frontend` (`draw.mjs --app --kind builder`, estilo `framed-sheet`, seed 20627501) e `impeccable` (modo Operate, `concept-seed` seed:1388cfa49c751380, direção nº 3). O histórico das escolhas está em `docs/handoff/4.md`.

## Overview

**Creative North Star: "A prancha cotada"**

O design é um desenho técnico. Na prancha de engenharia, cada peça tem sua cota escrita ao lado e o canto inferior direito guarda o carimbo com o que importa: nome, escala, data, responsável. Aqui o canvas é a prancha, cada bloco e cada aresta cobrada levam a cota de custo mensal, e o carimbo, fixo no canto, mostra o total, o fixo, o variável, a região e a data do catálogo. O usuário lê o preço onde ele nasce, sem trocar de tela.

O mundo da prancha entra com só quatro coisas: o tipo (IBM Plex, família de origem industrial com números tabulares de verdade), a paleta (moldura cor de papel vegetal, tinta quase preta, cinco tintas de categoria), a densidade (média para alta, de ferramenta de trabalho) e um movimento-assinatura (cotas e carimbo). Navegação, abas, campos e botões são os padrões da web. Ninguém precisa aprender a interface antes de usá-la.

A tela é clara por padrão, com tema escuro completo. É uma ferramenta de sessão longa em desktop, lida como documento de orçamento, e o estilo sorteado (`framed-sheet`) é claro. O escuro existe para quem trabalha à noite e segue `prefers-color-scheme` até o usuário escolher.

**Key Characteristics:**
- Moldura tingida em L (barra superior e paleta) e o trabalho numa folha branca com borda de 1px, cantos de 16px e nenhuma sombra.
- Cor tem três funções e só três: a categoria do bloco, onde você está (seleção e foco) e o estado (erro, aviso, sucesso).
- Todo valor em dólar aparece em IBM Plex Mono, alinhado à direita, com o mesmo número de casas.
- Fixo é tinta sólida, variável é tinta hachurada: a separação se lê sem cor.
- Nada flutua em repouso; sombra só no que está por cima (menu, popover, diálogo, bloco sendo arrastado).

## Colors

Estratégia contida: neutros tingidos da moldura, tinta quase preta para texto e dinheiro, um teal para interação e cinco tintas de categoria, que valem como identidade e não como dado.

### Neutros, ação e estado

| Token | Papel |
|---|---|
| `--ground` | Moldura: barra superior, paleta, coluna direita. Papel vegetal azulado no claro; preto neutro no escuro. |
| `--surface` | A folha (canvas), cartões, inputs, diálogos. |
| `--raised` | Poço dentro da folha, fundo de controle desabilitado, barra de carregamento. |
| `--active` | Item ativo de lista e linha selecionada que abre detalhe. |
| `--border` | Borda da folha e dos cartões. |
| `--rule` | Régua entre linhas de tabela e trilho de barras. |
| `--control` | Borda de input, select e botão secundário. Passa 3:1 (WCAG 1.4.11). |
| `--text` | Texto principal, valores em dólar, parte fixa do custo. |
| `--muted` | Texto secundário, rótulos de campo, valores de origem "padrão". |
| `--faint` | Meta, placeholder, unidade dentro do campo, travessão de valor ausente. |
| `--primary` / `--primary-ink` / `--primary-hover` | O único botão cheio da tela: quase preto no claro, invertido no escuro. |
| `--accent` | Teal de prancha: seleção, foco, aba ativa, links. Nunca em dado nem em categoria. |
| `--focus` | Anel de foco do teclado (igual a `--accent`). |
| `--edge` | Traço das arestas no canvas. Passa 3:1 sobre a folha. |
| `--chart-muted` | Barras finas de proporção nas listas de custo. É redundante: o número ao lado carrega a informação. |
| `--positive`, `--negative`, `--warning` e pares `--pill-*` | Estado. Texto colorido sobre a superfície ou pílula clara com tinta escura do mesmo tom. |
| `--scrim` | Fundo atrás de diálogo modal. |

**A regra das três funções.** A cor diz o que o bloco é (categoria), o teal diz onde você está (seleção e foco) e vermelho, âmbar e verde dizem o estado. Custo é sempre tinta: nenhum valor em dólar ganha cor por ser alto, baixo, fixo ou variável.

**A regra da moldura quieta.** A moldura nunca escurece nem satura no tema claro. O teal na moldura aparece só na aba ativa e no foco, em menos de 3% dos pixels da tela.

```css
:root {
  color-scheme: light;
  /* neutros: moldura de papel vegetal, folha branca */
  --ground: #f0f5f9;
  --surface: #ffffff;
  --raised: #f4f6f8;
  --active: #e8eef2;
  --border: #dde3e8;
  --rule: #eef1f3;
  --control: #868c93;
  --text: #131416;
  --muted: #56595c;
  --faint: #63676b;
  /* ação e interação */
  --primary: #1d1f20;
  --primary-ink: #ffffff;
  --primary-hover: #383b3d;
  --accent: #1b6c80;
  --accent-ink: #ffffff;
  --focus: var(--accent);
  /* canvas e dados */
  --edge: #6b7177;
  --chart-muted: #c3c9ce;
  --changed: rgb(27 108 128 / 0.12);
  --scrim: rgb(19 20 22 / 0.32);
  /* estado */
  --positive: #1e7b4f;
  --negative: #c4242a;
  --warning: #92400e;
  --pill-positive-bg: #dcfae5; --pill-positive-ink: #04250e;
  --pill-negative-bg: #ffedea; --pill-negative-ink: #831c1e;
  --pill-warning-bg: #fffbeb;  --pill-warning-ink: #92400e;  --pill-warning-border: #fde68a;
  --pill-neutral-bg: #ebedee;  --pill-neutral-ink: #353736;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  /* escuro neutro, sem navy nem slate; profundidade por claridade */
  --ground: #0d0e0f;
  --surface: #161718;
  --raised: #1e2021;
  --active: #26282a;
  --border: #2c2f31;
  --rule: #212325;
  --control: #6d7378;
  --text: #f2f3f4;
  --muted: #b4b7ba;
  --faint: #999da1;
  --primary: #f2f3f4;
  --primary-ink: #131416;
  --primary-hover: #d4d6d8;
  --accent: #64bdd2;
  --accent-ink: #0d0e0f;
  --edge: #80868c;
  --chart-muted: #4a4e52;
  --changed: rgb(100 189 210 / 0.16);
  --scrim: rgb(0 0 0 / 0.6);
  --positive: #3fc07a;
  --negative: #ef6b80;
  --warning: #e3a856;
  --pill-positive-bg: #172a1d; --pill-positive-ink: #3fc07a;
  --pill-negative-bg: #2c1a20; --pill-negative-ink: #ef6b80;
  --pill-warning-bg: #2e2312;  --pill-warning-ink: #e3a856;  --pill-warning-border: #5c4520;
  --pill-neutral-bg: #2a2c2e;  --pill-neutral-ink: #d6d8da;
}
```

O tema segue `prefers-color-scheme` até o usuário escolher. A escolha grava `data-theme="light"` ou `data-theme="dark"` no `<html>`; o bloco `:root` acima vale para o claro e para "sem escolha" num sistema claro. A Issue do esqueleto replica o bloco escuro dentro de `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }`.

### Categorias dos blocos

Cada categoria tem duas tintas: `ink` (ícone, texto e borda da categoria) e `tint` (fundo do ladrilho de tipo). A categoria nunca é dita só pela cor: o ladrilho sempre leva o ícone da categoria e o bloco leva o nome do serviço (WCAG 1.4.1).

| Categoria | Blocos | Ícone (Lucide) | Tokens |
|---|---|---|---|
| Computação | EC2, ECS, Lambda | `cpu` | `--cat-compute-ink` · `--cat-compute-tint` |
| Dados | RDS, DynamoDB, ElastiCache, S3, SQS | `database` | `--cat-data-ink` · `--cat-data-tint` |
| Rede | Route 53, CloudFront, ALB, NAT Gateway | `network` | `--cat-network-ink` · `--cat-network-tint` |
| Segurança | WAF, Cognito, IAM, Secrets Manager | `shield` | `--cat-security-ink` · `--cat-security-tint` |
| Operação | CloudWatch, CloudTrail, CodePipeline, CloudFormation | `activity` | `--cat-ops-ink` · `--cat-ops-tint` |

O nó fixo `client` (Internet) não tem categoria: ladrilho `--raised`, ícone `globe` em `--text`.

Os matizes foram escolhidos fora das zonas já ocupadas: o teal da interação, o vermelho de erro e o violeta (vetado pela casa). Em OKLCH ficam a 55° (laranja), 105° (oliva), 150° (verde), 260° (azul) e 350° (magenta), com o teal em 215°. Ink claro em L 0,47; tint claro em L 0,955; ink escuro em L 0,78; tint escuro em L 0,28.

```css
:root {
  --cat-compute-ink: #8c4400;  --cat-compute-tint: #ffead7;
  --cat-data-ink: #2b58a2;     --cat-data-tint: #e5f1ff;
  --cat-network-ink: #206b38;  --cat-network-tint: #def8e2;
  --cat-security-ink: #942d66; --cat-security-tint: #ffe8f3;
  --cat-ops-ink: #645d00;      --cat-ops-tint: #f4f2d0;
}
:root[data-theme="dark"] {
  --cat-compute-ink: #f2a26a;  --cat-compute-tint: #3a2312;
  --cat-data-ink: #8cb2f1;     --cat-data-tint: #1c293f;
  --cat-network-ink: #7ccd8e;  --cat-network-tint: #1a2e1e;
  --cat-security-ink: #ea91bc; --cat-security-tint: #391f2c;
  --cat-ops-ink: #c8c26b;      --cat-ops-tint: #2c2a11;
}
```

### Contraste verificado

Razões de contraste WCAG 2.x calculadas sobre os valores acima. O piso é 4,5:1 para texto e ícone e 3:1 para borda de controle, traço de aresta e anel de foco.

| Par | Claro | Escuro |
|---|---|---|
| Computação: ink sobre tint · surface · ground | 6,12 · 7,14 · 6,50 | 7,10 · 8,68 · 9,34 |
| Dados: ink sobre tint · surface · ground | 6,08 · 6,95 · 6,34 | 6,78 · 8,34 · 8,97 |
| Rede: ink sobre tint · surface · ground | 5,78 · 6,52 · 5,94 | 7,55 · 9,39 · 10,10 |
| Segurança: ink sobre tint · surface · ground | 6,40 · 7,43 · 6,77 | 6,60 · 7,93 · 8,53 |
| Operação: ink sobre tint · surface · ground | 5,94 · 6,76 · 6,16 | 7,87 · 9,73 · 10,48 |
| `--text` sobre qualquer tint de categoria (mínimo) | 15,80 | 13,00 |
| `--text` sobre surface · ground · active | 18,43 · 16,79 · 15,75 | 16,16 · 17,39 · 13,32 |
| `--muted` sobre surface · ground · active | 7,05 · 6,42 · 6,02 | 8,91 · 9,59 · 7,34 |
| `--faint` sobre surface · ground · active | 5,70 · 5,20 · 4,87 | 6,58 · 7,08 · 5,42 |
| `--accent` (texto, foco) sobre surface · ground · active | 5,99 · 5,46 · 5,12 | 8,34 · 8,97 · 6,87 |
| `--control` (borda) sobre surface · ground | 3,39 · 3,09 | 3,74 · 4,02 |
| `--edge` (traço) sobre surface | 4,94 | 4,88 |
| `--primary-ink` sobre `--primary` · `--primary-hover` | 16,55 · 11,28 | 16,59 · 12,65 |
| `--positive` · `--negative` · `--warning` sobre surface | 5,25 · 5,78 · 7,09 | 7,72 · 6,06 · 8,55 |
| Pílulas positiva · negativa · aviso · neutra | 14,77 · 8,63 · 6,84 · 10,21 | 6,52 · 5,55 · 7,33 · 9,81 |

Qualquer cor nova passa por esta tabela antes de entrar no código.

## Typography

**Display Font:** não há; a interface não usa tipo de display.
**Body Font:** IBM Plex Sans (com `system-ui, -apple-system, "Segoe UI", sans-serif`)
**Label/Mono Font:** IBM Plex Mono (com `ui-monospace, "SF Mono", Menlo, monospace`)

**Character:** uma grotesca de desenho técnico para tudo que se lê e a mono da mesma família para tudo que se conta em dólar, SKU ou ID. A mono é o rosto do produto: o dinheiro sempre tem a mesma cara.

As duas famílias são servidas pelo próprio site (`woff2` no bundle, subconjuntos latin e latin-ext, `font-display: swap`), sob a licença SIL OFL 1.1. Nenhuma fonte vem de CDN de terceiro: mantém a CSP com `font-src 'self'` e evita requisição externa com IP do usuário.

### Hierarchy
- **Title** (600, 22px, 28px): título da tela ou do design. Um por tela.
- **KPI** (400, 28px, 36px, mono): o total mensal no carimbo e no painel de custo. É o maior número da tela e o único nesse tamanho.
- **Section** (600, 16px, 24px): título de painel, de grupo da paleta e de seção do inspetor.
- **Body** (400, 14px, 20px): texto de interface, células, campos, nome do bloco (600).
- **Small** (400 ou 500, 12px, 16px): rótulos de campo, meta, cotas, pílulas, cabeçalhos de tabela. Nada abaixo de 12px.
- **Read** (400, 16px, 26px, até 68ch): corpo das páginas de texto (privacidade, termos); títulos dessas páginas em 28px/600.

```css
:root {
  --font: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --fs-title: 22px;   --lh-title: 28px;
  --fs-kpi: 28px;     --lh-kpi: 36px;
  --fs-section: 16px; --lh-section: 24px;
  --fs-body: 14px;    --lh-body: 20px;
  --fs-small: 12px;   --lh-small: 16px;
  --fs-read: 16px;    --lh-read: 26px;   --measure-read: 68ch;
  --fw-regular: 400;  --fw-medium: 500;  --fw-semibold: 600;
}
```

**A regra da hierarquia por peso.** São cinco tamanhos e três pesos. A hierarquia vem de peso, cor (`--text` contra `--muted`) e posição, não de tamanho novo. Nenhum título passa de 28px e nenhum número chega a 48px.

**A regra do dinheiro tabular.** Todo número que muda ou se compara usa `font-variant-numeric: tabular-nums` e fica alinhado à direita, inclusive na fonte do corpo.

### Números e unidades

- Dólar com `Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" })`: `US$ 1.234,56`. Sempre duas casas.
- Zero real é impresso: `US$ 0,00`. Entre zero e um centavo: `< US$ 0,01`. Valor ausente ou não aplicável: travessão `—` em `--faint`.
- O período vem como sufixo menor em `--muted`: `US$ 84,30` + `/mês`.
- Percentual com uma casa (`38,2%`); contagens sem casas e com separador (`3.000.000 req/mês`).
- Nomes de serviço e de SKU em inglês; SKU, tipo de instância e ID em mono (`t4g.small`, `gp3`).
- Data do catálogo em ISO (`2026-11-16`); momentos recentes em palavras (`Salvo há 2 min`).
- Diferença sempre com sinal no texto: `+US$ 12,40`, `−US$ 3,10` (sinal de menos U+2212).

## Layout

Grade de 4px. Um valor de espaçamento por contexto, repetido na horizontal e na vertical.

```css
:root {
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px;

  /* casca do editor (1440 × 900 é a tela de referência) */
  --topbar-height: 48px;
  --sidebar-width: 232px;     /* paleta */
  --rail-width: 360px;        /* coluna direita: custo, bloco, carga */
  --sheet-inset: 8px;         /* folha recuada da direita e de baixo da janela */
  --panel-gap: 12px;          /* entre paleta, folha e coluna direita */
  --pad: 24px;                /* padding interno da folha nas telas de lista e comparação */
  --gap: 24px;                /* uma calha, horizontal e vertical, nas telas de folha */
  --card-pad: 16px;

  /* controles e linhas */
  --control-height: 32px;     /* botões, inputs e selects em painéis e barras */
  --control-height-form: 40px;/* campos em diálogo e nas páginas de texto */
  --hit-min: 24px;            /* menor alvo clicável (WCAG 2.5.8), mesmo quando o desenho é menor */
  --nav-row: 32px;            /* item da paleta e de menu, num passo de 40px */
  --row-kv: 32px;             /* linha chave-valor no inspetor e no carimbo */
  --row-cost: 36px;           /* linha da lista de custo (texto + barra de 2px) */
  --row-table: 40px;          /* linha de tabela de comparação e lista de designs */
  --row-header: 36px;         /* cabeçalho de tabela */
  --node-width: 216px;        /* todos os blocos têm a mesma largura */
}
```

### A casca do editor

- **Barra superior** (48px, sobre `--ground`, sem régua): marca e nome do produto, nome do design (editável) com a pílula de estado (salvo, não salvo), região, desfazer e refazer, as ações secundárias e um único botão primário.
- **Paleta** (232px, sobre `--ground`): cinco grupos na ordem computação, dados, rede, segurança, operação. Cada grupo tem título Section e itens num passo de 40px: ladrilho de categoria, nome do serviço e alça de arraste.
- **Folha** (o canvas): `--surface`, borda `--border` de 1px, cantos `--radius-sheet`, recuada `--sheet-inset` da direita e de baixo da janela. Sem grade de pontos; o encaixe invisível é de 8px. O carimbo fica preso 16px dentro do canto inferior direito; zoom e minimapa, 16px dentro do canto inferior esquerdo.
- **Coluna direita** (360px, sobre `--ground`): abas no topo com sublinhado de 2px. Painel de custo, inspetor e carga ficam aqui; a composição exata das abas é decisão da Issue do editor.
- Telas que não são o editor (lista de designs, comparação, conta) usam a mesma moldura em L, com a folha ocupando a área de trabalho e `--pad` de padding.

### Regras de densidade para painéis e tabelas de custo

Densidade é três ajustes movidos juntos: passo da linha, padding e tamanho do texto. Não se encolhe um sem os outros.

| Superfície | Passo | Texto | Padding | Regra |
|---|---|---|---|---|
| Lista de custo por bloco (coluna direita) | 36px | 14px; valor em mono | 16px | Uma linha por bloco: ladrilho de 16px, nome em `--text`, valor alinhado à direita. Barra de 2px sob o nome, na proporção real do maior custo; a do mais caro em `--text`, as outras em `--chart-muted`. Ordem: mais caro primeiro; custo zero no fim, em `--muted`. |
| Lista de custo por aresta | 36px | 14px | 16px | O mesmo da lista de blocos. O nome é `origem → destino` e o tipo vem como meta em 12px. |
| Inspetor (atributos e uso) | 32px por linha chave-valor; campos de 32px | Rótulo em 12px/500 `--muted` acima do campo, 4px de distância | 16px; 12px entre campos | Unidade dentro do campo, à direita, em `--faint`. Um grupo por assunto (SKU, uso), separado por 24px. |
| Carimbo | 32px por linha | KPI de 28px para o total; o resto em 12px a 14px | 12px | Células separadas por régua `--rule` de 1px, como o carimbo de uma prancha. |
| Tabela de comparação | 40px; cabeçalho de 36px | 14px; cabeçalho em 12px `--muted`, sem caixa alta | Laterais de 16px | Coluna de identidade com 40% da largura. Números à direita, mono, colunas A, B e Diferença. Totais (total, fixo, variável) numa faixa dividida acima da tabela, não numa linha de rodapé. |
| Lista de designs | 40px | 14px; data em mono 12px | Laterais de 16px | Até 50 itens (limite da API) sem paginação: total no topo e cabeçalho fixo na rolagem. |

- Sem zebra, sem faixa no cabeçalho, sem caixa alta espaçada. Réguas de 1px em `--rule`, ou só espaço.
- Uma borda direita por linha: todos os valores de uma lista terminam na mesma linha de padding.
- Dois números numa célula empilham (total em cima, `fixo · variável` embaixo em 12px `--muted`), em vez de abrir duas colunas num painel estreito.
- Listas longas rolam dentro do painel; o topo do painel (total e barra fixo/variável) fica fixo.

### Larguras

- **1280px ou mais:** casca completa.
- **De 1024px a 1279px:** paleta com 200px e coluna direita com 320px; o resto não muda.
- **Abaixo de 1024px:** o editor não abre. Em vez dele vem uma folha com uma frase dizendo que o editor precisa de pelo menos 1024px de largura e os links para baixar o JSON e para a lista de designs. As páginas de texto funcionam a partir de 320px, com margens de 16px e alvos de pelo menos 44px.

### Decisões de estrutura (ux-laws)

- **Hick e Miller:** 20 blocos em 5 grupos de 3 a 5, sempre na mesma ordem; nenhum grupo recolhido por padrão.
- **Fitts:** controles com 32px; alças de conexão com 8px de desenho e `--hit-min` de área clicável; ações do bloco selecionado no próprio inspetor, ao lado do que mudam.
- **Doherty:** o preço recalcula em menos de 100 ms, sem spinner. Só a estimativa por LLM mostra progresso, e só depois de 400 ms.
- **Pareto e Von Restorff:** o total é o maior número da tela e aparece no carimbo e no topo do painel de custo; mais nada tem esse tamanho.
- **Proximidade e região comum:** agrupar por espaço (24px entre grupos, 12px dentro) antes de agrupar por caixa.

## Elevation & Depth

Plano em repouso. A profundidade vem de um degrau de tom (moldura `--ground`, folha `--surface`, poço `--raised`) e de uma borda de 1px, nunca das duas coisas com sombra. Sombra é só para o que flutua acima do trabalho: menu, popover, tooltip, diálogo e o bloco enquanto é arrastado. No escuro a sombra quase não aparece, então o que flutua também sobe de tom (`--raised`) e ganha a borda `--border`.

### Shadow Vocabulary
- **Flutuante** (`--shadow-float`): menus, popovers, diálogos, bloco em arraste.
- **Dica** (`--shadow-tip`): tooltips e a cota em destaque no hover.

```css
:root {
  --shadow-float: 0 8px 24px rgb(19 20 22 / 0.12), 0 1px 3px rgb(19 20 22 / 0.08);
  --shadow-tip: 0 2px 8px rgb(19 20 22 / 0.12);
}
:root[data-theme="dark"] {
  --shadow-float: 0 8px 24px rgb(0 0 0 / 0.55);
  --shadow-tip: 0 2px 8px rgb(0 0 0 / 0.5);
}
```

**A regra do plano por padrão.** Folha, cartões, blocos e carimbo não têm sombra. Se precisa de sombra para se separar do fundo, o tom ou a borda estão errados.

## Shapes

Raio justo, em degraus que diminuem para dentro: folha 16, cartão e bloco 8, controle 6, ladrilho e pílula 4. Nada entre 10 e 14px, e nenhum controle em pílula redonda.

```css
:root {
  --radius-sheet: 16px;   /* a folha e os painéis da casca */
  --radius-card: 8px;     /* blocos, cartões, carimbo, popovers, diálogos */
  --radius-control: 6px;  /* botões, inputs, selects, abas */
  --radius-chip: 4px;     /* ladrilho de categoria, pílulas, cota de aresta */
  --border-width: 1px;
  --focus-width: 2px;
  --focus-offset: 2px;    /* 3px nos blocos do canvas, para ficar fora da borda de seleção */
}
```

- **Arestas:** traço de 1,5px em `--edge` com ponta de seta. O tipo se lê pelo traçado, não pela cor: `data` contínua, `runs-on` tracejada (6 4), `logs` pontilhada (1,5 4, ponta redonda). Cantos ortogonais com raio de 6px.
- **Hachura do variável:** padrão SVG de linhas a 45°, 1px de `--text` a cada 4px, com contorno de 1px em `--text`. O fixo é `--text` sólido. A mesma dupla vale no carimbo, no painel e na comparação.
- **Ícones:** Lucide, traço de 1,5px, 16px na interface e 14px em linha de texto, sempre em `--muted` ou na tinta da categoria. Não usamos os ícones oficiais da AWS: o produto não é da AWS e não deve parecer.

## Components

Os componentes ainda não existem. Esta seção fixa a anatomia e os estados que cada Issue de interface deve seguir.

### Bloco no canvas (assinatura)
- **Forma:** `--node-width`, `--radius-card`, fundo `--surface`, borda `--border`, padding de 12px.
- **Anatomia fixa:** a mesma em todos os blocos, para que o olho ache cada coisa no mesmo lugar. Linha 1: ladrilho de 24px (`--cat-*-tint`, ícone 16px em `--cat-*-ink`, `--radius-chip`) e nome do serviço em 14px/600. Linha 2: resumo do SKU em 12px mono `--muted` (`t4g.small · 2 AZ`). Linha 3: a cota, com `por mês` à esquerda em `--muted` e o valor em mono 14px à direita.
- **Selecionado:** borda de 2px em `--accent`, desenhada como `outline` para o bloco não mudar de tamanho.
- **Foco (teclado):** anel `--focus` de 2px com 3px de afastamento, fora da borda de seleção.
- **Em arraste:** `--shadow-float`, sem mudar de escala.
- **Custo zero (IAM, CloudFormation, ECS):** a cota mostra `US$ 0,00` em `--muted`. No ECS vem `custo no EC2` como meta.
- **Teclado:** Tab percorre os blocos na ordem de leitura; setas movem 8px (Shift + setas, 40px); Enter abre o inspetor; Delete apaga; Ctrl/Cmd+Z desfaz e Shift+Ctrl/Cmd+Z refaz.

### Arestas e cotas
- A cota de aresta é uma etiqueta no meio do traço: mono 12px/500, fundo `--surface`, borda `--border`, `--radius-chip`, padding de 2px por 6px.
- Arestas `data` e `logs` sempre mostram a cota, mesmo com `US$ 0,00`. Arestas `runs-on` não têm cota, porque o custo está no EC2.
- **Aresta selecionada:** traço de 2px em `--accent`.
- **Sem arraste obrigatório (WCAG 2.5.7):** toda aresta também se cria pelo inspetor do bloco de origem ("Conectar a…", com uma lista de destinos e o tipo da aresta).

### Carimbo (assinatura)
- Cartão de 320px preso no canto inferior direito da folha: `--surface`, borda `--border`, `--radius-card`, sem sombra.
- Linhas separadas por `--rule`: nome do design e região (mono 12px); `Total por mês` em 12px `--muted` sobre o total em KPI; a barra fixo/variável com 8px de altura, na proporção real, e a legenda `Fixo US$ 61,20 · Variável US$ 23,10`; e o aviso `Estimativa on-demand, não é cotação oficial · preços de 2026-11-16` em 12px `--muted`.
- Recolhe para uma linha (`US$ 84,30/mês · estimativa · preços de 2026-11-16`) sem nunca esconder a palavra "estimativa" nem a data do catálogo.

### Painel de custo e tabelas de custo
- Topo fixo: total em KPI, a barra fixo/variável e a data do catálogo.
- Depois, por bloco e por aresta, como em "Regras de densidade". Clicar numa linha seleciona o bloco ou a aresta no canvas.
- **Hover em linha:** contorno de 1px em `--border` com `--radius-control`, sem mudar o fundo.
- **Linha selecionada:** fundo `--active`.
- **Valor que acabou de mudar:** o total e a linha editada ganham `--changed` de fundo, que some em 600 ms. Com `prefers-reduced-motion`, não há destaque.

### Marcas de origem do valor
Cada valor de uso no inspetor (e na aresta) diz de onde veio, por forma e não só por cor:
- **Alterado à mão:** ponto cheio de 6px em `--text` antes do valor.
- **Estimado pela LLM:** anel de 6px (traço de 1,5px) em `--muted`.
- **Padrão:** sem marca, valor em `--muted`.
- Cada marca tem `aria-label` e tooltip com o nome da origem. A legenda fica no topo da seção de uso: `● alterado à mão · ○ estimado pela LLM · cinza: padrão`.

### Botões
- **Forma:** `--control-height`, `--radius-control`, padding de 0 a 12px, 14px/500. Botões de ícone com 32 × 32, ícone de 16px, `aria-label` e tooltip.
- **Primário:** `--primary` com `--primary-ink`. Um por tela. Hover em `--primary-hover`.
- **Secundário:** `--surface` com borda `--control` e texto `--text`. Hover em `--raised`.
- **Terciário:** só texto, em `--text`, com sublinhado no hover.
- **Destrutivo:** texto ou contorno em `--negative`, sempre com confirmação que nomeia o objeto ("Apagar o design Loja v2?").
- **Pressionado:** escala 0,97 em `--t-press`.

### Pílulas de estado
- 20px de altura, 12px/500, `--radius-chip`, par claro e escuro do mesmo tom (`--pill-*-bg` e `--pill-*-ink`). Nunca são espremidas: `flex: none; white-space: nowrap`.
- Uma pílula por objeto: `Não salvo`, `Estimativa desatualizada`, `Conflito: salvo em outra aba`, `Versão antiga`.

### Campos
- Fundo `--surface`, borda `--control`, `--radius-control`, altura `--control-height` nos painéis e `--control-height-form` nos diálogos. Rótulo sempre visível acima; placeholder nunca faz o papel do rótulo.
- **Foco:** borda `--accent` e anel `--focus`.
- **Erro:** borda `--negative` e mensagem de uma frase em 12px `--negative` logo abaixo, com ícone. O erro diz o que fazer.
- **Desabilitado:** fundo `--raised`, texto `--faint` (5,26:1, legível) e tooltip com o motivo.

### Abas e navegação
- Abas de 14px/500; a ativa em 600 e com sublinhado de 2px em `--accent`, que passa 8px de cada lado do rótulo, sobre uma régua `--rule` de 1px.
- Item ativo de lista ou menu: fundo `--active`, sem barra lateral colorida.

### Estados

| Estado | Tratamento |
|---|---|
| Hover | Controle: `--raised` ou `--primary-hover`. Linha: contorno de 1px. Bloco: borda `--control`. Em `--t-hover`. |
| Foco | Anel `--focus` de 2px com `--focus-offset`, só em `:focus-visible`. Nunca removido. |
| Selecionado | Bloco e aresta em `--accent`; linha com fundo `--active`; aba com sublinhado `--accent`. |
| Desabilitado | Legível e com motivo (tooltip). Nunca só opacidade de 30%. |
| Carregando | O layout final, com cada valor trocado por uma barra plana `--raised` do tamanho real. Sem shimmer e sem pulo de layout quando os dados chegam. A estimativa por LLM troca o rótulo do botão por `Estimando…` e trava o botão contra clique duplo. |
| Vazio | O quadro e o título ficam; uma frase e a próxima ação dentro de um contorno tracejado de 1px em `--control`. Canvas vazio: "Arraste um bloco da paleta ou abra o template". |
| Erro | Dentro do bloco que falhou, nunca em banner de tela cheia: uma frase com o que falhou, a última vez que deu certo e `Tentar de novo`. O vermelho fica só no ícone ou na pílula. |
| Desatualizado | Pílula de aviso `Estimativa desatualizada` ao lado de `Re-estimar carga`. |
| Quota | Linha de capacidade `Restam 12 de 20 hoje` com barra de 4px na proporção real (`--text` sobre `--rule`). Em zero, o botão fica desabilitado e diz quando a quota volta. |
| Salvo | Carimbo de tempo discreto `Salvo há 2 min` em 12px `--muted` na barra superior. |

### Movimento

```css
:root {
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --t-press: 120ms;    /* pressionar */
  --t-hover: 150ms;    /* hover, troca de cor */
  --t-ui: 200ms;       /* popover, menu, troca de aba; o teto da interface */
  --t-changed: 600ms;  /* destaque que some do valor que mudou */
}
@media (prefers-reduced-motion: reduce) {
  :root { --t-press: 0ms; --t-ui: 0ms; --t-changed: 0ms; }
}
```

Transições curtas em CSS, só de cor, opacidade e `transform`. Números nunca animam contando: o novo valor aparece de uma vez. Sem animação de entrada em scroll, sem parallax e sem GSAP no editor; se alguma Issue precisar de mais que isso, ela passa pelas skills `gsap-*` do protocolo.

## Do's and Don'ts

### Do:
- **Do** escrever o custo no próprio desenho: cota em cada bloco e em cada aresta cobrada, e o carimbo sempre visível.
- **Do** usar a mono em todo valor em dólar, alinhado à direita e com duas casas.
- **Do** separar fixo (tinta sólida) de variável (hachura) por padrão, não só por cor.
- **Do** mostrar zero como `US$ 0,00` e ausência como `—` em `--faint`.
- **Do** dizer a origem de cada valor de uso com ponto, anel ou cinza, e com texto acessível.
- **Do** manter o aviso de estimativa e a data do catálogo em toda tela com custo e em todo export.
- **Do** conferir qualquer cor nova contra a tabela de contraste antes do PR.

### Don't:
- **Don't** colorir custo: nada de vermelho para caro, verde para barato ou teal para variável.
- **Don't** usar o teal fora de seleção, foco, aba ativa e link.
- **Don't** usar o laranja da marca AWS, o logotipo da AWS ou os ícones oficiais de arquitetura como identidade.
- **Don't** usar gradiente, brilho, vidro, desfoque de fundo ou sombra em repouso.
- **Don't** pôr ícone em quadrado colorido nos KPIs, sparkline em total, zebra em tabela ou cabeçalho em caixa alta.
- **Don't** usar violeta ou índigo, nem fundo escuro azul-marinho ou ardósia.
- **Don't** usar texto abaixo de 12px, título acima de 28px ou número de 48px ou mais.
- **Don't** criar um segundo botão primário na mesma tela.
- **Don't** mostrar texto livre vindo da LLM; a interface só exibe números validados e rótulos próprios.
