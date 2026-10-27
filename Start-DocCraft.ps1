$ErrorActionPreference = "Stop"
$projectPath = $PSScriptRoot
$address = "http://localhost:3000"

try {
  $response = Invoke-WebRequest -Uri $address -UseBasicParsing -TimeoutSec 2
  if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
    Start-Process $address
    exit 0
  }
} catch {
  # The local app is not running yet; start it below.
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js/npm.cmd tidak ditemukan. Instal Node.js, lalu buka kembali shortcut ini." -ForegroundColor Red
  Read-Host "Tekan Enter untuk menutup"
  exit 1
}

Set-Location -LiteralPath $projectPath
Write-Host "Menjalankan DocCraft di $address ..." -ForegroundColor Cyan
Write-Host "Jangan tutup jendela ini selama DocCraft digunakan." -ForegroundColor DarkGray

Start-Job -ArgumentList $address -ScriptBlock {
  param($target)
  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri $target -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        Start-Process $target
        return
      }
    } catch {
      Start-Sleep -Seconds 1
    }
  }
} | Out-Null

npm.cmd run dev
