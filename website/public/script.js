// gameshmm downloader — landing page
// Busca a versão/changelog mais recente no GitHub (repo público) e cuida dos
// efeitos visuais (cor por plataforma, brilho dos cards, aparecer ao rolar).
// Não depende de nenhuma biblioteca externa. O download pela web foi removido:
// a página só leva ao instalador do app.

const REPO = 'gameshmm/gameshmm-downloader';
const $ = (s, r = document) => r.querySelector(s);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

$('#year').textContent = new Date().getFullYear();

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Transforma "## 2.5.1 - Título\n- item\n- item" em HTML simples.
function renderChangelogEntry(tag, body) {
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  const items = lines
    .filter(l => l.startsWith('-') || l.startsWith('*'))
    .map(l => `<li>${escapeHtml(l.replace(/^[-*]\s*/, '').replace(/\*\*/g, ''))}</li>`)
    .join('');
  return `
    <div class="changelog-entry">
      <h4><span class="chip-green">${escapeHtml(tag)}</span></h4>
      <ul>${items || '<li>Ver detalhes no GitHub.</li>'}</ul>
    </div>`;
}

async function loadLatestRelease() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error('release fetch failed');
    const release = await res.json();
    const version = (release.tag_name || '').replace(/^v/, '');
    const exeAsset = (release.assets || []).find(a => a.name.endsWith('.exe'));
    if (version) {
      const badge = $('#btn-version');
      badge.textContent = `v${version}`;
      badge.classList.remove('hidden');
    }
    if (exeAsset) {
      $('#btn-download-main').href = exeAsset.browser_download_url;
      $('#btn-download-footer').href = exeAsset.browser_download_url;
    }
  } catch (err) {
    // Os links continuam apontando pra /releases/latest — funciona igual.
    console.warn('Não foi possível carregar a última release do GitHub:', err);
  }
}

async function loadChangelog() {
  const box = $('#changelog-box');
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=3`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error('releases fetch failed');
    const releases = await res.json();
    if (!Array.isArray(releases) || releases.length === 0) throw new Error('sem releases');
    box.innerHTML = releases.map(r => renderChangelogEntry(r.tag_name, r.body || '')).join('');
  } catch (err) {
    box.innerHTML = `<p class="dim">Não foi possível carregar o changelog agora — veja o histórico completo no GitHub.</p>`;
    console.warn('Não foi possível carregar o changelog:', err);
  }
}

/* ── Cor por plataforma (mesma ideia do app) ─────────────────────────── */
const root = document.documentElement;
const BRAND = 300;
let cur = BRAND;
function tint(target) {                       // caminha sempre pelo caminho mais curto no círculo de matizes
  cur += ((target - cur + 540) % 360) - 180;
  root.style.setProperty('--ph', String(cur));
}
let hovering = false;
document.querySelectorAll('.platform-chip[data-h]').forEach(chip => {
  chip.addEventListener('pointerenter', () => { hovering = true; tint(Number(chip.dataset.h)); });
  chip.addEventListener('pointerleave', () => { hovering = false; });
});
$('.platform-grid')?.addEventListener('pointerleave', () => { tint(BRAND); });

// A demonstração do topo passa por algumas plataformas sozinha.
const DEMO = [
  { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', chip: 'YouTube',   title: 'Título do vídeo',        h: 25 },
  { url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', chip: 'Spotify', title: 'Nome da música', h: 150 },
  { url: 'https://www.tiktok.com/@usuario/video/7123456789',   chip: 'TikTok',    title: 'Vídeo curto',            h: 355 },
  { url: 'https://www.instagram.com/reel/Cxyz123/',          chip: 'Instagram', title: 'Reel',                    h: 8 },
  { url: 'https://x.com/usuario/status/1234567890',           chip: 'X · Twitter', title: 'Post com vídeo',       h: 245 },
];
if (!reduced && $('#mock-url')) {
  let i = 0;
  setInterval(() => {
    if (document.hidden || hovering) return;
    i = (i + 1) % DEMO.length;
    const d = DEMO[i];
    $('#mock-url').textContent = d.url; $('#mock-chip').textContent = d.chip; $('#mock-title').textContent = d.title;
    tint(d.h);
  }, 3400);
}

/* ── Brilho "spotlight" nos cards ────────────────────────────────────── */
document.addEventListener('pointermove', (e) => {
  const c = e.target.closest?.('.feature-card');
  if (!c) return;
  const r = c.getBoundingClientRect();
  c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
  c.style.setProperty('--my', (e.clientY - r.top) + 'px');
}, { passive: true });

/* ── Aparecer ao rolar (sem biblioteca; sem JS, tudo já fica visível) ── */
if ('IntersectionObserver' in window && !reduced) {
  const els = document.querySelectorAll('.platform-chip, .feature-card, .step-card, .changelog-box, .download-inner > *');
  els.forEach(el => el.classList.add('reveal'));
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { threshold: 0.15 });
  els.forEach(el => io.observe(el));
}

loadLatestRelease();
loadChangelog();
