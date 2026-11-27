---
name: AWS Cost Playground
description: Prancha de arquitetura AWS com o custo mensal escrito no próprio desenho.
---

<!-- SEED: definido antes da implementação (Issue #4). Quando existir código em web/, rode `impeccable document` em modo scan para levar os tokens reais ao frontmatter e gerar .impeccable/design.json. -->

# Design System: AWS Cost Playground

Fonte da verdade visual do `web/`. Os blocos `css` deste arquivo são os tokens normativos: `web/src/shared/ui/tokens.css` é a cópia literal deles, sem mudar nomes nem valores; edite os dois juntos (um teste compara os dois). Os nomes seguem `assets/app.css` da skill `design-taste-frontend`, para que o CSS base dela sirva sem renomear nada. Produto, público e escopo estão em [PRODUCT.md](PRODUCT.md) e no [PRD](docs/product/aws-cost-playground/PRD.md); aqui só entra o que é visual.

Origem: `ui-ux-pro-max` (estilo Minimalism & Swiss, IBM Plex Sans, densidade alta), `design-taste-frontend` (`draw.mjs --app --kind builder`, estilo `framed-sheet`, seed 20627501) e `impeccable` (modo Operate, `concept-seed` seed:1388cfa49c751380, direção nº 3). O histórico das escolhas está em `docs/handoff/4.md`.

## Overview

**Creative North Star: "A prancha cotada"**

O design é um desenho técnico. Na prancha de engenharia, cada peça tem sua cota escrita ao lado e o canto inferior direito guarda o carimbo com o que importa: nome, escala, data, responsável. Aqui o canvas é a prancha, cada bloco e cada aresta cobrada levam a cota de custo mensal, e o carimbo, fixo no canto, mostra o total, o fixo, o variável, a região e a data do catálogo. O usuário lê o preço onde ele nasce, sem trocar de tela.

O mundo da prancha entra com só quatro coisas: o tipo (IBM Plex, família de origem industrial com números tabulares de verdade), a paleta (moldura cor de papel vegetal, tinta quase preta, cinco tintas de categoria), a densidade (média para alta, de ferramenta de trabalho) e uma assinatura visual (cotas e carimbo). Navegação, abas, campos e botões são os padrões da web. Ninguém precisa aprender a interface antes de usá-la.

A tela é clara por padrão, com tema escuro completo. É uma ferramenta de sessão longa em desktop, lida como documento de orçamento, e o estilo sorteado (`framed-sheet`) é claro. O escuro existe para quem trabalha à noite e segue `prefers-color-scheme` até o usuário escolher.

**Key Characteristics:**
- Moldura tingida (barra superior, paleta e, no editor, a coluna direita) e o trabalho numa folha branca com borda de 1px, cantos de 16px e nenhuma sombra.
- A cor tem dois trabalhos e só dois: dizer a categoria do bloco e dizer o estado (erro e aviso). Seleção, foco, texto e dinheiro são tinta.
- Todo valor em dólar aparece em IBM Plex Mono, alinhado à direita, com o mesmo número de casas.
- Fixo é tinta sólida, variável é tinta hachurada: a separação se lê sem cor.
- Nada flutua em repouso; sombra só no que está por cima (menu, popover, diálogo, bloco sendo arrastado).

## Colors

Estratégia contida: neutros tingidos da moldura, tinta quase preta para texto, dinheiro, seleção e foco, duas cores de estado e cinco tintas de categoria. As categorias valem como identidade do bloco, não como dado.

### Neutros, ação e estado

| Token | Papel |
|---|---|
| `--ground` | Moldura: barra superior, paleta, coluna direita. Papel vegetal azulado no claro; preto neutro no escuro. |
| `--surface` | A folha (canvas), cartões, inputs, diálogos. |
| `--raised` | Poço dentro da folha, fundo de controle desabilitado, barra de carregamento. |
| `--active` | Item ativo de lista e linha selecionada que abre detalhe. |
| `--border` | Borda da folha, dos cartões e dos campos desabilitados. |
| `--rule` | Régua entre linhas de tabela e trilho de barras. |
| `--control` | Borda de input, select e botão secundário. Passa 3:1 em todo fundo (WCAG 1.4.11). |
| `--text` | Texto principal, valores em dólar, parte fixa do custo. |
| `--muted` | Texto secundário, rótulos de campo, ícones de lista, valores de origem "padrão". |
| `--faint` | Meta, placeholder, unidade dentro do campo, travessão de valor ausente. |
| `--primary` / `--primary-ink` / `--primary-hover` | O único botão cheio da tela: quase preto no claro, invertido no escuro. |
| `--accent` / `--accent-ink` | Onde você está: seleção no canvas, aba ativa, link. É a própria tinta, não um matiz. |
| `--focus` | Anel de foco do teclado (igual a `--accent`). |
| `--edge` | Traço das arestas no canvas. Passa 3:1 sobre a folha. |
| `--chart-muted` | Barras finas de proporção nas listas de custo. É redundante: o número ao lado carrega a informação. |
| `--changed` | Fundo neutro e passageiro do valor que acabou de mudar. |
| `--negative`, `--warning` e pares `--pill-*` | Estado. Texto colorido sobre a superfície ou pílula clara com tinta escura do mesmo tom. |
| `--positive`, `--pill-positive-*` | Não há verde de sucesso: o sucesso se diz em texto e pela mudança de estado ("Salvo há 2 min"). Os tokens existem só para o CSS base da skill não quebrar e apontam para a tinta e para a pílula neutra. |
| `--scrim` | Fundo atrás de diálogo modal. |

**A regra dos dois trabalhos da cor.** A cor diz o que o bloco é (categoria, só no desenho e na paleta) e o estado (vermelho para erro, âmbar para aviso). Seleção, foco, texto e dinheiro são tinta. Nenhum valor em dólar ganha cor por ser alto, baixo, fixo ou variável.

**A regra da moldura quieta.** A moldura nunca escurece nem satura e não leva matiz. Fora do desenho, a única cor da tela está nas pílulas e mensagens de estado.

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
  --control: #81878e;
  --text: #131416;
  --muted: #56595c;
  --faint: #63676b;
  /* ação e interação: tudo em tinta */
  --primary: #1d1f20;
  --primary-ink: #ffffff;
  --primary-hover: #383b3d;
  --accent: #131416;
  --accent-ink: #ffffff;
  --focus: var(--accent);
  /* canvas e dados */
  --edge: #6b7177;
  --chart-muted: #c3c9ce;
  --changed: rgb(19 20 22 / 0.07);
  --scrim: rgb(19 20 22 / 0.32);
  /* estado: só erro e aviso têm cor */
  --negative: #c4242a;
  --warning: #92400e;
  --positive: var(--text);
  --pill-negative-bg: #ffedea; --pill-negative-ink: #831c1e;
  --pill-warning-bg: #fffbeb;  --pill-warning-ink: #92400e;  --pill-warning-border: #fde68a;
  --pill-neutral-bg: #ebedee;  --pill-neutral-ink: #353736;
  --pill-positive-bg: var(--pill-neutral-bg); --pill-positive-ink: var(--pill-neutral-ink);
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
  --accent: #f2f3f4;
  --accent-ink: #131416;
  --focus: var(--accent);
  --edge: #80868c;
  --chart-muted: #4a4e52;
  --changed: rgb(242 243 244 / 0.10);
  --scrim: rgb(0 0 0 / 0.6);
  --negative: #ef6b80;
  --warning: #f0a05f;
  --positive: var(--text);
  --pill-negative-bg: #2c1a20; --pill-negative-ink: #ef6b80;
  --pill-warning-bg: #2e2312;  --pill-warning-ink: #f0a05f;  --pill-warning-border: #5c4520;
  --pill-neutral-bg: #2a2c2e;  --pill-neutral-ink: #d6d8da;
  --pill-positive-bg: var(--pill-neutral-bg); --pill-positive-ink: var(--pill-neutral-ink);
}
```

**Como o tema é escolhido.** O escuro é declarado uma vez só, no seletor `[data-theme="dark"]`. Um script clássico, `web/public/theme.js` (copiado para `dist/` sem hash e sem passar pelo bundler), carregado no `<head>` sem `defer` e nunca inline (a CSP não ganha `unsafe-inline`), grava `data-theme` no `<html>` antes da primeira pintura. Ele usa a escolha salva em `localStorage` (chave `acp-theme`) ou, se não houver, `prefers-color-scheme`, e acompanha a mudança do sistema enquanto o usuário não escolher.

### Categorias dos blocos

Cada categoria tem duas tintas: `ink` (ícone, texto e borda da categoria) e `tint` (fundo do ladrilho de tipo). O canal principal é o ícone: a categoria nunca é dita só pela cor. O ladrilho sempre leva o ícone da categoria e o bloco leva o nome do serviço (WCAG 1.4.1).

| Categoria | Blocos | Ícone (Lucide) | Tokens |
|---|---|---|---|
| Computação | EC2, ECS, Lambda | `cpu` | `--cat-compute-ink` · `--cat-compute-tint` |
| Dados | RDS, DynamoDB, ElastiCache, S3, SQS | `database` | `--cat-data-ink` · `--cat-data-tint` |
| Rede | Route 53, CloudFront, ALB, NAT Gateway | `network` | `--cat-network-ink` · `--cat-network-tint` |
| Segurança | WAF, Cognito, IAM, Secrets Manager | `shield` | `--cat-security-ink` · `--cat-security-tint` |
| Operação | CloudWatch, CloudTrail, CodePipeline, CloudFormation | `activity` | `--cat-ops-ink` · `--cat-ops-tint` |

O nó fixo `client` (Internet) não tem categoria: ladrilho `--raised`, ícone `globe` em `--text`.

**Onde o ladrilho colorido aparece.** Só no bloco do canvas e no item da paleta, porque ali ele é o tipo do nó de um builder, igual nos dois lugares (`app-screens.md` §13, exceção de ladrilho de tipo; no `inspect.mjs --app`, passe `--allow icon-chips` com esse motivo). Nas listas (painel de custo, comparação), a categoria vira o ícone de 16px em `--muted`, sem ladrilho e sem cor.

**Como os matizes foram escolhidos.** Em OKLCH, as categorias ficam a 95° (oliva), 150° (verde), 200° (petróleo), 258° (azul) e 352° (magenta). Ficam longe do vermelho de erro (~27°), do âmbar de aviso (~50° no claro; laranja a ~62° no escuro) e do violeta, que a casa veta (~280° a 315°). Luminosidade, croma e matiz saíram de uma busca por script que maximiza a menor diferença perceptual (ΔE em OKLab ×100) com contraste AA como restrição:

| Distância mínima entre inks | Claro | Escuro |
|---|---|---|
| Categoria × categoria | 10,0 (dados × rede) | 9,0 (dados × operação) |
| Categoria × estado | 10,7 (operação × aviso) | 10,1 (operação × aviso) |
| Referência: aviso × erro | 10,7 | 14,2 |

Com deuteranopia e protanopia simuladas (Machado 2009), alguns pares se aproximam: verde × magenta, petróleo × magenta e, no pior caso, oliva de operação × aviso em protanopia no tema claro. Nenhuma paleta de sete matizes evita isso. Por isso o ícone é o canal principal da categoria e o texto é o canal principal do estado: o ladrilho de operação sempre tem o ícone `activity`, e o aviso nunca aparece sem palavra (pílula ou frase). A cor é reforço nos dois casos.

```css
:root {
  --cat-compute-ink: #265496;  --cat-compute-tint: #dcf0ff;
  --cat-data-ink: #09672e;     --cat-data-tint: #daf8df;
  --cat-network-ink: #0e6e72;  --cat-network-tint: #ccf8fa;
  --cat-security-ink: #8b2b5d; --cat-security-tint: #ffe4f1;
  --cat-ops-ink: #5c4c02;      --cat-ops-tint: #f8efcd;
}
:root[data-theme="dark"] {
  --cat-compute-ink: #8fb9f7;  --cat-compute-tint: #1b2c44;
  --cat-data-ink: #76cf8a;     --cat-data-tint: #17321e;
  --cat-network-ink: #71d0d5;  --cat-network-tint: #073234;
  --cat-security-ink: #f297bf; --cat-security-tint: #3e202e;
  --cat-ops-ink: #c4c375;      --cat-ops-tint: #2d2d11;
}
```

### Contraste verificado

Razões de contraste WCAG 2.x calculadas sobre os valores acima. O piso é 4,5:1 para texto e ícone e 3:1 para borda de controle, traço de aresta e anel de foco.

| Par | Claro | Escuro |
|---|---|---|
| Computação: ink sobre tint · surface · ground · active | 6,43 · 7,52 · 6,86 · 6,43 | 7,01 · 8,93 · 9,62 · 7,36 |
| Dados: ink sobre tint · surface · ground · active | 6,18 · 7,02 · 6,40 · 6,00 | 7,32 · 9,46 · 10,18 · 7,79 |
| Rede: ink sobre tint · surface · ground · active | 5,26 · 6,01 · 5,48 · 5,14 | 7,71 · 9,99 · 10,75 · 8,23 |
| Segurança: ink sobre tint · surface · ground · active | 6,77 · 8,07 · 7,36 · 6,90 | 6,86 · 8,51 · 9,16 · 7,01 |
| Operação: ink sobre tint · surface · ground · active | 7,32 · 8,43 · 7,69 · 7,21 | 7,63 · 9,75 · 10,50 · 8,04 |
| `--text` sobre qualquer tint de categoria (mínimo) | 15,46 | 12,48 |
| `--text` (também `--accent` e `--focus`) sobre surface · ground · active | 18,43 · 16,79 · 15,75 | 16,16 · 17,39 · 13,32 |
| `--muted` sobre surface · ground · active | 7,05 · 6,42 · 6,02 | 8,91 · 9,59 · 7,34 |
| `--faint` sobre surface · ground · raised · active | 5,70 · 5,20 · 5,26 · 4,87 | 6,58 · 7,08 · 5,99 · 5,42 |
| `--control` (borda) sobre surface · ground · raised · active | 3,63 · 3,30 · 3,35 · 3,10 | 3,74 · 4,02 · 3,41 · 3,08 |
| `--edge` (traço) sobre surface | 4,94 | 4,88 |
| `--primary-ink` sobre `--primary` · `--primary-hover` | 16,55 · 11,28 | 16,59 · 12,65 |
| `--negative` · `--warning` sobre surface | 5,78 · 7,09 | 6,06 · 8,46 |
| `--negative` · `--warning` sobre ground | 5,27 · 6,46 | 6,52 · 9,11 |
| Pílulas negativa · aviso · neutra | 8,63 · 6,84 · 10,21 | 5,55 · 7,25 · 9,81 |

Qualquer cor nova passa por esta tabela e pela distância mínima entre inks antes de entrar no código.

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
- **Read** (400, 16px, 26px, até 68ch): corpo das páginas de texto (privacidade, termos); o título dessas páginas usa Read title (600, 28px, 36px).

```css
:root {
  --font: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --fs-title: 22px;      --lh-title: 28px;
  --fs-kpi: 28px;        --lh-kpi: 36px;
  --fs-section: 16px;    --lh-section: 24px;
  --fs-body: 14px;       --lh-body: 20px;
  --fs-small: 12px;      --lh-small: 16px;
  --fs-read: 16px;       --lh-read: 26px;   --measure-read: 68ch;
  --fs-read-title: 28px; --lh-read-title: 36px;
  --fw-regular: 400;     --fw-medium: 500;  --fw-semibold: 600;
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

Grade de 4px. Um valor de espaçamento por contexto, repetido na horizontal e na vertical. Dentro de componentes pequenos valem os meios passos de 2px e 6px (padding da cota, marca de origem, raio de canto da aresta); fora deles, só a escala.

```css
:root {
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px;

  /* casca do editor (1440 × 900 é a tela de referência) */
  --topbar-height: 48px;
  --sidebar-width: 232px;     /* paleta; 200px entre 1024 e 1279px */
  --sidebar-collapsed: 48px;  /* paleta recolhida: só o botão que a mostra */
  --rail-width: 360px;        /* coluna direita: custo, bloco, carga; 320px entre 1024 e 1279px */
  --sheet-inset: 8px;         /* folha recuada da borda de baixo (e da direita quando não há coluna) */
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

  /* peças de tamanho fixo */
  --node-width: 216px;        /* todos os blocos têm a mesma largura */
  --node-height: 94px;        /* e a mesma altura, nos dois modos (completo e compacto) */
  --lh-node: 1.15;            /* entrelinha do texto do bloco compacto (corpo ampliado) */
  --node-pad-compact: 6px;    /* padding do bloco compacto: o texto ampliado ocupa a altura toda */
  --tile-node: 24px;          /* ladrilho de categoria no bloco e na paleta */
  --icon: 16px;               /* ícone de interface e de lista */
  --icon-inline: 14px;        /* ícone dentro de linha de texto */
  --stamp-width: 320px;       /* carimbo */
  --split-bar: 8px;           /* barra fixo/variável */
  --pill-height: 20px;
  --mark-origin: 6px;         /* ponto e anel de origem do valor */
}
```

### A casca do editor

- **Barra superior** (48px, sobre `--ground`, sem régua): marca e nome do produto, nome do design (editável) com a pílula de estado (salvo, não salvo), região, desfazer e refazer, as ações secundárias e um único botão primário.
- **Paleta** (`--sidebar-width`, sobre `--ground`): cinco grupos na ordem computação, dados, rede, segurança, operação. Cada grupo tem título Section e itens num passo de 40px: ladrilho de categoria, nome do serviço e alça de arraste. Um botão no título recolhe a paleta num trilho de `--sidebar-collapsed`, que só guarda o botão para mostrá-la (aberta por padrão a partir de 1200px, recolhida abaixo disso).
- **Folha** (o canvas): `--surface`, borda `--border` de 1px, cantos `--radius-sheet`. No editor a moldura forma um U (barra superior, paleta e coluna direita): a folha fica a `--panel-gap` da paleta e da coluna e recuada `--sheet-inset` da borda de baixo da janela. Sem grade de pontos; o encaixe invisível é de 8px. O carimbo fica preso 16px dentro do canto inferior direito; zoom e minimapa, 16px dentro do canto inferior esquerdo.
- **Coluna direita** (`--rail-width`, sobre `--ground`): abas no topo com sublinhado de 2px. Painel de custo, inspetor e carga ficam aqui; a composição exata das abas é decisão da Issue do editor.
- Telas que não são o editor (lista de designs, comparação, conta) usam a moldura em L do `framed-sheet` (barra superior e navegação à esquerda). A folha fica recuada `--sheet-inset` da direita e de baixo, com `--pad` de padding.

### Regras de densidade para painéis e tabelas de custo

Densidade é três ajustes movidos juntos: passo da linha, padding e tamanho do texto. Não se encolhe um sem os outros.

| Superfície | Passo | Texto | Padding | Regra |
|---|---|---|---|---|
| Lista de custo por bloco (coluna direita) | 36px | 14px; valor em mono | 16px | Uma linha por bloco: ícone da categoria de 16px em `--muted`, nome em `--text`, valor alinhado à direita. Barra de 2px sob o nome, na proporção real do maior custo; a do mais caro em `--text`, as outras em `--chart-muted`. Ordem: mais caro primeiro; custo zero no fim, em `--muted`. |
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
- **De 1200px a 1279px:** paleta com 200px e coluna direita com 320px.
- **De 1024px a 1199px:** a paleta abre recolhida num trilho de `--sidebar-collapsed` (48px) com um só botão, "Mostrar a paleta" (`aria-expanded`), e a coluna direita tem 320px. A folha passa de ~480px para ~630px, o que sustenta o texto de 10,5px dos blocos (ver "Bloco no canvas"). Quem mostra a paleta ganha os 200px de volta e o canvas reajusta; a escolha vale até a página recarregar. Em qualquer largura a paleta também se recolhe pelo botão do próprio título.
- **Abaixo de 1024px** (inclusive em zoom de 200% numa tela de 1440px): o canvas não abre. É conteúdo bidimensional, uma exceção da WCAG 1.4.10. No lugar dele vem uma folha de leitura: uma frase dizendo que a edição precisa de pelo menos 1024px de largura, o resumo de custo do design em uma coluna (total, fixo, variável, lista por bloco e por aresta, aviso e data do catálogo) e os links para baixar o JSON e para a lista de designs. O custo continua acessível em qualquer zoom.
- As páginas de texto funcionam a partir de 320px, com margens de 16px e alvos de pelo menos 44px.

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

Raio justo, em degraus que diminuem para dentro: folha 16, cartão e bloco 8, controle 6, ladrilho e pílula 4. Nada entre 10 e 14px, e nenhum controle em pílula redonda. Os 16px da folha são o movimento do `framed-sheet` e valem só para ela e para os painéis da casca, nunca para cartões.

```css
:root {
  --radius-sheet: 16px;   /* a folha e os painéis da casca */
  --radius-card: 8px;     /* blocos, cartões, carimbo, popovers, diálogos */
  --radius-control: 6px;  /* botões, inputs, selects, abas */
  --radius-chip: 4px;     /* ladrilho de categoria, pílulas, cota de aresta */
  --border-width: 1px;
  --focus-width: 2px;
  --focus-offset: 2px;
  --focus-offset-node: 3px; /* nos blocos do canvas, para o anel ficar fora da borda de seleção */
}
```

- **Arestas:** traço de 1,5px em `--edge` com ponta de seta. O tipo se lê pelo traçado, não pela cor: `data` contínua, `runs-on` tracejada (6 4), `logs` pontilhada (1,5 4, ponta redonda). Cantos ortogonais com raio de 6px.
- **Hachura do variável:** linhas a 45°, 1px de `--text` a cada 4px, com contorno de 1px em `--text`. O fixo é `--text` sólido. A hachura só aparece em barra de `--split-bar` ou mais (carimbo, topo do painel, comparação); as barras finas de 2px mostram só a proporção do total. É desenhada como `<pattern>` num SVG inline do componente, nunca como `url("data:…")` no CSS, para a CSP não precisar de `img-src data:`.
- **Ícones:** Lucide, como componentes que viram SVG inline (sem CDN, sem URI `data:`), traço de 1,5px, `--icon` na interface e `--icon-inline` em linha de texto, sempre em `--muted` ou na tinta da categoria. Não usamos os ícones oficiais da AWS: o produto não é da AWS e não deve parecer.

## Components

Os componentes ainda não existem. Esta seção fixa a anatomia e os estados que cada Issue de interface deve seguir.

### Bloco no canvas (assinatura)
- **Forma:** `--node-width`, `--radius-card`, fundo `--surface`, borda `--border`, padding de 12px.
- **Anatomia fixa:** a mesma em todos os blocos, para que o olho ache cada coisa no mesmo lugar. Linha 1: ladrilho de `--tile-node` (`--cat-*-tint`, ícone de 16px em `--cat-*-ink`, `--radius-chip`) e nome do serviço em 14px/600. Linha 2: resumo do SKU em 12px mono `--muted` (`t4g.small · 2 AZ`). Linha 3: a cota, com `por mês` à esquerda em `--muted` e o valor em mono 14px à direita.
- **Modo compacto (zoom semântico):** com o diagrama inteiro na tela o zoom é baixo (0,35 a 0,6) e o texto de 14px não se leria. Abaixo de zoom 0,74 todos os blocos passam ao modo compacto, que volta ao completo acima de 0,82 (histerese: entre os dois vale o modo anterior, sem pisca-pisca). No compacto o bloco mostra só o nome (600, até duas linhas) e o valor mensal (mono), mais o ladrilho de categoria: o resumo do SKU e "por mês" somem da tela, mas o nome acessível do nó os mantém e o inspetor os mostra; ao aproximar (zoom acima de 0,82) o bloco completo volta. O corpo do nome e do valor é ampliado na razão inversa do zoom (`--node-scale`, de `semanticZoom.ts`, de 1 a 2) para que o texto na tela fique em 10,5px; nunca abaixo de 14px no canvas. O bloco mantém `--node-width` x `--node-height` (padding de `--node-pad-compact`, entrelinha de `--lh-node`) e as arestas não se movem. Nada anima na troca. Corpo na tela: 10,5px a 11,5px de 1024 a 1920px de largura.
- **Texto longo:** nome e resumo do SKU ficam numa linha, com reticências e o texto completo em tooltip e no `aria-label`. O valor da cota nunca é cortado. Se não couber, `por mês` some primeiro e o valor ocupa a linha (até `US$ 9.999.999,99` cabe nos 192px internos).
- **Selecionado:** borda de 2px em `--accent`, desenhada como `outline` para o bloco não mudar de tamanho.
- **Foco (teclado):** anel `--focus` de 2px a `--focus-offset-node` do bloco, fora da borda de seleção. Os 3px entre o anel e o bloco ficam sempre em `--surface`, então um bloco selecionado e focado mostra duas linhas de tinta separadas por uma faixa da folha. A Issue do editor confere isso na tela renderizada, com zoom de 200%.
- **Em arraste:** `--shadow-float`, sem mudar de escala.
- **Custo zero (IAM, CloudFormation, ECS):** a cota mostra `US$ 0,00` em `--muted`. No ECS vem `custo no EC2` como meta.
- **Teclado:** Tab percorre os blocos na ordem do design (a do documento, que não muda quando um bloco é movido); setas movem 8px, uma célula da grade (Shift + setas, 32px, quatro células: o passo do React Flow, sempre sobre a grade); Enter ou Espaço seleciona o bloco e o inspetor mostra o que está selecionado; Esc limpa a seleção; Delete apaga; Ctrl/Cmd+Z desfaz e Shift+Ctrl/Cmd+Z refaz. Seleção múltipla, foco em aresta e os demais atalhos ficam para a Issue do editor, que deve cumprir a WCAG 2.1.1.

### Arestas e cotas
- A cota de aresta é uma etiqueta no meio do traço: mono 12px/500, fundo `--surface`, borda `--border`, `--radius-chip`, padding de 2px por 6px.
- Arestas `data` e `logs` sempre mostram a cota, mesmo com `US$ 0,00`. Arestas `runs-on` não têm cota, porque o custo está no EC2.
- **Colisão:** a etiqueta fica acima das arestas e abaixo dos blocos. Se cobrir um bloco ou outra etiqueta, ela desliza ao longo do traço, entre 25% e 75% do comprimento. Em aresta com menos de 48px visíveis, a etiqueta só aparece no hover, no foco e na seleção; o valor continua na lista por aresta do painel de custo.
- **Aresta selecionada:** traço de 2px em `--accent` e um ponto de 6px em `--accent` em cada ponta, para a seleção não depender só da espessura.
- **Sem arraste obrigatório (WCAG 2.5.7):** toda aresta também se cria pelo inspetor do bloco de origem ("Conectar a…", com uma lista de destinos e o tipo da aresta).

### Carimbo (assinatura)
- Cartão de `--stamp-width` preso no canto inferior direito da folha: `--surface`, borda `--border`, `--radius-card`, sem sombra.
- Linhas separadas por `--rule`: nome do design e região (mono 12px); `Total por mês` em 12px `--muted` sobre o total em KPI; a barra fixo/variável de `--split-bar`, na proporção real, e a legenda `Fixo US$ 61,20 · Variável US$ 23,10`; e o aviso `Estimativa on-demand, não é cotação oficial · preços de 2026-11-16` em 12px `--muted`.
- Recolhe para uma linha (`US$ 84,30/mês · estimativa · preços de 2026-11-16`) sem nunca esconder a palavra "estimativa" nem a data do catálogo. Começa recolhido abaixo de 1280px.

### Painel de custo e tabelas de custo
- Topo fixo: total em KPI, a barra fixo/variável e a data do catálogo.
- Depois, por bloco e por aresta, como em "Regras de densidade". Clicar numa linha seleciona o bloco ou a aresta no canvas.
- **Hover em linha:** contorno de 1px em `--border` com `--radius-control`, sem mudar o fundo.
- **Linha selecionada:** fundo `--active`.
- **Valor que acabou de mudar:** o total e a linha editada ganham `--changed` de fundo, que some em `--t-changed`. Com `prefers-reduced-motion`, não há destaque.

### Marcas de origem do valor
Cada valor de uso no inspetor (e na aresta) diz de onde veio, por forma e não só por cor:
- **Alterado à mão:** ponto cheio de `--mark-origin` em `--text` antes do valor.
- **Estimado pela LLM:** anel de `--mark-origin` (traço de 1,5px) em `--muted`.
- **Padrão:** sem marca, valor em `--muted`.
- Cada marca tem `aria-label` e tooltip com o nome da origem, em texto fixo da interface. A legenda fica no topo da seção de uso: `● alterado à mão · ○ estimado pela LLM · cinza: padrão`.

### Botões
- **Forma:** `--control-height`, `--radius-control`, padding de 0 a 12px, 14px/500. Botões de ícone com 32 × 32, ícone de 16px, `aria-label` e tooltip.
- **Primário:** `--primary` com `--primary-ink`. Um por tela. Hover em `--primary-hover`.
- **Secundário:** `--surface` com borda `--control` e texto `--text`. Hover em `--raised`.
- **Terciário:** só texto, em `--text`, com sublinhado permanente de 1px (`text-underline-offset: 2px`) que engrossa para 2px no hover. Com a interação em tinta, o sublinhado é o que mostra que o texto clica ("Tentar de novo", "Baixar o JSON").
- **Destrutivo:** texto ou contorno em `--negative`, sempre com confirmação que nomeia o objeto ("Apagar o design Loja v2?").
- **Pressionado:** escala 0,97 em `--t-press`.

### Pílulas de estado
- `--pill-height`, 12px/500, `--radius-chip`, par claro e escuro do mesmo tom (`--pill-*-bg` e `--pill-*-ink`). Nunca são espremidas: `flex: none; white-space: nowrap`.
- Uma pílula por objeto: `Não salvo` (neutra), `Estimativa desatualizada` (aviso), `Conflito: salvo em outra aba` (aviso), `Versão antiga` (aviso), `Arquivo inválido` (negativa).

### Campos
- Fundo `--surface`, borda `--control`, `--radius-control`, altura `--control-height` nos painéis e `--control-height-form` nos diálogos. Rótulo sempre visível acima; placeholder nunca faz o papel do rótulo.
- **Foco:** borda `--accent` e anel `--focus`.
- **Erro:** borda `--negative` e mensagem de uma frase em 12px `--negative` logo abaixo, com ícone. O erro diz o que fazer ("Use um valor entre 0 e 10.000 GB/mês").
- **Desabilitado:** fundo `--raised`, borda `--border` (mais clara que a de um campo ativo), texto `--faint` (5,26:1, legível), cursor `not-allowed` e tooltip com o motivo. Assim não se confunde com um campo vazio com placeholder, que mantém fundo `--surface` e borda `--control`.

### Abas e navegação
- Abas de 14px/500; a ativa em 600 e com sublinhado de 2px em `--accent`, que passa 8px de cada lado do rótulo, sobre uma régua `--rule` de 1px. Seguem o padrão de abas da WAI-ARIA: setas trocam de aba e Tab entra no painel.
- Item ativo de lista ou menu: fundo `--active`, sem barra lateral colorida.
- **Links:** todo link fora de botão, aba ou item de menu é `--accent` com sublinhado permanente de 1px (`text-underline-offset: 2px`), que engrossa para 2px no hover. Nunca um link só com cor ou só com sublinhado no hover (WCAG 1.4.1). Vale para as páginas de texto e para os links dentro de painéis e mensagens.

### Estados

| Estado | Tratamento |
|---|---|
| Hover | Controle: `--raised` ou `--primary-hover`. Linha: contorno de 1px. Bloco: borda `--control`. Em `--t-hover`. |
| Foco | Anel `--focus` de 2px com `--focus-offset`, só em `:focus-visible`. Nunca removido. |
| Selecionado | Bloco e aresta em `--accent`; linha com fundo `--active`; aba com sublinhado `--accent`. |
| Desabilitado | Legível e com motivo (tooltip). Nunca só opacidade de 30%. |
| Carregando | O layout final, com cada valor trocado por uma barra plana `--raised` do tamanho real. Sem shimmer e sem pulo de layout quando os dados chegam. A estimativa por LLM troca o rótulo do botão por `Estimando…` e trava o botão contra clique duplo. |
| Vazio | O quadro e o título ficam; uma frase e a próxima ação dentro de um contorno tracejado de 1px em `--control`. Canvas vazio: "Arraste um bloco da paleta ou abra o template". |
| Erro | Dentro do bloco que falhou, nunca em banner de tela cheia: uma frase com o que falhou, a última vez que deu certo e `Tentar de novo`. O vermelho fica só no ícone ou na pílula. Catálogo de preços que não carregou para a região: o carimbo e o painel mostram `—` no lugar dos valores, a frase "Sem preços de sa-east-1 neste momento" e `Tentar de novo`. |
| Desatualizado | Pílula de aviso `Estimativa desatualizada` ao lado de `Re-estimar carga`. |
| Quota do usuário | Linha de capacidade `Restam 12 de 20 hoje` com barra de 4px na proporção real (`--text` sobre `--rule`). Em zero, o botão fica desabilitado e diz quando a quota volta. |
| Limite global | Quando as 300 estimativas do dia acabam para todos, o botão fica desabilitado com a frase "O limite diário do serviço acabou; volta amanhã" e a linha de capacidade do usuário continua mostrando o que ele ainda teria. |
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
- **Do** conferir qualquer cor nova contra a tabela de contraste e a distância mínima entre inks antes do PR.

### Don't:
- **Don't** colorir custo: nada de vermelho para caro nem de verde para barato.
- **Don't** usar matiz para seleção, foco, aba ativa ou link: são tinta.
- **Don't** deixar link ou botão terciário sem sublinhado permanente; em tinta, o sublinhado é o que diz que o texto clica.
- **Don't** criar um verde de sucesso; o sucesso se diz em texto.
- **Don't** usar ladrilho colorido fora do bloco do canvas e da paleta.
- **Don't** usar o laranja da marca AWS, o logotipo da AWS ou os ícones oficiais de arquitetura como identidade.
- **Don't** usar gradiente, brilho, vidro, desfoque de fundo ou sombra em repouso.
- **Don't** pôr ícone em quadrado colorido nos KPIs, sparkline em total, zebra em tabela ou cabeçalho em caixa alta.
- **Don't** usar violeta ou índigo, nem fundo escuro azul-marinho ou ardósia.
- **Don't** usar texto abaixo de 12px, título acima de 28px ou número de 48px ou mais.
- **Don't** criar um segundo botão primário na mesma tela.
- **Don't** mostrar texto livre vindo da LLM; a interface só exibe números validados e rótulos próprios.
