import type { ReactElement } from 'react';
import { Link } from 'react-router';
import styles from './ComparePage.module.css';

/** Atalho para `/comparar` na barra do editor, ao lado de "Meus designs". Também para o anônimo. */
export function CompareLink(): ReactElement {
  return (
    <Link to="/comparar" className={styles.link}>
      Comparar
    </Link>
  );
}
