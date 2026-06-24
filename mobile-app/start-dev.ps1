# start-dev.ps1 - Permanent fix for "Opening Project" slowness
# Usage: powershell -File start-dev.ps1
# What it does:
#   1. Kills any existing Metro processes (no port conflict)
#   2. Starts Metro on fixed port 8081 in a new visible window
#   3. Pre-warms the iOS bundle in the background
#   4. Tells you when to scan the QR

$ErrorActionPreference = 'Stop'
$ProjectDir = $PSScriptRoot
$MetroPort = 8081

Write-Host "=== CareVance HRMS Dev Server ===" -ForegroundColor Cyan

# 1. Kill any existing Metro to free the port
$existing = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Killing $($existing.Count) existing node process(es)..." -ForegroundColor Yellow
  $existing | Stop-Process -Force
  Start-Sleep -Seconds 2
}

# 2. Verify port is free
$portInUse = netstat -ano | Select-String ":$MetroPort " | Select-String "LISTEN"
if ($portInUse) {
  Write-Host "Port $MetroPort is still in use. Killing remaining process..." -ForegroundColor Red
  $portInUse | ForEach-Object {
    $pid = ($_ -split '\s+')[-1]
    Get-Process -Id $pid -ErrorAction SilentlyContinue | Stop-Process -Force
  }
  Start-Sleep -Seconds 2
}

# 3. Start Metro in a new visible window
Write-Host "Starting Metro on port $MetroPort in new window..." -ForegroundColor Green
Start-Process powershell -ArgumentList @(
  "-NoProfile"
  "-Command"
  "`$env:EXPO_OFFLINE=1; Set-Location '$ProjectDir'; npx expo start --port $MetroPort --max-workers=2"
) -WorkingDirectory $ProjectDir -WindowStyle Normal

# 4. Wait for Metro to be ready
Write-Host "Waiting for Metro to be ready..." -ForegroundColor Cyan
$ready = $false
for ($i = 0; $i -lt 120; $i++) {
  Start-Sleep -Seconds 1
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$MetroPort/status" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    if ($response.Content -match "packager-status:running") {
      $ready = $true
      break
    }
  } catch {}
  if ($i -eq 30) { Write-Host "  still waiting (30s)..." -ForegroundColor DarkGray }
  if ($i -eq 60) { Write-Host "  still waiting (60s) - first start can be slow" -ForegroundColor Yellow }
  if ($i -eq 90) { Write-Host "  still waiting (90s) - cold bundle compile in progress" -ForegroundColor Yellow }
}

if (-not $ready) {
  Write-Host "Metro did not start in 60s. Check the new window for errors." -ForegroundColor Red
  exit 1
}
Write-Host "Metro is ready!" -ForegroundColor Green

# 5. Pre-warm the bundle
Write-Host "Pre-warming iOS bundle..." -ForegroundColor Cyan
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$bundleUrl = "http://127.0.0.1:$MetroPort/node_modules/expo-router/entry.bundle?platform=ios&dev=true&minify=false"
try {
  $bundle = Invoke-WebRequest -Uri $bundleUrl -UseBasicParsing -TimeoutSec 120 -ErrorAction Stop
  $sw.Stop()
  $sizeKB = [math]::Round($bundle.Content.Length / 1024)
  Write-Host "Bundle cached in $($sw.ElapsedMilliseconds)ms ($sizeKB KB)" -ForegroundColor Green
} catch {
  Write-Host "Bundle pre-warm failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "You can still scan, but the first scan will be slow." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Ready! ===" -ForegroundColor Cyan
Write-Host "Look at the new Metro window for the QR code." -ForegroundColor White
Write-Host "Scan with iPhone Camera (or open Expo Go and enter exp://192.168.0.72:$MetroPort)" -ForegroundColor White
Write-Host ""
Write-Host "Press Ctrl+C in the Metro window to stop." -ForegroundColor DarkGray
