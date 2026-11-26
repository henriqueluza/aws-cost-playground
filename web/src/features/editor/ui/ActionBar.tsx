import type { ReactNode } from 'react';
import { DesignFileActions } from './DesignFileActions';
import { HistoryButtons } from './HistoryButtons';
import styles from './EditorPage.module.css';

/** `children`: ações de outras features (ex.: salvar), montadas pelo app, depois das de arquivo. */
export function ActionBar({ children }: { children?: ReactNode }) {
  return (
    <>
      <h2 className={styles.hidden}>Ações</h2>
      <div className={styles.actions}>
        <HistoryButtons />
        <DesignFileActions />
        {children}
      </div>
    </>
  );
}
