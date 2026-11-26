/** Documento legal como dado: o texto mora no repositório e a UI o renderiza como texto, nunca como HTML. */

export type LegalBlock =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  /** Lista de definições: um termo em destaque seguido da sua explicação. */
  | { kind: 'dl'; items: { term: string; text: string }[] };

export type LegalSection = {
  /** Âncora estável (`#id`); só minúsculas, números e hífen. */
  id: string;
  heading: string;
  blocks: LegalBlock[];
};

export type LegalDocument = {
  title: string;
  /** Frase de apoio sob o título. */
  lead: string;
  sections: LegalSection[];
};

/**
 * Dados que só o autor pode informar. Cada marcador aparece no texto entre colchetes e a UI o
 * destaca. A lista abaixo é a fonte para o PR, o handoff e a Issue #79: nada aqui é inventado.
 */
export const MARKERS = {
  controller: '[NOME DO RESPONSÁVEL]',
  contact: '[E-MAIL DE CONTATO]',
  dpo: '[ENCARREGADO (DPO)]',
  effective: '[DATA DE VIGÊNCIA]',
  forum: '[FORO]',
  pitr: '[CONFERIR: PERÍODO DE RECUPERAÇÃO DO BANCO]',
  anthropicRetention: '[CONFERIR: RETENÇÃO NA ANTHROPIC]',
  anthropicLocation: '[CONFERIR: LOCAL DE PROCESSAMENTO DA ANTHROPIC]',
} as const;

/** Separa o texto em trechos comuns e marcadores `[...]`, para a UI destacar os marcadores. */
export function splitMarkers(text: string): { text: string; marker: boolean }[] {
  return text
    .split(/(\[[^\]]+\])/)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, marker: /^\[[^\]]+\]$/.test(part) }));
}
