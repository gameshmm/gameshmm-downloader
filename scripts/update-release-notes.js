// Runs after `electron-builder --publish always` finishes (see the "release"
// npm script). electron-builder's GitHub publisher never sets the release
// body/description itself — createRelease() only sends { tag_name, name,
// draft, prerelease }, nothing else — so the release page stays blank (or
// keeps whatever text was last typed there by hand) no matter what. This
// script patches that release's body via the GitHub REST API using the
// notes generate-release-notes.js already prepared from CHANGELOG.md.
//
// Can also be run standalone (without rebuilding) to fix an already-published
// release's description:
//   set GH_TOKEN=...
//   node scripts/generate-release-notes.js
//   node scripts/update-release-notes.js
const fs = require('fs');
const path = require('path');
const https = require('https');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const { owner, repo } = (pkg.build && pkg.build.publish) || {};
const version = pkg.version;
const tag = `v${version}`;

const token = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();

function api(method, urlPath, data) {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : null;
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: urlPath,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'gameshmm-downloader-release-script',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      res => {
        let out = '';
        res.on('data', d => { out += d; });
        res.on('end', () => {
          let json = null;
          try { json = out ? JSON.parse(out) : null; } catch {}
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new Error(`GitHub API ${method} ${urlPath} -> ${res.statusCode}: ${out}`));
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  if (!owner || !repo) {
    console.warn('[update-release-notes] package.json build.publish.owner/repo não configurado — pulando.');
    return;
  }
  if (!token) {
    console.warn('[update-release-notes] GH_TOKEN não definido — a descrição do release não foi atualizada. Rode de novo com GH_TOKEN definido se quiser corrigir.');
    return;
  }

  let body = '';
  try { body = fs.readFileSync(path.join(root, 'release-notes.tmp.md'), 'utf8').trim(); } catch {}
  if (!body) {
    console.warn('[update-release-notes] release-notes.tmp.md vazio ou ausente (rode generate-release-notes.js antes) — pulando.');
    return;
  }

  try {
    const release = await api('GET', `/repos/${owner}/${repo}/releases/tags/${tag}`);
    await api('PATCH', `/repos/${owner}/${repo}/releases/${release.id}`, { body });
    console.log(`[update-release-notes] Descrição do release ${tag} atualizada.`);
  } catch (e) {
    // Non-fatal: the installer itself already published fine either way.
    console.warn(`[update-release-notes] Não deu pra atualizar a descrição do release: ${e.message}`);
  }
})();
