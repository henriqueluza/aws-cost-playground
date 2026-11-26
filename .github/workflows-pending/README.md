# Workflows pendentes

O GitHub só executa o que está em `.github/workflows/`. Os arquivos desta pasta são
workflows completos e revisados que um agente não pôde gravar lá: a sessão que os escreveu
tinha a escrita em `.github/workflows/` negada.

Para ativar (autor, ou uma sessão com essa permissão), na branch do PR e antes do merge:

```bash
git mv .github/workflows-pending/deploy-staging.yml .github/workflows/deploy-staging.yml
git rm .github/workflows-pending/README.md
git commit -m "ci: ativar deploy-staging.yml (#22)"
```

Os testes em `infra/tools/tests/test_workflow_deploy_staging.py` leem o workflow nos dois
caminhos e exigem que ele esteja em exatamente um deles. Por isso continuam valendo depois
do `git mv`, sem nenhuma edição.
