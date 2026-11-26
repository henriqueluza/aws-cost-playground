import type { ReactElement } from 'react';
import type { EdgeKind } from '../../../shared/lib/design';
import { EDGE_STYLE } from '../model/edgeKinds';
import styles from './CanvasPanel.module.css';
import { Icon } from './CategoryIcon';
import { EDGE_ICON, STROKE_CLASS } from './TypedEdge';

const KINDS: readonly EdgeKind[] = ['data', 'runs-on', 'logs'];

/**
 * Legenda dos tipos de conexão: amostra do traço, ícone e nome numa linha só (a diferença não é só
 * de cor), para ocupar uma faixa baixa do canvas. O significado de cada tipo fica no `title` e,
 * para leitor de tela, em texto escondido.
 */
export function EdgeLegend(): ReactElement {
  return (
    <div className={styles.legend} role="group" aria-label="Legenda das conexões">
      <ul className={styles.legendList}>
        {KINDS.map((kind) => (
          <li
            key={kind}
            className={styles.legendItem}
            title={`${EDGE_STYLE[kind].label}, ${EDGE_STYLE[kind].stroke}: ${EDGE_STYLE[kind].meaning}`}
          >
            <svg className={styles.legendSample} viewBox="0 0 32 8" aria-hidden="true">
              <path d="M1 4h30" className={STROKE_CLASS[kind]} />
            </svg>
            <Icon name={EDGE_ICON[kind]} />
            <strong>{EDGE_STYLE[kind].label}</strong>
            <span className={styles.hidden}>
              {`, ${EDGE_STYLE[kind].stroke}: ${EDGE_STYLE[kind].meaning}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
