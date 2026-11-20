export function ConfigErrorScreen() {
  return (
    <main>
      <div role="alert">
        <h1>Não foi possível carregar a configuração</h1>
        <p>Verifique sua conexão e tente novamente em instantes.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Tentar novamente
        </button>
      </div>
    </main>
  );
}
