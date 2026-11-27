# Formato do claim `sub` nos trusts dos papéis de CI (#366). Só provider simulado: sem credenciais nem AWS.
# O repositório emite o formato imutável, `repo:<dono>@<id>/<repo>@<id>:<contexto>`, conferido com token
# real em 27/11/2026. Os asserts de igualdade de cada papel ficam em bootstrap/apply/prices.tftest.hcl;
# aqui ficam o prefixo, a forma da condição e os `sub` que NÃO podem casar.
mock_provider "aws" {}

variables {
  zone_name = "example.com"
}

override_data {
  target = data.aws_caller_identity.current
  values = {
    account_id = "123456789012"
  }
}

run "prefixo_imutavel_do_repositorio" {
  command = apply

  assert {
    condition     = local.github_sub_prefix == "repo:henriqueluza@60079862/aws-cost-playground@1463554125"
    error_message = "O prefixo do sub é o imutável deste repositório: dono e repositório com os IDs numéricos."
  }

  assert {
    condition     = can(regex("^[1-9][0-9]*$", local.github_owner_id)) && can(regex("^[1-9][0-9]*$", local.github_repo_id))
    error_message = "Os IDs do dono e do repositório são números inteiros, sem espaço nem curinga."
  }
}

# Um trust por papel, uma instrução, só `StringEquals`, e o `sub` é uma string (não lista) sem curinga.
run "forma_das_condicoes" {
  command = apply

  assert {
    condition = alltrue([
      for policy in [
        aws_iam_role.plan.assume_role_policy,
        aws_iam_role.apply["staging"].assume_role_policy,
        aws_iam_role.apply["production"].assume_role_policy,
        aws_iam_role.prices.assume_role_policy,
      ] : length(jsondecode(policy).Statement) == 1 && keys(jsondecode(policy).Statement[0].Condition) == ["StringEquals"]
      && can(regex("^repo:henriqueluza@60079862/aws-cost-playground@1463554125:[a-z_:/]+$", jsondecode(policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"]))
      && jsondecode(policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
    ])
    error_message = "Cada trust tem uma instrução, só StringEquals, aud do STS e um único sub com o prefixo imutável, sem curinga."
  }
}

# Casos negativos: `sub` que um token de outro lugar traria. Nenhum pode ser o valor do trust.
run "plan_recusa_outros_sub" {
  command = apply

  assert {
    condition = !contains([
      "repo:henriqueluza/aws-cost-playground:pull_request",                            # formato antigo, sem IDs
      "repo:henriqueluza@60079862/outro-repo@1463554126:pull_request",                 # outro repositório do mesmo dono
      "repo:henriqueluza@60079862/aws-cost-playground@1463554126:pull_request",        # repositório recriado com o mesmo nome
      "repo:henriqueluza@99999999/aws-cost-playground@1463554125:pull_request",        # outro dono com o mesmo nome
      "repo:henriqueluza@60079862/aws-cost-playground@1463554125:ref:refs/heads/main", # branch, não PR
      "repo:henriqueluza@60079862/aws-cost-playground@1463554125:environment:staging",
    ], jsondecode(aws_iam_role.plan.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"])
    error_message = "O papel plan só aceita o pull_request deste repositório (mesmos IDs)."
  }
}

run "apply_recusa_outros_sub" {
  command = apply

  assert {
    condition = alltrue([
      for env, other in { staging = "production", production = "staging" } : !contains([
        "repo:henriqueluza/aws-cost-playground:environment:${env}",                       # formato antigo
        "repo:henriqueluza@60079862/aws-cost-playground@1463554125:pull_request",         # PR nunca aplica
        "repo:henriqueluza@60079862/aws-cost-playground@1463554125:ref:refs/heads/main",  # main sem environment
        "repo:henriqueluza@60079862/aws-cost-playground@1463554125:environment:${other}", # o outro ambiente
        "repo:henriqueluza@99999999/aws-cost-playground@1463554125:environment:${env}",   # outro dono com o mesmo nome
        "repo:henriqueluza@60079862/aws-cost-playground@1463554126:environment:${env}",   # outro repositório
      ], jsondecode(aws_iam_role.apply[env].assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"])
    ])
    error_message = "Cada papel apply só aceita o environment do próprio ambiente deste repositório (mesmos IDs)."
  }

  assert {
    condition = alltrue([
      for env in ["staging", "production"] :
      jsondecode(aws_iam_role.apply[env].assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:ref"] == "refs/heads/main"
    ])
    error_message = "O papel apply continua preso à branch main pelo claim ref."
  }
}

run "prices_recusa_outros_sub" {
  command = apply

  assert {
    condition = !contains([
      "repo:henriqueluza/aws-cost-playground:ref:refs/heads/main",                      # formato antigo
      "repo:henriqueluza@60079862/aws-cost-playground@1463554125:pull_request",         # PR não lê preço com o papel
      "repo:henriqueluza@60079862/aws-cost-playground@1463554125:ref:refs/heads/outra", # outro branch
      "repo:henriqueluza@60079862/aws-cost-playground@1463554125:environment:staging",
      "repo:henriqueluza@99999999/aws-cost-playground@1463554125:ref:refs/heads/main", # outro dono com o mesmo nome
      "repo:henriqueluza@60079862/aws-cost-playground@1463554126:ref:refs/heads/main", # outro repositório
    ], jsondecode(aws_iam_role.prices.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"])
    error_message = "O papel prices só aceita a branch main deste repositório (mesmos IDs)."
  }
}
