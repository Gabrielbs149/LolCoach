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

### 2. Mostrar as lineups do LADO em que ele está jogando
Hoje ele troca Atacante/Defensor na mão. Durante a partida isso é metade do que ele vê
sem serventia.
**Medido no cliente ao vivo, em partida:** a presença NÃO tem o lado. Tem o placar
(`partyOwnerMatchScoreAllyTeam` / `EnemyTeam`) e o estado, mais nada.
O caminho que sobra: o `core-game` — que desde a 2.28.281 é baixado UMA vez por partida —
traz `Players[].TeamID` ("Blue"/"Red"), e o número de rodadas sai do placar. Blue ataca
nas 12 primeiras; depois troca. **Cuidado com a prorrogação**, onde a troca muda de regra,
e com Deathmatch/Escalada, que não têm lado. Só mexer com os dois medidos de verdade numa
partida que chegue lá — senão é adivinhação, e adivinhar lado é pior que não mostrar.

### 2b. ~~Websocket no lugar da espiada de 6 s~~ — MEDIDO E DESCARTADO
Depois do cache do agente (2.28.281) a volta do laço custa 50 ms. O websocket economizaria
0,8% e traria reconexão, autenticação e um estado a mais pra manter. Não vale.

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

### 7. O teto do ponto de saída é DO AGENTE, não do parser
Medido no acervo dele, por agente (só os com 40+ lineups):

| agente | lineups | com lugar | alvo exato | com lado |
|---|---|---|---|---|
| Brimstone | 1.782 | **65%** | 31% | 36% |
| KAY/O | 1.601 | 33% | 56% | 30% |
| Chamber | 102 | 22% | 24% | 26% |
| Fade | 4.125 | **20%** | 64% | 57% |
| Sova | 196 | 17% | 56% | 68% |
| Killjoy | 186 | 10% | 47% | 39% |
| Sage | 247 | **2%** | 46% | 45% |

O padrão não é do app, é de como o criador nomeia o capítulo. Molly e smoke de Brimstone
se jogam de um tijolo específico, então o nome diz de onde ("A Site from A Lobby") — 65%.
Recon de Fade e Sova nomeia o ALVO ("A Site Haunt 03"), então o alvo é exato (64%) e a
origem quase nunca aparece (20%). Parede de Sage se põe onde você está: 2%.

**Consequência prática:** quando ele joga Brimstone o mapa é ótimo; quando joga Fade — que
é o main dele — é justamente o pior caso, e é por isso que ele sentiu "ponto aleatório".
Marcar com M (2.28.274) rende muito mais em Fade que em Brimstone. Não há conserto de
parser aqui: o dado não existe no nome.

**E até a 2.28.285 a saída também estava quebrada**: a marca dele era desenhada em média a
7,5 m de onde ele clicou, e o alvo não tinha nem botão pra mudar em 51,6% do acervo. Ou
seja, o único caminho que restava pro main dele não entregava. Agora entrega — e o próximo
passo natural deste item é medir quantas lineups de Fade ele marca por sessão, pra saber se
o caminho manual dá conta ou se precisa de outra ideia.

## Feito

- **2.28.287** — fechada a conta da .285: marcador/pino marcado a mão não se move, mas
  também não esconde ninguém. Alvos marcados que se cobrem viram um pino só; marcador
  tapado vai pra tira com um **+N** em quem fica; pino deduzido sai de baixo de marcador
  fixo. Medido: **586 clicáveis em 4 combinações, 15 sem clique → 0**.

- **2.28.286** — apagar a marca devolve o que o vídeo dizia (1.253 lineups tinham ponto de
  saída deduzido que sumia do mapa; 2.124 tinham alvo exato que virava "aproximado"). Mais
  dois negativos registrados em `melhorias.md`: repetir o ponto anterior por tecla (só 5 de
  190 pares das marcas dele ficam a menos de 2 m) e o falso alarme das 8.987 linhas de
  `latest.yml` no registro (estouro já consertado; 8.957 são do mesmo segundo de 17/10).

- **2.28.285** — o ponto marcado a mão parou de ser empurrado pelo desenho (arrasto de
  **7,5 m em média e 16,6 m no pior caso → 0 m**, medido nas 20 marcas dele em Lotus/Fade),
  e o controle de **mudar onde a habilidade cai** passou a existir em todas as lineups —
  faltava em **2.124 das 4.120** do acervo (51,6%), as de alvo exato lido do callout.
  Duas marcas no mesmo ponto ficam as duas lá, porque ele avisou que pode precisar pôr uma
  lineup em cima da outra. Guardado por teste que puxa a função de dentro da tela
  (`scripts/pegar-funcao.mjs`) — conferido que o teste REPROVA a versão com o defeito.

- **2.28.283** — +60 lineups com lado dito; a armadilha do "defender" (que o conserto óbvio
  teria criado) travada em teste; `rush`, `plant` e `push` descartados por não decidirem.

- **2.28.282** — a migração passou a alcançar as 23 buscas antigas sem `pedido`, lendo os
  parâmetros do nome do arquivo; e o `remontarIndice` parou de escrever lado torto no
  índice. Provado contra os 72 nomes reais: 72 de 72 fecham o círculo.

- **2.28.281** — o laço do Valorant em partida caiu de 500 ms pra 50 ms (o agente não muda
  no meio do jogo e era perguntado de 6 em 6 s), e o acervo passou a se atualizar sozinho
  em segundo plano, parando na hora se ele entrar em jogo.

- **2.28.280** — "fiz essa e funcionou" (tecla C): a única informação do acervo que não saiu
  de um vídeo. Verde no mapa, 40 de nota, contada no resumo, e sobrevive a tudo.
  Dirigir o Valorant fica fora de propósito: input sintético é o que o Vanguard bane.

- **2.28.279** — o mapa de lineups passou a usar a janela inteira da segunda tela: 760 → 812 px,
  e parou de encolher quando um ponto é aberto.

- **2.28.278** — os 3 últimos `JSON.parse` sem guarda (o pior deles no diagnóstico, que
  morria justo quando servia) e o laço do Valorant recuando pra 30 s com o jogo fechado.

- **2.28.277** — a trava da instalação passou a ver a fila do Valorant (o `partyState`, que
  o `sessionLoopState` não conta), e o estado lido fica guardado em `estado.valorant`.
  Achado porque a MINHA conferência lia um campo inexistente a noite toda.

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
