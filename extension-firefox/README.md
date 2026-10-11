# gameshmm downloader — extensão para Firefox

Mesma extensão que já existe pra Chrome/Edge (`/extension`), portada pra usar a
API nativa do Firefox (`browser.*`, baseada em Promise) em vez da API estilo
Chrome (`chrome.*`, baseada em callback). O comportamento é idêntico: botão de
download no YouTube, TikTok, X/Twitter, Instagram e Spotify, e o botão roxo
"Conectar ao app" que manda o login do YouTube pro app.

## Instalar pra testar (temporário)

1. Abra `about:debugging#/runtime/this-firefox` no Firefox.
2. Clique em **"Carregar extensão temporária..."**.
3. Selecione o arquivo `manifest.json` dentro desta pasta.
4. Pronto — o botão já aparece nos vídeos do YouTube. No primeiro clique, o
   Firefox pergunta se pode abrir o app: marque a opção de lembrar a escolha.

**Importante:** extensão carregada assim é removida automaticamente quando o
Firefox fecha — é preciso carregar de novo a cada sessão (ou reiniciar o
Firefox). Serve bem pra testar, mas não é uma instalação permanente.

## Instalar de forma permanente

O Firefox normal (canal "release") só instala extensões assinadas pela
Mozilla de forma permanente, mesmo sem estar na loja pública. O caminho mais
simples:

1. Compacte esta pasta inteira num `.zip` (o `manifest.json` deve ficar na
   raiz do zip, não dentro de uma subpasta).
2. Envie o `.zip` em https://addons.mozilla.org/developers/addon/submit/ como
   **"On your own"** (distribuição não listada/privada — não aparece na
   busca da loja, só quem tiver o link instala).
3. A Mozilla assina automaticamente em minutos e devolve um arquivo `.xpi`
   assinado.
4. Abra esse `.xpi` no Firefox (ou arraste pra dentro da janela) — ele
   instala normalmente e permanece após reiniciar.

Alternativa só pra quem usa Firefox Developer Edition, Nightly ou ESR: em
`about:config`, desative `xpinstall.signatures.required` e carregue o `.xpi`
sem assinatura. Não funciona no Firefox padrão (canal "release").

## Diferenças em relação à versão Chrome/Edge

- Usa `browser.*` (Promise) em vez de `chrome.*` (callback) em todos os
  arquivos que chamam a API da extensão (`background.js`, `content.js`,
  `shared.js`, `popup.js`).
- `manifest.json`: `background.scripts` em vez de `background.service_worker`
  (o Firefox usa "event pages" pra background não-persistente no Manifest
  V3), e um bloco `browser_specific_settings.gecko` com um ID de extensão
  (exigido pelo Firefox pra assinar/gerenciar a extensão).
- Os arquivos de cada site (`tiktok.js`, `twitter.js`, `instagram.js`,
  `spotify.js`) e o CSS/ícones são idênticos — só usam funções de
  `shared.js`, sem chamar a API do navegador diretamente.
