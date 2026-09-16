# O que o olho no minimapa pode falar

Tudo que dá pra tirar de posição no minimapa (inimigos, aliados, você, wards)
combinada com o que a API do jogo já dá (kills, mortes, itens, nível, gold,
relógio, eventos). Marcado o que já existe e a dificuldade do resto.

Legenda: ✅ feito · 🟢 fácil (só posição + relógio) · 🟡 médio (precisa
histórico/inferência) · 🔴 difícil (reconhecer ícone novo, OCR, muita heurística)

## 1. Jungler inimigo

- ✅ Onde começou (primeira aparição antes de 2:30) / lado oposto ao que apareceu no fim do clear (2:30–4:30).
- 🟢 Lado do início pela chegada da bot lane deles: duo chega tarde na lane (> 1:45) = jungler começou embaixo (deu leash); chega cedo = começou em cima. Sem ver o jungler.
- ✅ Onde ele está agora (top/mid/bot/rio/jungle, nosso lado/deles) a cada vez que muda de região.
- ✅ Sumiu (20 s sem ver) + última posição.
- 🟢 "Sumiu há X segundos, última vez no bot": o tempo sem ver, repetido a cada 30 s enquanto sumido, só pra lane do lado oposto ao último visto.
- 🟢 Indo pra uma lane: direção do movimento (duas leituras seguidas) apontando pra lane X → "jungler indo pro top" antes de chegar.
- 🟢 Distância em segundos até você: posição dele × posição sua / velocidade (~370 u/s) → "jungler a 8 segundos de você".
- 🟢 Seu lado livre: jungler visto do lado oposto → "top livre por ~30 s" (tempo de travessia do mapa).
- 🟢 Na base (pit/fonte) → "jungler deles na base, janela de 40 s".
- 🟢 Perto de dragão/arauto/barão/vastilarvas com o objetivo vivo → "jungler deles no dragão".
- 🟢 Na NOSSA jungle (counter-jungle) → "jungler deles na nossa jungle de cima, camps em risco" (+ "seu jungler está longe").
- 🟢 Dive: jungler + laner deles perto da sua torre → "dive vindo".
- 🟡 Previsão de rota: visto no red aos 1:45 → ordem padrão de clear → hora provável em cada lane ("gank no bot entre 3:10 e 3:30").
- 🟡 Timer dos buffs deles: viu no buff em T → buff renasce T+5:00 → "red deles nasce em 30 s, dá pra roubar".
- 🟡 Padrão da partida: contagem de ganks por lane → "ele já gankou bot 3 vezes".
- 🟡 Nível 6 dele + perto da sua lane → "jungler com ult perto de você".
- 🟢 Jungler morto → invade/objetivo (já existe pela API) + onde a alma dele foi vista.

## 2. Laners inimigos (roam, missing, recall)

- ✅ Laner de outra rota chegando no seu lado / perto de você.
- ✅ Mid sumiu (30 s) → cuidado com roam (só pra quem não é mid).
- 🟢 Suporte deles saiu do bot → "sup deles sumiu, mid cuidado".
- 🟢 Roam em andamento: laner visto no rio/na jungle indo pra outra lane → avisa a lane destino ("mid deles indo pro bot") e a lane de origem ("mid deles saiu, empurra").
- 🟢 Voltou pra lane / voltou pra base (visto na base) → "top deles na base, sua lane livre 30 s" (placa, roam, back seguro).
- 🟢 Contagem de sumidos: "3 deles sumidos" (MIA) quando ≥ 3 não vistos há 15 s e você está avançado.
- 🟢 Overextended deles: laner muito no nosso lado, longe da torre → "Zed avançado no nosso lado, chama o jungler".
- 🟢 Lane swap / troca de rota: duo deles no top → "lane swap: adc e sup deles no top".
- 🟢 TP inimigo: laner some de um lado e aparece do outro em < 5 s → "Garen deu TP pro bot".
- 🟢 Split push: 1 deles sozinho numa lane lateral e 4 juntos em outro lugar → "Tryndamere sozinho no top, os outros 4 no mid".
- 🟡 Wave/estado da lane pelos pontos de minion no minimapa → "wave do top vindo pra você" (minion = pontinho, dá pra contar por lane).

## 3. Grupo inimigo e objetivos

