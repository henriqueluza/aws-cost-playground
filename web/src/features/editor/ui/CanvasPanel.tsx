import '@xyflow/react/dist/base.css';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type FinalConnectionState,
} from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type ReactElement,
} from 'react';
import { CLIENT_NODE_ID } from '../../../shared/lib/design';
import { EmptyState, IconButton, Notice } from '../../../shared/ui';
import {
  applyEdgeChanges,
  applyNodeChanges,
  connectBlocks,
  refusalMessage,
  type FlowChange,
} from '../hooks/canvasHandlers';
import { designStore } from '../hooks/designStore';
import { useCanvasCosts } from '../hooks/useCanvasCosts';
import { useDesignStore } from '../hooks/useDesignStore';
import { checkConnection, toCanvasEdges, toCanvasNodes } from '../model/canvasModel';
import { dropBlock, isBlockDrag } from '../model/palette';
import { BlockNode, ClientNode, type BlockFlowNode, type ClientFlowNode } from './BlockNode';
import styles from './CanvasPanel.module.css';
import { Icon } from './CategoryIcon';

type AppNode = BlockFlowNode | ClientFlowNode;

const NODE_TYPES = { block: BlockNode, client: ClientNode };
const FIT_OPTIONS = { padding: 0.2, maxZoom: 1 };
const GRID: [number, number] = [8, 8];

/** O canvas: nós e arestas saem do design da store; cada gesto vira uma ação dela. */
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
  const [refusal, setRefusal] = useState<string | null>(null);

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

  const onNodesChange = useCallback((changes: FlowChange[]) => {
    const { selection: current, ...actions } = designStore.getState();
    applyNodeChanges(changes, actions, current, CLIENT_NODE_ID);
  }, []);
  const onEdgesChange = useCallback((changes: FlowChange[]) => {
    const { selection: current, ...actions } = designStore.getState();
    applyEdgeChanges(changes, actions, current);
  }, []);

  const isValidConnection = useCallback(
    (c: Connection | Edge) =>
      checkConnection(designStore.getState().document, c.source, c.target).ok,
    [],
  );
  const onConnect = useCallback((c: Connection) => {
    setRefusal(connectBlocks(c, designStore.getState()));
  }, []);
  // O React Flow recusa em silêncio; aqui o motivo chega ao usuário.
  const onConnectEnd = useCallback((_: unknown, state: FinalConnectionState) => {
    if (state.isValid !== false || !state.fromNode || !state.toNode) return;
    const from = state.fromNode.id;
    const to = state.toNode.id;
    const ends =
      state.fromHandle?.type === 'target'
        ? { source: to, target: from }
        : { source: from, target: to };
    setRefusal(refusalMessage(designStore.getState().document, ends));
  }, []);
  // Quem usa teclado dispensa o aviso com Esc.
  useEffect(() => {
    if (!refusal) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setRefusal(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [refusal]);

  // Soltar bloco da paleta (contrato da #47): só o tipo viaja; o bloco nasce com o padrão do contrato.
  const onDragOver = useCallback((e: DragEvent) => {
    if (isBlockDrag(e.dataTransfer)) e.preventDefault();
  }, []);
  const onDrop = useCallback(
    (e: DragEvent) => {
      if (!isBlockDrag(e.dataTransfer)) return;
      e.preventDefault();
      const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      dropBlock(e.dataTransfer, at, designStore.getState().addBlock);
    },
    [flow],
  );

  return (
    <div className={styles.canvas}>
      <h2 className={styles.hidden}>Canvas</h2>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange as never}
        onEdgesChange={onEdgesChange as never}
        onConnect={onConnect}
        onConnectStart={() => setRefusal(null)}
        onConnectEnd={onConnectEnd}
        onPaneClick={() => setRefusal(null)}
        isValidConnection={isValidConnection}
        connectionMode={ConnectionMode.Strict}
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode={null}
        selectionKeyCode={null}
        snapToGrid
        snapGrid={GRID}
        onDragOver={onDragOver}
        onDrop={onDrop}
        fitView
        fitViewOptions={FIT_OPTIONS}
        defaultMarkerColor={null}
        minZoom={0.25}
        maxZoom={2}
        attributionPosition="bottom-left"
        aria-label="Diagrama da arquitetura"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1.5} />
        <Panel
          position="top-right"
          className={styles.tools}
          role="group"
          aria-label="Zoom do diagrama"
        >
          <IconButton aria-label="Aumentar o zoom" onClick={() => void flow.zoomIn()}>
            <Icon name="plus" />
          </IconButton>
          <IconButton aria-label="Diminuir o zoom" onClick={() => void flow.zoomOut()}>
            <Icon name="minus" />
          </IconButton>
          <IconButton aria-label="Ajustar à tela" onClick={() => void flow.fitView(FIT_OPTIONS)}>
            <Icon name="fit" />
          </IconButton>
        </Panel>
      </ReactFlow>
      {document.blocks.length === 0 && (
        <div className={styles.empty}>
          <EmptyState
            title="Canvas vazio"
            description="Arraste um bloco da paleta para começar o desenho."
            action={
              <span className={styles.hint}>
                Enter ou Espaço num item da paleta também adiciona.
              </span>
            }
          />
        </div>
      )}
      <div className={styles.refusal} aria-live="polite">
        {refusal && <Notice tone="warning" message={refusal} />}
      </div>
    </div>
  );
}
