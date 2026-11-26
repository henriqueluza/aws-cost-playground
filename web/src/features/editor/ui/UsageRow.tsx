import type { UsageField } from '../model/blockForm';
import { formatRangeNumber, unitLabel, usageLabel } from './blockLabels';
import { ORIGIN_TEXT } from './inspectorMessages';
import styles from './InspectorPanel.module.css';

/** Um valor de uso, com a unidade e a origem em texto (a marca é só reforço, não a única pista). */
export function UsageRow({ field }: { field: UsageField }) {
  const label = usageLabel(field.key) ?? field.key;
  return (
    <div className={styles.item} data-origin={field.origin}>
      <dt className={styles.term}>{label}</dt>
      <dd className={styles.value}>
        {formatRangeNumber(field.value)}{' '}
        <span className={styles.unit}>{unitLabel(field.unit) ?? field.unit}</span>
      </dd>
      <dd className={styles.meta}>
        <span className={styles.origin}>
          <span className={styles.mark} aria-hidden="true" />
          <span className={styles.srOnly}>Origem do valor de {label}: </span>
          {ORIGIN_TEXT[field.origin]}
        </span>
      </dd>
    </div>
  );
}
