/** O que a exclusão precisa do mundo; cada passo é uma porta, para a regra rodar sem React. */
export type DeleteAccountDeps = {
  /** `DELETE /me`. Rejeita com `ApiError`: nesse caso nada abaixo roda e a conta segue de pé. */
  remove(): Promise<void>;
  /** Sai da página da conta e volta ao editor (antes de a sessão cair, para o login não reabrir). */
  leave(): Promise<void> | void;
  /** Apaga o rascunho do design guardado na aba para o login (não pode voltar para outra conta). */
  discardDraft(): void;
  /** Esquece o que o editor sabia do design salvo na conta (o documento em edição fica). */
  forgetSavedDesign(): void;
  /** Descarta o cache de consultas: nada do usuário fica para o próximo. */
  clearCache(): void;
  /** Encerra a sessão local e depois a do provedor. Nunca rejeita. */
  signOut(): Promise<void>;
};

/**
 * Exclui a conta e encerra a sessão. Só depois do 204 a conta conta como excluída: um erro de
 * `remove` sobe sem tocar em sessão, cache nem editor. Depois do 204, nenhum passo pode impedir o
 * seguinte (o encerramento da sessão roda sempre), e nenhum erro vira "conta não excluída".
 */
export async function deleteAccount(deps: DeleteAccountDeps): Promise<void> {
  await deps.remove();
  const attempt = async (step: () => Promise<void> | void) => {
    try {
      await step();
    } catch {
      // A conta já foi excluída; um passo local que falha não a desfaz nem pode ser mostrado como erro.
    }
  };
  await attempt(deps.discardDraft);
  await attempt(deps.forgetSavedDesign);
  await attempt(deps.leave);
  await attempt(deps.clearCache);
  await attempt(deps.signOut);
}
