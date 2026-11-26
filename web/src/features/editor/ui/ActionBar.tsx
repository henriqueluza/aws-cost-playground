import { DesignFileActions } from './DesignFileActions';
import { HistoryButtons } from './HistoryButtons';
import styles from './EditorPage.module.css';

export function ActionBar() {
  return (
    <>
      <h2 className={styles.hidden}>Ações</h2>
      <div className={styles.actions}>
        <HistoryButtons />
        <DesignFileActions />
      </div>
    </>
  );
}
