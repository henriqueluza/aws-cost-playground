# Módulo `auth`

O User Pool do Cognito, o cliente público do site e o login gerenciado em domínio próprio, descritos no `docs/architecture/aws-cost-playground/ADR-0001-stack.md`.

| Característica | Valor |
|---|---|
| Tier | Essentials. Nenhum recurso do tier Plus (sem proteção contra ameaças, sem checagem de senha vazada, sem log de atividade) |
| Login | Por e-mail, sem distinção de maiúsculas. E-mail verificado automaticamente (o cadastro só conclui com o código enviado) e verificação exigida antes de trocar de e-mail |
| Cadastro | Aberto só com `self_signup_enabled = true`; no padrão (`false`) só o administrador cria contas |
| Senha | Mínimo de 15 caracteres, sem regra de composição (ASVS 5.0 6.2.1 e 6.2.5). Senha temporária válida por 3 dias |
| Recuperação de conta | Só por e-mail verificado |
| MFA, SMS, gatilhos Lambda | Desligados / não usados. Primeiro fator só senha (sem passwordless) |
| E-mails | Remetente padrão do Cognito (SES fora de escopo) |
| Cliente (`<prefixo>-web`) | Público, sem segredo. Só o fluxo Authorization Code (implícito desligado). `explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH"]` |
| Escopos e provedor | Exatamente `openid email`; provedor só `COGNITO` |
| Atributos do cliente | Lê `email` e `email_verified`; grava só `email` |
| Tokens | Access e id token de 15 minutos; refresh de 1 dia, com revogação ligada e sem rotação |
| Enumeração de usuários | `prevent_user_existence_errors = "ENABLED"` |
| Login gerenciado | `managed_login_version = 2`, estilo padrão do Cognito (`aws_cognito_managed_login_branding`; sem ele o login não atende um cliente criado por API), no domínio `domain_name` |
| Proteção contra exclusão | `deletion_protection = "ACTIVE"` mais `lifecycle { prevent_destroy = true }` no pool |

As tags vêm do `default_tags` do provider de cada ambiente.

## Uso

```hcl
module "auth" {
  source = "../../modules/auth"

  name_prefix         = "acp-stg"
  domain_name         = module.dns.auth_domain
  acm_certificate_arn = module.dns.certificate_arns["auth"]
  callback_urls       = ["https://${module.dns.domain_names["site"]}/auth/callback"]
  logout_urls         = ["https://${module.dns.domain_names["site"]}/"]
  self_signup_enabled = false # os dois ambientes, desde a #383
}
```

O exemplo descreve a composição da #21 e depende da #121: hoje o módulo `dns` só expõe `zone_id`, `domain_names` e `certificate_arns`. A saída `auth_domain` (que espera o registro A do site) e as variáveis `site_alias`, `api_alias` e `auth_alias` chegam com a #121. Até lá, `module.dns.domain_names["auth"]` dá o mesmo nome, mas não garante a ordem: o Cognito exige o registro A do domínio pai antes de criar o domínio.

