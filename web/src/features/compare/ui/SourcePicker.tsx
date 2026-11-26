import { useRef, useState, type ChangeEvent } from 'react';
import { designErrorMessage, isRetryable, useSavedDesigns } from '../../designs';
import { designFileMessage, readDesignFile, type DesignFileError } from '../../editor';
import type { DesignDocument } from '../../../shared/lib/design';
import { Button, Notice, SelectField } from '../../../shared/ui';
import type { Source } from '../hooks/useSideDocument';
import styles from './ComparePage.module.css';

type Side = 'A' | 'B';

/** O arquivo passa pela MESMA leitura e validação de "Abrir arquivo" do editor. */
function FilePicker(props: {
  side: Side;
  name: string | undefined;
  onLoad: (file: { name: string; document: DesignDocument }) => void;
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
          aria-label={`Arquivo JSON do design ${props.side}`}
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

/** Lista da conta (só montada com sessão e com a origem "salvo"). Nomes entram só como texto. */
function SavedPicker(props: {
  side: Side;
  id: string | null;
  onPick: (id: string | null) => void;
}) {
  const list = useSavedDesigns();
  if (list.status === 'loading') {
    return (
      <p role="status" className={styles.hint}>
        Carregando seus designs…
      </p>
    );
  }
  if (list.status === 'error') {
    return (
      <>
        <Notice tone="negative" message={designErrorMessage(list.kind)} />
        {isRetryable(list.kind) && <Button onClick={list.retry}>Tentar de novo</Button>}
      </>
    );
  }
  if (list.data.length === 0) {
    return <p className={styles.hint}>Você ainda não salvou nenhum design. Salve um no editor.</p>;
  }
  return (
    <SelectField
      label={`Design salvo ${props.side}`}
      value={props.id ?? ''}
      onChange={(event) => props.onPick(event.currentTarget.value || null)}
    >
      <option value="">Escolha um design…</option>
      {list.data.map((design) => (
        <option key={design.id} value={design.id}>
          {design.name} ({design.region})
        </option>
      ))}
    </SelectField>
  );
}

/**
 * Escolhe a origem de um lado. "Salvo na conta" só existe com sessão: sem ela o anônimo nem vê a
 * opção, e nada é pedido à API.
 */
export function SourcePicker(props: {
  side: Side;
  source: Source;
  signedIn: boolean;
  onChange: (source: Source) => void;
}) {
  const { side, source, onChange } = props;
  return (
    <>
      <SelectField
        label={`Origem do design ${side}`}
        value={source.kind}
        onChange={(event) => {
          const kind = event.currentTarget.value;
          if (kind === 'editor') onChange({ kind });
          else if (kind === 'file') onChange({ kind, file: null });
          else if (kind === 'saved') onChange({ kind, id: null });
        }}
      >
        <option value="editor">Design em edição</option>
        <option value="file">Arquivo JSON</option>
        {props.signedIn && <option value="saved">Salvo na conta</option>}
      </SelectField>
      {source.kind === 'file' && (
        <FilePicker
          side={side}
          name={source.file?.name}
          onLoad={(file) => onChange({ kind: 'file', file })}
        />
      )}
      {source.kind === 'saved' && (
        <SavedPicker side={side} id={source.id} onPick={(id) => onChange({ kind: 'saved', id })} />
      )}
    </>
  );
}
