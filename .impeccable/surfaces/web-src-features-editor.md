---
version: 1
slug: "web-src-features-editor"
primary_target: "web/src/features/editor"
related_targets: []
---

# Surface brief: editor (web/src/features/editor)

- **Modo:** Operate. Construção code-led (tela de trabalho; sem comp).
- **Público e tarefa:** quem começa um projeto na AWS monta a arquitetura no canvas e lê quanto ela custa por mês, quanto é fixo e quanto é variável. Tarefa principal: mudar um bloco, atributo ou aresta e ver o custo mudar.
- **Ação mais frequente:** arrastar um bloco da paleta para a folha e ajustar o SKU no inspetor.
- **Restrições:** desktop a partir de 1024px; teclado no canvas; aviso de estimativa e data do catálogo sempre visíveis; nenhum texto livre da LLM.
- **Sistema visual:** `DESIGN.md` na raiz (tokens normativos). Este brief guarda só a estratégia desta superfície.

## Direction contract

THESIS: o design é uma prancha técnica cotada. O custo é escrito no próprio desenho (cota em cada bloco e em cada aresta cobrada) e resumido no carimbo do canto. Recusa o arranjo padrão da categoria: diagrama mudo de um lado e planilha de custo do outro.

OWN-WORLD: moldura em U cor de papel vegetal (barra superior, paleta e coluna direita), folha branca com 1px e cantos de 16px, tinta quase preta, IBM Plex Sans e Plex Mono em todo dólar, cinco tintas de categoria em ladrilhos de 24px só no canvas e na paleta, seleção e foco em tinta, fixo sólido e variável hachurado.

STORY: o usuário abre o template já calculado, entende de onde vem cada dólar olhando o desenho, troca um SKU e vê a cota e o carimbo mudarem na hora; confia porque cada valor de uso diz a origem e o carimbo diz "estimativa" e a data dos preços.

FIRST VIEWPORT (1440 × 900): barra superior de 48px; paleta de 232px à esquerda com os 5 grupos; folha no centro com os 20 blocos do template, todos com cota; carimbo de 320px no canto inferior direito da folha com o total em 28px mono; coluna direita de 360px com o painel de custo (total, barra fixo/variável, lista por bloco). Botão primário único na barra superior.

SIGNATURE: cotas de custo nos blocos e arestas + carimbo da prancha com total, fixo, variável, região e data do catálogo.

FORM: prancha técnica com carimbo e cotas, nº 3 da lista ordenada; seed:1388cfa49c751380.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Como a direção foi escolhida

Lista própria, por ressonância com o público: 1) conta de luz (tarifa fixa + consumo), 2) fatura da nuvem com itens por serviço, 3) prancha técnica com carimbo e cotas, 4) esboço de arquitetura em quadro branco, 5) cupom fiscal itemizado, 6) mapa de metrô do fluxo de dados, 7) saída de `terraform plan`. O roll do `concept-seed` atribuiu a nº 3.

Challengers do roll, todos recusados nos dois eixos (identificação do público e clareza do produto). O que cada um emprestou como disciplina:
- Registro de exposição de laboratório: estado sem cor, por hachura → variável hachurado.
- Telas Metro tipográficas: o número é a interface → o total sem cartão em volta no topo do painel.
- Catálogo de personagens: mobília fixa por item → anatomia idêntica em todos os blocos.
- Sinalização de aeroporto: uma cor, um trabalho → categoria só no desenho, vermelho e âmbar só para estado, o resto em tinta.
- Composição com trilho central: estados como marcas impressas → ponto, anel e cinza para a origem do valor.
- Horário de bolso de companhia aérea: hierarquia por peso, não por tamanho → cinco tamanhos, três pesos.

## Decisões em aberto (para a Issue do editor)

- Composição exata das abas da coluna direita (custo, bloco, carga).
- Posição inicial dos 20 blocos do template na folha.
