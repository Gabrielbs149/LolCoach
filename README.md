# LolCoach

Ferramenta de League of Legends que roda do lado do client: aceita a fila,
bane e trava o campeão, aplica runas e builds do op.gg, e analisa as suas
partidas depois pra dizer o que você fez de errado — com mapa, e no linguajar
de quem joga.

## Instalar

1. Baixe o `LolCoach-Setup-x.y.z.exe` na
   [última release](https://github.com/Gabrielbs149/LolCoach/releases/latest).
2. Execute. O Windows vai dizer **"O Windows protegeu o computador"** porque o
   instalador não tem assinatura digital paga. Clique em **Mais informações →
   Executar assim mesmo**.
3. Abra o League. O LolCoach detecta o client sozinho e grava a sua conta.

Atualizações são automáticas: o app checa ao abrir, baixa em segundo plano e
instala sozinho quando você não está em fila, seleção ou partida.

## O que faz

- **Aceitar fila** sozinho.
- **Seleção de campeão**: bane e trava o campeão que você escolher na aba
  Configuração. Automação do client é zona cinzenta na política da Riot —
  use sabendo disso.
- **Runas e itens do op.gg** aplicados no client quando o campeão trava (na
  página de runas que estiver selecionada), e um conjunto de itens na loja
  pros campeões que você joga.
- **Ao vivo**: ficha de quem está contra você montada com as *suas* mortes
  passadas, onde cada inimigo apareceu por último (pelo feed de kills), avisos
  de item e nível.
- **Depois da partida**: cada morte com mapa, quem fez o dano com qual
  habilidade, e o que treinar.
- **Perfil, estatísticas e notas de atualização** filtradas pelos seus
  campeões.

## O que NÃO faz (de propósito)

Nada é injetado no jogo, nada lê a tela, nada aperta tecla. Só as duas APIs
que a própria Riot abre: a do client (`lockfile`) e a da partida
(`127.0.0.1:2999`). Posição de inimigo no mapa não existe nessas APIs — e ler o
minimapa é o que a Riot proibiu em app de terceiro em 2023.

## Chave da Riot

Já vai dentro do instalador — ninguém precisa criar chave. Se quiser usar a
sua, coloque em `riot.apiKey` no `%APPDATA%LolCoachconfig.json`.

## Rodar do código

```
npm install
npm run app          # abre o app
npm run empacotar    # gera o instalador em build/
npm run publicar     # build + release no GitHub (precisa de GH_TOKEN)
```
