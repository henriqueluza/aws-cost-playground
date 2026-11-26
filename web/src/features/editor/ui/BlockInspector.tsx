import { useState } from 'react';
import { SelectField, TextField } from '../../../shared/ui';
import type { Block } from '../../../shared/lib/design';
import type { BlockDefinition } from '../../pricing';
import { useDesignStore } from '../hooks/useDesignStore';
import {
  buildBlockForm,
  validateLabel,
  withAttribute,
  type AttributeField,
} from '../model/blockForm';
import { attributeLabel, optionLabel } from './blockLabels';
import { labelErrorMessage } from './inspectorMessages';
import styles from './InspectorPanel.module.css';
import { UsageItem } from './UsageItem';

type Props = { block: Block; definition: BlockDefinition };

/** Rótulo do bloco: dado do usuário, sempre texto. Inválido fica no rascunho, fora da store. */
function LabelField({ block }: { block: Block }) {
  const editBlock = useDesignStore((s) => s.editBlock);
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? block.label;
  const problem = validateLabel(text);
  return (
    <TextField
      label="Nome do bloco"
      value={text}
      autoComplete="off"
      error={problem ? labelErrorMessage(problem) : undefined}
      onChange={(e) => {
        setDraft(e.target.value);
        if (validateLabel(e.target.value) === null) editBlock(block.id, { label: e.target.value });
      }}
      onBlur={() => setDraft(null)} // a store é a verdade: o texto inválido não fica no campo
    />
  );
}

function AttributeSelect({ block, field }: { block: Block; field: AttributeField }) {
  const editBlock = useDesignStore((s) => s.editBlock);
  const label = attributeLabel(field.key) ?? field.key;
  const current = field.value !== undefined && field.known ? String(field.value) : '';
  return (
    <SelectField
      label={label}
      value={current}
      error={field.known ? undefined : 'Valor fora do contrato. Escolha uma das opções.'}
      onChange={(e) => {
        const next = withAttribute(block.attributes, field, e.target.value);
        if (next) editBlock(block.id, { attributes: next });
      }}
    >
      {field.optional || current === '' ? (
        <option value="">{field.optional ? 'Não definida' : 'Escolha uma opção'}</option>
      ) : null}
      {field.options.map((option) => (
        <option key={String(option)} value={String(option)}>
          {optionLabel(field.key, option) ?? String(option)}
        </option>
      ))}
    </SelectField>
  );
}

/** Formulário do bloco selecionado, gerado do contrato por `buildBlockForm`. */
export function BlockInspector({ block, definition }: Props) {
  const setOverride = useDesignStore((s) => s.setOverride);
  const target = { kind: 'block', id: block.id } as const;
  const form = buildBlockForm(definition, block);
  return (
    <div className={styles.inspector}>
      <h2 className={styles.title}>{definition.name}</h2>
      <section className={styles.group} aria-label="Identificação">
        <LabelField block={block} />
      </section>
      {form.attributes.length > 0 ? (
        <section className={styles.group} aria-labelledby={`${block.id}-sku`}>
          <h3 id={`${block.id}-sku`} className={styles.section}>
            Configuração
          </h3>
          {form.attributes.map((field) => (
            <AttributeSelect key={field.key} block={block} field={field} />
          ))}
        </section>
      ) : null}
      {form.usage.length > 0 ? (
        <section className={styles.group} aria-labelledby={`${block.id}-uso`}>
          <h3 id={`${block.id}-uso`} className={styles.section}>
            Uso mensal
          </h3>
          {form.usage.map((field) => (
            <UsageItem
              key={field.key}
              field={field}
              estimated={block.usage.source === 'llm'}
              onChange={(key, value) => setOverride(target, key, value)}
              onReset={(key) => setOverride(target, key, null)}
            />
          ))}
        </section>
      ) : (
        <p className={styles.note}>Este bloco não tem custo próprio nem valores de uso.</p>
      )}
    </div>
  );
}
