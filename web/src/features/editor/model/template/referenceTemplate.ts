import {
  CLIENT_NODE_ID,
  designDocumentSchema,
  type DesignDocument,
} from '../../../../shared/lib/design';
import type { Layout } from '../editorState';
import referenceTemplate from '../../../../../../contracts/templates/reference.json';

/** Passo entre colunas e entre linhas do diagrama, em px (o bloco tem 216 de largura). */
const STEP = { x: 264, y: 128 } as const;

/**
 * Coluna e linha de cada nó: camadas da esquerda para a direita (DNS e CDN, borda, balanceador,
 * aplicação, dados, saída e observabilidade). Meia linha de diferença abre passagem às arestas
 * entre dois blocos da mesma coluna.
 */
const GRID: Readonly<Record<string, readonly [column: number, row: number]>> = {
  blk_route53: [0, 0],
  blk_cdn: [1, 0],
  [CLIENT_NODE_ID]: [2, 0],
  blk_waf: [2, 1],
  blk_assets: [2, 2],
  blk_alb: [3, 1],
  blk_ecs: [4, 1],
  blk_lambda: [4, 3],
  blk_ec2: [5, 0],
  blk_db: [5, 1],
  blk_cache: [5, 2],
  blk_table: [5, 3],
  blk_queue: [5, 4],
  blk_nat: [6, 0],
  blk_secrets: [6, 1.5],
  blk_auth: [6, 2.5],
  blk_trail: [6, 3.5],
  blk_pipeline: [6, 4.5],
  blk_stack: [6, 5.5],
  blk_iam: [6, 6.5],
  blk_logs: [7, 3.5],
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
