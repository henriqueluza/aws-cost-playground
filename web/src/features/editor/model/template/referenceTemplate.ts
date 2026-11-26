import {
  CLIENT_NODE_ID,
  designDocumentSchema,
  type DesignDocument,
} from '../../../../shared/lib/design';
import type { Layout } from '../editorState';
import referenceTemplate from '../../../../../../contracts/templates/reference.json';

/** Início (x) de cada coluna, em px: o bloco tem 216 de largura. */
const COLUMN_X = [0, 268, 520, 788, 1052] as const;
/** Passo entre linhas, em px: o bloco tem 94 de altura. */
const ROW = 104;

/**
 * Coluna e linha de cada nó: camadas da esquerda para a direita (CDN e DNS, borda e balanceador,
 * aplicação, dados e operação, saída e logs). Toda aresta liga colunas vizinhas. Os corredores entre
 * colunas têm de 36 a 52 px; os mais largos são os que recebem mais linhas (5 saindo do ECS).
 * As linhas são tão juntas quanto o bloco permite, porque o diagrama inteiro tem de caber no canvas.
 */
const GRID: Readonly<Record<string, readonly [column: number, row: number]>> = {
  blk_cdn: [0, 1.5],
  blk_route53: [0, 4.5],
  [CLIENT_NODE_ID]: [1, 0],
  blk_waf: [1, 1.2],
  blk_assets: [1, 2.4],
  blk_alb: [1, 3.8],
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
  blk_logs: [4, 5.5],
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
      { x: COLUMN_X[column] ?? 0, y: row * ROW },
    ]),
  );
}
