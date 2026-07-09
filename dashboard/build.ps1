#!/usr/bin/env pwsh
# Build self-contained dashboard HTML with embedded JSON data
# Data source: extract.js (OAuth2 API) or isolar-data.json

param(
    [string]$DataFile = "$PSScriptRoot\isolar-data.json",
    [string]$TemplateFile = "$PSScriptRoot\index.html",
    [string]$OutputFile = "$PSScriptRoot\dashboard.html"
)

# First run extraction if json is stale (>15 min)
$stale = $true
if (Test-Path $DataFile) {
    $lastWrite = (Get-Item $DataFile).LastWriteTime
    $stale = ((Get-Date) - $lastWrite).TotalMinutes -gt 15
}

if ($stale) {
    Write-Host "Data is stale or missing, running extract.js..."
    node "$PSScriptRoot\extract.js" 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Extraction failed, using existing data" -ForegroundColor Yellow
    }
}

$json = Get-Content $DataFile -Raw -Encoding UTF8 | Out-String
$html = Get-Content $TemplateFile -Raw -Encoding UTF8

# Inject data directly (replace the fetch-based loader)
$injection = @"
// DATA INJECTED AT BUILD TIME — $(Get-Date -Format 'o')
const INLINE_DATA = $json;

function loadData() {
  try {
    render(INLINE_DATA);
    document.getElementById('errorBanner').style.display = 'none';
  } catch(e) {
    document.getElementById('errorBanner').style.display = 'block';
    document.getElementById('errorBanner').textContent = 'Erreur: ' + e.message;
  }
}
loadData();
// Auto-reload every 5 minutes
setInterval(function(){ location.reload(); }, 300000);
"@

$html = $html -replace "async function loadData\(\).*?setInterval\(loadData, 60000\);", $injection

$html | Out-File $OutputFile -Encoding UTF8
Write-Host "Built dashboard: $OutputFile" -ForegroundColor Green
