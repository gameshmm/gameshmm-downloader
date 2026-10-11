// Runs automatically before `npm run release` (see package.json). Pulls the
// bullet points from CHANGELOG.md for the current version, and — same idea as
// the in-app "novidades" modal (see getChangelogUpdateIfAny in main.js) —
// also pulls every version's notes since the last one actually published on
// GitHub, not just the current one. So if you skip publishing a few bumps
// (e.g. last published release was 2.2.0 and this run publishes 2.2.3), the
// GitHub release notes still show everything that changed in between instead
// of only the last version's bullets.
const fs = require('fs');
const path = require('path');
const https = require('https');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const outFile = path.join(root, 'release-notes.tmp.md');
const { owner, repo } = (pkg.build && pkg.build.publish) || {};

function semverCompare(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function parseAllChangelogEntries(raw) {
  const blocks = raw.split(/\n(?=## )/).filter(b => b.startsWith('## '));
  return blocks.map(block => {
    const m = block.match(/^## (\S+)\s*-?\s*(.*)$/m);
    const ver = m ? m[1] : '';
    const title = m ? m[2] : '';
    const body = block.split('\n').slice(1).join('\n').trim();
    return { version: ver, title, body };
  }).filter(e => e.version);
}

// Public repo → the GitHub REST API allows this read unauthenticated. Returns
// null (not an error) if there's no previous release yet, or if the request
// fails for any reason — callers fall back to "just the current version".
function getLatestPublishedVersion() {
  return new Promise(resolve => {
    if (!owner || !repo) return resolve(null);
    const req = https.get({
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/releases/latest`,
      headers: { 'User-Agent': 'gameshmm-downloader-release-script' },
      timeout: 8000
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        try {
          const json = JSON.parse(data);
          resolve(String(json.tag_name || '').replace(/^v/, '') || null);
        } catch { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

(async () => {
  let raw;
  try {
    raw = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  } catch {
    console.warn('[release-notes] CHANGELOG.md não encontrado — publicando sem notas.');
    fs.writeFileSync(outFile, '');
    return;
  }

  const all = parseAllChangelogEntries(raw);
  const currentEntry = all.find(e => e.version === version);
  if (!currentEntry) {
    console.warn(`[release-notes] Nenhuma entrada em CHANGELOG.md para a versão ${version} — lembre de adicionar uma. Publicando sem notas.`);
    fs.writeFileSync(outFile, '');
    return;
  }

  const lastPublished = await getLatestPublishedVersion();

  let entries;
  if (lastPublished) {
    entries = all
      .filter(e => semverCompare(e.version, lastPublished) > 0 && semverCompare(e.version, version) <= 0)
      .sort((a, b) => semverCompare(b.version, a.version));
    if (!entries.length) entries = [currentEntry]; // segurança: nunca publica vazio
  } else {
    // Primeira release do repo, ou não deu pra consultar o GitHub agora —
    // publica só a versão atual, como antes.
    entries = [currentEntry];
  }

  // Com uma única versão, mantém o corpo puro (sem repetir a versão, já que
  // o próprio release do GitHub já mostra a tag como título). Com várias,
  // separa cada uma com um subtítulo pra ficar claro o que mudou em cada.
  const body = entries.length > 1
    ? entries.map(e => `### v${e.version}${e.title ? ' — ' + e.title : ''}\n\n${e.body}`).join('\n\n')
    : entries[0].body;

  fs.writeFileSync(outFile, body + '\n');
  const label = entries.length > 1
    ? `${entries.length} versões (desde a v${lastPublished} até a v${version})`
    : `versão ${version}`;
  console.log(`[release-notes] Notas de ${label} prontas (${outFile}).`);
})();
