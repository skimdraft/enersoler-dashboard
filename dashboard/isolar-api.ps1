#!/usr/bin/env pwsh
<#
iSolarCloud OpenAPI - OAuth2.0 Client (International Site)
Domain: gateway.isolarcloud.com.hk
Auth: OAuth2.0 Authorization Code Grant (RFC 6749)

Flow:
  1. Ouvrir l'URL d'autorisation dans un navigateur
  2. Se connecter a iSolarCloud et autoriser l'app
  3. Recuperer le code dans l'URL de callback
  4. Executer ce script avec -Code "LE_CODE"
  5. Le script echange le code contre des tokens et met a jour .env
  6. Ensuite utiliser -Refresh pour rafraichir, ou -Fetch pour recuperer les donnees

Endpoints OAuth2 (International):
  Token:  POST https://gateway.isolarcloud.com.hk/openapi/oauth/token
  API:    POST https://gateway.isolarcloud.com.hk/openapi/*

Note: Pour les apps OAuth2, le token endpoint utilise HTTP Basic Auth
      (appkey:appsecret) et Content-Type application/x-www-form-urlencoded.
      Le User API endpoint /openapi/login ne doit PAS etre utilise.
#>

param(
    [string]$Code,          # Authorization code from browser callback
    [switch]$Refresh,       # Refresh the access token
    [switch]$Fetch,         # Fetch plant data
    [switch]$Test,          # Test auth with a simple API call
    [string]$EnvFile = "$PSScriptRoot\..\.env",
    [string]$OutputFile = "$PSScriptRoot\isolar-data.json"
)

$ErrorActionPreference = "Stop"

# ─── Load .env ───────────────────────────────────────────────
function Load-Env {
    $env:ISOLAR_BASE = "https://gateway.isolarcloud.com.hk"
    if (Test-Path $EnvFile) {
        Get-Content $EnvFile | Where-Object { $_ -match '^([^#].+?)=(.+)$' } | ForEach-Object {
            $key = $matches[1].Trim()
            $val = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($key, $val)
        }
    }
}

# ─── Save .env ───────────────────────────────────────────────
function Save-Env {
    param([hashtable]$Updates)
    $content = Get-Content $EnvFile -Raw -Encoding UTF8
    foreach ($kv in $Updates.GetEnumerator()) {
        if ($content -match "(?m)^$($kv.Key)=.*$") {
            $content = $content -replace "(?m)^$($kv.Key)=.*$", "$($kv.Key)=$($kv.Value)"
        } else {
            $content += "`n$($kv.Key)=$($kv.Value)"
        }
    }
    $content | Out-File $EnvFile -Encoding UTF8 -NoNewline
    Write-Host "[ENV] Updated $($Updates.Count) value(s) in .env" -ForegroundColor Green
}

# ─── OAuth2: Exchange authorization code for tokens ──────────
function Exchange-Code {
    param([string]$Code)
    
    $clientId = $env:ISOLAR_APP_KEY
    $clientSecret = $env:ISOLAR_APP_SECRET
    $basicAuth = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${clientId}:${clientSecret}"))
    
    $body = "grant_type=authorization_code&code=$([uri]::EscapeDataString($Code))&redirect_uri=$([uri]::EscapeDataString($env:ISOLAR_REDIRECT_URL))"

    Write-Host "[OAUTH] Exchanging authorization code for tokens..." -ForegroundColor Cyan
    Write-Host "  POST $($env:ISOLAR_BASE)/openapi/oauth/token"
    Write-Host "  Auth: Basic ${clientId}:****"
    
    try {
        $resp = Invoke-RestMethod -Uri "$($env:ISOLAR_BASE)/openapi/oauth/token" `
            -Method POST -Body $body -ContentType "application/x-www-form-urlencoded" `
            -Headers @{ "Authorization" = "Basic $basicAuth" }
        
        $json = $resp | ConvertTo-Json -Depth 5
        Write-Host "[OAUTH] Response: $json" -ForegroundColor Gray
        
        # OAuth2 standard response: { access_token, refresh_token, token_type, expires_in, ... }
        $accessToken  = $resp.access_token
        $refreshToken = $resp.refresh_token
        $expiresIn    = $resp.expires_in
        
        if ($accessToken) {
            Write-Host "[OAUTH] Tokens obtained! expires_in=${expiresIn}s" -ForegroundColor Green
            $updates = @{ ISOLAR_ACCESS_TOKEN = $accessToken }
            if ($refreshToken) { $updates.ISOLAR_REFRESH_TOKEN = $refreshToken }
            Save-Env $updates
            [Environment]::SetEnvironmentVariable("ISOLAR_ACCESS_TOKEN", $accessToken)
            if ($refreshToken) { [Environment]::SetEnvironmentVariable("ISOLAR_REFRESH_TOKEN", $refreshToken) }
            return $accessToken
        } else {
            Write-Host "[OAUTH] No access_token in response." -ForegroundColor Red
            Write-Host $json
            return $null
        }
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "[OAUTH] HTTP $statusCode" -ForegroundColor Red
        try {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $errBody = $reader.ReadToEnd()
            Write-Host "[OAUTH] Response body: $errBody" -ForegroundColor DarkGray
        } catch {}
        return $null
    }
}

