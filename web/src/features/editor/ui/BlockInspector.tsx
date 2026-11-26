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
import { UsageRow } from './UsageRow';

type Props = { block: Block; definition: BlockDefinition };

/** Rótulo do bloco: dado do usuário, sempre texto. Inválido fica no rascunho, fora da store. */
function LabelField({ block }: { block: Block }) {
  const editBlock = useDesignStore((s) => s.editBlock);
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? block.label;
  const problem = validateLabel(text);
  // Um passo de histórico por confirmação (Enter ou sair do campo), não por tecla.
  const commit = () => {
    if (draft !== null && draft !== block.label && validateLabel(draft) === null) {
      editBlock(block.id, { label: draft });
    }
    setDraft(null); // a store é a verdade: o texto inválido não fica no campo
  };
  return (
    <TextField
      label="Nome do bloco"
      value={text}
      autoComplete="off"
      error={problem ? labelErrorMessage(problem) : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      onBlur={commit}
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
          <dl className={styles.list}>
            {form.usage.map((field) => (
              <UsageRow key={field.key} field={field} />
            ))}
          </dl>
        </section>
      ) : (
        <p className={styles.note}>Este bloco não tem custo próprio nem valores de uso.</p>
      )}
    </div>
  );
}
