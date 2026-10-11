<div align="center">

<img src="assets/icon.png" alt="gameshmm downloader" width="96" height="96">

# gameshmm downloader

**Baixe e converta vídeos e músicas de mais de 1000 sites, direto do seu computador.**

[![Versão](https://img.shields.io/badge/vers%C3%A3o-2.9.3-blueviolet)](CHANGELOG.md)
[![Plataforma](https://img.shields.io/badge/plataforma-Windows-0078D6?logo=windows&logoColor=white)](#-instalação)
[![Licença](https://img.shields.io/badge/licença-MIT-green)](#-licença)
[![Electron](https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white)](#-stack-tecnológica)

</div>

---

## 📖 Sobre

**gameshmm downloader** é um aplicativo de mesa (Windows) que baixa vídeos, músicas e playlists do
YouTube, Spotify, TikTok, Instagram, X/Twitter, Twitch, SoundCloud e mais de **1000 outros sites**,
além de converter arquivos de vídeo/áudio entre formatos e codecs — tudo em uma interface simples,
sem precisar de linha de comando.

Por baixo dos panos ele usa o [yt-dlp](https://github.com/yt-dlp/yt-dlp) como motor de download e
o [ffmpeg](https://ffmpeg.org/) para conversão, extração de áudio e junção de vídeo/áudio.

## ✨ Funcionalidades

- **Baixar** — cole um link (ou vários de uma vez) e baixe em vídeo ou áudio, na qualidade que
  quiser. Detecta automaticamente links copiados na área de transferência.
- **Playlists** — escolha exatamente quais vídeos de uma playlist baixar, sem precisar levar tudo.
- **Fila de downloads** — vários links ao mesmo tempo, cada um acompanhando o formato/qualidade
  selecionados até começar a baixar.
- **Conversor de mídia** — converta entre MP4, MKV, WebM, AVI, MOV (vídeo) e MP3, WAV, FLAC, AAC,
  OGG (áudio); troque o codec (H.264, H.265, VP9, AV1); corte por tempo; defina um tamanho de
  arquivo alvo em MB e o app calcula o bitrate sozinho.
- **Aceleração por GPU** — usa automaticamente Nvidia NVENC, AMD AMF ou Intel QSV quando disponível
  para converter mais rápido, caindo para CPU quando não há placa compatível.
- **Metadados embutidos** — MP3s baixados saem com capa do álbum, título e artista já embutidos.
- **Histórico** — busca por título/link e filtros por status (sucesso/erro) e por origem.
- **Aviso de vídeo repetido** — antes de baixar, o app avisa se você já baixou esse mesmo link com
  sucesso antes, com a opção de baixar de novo ou cancelar.
- **yt-dlp sempre em dia** — checa sozinho em segundo plano se há uma versão nova do yt-dlp e avisa
  na aba Configurações (sem atualizar sem perguntar).
- **Extensão de navegador** (Chrome/Edge e Firefox) — um botão "Baixar" aparece direto no
  YouTube, Spotify, TikTok, Instagram e X/Twitter, sem precisar copiar e colar o link.
- **Login integrado** — conecte sua conta do YouTube pela extensão do navegador para baixar
  vídeos privados/restritos, sem expor sua senha ao app.
- **Bandeja do sistema e atalho global** (`Ctrl+Shift+D`) — deixe o app rodando em segundo plano e
  abra-o de qualquer lugar já com o link copiado preenchido.
- **Atualizações automáticas** — o app verifica, baixa e instala novas versões sozinho.

## 🌐 Sites suportados

YouTube · Spotify · TikTok · Instagram · X / Twitter · Facebook · Twitch · SoundCloud · Reddit ·
Vimeo · Dailymotion · **e mais de 1000 outros sites** suportados pelo yt-dlp.

## 💾 Instalação

1. Baixe o instalador mais recente (`.exe`) na página de
   [Releases](https://github.com/gameshmm/gameshmm-downloader/releases/latest).
2. Execute o instalador e siga o assistente (é possível escolher a pasta de instalação).
3. Pronto — o app cria atalhos na área de trabalho e no menu Iniciar, e se atualiza sozinho a
   partir daí.

### Extensão do navegador (opcional)

Para baixar direto da página do site, sem copiar link:

1. No app, abra **Configurações → Extensão do navegador**.
2. Clique em **"Abrir pasta da extensão"** (Chrome/Edge) ou **"Abrir pasta da extensão (Firefox)"**.
3. Siga o passo a passo exibido na tela para carregar a extensão no navegador.

## 🛠️ Stack tecnológica

| Camada | Tecnologia |
|---|---|
| Interface / app de mesa | [Electron](https://www.electronjs.org/) |
| Motor de download | [yt-dlp](https://github.com/yt-dlp/yt-dlp) (via `youtube-dl-exec`) — suporta 1000+ sites |
| Conversão de mídia | [ffmpeg](https://ffmpeg.org/) (via `ffmpeg-static`), com aceleração por GPU |
| Metadados do Spotify | API oficial do Spotify |
| Atualizações automáticas | [electron-updater](https://www.electron.build/auto-update) |
| Extensão de navegador | JavaScript puro, Manifest V3 (Chrome/Edge) e Manifest V2 (Firefox) |

## 📁 Estrutura do projeto

```
├── main.js               # Processo principal do Electron (janela, downloads, conversão, IPC)
├── preload.js             # Ponte segura entre main e renderer
├── renderer.js             # Lógica da interface
├── index.html / index.css  # Interface do app
├── scripts/                # Scripts auxiliares de build/release
├── extension/               # Extensão para Chrome/Edge (Manifest V3)
├── extension-firefox/        # Extensão para Firefox (Manifest V2)
├── website/                # Site/landing page do projeto
└── assets/                 # Ícones do app
```

## 👩‍💻 Desenvolvimento

Pré-requisitos: [Node.js](https://nodejs.org/) e npm.

```bash
npm install
npm start
```

## 📦 Build

Gerar o instalador do Windows (NSIS `.exe`):

```bash
npm run build
```

Saída: `dist/gameshmm-downloader-setup-<versão>.exe`

Build sem instalador (mais rápido, útil para testar):

```bash
npm run pack
```

Saída: `dist/win-unpacked/`

## 🚀 Release (atualização automática)

O app verifica atualizações ao iniciar e baixa novas versões em segundo plano usando o
[electron-updater](https://www.electron.build/auto-update), lendo as releases do repositório
público `gameshmm/gameshmm-downloader` (mantido separado deste repositório privado, para não
precisar embarcar nenhum token de acesso dentro do app).

**Configuração inicial (uma vez só):**

1. Criar um repositório **público** vazio no GitHub chamado `gameshmm-downloader`, na conta
   `gameshmm`.
2. Gerar um [personal access token](https://github.com/settings/tokens) do GitHub com escopo
   `repo` (clássico) ou `contents: write` (fine-grained, restrito a esse repositório).
3. Antes de publicar, defina o token na sua sessão do terminal (nunca faça commit dele):
   ```bash
   set GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
   ```

**Para lançar uma nova versão:**

1. Suba o número de `"version"` no `package.json` (ex: `2.9.1` → `2.9.2`). O electron-updater
   compara esse número com a última release do GitHub para decidir se há atualização disponível.
2. Rode:
   ```bash
   npm run release
   ```
   Isso gera o instalador e publica ele (junto com o arquivo de metadados `latest.yml`) como uma
   Release do GitHub em `gameshmm-downloader`.
3. Usuários com o app aberto recebem a atualização automaticamente, poucos segundos depois da
   release ficar disponível — nenhuma ação extra é necessária além desse comando.

> **Nota:** a atualização automática só roda no app empacotado (`app.isPackaged`); durante
> `npm start` ela não faz nada.

## 📋 Changelog

O histórico completo de mudanças de cada versão fica em [CHANGELOG.md](CHANGELOG.md). A tela de
novidades também aparece automaticamente dentro do app na primeira vez que você abre uma versão
nova.

## 📄 Licença

Distribuído sob a licença MIT.
