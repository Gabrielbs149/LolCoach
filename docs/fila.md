# Fila — o que fazer no LolCoach, em ordem

Esta é a memória do modo contínuo. Cada rodada: pega o primeiro item **aberto**, faz,
testa, publica, marca como feito aqui e passa pro próximo. O arquivo fica no repositório
de propósito — se a sessão cair, se o limite de uso estourar, se o contexto encher, a
próxima rodada lê daqui e continua de onde parou, sem precisar redescobrir nada.

Regras que valem pra toda rodada:
- nunca mexer em janela com jogo aberto; conferir `/api/estado` antes de atualizar o app;
- nunca `node -e` pra remendar código — sempre por arquivo, com `conferir-sintaxe` antes;
- nunca vazar chave (`config.json`, `chave-embutida.json`) nem puuid/nome de amigo;
- toda mudança de tela passa por `scripts/conferir-tela.mjs` e pelo navegador com
  `scripts/tela-dev.mjs` (tela do projeto + dados vivos do app, sem reinstalar);
- uma melhoria por rodada, registrada em `docs/melhorias.md`.

---

## Aberto

### 1. Só 7% das lineups dizem de onde se joga
Medido no acervo: no mapa inteiro, 97 lineups e **7** com ponto de saída conhecido. O
resto só diz onde cai. É o teto de tudo que ele pediu ("quero o ponto da jogada da
habilidade preciso") — enquanto for 7%, o mapa não tem o que desenhar.
Próximo passo: separar os nomes de capítulo das 90 sem lugar e procurar o padrão que
ainda não é lido (já leem: `X from Y`, `X → Y`, `X (de Y)`, `CT`/`T spawn`). Suspeitas:
"behind X", "on top of X", "X side", nome de canto sem preposição nenhuma.
Medir antes de mexer: quantas cada padrão novo recupera, e quantas ele estraga.

### 2. 22 avisos do corretor de telas
Classes usadas em markup que não têm regra de CSS nenhuma — cada uma é um elemento que
aparece sem estilo. Ver uma a uma: ou ganha CSS, ou o markup para de pedir.
`node scripts/conferir-tela.mjs`

### 3. Passeio automático pelas telas na trava da publicação
O corretor lê o arquivo, mas não EXECUTA a tela. Falta um teste que abra o painel com
dados de mentira, passe por todas as abas e falhe se o console reclamar. É o que pegaria
erro de execução que nenhuma leitura pega.

### 4. O mesmo tratamento em olho.html e vivo.html
O painel levou corretor, limpeza de CSS morto e conferência no navegador. As outras três
telas só passaram pelo corretor.

### 5. Trocar a espiada de 6 s no Valorant pelo websocket do cliente local
Hoje o estado do Valorant é lido de 6 em 6 segundos. O cliente local tem websocket, que
avisa na hora e gasta menos.

### 6. Composição inimiga a partir do `core-game` que já é baixado
O dado já vem na resposta e é jogado fora.

---

## Feito

- **2.28.265** — o ponto que diz 35 entrega 35 (corte de 12 vinha antes de saber quem tem
  lugar), a tira parou de nascer abaixo da dobra, e foi pro lado do mapa.
- **2.28.265** — `scripts/conferir-tela.mjs`: corretor de telas, na trava da publicação.
  Achou de cara 28 usos de variável de CSS que não existe (canto quadrado e texto sem cor
  na tela de lineups inteira), 2 pares de regra brigando por ordem de arquivo, e 91
  regras mortas de duas gerações anteriores da tela.
- **2.28.265** — `scripts/tela-dev.mjs`: tela do projeto com os dados vivos do app.
- **2.28.264** — o voltar da lineup foi pro canto de cima à esquerda.
- **2.28.263** — o clipe parou de voltar no meio da jogada.
- **2.28.262** — os pontos do mapa pararam de ser palpite; ele marca o ponto exato.
- **2.28.261** — o mapa do Valorant parou de ser adivinhado pela tabela à mão.
