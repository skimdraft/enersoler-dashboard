#!/usr/bin/env pwsh
# iSolarCloud Dashboard - Data Extractor v3
# Extracts data from the iSolarCloud web interface via browser automation
param(
    [string]$OutputFile = "$PSScriptRoot\isolar-data.json"
)

$dataDir = Split-Path $OutputFile -Parent
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

# Navigate and wait for page load
openclaw browser navigate "https://web3.isolarcloud.com.hk/" 2>&1 | Out-Null
Start-Sleep -Seconds 4

# Extract raw text content
$raw = openclaw browser evaluate --fn "[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&e.innerText).map(e=>e.innerText.trim()).filter(t=>t.length&&t.length<60).join('|||')" 2>&1

# Extract using specific regex patterns
function Extract($pattern) {
    if ($raw -match $pattern) { return $matches[1] }
    return "N/A"
}

$data = @{
    timestamp = (Get-Date).ToString('o')
    updateTime = if ($raw -match '(\d{2}/\w+/\d{4}\s+\d{2}:\d{2}:\d{2})') { $matches[1] } else { (Get-Date).ToString('dd/MMM/yyyy HH:mm:ss') }
    overview = @{
        dailyYieldMWh       = Extract 'rendement du jour\|\|\|\(MWh\)\|\|\|([\d,]+)'
        monthlyYieldMWh     = Extract 'Rendement du mois en cours\|\|\|\(MWh\)\|\|\|([\d,]+)'
        totalYieldMWh       = Extract 'Rendement total\|\|\|\(MWh\)\|\|\|([\d,]+)'
        realtimePowerKW     = Extract 'temps.*?\|\|\|\(kW\)\|\|\|([\d,]+)'
        installedCapacityKWp = Extract 'Puissance install.*?\|\|\|\(kWp\)\|\|\|([\d,]+)'
        dailyRevenueXPF     = Extract "Chiffre d'affaires actuel\|\|\|\(XPF\)\|\|\|([\d.,]+)"
        monthlyRevenueXPF   = Extract 'Revenu mensuel\|\|\|\(XPF\)\|\|\|([\d.,]+)'
        yearlyRevenueXPF    = Extract 'Revenus cette ann.*?\|\|\|\(XPF\)\|\|\|([\d.,]+)'
        totalRevenueXPF     = Extract "Chiffre d'affaures total\|\|\|\(XPF\)\|\|\|([\d.,]+)"
    }
    environmental = @{
        co2SavedTonnes      = Extract 'CO.*?\|\|\|\(tonne\)\|\|\|([\d,]+)'
        coalSavedTonnes     = Extract 'charbon standard\|\|\|\(tonne\)\|\|\|([\d,]+)'
        treesPlanted        = Extract 'arbre\|\|\|\(Arborescence\)'  # present or not
    }
    stations = @{
        normal             = Extract 'Normal\|\|\|(\d+)'
        offline            = Extract 'Hors ligne\|\|\|(\d+)'
        commissioning      = Extract 'Mise en service inachev.*?\|\|\|(\d+)'
    }
    note = "Données extraites de l'interface web iSolarCloud. API développeur en attente de support Sungrow (E912 x-access-key)."
}

$data | ConvertTo-Json -Depth 4 | Out-File -FilePath $OutputFile -Encoding UTF8

$o = $data.overview
Write-Output "OK: $OutputFile"
Write-Output "   Power: ${day}: $($o.dailyYieldMWh) MWh | RT: $($o.realtimePowerKW) kW | Total: $($o.totalYieldMWh) MWh"
Write-Host "   Revenue: $($o.totalRevenueXPF) XPF total | CO2: $($data.environmental.co2SavedTonnes) t" -ForegroundColor Green
Write-Host "   Stations: $($data.stations.normal) OK | $($data.stations.offline) Offline" -ForegroundColor Cyan
