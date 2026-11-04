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

### A. Terminar de separar o app em dois (pedido dele: "2 app em 1")
Feito nesta rodada: o seletor LoL/Valorant, a barra trocando inteira, o rodapé falando do
jogo do modo, abrir no jogo que está rodando, e a tela de Partidas do Valorant.
Falta, em ordem:
1. ~~Notas de atualização do Valorant~~ — **FEITA**, mesmo cano do LoL com `jogo: 'val'`.
2. ~~Cruzar as partidas com as marcas~~ — **FEITA.** Medido antes: das 176 marcas, 100%
   casam com um mapa só (zero ambígua, zero órfã), então a contagem não erra.
3. Composição inimiga (item 3) — perguntar antes, ver lá.
Não fazer sem ele pedir: trocar o tema inteiro de cor por modo. Mexer em `--ouro` no modo
Valorant atropelaria o tema que ele edita no modo edição (admin), que grava no `:root`.

### 0b. Clipes do Outplayed — TIRADOS do app (2.28.298)
Entraram na 2.28.297 e saíram na 2.28.298, a pedido dele: "falei pra tirar o player do
vídeo meu". O código está no commit 339afbd e no ramo `clipes-outplayed`. **Não reinstalar
sem ele pedir** — o que ele queria era achar a lineup DENTRO do vídeo (item 0), e um player
que ele não pediu só ocupa tela.


### 0. ~~Achar a lineup dentro do vídeo da partida dele~~ — NÃO FAZER
Ele pediu e eu disse que não dou conta sozinho; ele respondeu "se n consegue sozinho
esquece". **Medido: das 61 confirmações dele, nenhuma cai dentro do vídeo gravado** — ele
aperta o C navegando no app, não jogando. Sem esse carimbo de hora, achar a lineup exigiria
reconhecer na imagem o uso da habilidade E ler a posição no minimapa pra saber qual das 92
lineups era. **Só reabrir com âncora de verdade:** uma tecla apertada DENTRO da partida ou
o jogo expondo o uso de habilidade com hora.


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

**MEDIDO EM 04/11, E ISTO MUDA O QUE ACOMPANHAR AQUI.** A marcação dele foi de 149 pra 176
e o número do acervo **não se mexeu um dígito**: 32,3% de saída, 49,6% de alvo, 47,1% de
lado — idênticos aos de 02/11. Não é estagnação: é que este número mede o que o PARSER
deixou no disco, e a marcação dele entra na LEITURA (`comMeusPontos`), não no arquivo.
Com as marcas por cima são 33,9% (+72 de saída, +20 de alvo). Ou seja: **por mais que ele
marque, o 32,3% nunca sobe.** Acompanhar esse número como se fosse progresso dele é
perseguir algo que não pode andar.

O número honesto é o do pedaço que ele USA — Fade nos 8 mapas que ele de fato jogou:
**1.250 lineups, 335 (26,8%) dizem de onde se joga, 793 (63,4%) têm alvo exato, e 281
(22,5%) estão COMPLETAS** (as duas pontas, fora as 25 jogadas fora). É este que sobe quando
ele marca, e é este que o cartão "onde marcar rende" (2.28.303) manda ele empurrar.
Dentro do que ele usa, o alvo exato é bem melhor que a média (63,4% contra 49,6%) e a saída
é pior (26,8% contra 32,3%) — o gargalo dele é "de onde se joga", não "onde cai".

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

**MEDIDO NO CAMPO (03/11, ele em partida na Corrode, competitiva).** O que o `core-game`
entrega, conferido e não suposto:
- `/core-game/v1/matches/{id}`: `State: IN_PROGRESS`, `MapID: /Game/Maps/Rook/Rook`,
  `ModeID: /Game/GameModes/Bomb/BombGameMode.BombGameMode_C`, `MatchmakingData.QueueID:
  competitive`, `IsRanked: true`. O `ModeID` é o que diz se lado existe — Deathmatch e
  Escalada se descartam por ali, sem lista de filas pra manter à mão.
- `Players[]` traz os 10, cada um com `Subject`, `TeamID` ("Blue"/"Red"), `TeamNumber`,
  `CharacterID`, `IsCoach`. Ele estava em **Red**. Zero coach na lista.
- **ARMADILHA, e séria: o agente dele apareceu nos DOIS times.** Fade
  (`dade69b4-…-e58d267f4e95`) estava em Blue e em Red na mesma partida. Achar o time dele
  pelo `CharacterID` daria o time ERRADO em qualquer partida de agente popular — e era o
  atalho óbvio. Só `Subject === puuid` serve.
- Round: `ally 7 + enemy 4 = 11` rodadas feitas, round 12. A conta é `ally + enemy + 1`.

