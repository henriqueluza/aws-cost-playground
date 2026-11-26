import { useId, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth';
import { designErrorMessage, isRetryable } from '../../designs';
import { catalogErrorText } from '../../pricing';
import type { DesignDocument } from '../../../shared/lib/design';
import { Button, EmptyState, Notice } from '../../../shared/ui';
import { plural } from '../application/format';
import { useSideDocument, type SideDocument, type Source } from '../hooks/useSideDocument';
import { useSideEstimate, type SideState } from '../hooks/useSideEstimate';
import { compareEstimates, contextDifferences } from '../model/compare';
import { CompareTable, SummaryStrip } from './CompareTable';
import { SourcePicker } from './SourcePicker';
import styles from './ComparePage.module.css';

const REGION_NOTICE =
  'Os dois designs estão em regiões diferentes. Cada um é calculado com os preços da sua região, então parte da diferença vem do preço da região.';
const WORKLOAD_NOTICE =
  'As descrições de carga dos dois designs são diferentes. A diferença de custo mistura a arquitetura e a carga que cada um assume.';

type SideView = { doc: SideDocument; state: SideState; document: DesignDocument | null };

/** O documento do lado e o custo dele, com o catálogo da região do próprio design. */
function useSide(source: Source): SideView {
  const doc = useSideDocument(source);
  const document = doc.status === 'ready' ? doc.document : null;
  return { doc, state: useSideEstimate(document), document };
}

/** Um lado: título, origem, região e tamanho do design, e o estado do documento e dos preços. */
function Side(props: { side: 'A' | 'B'; view: SideView; children: ReactNode }) {
  const titleId = useId();
  const { doc, state, document } = props.view;
  return (
    <section aria-labelledby={titleId} className={styles.side}>
      <h2 id={titleId} className={styles.sectionTitle}>
        Design {props.side}
      </h2>
      {props.children}
      {document !== null && (
        <p className={styles.meta}>
          <span className={styles.mono}>{document.region}</span>
          <span>{plural(document.blocks.length, 'bloco', 'blocos')}</span>
          <span>{plural(document.edges.length, 'aresta', 'arestas')}</span>
        </p>
      )}
      {(doc.status === 'loading' || state.status === 'loading') && (
        <p role="status" className={styles.hint}>
          {document === null ? 'Buscando o design…' : `Buscando os preços de ${document.region}…`}
        </p>
      )}
      {doc.status === 'error' && (
        <>
          <Notice tone="negative" message={designErrorMessage(doc.kind)} />
          {isRetryable(doc.kind) && <Button onClick={doc.retry}>Tentar de novo</Button>}
        </>
      )}
      {state.status === 'error' && document !== null && (
        <>
          <Notice tone="negative" message={catalogErrorText(state.kind, document.region)} />
          <Button onClick={state.retry}>Tentar de novo</Button>
        </>
      )}
    </section>
  );
}

const NO_FILE: Source = { kind: 'file', file: null };

/**
 * Compara dois designs (F28). Cada lado vem do design em edição, de um arquivo JSON ou, com
 * sessão, de um salvo na conta. Só lê: a store do editor não é alterada e o anônimo não chama a API.
 */
export function ComparePage(): ReactElement {
  const signedIn = useAuth().snapshot.status === 'authenticated';
  const [pickedA, setPickedA] = useState<Source>({ kind: 'editor' });
  const [pickedB, setPickedB] = useState<Source>(NO_FILE);
  // Sem sessão (ou depois de sair) a origem "salvo" deixa de valer.
  const sourceA = !signedIn && pickedA.kind === 'saved' ? NO_FILE : pickedA;
  const sourceB = !signedIn && pickedB.kind === 'saved' ? NO_FILE : pickedB;
  const [a, b] = [useSide(sourceA), useSide(sourceB)];
  const comparison = useMemo(
    () =>
      a.state.status === 'ready' && b.state.status === 'ready'
        ? compareEstimates(a.state.estimate, b.state.estimate)
        : null,
    [a.state, b.state],
  );
  const context = a.document && b.document && contextDifferences(a.document, b.document);
  const missing = comparison && comparison.unavailable.a + comparison.unavailable.b;
  const waiting = [a.doc.status === 'empty' && 'A', b.doc.status === 'empty' && 'B'].filter(
    Boolean,
  );

  return (
    <main className={styles.page}>
      <div className={styles.sheet}>
        <header className={styles.header}>
          <h1 className={styles.title}>Comparar designs</h1>
          <Link to="/" className={styles.back}>
            Voltar ao editor
          </Link>
        </header>
        <div className={styles.pickers}>
          <Side side="A" view={a}>
            <SourcePicker side="A" source={sourceA} signedIn={signedIn} onChange={setPickedA} />
          </Side>
          <Side side="B" view={b}>
            <SourcePicker side="B" source={sourceB} signedIn={signedIn} onChange={setPickedB} />
          </Side>
        </div>
        {context && (context.region || context.workload) && (
          <div className={styles.notices}>
            {context.region && <Notice tone="warning" message={REGION_NOTICE} />}
            {context.workload && <Notice tone="warning" message={WORKLOAD_NOTICE} />}
          </div>
        )}
        {waiting.length > 0 && (
          <EmptyState
            title={`Escolha o design ${waiting.join(' e ')}`}
            description="Escolha a origem: o design em edição, um arquivo JSON baixado do editor ou, com sessão, um design salvo na conta."
            action={null}
          />
        )}
        {comparison && (
          <>
            <SummaryStrip comparison={comparison} />
            {missing ? (
              <Notice
                tone="warning"
                message={`Itens sem preço no catálogo valem zero e ficam fora dos totais: ${comparison.unavailable.a} no design A e ${comparison.unavailable.b} no design B.`}
              />
            ) : null}
            <CompareTable comparison={comparison} />
            <p className={styles.footnote}>
              Estimativa on-demand, não é cotação oficial. Diferença = design B menos design A.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
