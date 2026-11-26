import { describe, expect, it, vi } from 'vitest';
import contract from '../../../../../contracts/blocks.json';
import { blockDefinition } from '../../pricing';
import { designDocumentSchema } from '../../../shared/lib/design';
import {
  BLOCK_DRAG_MIME,
  PALETTE_GROUP_IDS,
  PALETTE_HINTS,
  buildPalette,
  dropBlock,
  filterPalette,
  isBlockDrag,
  newBlockFor,
  nextBlockPosition,
  normalizeSearch,
  readDraggedBlockType,
} from './palette';

const contractTypes = contract.blocks.map((block) => block.type);
const palette = buildPalette();
const listed = palette.flatMap((group) => group.items.map((item) => item.type));

function dragData(entries: Record<string, string>) {
  return { types: Object.keys(entries), getData: (type: string) => entries[type] ?? '' };
}

describe('paleta derivada do contrato', () => {
  it('lista todo bloco de contracts/blocks.json, uma vez só', () => {
    expect(contractTypes).toHaveLength(20);
    expect([...listed].sort()).toEqual([...contractTypes].sort());
  });

  it('falha se um bloco do contrato sumir da paleta', () => {
    const [removed, ...rest] = contract.blocks;
    const without = buildPalette(rest as never).flatMap((g) => g.items.map((i) => i.type));
    expect(without).not.toContain(removed?.type);
    expect(without).toHaveLength(19);
  });

  it('tem descrição em pt-BR para todo tipo do contrato', () => {
    for (const type of contractTypes) {
      expect(PALETTE_HINTS[type as keyof typeof PALETTE_HINTS], type).toBeTruthy();
    }
    expect(Object.keys(PALETTE_HINTS).sort()).toEqual([...contractTypes].sort());
  });

  it('agrupa em cinco grupos de 3 a 5, na ordem do DESIGN.md', () => {
    expect(palette.map((g) => g.id)).toEqual([...PALETTE_GROUP_IDS]);
    expect(palette.map((g) => g.label)).toEqual([
      'Computação',
      'Dados',
      'Rede',
      'Segurança',
      'Operação',
    ]);
    for (const group of palette) expect(group.items.length).toBeGreaterThanOrEqual(3);
    for (const group of palette) expect(group.items.length).toBeLessThanOrEqual(5);
  });
});

describe('busca', () => {
  it('ignora maiúsculas e acentos', () => {
    expect(normalizeSearch('  SEGURANÇA  ')).toBe('seguranca');
    const names = (q: string) =>
      filterPalette(palette, q).flatMap((g) => g.items.map((i) => i.name));
    expect(names('LAMBDA')).toEqual(['Lambda']);
    expect(names('conteineres')).toEqual(['ECS']);
    expect(names('aws.nat')).toEqual(['NAT Gateway']);
    expect(names('seguranca')).toHaveLength(4);
  });

  it('busca vazia devolve tudo e sem resultado devolve nada', () => {
    expect(filterPalette(palette, '  ')).toHaveLength(5);
    expect(filterPalette(palette, 'zzzz')).toEqual([]);
  });

  it('esconde o grupo sem itens', () => {
    expect(filterPalette(palette, 'sqs').map((g) => g.id)).toEqual(['data']);
  });
});

describe('bloco novo', () => {
  it('traz nome, atributos e uso padrão do contrato, e é aceito pelo schema do design', () => {
    for (const type of contractTypes) {
      const block = newBlockFor(type);
      expect(block, type).not.toBeNull();
      const result = designDocumentSchema.safeParse({
        schemaVersion: 1,
        region: 'us-east-1',
        workload: { description: '' },
        blocks: [{ ...block, id: 'blk_x', overrides: {} }],
        edges: [],
        scenarios: [],
      });
      expect(result.success, type).toBe(true);
    }
    const ec2 = newBlockFor('aws.ec2');
    expect(ec2?.attributes).toEqual({ instanceType: 't3.small' });
    expect(ec2?.usage.source).toBe('default');
    const keys = blockDefinition('aws.ec2')?.usage.map((u) => u.key) ?? [];
    expect(Object.keys(ec2?.usage.values ?? {})).toEqual(keys);
  });

  it('recusa tipo fora do contrato', () => {
    expect(newBlockFor('aws.unknown')).toBeNull();
    expect(newBlockFor('__proto__')).toBeNull();
  });
});

describe('arrasto', () => {
  it('lê só tipo do contrato no MIME próprio', () => {
    expect(BLOCK_DRAG_MIME).toBe('application/x-acp-block-type');
    expect(readDraggedBlockType(dragData({ [BLOCK_DRAG_MIME]: 'aws.s3' }))).toBe('aws.s3');
    expect(readDraggedBlockType(dragData({ [BLOCK_DRAG_MIME]: 'aws.nope' }))).toBeNull();
    expect(readDraggedBlockType(dragData({ 'text/plain': 'aws.s3' }))).toBeNull();
    expect(isBlockDrag({ types: [BLOCK_DRAG_MIME] })).toBe(true);
    expect(isBlockDrag({ types: ['Files'] })).toBe(false);
  });

  it('dropBlock chama a ação com o bloco padrão e a posição do soltar', () => {
    const add = vi.fn(() => ({ ok: true }));
    expect(dropBlock(dragData({ [BLOCK_DRAG_MIME]: 'aws.sqs' }), { x: 10, y: 20 }, add)).toBe(true);
    expect(add).toHaveBeenCalledWith(newBlockFor('aws.sqs'), { x: 10, y: 20 });
  });

  it('dropBlock ignora dado inválido e repassa a recusa da store', () => {
    const add = vi.fn(() => ({ ok: false }));
    expect(dropBlock(dragData({ [BLOCK_DRAG_MIME]: 'x' }), { x: 0, y: 0 }, add)).toBe(false);
    expect(add).not.toHaveBeenCalled();
    expect(dropBlock(dragData({ [BLOCK_DRAG_MIME]: 'aws.s3' }), { x: 0, y: 0 }, add)).toBe(false);
  });
});

describe('posição pelo teclado', () => {
  it('começa em 96,96 e desce em diagonal sem repetir posição', () => {
    expect(nextBlockPosition({})).toEqual({ x: 96, y: 96 });
    expect(nextBlockPosition({ a: { x: 96, y: 96 } })).toEqual({ x: 128, y: 128 });
    expect(
      nextBlockPosition({ a: { x: 96, y: 96 }, b: { x: 128, y: 128 }, c: { x: 5, y: 5 } }),
    ).toEqual({ x: 160, y: 160 });
  });
});