# ─── OAuth2: Refresh access token ─────────────────────────────
function Refresh-Token {
    param([string]$RefreshTokenStr)
    
    if (-not $RefreshTokenStr) {
        Write-Host "[OAUTH] No refresh token available" -ForegroundColor Red
        return $null
    }
    
    $clientId = $env:ISOLAR_APP_KEY
    $clientSecret = $env:ISOLAR_APP_SECRET
    $basicAuth = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${clientId}:${clientSecret}"))
    
    $body = "grant_type=refresh_token&refresh_token=$([uri]::EscapeDataString($RefreshTokenStr))"

    Write-Host "[OAUTH] Refreshing access token..." -ForegroundColor Cyan
    Write-Host "  POST $($env:ISOLAR_BASE)/openapi/oauth/token"
    
    try {
        $resp = Invoke-RestMethod -Uri "$($env:ISOLAR_BASE)/openapi/oauth/token" `
            -Method POST -Body $body -ContentType "application/x-www-form-urlencoded" `
            -Headers @{ "Authorization" = "Basic $basicAuth" }
        
        $newAccess  = $resp.access_token
        $newRefresh = $resp.refresh_token
        
        if ($newAccess) {
            Write-Host "[OAUTH] Token refreshed! expires_in=$($resp.expires_in)s" -ForegroundColor Green
            $updates = @{ ISOLAR_ACCESS_TOKEN = $newAccess }
            if ($newRefresh) { $updates.ISOLAR_REFRESH_TOKEN = $newRefresh }
            Save-Env $updates
            [Environment]::SetEnvironmentVariable("ISOLAR_ACCESS_TOKEN", $newAccess)
            if ($newRefresh) { [Environment]::SetEnvironmentVariable("ISOLAR_REFRESH_TOKEN", $newRefresh) }
            return $newAccess
        }
        
        Write-Host "[OAUTH] No access_token in refresh response" -ForegroundColor Red
        return $null
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "[OAUTH] HTTP $statusCode - refresh token may be expired, re-authorize needed" -ForegroundColor Red
        return $null
    }
}

