# Deploy do site para a VM do Google Cloud (ts6-unbk).
# Uso (PowerShell, a partir de qualquer pasta):  .\website\deploy.ps1
# Empacota server.js, package.json e public/, envia, instala dependencias e reinicia o servico.

$ErrorActionPreference = 'Stop'

$Vm   = 'ts6-unbk'
$Zone = 'us-central1-a'
$Src  = $PSScriptRoot
$Tgz  = Join-Path $env:TEMP 'gameshmm-site.tgz'

tar -czf $Tgz -C $Src server.js package.json public
if ($LASTEXITCODE -ne 0) { throw 'Falha ao empacotar o site' }

gcloud compute scp $Tgz "${Vm}:/tmp/site.tgz" --zone $Zone
if ($LASTEXITCODE -ne 0) { throw 'Falha ao enviar o pacote' }

$remote = 'set -e; mkdir -p ~/site && tar -xzf /tmp/site.tgz -C ~/site && cd ~/site && npm install --omit=dev --no-audit --no-fund --loglevel=error && sudo systemctl restart gameshmm-site && sleep 2 && systemctl is-active gameshmm-site && curl -fsS localhost:3000/api/health'
gcloud compute ssh $Vm --zone $Zone --command $remote
if ($LASTEXITCODE -ne 0) { throw 'Falha ao reiniciar o servico na VM' }

Write-Host "`nDeploy concluido: https://downloader.gameshmm.com" -ForegroundColor Green
