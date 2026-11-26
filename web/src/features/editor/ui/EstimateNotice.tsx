import type { ReactElement } from 'react';
import { estimateNoticeText } from '../model/estimateNotice';
import type { CatalogStamp } from '../model/editorState';
import styles from './EditorPage.module.css';

export function EstimateNotice({ stamp }: { stamp: CatalogStamp }): ReactElement {
  return (
    <p role="note" className={styles.notice}>
      {estimateNoticeText(stamp)}
    </p>
  );
}
