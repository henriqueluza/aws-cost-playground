import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ExportPanel } from '../../export';
import { PricingPanel, usePriceCatalog } from '../../pricing';
import { useHistoryShortcuts } from '../hooks/historyShortcuts';
import { useRestoreDesignDraft } from '../hooks/designDraftSync';
import { useDesignStore } from '../hooks/useDesignStore';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { catalogStamp } from '../model/estimateNotice';
import { ActionBar } from './ActionBar';
import { CanvasPanel } from './CanvasPanel';
import styles from './EditorPage.module.css';
import { DownloadDesignButton } from './DesignFileActions';
import { EstimateNotice } from './EstimateNotice';
import { InspectorPanel } from './InspectorPanel';
import { LiveAnnouncer } from './LiveAnnouncer';
import { PalettePanel } from './PalettePanel';
import { RailTabs } from './RailTabs';

/** Atalhos de histórico só existem com o canvas na tela. */
function HistoryShortcuts(): null {
  useHistoryShortcuts();
  return null;
}

/** `actions` e `workload`: peças de outras features (barra superior e aba Carga) que o app injeta. */
export function EditorPage({
  actions,
  workload,
}: { actions?: ReactNode; workload?: ReactNode } = {}) {
  useRestoreDesignDraft();
  const wide = useMediaQuery('(min-width: 1024px)', true);
  const design = useDesignStore((s) => s.document);
  const selection = useDesignStore((s) => s.selection);
  const select = useDesignStore((s) => s.select);
  const catalog = usePriceCatalog(design);
  const stamp = catalogStamp(catalog);
  const railTabs = [
    {
      id: 'cost',
      label: 'Custo',
      panel: (
        <PricingPanel
          design={design}
          catalog={catalog}
          selection={selection}
          onSelect={(next) => void select(next)}
        />
      ),
    },
    { id: 'block', label: 'Bloco', panel: <InspectorPanel /> },
    { id: 'load', label: 'Carga', panel: workload ?? <p>Carga indisponível.</p> },
    { id: 'export', label: 'Exportar', panel: <ExportPanel /> },
  ];

  if (!wide) {
    return (
      <main className={styles.narrow}>
        <h1>Editor</h1>
        <p>A edição precisa de uma tela com pelo menos 1024 px de largura.</p>
        <Link to="/designs">Meus designs</Link>
        <DownloadDesignButton variant="tertiary" />
        <EstimateNotice stamp={stamp} />
      </main>
    );
  }

  return (
    <div className={styles.shell}>
      <HistoryShortcuts />
      <LiveAnnouncer />
      <header className={styles.topbar}>
        <ActionBar>{actions}</ActionBar>
      </header>
      <aside aria-label="Paleta" className={styles.palette}>
        <PalettePanel />
      </aside>
      <main className={styles.sheet}>
        <h1 className={styles.hidden}>Editor</h1>
        <CanvasPanel />
      </main>
      <aside aria-label="Painéis do design" className={styles.rail}>
        <RailTabs label="Custo, bloco, carga e exportação" tabs={railTabs} />
        <EstimateNotice stamp={stamp} />
      </aside>
    </div>
  );
}
