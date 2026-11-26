import { Link } from 'react-router';
import { PricingPanel, usePriceCatalog } from '../../pricing';
import { WorkloadPanel } from '../../workload';
import { useDesignStore } from '../hooks/useDesignStore';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { catalogStamp } from '../model/estimateNotice';
import { ActionBar } from './ActionBar';
import { CanvasPanel } from './CanvasPanel';
import styles from './EditorPage.module.css';
import { EstimateNotice } from './EstimateNotice';
import { InspectorPanel } from './InspectorPanel';
import { PalettePanel } from './PalettePanel';
import { RailTabs } from './RailTabs';

const RAIL_TABS = [
  { id: 'cost', label: 'Custo', panel: <PricingPanel /> },
  { id: 'block', label: 'Bloco', panel: <InspectorPanel /> },
  { id: 'load', label: 'Carga', panel: <WorkloadPanel /> },
] as const;

export function EditorPage() {
  const wide = useMediaQuery('(min-width: 1024px)', true);
  const stamp = catalogStamp(usePriceCatalog(useDesignStore((s) => s.document)));

  if (!wide) {
    return (
      <main className={styles.narrow}>
        <h1>Editor</h1>
        <p>A edição precisa de uma tela com pelo menos 1024 px de largura.</p>
        <Link to="/designs">Meus designs</Link>
        <EstimateNotice stamp={stamp} />
      </main>
    );
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <ActionBar />
      </header>
      <aside aria-label="Paleta" className={styles.palette}>
        <PalettePanel />
      </aside>
      <main className={styles.sheet}>
        <h1 className={styles.hidden}>Editor</h1>
        <CanvasPanel />
      </main>
      <aside aria-label="Painéis do design" className={styles.rail}>
        <RailTabs label="Custo, bloco e carga" tabs={RAIL_TABS} />
        <EstimateNotice stamp={stamp} />
      </aside>
    </div>
  );
}
