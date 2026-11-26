import type { AttributeDefinition, BlockDefinition, UsageKeyDefinition } from '../../pricing';
import { DESIGN_LIMITS, type Block } from '../../../shared/lib/design';

/** Valor de um atributo do SKU: o tipo das opções do contrato. */
export type AttributeValue = string | number;

/** De onde vem o valor de uso mostrado: LLM, padrão (do design ou do contrato) ou override. */
export type UsageOrigin = 'llm' | 'default' | 'manual';

export type AttributeField = {
  readonly key: string;
  readonly options: readonly AttributeValue[];
  /** Valor atual; `undefined` quando o atributo é opcional e não foi escolhido. */
  readonly value: AttributeValue | undefined;
  /** Sem `default` no contrato: o usuário pode deixar sem valor. */
  readonly optional: boolean;
  /** `false` quando o documento traz um valor que não está entre as opções do contrato. */
  readonly known: boolean;
};

export type UsageField = {
  readonly key: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly integer: boolean;
  /** Uso efetivo: override, depois valor do design, depois padrão do contrato. */
  readonly value: number;
  readonly origin: UsageOrigin;
};

export type BlockForm = {
  readonly attributes: readonly AttributeField[];
  readonly usage: readonly UsageField[];
};

function attributeField(def: AttributeDefinition, block: Block): AttributeField {
  const current = Object.hasOwn(block.attributes, def.key)
    ? block.attributes[def.key]
    : def.default;
  const value = typeof current === 'string' || typeof current === 'number' ? current : undefined;
  return {
    key: def.key,
    options: def.options,
    value,
    optional: def.default === undefined,
    known: value === undefined || def.options.includes(value),
  };
}

function usageField(def: UsageKeyDefinition, block: Block): UsageField {
  const base = { key: def.key, unit: def.unit, min: def.min, max: def.max, integer: def.integer };
  if (Object.hasOwn(block.overrides, def.key)) {
    return { ...base, value: block.overrides[def.key] ?? def.default, origin: 'manual' };
  }
  const stored = Object.hasOwn(block.usage.values, def.key)
    ? block.usage.values[def.key]
    : undefined;
  if (stored === undefined) return { ...base, value: def.default, origin: 'default' };
  return { ...base, value: stored, origin: block.usage.source };
}

/**
 * Formulário do bloco, derivado só do contrato (`blocks.json`) e do bloco: um campo por atributo
 * e um por chave de uso, na ordem do contrato. Nenhum campo é escrito à mão por tipo de bloco.
 */
export function buildBlockForm(def: BlockDefinition, block: Block): BlockForm {
  return {
    attributes: def.attributes.map((attribute) => attributeField(attribute, block)),
    usage: def.usage.map((key) => usageField(key, block)),
  };
}

/**
 * Novo `attributes` do bloco com a opção escolhida (`raw` é o `value` do `<select>`). Vazio
 * remove o atributo, só se for opcional. Valor que não é opção do contrato devolve `null`.
 */
export function withAttribute(
  attributes: Block['attributes'],
  field: AttributeField,
  raw: string,
): Block['attributes'] | null {
  const rest = Object.fromEntries(Object.entries(attributes).filter(([key]) => key !== field.key));
  if (raw === '') return field.optional ? rest : null;
  const option = field.options.find((candidate) => String(candidate) === raw);
  return option === undefined ? null : { ...rest, [field.key]: option };
}

export type LabelError = 'control' | 'too-long';

// C0, DEL, C1, separadores de linha e parágrafo e os controles de direção do Unicode (bidi).
const CONTROL_CHARS = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

/** Rótulo do bloco (o limite conta unidades UTF-16, como o schema do design): até `DESIGN_LIMITS.maxLabelLength` caracteres, sem controle. */
export function validateLabel(text: string): LabelError | null {
  if (CONTROL_CHARS.test(text)) return 'control';
  return text.length > DESIGN_LIMITS.maxLabelLength ? 'too-long' : null;
}
