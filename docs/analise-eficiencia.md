# Análise de eficiência em partida real

Feita em 04/10/2026 sobre **13 partidas da versão atual** (30/09 em diante) mais o
histórico inteiro do banco. Tudo aqui é medido em cima do que o app gravou
(`falas.jsonl`, `leituras.jsonl`, `estado.jsonl`) cruzado com a linha do tempo da
Riot (mortes, objetivos, quedas de torre). Nada é opinião.

---

## O resumo

A corrente que explica quase todo o resto:

> **o olho vê o inimigo tarde → o aviso sai com ~3 s de antecedência → a frase levava
> 3,5 s pra ser falada → quase metade dos avisos terminava depois da morte.**

Ou seja: o app já sabia a coisa certa, e falava a coisa certa, mas o jogador morria
no meio da frase. Esse é o gargalo — não é falta de informação, é tempo de entrega.

**Corrigido na 2.28.211** (ordem na frente). Os outros dois problemas grandes
continuam abertos e estão descritos no fim.

---

## 1. O olho está no melhor momento dele

Acerto de posição conferido contra os `frames` da Riot:

| versão | aliados certos | você certo | precisão |
|---|---|---|---|
| quadrado (até 26/09) | 62% | 55% | 87% |
| **redondo (2.28.206)** | **22%** | **7%** | **68%** |
| atual (2.28.208+) | **66%** | **71%** | **91%** |

O ícone redondo foi uma regressão séria e já voltou atrás. O estado de hoje é melhor
do que antes dela em tudo. A aquisição a frio (achar um campeão que não estava sendo
seguido) continua em **27%** — quatro hipóteses pra explicar isso foram testadas e
descartadas.

## 2. O app fala demais

- **1737 falas em 13 partidas = 135 por partida = 5,7 por minuto.**
- Três módulos fazem 70%: **timers 27%, mapa 23%, jungler 20%**.
- O maior silêncio de uma partida inteira é de **50 a 77 segundos**. Nunca tem pausa.
- Tem rajada de **6 a 8 falas em 20 segundos**.
- Repetição pura: "Canhão nessa wave" sai **6 a 8 vezes por partida**.

Consequência medida: em janelas de 20 s sorteadas ao acaso, **58% já contêm uma frase
de perigo**. Quando o fundo é 58%, ouvir "perigo" não informa quase nada.

## 3. O que o app fala tem sinal — menos as kills

Comparando o que acontece depois de uma fala contra 400 janelas sorteadas por partida:

| assunto | acima do acaso |
|---|---|
| morrer sozinho | **+30 pontos** |
| objetivos (dragão/barão/arauto) | +18 a +28 pontos |
| morte | +18 pontos |
| **você matar alguém** | **+3 pontos (nenhum)** |

As falas de oportunidade de kill não preveem kill. As de perigo e de objetivo preveem.

## 4. Precisão dos avisos de perigo

428 avisos de perigo = **25% de tudo que o app fala**.

- **25% viram morte em 20 s** (37% em 45 s).
- **35% das mortes não tiveram aviso nenhum.**

Por módulo:

| módulo | avisos | vira morte |
|---|---|---|
| kills | 87 | **48%** |
| economia | 18 | 44% |
| jungler | 141 | 21% |
| **mapa** | **175** | **15%** |

**O módulo que mais fala é o menos certeiro.** Esse é o maior problema aberto.

## 5. O tempo — o achado principal

Antecedência entre o último aviso e a morte:

- **mediana: 3,8 s**
- **46% chegam com menos de 3 s**

E a voz fala ~14 caracteres por segundo. A frase média de perigo tinha 47 caracteres
= **3,4 s de voz**. 79% passavam de 2,5 s.

Resultado: nos 57 casos em que houve aviso antes da morte, **a frase só terminou de
ser falada antes da morte em 31 deles (54%)**.

O aviso mais frequente como última coisa ouvida era *"Vida baixa e X vindo. Sai."* —
e ele chegava com 1,5 a 3,1 s. O "Sai" caía depois da morte.

### Coisas que testei pra ganhar tempo e NÃO funcionaram

| tentativa | resultado |
|---|---|
| disparar com o inimigo a 16 s em vez de 8 s | 2,7 → 2,8 s. Nada. |
| avisar sem precisar ver o inimigo (vida + longe de torre + sem aliado) | 2,7 → 3,3 s, mas a cobertura cai de 56% pra 48% |
| calar o aviso do mapa debaixo da torre | corta 17% do barulho, perde 3 de 19 mortes, acerto parado em 15% |

O limite não é a regra de disparo. É **quando o olho enxerga o inimigo pela primeira
vez**. Não dá pra avisar antes de ver.

### O que funcionou: encurtar, com a ordem na frente

Se não dá pra falar mais cedo, dá pra falar menos. E o verbo tem que vir primeiro,
porque se a morte cortar a frase no meio, o que ele já ouviu precisa ser acionável.

| antes | depois |
|---|---|
| "Vida baixa e Caitlyn vindo. Sai." | **"Sai! Caitlyn em cima."** |
| "Nilah e Soraka a menos de 8 segundos de você." | **"Sai! Nilah e Soraka em cima."** |
| "Jungler deles em cima de você, no top. Recua!" | **"Recua! Jungler em cima."** |
| "Dive vindo: jungler e Brand em cima de você." | **"Sai da torre! Dive com Brand."** |

Medido nos mesmos 57 casos:

- frase inteira cabe no tempo: **54% → 70%**
- **a ordem cabe no tempo: 54% → 89%**
- voz média do aviso de perigo: **3,48 s → 2,50 s** (28% mais curta)

Avisos de objetivo e timer continuaram longos de propósito — ali ele tem 30 s, não 3.

Um teste novo trava a regra: todo aviso de inimigo em cima precisa começar com
Sai/Recua/Corre/Volta/Foge/Cuidado e caber em 3,6 s.

---

## O que continua aberto

### 1. O módulo mapa — 175 avisos a 15% de acerto
É a maior fonte de ruído do app. O filtro de torre não resolveu (medido). O caminho é
testar gates que dependam do **estado dele**, não da posição: exigir 2+ inimigos, ou
vida abaixo de um corte, ou que ele esteja sem aliado por perto. Cada um precisa ser
medido antes de entrar.

### 2. Cobertura — 35 a 43% das mortes sem aviso nenhum
O pior padrão é o **dive: 55% sem cobertura**. Também Vastilarvas 43% e Arauto 30%.
Aqui o problema é o oposto do anterior: o app não fala quando devia.

### 3. Volume — 5,7 falas por minuto
Enquanto o fundo for 58%, cada aviso vale menos. Cortar repetição ("Canhão nessa
wave" 6–8×) e as falas de kill (que não preveem nada, +3 pontos) é o corte mais barato.

---

## Método

Os scripts da análise ficaram fora do repositório (scratchpad da sessão). Os dois que
viraram ferramenta estão em `scripts/`: `medir-olho.mjs` e `calibrar-leitura.mjs`,
mais o banco de ensaio `banco-olho.cjs`.

Regra que vale pra toda mudança daqui pra frente, aprendida na marra com o ícone
redondo: **medir antes de publicar**. Nesta análise duas hipóteses minhas foram
derrubadas pelos próprios dados (o filtro de torre e a janela de 16 s) e não entraram.