- ✅ 3+ deles no dragão/barão.
- 🟢 Eles indo pro objetivo antes de nascer: 2+ deles se aproximando do pit 60 s antes → "eles estão armando o dragão".
- 🟢 Barão/dragão furtivo: 2+ no pit com o nosso time longe → "eles no barão!" (prioridade máxima).
- 🟢 Contest: nossos e deles no pit ao mesmo tempo → "luta no dragão".
- 🟢 Flanco: um deles atrás do nosso time (lado oposto ao da luta) → "flanco pela esquerda".
- 🟢 Agrupamento geral: 4+ deles juntos e você longe → "eles agrupados no mid, não fica sozinho".
- 🟢 Eles na nossa base / super minions (evento) + posição → "base sendo empurrada, 2 deles no inibidor".
- 🟢 Ícones de objetivo no minimapa (dragão/arauto/barão aparecem quando vivos) → confirma/corrige o timer se o relógio da gente estiver errado.
- 🔴 Timers de camp/objetivo escritos no minimapa (OCR dos números) → timer exato dos camps deles.

## 4. Você (sua posição + dados da API)

- 🟢 "Você está muito na frente sem saber do jungler" — você no lado deles + jungler sumido.
- 🟢 Perigo perto: N inimigos a menos de X segundos de você → "2 deles vindo, sai".
- 🟢 Vida baixa + inimigo se aproximando → "vida baixa e Zed vindo".
- 🟢 Farm livre: nenhum inimigo a menos de 20 s da sua lane → "lane livre, empurra".
- 🟢 Volta segura: ninguém perto + gold pra item → "hora de voltar".
- 🟢 Você sozinho longe do time em 20+ min → "você está isolado".
- 🟡 Zonas onde você morre (banco de partidas) + sua posição → "você já morreu 3 vezes nesse arbusto".
- 🟡 Recall inimigo × sua lane: laner deles na base e você com wave grande → "roam agora".

## 5. Aliados (ícones azuis, sempre visíveis)

- 🟢 Seu jungler chegando na sua lane → "seu jungler vindo, prepara o CC".
- 🟢 Seu jungler do outro lado → "seu jungler longe, não troca".
- 🟢 Time agrupando / você fora do grupo → "time agrupou no mid".
- 🟢 Aliado sozinho e longe → "seu adc está sozinho no bot" (pra quem faz call).
- 🟢 Nosso time no objetivo sem o jungler deles visto → "dragão com cuidado, jungler deles sumido".
- 🟢 Aliado dando dive/avançado sem você → "seu top está avançado, vai ajudar ou avisa".

## 6. Visão e wards

- 🟢 Wards nossas (quadradinho verde; control ward rosa; no overlay 2 min antes do objetivo) → "Dragão em um minuto e sem ward no pit"; ward deles ainda 🔴 (sem amostra confirmada). Antes: 🔴 Wards nossas (olho verde no minimapa) → "sem ward no rio do bot" antes do objetivo; "ward do rio expirou".
- 🔴 Wards deles reveladas (olho vermelho) → "ward deles no tri-bush, limpa".
- 🔴 Cobertura de visão antes de dragão/barão: sem ward nossa a 60 s do objetivo → aviso.

## 7. Início da partida (0:00–3:00)

- 🟢 Invade: 2+ deles na nossa jungle antes de 1:30 → "INVADE, 3 deles na nossa jungle".
- 🟢 Onde eles estão aos 1:20 (leash) → lado do jungler (ver seção 1).
- 🟢 Lane deles chegando tarde → "bot deles chegou tarde, deu leash" (+ empurra a wave cedo).
- 🟢 Cheese/level 1: um deles no nosso arbusto de lane → "cheese no arbusto".

## 8. Fim de partida / fechar jogo

- 🟢 Eles no barão enquanto a gente empurra → "solta a torre, barão".
- 🟢 Base deles vazia (5 vistos fora) + nossa wave → "base vazia, backdoor".
- 🟢 Eles recuando todos pra base → "eles resetaram, dragão de graça".

## Ordem sugerida de implementação

1. Distância em segundos + "indo pra lane X" (seção 1) — muda a qualidade de tudo.
2. Lado do jungler pela chegada do duo (1) e invade (7).
3. Roam em andamento com origem/destino + laner na base (2).
4. Jungler na nossa jungle / no objetivo / dive (1).
5. Aliados: seu jungler chegando (5).
6. Grupo indo pro objetivo antes de nascer, furtivo, flanco (3).
7. Você: perigo perto, overextended, farm livre (4).
8. Timers dos buffs e previsão de rota (1, 🟡).
9. Wards (6, 🔴) e OCR de timers (3, 🔴) por último.
