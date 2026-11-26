/** "Restam N de M estimativas": singular e plural certos, como a API devolve. */
export function quotaSummary(remaining: number, limit: number): string {
  const noun = limit === 1 ? 'estimativa' : 'estimativas';
  const verb = remaining === 1 ? 'Resta' : 'Restam';
  return `${verb} ${remaining} de ${limit} ${noun} por dia`;
}

/** Quando a quota renova, em pt-BR, no horário do navegador. `—` se o ISO não é uma data. */
export function formatResetsAt(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(date);
}
