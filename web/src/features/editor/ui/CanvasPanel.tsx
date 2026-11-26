import '@xyflow/react/dist/base.css';
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
} from '@xyflow/react';
import { useEffect, useMemo, type ReactElement } from 'react';
import { useCanvasCosts } from '../hooks/useCanvasCosts';
import { useDesignStore } from '../hooks/useDesignStore';
import { toCanvasEdges, toCanvasNodes } from '../model/canvasModel';
import { BlockNode, ClientNode, type BlockFlowNode, type ClientFlowNode } from './BlockNode';
import styles from './CanvasPanel.module.css';

type AppNode = BlockFlowNode | ClientFlowNode;

const NODE_TYPES = { block: BlockNode, client: ClientNode };
const FIT_OPTIONS = { padding: 0.2, maxZoom: 1 };
const ARROW = { markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 } };

/** O canvas: nós e arestas saem do design da store; ele não guarda estado do design. */
export function CanvasPanel(): ReactElement {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}

function Canvas(): ReactElement {
  const document = useDesignStore((s) => s.document);
  const layout = useDesignStore((s) => s.layout);
  const selection = useDesignStore((s) => s.selection);
  const costs = useCanvasCosts(document);
  const flow = useReactFlow();

  const nodes = useMemo(
    () => toCanvasNodes(document, layout, selection, costs) as unknown as AppNode[],
    [document, layout, selection, costs],
  );
  const edges = useMemo(
    () => toCanvasEdges(document, selection) as unknown as Edge[],
    [document, selection],
  );

  // Design carregado de fora (sem layout): ajusta o zoom aos blocos novos.
  const idsKey = document.blocks.map((block) => block.id).join();
  const unplaced = Object.keys(layout).length === 0;
  useEffect(() => {
    if (unplaced && idsKey) void flow.fitView(FIT_OPTIONS);
  }, [flow, idsKey, unplaced]);

  return (
    <div className={styles.canvas}>
      <h2 className={styles.hidden}>Canvas</h2>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={FIT_OPTIONS}
        defaultEdgeOptions={ARROW}
        defaultMarkerColor={null}
        minZoom={0.25}
        maxZoom={2}
        attributionPosition="bottom-left"
        aria-label="Diagrama da arquitetura"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1.5} />
      </ReactFlow>
      {document.blocks.length === 0 && (
        <p className={styles.empty}>Adicione um bloco pela paleta para começar o desenho.</p>
      )}
    </div>
  );
}
