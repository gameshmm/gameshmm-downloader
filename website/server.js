// gameshmm downloader — site
//
// Serve só a página estática (public/). O download pela web (POST /api/download,
// /baixar, yt-dlp + ffmpeg no servidor) foi removido: o site agora apenas
// apresenta o app e leva ao instalador no GitHub.

const path = require('path');
const express = require('express');

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

// Links antigos: /baixar e /baixar.html voltam pra home; a API responde 410.
app.get(['/baixar', '/baixar.html'], (_req, res) => res.redirect(301, '/'));
app.all('/api/download', (_req, res) => {
  res.status(410).json({ error: 'O download pela web foi removido. Baixe o app em https://downloader.gameshmm.com' });
});
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders(res, file) {
    // fontes e ícone quase nunca mudam; o resto revalida sempre (é uma página pequena)
    if (/\.(woff2|png)$/i.test(file)) res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  },
}));

// Square Cloud exige porta 80 pra apps web.
const PORT = process.env.PORT || 80;
app.listen(PORT, () => {
  console.log(`gameshmm downloader site rodando na porta ${PORT}`);
});
