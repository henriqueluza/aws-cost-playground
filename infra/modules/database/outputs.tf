output "table_name" {
  description = "Nome da tabela, para a configuração das funções."
  value       = aws_dynamodb_table.this.name
}

output "table_arn" {
  description = "ARN da tabela, para as políticas IAM das funções."
  value       = aws_dynamodb_table.this.arn
}
