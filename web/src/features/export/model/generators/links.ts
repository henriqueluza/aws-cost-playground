import type { BlockType } from '../../../pricing';
import type { ExportBlock, ExportLink } from '../generator';

/**
 * Blocos de um tipo ligados a este por aresta de dados, sem repetição e na ordem das arestas.
 * `role` é o papel DESTE bloco: `source` devolve os destinos, `target` devolve as origens.
 */
export function dataPeers(
  links: readonly ExportLink[],
  role: ExportLink['role'],
  type: BlockType,
): ExportBlock[] {
  const peers = new Map<string, ExportBlock>();
  for (const link of links) {
    if (link.kind === 'data' && link.role === role && link.peer?.type === type) {
      peers.set(link.peer.id, link.peer);
    }
  }
  return [...peers.values()];
}
