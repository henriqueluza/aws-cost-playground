/**
 * Entrega `text` como download. `Blob` e URL de objeto, nunca `data:` (o build recusa a URI), e a
 * URL é revogada logo depois do clique. O nome é sempre um dos nossos, não vem do arquivo aberto.
 */
export function saveTextFile(text: string, fileName: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // O download já foi iniciado pelo clique; adiar deixa o navegador ler o Blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
