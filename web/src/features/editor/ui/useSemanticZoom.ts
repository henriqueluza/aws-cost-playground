import { useStore } from '@xyflow/react';
import { useState, type CSSProperties } from 'react';
import {
  compactScale,
  nameLines,
  nodeDetail,
  type NodeDetail,
} from '../model/geometry/semanticZoom';

/** Zoom do canvas, a 0,01: o nó só é redesenhado quando o corpo do texto muda de fato. */
const useZoom = () => useStore((state) => Math.round(state.transform[2] * 100) / 100);

/**
 * Modo e ampliação do texto dos blocos para o zoom atual (`model/geometry/semanticZoom`). O
 * resultado vai ao canvas como `data-detail` e variáveis CSS; os blocos só leem o CSS.
 */
export function useSemanticZoom(): { detail: NodeDetail; style: CSSProperties } {
  const zoom = useZoom();
  const [detail, setDetail] = useState<NodeDetail>('full');
  const next = nodeDetail(zoom, detail);
  if (next !== detail) setDetail(next); // histerese: o modo anterior é parte da entrada
  const scale = compactScale(zoom);
  const style = {
    '--node-scale': scale,
    '--name-lines': nameLines(scale),
  } as CSSProperties;
  return { detail: next, style };
}
