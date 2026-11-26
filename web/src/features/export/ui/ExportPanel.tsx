import { useState } from 'react';
import { Button, Notice, Panel } from '../../../shared/ui';
import { useDesignStore } from '../../editor';
import { downloadFile } from '../api/downloadFile';
import { exportDesign } from '../application/exportDesign';
import styles from './ExportPanel.module.css';

const DISCLAIMER =
  'O arquivo é um ponto de partida, sem garantia. Revise cada recurso antes de aplicá-lo na sua conta. ' +
  'Os custos mostrados no produto são estimativa, não cotação oficial da AWS.';
const FAILURES = {
  design: 'Este design tem erros e não pôde ser exportado. Corrija os blocos e tente de novo.',
  download: 'O navegador não baixou o arquivo. Tente de novo.',
} as const;

/** Baixa o arquivo; qualquer falha do navegador vira `false`, sem exceção na tela. */
function tryDownload(file: Parameters<typeof downloadFile>[0]): boolean {
  try {
    return downloadFile(file);
  } catch {
    return false;
  }
}

/** Painel de exportação: baixa o `main.tf` do design atual, com o aviso permanente do PRD F16. */
export function ExportPanel() {
  const document = useDesignStore((state) => state.document);
  const [failure, setFailure] = useState<keyof typeof FAILURES>();

  const onExport = () => {
    const result = exportDesign(document);
    const file = result.ok ? result.files[0] : undefined;
    if (file === undefined) setFailure('design');
    else setFailure(tryDownload(file) ? undefined : 'download');
  };

  return (
    <Panel title="Exportar">
      <div className={styles.body}>
        <Notice tone="neutral" message={DISCLAIMER} />
        <Button onClick={onExport}>Exportar Terraform</Button>
        {failure && <Notice tone="negative" message={FAILURES[failure]} />}
      </div>
    </Panel>
  );
}
