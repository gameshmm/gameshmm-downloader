# gameshmm downloader — site

Landing page do app **gameshmm downloader**: apresenta o app, mostra as últimas novidades (buscadas
no GitHub) e leva ao instalador. Um servidor Node/Express mínimo serve a pasta `public/`.

> **O download pela web foi removido.** Antes o site tinha uma página `/baixar` e um endpoint
> `POST /api/download` que rodavam yt-dlp + ffmpeg no servidor (só YouTube, com limite diário). Isso
> saiu por completo: o site não baixa mais nada, só aponta pro app. Links antigos continuam
> funcionando de forma amigável — `/baixar` redireciona pra home e `/api/download` responde `410 Gone`.

## Arquivos

- `server.js` — Express: serve `public/`, redireciona `/baixar`, responde `410` em `/api/download` e
  expõe `/api/health`
- `package.json` — só depende do `express`
- `public/index.html` — a página (hero com demonstração do app, plataformas, recursos, como funciona,
  novidades e chamada pro download)
- `public/style.css` — visual (mesmo do app v2.12: roxo como marca, cor por plataforma em OKLCH,
  fundo com malha cônica + granulado, cards com brilho que segue o mouse)
- `public/script.js` — busca a última release/changelog no GitHub, troca a cor da página conforme a
  plataforma (hover nos chips e demonstração do topo), brilho dos cards e "aparecer ao rolar". Não usa
  nenhuma biblioteca externa
- `public/assets/fonts/` — Geist, Bricolage Grotesque e JetBrains Mono (licença OFL), servidas
  localmente: nada de Google Fonts nem CDN
- `public/assets/icon.png` — ícone do app
- `squarecloud.app` — configuração da Square Cloud

## Testar localmente

```bash
npm install
PORT=3000 npm start
```

Abra `http://localhost:3000`. (Em produção a Square Cloud usa a porta 80 automaticamente.)

## Publicar na Square Cloud

1. Ajuste o `SUBDOMAIN` em `squarecloud.app` se quiser outro endereço padrão (o site fica em
   `https://<subdominio>.squareweb.app`, além do domínio próprio configurado abaixo).
2. Compacte o conteúdo desta pasta em um `.zip` — **sem** `node_modules/` (a Square Cloud instala as
   dependências sozinha a partir do `package.json`; o `squarecloud.app` precisa estar na raiz do zip).
3. Acesse https://squarecloud.app/dashboard/new e envie o `.zip`.
4. A Square Cloud detecta o projeto Node.js pelo `package.json`/`MAIN=server.js`, instala as
   dependências e roda `node server.js`.

Como o servidor agora só entrega arquivos estáticos, o `MEMORY` caiu de 1024 para 256 MB — não há mais
ffmpeg/yt-dlp rodando aqui. Se você tinha um `cookies.txt` no deploy antigo, pode apagar: nada mais usa.

## Domínio personalizado: downloader.gameshmm.com

Domínio próprio exige o **plano Standard** (ou superior) na Square Cloud.

1. No painel da aplicação, vá em **Domínios** e associe `downloader.gameshmm.com` (ou use a
   rota da API `PUT /apps/:app_id/network/custom` com `custom=downloader.gameshmm.com`).
2. A Square Cloud vai gerar os registros DNS de validação — pegue-os no painel ou via
   `GET /apps/:app_id/network/dns`. Normalmente são:
   - um `TXT` em `_acme-challenge.downloader.gameshmm.com` (validação do certificado SSL)
   - um `CNAME` em `downloader.gameshmm.com` apontando para `cname.squareweb.app`
3. Adicione esses registros no provedor DNS de `gameshmm.com`.
4. A validação e emissão do certificado SSL acontecem automaticamente — leva de alguns minutos
   até ~1h pra propagar.

Detalhes completos: [Configurar domínio personalizado](https://docs.squarecloud.app/pt-br/api-reference/endpoint/apps/network/custom)
e [Obter registros DNS](https://docs.squarecloud.app/pt-br/api-reference/endpoint/apps/network/dns).
