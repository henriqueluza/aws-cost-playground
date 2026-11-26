import type { ReactElement } from 'react';
import type { BlockCategoryId } from '../application/blockCategory';

// Lucide (cpu, database, network, shield, activity) na grade de 24, traço de 1,5px, em 16px.
const PATHS: Record<BlockCategoryId, string> = {
  compute:
    'M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 9h6v6H9zM15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2',
  data: 'M3 5a9 3 0 1 0 18 0A9 3 0 1 0 3 5zM3 5v14a9 3 0 0 0 18 0V5M3 12a9 3 0 0 0 18 0',
  network:
    'M17 16h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zM3 16h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zM10 2h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8',
  security:
    'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
  ops: 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2',
};

/** Ícone da categoria do bloco: decorativo, o nome do bloco já está ao lado. */
export function CategoryIcon(props: {
  category: BlockCategoryId;
  className?: string;
}): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={props.className}>
      <path d={PATHS[props.category]} />
    </svg>
  );
}
