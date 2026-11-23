output "function_names" {
  description = "Nome de cada função, por chave (api, llm-proxy). Para o deploy, os alarmes e as permissões do API Gateway."
  value       = { for k, f in aws_lambda_function.this : k => f.function_name }
}

output "function_invoke_arns" {
  description = "ARN de invocação de cada função, para as integrações do API Gateway."
  value       = { for k, f in aws_lambda_function.this : k => f.invoke_arn }
}

output "role_names" {
  description = "Nome do papel de cada função. O do llm-proxy é o alvo da ação de corte do Budgets."
  value       = { for k, r in aws_iam_role.this : k => r.name }
}

output "api_key_parameter_name" {
  description = "Nome do parâmetro da chave da Claude API. Só o nome: o valor nunca passa pelo Terraform."
  value       = aws_ssm_parameter.anthropic_api_key.name
}
