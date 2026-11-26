import { useRef, useState, type ChangeEvent } from 'react';
import { Button, Dialog, Notice } from '../../../shared/ui';
import type { DesignDocument } from '../../../shared/lib/design';
import { saveTextFile } from '../hooks/saveTextFile';
import { designStore, type DesignStoreState } from '../hooks/designStore';
import { useDesignStore } from '../hooks/useDesignStore';
import {
  DESIGN_FILE_MIME,
  DESIGN_FILE_NAME,
  designFileMessage,
  readDesignFile,
  serializeDesign,
  type DesignFileError,
} from '../model/designFile';
import { hasUnsavedChanges } from '../model/unsaved';
import styles from './DesignFileActions.module.css';

/** Só pergunta quando abrir o arquivo faria perder algo: o design de agora difere do último carregado. */
const hasUnsaved = (state: DesignStoreState) => hasUnsavedChanges(state.document, state.baseline);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Baixa o design atual em JSON. Um erro de serialização vira a categoria `too-large`. */
function useDownload() {
  const document = useDesignStore((s) => s.document);
  const [error, setError] = useState<DesignFileError | null>(null);
  const download = () => {
    const text = serializeDesign(document);
    if (text === null) return setError('too-large');
    saveTextFile(text, DESIGN_FILE_NAME, DESIGN_FILE_MIME);
    designStore.getState().markSaved();
  };
  return { download, error, clear: () => setError(null) };
}

/** "Baixar JSON" sozinho, para a folha de leitura da tela estreita. */
export function DownloadDesignButton({ variant }: { variant?: 'secondary' | 'tertiary' }) {
  const { download, error, clear } = useDownload();
  return (
    <>
      <Button variant={variant} onClick={download}>
        Baixar JSON
      </Button>
      <ErrorDialog title="Não foi possível baixar o design" error={error} onClose={clear} />
    </>
  );
}

function ErrorDialog(props: {
  title: string;
  error: DesignFileError | null;
  note?: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={props.error !== null} onClose={props.onClose} title={props.title}>
      {props.error !== null && <Notice tone="negative" message={designFileMessage(props.error)} />}
      {props.note !== undefined && <p className={styles.text}>{props.note}</p>}
      <div className={styles.actions}>
        <Button variant="primary" onClick={props.onClose}>
          Fechar
        </Button>
      </div>
    </Dialog>
  );
}

/** Abrir e baixar o design em arquivo (F7). O arquivo só toca a store depois de validado inteiro. */
export function DesignFileActions() {
  const current = useDesignStore((s) => s.document);
  const loadDesign = useDesignStore((s) => s.loadDesign);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const reading = useRef(false); // uma leitura por vez
  const [openError, setOpenError] = useState<DesignFileError | null>(null);
  const [pending, setPending] = useState<DesignDocument | null>(null);

  const replace = (next: DesignDocument) => {
    if (!loadDesign(next).ok) setOpenError('not-design');
  };

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = ''; // o mesmo arquivo pode ser escolhido de novo
    if (file === undefined) return;
    if (reading.current) return;
    reading.current = true;
    const result = await readDesignFile(file);
    reading.current = false;
    opener.current?.focus(); // o seletor nativo pode deixar o foco no body; o diálogo devolve o foco aqui
    if (!result.ok) return setOpenError(result.error);
    // O design pode ter mudado durante a leitura: decide com o estado de agora.
    if (hasUnsaved(designStore.getState())) setPending(result.document);
    else replace(result.document);
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        tabIndex={-1}
        aria-label="Arquivo JSON do design"
        onChange={(event) => void handleChange(event)}
      />
      <Button ref={opener} onClick={() => input.current?.click()}>
        Abrir arquivo
      </Button>
      <DownloadDesignButton />
      <ErrorDialog
        title="Não foi possível abrir o arquivo"
        error={openError}
        note="O design atual não foi alterado."
        onClose={() => setOpenError(null)}
      />
      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Substituir o design atual?"
      >
        {pending !== null && (
          <p className={styles.text}>
            O design atual ({plural(current.blocks.length, 'bloco', 'blocos')}) será trocado pelo do
            arquivo ({plural(pending.blocks.length, 'bloco', 'blocos')}). Baixe o design atual antes
            se quiser guardá-lo.
          </p>
        )}
        <div className={styles.actions}>
          <Button onClick={() => setPending(null)}>Cancelar</Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (pending !== null) replace(pending);
              setPending(null);
            }}
          >
            Substituir design
          </Button>
        </div>
      </Dialog>
    </>
  );
}