# ─── API Call wrapper ─────────────────────────────────────────
function Invoke-API {
    param(
        [string]$Endpoint,      # e.g. "getPowerStationList"
        [hashtable]$Body = @{},
        [string]$Token = $env:ISOLAR_ACCESS_TOKEN
    )

    if (-not $Token) {
        throw "No access token available. Run with -Code first to authorize."
    }

    $bodyHash = @{ appkey = $env:ISOLAR_APP_KEY } + $Body
    $bodyJson = $bodyHash | ConvertTo-Json

    $uri = "$($env:ISOLAR_BASE)/openapi/$Endpoint"
    Write-Host "[API] POST $uri" -ForegroundColor DarkGray

    $resp = Invoke-RestMethod -Uri $uri -Method POST -Body $bodyJson `
        -ContentType "application/json" -Headers @{ "x-access-key" = $Token }

    if ($resp.result_code -eq "E912") {
        # Token expired or invalid - try refresh
        Write-Host "[API] Token expired (E912), attempting refresh..." -ForegroundColor Yellow
        $newToken = Refresh-Token -RefreshTokenStr $env:ISOLAR_REFRESH_TOKEN
        if ($newToken) {
            Write-Host "[API] Retrying with fresh token..." -ForegroundColor Yellow
            $resp = Invoke-RestMethod -Uri $uri -Method POST -Body $bodyJson `
                -ContentType "application/json" -Headers @{ "x-access-key" = $newToken }
        }
    }

    return $resp
}

# ─── Fetch plant list ─────────────────────────────────────────
function Get-PlantList {
    Write-Host "[API] Fetching power station list..." -ForegroundColor Cyan
    $resp = Invoke-API -Endpoint "getPowerStationList"

    if ($resp.result_code -eq "1") {
        $stations = $resp.result_data
        Write-Host "[API] ✅ Found $($stations.Count) station(s)" -ForegroundColor Green
        foreach ($s in $stations) {
            Write-Host "  - $($s.ps_name) (ID: $($s.ps_id), Status: $($s.ps_status), Capacity: $($s.ps_capacity)kWp)" -ForegroundColor Gray
        }
        return $stations
    } else {
        Write-Host "[API] ❌ $($resp.result_msg) (code: $($resp.result_code))" -ForegroundColor Red
        Write-Host "[API] Full response: $($resp | ConvertTo-Json -Depth 5)" -ForegroundColor DarkGray
        return $null
    }
}

# ─── Fetch real-time data for a plant ─────────────────────────
function Get-PlantRealtime {
    param([string]$PsId)

    Write-Host "[API] Fetching real-time data for plant $PsId..." -ForegroundColor Cyan
    $resp = Invoke-API -Endpoint "getPsDetail" -Body @{ ps_id = $PsId }

    if ($resp.result_code -eq "1") {
        return $resp.result_data
    } else {
        Write-Host "[API] ❌ $($resp.result_msg) (code: $($resp.result_code))" -ForegroundColor Red
        return $null
    }
}

# ─── Fetch daily data ─────────────────────────────────────────
function Get-PlantDaily {
    param(
        [string]$PsId,
        [string]$Date = (Get-Date -Format "yyyy-MM-dd")
    )

    Write-Host "[API] Fetching daily data for plant $PsId on $Date..." -ForegroundColor Cyan
    $resp = Invoke-API -Endpoint "getPlantPowerData" -Body @{
        ps_id = $PsId
        date  = $Date
    }

    if ($resp.result_code -eq "1") {
        return $resp.result_data
    } else {
        Write-Host "[API] ❌ $($resp.result_msg) (code: $($resp.result_code))" -ForegroundColor Red
        return $null
    }
}

# ─── Test authentication ──────────────────────────────────────
function Test-Auth {
    Write-Host "[TEST] Checking authentication..." -ForegroundColor Cyan
    $resp = Invoke-API -Endpoint "getPowerStationList"

    if ($resp.result_code -eq "1") {
        Write-Host "[TEST] ✅ Authentication OK! Access token works." -ForegroundColor Green
        return $true
    } elseif ($resp.result_code -eq "E912") {
        Write-Host "[TEST] ❌ Token invalid/expired. Need to re-authorize or refresh." -ForegroundColor Red
        return $false
    } else {
        Write-Host "[TEST] ❌ $($resp.result_msg) (code: $($resp.result_code))" -ForegroundColor Red
        return $false
    }
}

# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

Load-Env

if (-not $env:ISOLAR_APP_KEY) {
    Write-Host "❌ ISOLAR_APP_KEY not found in .env" -ForegroundColor Red
    Write-Host "Make sure .env exists at: $EnvFile" -ForegroundColor Yellow
    exit 1
}

