import type { ReactElement } from 'react';
import { estimateNoticeText, type CatalogStamp } from '../model/estimateNotice';
import styles from './EditorPage.module.css';

export function EstimateNotice({ stamp }: { stamp: CatalogStamp }): ReactElement {
  return (
    <p role="note" className={styles.notice}>
      {estimateNoticeText(stamp)}
    </p>
  );
}
