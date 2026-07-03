param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Command,
    [int]$MaxRetries = 5,
    [int]$BaseDelay = 2
)

$ErrorActionPreference = "Stop"

for ($i = 0; $i -le $MaxRetries; $i++) {
    if ($i -gt 0) {
        $delay = $BaseDelay * [math]::Pow(2, $i - 1)
        Write-Host "Attempt $($i+1)/$($MaxRetries+1) failed. Retrying in ${delay}s..." -ForegroundColor Yellow
        Start-Sleep -Seconds $delay
    }
    try {
        $output = Invoke-Expression $Command 2>&1
        if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq $null) {
            Write-Output $output
            exit 0
        }
        $errorMsg = "$output"
        Write-Output $output
        if ($errorMsg -match "429|too many|rate limit|too_many|try again later") {
            continue
        }
        exit $LASTEXITCODE
    } catch {
        $msg = $_.Exception.Message
        Write-Output $msg
        if ($msg -match "429|too many|rate limit|too_many|try again later") {
            continue
        }
        exit 1
    }
}

Write-Host "Command failed after $MaxRetries retries" -ForegroundColor Red
exit 1
