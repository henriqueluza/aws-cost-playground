import {
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Link } from 'react-router';
import {
  designFileMessage,
  readDesignFile,
  useDesignStore,
  type DesignFileError,
} from '../../editor';
import { catalogErrorText } from '../../pricing';
import type { DesignDocument } from '../../../shared/lib/design';
import { Button, EmptyState, Notice } from '../../../shared/ui';
import { plural } from '../application/format';
import { useSideEstimate, type SideState } from '../hooks/useSideEstimate';
import { compareEstimates, contextDifferences } from '../model/compare';
import { CompareTable, SummaryStrip } from './CompareTable';
import styles from './ComparePage.module.css';

const REGION_NOTICE =
  'Os dois designs estão em regiões diferentes. Cada um é calculado com os preços da sua região, então parte da diferença vem do preço da região.';
const WORKLOAD_NOTICE =
  'As descrições de carga dos dois designs são diferentes. A diferença de custo mistura a arquitetura e a carga que cada um assume.';

/** Um lado: título, região e tamanho do design, e o estado dos preços da região dele. */
function Side(props: {
  side: 'A' | 'B';
  document: DesignDocument | null;
  state: SideState;
  children?: ReactNode;
}) {
  const titleId = useId();
  const { document, state } = props;
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
      {state.status === 'loading' && (
        <p role="status" className={styles.hint}>
          Buscando os preços de {document?.region}…
        </p>
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

/** Escolhe o arquivo do design B. Passa pela MESMA leitura e validação de "Abrir arquivo" do editor. */
function FilePicker(props: {
  onLoad: (file: { name: string; document: DesignDocument }) => void;
  name?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const chosen = props.name !== undefined;
  const [error, setError] = useState<{ name: string; error: DesignFileError } | null>(null);
  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = ''; // o mesmo arquivo de novo precisa disparar `change`
    if (file === undefined) return;
    const result = await readDesignFile(file);
    if (!result.ok) return setError({ name: file.name, error: result.error });
    setError(null);
    props.onLoad({ name: file.name, document: result.document });
  };
  return (
    <>
      <div className={styles.file}>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="Arquivo JSON do design B"
          onChange={(event) => void pick(event)}
        />
        <Button variant={chosen ? 'secondary' : 'primary'} onClick={() => input.current?.click()}>
          {chosen ? 'Trocar arquivo' : 'Escolher arquivo JSON'}
        </Button>
        {chosen && (
          <span className={styles.fileName} title={props.name}>
            {props.name}
          </span>
        )}
      </div>
      {error !== null && (
        <Notice tone="negative" message={`${error.name}: ${designFileMessage(error.error)}`} />
      )}
    </>
  );
}

/**
 * Compara dois designs (F28): o que está no editor (A) e um arquivo JSON (B). Só lê: a store do
 * editor não é alterada e nada sai do navegador além da busca dos preços.
 */
export function ComparePage(): ReactElement {
  const docA = useDesignStore((s) => s.document);
  const [file, setFile] = useState<{ name: string; document: DesignDocument } | null>(null);
  const docB = file?.document ?? null;
  const [stateA, stateB] = [useSideEstimate(docA), useSideEstimate(docB)];
  const comparison = useMemo(
    () =>
      stateA.status === 'ready' && stateB.status === 'ready'
        ? compareEstimates(stateA.estimate, stateB.estimate)
        : null,
    [stateA, stateB],
  );
  const context = docB && contextDifferences(docA, docB);
  const missing = comparison && comparison.unavailable.a + comparison.unavailable.b;

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
          <Side side="A" document={docA} state={stateA}>
            <p className={styles.hint}>Design em edição</p>
          </Side>
          <Side side="B" document={docB} state={stateB}>
            <FilePicker onLoad={setFile} name={file?.name} />
          </Side>
        </div>
        {context && (context.region || context.workload) && (
          <div className={styles.notices}>
            {context.region && <Notice tone="warning" message={REGION_NOTICE} />}
            {context.workload && <Notice tone="warning" message={WORKLOAD_NOTICE} />}
          </div>
        )}
        {docB === null && (
          <EmptyState
            title="Escolha o design B"
            description="Escolha um arquivo JSON baixado do editor para compará-lo com o design em edição."
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
