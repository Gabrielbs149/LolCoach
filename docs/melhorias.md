# Melhorias (loop automático)

Uma linha por rodada: versão, o que mudou, como foi testado.

- v2.28.4 — Overlay: linha do jungler deles no topo (onde foi visto, há quanto tempo; destaca quando está no nosso lado ou sumido há 20 s+). Testado: sintaxe do script; aparece só em partida.
- v2.28.5 — Gravação completa da partida pra aprendizado: `falas.jsonl` (tudo que a voz disse), `estado.jsonl` (placar/itens/níveis a cada 5 s), pasta criada na primeira leitura da API. Janela ao vivo: linha do jungler deles. Olho: avisa no registro quando fica cego 15 s (outra janela na frente). Testado: sintaxe.
- v2.28.6 — Waves por lane (pontinhos de minion no minimapa, ignorando ícones): frente de cada lane gravada em `leituras.jsonl` e situações `wave-<lane>-nosso/deles` (só registro por enquanto — precisa validar com partida real antes de falar). Testado: amostra real do minimapa (10 ms por leitura, a cada 10 quadros).
