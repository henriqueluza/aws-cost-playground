import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { memo, type ReactElement } from 'react';
import type { EdgeKind } from '../../../shared/lib/design';
import { EDGE_STYLE } from '../model/edgeKinds';
import styles from './CanvasPanel.module.css';
import { Icon, type IconName } from './CategoryIcon';

export type TypedFlowEdge = Edge<{ kind: EdgeKind }, 'typed'>;

/** Classe do traçado de cada tipo: contínuo, tracejado, pontilhado (DESIGN.md, "Arestas"). */
export const STROKE_CLASS: Record<EdgeKind, string> = {
  data: styles.strokeData ?? '',
  'runs-on': styles.strokeRunsOn ?? '',
  logs: styles.strokeLogs ?? '',
};
export const EDGE_ICON: Record<EdgeKind, IconName> = {
  data: 'edge-data',
  'runs-on': 'edge-runs-on',
  logs: 'edge-logs',
};

/**
 * Aresta tipada: traçado próprio do tipo e, no meio, uma etiqueta com o ícone do tipo (e o nome,
 * quando selecionada). A etiqueta é decorativa: o nome acessível da aresta vem do `ariaLabel`.
 */
export const TypedEdge = memo(function TypedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected,
  data,
}: EdgeProps<TypedFlowEdge>): ReactElement {
  const kind = data?.kind ?? 'data';
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 6,
  });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={STROKE_CLASS[kind]} />
      <EdgeLabelRenderer>
        <span
          className={styles.edgeTag}
          data-kind={kind}
          data-selected={selected || undefined}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          aria-hidden="true"
        >
          <Icon name={EDGE_ICON[kind]} />
          {selected ? EDGE_STYLE[kind].label : null}
        </span>
      </EdgeLabelRenderer>
    </>
  );
});
