import {
  BLOCKS,
  BLOCK_TYPES,
  type BlockCategory,
  type BlockDefinition,
  type BlockType,
} from '../../pricing';
import type { Layout, NewBlock, Position } from './editorState';

/** Os cinco grupos da paleta (DESIGN.md, "A casca do editor"), na ordem em que aparecem. */
export const PALETTE_GROUP_IDS = ['compute', 'data', 'network', 'security', 'ops'] as const;
export type PaletteGroupId = (typeof PALETTE_GROUP_IDS)[number];

export const PALETTE_GROUP_LABELS: Readonly<Record<PaletteGroupId, string>> = {
  compute: 'Computação',
  data: 'Dados',
  network: 'Rede',
  security: 'Segurança',
  ops: 'Operação',
};

/** As oito categorias do contrato (nomes da AWS) caem nos cinco grupos do desenho. */
const GROUP_OF_CATEGORY: Readonly<Record<BlockCategory, PaletteGroupId>> = {
  compute: 'compute',
  storage: 'data',
  database: 'data',
  integration: 'data',
  networking: 'network',
  security: 'security',
  management: 'ops',
  devtools: 'ops',
};

/**
 * Descrição curta em pt-BR de cada serviço. O contrato guarda só o nome em inglês; o texto de
 * interface é da UI. Aparece na dica do item e entra na busca ("banco" acha RDS e DynamoDB).
 */
export const PALETTE_HINTS: Readonly<Record<BlockType, string>> = {
  'aws.ec2': 'Servidor virtual',
  'aws.ecs': 'Contêineres',
  'aws.lambda': 'Funções sem servidor',
  'aws.rds': 'Banco de dados relacional',
  'aws.dynamodb': 'Banco de dados chave-valor',
  'aws.elasticache': 'Cache em memória',
  'aws.s3': 'Armazenamento de objetos',
  'aws.sqs': 'Fila de mensagens',
  'aws.route53': 'DNS',
  'aws.cloudfront': 'CDN',
  'aws.alb': 'Balanceador de carga',
  'aws.nat-gateway': 'Saída para a internet',
  'aws.waf': 'Firewall de aplicação',
  'aws.cognito': 'Login de usuários',
  'aws.iam': 'Permissões de acesso',
  'aws.secrets-manager': 'Cofre de segredos',
  'aws.cloudwatch': 'Métricas e logs',
  'aws.cloudtrail': 'Auditoria de chamadas',
  'aws.codepipeline': 'Pipeline de entrega',
  'aws.cloudformation': 'Infraestrutura como código',
};

export type PaletteItem = {
  readonly type: BlockType;
  /** Nome do serviço, do contrato. */
  readonly name: string;
  readonly hint: string;
};
export type PaletteGroup = {
  readonly id: PaletteGroupId;
  readonly label: string;
  readonly items: readonly PaletteItem[];
};

const byName = (a: PaletteItem, b: PaletteItem) => a.name.localeCompare(b.name, 'en');

/** Deriva os grupos das definições do contrato; nenhum bloco é escrito à mão. */
export function buildPalette(blocks: readonly BlockDefinition[] = BLOCKS): PaletteGroup[] {
  return PALETTE_GROUP_IDS.map((id) => ({
    id,
    label: PALETTE_GROUP_LABELS[id],
    items: blocks
      .filter((block) => GROUP_OF_CATEGORY[block.category] === id)
      .map((block) => ({ type: block.type, name: block.name, hint: PALETTE_HINTS[block.type] }))
      .sort(byName),
  })).filter((group) => group.items.length > 0);
}

/** Minúsculas e sem acento: "Segurança" casa com "seguranca". */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Itens cujo nome, tipo ou descrição contêm a busca. Busca vazia devolve tudo. */
export function filterPalette(groups: readonly PaletteGroup[], query: string): PaletteGroup[] {
  const needle = normalizeSearch(query);
  if (needle === '') return [...groups];
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        normalizeSearch(`${item.name} ${item.type} ${item.hint}`).includes(needle),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

/** Bloco novo com o nome do serviço, os atributos e o uso padrão do contrato. */
export function newBlockFor(type: string): NewBlock | null {
  const definition = BLOCKS.find((block) => block.type === type);
  if (!definition) return null;
  return {
    type: definition.type,
    label: definition.name,
    attributes: Object.fromEntries(
      definition.attributes.flatMap((a) => (a.default === undefined ? [] : [[a.key, a.default]])),
    ),
    usage: {
      source: 'default',
      values: Object.fromEntries(definition.usage.map((u) => [u.key, u.default])),
    },
  };
}

/** Tipo MIME do arrasto da paleta para o canvas. Carrega só o tipo do bloco (ex.: `aws.ec2`). */
export const BLOCK_DRAG_MIME = 'application/x-acp-block-type';

type DragData = Pick<DataTransfer, 'types' | 'getData'>;

/** Vale durante o `dragover`, quando o navegador esconde o conteúdo: o canvas libera o drop. */
export function isBlockDrag(data: Pick<DataTransfer, 'types'>): boolean {
  return Array.from(data.types).includes(BLOCK_DRAG_MIME);
}

/** Lê o tipo arrastado no `drop`; `null` se não é da paleta ou não está no contrato. */
export function readDraggedBlockType(data: DragData): BlockType | null {
  if (!isBlockDrag(data)) return null;
  const raw = data.getData(BLOCK_DRAG_MIME);
  return BLOCK_TYPES.find((type) => type === raw) ?? null;
}

type AddBlock = (block: NewBlock, position: Position) => { readonly ok: boolean };

/** Lê o arrasto e adiciona o bloco na posição do soltar. `false` se o dado é inválido ou a store recusou. */
export function dropBlock(data: DragData, position: Position, addBlock: AddBlock): boolean {
  const type = readDraggedBlockType(data);
  const block = type && newBlockFor(type);
  return block ? addBlock(block, position).ok : false;
}

const FIRST_POSITION: Position = { x: 96, y: 96 };
const STEP = 32;

/** Posição do bloco adicionado pelo teclado: em diagonal, sem cair exatamente sobre outro. */
export function nextBlockPosition(layout: Layout): Position {
  const taken = new Set(Object.values(layout).map((p) => `${p.x},${p.y}`));
  let position = FIRST_POSITION;
  for (let i = 0; taken.has(`${position.x},${position.y}`) && i < taken.size; i += 1) {
    position = { x: position.x + STEP, y: position.y + STEP };
  }
  return position;
}
