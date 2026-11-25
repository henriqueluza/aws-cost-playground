output "topic_arn" {
  description = "ARN do tópico SNS dos alarmes, para conferir a confirmação da assinatura por e-mail."
  value       = aws_sns_topic.this.arn
}
