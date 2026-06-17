#!/usr/bin/env pwsh
<#
CareTime Payroll — P0 Master Test Runner

Runs all the P0 tests I added in this session and prints a clean
PASS/FAIL summary. Use this as the smoke gate before any payroll-
related release.

Prerequisites:
  - PHP 8.1+ and Composer install
  - vendor/bin/phpunit available (composer install)
  - No DB needed — tests use :memory: SQLite
#>

Set-Location $PSScriptRoot

if (-not (Test-Path "vendor/bin/phpunit")) {
    Write-Host "FATAL: vendor/bin/phpunit not found. Run 'composer install' first." -ForegroundColor Red
    exit 1
}

Write-Host "=== CareTime Payroll P0 Master Test Runner ===" -ForegroundColor Cyan
Write-Host ""

# Strip BOM from the test file if present (PowerShell Set-Content -Encoding UTF8 adds a BOM
# which crashes PHP's namespace detection).
$testFile = "tests/Feature/TimerScopeRegressionTest.php"
$bytes = [System.IO.File]::ReadAllBytes($testFile)
if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    [System.IO.File]::WriteAllBytes($testFile, $bytes[3..($bytes.Length - 1)])
    Write-Host "Stripped BOM from $testFile" -ForegroundColor Yellow
}

# Run the two test files.
$output = & vendor/bin/phpunit tests/Unit/PayrollCalculatorGoldenMasterTest.php tests/Feature/TimerScopeRegressionTest.php 2>&1 | Out-String

# Print the output.
Write-Host $output

# Summarise.
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "=== ALL P0 TESTS PASS ===" -ForegroundColor Green
    Write-Host ""
    Write-Host "What's covered:"
    Write-Host "  - 7 golden-master payroll calculation scenarios (CTC, PF, ESI, PT, TDS)"
    Write-Host "  - 4 timer auto-close regression scenarios (previous month / current month / empty / bulk)"
    Write-Host ""
    Write-Host "What's NOT covered yet (per the master plan):"
    Write-Host "  - LOP deduction (P1) - needs an end-to-end controller test"
    Write-Host "  - OT pay (P1) - needs an end-to-end controller test"
    Write-Host "  - Auth flows (P1) - existing tests in tests/Feature"
    Write-Host "  - Frontend URL persistence (P0) - needs Playwright/Vitest"
    Write-Host "  - Frontend component tests (P2) - existing tests/ in frontend/"
    exit 0
} else {
    Write-Host ""
    Write-Host "=== P0 TESTS FAILED ===" -ForegroundColor Red
    exit 1
}
