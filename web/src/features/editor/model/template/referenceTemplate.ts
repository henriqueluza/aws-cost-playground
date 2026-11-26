import {
  CLIENT_NODE_ID,
  designDocumentSchema,
  type DesignDocument,
} from '../../../../shared/lib/design';
import type { Layout } from '../editorState';
import referenceTemplate from '../../../../../../contracts/templates/reference.json';

/** Passo entre colunas e entre linhas do diagrama, em px (o bloco tem 216 de largura). */
const STEP = { x: 248, y: 112 } as const;

/**
 * Coluna e linha de cada nó: camadas da esquerda para a direita (CDN e DNS, borda e balanceador, aplicação,
 * dados e operação, saída e logs). Meia linha de diferença abre passagem às arestas
 * entre dois blocos da mesma coluna.
 */
const GRID: Readonly<Record<string, readonly [column: number, row: number]>> = {
  blk_cdn: [0, 1.5],
  blk_route53: [0, 4],
  [CLIENT_NODE_ID]: [1, 0],
  blk_waf: [1, 1.25],
  blk_assets: [1, 2.5],
  blk_alb: [1, 4],
  blk_ecs: [2, 2],
  blk_lambda: [2, 5.5],
  blk_ec2: [3, 0],
  blk_db: [3, 1],
  blk_cache: [3, 2],
  blk_queue: [3, 3],
  blk_secrets: [3, 4],
  blk_table: [3, 5],
  blk_auth: [3, 6],
  blk_trail: [3, 7],
  blk_pipeline: [3, 8],
  blk_stack: [3, 9],
  blk_iam: [3, 10],
  blk_nat: [4, 0],
  blk_logs: [4, 6],
};

/**
 * O template inicial de um design novo (PRD F5): os 20 blocos do MVP ligados como na arquitetura
 * de referência, uma descrição de carga de exemplo e `usage` com `source: "default"` em tudo. É um
 * documento do mesmo tipo dos de `contracts/scenarios/`; cada chamada devolve cópias novas.
 */
export function referenceDesign(): DesignDocument {
  return designDocumentSchema.parse(structuredClone(referenceTemplate));
}

/** Posições dos nós do template, para o diagrama abrir legível. */
export function referenceLayout(): Layout {
  return Object.fromEntries(
    Object.entries(GRID).map(([id, [column, row]]) => [
      id,
      { x: column * STEP.x, y: row * STEP.y },
    ]),
  );
}
