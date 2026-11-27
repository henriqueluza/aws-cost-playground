import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, type ReactElement } from 'react';
import { CATEGORY_LABELS, type BlockNodeData, type ClientNodeData } from '../model/canvasModel';
import styles from './CanvasPanel.module.css';
import { Icon } from './CategoryIcon';

export type BlockFlowNode = Node<BlockNodeData, 'block'>;
export type ClientFlowNode = Node<ClientNodeData, 'client'>;

/** Bloco do design (DESIGN.md, "Bloco no canvas"). Todo texto vem como filho React, nunca HTML. */
export const BlockNode = memo(function BlockNode({ data }: NodeProps<BlockFlowNode>): ReactElement {
  const { category, label, summary, cost, costZero, costNote } = data;
  return (
    <div className={styles.block} data-category={category ?? 'none'}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <div className={styles.head}>
        <span className={styles.tile} title={category ? CATEGORY_LABELS[category] : undefined}>
          {category && <Icon name={category} />}
        </span>
        <span className={styles.name} title={label}>
          {label}
        </span>
      </div>
      <div className={styles.summary} title={summary}>
        {summary}
      </div>
      <div className={styles.quota}>
        <span className={styles.per}>{costNote ?? 'por mês'}</span>
        <span className={costZero ? styles.valueMuted : styles.value}>{cost}</span>
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
});

/** Nó fixo da internet: destino das arestas de saída, sem preço e sem categoria. */
export const ClientNode = memo(function ClientNode({
  data,
}: NodeProps<ClientFlowNode>): ReactElement {
  return (
    <div className={`${styles.block} ${styles.blockClient}`}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <div className={styles.head}>
        <span className={`${styles.tile} ${styles.tileClient}`}>
          <Icon name="globe" />
        </span>
        <span className={styles.name}>{data.label}</span>
      </div>
    </div>
  );
});