**O que ainda falta é só isto:** o `core-game` NÃO diz quem ataca — nenhum campo do payload
tem lado. Então lado = f(TeamID, round), e a convenção "Blue ataca no primeiro tempo"
continua sendo leitura minha, não medição. **Não shippar sem gabarito.** O gabarito é
barato: no detalhe da partida (depois dela), `roundResults[0].bombPlanter` é um puuid, e o
time dele era o atacante do round 1. Uma partida fecha a convenção; duas dão a prorrogação.

### 2b. ~~Websocket no lugar da espiada de 6 s~~ — MEDIDO E DESCARTADO
Depois do cache do agente (2.28.281) a volta do laço custa 50 ms. O websocket economizaria
0,8% e traria reconexão, autenticação e um estado a mais pra manter. Não vale.

### 3. Composição inimiga a partir do `core-game` que já é baixado
**Já não depende de mais nada: medido no campo em 03/11** (ver item 2). O `core-game`
devolve os 10 jogadores com `TeamID` e `CharacterID`, e o app usa só o `CharacterID` dele —
os outros nove são baixados e jogados no lixo a cada partida. O time dele sai do `Subject`,
os inimigos são os do outro `TeamID`, e o nome de cada agente já está no catálogo local.
Sem adivinhação em nenhum passo.
**O que falta decidir é se vale a tela**, não se dá: o que mais pesa pra lineup é o mapa e o
agente DELE, que ele já vê. Perguntar antes de construir.

### 4. Varrer o registro do app atrás de mais padrão
**Quarta varredura feita (03/11, 6.460 linhas em 18 dias).** Achou uma coisa e descartou
outra, as duas medidas:
- **FEITO:** o aviso "não achei o minimapa (jogo em tela cheia exclusiva?)" saía 14 vezes,
  todas entre 12,8 s e 28,4 s do início da captura, e em 13 delas o olho achava o minimapa
  logo depois. Virou guarda de 120 s (`devoAvisarSemMinimapa` em `src/vivo/olho.js`).
- **NEGATIVO:** os 42,8% de registro ocupados por "procurando atualização…" + o erro de
  `latest.yml` são de UM dia (17/10, 25 erros por minuto), que as varreduras .271/.272 já
  resolveram. Em novembro são 1x isolado por publicação — propagação do CDN, não defeito.
- **NEGATIVO:** afrouxar o limiar do minimapa não converteria falha nenhuma. Quem acha
  pontua 0,52–0,65 (37 medições) e quem falha chega no máximo a 0,29. Não são quase-acertos.

Três varreduras anteriores (2.28.271, .272, .273). As duas primeiras tiraram 85% do
registro, que eram duas mensagens de uma release quebrada. A terceira foi **medida e descartada**:
dar chave por formato ao guarda (números viram N) daria 0,1% a mais, e as ~917 linhas do
olho são ~50 por dia — diagnóstico, não enchente. Vale repetir de tempos em tempos: é o
único lugar com dado do uso REAL dele.

### 5. ~~Continuar medindo o custo do painel durante a partida~~ — FECHADO
A varredura de minuto já foi (2.28.273: 446 ms → 0). O `tick()` de 2 s foi **medido e
descartado**: 17 ms e uma ida à API, 0,85% do tempo. **O pedaço que faltava foi medido em
02/11 e também não dá nada**: com o clipe de fato tocando e o pino mais cheio do acervo
aberto (A Site do Lotus, 27 lineups), `lnDesenharMapa` custa **1,83 ms**, `lnPintarLado`
**0,35 ms**, e do clique até o quadro pronto são **4,9 ms** — contra 16,7 ms de orçamento
por quadro, e só em clique, não a cada quadro. Confirmado que o mapa grande fica mesmo
`display:none` em tela cheia. **Não há mais o que medir aqui sem dado novo.**

### 6. O parser de nome chegou no teto
Medido: 38% dos alvos caem no centro do site, e 1.119 deles têm "from" e 641 têm
"default" — o capítulo diz mesmo só "A site".

**O lado também chegou no teto, e agora com gabarito (02/11).** Das 38 lineups em que ele
disse o lado à mão, o parser ficou calado em 9 e **acertou as outras 29, sem errar
nenhuma**. As 9 que faltam têm nome que só dá LUGAR ("A Garden", "A Long 1"), e inferir
lado pelo lugar é chute — defensor segura A Long, atacante entra no A Garden.
**NÃO MEXER em `PISTAS_DE_LADO` sem gabarito novo:** a precisão está em 100% e toda regra
nova é risco de trocar o lado de lineup que hoje está certa.
Segunda medição com 64 lados ditos por ele: **55 de 55, ainda zero erro**, e as 9 que o
parser não vê são **as mesmas 9** da primeira amostra. Duas amostras independentes
dizendo a mesma coisa. Daqui pra frente quem fecha a conta é ele
marcando (ficou rápido na 2.28.274). Só vale voltar ao parser com dado novo.

