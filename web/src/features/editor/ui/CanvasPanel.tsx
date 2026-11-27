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
  useRef,
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
import { announce } from '../hooks/announcer';
import { designStore } from '../hooks/designStore';
import { useCanvasCosts } from '../hooks/useCanvasCosts';
import { useDesignStore } from '../hooks/useDesignStore';
import {
  checkConnection,
  selectionMessage,
  toCanvasEdges,
  toCanvasNodes,
} from '../model/canvasModel';
import { planDiagram } from '../model/geometry/diagram';
import { fitInsets } from '../model/geometry/fitInsets';
import { dropBlock, isBlockDrag } from '../model/palette';
import { BlockNode, ClientNode, type BlockFlowNode, type ClientFlowNode } from './BlockNode';
import styles from './CanvasPanel.module.css';
import { Icon } from './CategoryIcon';
import { EdgeLegend } from './EdgeLegend';
import { FLOW_ARIA_LABELS } from './flowA11y';
import { TypedEdge } from './TypedEdge';
import { useSemanticZoom } from './useSemanticZoom';

type AppNode = BlockFlowNode | ClientFlowNode;

const NODE_TYPES = { block: BlockNode, client: ClientNode };
const EDGE_TYPES = { typed: TypedEdge };
/** O ajuste mostra o diagrama inteiro: o zoom que couber, entre estes limites. */
const FIT_LIMITS = { minZoom: 0.1, maxZoom: 1, duration: 0 };
/** Folga entre o diagrama e a borda do canvas, ou os controles e a legenda. */
const FIT_MARGIN = 16;
/** Marca o que fica sobre o canvas e sai da área útil do ajuste (legenda, controles). */
const OBSTACLES = '[data-fit-obstacle], .react-flow__attribution';
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
  const [dropping, setDropping] = useState(false);
  const baseline = useDesignStore((s) => s.baseline);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [fitted, setFitted] = useState(false);
  const semantic = useSemanticZoom();
  const pendingFit = useRef(true);
  const movedByUser = useRef(false);
  const lastLoaded = useRef({ document, baseline });

  // Mudança de seleção (clique, teclado, painel de custo) é dita em voz alta.
  useEffect(() => {
    const message = selectionMessage(designStore.getState().document, selection);
    if (message) announce(message);
  }, [selection]);

  const nodes = useMemo(
    () => toCanvasNodes(document, layout, selection, costs) as unknown as AppNode[],
    [document, layout, selection, costs],
  );
  const edges = useMemo(() => {
    const canvasEdges = toCanvasEdges(document, selection);
    const plan = planDiagram(nodes, canvasEdges);
    return canvasEdges.map((edge) => ({
      ...edge,
      data: { ...edge.data, route: plan.get(edge.id) },
    })) as unknown as Edge[];
  }, [document, selection, nodes]);

  // Ajuste ao diagrama inteiro: a área útil é o canvas sem a legenda, os controles e a atribuição.
  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    const obstacles = [...canvas.querySelectorAll(OBSTACLES)].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x - box.x, y: r.y - box.y, width: r.width, height: r.height };
    });
    const inset = fitInsets(box, obstacles, FIT_MARGIN);
    movedByUser.current = false;
    void flow.fitView({
      ...FIT_LIMITS,
      padding: {
        top: `${inset.top}px`,
        right: `${inset.right}px`,
        bottom: `${inset.bottom}px`,
        left: `${inset.left}px`,
      },
    });
  }, [flow]);

  // Design aberto de outro lugar (arquivo, Novo design, Meus designs) troca o documento e a base
  // juntos; salvar troca só a base. Só a troca pede um ajuste novo.
  useEffect(() => {
    const last = lastLoaded.current;
    if (document !== last.document && baseline === document && baseline !== last.baseline) {
      pendingFit.current = true;
    }
    lastLoaded.current = { document, baseline };
  }, [document, baseline]);
  // O ajuste espera todos os nós medidos (até ~2 s; depois ajusta mesmo assim, para a folha nunca
  // ficar escondida). Antes disso o diagrama fica invisível, sem "pulo" de zoom.
  useEffect(() => {
    if (!pendingFit.current) return;
    let frame = 0;
    let tries = 0;
    const measured = () =>
      flow.getNodes().every((node) => flow.getInternalNode(node.id)?.measured.width);
    const attempt = () => {
      if (!measured() && tries++ < 120) {
        frame = requestAnimationFrame(attempt);
        return;
      }
      pendingFit.current = false;
      fit();
      setFitted(true);
    };
    attempt();
    return () => cancelAnimationFrame(frame);
  }, [document, baseline, flow, fit]);
  // Janela redimensionada: reajusta, a não ser que a pessoa já tenha movido a vista.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fitted) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!movedByUser.current) fit();
      });
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [fit, fitted]);

  const onNodesChange = useCallback((changes: FlowChange[]) => {
    const { selection: current, ...actions } = designStore.getState();
    applyNodeChanges(changes, actions, current, CLIENT_NODE_ID, announce);
  }, []);
  const onEdgesChange = useCallback((changes: FlowChange[]) => {
    const { selection: current, ...actions } = designStore.getState();
    applyEdgeChanges(changes, actions, current, announce);
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
  // Arrasto cancelado (Esc) ou solto fora do canvas: o aviso de "pode soltar" não fica aceso.
  useEffect(() => {
    if (!dropping) return;
    const off = () => setDropping(false);
    window.addEventListener('dragend', off);
    window.addEventListener('drop', off);
    return () => {
      window.removeEventListener('dragend', off);
      window.removeEventListener('drop', off);
    };
  }, [dropping]);
  // Quem usa teclado dispensa o aviso com Esc.
  useEffect(() => {
    if (!refusal) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setRefusal(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [refusal]);

  // Soltar bloco da paleta (contrato da #47): só o tipo viaja; o bloco nasce com o padrão do contrato.
  const onDragOver = useCallback((e: DragEvent) => {
    if (!isBlockDrag(e.dataTransfer)) return;
    e.preventDefault();
    setDropping(true); // aviso visual de "pode soltar"
  }, []);
  const onDragLeave = useCallback((e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
  }, []);
  const onDrop = useCallback(
    (e: DragEvent) => {
      setDropping(false);
      if (!isBlockDrag(e.dataTransfer)) return;
      e.preventDefault();
      const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      dropBlock(e.dataTransfer, at, designStore.getState().addBlock);
    },
    [flow],
  );

  return (
    <div
      ref={canvasRef}
      className={styles.canvas}
      data-dropping={dropping || undefined}
      data-fitting={(!fitted && document.blocks.length > 0) || undefined}
      data-detail={semantic.detail}
      style={semantic.style}
    >
      <h2 className={styles.hidden}>Canvas</h2>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange as never}
        onEdgesChange={onEdgesChange as never}
        onNodeDragStart={() => designStore.getState().beginGesture()}
        onNodeDragStop={() => designStore.getState().endGesture()}
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
        onDragLeave={onDragLeave}
        ariaLabelConfig={FLOW_ARIA_LABELS}
        onDrop={onDrop}
        onMoveStart={(event) => {
          if (event) movedByUser.current = true;
        }}
        defaultMarkerColor={null}
        minZoom={0.1}
        maxZoom={2}
        attributionPosition="bottom-right"
        aria-label="Diagrama da arquitetura"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1.5} />
        {document.blocks.length > 0 && (
          <Panel position="bottom-left" data-fit-obstacle>
            <EdgeLegend />
          </Panel>
        )}
        <Panel
          position="top-right"
          className={styles.tools}
          data-fit-obstacle
          role="group"
          aria-label="Zoom do diagrama"
        >
          <IconButton
            aria-label="Aumentar o zoom"
            onClick={() => {
              movedByUser.current = true;
              void flow.zoomIn();
            }}
          >
            <Icon name="plus" />
          </IconButton>
          <IconButton
            aria-label="Diminuir o zoom"
            onClick={() => {
              movedByUser.current = true;
              void flow.zoomOut();
            }}
          >
            <Icon name="minus" />
          </IconButton>
          <IconButton aria-label="Ajustar à tela" onClick={fit}>
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
