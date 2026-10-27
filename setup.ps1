$ErrorActionPreference = "Stop"

$requiredNodeMajor = 20
$requiredNodeMinor = 9
$nodeVersionText = (& node --version).Trim().TrimStart("v")
if ($LASTEXITCODE -ne 0) {
  throw "Node.js tidak ditemukan. Install Node.js 20.9 atau lebih baru, lalu buka PowerShell baru."
}

$nodeVersion = [version]$nodeVersionText
if ($nodeVersion.Major -lt $requiredNodeMajor -or ($nodeVersion.Major -eq $requiredNodeMajor -and $nodeVersion.Minor -lt $requiredNodeMinor)) {
  throw "DocCraft memerlukan Node.js 20.9 atau lebih baru. Versi terdeteksi: $nodeVersionText"
}

Write-Host "Node.js $nodeVersionText terdeteksi. Memasang dependency DocCraft..."
& npm.cmd ci
if ($LASTEXITCODE -ne 0) {
  throw "npm ci gagal. Baca pesan error di atas, lalu jalankan kembali .\setup.ps1."
}

Write-Host "Dependency selesai dipasang. Jalankan aplikasi dengan: npm run dev"
