import { useRef, useState } from 'react';
import { Button, NumberField } from '../../../shared/ui';
import { formatUsageInput, parseUsageInput, type UsageField } from '../model/blockForm';
import { unitLabel, usageLabel } from './blockLabels';
import { ORIGIN_TEXT, usageErrorMessage } from './inspectorMessages';
import styles from './InspectorPanel.module.css';

type Props = {
  field: UsageField;
  /** O valor padrão do bloco veio da LLM: o botão diz "estimado"; senão, "padrão". */
  estimated: boolean;
  onChange: (key: string, value: number) => void;
  onReset: (key: string) => void;
};

/**
 * Um valor de uso: campo numérico com a unidade, a origem em texto e, se houver override, o
 * botão de voltar. O texto vira rascunho e só é gravado ao sair do campo ou com Enter (digitar
 * "1e9" passaria por "1" no caminho); valor inválido fica no rascunho e nunca chega à store.
 */
export function UsageItem({ field, estimated, onChange, onReset }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const parsed = draft === null ? null : parseUsageInput(draft, field);
  const error = parsed && !parsed.ok ? usageErrorMessage(parsed.error, field) : undefined;
  const label = usageLabel(field.key) ?? field.key;
  const restore = estimated ? 'Voltar ao estimado' : 'Voltar ao padrão';

  /** Grava o rascunho só se ele é válido; o inválido fica no campo, com o erro, e a store não muda. */
  const commit = () => {
    if (draft === null || !parsed?.ok) return;
    onChange(field.key, parsed.value);
    setDraft(null);
  };

  return (
    <div className={styles.item} data-origin={field.origin}>
      <NumberField
        ref={input}
        label={label}
        unit={unitLabel(field.unit) ?? field.unit}
        value={draft ?? formatUsageInput(field.value)}
        error={error}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      <div className={styles.meta}>
        <span className={styles.origin}>
          <span className={styles.mark} aria-hidden="true" />
          <span className={styles.srOnly}>Origem do valor de {label}: </span>
          {ORIGIN_TEXT[field.origin]}
        </span>
        {field.origin === 'manual' ? (
          <Button
            variant="tertiary"
            aria-label={`${restore}: ${label}`}
            onClick={() => {
              setDraft(null);
              onReset(field.key);
              input.current?.focus();
            }}
          >
            {restore}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
