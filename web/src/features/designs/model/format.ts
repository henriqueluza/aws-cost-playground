/** Data e hora em pt-BR a partir do ISO do servidor. Só exibição: a ordem é a da API. */
export function formatUpdatedAt(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone,
  }).format(date);
}

export function blockCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'bloco' : 'blocos'}`;
}
