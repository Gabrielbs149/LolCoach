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

### 1. Só 30,2% das lineups dizem de onde se joga (era 27,5% ontem)
Medido no acervo inteiro (8686 lineups): 2623 com ponto de saída. É o teto de tudo que ele
pediu — enquanto não subir, o mapa não tem o que desenhar.
Já lidos: `X from Y`, `X → Y`, `X (de Y)`, `CT`/`T spawn`, carimbo de canal, `from Spawn`
pelo lado, plural, e os apelidos heaven/cat/backsite/showers/defender side.
**O que sobra é mais difícil**: das ~6060 sem lugar, ~5300 nem se partem (o nome não cita
dois lugares, e aí não há o que ler). Das que se partem, o que falha agora é gíria de UM
mapa só — "Lab" e "Market" no Bind, "A Yellow" no Breeze, "B Lane", "Tiles" no Ascent,
"B Hookah" no Bind, "B Quad" no Sunset. Cada uma vale 4 a 12 lineups, e cada uma exige
saber o lugar de verdade naquele mapa. Próximo passo possível: medir se a arte do mapa
dá pra conferir (o callout mais perto do ponto que o nome sugere), ou aceitar que daqui
pra frente quem fecha a conta é ele marcando no mapa — que já funciona desde a 2.28.262.

### 2. Trocar a espiada de 6 s no Valorant pelo websocket do cliente local
**Depende do Valorant aberto pra conferir.** O estado do Valorant é lido de 6 em 6 s; o
cliente local tem websocket, que avisa na hora e gasta menos. Mexer sem o jogo rodando
seria publicar no escuro — e o jeito certo é manter a espiada como plano B e pôr o
websocket como caminho rápido, nunca trocar um pelo outro.

### 3. Composição inimiga a partir do `core-game` que já é baixado
**Depende do Valorant aberto pra conferir.** O dado já vem na resposta e é jogado fora.

### 4. Varrer o registro do app atrás de mais padrão
Três varreduras feitas (2.28.271, .272, .273). As duas primeiras tiraram 85% do registro,
que eram duas mensagens de uma release quebrada. A terceira foi **medida e descartada**:
dar chave por formato ao guarda (números viram N) daria 0,1% a mais, e as ~917 linhas do
olho são ~50 por dia — diagnóstico, não enchente. Vale repetir de tempos em tempos: é o
único lugar com dado do uso REAL dele.

### 5. Continuar medindo o custo do painel durante a partida
A varredura de minuto já foi (2.28.273: 446 ms → 0). O `tick()` de 2 s foi **medido e
descartado**: 17 ms e uma ida à API, 0,85% do tempo. Falta só o peso do desenho do mapa
de lineups com o clipe tocando — e o mapa grande já fica `display:none` em tela cheia,
então o provável é que também não sobre nada. Medir antes de mexer.

### 6. O parser de nome chegou no teto
Medido: 38% dos alvos caem no centro do site, e 1.119 deles têm "from" e 641 têm
"default" — o capítulo diz mesmo só "A site". Daqui pra frente quem fecha a conta é ele
marcando (ficou rápido na 2.28.274). Só vale voltar ao parser com dado novo.

---

## Feito

- **2.28.276** — o laço do Valorant parou de perguntar o que já sabia: ordem dos endpoints
  pelo estado (~800 pedidos a menos por partida), região/shard guardados, e recuo de 5 min
  quando a versão do cliente não responde.

- **2.28.275** — o corretor ganhou id repetido (e achou um real: `#evolucao` duas vezes,
  mandando a tabela de temporadas pra aba errada), o passeio ganhou o modo `lento`, e
  agora existe um teste que prova que cada verificação do corretor dispara mesmo.

- **2.28.274** — M marca de onde sai, N marca onde cai, ← → pulam pela lista do mesmo
  ponto sem fechar o clipe. Marcar deixou de ser ida e volta pro mapa.

- **2.28.273** — a varredura de minuto do painel só mexe na aba aberta: 446 ms, 2.062 nós
  de DOM e 4 idas à API por minuto viraram 0 enquanto ele está nas Lineups.

- **2.28.272** — guarda contra enchente no registro (limite por mensagem, não por linha
  repetida seguida — elas se alternavam). Medido no registro real: 79% a menos de linha,
  4,8× mais história nos mesmos 2 MB.

- **2.28.271** — a atualização parou de bater no GitHub em rajada: uma corrente só, espera
  que dobra até 30 min, e a mesma falha virando contagem. Achado no registro dele, onde
  43% das linhas eram a mesma mensagem.

- **2.28.270** — o passeio passou a visitar as quatro telas (inclusive as três que ficam
  abertas durante a partida) e a passear duas vezes, com `{erro}` e com `{}`. O modo `{}`
  achou mais três telas que quebravam: Calendário, Patch e Admin.

- **2.28.269** — passeio automático pelas telas (janela oculta do Electron, API respondendo
  erro) na trava 4 da publicação; achou 5 telas que quebravam sem rede + o `x.fmt` das
  Estatísticas, que escondia a tabela do elo e as tendências desde sempre.

- **2.28.268** — corretor de telas de 22 avisos pra 0 (quatro falsos positivos meus + ganchos
  de JS), e o aviso de @media virou erro quando a regra base vem DEPOIS da do @media.

- **2.28.267** — plural e apelido de lugar: +233 lugares, +50 alvos, 159 alvos que eram
  centro do site viraram exatos. 0 perdidos.

- **2.28.266** — +82 lugares lidos do nome (carimbo de canal, `from Spawn` pelo lado),
  0 perdidos. Acervo no formato 8.

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
