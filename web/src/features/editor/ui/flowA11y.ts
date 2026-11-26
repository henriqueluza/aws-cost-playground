import type { AriaLabelConfig } from '@xyflow/react';

const DIRECTIONS: Readonly<Record<string, string>> = {
  up: 'para cima',
  down: 'para baixo',
  left: 'para a esquerda',
  right: 'para a direita',
};

const NODE_HELP =
  'Enter ou Espaço seleciona o bloco. Com ele selecionado, as setas o movem em passos de 8 px (Shift: 32 px), Delete o remove e Esc limpa a seleção.';

/** Textos do React Flow em pt-BR (a biblioteca vem em inglês). Só números e direção fixa. */
export const FLOW_ARIA_LABELS: Partial<AriaLabelConfig> = {
  'node.a11yDescription.default': NODE_HELP,
  'node.a11yDescription.keyboardDisabled': NODE_HELP,
  'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }) =>
    `Bloco movido ${DIRECTIONS[direction] ?? ''}. Nova posição, x: ${x}, y: ${y}`,
  'edge.a11yDescription.default':
    'Enter ou Espaço seleciona a conexão. Com ela selecionada, Delete a remove e Esc limpa a seleção.',
  'handle.ariaLabel': 'Ponto de conexão',
};
