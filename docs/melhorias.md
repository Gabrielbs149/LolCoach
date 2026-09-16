# Melhorias (loop automático)

Uma linha por rodada: versão, o que mudou, como foi testado.

- v2.28.4 — Overlay: linha do jungler deles no topo (onde foi visto, há quanto tempo; destaca quando está no nosso lado ou sumido há 20 s+). Testado: sintaxe do script; aparece só em partida.
- v2.28.5 — Gravação completa da partida pra aprendizado: `falas.jsonl` (tudo que a voz disse), `estado.jsonl` (placar/itens/níveis a cada 5 s), pasta criada na primeira leitura da API. Janela ao vivo: linha do jungler deles. Olho: avisa no registro quando fica cego 15 s (outra janela na frente). Testado: sintaxe.
- v2.28.6 — Waves por lane (pontinhos de minion no minimapa, ignorando ícones): frente de cada lane gravada em `leituras.jsonl` e situações `wave-<lane>-nosso/deles` (só registro por enquanto — precisa validar com partida real antes de falar). Testado: amostra real do minimapa (10 ms por leitura, a cada 10 quadros).
- v2.28.7 — Admin → "Situações da partida": lista as partidas gravadas, mostra cada situação (tempo, texto, prioridade, falada ou não) com 👍/👎 salvos em `avaliacoes.jsonl` — o rótulo pra aprender o que vale falar. Testado: rotas e tela (sem partidas ainda).
- v2.28.8 — Situações novas: "Dragão/Barão livre: jungler deles morto por N s / a N s do pit"; timers dos camps deles (viu o jungler no camp → "raptors deles nascem em 20 s", falado só pra quem é jungle; posições dos camps aproximadas). Testado: simulação.
- v2.28.9 — Janela ao vivo: seção "Minimapa" com as últimas 10 situações (as não faladas em cinza). Overlay: "N sumidos" ao lado de Inimigos quando 2+ estão sem ser vistos há 15 s. Testado: sintaxe.
- v2.28.10 — Admin → Situações → "Resumo por tipo": tabela com quantas vezes cada situação aconteceu em todas as partidas gravadas, quantas foram faladas e os 👍/👎 — a primeira visão pra decidir o que falar. Testado: sintaxe.
- v2.28.11 — Modo divertido: variantes pras 12 situações principais do minimapa (jungler começou/vindo/em cima/indo/sumido, dive, roam, furtivo, invade, perigo perto, flanco, seu jungler). Testado: sintaxe.
- v2.28.12 — Olho: ritmo adaptável (quadro pesado → espera até 250 ms; leve → volta a 100 ms) pra não pesar no FPS do jogo. Testado: sintaxe.
- v2.28.13 — Fim de partida: linha no registro com o resumo do olho (leituras, situações, quantas faladas, tipos mais comuns). Testado: sintaxe.
- v2.28.14 — Previsão do primeiro gank: pelo lado onde o jungler deles começou, avisa a lane oposta ("deve aparecer no bot entre 3:10 e 3:40") e lembra na hora se ele ainda não apareceu. Menos ruído: sem "lado livre" antes de 3:00 e sem repetir a região na primeira aparição. Testado: simulação.
- v2.28.15 — `npm test` (scripts/testar-voz.mjs): objetivos, falas da API (time pelo nome, sem enfeite), lugares do mapa, situações (início do jungler, previsão de gank, distância em segundos), pronúncia (tempo) e catálogo. Roda antes de cada publicação daqui pra frente.
- v2.28.16 — Situação "zona onde você morre muito": pega do banco (últimas 60 partidas na sua rota) quantas mortes por jogo em cada zona; se você entra numa zona com 0,5+ mortes/jogo, fora da sua lane e com o jungler deles sumido, avisa (uma vez a cada 4 min). Testado: npm test.
- v2.28.17 — Aprendizado v0: tipo de situação com 3+ 👎 e nenhum 👍 nas suas avaliações deixa de ser falado (continua gravado); aparece como "silenciada" no Resumo por tipo. Testado: npm test.
- v2.28.18 — Voz: fala urgente (prioridade 3 — "Recua!", "Dive vindo", "Eles no Barão") fura a fila e corta o que está tocando. Testado: sintaxe.
- v2.28.19 — "Jungler deles nasce em N segundos" (respawn pela API) — janela pra sair da jungle dele/terminar o objetivo. Testado: npm test.
- v2.28.20 — Quadro do objetivo um minuto antes, numa frase: "Dragão em um minuto: jungler deles no rio do dragão, 2 deles perto do pit, seu jungler a 17 segundos." Testado: simulação + npm test.