O caminho de volta é no módulo `dns` (variável `auth_alias`, da #121), que cria o registro do login:

```hcl
auth_alias = {
  name    = module.auth.domain_cloudfront_distribution
  zone_id = module.auth.domain_cloudfront_zone_id
}
```

Avisos de composição (ambiente, #21):

- Nunca use `depends_on = [module.dns]` no `auth`: fecha ciclo, porque o `dns` já depende do `auth` pelo alias. A ordem já vem de `module.dns.auth_domain`.
- Não use `module.auth.domain_name` na CSP (`connect_src_origins` do módulo `site`) nem nas `callback_urls`: use `module.dns.domain_names[...]`, senão fecha o ciclo site, dns, auth. `module.auth.domain_name` serve só ao `/config.json`.

## Pré-requisitos do domínio próprio

- Certificado ACM **emitido** em us-east-1 que cubra `auth.<domínio>`.
- O domínio pai (`<domínio>` ou `staging.<domínio>`) já com registro A: o Cognito recusa criar o domínio sem ele.
- A criação do domínio no Cognito pode levar até cerca de uma hora. Se o primeiro `apply` falhar nesse ponto, rode o `plan` de novo antes de qualquer outra ação; nada de import nem de mexer no estado.

## Entradas

| Nome | Tipo | Padrão | Descrição |
|---|---|---|---|
| `name_prefix` | `string` | obrigatório | Prefixo do ambiente; nomeia o pool (`<prefixo>-users`) e o cliente (`<prefixo>-web`). Aceita só `acp-stg` ou `acp-prod` |
| `domain_name` | `string` | obrigatório | Domínio do login gerenciado. Precisa ser `auth.<domínio>` em minúsculas, até 63 caracteres, sem esquema nem porta |
| `acm_certificate_arn` | `string` | obrigatório | Certificado ACM em us-east-1 que cobre `domain_name`. Outra região é recusada |
| `callback_urls` | `list(string)` | obrigatório | URLs de retorno do login. Ao menos uma; cada uma `https://<host>[/caminho]`, sem curinga, porta, query, fragmento, `//` nem segmento de caminho iniciado por ponto. Idênticas ao `redirect_uri` do site |
| `logout_urls` | `list(string)` | obrigatório | URLs de retorno do logout, mesmas regras de `callback_urls`. Idênticas ao `logout_uri` do site |
| `self_signup_enabled` | `bool` | `false` | Abre o cadastro pelo login gerenciado. Os dois ambientes passam `false` desde a #383 |

## Saídas

| Nome | Descrição |
|---|---|
| `user_pool_id` | Id do User Pool, para o `/config.json` do site e para as funções |
| `user_pool_arn` | ARN do User Pool, para a política IAM de `AdminDeleteUser` da função `api` |
| `client_id` | Id do cliente público: `audience` do JWT authorizer e `client_id` do `/config.json` |
| `issuer` | Emissor dos tokens (`iss`), `https://<endpoint do pool>`, para o JWT authorizer |
| `domain_name` | Domínio do login gerenciado, já criado no Cognito, para o `/config.json` |
| `domain_cloudfront_distribution` | Nome DNS da distribuição CloudFront do domínio: alvo do alias no módulo `dns` |
| `domain_cloudfront_zone_id` | Zona hospedada dessa distribuição, para o alias no módulo `dns` |

## Para o site (#52)

- O Cognito **não tem opção para obrigar PKCE** no cliente. O módulo garante cliente público e só `code`; o `code_challenge` (S256) é responsabilidade do site.
- O escopo é exatamente `openid email`; qualquer outro devolve `invalid_scope`.
- `redirect_uri` e `logout_uri` têm de ser idênticos aos registrados.
- Troca do código e renovação em `POST https://<domain_name>/oauth2/token`, sem segredo.
- Sair chama `/oauth2/revoke` e `/logout`. Apagar só os tokens do site não basta: o login gerenciado mantém um cookie de sessão próprio, que só o `/logout` (com o `logout_uri` registrado) encerra.
- O refresh dura 1 dia e não há rotação: a sessão termina em no máximo um dia.

## Para a API (#19 e exclusão de conta)

- `issuer` e `client_id` alimentam o JWT authorizer. O access token do Cognito traz `client_id`, não `aud`.
- A exclusão de conta é por `AdminDeleteUser` na função `api`, com permissão sobre `user_pool_arn`. O cliente não tem o escopo `aws.cognito.signin.user.admin`, então não pode apagar a própria conta.

## Conferir no primeiro apply de staging

Não dá para validar sem apply: se a página do login gerenciado oferece usuário e senha com `explicit_auth_flows` só de refresh. Se não oferecer, o plano B é in-place, sem replace: acrescentar `ALLOW_USER_SRP_AUTH`. Nunca `ALLOW_USER_PASSWORD_AUTH`.

## Limites conhecidos

- Listas de senhas comuns ou vazadas (ASVS 6.2.4 e 6.2.12) só existem no tier Plus, que o projeto não usa.
- Sem WAF no domínio (risco aceito no ADR).
- O remetente padrão do Cognito envia no máximo 50 e-mails por dia por conta AWS; a cota não é ajustável e volta às 09:00 UTC. Com `self_signup_enabled = true`, qualquer pessoa com o `client_id` (público) pode esgotá-la por `SignUp`, `ResendConfirmationCode` e `ForgotPassword`; até a cota voltar, ninguém recebe código de verificação nem de recuperação. A saída é o SES, fora de escopo. Decisão do autor na #139.
- Com o cadastro fechado (`allow_admin_create_user_only = true`, os dois ambientes desde a #383), a conta nasce por `AdminCreateUser` com senha temporária de 3 dias e status `FORCE_CHANGE_PASSWORD`; o login gerenciado pede a senha definitiva no primeiro acesso (desafio `NEW_PASSWORD_REQUIRED`). A recuperação de senha ("Esqueci a senha") só funciona depois disso, com a conta `CONFIRMED` e o e-mail verificado. Mudar `admin_create_user_config` é atualização in-place do pool (`UpdateUserPool`): no provider, só `alias_attributes`, `username_attributes` e `username_configuration.case_sensitive` forçam substituição.
- Com o cadastro aberto, o `SignUp` responde `UsernameExistsException` para um e-mail já cadastrado: `prevent_user_existence_errors` não cobre o cadastro. Também na #139.
- Depois do primeiro apply, por causa do `prevent_destroy`, não mudam sem substituir o pool: `name_prefix` (o nome do pool), login por e-mail, `case_sensitive = false` e a ausência de `schema`. Mudar `generate_secret` substituiria o cliente e trocaria o `client_id`; o plan-guard barra.

## Remover o pool

O plano falha enquanto houver `prevent_destroy`, e o Cognito recusa a exclusão com `deletion_protection` ativa. Remover de propósito segue a ordem do ADR ("Travas contra destruição"): PR que tira o `prevent_destroy`, label `infra:destroy-approved` do autor, e o autor desliga a proteção e apaga o pool à mão. O papel de apply tem negação de `cognito-idp:DeleteUserPool`.

## Testes

Os testes usam provider simulado (`mock_provider`): não precisam de credenciais nem chamam a AWS.

```bash
terraform -chdir=infra/modules/auth init -backend=false
terraform -chdir=infra/modules/auth validate
terraform -chdir=infra/modules/auth test
```

O `init` cria um `.terraform.lock.hcl` na pasta do módulo. Não o versione: o lockfile fica só nos ambientes.
