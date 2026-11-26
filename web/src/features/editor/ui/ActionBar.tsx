import { DesignFileActions } from './DesignFileActions';
import styles from './EditorPage.module.css';

export function ActionBar() {
  return (
    <>
      <h2 className={styles.hidden}>Ações</h2>
      <div className={styles.actions}>
        <DesignFileActions />
      </div>
    </>
  );
}
