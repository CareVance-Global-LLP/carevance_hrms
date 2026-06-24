# Pre-warms the iOS bundle in Metro's cache so the iPhone loads instantly when scanned
# Usage: Run this AFTER `npx expo start` and BEFORE scanning the QR code
$url = "http://localhost:8081/node_modules/expo-router/entry.bundle?platform=ios&dev=true&minify=false"
Write-Host "Pre-warming iOS bundle..." -ForegroundColor Cyan
$sw = [System.Diagnostics.Stopwatch]::StartNew()
curl.exe -s -o NUL -w "  Status: %{http_code} | Size: %{size_download} bytes | Time: %{time_total}s`n" $url
$sw.Stop()
Write-Host "Done in $($sw.ElapsedMilliseconds)ms - scan the QR now" -ForegroundColor Green