Write-Host "═ iSolarCloud OAuth2.0 Client ═" -ForegroundColor Cyan
Write-Host "  Base URL: $($env:ISOLAR_BASE)"
Write-Host "  App Key:  $($env:ISOLAR_APP_KEY.Substring(0,8))..."
Write-Host ""

# ─── Mode: Exchange code ─────────────────────────────────────
if ($Code) {
    Write-Host ">>> Mode: Authorization Code Exchange" -ForegroundColor Yellow
    $token = Exchange-Code -Code $Code
    if ($token) {
        Test-Auth
    }
    exit
}

# ─── Mode: Refresh token ─────────────────────────────────────
if ($Refresh) {
    Write-Host ">>> Mode: Token Refresh" -ForegroundColor Yellow
    $token = Refresh-Token -RefreshTokenStr $env:ISOLAR_REFRESH_TOKEN
    if ($token) {
        Test-Auth
    }
    exit
}

# ─── Mode: Fetch data ────────────────────────────────────────
if ($Fetch) {
    Write-Host ">>> Mode: Fetch Data" -ForegroundColor Yellow
    $plants = Get-PlantList
    if ($plants) {
        $allData = @()
        foreach ($p in $plants) {
            $realtime = Get-PlantRealtime -PsId $p.ps_id
            if ($realtime) {
                $allData += [PSCustomObject]@{
                    ps_id      = $p.ps_id
                    ps_name    = $p.ps_name
                    ps_status  = $p.ps_status
                    capacity   = $p.ps_capacity
                    realtime   = $realtime
                }
            }
        }

        # Build summary for dashboard
        Write-Host ""
        Write-Host "══ Summary ══" -ForegroundColor Cyan
        $totalCapacity = 0; $activePlants = 0; $offlinePlants = 0
        foreach ($p in $allData) {
            $totalCapacity += [double]$p.capacity
            if ($p.ps_status -eq "1") { $activePlants++ } else { $offlinePlants++ }
        }
        Write-Host "  Active plants:  $activePlants"
        Write-Host "  Offline plants: $offlinePlants"
        Write-Host "  Total capacity: $totalCapacity kWp"

        $allData | ConvertTo-Json -Depth 5 | Out-File $OutputFile -Encoding UTF8
        Write-Host "  Data saved: $OutputFile" -ForegroundColor Green
    }
    exit
}

# ─── Mode: Test auth ─────────────────────────────────────────
if ($Test) {
    Write-Host ">>> Mode: Test Authentication" -ForegroundColor Yellow
    Test-Auth
    exit
}

# ─── Default: Show instructions ──────────────────────────────
Write-Host @"

USAGE:
  .\isolar-api.ps1 -Code "ABC123"    Exchange authorization code for tokens
  .\isolar-api.ps1 -Refresh          Refresh expired access token
  .\isolar-api.ps1 -Test             Test if current token works
  .\isolar-api.ps1 -Fetch            Fetch plant data

OAUTH2 FLOW (first time or when refresh fails):
  1. Open in browser:
     $($env:ISOLAR_AUTHORIZATION_URL)
  2. Log in to iSolarCloud
  3. Authorize the application
  4. You'll be redirected to: $($env:ISOLAR_REDIRECT_URL)?code=XXXX
  5. Copy the code from the URL
  6. Run: .\isolar-api.ps1 -Code "XXXX"

"@ -ForegroundColor White

# Quick status check
Write-Host "══ Current Status ══" -ForegroundColor Cyan
if ($env:ISOLAR_ACCESS_TOKEN) {
    $masked = $env:ISOLAR_ACCESS_TOKEN.Substring(0, [Math]::Min(12, $env:ISOLAR_ACCESS_TOKEN.Length)) + "..."
    Write-Host "  Access Token:  $masked"
    Write-Host "  Refresh Token: present" -ForegroundColor $(if ($env:ISOLAR_REFRESH_TOKEN) { "Green" } else { "Red" })
    Test-Auth
} else {
    Write-Host "  Tokens: NONE -- run with -Code first" -ForegroundColor Yellow
}
