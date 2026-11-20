# Product

<!-- impeccable:product-schema 1 -->

<!-- Escrito na Issue #4 em execução não assistida: não houve entrevista. Cada fato abaixo vem do PRD e do ADR-0001 (aprovados pelo autor nos Gates 1 e 2); o que é inferência está marcado "(inferido)". Fonte da verdade do escopo continua sendo docs/product/aws-cost-playground/PRD.md. -->

## Platform

web

## Users

- **Quem começa um projeto na AWS** e precisa de uma primeira estimativa de custo mensal antes de criar a conta ou escrever a infra. Monta a arquitetura num canvas e descreve a carga em português.
- No lançamento, o único usuário é o autor; o cadastro é aberto desde o primeiro dia.
- Uso em sessões de trabalho no desktop: montar, ajustar, comparar duas versões (inferido: sessões de 15 a 60 minutos, não um olhar rápido).

## Product Purpose

Dar um número de custo mensal confiável o bastante para decidir: o total, quanto é fixo e quanto é variável, por bloco e por aresta, calculado de SKUs reais da Price List API. Sucesso é o número ficar a ±15% da AWS Pricing Calculator nos três cenários de referência e o design virar Terraform que passa em `terraform validate`.

## Positioning

O cálculo é determinístico e roda no navegador a partir de um catálogo estático com data; a LLM só traduz a descrição da carga em números de uso, e cada número mostra de onde veio (LLM, padrão ou alterado à mão). O usuário vê o preço mudar a cada bloco, atributo ou aresta, sem login.

## Operating Context

- Editor: canvas com 20 blocos AWS, arestas tipadas (`data`, `runs-on`, `logs`) e o nó fixo `client`; paleta, inspetor de bloco e painel de custo.
- Região única por design (us-east-1 ou sa-east-1); valores em dólar.
- Fluxo típico: abrir o template já calculado, trocar blocos e atributos, escrever a carga, "Re-estimar carga", corrigir valores à mão, salvar, comparar com outro design, exportar Terraform ou JSON.

## Capabilities and Constraints

- Interface em português do Brasil; nomes de serviço e de SKU em inglês.
- Editor só em desktop; em tela pequena ele avisa que precisa de tela maior. Páginas de texto (privacidade, termos) funcionam no celular.
- Aviso permanente de que o valor é estimativa, não cotação oficial, com a data do catálogo.
- Nenhum texto livre da LLM é exibido; só números validados.
- Quota de estimativas por LLM: 20 por dia por usuário, com contador do que resta.
- Hospedagem estática (S3 + CloudFront) com CSP; nenhum custo fixo novo.

## Brand Commitments

- Nome: AWS Cost Playground. Não há logo, marca ou paleta definida antes desta Issue.
- O produto não é da AWS e não deve parecer oficial da AWS (inferido: não usar o laranja da marca AWS, o "smile" nem os ícones oficiais como identidade).

## Evidence on Hand

- O template inicial de 20 blocos e os 3 cenários de referência (API serverless, app clássico, pipeline de filas) são os dados reais de demonstração.
- Não há depoimentos, clientes, métricas de uso nem imagens de produto. Nada disso deve ser inventado.

## Product Principles

1. O número primeiro: toda tela de trabalho responde "quanto custa por mês e por quê".
2. Origem visível: cada valor diz se veio da LLM, do padrão ou da mão do usuário.
3. Honestidade sobre o preço: estimativa, data do catálogo e on-demand sempre ditos.
4. Funciona sem conta: o modo anônimo é completo para editar, calcular e exportar.

## Accessibility & Inclusion

WCAG 2.2 AA fora do canvas. No canvas, seleção e edição de blocos pelo teclado.
