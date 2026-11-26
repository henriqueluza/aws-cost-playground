import { useState } from 'react';
import { Button, Notice, Panel } from '../../../shared/ui';
import { useDesignStore } from '../../editor';
import { exportDesign } from '../application/exportDesign';
import { downloadFile } from '../api/downloadFile';

const DISCLAIMER =
  'O arquivo é um ponto de partida, sem garantia. Revise cada recurso antes de aplicá-lo na sua conta. ' +
  'Os custos mostrados no produto são estimativa, não cotação oficial da AWS.';
const FAILURE = 'Não foi possível exportar este design. Corrija-o e tente de novo.';

/** Painel de exportação: baixa o `main.tf` do design atual, com o aviso permanente do PRD F16. */
export function ExportPanel() {
  const document = useDesignStore((state) => state.document);
  const [failed, setFailed] = useState(false);

  const onExport = () => {
    const result = exportDesign(document);
    const file = result.ok ? result.files[0] : undefined;
    setFailed(file === undefined || !downloadFile(file));
  };

  return (
    <Panel title="Exportar">
      <Notice tone="neutral" message={DISCLAIMER} />
      <Button onClick={onExport}>
        Exportar Terraform
      </Button>
      {failed && <Notice tone="negative" message={FAILURE} />}
    </Panel>
  );
}
