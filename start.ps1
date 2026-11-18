$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$port = 5600
$url = "http://localhost:$port/"

function Test-ConsoleServing {
    try {
        $body = (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 3).Content
        return ($body -match 'Captain Maintenance')
    } catch {
        return $false
    }
}

# Something is already on 5600: if it is this console, just focus it instead of
# starting a second server that would fail with "address already in use".
$inUse = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
if ($inUse) {
    Write-Host ""
    if (Test-ConsoleServing) {
        Write-Host "  The maintenance console is already running." -ForegroundColor Green
        Write-Host "  Opening $url" -ForegroundColor Cyan
        Start-Process $url
    } else {
        Write-Host "  Port $port is used by another program (not this console)." -ForegroundColor Yellow
        Write-Host "  Stop that program, or free the port, then run this script again." -ForegroundColor Yellow
    }
    Write-Host ""
    exit 0
}

$python = $null
foreach ($candidate in @("python", "py")) {
    $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($cmd) { $python = $cmd.Source; break }
}
if (-not $python) {
    Write-Error "Python was not found on PATH. Install Python 3 or run: python -m http.server $port"
    exit 1
}

Write-Host ""
Write-Host "  RideMate - Captain Maintenance (staff console)" -ForegroundColor Magenta
Write-Host "  Console:  $url" -ForegroundColor Cyan
Write-Host "  API:      http://localhost:5000  (change on the sign-in screen)" -ForegroundColor DarkGray
Write-Host "  The RideMate rider/captain app is a DIFFERENT app on http://localhost:5000" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Staff access only (admin / support). Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

# Open the browser at the console URL itself so the right app is always shown.
Start-Process powershell -WindowStyle Hidden -ArgumentList @(
    "-NoProfile", "-Command", "Start-Sleep -Seconds 2; Start-Process '$url'"
) | Out-Null

& $python -m http.server $port --bind 127.0.0.1