**Agora há gabarito (02/11).** As 26 marcas dele medidas contra o que o parser deduziu:
de onde se joga, **15 das 22 deduzidas caem no mesmo callout que ele (68%)**, erro mediano
**6,2 m**; onde a habilidade cai, só **2 de 8 (25%)**, erro mediano **9,5 m**. Lido junto
com o item 7: o parser acerta a ÁREA e o que a marca acrescenta é o tijolo. Confirma que o
caminho é marcar, não parsear. O detalhe do lugar escrito com barra (`A Site/Main`, 277
lineups) foi medido e **descartado** — o porquê está em `melhorias.md`.

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

- **2.28.300** — mapa cortado na borda: o pino que ELE marcou ficava metade pra fora porque
  a caixa saía só dos callouts e o ponto marcado à mão pula o `lnPrender` desde a .285.
  Agora a caixa cresce pra caber a marca inteira. **0 cortados em 52 estados.**
  Cuidado futuro: a caixa sai de `lnTodas`, não de `lnAchadas` — senão muda com o filtro.

- **2.28.296** — passar o mouse num pino espia o leque dele no mapa FECHADO (a 2.28.294 só
  funcionava dentro de leque já aberto, que não é o caso dele). 3,76 ms por pino.

- **2.28.295** — setas e Delete continuam funcionando quando a lineup aberta sai da lista
  (dizer o lado contrário ao filtro tirava ela e matava as teclas, calado).

- **2.28.294** — passar o mouse numa lineup apaga o mapa inteiro menos ela (os PINOS também,
  que era o que faltava) e a rota em foco fica branca; mais botões e teclas **A**/**D** pra
  ele dizer se é ataque ou defesa, que resolve as 53,5% do acervo sem lado dito.
  De quebra, achado que o apagar das rotas **nunca funcionou**: `<mpath>` da SMIL apontando
  pra linha trava a transição CSS de opacidade no Chromium.

- **2.28.293** — o mapinha parou de mostrar margem preta da arte: o recorte agora é preso na
  parte JOGÁVEL (caixa dos callouts), não na borda do PNG. Medido em 1.354 lineups:
  mediana 5% → 0% de preto, e com mais de 15% de preto **331 → 4**.
  **Lição: procurei "elemento fora do lugar" em quatro estados e não achei; o defeito só
  apareceu quando medi a coisa certa (quanto do mapinha era margem preta).**

- **2.28.292** — ✕ no marcador e tecla Delete pra tirar UMA lineup do mapa (antes só dava
  pra tirar o vídeo inteiro), com coluna "na lixeira" pra trazer de volta.

- **2.28.291** — o filtro da .290 refeito em colunas depois de ele dizer que não conseguiu
  usar. Barra própria com cinco colunas iguais, "todas" entre elas pra desligar à vista.
  **Regra daqui pra frente: controle novo ganha lugar próprio, não entra como mais um
  `· botão` no meio da frase do resumo.**

- **2.28.290** — filtro "mexi nelas / prontas / fiz e funcionou / falta mexer" no resumo,
  valendo também no mapa. "Pronta" = os dois pontos marcados à mão (medido: zero das 30
  marcas dele tem os dois MAIS a confirmação, então exigir as três deixaria o filtro vazio).
  De quebra, consertado o beco sem saída de trocar de mapa com o filtro ligado.

- **Clipes do Outplayed — engavetado no ramo `clipes-outplayed`.** Medido: o Outplayed grava
  Valorant como destaque (1.066 clipes, mediana 14 s, 8–13% de cada partida), não partida
  inteira. Ele viu os números e disse "esquece, só com esses clipes vai ser impossível".
  Código pronto e testado no ramo; volta com `git merge clipes-outplayed` se a gravação de
  partida inteira do Valorant for ligada no Outplayed. **Não reabrir sem esse dado novo.**

- **2.28.289** — o mapa de marcar cresce enquanto ele marca: 226 → 536 px, nomes de canto
  sobrepostos **16 → 1**, precisão do segundo clique de ~10 cm pra 4 cm por pixel.

- **2.28.288** — a pedido dele, o corte pra juntar alvos marcados passou de meio pino pro
  círculo inteiro: se os dois desenhos se encostam na tela, viram um pino só. Vale só pro
  ponto onde a habilidade CAI; as origens seguem separadas, cada uma no seu tijolo.

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
