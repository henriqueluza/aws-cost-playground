import { EXPORT_PATHS, type ExportFile } from '../application/exportDesign';

const MIME = 'text/plain;charset=utf-8';

/**
 * Baixa um arquivo gerado pelo export (adaptador de navegador).
 * O nome vem só da lista fixa `EXPORT_PATHS`; o conteúdo vira `Blob` e nunca entra em URL,
 * atributo ou HTML. Devolve `false`, sem baixar, se o caminho não estiver na lista.
 */
export function downloadFile(file: ExportFile): boolean {
  const name = EXPORT_PATHS.find((path) => path === file.path);
  if (name === undefined) return false;
  const url = URL.createObjectURL(new Blob([file.content], { type: MIME }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
  return true;
}
