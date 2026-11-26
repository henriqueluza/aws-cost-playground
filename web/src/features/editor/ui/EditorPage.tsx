import { Link } from 'react-router';
import { PricingPanel } from '../../pricing';
import { WorkloadPanel } from '../../workload';
import { useMediaQuery } from '../hooks/useMediaQuery';
import type { CatalogStamp } from '../model/estimateNotice';
import { ActionBar } from './ActionBar';
import { CanvasPanel } from './CanvasPanel';
import styles from './EditorPage.module.css';
import { EstimateNotice } from './EstimateNotice';
import { InspectorPanel } from './InspectorPanel';
import { PalettePanel } from './PalettePanel';
import { RailTabs } from './RailTabs';

// Fica em `unavailable` até a store do design (parte 1 de #12) entrar; quem ligar a store
// passa o estado de `usePriceCatalog` (pricing), mapeando idle/error para unavailable.
const CATALOG_STAMP: CatalogStamp = { status: 'unavailable' };

const RAIL_TABS = [
  { id: 'cost', label: 'Custo', panel: <PricingPanel /> },
  { id: 'block', label: 'Bloco', panel: <InspectorPanel /> },
  { id: 'load', label: 'Carga', panel: <WorkloadPanel /> },
] as const;

export function EditorPage() {
  const wide = useMediaQuery('(min-width: 1024px)', true);

  if (!wide) {
    return (
      <main className={styles.narrow}>
        <h1>Editor</h1>
        <p>A edição precisa de uma tela com pelo menos 1024 px de largura.</p>
        <Link to="/designs">Meus designs</Link>
        <EstimateNotice stamp={CATALOG_STAMP} />
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
      <aside aria-label="Painéis" className={styles.rail}>
        <RailTabs label="Painéis do design" tabs={RAIL_TABS} />
        <EstimateNotice stamp={CATALOG_STAMP} />
      </aside>
    </div>
  );
}
