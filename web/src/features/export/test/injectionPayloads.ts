/** Cargas de injeção usadas nos testes do export. Cada uma tenta sair do literal ou do comentário. */
export const INJECTION_PAYLOADS: readonly (readonly [string, string])[] = [
  ['fecha o bloco e abre um recurso', '"}\nresource "aws_iam_user" "x" {'],
  ['interpolação', '${file("/etc/passwd")}'],
  ['interpolação já escapada', '$${file("/etc/passwd")} $$${a}'],
  ['diretiva de template', '%{ for x in [1] }${x}%{ endfor }'],
  ['fim de comentário de bloco', '*/ resource "aws_iam_user" "y" {} /*'],
  ['barra invertida no fim', 'fim\\'],
  ['aspas escapadas', '\\" = "x"'],
  ['quebras de linha de todo tipo', 'a\r\nb\rc\u2028d\u2029e\u0085f\vg\fh'],
  ['nulo e controle', 'a\u0000b\u001bc\u007fd'],
  ['bidi e largura zero', 'a\u202eb\u2066c\u200bd\ufeffe'],
  ['formato fora do plano básico', 'a\u{e0001}b'],
  ['surrogate solto', 'a\ud800b\udc00c'],
  ['emoji', '🚀 fila 👩‍💻 ação'],
  ['heredoc', '<<EOT\nresource "x" "y" {}\nEOT'],
  ['comentário de linha', '# x\n// y'],
  ['10 mil caracteres', '"${'.repeat(2500) + 'x'.repeat(2500)],
];
