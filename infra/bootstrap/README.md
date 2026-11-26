# infra/bootstrap

O que precisa existir antes de qualquer ambiente: os buckets de estado, o provedor OIDC do GitHub e os papéis que o CI assume. Decisões em `docs/architecture/aws-cost-playground/ADR-0001-stack.md` ("Hospedagem e ambientes" e "Travas contra destruição da infra").

**Quem aplica é o autor, à mão, uma única vez** (Issue #77). Agentes só alteram este diretório por Issue que o autorize de forma explícita, e nunca rodam `plan`, `apply`, `import` nem comandos de estado aqui.

## O que cria

| Recurso | Nome | Observação |
|---|---|---|
| Bucket de estado de staging | `acp-stg-tfstate-<id da conta>` | Versionamento, SSE-S3, bloqueio de acesso público, TLS obrigatório, `prevent_destroy` |
| Bucket de estado de produção | `acp-prod-tfstate-<id da conta>` | Idem |
| Provedor OIDC | `token.actions.githubusercontent.com` | Audiência `sts.amazonaws.com`; `prevent_destroy` |
| Papel `plan` | `acp-ci-plan` | Somente leitura; usado pelo job `plan` do `terraform.yml` |
| Papéis `apply` | `acp-ci-apply-staging` e `acp-ci-apply-production` | Um por ambiente, sessão de 1 hora, `prevent_destroy`. Gravam o próprio estado, escrevem nos recursos do ambiente (duas políticas gerenciadas, abaixo) e carregam as negações |
| Papel `prices` | `acp-ci-prices` | Só `pricing:GetProducts`, sessão de 1 hora, `prevent_destroy`. Usado pelo workflow semanal de preços (#222) |
| Limite de permissões | `acp-ci-boundary-staging` e `acp-ci-boundary-production` | Política gerenciada pelo cliente (sem custo), uma por ambiente, `prevent_destroy`. Teto dos papéis que o apply cria |
| Política de escrita do apply | `acp-ci-apply-named-staging` e `acp-ci-apply-named-production` | Política gerenciada pelo cliente (sem custo), uma por ambiente, `prevent_destroy`, anexada ao papel `apply` do ambiente pelo bootstrap. Só `Allow` |
| Política de escrita por ID | `acp-ci-apply-id-staging` e `acp-ci-apply-id-production` | Idem, para CloudFront, API Gateway, Cognito, ACM e Route 53: o ambiente vem da tag `environment` e do nome do registro DNS |
| Papel vinculado a serviço do API Gateway | `AWSServiceRoleForAPIGateway` | Criado aqui porque os papéis `apply` negam `iam:CreateServiceLinkedRole`; `prevent_destroy`. Sem custo |

Os papéis `apply` ainda não completam um deploy. Falta:

- a decisão do autor sobre as ações de escrita que não se delimitam por ambiente (#338): sem a entrega de log do HTTP API e sem o `cloudfront:UpdateDistribution` que o Cognito exige, o deploy deve parar no stage da API e no domínio do user pool;
- o bucket de artefatos, com o `s3:GetObject` do pacote das funções (#209).

O módulo `functions` declara o limite de permissões (#165); sem ele, a negação `DenyRoleWithoutBoundary` impede o apply de criar ou alterar os papéis das funções (falha fechada).

Nada aqui tem custo fixo: sem chave própria do KMS e sem tabela de lock (o lock é o nativo do S3). O ID da conta vem da credencial de quem aplica, nunca do código.

## Papel `plan`

| Pergunta | Resposta |
|---|---|
| Quem assume | Só um job do GitHub Actions deste repositório no evento `pull_request`: `sub` igual a `repo:henriqueluza/aws-cost-playground:pull_request` e `aud` igual a `sts.amazonaws.com`, por igualdade exata. PR de fork não recebe token OIDC |
| O que pode | `ReadOnlyAccess` (política gerenciada da AWS), o que o `terraform plan` precisa para ler a configuração dos recursos e o estado |
| O que não pode | Escrever qualquer coisa. Ler dado: itens do DynamoDB, usuários do Cognito, eventos de log, segredos (Secrets Manager e parâmetros do SSM) e objetos do S3 fora dos buckets de estado |

O job `plan` roda código do próprio PR, então o papel parte do princípio de que esse código é hostil. Limites conhecidos:

- A negação cobre os serviços que o projeto usa (lista exata em `plan.tf`, travada por teste). `ReadOnlyAccess` vale para a conta inteira: se a conta ganhar outro serviço com dado (fila, stream), acrescente a negação aqui.
- O papel lê os dois estados. Tudo que o Terraform gravar no estado fica visível para qualquer PR de branch deste repositório: **não ponha segredo no estado**.
- `ReadOnlyAccess` deixa ler a configuração dos recursos, inclusive as variáveis de ambiente das funções Lambda. A regra do projeto já proíbe segredo em variável de ambiente; aqui ela é o que protege o segredo.
- A negação de `ssm:GetParameter*` impede o `plan` de ler qualquer parâmetro. Por isso o parâmetro da chave da Claude API (`/acp/<env>/anthropic-api-key`) fica fora do Terraform e é criado à mão pelo autor (decisão da #126; ver `docs/runbooks/rotacao-de-segredos.md`). Não declare `aws_ssm_parameter` em nenhum módulo: o job `plan` falharia no refresh.

## Papéis `apply`

| Pergunta | Resposta |
|---|---|
| Quem assume | Só um job do GitHub Actions deste repositório que declare o GitHub Environment do papel e rode em `main`: `aud` igual a `sts.amazonaws.com`, `sub` igual a `repo:henriqueluza/aws-cost-playground:environment:<env>` e `ref` igual a `refs/heads/main`, tudo por `StringEquals` |
| O que pode | O estado do próprio ambiente (política inline `state`): `s3:ListBucket` no bucket, `GetObject` e `PutObject` em `acp-<stg\|prod>/terraform.tfstate`, e `GetObject`, `PutObject` e `DeleteObject` no `.tflock`. E, pela política gerenciada `acp-ci-apply-named-<env>`, criar, ler, atualizar e etiquetar os recursos com nome do ambiente (tabela abaixo). E, pela `acp-ci-apply-id-<env>`, os recursos com ARN por ID que levam a tag do ambiente e os registros DNS do ambiente (seção "Recursos com ARN por ID") |
| O que não pode | O que as políticas inline `deny-guardrails` e `deny-data` negam, nas tabelas abaixo. Negação explícita vence qualquer `Allow` futuro |

O `sub` de environment não carrega o branch, então o `ref` é fixado no IAM. Um job de `pull_request` não passa, porque o `ref` dele não é `refs/heads/main`.

A política gerenciada `acp-ci-apply-named-<env>` só tem `Allow`, com ações enumeradas (3,8 mil dos 6.144 caracteres permitidos). Cada ambiente recebe a sua, com o prefixo `<prefixo>` igual a `stg` ou `prod`. O papel não a altera: o nome casa com `policy/acp-ci-*` (`DenyCiIdentity`) e anexar ou desanexar é negado (`DenyRoleBypass`), por isso o anexo é do bootstrap.

| Sid | Permite | Onde | Condição |
|---|---|---|---|
| `Table` | `dynamodb:CreateTable`, `DescribeContinuousBackups`, `DescribeTable`, `DescribeTimeToLive`, `ListTagsOfResource`, `TagResource`, `UntagResource`, `UpdateContinuousBackups`, `UpdateTable`, `UpdateTimeToLive` | Tabelas `acp-<prefixo>-*` | Nenhuma |
| `Functions` | `lambda:CreateFunction`, `GetFunction`, `GetFunctionCodeSigningConfig`, `GetFunctionConfiguration`, `GetPolicy`, `ListTags`, `ListVersionsByFunction`, `TagResource`, `UntagResource`, `UpdateFunctionCode`, `UpdateFunctionConfiguration` | Funções `acp-<prefixo>-api` e `acp-<prefixo>-llm-proxy` | Nenhuma |
| `FunctionInvokePermission` | `lambda:AddPermission` | As mesmas duas funções | `lambda:Principal` igual a `apigateway.amazonaws.com` |
| `FunctionRoles` | `iam:CreateRole`, `GetRole`, `GetRolePolicy`, `ListAttachedRolePolicies`, `ListRolePolicies`, `PutRolePolicy`, `TagRole`, `UntagRole` | Papéis `acp-<prefixo>-api` e `acp-<prefixo>-llm-proxy` | O limite `acp-ci-boundary-<env>` continua exigido por `DenyRoleWithoutBoundary` |
| `PassFunctionRoles` | `iam:PassRole` | Os mesmos dois papéis | `iam:PassedToService` igual a `lambda.amazonaws.com` |
| `LogGroups` | `logs:CreateLogGroup`, `ListTagsForResource`, `PutRetentionPolicy`, `TagResource`, `UntagResource` | Log groups `/aws/lambda/acp-<prefixo>-*` e `/aws/vendedlogs/apigateway/acp-<prefixo>-*` | Nenhuma |
| `LogGroupList` | `logs:DescribeLogGroups` | `*` (a ação não aceita recurso) | Nenhuma |
| `AlarmTopic` | `sns:CreateTopic`, `GetSubscriptionAttributes`, `GetTopicAttributes`, `ListTagsForResource`, `SetTopicAttributes`, `TagResource`, `UntagResource` | Tópicos `acp-<prefixo>-*` | Nenhuma |
| `AlarmSubscription` | `sns:Subscribe` | Tópicos `acp-<prefixo>-*` | `sns:Protocol` igual a `email` |
| `Alarms` | `cloudwatch:DescribeAlarms`, `ListTagsForResource`, `PutMetricAlarm`, `TagResource`, `UntagResource` | Alarmes `acp-<prefixo>-*` | Nenhuma |
| `SiteBucket` | `s3:CreateBucket`, `GetAccelerateConfiguration`, `GetBucketAcl`, `GetBucketCORS`, `GetBucketLogging`, `GetBucketObjectLockConfiguration`, `GetBucketOwnershipControls`, `GetBucketPolicy`, `GetBucketPublicAccessBlock`, `GetBucketRequestPayment`, `GetBucketTagging`, `GetBucketVersioning`, `GetBucketWebsite`, `GetEncryptionConfiguration`, `GetLifecycleConfiguration`, `GetReplicationConfiguration`, `ListBucket`, `ListTagsForResource`, `PutBucketOwnershipControls`, `PutBucketPolicy`, `PutBucketPublicAccessBlock`, `PutBucketTagging`, `PutBucketVersioning`, `PutEncryptionConfiguration`, `TagResource`, `UntagResource` | Só o bucket `acp-<prefixo>-site-aws-cost-playground` | Nenhuma |
| `SiteObjects` | `s3:PutObject` | Objetos do mesmo bucket | Nenhuma |

Por que o `SiteBucket` tem tantos `Get*`: a leitura do `aws_s3_bucket` consulta toda a configuração do bucket e não tolera `AccessDenied`, mesmo para o que o módulo `site` nem declara. As tags têm duas APIs (`TagResource` e `*BucketTagging`); o provider tenta a nova e cai para a antiga. `lambda:ListTags` está na lista porque, sem ela, o `GetFunction` não devolve as tags e o Terraform veria diferença a cada plano. `GetFunctionConfiguration` também serve ao deploy, que espera a função atualizar. `SiteObjects` deixa só publicar: sem `GetObject`, `DeleteObject` nem invalidação do CloudFront (#169).

### O que fica de fora de propósito

- Nenhuma exclusão: `Delete*`, `lambda:RemovePermission`, `sns:Unsubscribe` e `iam:DeleteRolePolicy`.
- Atualizações que os módulos não disparam: `iam:UpdateRole`, `iam:UpdateRoleDescription`, `iam:PutRolePermissionsBoundary`, `sns:SetSubscriptionAttributes`, `logs:DeleteRetentionPolicy` e a concorrência reservada da função (configuração de custo, manual do autor).

Na prática, viram tarefa manual do autor: o `replace` de `aws_lambda_permission` (todo atributo força recriação), a troca do e-mail da assinatura, renomear alarme ou política inline e qualquer exclusão.

### Recursos com ARN por ID (`acp-ci-apply-id-<env>`)

CloudFront, API Gateway v2, Cognito, ACM e Route 53 têm ARN com ID gerado: o prefixo `acp-<prefixo>-*` não os delimita. A política gerenciada `acp-ci-apply-id-<env>` (`by_id.tf`, só `Allow`; de 4,3 a 5 mil dos 6.144 caracteres, conforme o tamanho do domínio, que a variável limita a 63 caracteres) usa a tag `environment`, que os roots de `infra/envs/*` aplicam por `default_tags`, e o nome do registro no Route 53. `<env>` é `staging` ou `production`.

| Sid | Permite | Onde | Condição |
|---|---|---|---|
| `CreateTagged` | `cloudfront:CreateDistribution`, `cognito-idp:CreateUserPool` | `*` (criar não aceita recurso) | `aws:RequestTag/environment` igual a `<env>` |
| `CertificateRequest` | `acm:RequestCertificate` | `*` (criar não aceita recurso) | `aws:RequestTag/environment` igual a `<env>` e todo nome do certificado (`acm:DomainNames`) entre os nomes do próprio ambiente |
| `TagOwn` | `acm:AddTagsToCertificate`, `cloudfront:TagResource`, `cognito-idp:TagResource` | Certificados, distribuições e user pools da conta | `aws:RequestTag/environment` igual a `<env>` e, se o recurso já tiver a tag, `aws:ResourceTag/environment` igual a `<env>` |
| `Distribution` | `cloudfront:CreateInvalidation`, `GetDistribution`, `GetInvalidation`, `ListTagsForResource`, `UpdateDistribution` | Distribuições da conta | `aws:ResourceTag/environment` igual a `<env>` |
| `EdgePolicies` | `cloudfront:CreateCachePolicy`, `CreateOriginAccessControl`, `CreateResponseHeadersPolicy`, `GetCachePolicy`, `GetOriginAccessControl`, `GetResponseHeadersPolicy`, `ListCachePolicies` | `*` | Nenhuma: esses recursos não aceitam tag. Só criar e ler |
| `Certificates` | `acm:DescribeCertificate`, `ListTagsForCertificate` | Certificados da conta | `aws:ResourceTag/environment` igual a `<env>` |
| `UserPool` | `cognito-idp:CreateManagedLoginBranding`, `CreateUserPoolClient`, `CreateUserPoolDomain`, `DescribeManagedLoginBranding`, `DescribeManagedLoginBrandingByClient`, `DescribeUserPool`, `DescribeUserPoolClient`, `GetUserPoolMfaConfig`, `ListUserPoolClients`, `UpdateManagedLoginBranding`, `UpdateUserPoolClient`, `UpdateUserPoolDomain` | User pools da conta | `aws:ResourceTag/environment` igual a `<env>` |
| `UserPoolUpdate` | `cognito-idp:UpdateUserPool` | User pools da conta | `aws:ResourceTag/environment` igual a `<env>` e nenhuma tag no pedido (`aws:TagKeys` ausente) |
| `UserPoolDomainRead` | `cognito-idp:DescribeUserPoolDomain` | `*` (a ação não aceita recurso) | Nenhuma: só leitura |
| `ApiCreate` | `apigateway:POST` | `/apis` e `/domainnames` | `aws:RequestTag/environment` igual a `<env>` |
| `Api` | `apigateway:GET`, `PATCH`, `POST` | `/apis/*` e `/domainnames/*` | `aws:ResourceTag/environment` igual a `<env>` |
| `ZoneRead` | `route53:GetChange`, `GetHostedZone`, `ListResourceRecordSets`, `ListTagsForResource` | A zona do produto e `change/*` | Nenhuma: só leitura |
| `ZoneList` | `route53:ListHostedZones` | `*` (a ação não aceita recurso) | Nenhuma: só leitura |
| `Records` | `route53:ChangeResourceRecordSets` | A zona do produto | Nome do registro, tipo `A` ou `CNAME` e ação `CREATE` ou `UPSERT` (abaixo); as três chaves precisam estar no pedido (`Null`) |

**Tags.** O escopo por tag só vale se o papel não puder trocar a tag. Etiquetar (`TagOwn`) exige o próprio ambiente no pedido e recusa recurso que já tenha `environment` de outro ambiente; não há ação de tirar etiqueta. A condição do recurso é `StringEqualsIfExists` porque criar com tags chama a ação de etiquetar antes de a tag existir (o `CreateDistributionWithTags` do CloudFront exige `cloudfront:TagResource`). O API Gateway fica sem ação de etiquetar: o recurso `/tags/*` não aceita `aws:ResourceTag`. `cognito-idp:UpdateUserPool` também aceita tags no pedido e trocaria `environment` por fora de `TagOwn`; por isso tem statement próprio, que recusa qualquer pedido com tags (o provider não as envia nessa chamada).

**Certificados.** `acm:RequestCertificate` só vale para os nomes do próprio ambiente (os mesmos da tabela do Route 53 abaixo, sem os `_*`). O ACM reaproveita o CNAME de validação de um nome: sem essa condição, staging obteria um certificado válido para `api.<domínio>`.

**Route 53.** A zona é uma só para os dois ambientes; o que separa é a chave `route53:ChangeResourceRecordSetsNormalizedRecordNames`:

| Ambiente | Nomes que o papel grava | Nomes recusados |
|---|---|---|
| `staging` | `staging.<domínio>` e `*.staging.<domínio>` | Todo o resto |
| `production` | `<domínio>`, `api.<domínio>`, `auth.<domínio>` e `_*.<domínio>` (CNAMEs de validação do ACM) | `staging.<domínio>` e `*.staging.<domínio>`, por `ForAllValues:StringNotLike` |

O domínio entra pela variável `zone_name`, sem default, a mesma `TF_VAR_zone_name` dos ambientes: em minúsculas, sem ponto final e com até 63 caracteres, como a chave de condição compara e para a política caber no limite. O bootstrap lê a zona pública com esse nome (`data.aws_route53_zone.product`) para pôr o ARN exato no `Resource`; por isso a zona precisa existir antes (#74). Sem `DELETE`: apagar ou renomear registro é tarefa manual do autor.

**Papel vinculado a serviço.** O API Gateway cria `AWSServiceRoleForAPIGateway` na primeira API ou domínio, com a permissão de quem chama, e os papéis `apply` negam `iam:CreateServiceLinkedRole` (`DenyIamOutsideEnvironment`). A negação não foi aberta: o papel nasce aqui (`aws_iam_service_linked_role.apigateway`, com `prevent_destroy`). Se ele já existir na conta, importe-o antes de aplicar ("Estado deste diretório").

**Fora, à espera de decisão do autor (#338).** Estas ações de escrita não podem ser limitadas ao ambiente e por isso não estão na política:

- a entrega de log do stage do HTTP API (`logs:CreateLogDelivery`, `UpdateLogDelivery`, `DeleteLogDelivery`, `PutResourcePolicy` e as leituras `GetLogDelivery`, `ListLogDeliveries`, `DescribeResourcePolicies`, todas só em `*`);
- `cloudfront:UpdateDistribution` em `*`, que o Cognito exige de quem cria o domínio próprio do user pool;
- alterar política de cache, política de cabeçalhos e OAC que já existem (`cloudfront:UpdateCachePolicy`, `UpdateResponseHeadersPolicy`, `UpdateOriginAccessControl`);
- etiquetar recurso do API Gateway (`apigateway:PUT` e `DELETE` em `/tags/*`).

Sem as duas primeiras, o primeiro deploy de staging deve parar no stage do HTTP API e no domínio do Cognito.

**Limites conhecidos desta política:**

- `EdgePolicies` vale em `*`: o papel de um ambiente lê as políticas e o OAC do outro e cria novos, mas não altera nem apaga os que existem. Como o nome dessas políticas é único na conta e a cota por tipo é pequena, um apply malicioso de staging pode ocupar o nome que produção usaria ou esgotar a cota: o deploy de produção falha e a limpeza é manual (nenhum papel de CI apaga).
- `TagOwn` aceita recurso sem a tag `environment`: um certificado, distribuição ou user pool criado fora do Terraform, sem tags, pode ser etiquetado por qualquer um dos dois papéis e passa a ser dele. Os recursos dos ambientes nascem etiquetados.
- `ZoneRead` e `ZoneList` deixam ler todos os registros da zona, inclusive os do outro ambiente. São dados públicos de DNS.
- Produção grava qualquer registro `A` ou `CNAME` que comece com `_` (fora de `staging.`), não só os CNAMEs de validação: o nome deles é gerado pelo ACM.
- Em `apigateway:POST`, `PATCH` e `GET` sobre rotas, integrações, authorizer e mapeamentos, a condição depende de o API Gateway v2 aplicar a tag da API aos recursos filhos. O Service Reference lista `aws:ResourceTag` nesses tipos; a documentação só afirma a herança para a API v1. Se não valer, o deploy falha fechado e a saída é decisão do autor (#338).
- O IAM só confere o caminho do pedido ao API Gateway, não o corpo: o papel de staging pode criar, no domínio de staging, um mapeamento para o ID da API de produção, ou uma integração para outra função. A API continua atrás do authorizer JWT.
- Atualizações que os módulos não disparam hoje ficam de fora e falham fechado se um dia forem pedidas: `acm:UpdateCertificateOptions`, `cognito-idp:SetUserPoolMfaConfig`, `cognito-idp:AddCustomAttributes` e as ações de tirar etiqueta (remover uma tag do `default_tags`).
- Nada aqui foi testado contra a AWS. Primeiros suspeitos no primeiro deploy, todos com falha fechada: a herança acima; criar API, stage ou domínio com tags pedir `apigateway:PUT` em `/tags/*`; `aws:ResourceTag` não chegar a `cloudfront:CreateInvalidation`; e `UpdateUserPool` sem tags no pedido apagar as tags do pool.
- `#trivy:ignore:AVD-AWS-0057` na política: `Resource: *` em `CreateTagged`, `CertificateRequest`, `EdgePolicies`, `UserPoolDomainRead` e `ZoneList`, e o `*` no lugar do ID nos demais. Nenhuma ação tem curinga.

### Negações

As negações da política inline `deny-guardrails` vencem qualquer `Allow` acima:

| Sid | Nega | Por quê |
|---|---|---|
| `DenyDataDeletion` | `cognito-idp:DeleteUserPool`, `dynamodb:DeleteTable`, `dynamodb:PutResourcePolicy`, `route53:DeleteHostedZone`, `s3:DeleteBucket` | Camada IAM do ADR: um plano destrutivo aprovado por engano falha no apply. Uma política de recurso na tabela daria `DeleteTable` a outra conta |
| `DenyParameterStore` | `ssm:*` | A chave da Claude API fica num parâmetro criado à mão, fora do Terraform (#126): o CI não lê, não sobrescreve nem apaga parâmetro |
| `DenyCiIdentity` | `iam:*` nos papéis `acp-ci-*`, nas políticas `acp-ci-*` e no provedor OIDC | O papel não altera a si mesmo, os outros papéis de CI, a política de limite nem o provedor |
| `DenyIamOutsideEnvironment` | `iam:*` em tudo que não for `role/acp-<stg\|prod>-*` | Sem usuários, grupos, políticas gerenciadas, papéis do outro ambiente, papéis vinculados a serviço nem `PassRole` de papel de fora do ambiente. O `PassRole` dos papéis do próprio ambiente não é negado aqui: o `Allow` é o `PassFunctionRoles` da política gerenciada |
| `DenyRoleWithoutBoundary` | `iam:CreateRole`, `PutRolePolicy`, `DeleteRolePolicy` e `PutRolePermissionsBoundary` em papel sem o limite `acp-ci-boundary-<env>` | O apply cria os papéis das Lambdas; sem o limite, criaria um papel sem as negações e apagaria a tabela por uma função |
| `DenyRoleBypass` | `iam:DeleteRolePermissionsBoundary`, `UpdateAssumeRolePolicy`, `AttachRolePolicy`, `DetachRolePolicy` | Tirar o limite, trocar o trust de um papel existente, anexar ou desanexar política gerenciada (desanexar desligaria o corte do Budgets no papel do proxy) |
| `DenyStateBucketConfig` | No bucket de estado do ambiente, tudo que não for ler, gravar, apagar e listar objetos | Política, versionamento, criptografia, bloqueio público, ciclo de vida e exclusão de versões. Apagar um objeto só cria um marcador: as versões antigas continuam lá |
| `DenyOtherEnvironmentState` | `s3:*` no bucket de estado do outro ambiente | Um ambiente não lê nem grava o estado do outro |

O apply gerencia a infraestrutura, não o dado. A política inline `deny-data` só tem `Deny`, em qualquer recurso:

| Sid | Nega | Por quê |
|---|---|---|
| `DenyTableItems` | Ler e gravar itens (`GetItem`, `BatchGetItem`, `Query`, `Scan`, `PutItem`, `UpdateItem`, `DeleteItem`, `BatchWriteItem`, `ConditionCheckItem`), `PartiQL*`, `GetRecords`, `ExportTableToPointInTime` e `EnableKinesisStreamingDestination` | Designs e contadores de quota. A exportação e o stream do Kinesis levariam a tabela inteira para outro lugar |
| `DenyUserData` | `cognito-idp:Admin*` e `cognito-idp:ListUsers*` | Ler, criar e alterar usuários, trocar senha e autenticar como um usuário. Nenhuma ação de configuração do pool começa com `Admin` |
| `DenySecrets` | `secretsmanager:*` | O projeto não usa o serviço. Os parâmetros do SSM já caem em `DenyParameterStore` |
| `DenyLogEvents` | Ler eventos (`GetLogEvents`, `FilterLogEvents`, `GetLogRecord`, `GetLogObject`, `StartQuery`, `GetQueryResults`, `StartLiveTail`, `Unmask`) e mandá-los para fora (`CreateExportTask`, `PutSubscriptionFilter`, `PutAccountPolicy`) | Os logs carregam o `sub` dos usuários |
| `DenyFunctionInvoke` | `lambda:Invoke*` | Um evento forjado pula o JWT do API Gateway e faz a função agir como qualquer usuário |
| `DenyFunctionUrl` | `lambda:CreateFunctionUrlConfig` e `lambda:UpdateFunctionUrlConfig` | A URL de função é uma entrada pública que pula o API Gateway e o JWT |
| `DenyAssumeRole` | `sts:AssumeRole` | O papel não troca de identidade, mesmo que o trust de outro papel da conta o cite |

As ações de controle continuam livres dessas negações (criar e alterar tabela, user pool, log group e função); o teste confere uma a uma. Consequência para os módulos: sem filtro de assinatura de log, sem exportação de tabela, sem `aws_lambda_invocation` e sem `aws_lambda_function_url`.

Limites conhecidos:

- A negação de dado cobre os serviços que o projeto usa. Serviço novo com dado (fila, stream, bucket com dado de usuário) pede negação nova aqui.
- Ela não fecha o caminho pela configuração: quem aplica pode trocar o código de uma função, um gatilho do user pool ou o destino de um alarme. A revisão do PR e o `plan-guard` são as outras camadas.
- O branch é garantido no IAM pelo `ref`. Restringir os GitHub Environments `staging` e `production` ao branch `main` é a segunda camada e é feita pelo autor (#77).
- Não existe chave de condição para o evento, e o trust não fixa o arquivo de workflow. Qualquer job de um workflow que esteja em `main`, declare o Environment e rode com `ref` igual a `refs/heads/main` assume o papel: push, `workflow_dispatch`, `schedule` e também `pull_request_target` e `workflow_run`. Por isso nenhum job com `environment:` pode rodar em `pull_request_target` ou `workflow_run` executando código do PR (regra para a #22 e a #23). A AWS aceita a chave `job_workflow_ref` para o provedor do GitHub, mas o trust **não** a fixa (decisão da #169): o valor da claim em cada workflow de deploy (`deploy-staging.yml` e `deploy-production.yml`) não pôde ser conferido contra a AWS; um valor errado tranca o deploy e só se corrige reaplicando o bootstrap à mão; e o ganho é pequeno contra o adversário deste papel, porque um PR malicioso mergeado pode editar o próprio arquivo fixado. Vale rever depois do primeiro deploy, com o valor real da claim lido de um job.
- O papel grava o próprio estado, então consegue sobrescrevê-lo. O que ele não consegue é excluir versões nem desligar o versionamento: o autor recupera a versão anterior. A negação `DenyStateBucketConfig` não escolhe quais objetos do bucket são lidos ou gravados; isso é do `Allow`, que só cita o estado e o `.tflock`. O bucket de estado casa com `acp-<prefixo>-*`: nenhum `Allow` de S3 das continuações pode usar esse prefixo.
- O trust só é provado no primeiro deploy depois da #77: os testes usam provider simulado.
- `iam:CreateRole` aceita qualquer trust, e não existe chave de condição que o restrinja. O apply pode criar um dos dois papéis de nome fixo (`acp-<prefixo>-api` e `acp-<prefixo>-llm-proxy`) com trust para outra conta, sempre dentro do limite; veja "Limite de permissões" abaixo para o que esse papel alcança. Sem `DeleteRole`, o apply não recria um papel que já existe.
- Os dois papéis das funções podem ser passados a qualquer das duas funções. O que separa é o limite de permissões: `ssm:GetParameter` só vale chamado pelo `llm-proxy` e `AdminDeleteUser` só pela `api`.
- Quem faz deploy controla o código das Lambdas. Dentro do limite, esse código lê e apaga itens e lê a chave. O IAM não fecha isso; a revisão do PR e o `plan-guard` são as outras camadas.
- `logs:DescribeLogGroups` vale em `*`, porque a ação não aceita recurso (Service Reference da AWS). É a única exceção ao "nenhum `Allow` alcança o outro ambiente": lista nome, retenção e tamanho dos log groups da conta, sem eventos.
- `lambda:AddPermission` só tem a chave `lambda:Principal`: o IAM não fixa a API de origem. Uma permissão sem `source_arn` deixaria o API Gateway de qualquer conta invocar a função. Ficam a revisão do PR e o `plan-guard`. O papel não tem `lambda:RemovePermission`: desfazer uma permissão dessas é tarefa manual do autor e não some com a revogação do papel.
- `s3:PutBucketPolicy` e `s3:PutBucketPublicAccessBlock` no bucket do site não têm chave de condição que limite o conteúdo: um apply malicioso poderia abrir o bucket ou dar escrita a outra conta, e isso persiste depois de revogar o papel. Em resposta a incidente, o autor confere e regrava a política e o bloqueio de acesso público do bucket do site. O bucket só guarda o site, que é público pelo CloudFront.
- `logs:PutRetentionPolicy` não tem chave de condição: o apply pode encurtar a retenção dos log groups do ambiente (mínimo de 1 dia) e, com isso, o rastro de um deploy. O CloudTrail registra a chamada.
- `sns:Subscribe` é limitada ao protocolo `email`, mas não ao endereço (`sns:Endpoint`): o e-mail dos alarmes é um secret do repositório, desconhecido do bootstrap. Um apply malicioso poderia assinar outro endereço, que receberia nome e estado dos alarmes (sem dado de usuário) depois de confirmar o link.
- `SiteObjects` não tem `s3:AbortMultipartUpload`: o `aws s3 cp` só usa envio em partes acima de 8 MB, tamanho que nenhum arquivo do site alcança hoje. Se um passar disso e o envio falhar no meio, as partes órfãs ficam para o autor limpar.
- `dynamodb:CreateTable` e `UpdateTable` não têm chave de condição: o apply pode trocar a tabela para capacidade provisionada (custo), desligar o PITR e a proteção contra exclusão (`DeleteTable` segue negada). As outras camadas são as mesmas, mais os alertas do Budgets.
- O nome do bucket do site é repetido aqui (`acp-<stg|prod>-site-aws-cost-playground`). Trocar o nome no root exige trocar aqui e reaplicar o bootstrap; o teste de paridade em `infra/tools/tests/` reprova a divergência.
- A lista de ações não foi testada contra a AWS: o primeiro deploy depois da #77 pode pedir ajuste. O primeiro suspeito é `cloudwatch:DescribeAlarms`: o Service Reference diz que aceita o recurso `alarm`, mas a chamada pode ser autorizada contra `alarm:*`. Nesse caso o ajuste é trocar o `Resource` dessa ação para `arn:aws:cloudwatch:us-east-1:<conta>:alarm:*`. O outro bloqueio conhecido é o pacote das funções: `lambda:CreateFunction` e `UpdateFunctionCode` leem o zip com a permissão de quem chama, e o `s3:GetObject` do bucket de artefatos só entra com a #209.
- `#trivy:ignore:AVD-AWS-0057` na política gerenciada: os curingas são o prefixo `acp-<prefixo>-*` de tabela, log group, tópico e alarme, os objetos do bucket do site e o `*` de `logs:DescribeLogGroups`. Nenhuma ação tem curinga.
- Para quem escreve módulos:
  - papéis só com política inline: sem `aws_iam_policy`, sem `aws_iam_role_policy_attachment` e sem `data "aws_iam_policy"`;
  - nomes `acp-<stg|prod>-*`; funções e papéis só com os dois nomes fixos (`api` e `llm-proxy`);
  - sem `aws_lambda_function_url`;
  - recurso com nome fora de `acp-<stg|prod>-*`, ou serviço novo, pede mudança nesta política;
  - sem `aws_ssm_parameter`;
  - sem papel vinculado a serviço criado pelo apply (o do API Gateway nasce no bootstrap, #169);
  - trocar o trust de um papel existente é tarefa manual do autor.

## Limite de permissões

`acp-ci-boundary-<env>`, com `<env>` igual a `staging` ou `production` (o nome do ambiente, não o prefixo `stg`/`prod`). O ARN é `arn:aws:iam::<id da conta>:policy/acp-ci-boundary-<env>`, sem caminho. Todo papel que o apply cria ou altera tem de carregar esse limite (`DenyRoleWithoutBoundary`), e o apply não altera nem apaga a política, porque o nome casa com `policy/acp-ci-*` (`DenyCiIdentity`).

O limite não concede nada: é o teto. Um papel só faz o que a política inline dele **e** o limite permitem.

| Sid | Permite | Onde | Condição |
|---|---|---|---|
| `FunctionLogs` | `logs:CreateLogStream`, `logs:PutLogEvents` | Log groups `/aws/lambda/acp-<stg\|prod>-*` | Nenhuma |
| `TableItems` | `dynamodb:GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `Query`, `BatchWriteItem` | Tabelas `acp-<stg\|prod>-*` | A chamada sai do código da função `acp-<stg\|prod>-api` ou `acp-<stg\|prod>-llm-proxy` |
| `DeleteOwnAccount` | `cognito-idp:AdminDeleteUser` | User pool com a tag `environment` igual ao ambiente | A chamada sai do código da função `api` |
| `ClaudeApiKey` | `ssm:GetParameter` | Só o parâmetro `/acp/<env>/anthropic-api-key` | A chamada sai do código da função `llm-proxy` |

| Sid | Nega | Por quê |
|---|---|---|
| `DenyDataDeletion` | As mesmas cinco ações do papel apply | Uma função não apaga tabela, user pool, bucket nem zona, nem com política de recurso a favor |
| `DenyIdentity` | `iam:*` e `sts:AssumeRole` | Uma função não mexe em IAM nem troca de papel |

Nada de KMS (o parâmetro usa a chave gerenciada `aws/ssm`, que não pede `kms:Decrypt` do papel), de S3, de outros parâmetros nem de leitura de log.

A condição é `ArnEquals` em `lambda:SourceFunctionArn` com o ARN exato da função, sem versão nem alias. O Lambda põe essa chave nas credenciais quando a chamada sai do ambiente de execução da função ([documentação](https://docs.aws.amazon.com/lambda/latest/dg/permissions-source-function-arn.html)). Fora de uma função a chave não existe e o `Allow` não vale: um papel criado com trust para outra conta, ou entregue a uma função nova, não lê item, usuário nem a chave.

Limites conhecidos:

- **O trust não é restringido.** O limite não impede criar um papel `acp-<prefixo>-*` com trust para fora; só tira dele o dado. Esse papel ainda escreve eventos nos log groups do ambiente, porque `FunctionLogs` não tem condição (a #166 condiciona só os `Allow` de dado). Ele não lê log.
- **Código novo numa função que já existe lê dado dentro do limite.** O `UpdateFunctionCode` do deploy, ou apagar e recriar a função com o mesmo nome, mantém o ARN. Risco aceito, não resolvido: revisão do PR e `plan-guard`.
- **O limite não repete o `dynamodb:LeadingKeys` nem separa as duas funções na tabela.** Isso é da política inline de cada papel, que o apply pode reescrever dentro do limite.
- **O escopo por tag só vale se o apply não puder trocar a tag `environment` do user pool.** A regra de tags entra na #169; até lá, o apply de um ambiente que ganhe escrita no Cognito poderia marcar o pool do outro.
- **A documentação cita política baseada em identidade e SCP, não limite de permissões.** Um limite é uma política gerenciada de identidade avaliada contra o mesmo contexto da requisição, então a chave vale; a prova é o primeiro deploy. Se não valesse, a falha seria fechada: as funções receberiam `AccessDenied` no dado.
- **Chamadas que o Lambda faz fora do ambiente de execução não levam a chave** (ler um stream por event source mapping, por exemplo). Nenhuma função usa isso hoje; se usar, o limite muda.
- **Permissão nova numa função exige mudar o limite aqui**, por Issue que autorize o bootstrap, e o autor reaplica à mão. A região é fixa em `us-east-1`.
- `#trivy:ignore:AVD-AWS-0057` na política: os curingas são o sufixo `:*` dos log streams, o prefixo `acp-<prefixo>-*` e o ID do user pool, que a AWS gera. Nenhuma ação tem curinga.

## Papel `prices`

| Pergunta | Resposta |
|---|---|
| Quem assume | Só um job do GitHub Actions deste repositório rodando no branch `main` sem `environment:`: `sub` igual a `repo:henriqueluza/aws-cost-playground:ref:refs/heads/main` e `aud` igual a `sts.amazonaws.com`, ambos por `StringEquals`. O workflow de preços (#222) roda por `schedule` semanal e `workflow_dispatch`. Um job de `pull_request` (`sub` `...:pull_request`), de outro branch, com `environment:` (`sub` `...:environment:<env>`) ou de outro repositório não casa |
| O que pode | Só `pricing:GetProducts` (política inline `get-products`), a única chamada do gerador (`pricing/app/client.py`, paginador `get_products`, endpoint `us-east-1`). Sem política gerenciada |
| O que não pode | Todo o resto: não lê nem escreve nada da conta. O PR do catálogo é aberto com o `GITHUB_TOKEN`, não com o papel |

Limites conhecidos:

- `Resource: "*"`: a [Service Authorization Reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_awspricelist.html) diz que o AWS Price List não suporta ARN no elemento `Resource` e o serviço não tem chave de condição própria. Por isso o `#trivy:ignore:AVD-AWS-0057`. A ação não tem curinga.
- O trust não fixa evento nem arquivo de workflow: qualquer job sem `environment:` de um workflow rodando com `ref` igual a `refs/heads/main` assume o papel (push, `schedule`, `workflow_dispatch` e também `pull_request_target` e `workflow_run`, cujo `ref` é o branch base). O alcance é ler preço público: o papel não dá acesso a nada da conta. Fixar `job_workflow_ref` é possível agora que o workflow existe em `.github/workflows/prices.yml` (#222), por Issue que autorize o bootstrap.
- Se o gerador passar a chamar outra ação da Price List (`DescribeServices`, `GetAttributeValues`, `ListPriceLists`, `GetPriceListFileUrl`), a política muda aqui, por Issue que autorize o bootstrap. Hoje o workflow falharia com `AccessDenied` (falha fechada).
- O trust só é provado na primeira execução do workflow depois da #77: os testes usam provider simulado.

## Como aplicar (autor)

Pré-requisitos: Terraform 1.16, credencial temporária de administrador da conta (SSO ou sessão de curta duração, nunca chave de acesso gravada em arquivo) e a zona pública do domínio já criada no Route 53 (#74): o bootstrap lê o ID dela. Os guardrails de custo (`docs/runbooks/guardrails-de-custo.md`) vêm depois, por ambiente, com a infra dele já aplicada; antes do bootstrap só cabe a leitura da quota de concorrência da conta (guardrail 1 do runbook).

```bash
cd infra/bootstrap
export TF_VAR_zone_name="<domínio>"   # o mesmo de TF_VAR_ZONE_NAME no GitHub: minúsculas, sem ponto final
terraform init -lockfile=readonly
terraform plan -out=bootstrap.tfplan   # confira: só criação, nenhum delete ou replace
terraform apply bootstrap.tfplan
```

Reaplicar depois de uma mudança neste diretório é o mesmo roteiro. Na reaplicação que traz a política `acp-ci-apply-named-<env>` (#167), o `plan` deve mostrar 4 criações (2 políticas e 2 anexos) e 2 atualizações no lugar (a política inline `deny-data` de cada papel), sem `delete` nem `replace`. Na que traz a política `acp-ci-apply-id-<env>` (#169), 5 criações (2 políticas, 2 anexos e o papel vinculado a serviço do API Gateway) e nenhuma atualização; se o papel vinculado já existir na conta, importe-o antes (abaixo) e o plano mostra 4. Aplique o bootstrap **antes** do primeiro apply de um ambiente que use o limite (#165): sem a política, a criação dos papéis das funções falha.

Se a conta já tiver um provedor OIDC do GitHub (só pode haver um por conta), importe-o antes do `apply`:

```bash
terraform import aws_iam_openid_connect_provider.github \
  "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):oidc-provider/token.actions.githubusercontent.com"
```

O mesmo vale para o papel vinculado a serviço do API Gateway, que só existe uma vez por conta e nasce sozinho se alguém já criou uma API ou um domínio do API Gateway nela. `aws iam get-role --role-name AWSServiceRoleForAPIGateway` diz se ele existe; se existir:

```bash
terraform import aws_iam_service_linked_role.apigateway \
  "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/aws-service-role/ops.apigateway.amazonaws.com/AWSServiceRoleForAPIGateway"
```

## Saídas que viram variáveis do GitHub

A saída `github_variables` é um mapa cujas chaves são os nomes das variáveis de **repositório** (não são segredos) lidas pelo `.github/workflows/terraform.yml` e pelo workflow de preços (#222):

| Variável | Valor |
|---|---|
| `AWS_PLAN_ROLE_ARN` | ARN do papel `plan` |
| `TF_STATE_BUCKET_STAGING` | Bucket de estado de `infra/envs/staging` |
| `TF_STATE_BUCKET_PRODUCTION` | Bucket de estado de `infra/envs/production` |
| `AWS_PRICES_ROLE_ARN` | ARN do papel `prices` (lida pelo workflow de preços, #222; sem ela o workflow termina com aviso e sem falhar) |

```bash
terraform output -json github_variables | jq -r 'to_entries[] | "\(.key) \(.value)"' |
  while read -r name value; do
    gh variable set "$name" --body "$value" --repo henriqueluza/aws-cost-playground
  done
```

Enquanto `AWS_PLAN_ROLE_ARN` não existir, o job `plan` é pulado.

A saída `github_environment_variables` é um mapa de dois níveis: a chave externa é o nome do GitHub Environment e a interna é o nome da variável desse Environment.

| Environment | Variável | Valor |
|---|---|---|
| `staging` | `AWS_APPLY_ROLE_ARN` | ARN do papel `acp-ci-apply-staging` |
| `production` | `AWS_APPLY_ROLE_ARN` | ARN do papel `acp-ci-apply-production` |

Pré-requisito: os Environments `staging` e `production` existem e estão restritos ao branch `main` antes de cadastrar a variável. Criar os Environments e a restrição faz parte da #77; sem o Environment, o `gh variable set --env` falha.

```bash
terraform output -json github_environment_variables |
  jq -r 'to_entries[] | .key as $env | .value | to_entries[] | "\($env) \(.key) \(.value)"' |
  while read -r env name value; do
    gh variable set "$name" --env "$env" --body "$value" --repo henriqueluza/aws-cost-playground
  done
```

## Estado deste diretório

O bootstrap cria o bucket onde o estado dos ambientes mora, então o estado dele é **local**: `infra/bootstrap/terraform.tfstate`, que o `.gitignore` já exclui. Nunca o versione.

- Depois de cada `apply`, guarde uma cópia de `terraform.tfstate` fora do repositório, num local cifrado e com backup (cofre de senhas ou disco cifrado). Ele não tem segredo, mas tem o ID da conta e os ARNs.
- Apague o `bootstrap.tfplan` depois de aplicar.
- Se o arquivo se perder, nada na AWS é afetado. Reconstrua o estado com `terraform import`, um comando por recurso, antes de qualquer `apply`:

| Endereço | ID de importação |
|---|---|
| `aws_s3_bucket.state["staging"]` e os quatro recursos `aws_s3_bucket_*.state["staging"]` | `acp-stg-tfstate-<id da conta>` |
| `aws_s3_bucket.state["production"]` e os quatro recursos `aws_s3_bucket_*.state["production"]` | `acp-prod-tfstate-<id da conta>` |
| `aws_iam_openid_connect_provider.github` | ARN do provedor |
| `aws_iam_role.plan` | `acp-ci-plan` |
| `aws_iam_role_policy_attachment.plan_read_only` | `acp-ci-plan/arn:aws:iam::aws:policy/ReadOnlyAccess` |
| `aws_iam_role_policy.plan_deny_data` | `acp-ci-plan:deny-data-read` |
| `aws_iam_role.prices` | `acp-ci-prices` |
| `aws_iam_role_policy.prices_get_products` | `acp-ci-prices:get-products` |
| `aws_iam_role.apply["<env>"]` | `acp-ci-apply-<env>` |
| `aws_iam_role_policy.apply_state["<env>"]` | `acp-ci-apply-<env>:state` |
| `aws_iam_role_policy.apply_deny["<env>"]` | `acp-ci-apply-<env>:deny-guardrails` |
| `aws_iam_role_policy.apply_deny_data["<env>"]` | `acp-ci-apply-<env>:deny-data` |
| `aws_iam_policy.apply_boundary["<env>"]` | `arn:aws:iam::<id da conta>:policy/acp-ci-boundary-<env>` |
| `aws_iam_policy.apply_named["<env>"]` | `arn:aws:iam::<id da conta>:policy/acp-ci-apply-named-<env>` |
| `aws_iam_role_policy_attachment.apply_named["<env>"]` | `acp-ci-apply-<env>/arn:aws:iam::<id da conta>:policy/acp-ci-apply-named-<env>` |
| `aws_iam_policy.apply_id["<env>"]` | `arn:aws:iam::<id da conta>:policy/acp-ci-apply-id-<env>` |
| `aws_iam_role_policy_attachment.apply_id["<env>"]` | `acp-ci-apply-<env>/arn:aws:iam::<id da conta>:policy/acp-ci-apply-id-<env>` |
| `aws_iam_service_linked_role.apigateway` | `arn:aws:iam::<id da conta>:role/aws-service-role/ops.apigateway.amazonaws.com/AWSServiceRoleForAPIGateway` |

## Verificação sem credenciais

```bash
terraform -chdir=infra/bootstrap init -backend=false -lockfile=readonly
terraform -chdir=infra/bootstrap validate
terraform -chdir=infra/bootstrap test
```

Os testes (`tests/bootstrap.tftest.hcl`, `tests/apply.tftest.hcl`, `tests/boundary.tftest.hcl`, `tests/named.tftest.hcl`, `tests/by_id.tftest.hcl` e `tests/prices.tftest.hcl`) usam provider simulado, com `zone_name = "example.com"`. O CI roda `fmt`, `validate`, `terraform test`, `tflint` e `trivy config` neste diretório (`infra/tools/tf_checks.sh`). O `terraform test` não enxerga `lifecycle` nem recurso que não foi declarado: o `prevent_destroy` dos buckets e do provedor OIDC é conferido por leitura. Para os papéis `apply`, o limite e a política de escrita, isso fica com `infra/tools/tests/test_bootstrap_apply_roles.py`, que o CI roda com os testes do `plan-guard`: ele confere o `prevent_destroy` dos três (papéis, limite e política de escrita) e do papel `prices`, a paridade do nome do bucket do site entre `infra/envs/*/main.tf` e `named.tf`, e compara os recursos de IAM do diretório com um inventário fechado. Política inline, política gerenciada, anexo ou papel novo reprova até entrar no inventário de propósito. O conteúdo das políticas dos papéis `apply` é travado por igualdade em `tests/apply.tftest.hcl`, o do limite e da negação de dado em `tests/boundary.tftest.hcl`, e o da política de escrita em `tests/named.tftest.hcl`: igualdade da lista, o teto de 6.144 caracteres, escopo por ambiente (com sondas do outro ambiente), bucket de estado fora, `PassRole` e `AddPermission` com condição, e nenhuma ação de dado, de exclusão ou já negada. `tests/by_id.tftest.hcl` faz o mesmo para a política por ID: igualdade da lista, os tetos por política e por papel (6.144 caracteres por gerenciada, 10.240 de inline, duas gerenciadas anexadas das 10 possíveis), a tag do próprio ambiente em toda escrita, nomes de registro DNS de um ambiente recusados pelo outro (sondas), nomes de certificado de um ambiente recusados pelo outro, nenhuma ação de usuário do Cognito, e o domínio inválido recusado. O teste Python também confere que toda ação das duas políticas de escrita está na tabela deste README, pelo nome `serviço:Ação`, e que todo recurso de IAM tem linha na tabela de import. É assim que o critério "sem `AdministratorAccess`" e o "único `Allow`" são verificados.

`.terraform.lock.hcl` é versionado, com os hashes `h1:` de linux_amd64, linux_arm64 e darwin_arm64.
