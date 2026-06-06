# ==============================================================
# APPLIQUER DEPUIS : C:\Users\leand\LAWDIGITAL-PROJET\gestbudget
# ==============================================================

$ErrorActionPreference = "Stop"
$dl  = "$env:USERPROFILE\Downloads"
$enc = [System.Text.Encoding]::UTF8
$encNoBom = New-Object System.Text.UTF8Encoding $false

function Dep($src, $dest) {
    $dir = Split-Path $dest -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
    $txt = [System.IO.File]::ReadAllText($src, $enc)
    [System.IO.File]::WriteAllText((Join-Path (Resolve-Path ".").Path $dest), $txt, $encNoBom)
    Write-Host "OK -> $dest" -ForegroundColor Green
}

Write-Host "=== D2 ENVELOPPES DEPLOIEMENT ===" -ForegroundColor Cyan

Dep "$dl\webpush.ts"             "lib\webpush.ts"
Dep "$dl\EnveloppeCard.tsx"      "components\EnveloppeCard.tsx"
Dep "$dl\GlissementModal.tsx"    "components\GlissementModal.tsx"
Dep "$dl\EnveloppesSection.tsx"  "components\EnveloppesSection.tsx"

New-Item -ItemType Directory -Force "app\api\enveloppes\glissement" | Out-Null
New-Item -ItemType Directory -Force "app\api\push\notify"           | Out-Null
Dep "$dl\enveloppes_route.ts"   "app\api\enveloppes\route.ts"
Dep "$dl\glissement_route.ts"   "app\api\enveloppes\glissement\route.ts"
Dep "$dl\push_notify_route.ts"  "app\api\push\notify\route.ts"

# -- Construction des strings JSX sans < ni > dans le code PowerShell --
$lt = [char]60
$gt = [char]62
$sq = [char]39
$nl = [char]10

$importEnv = "import EnveloppesSection from " + $sq + "@/components/EnveloppesSection" + $sq + ";"
$compSuivi  = "      " + $lt + "EnveloppesSection mois={mois} annee={annee} readOnly /" + $gt
$compBudget = "      " + $lt + "EnveloppesSection mois={mois} annee={annee} /" + $gt

# -- Injection suivi/page.tsx --
Write-Host "Injection suivi/page.tsx..." -ForegroundColor Yellow
$fSuivi = "app\(app)\suivi\page.tsx"
$lines  = [System.IO.File]::ReadAllLines($fSuivi, $enc)
$already = $false
foreach ($line in $lines) { if ($line -match "EnveloppesSection") { $already = $true; break } }
if (-not $already) {
    $lst = [System.Collections.Generic.List[string]]::new()
    $lst.AddRange($lines)
    $clsxIdx = -1
    for ($i = 0; $i -lt $lst.Count; $i++) {
        if ($lst[$i] -match "import.*clsx") { $clsxIdx = $i; break }
    }
    if ($clsxIdx -ge 0) { $lst.Insert($clsxIdx + 1, $importEnv) }
    $bandeauIdx = -1
    for ($i = 0; $i -lt $lst.Count; $i++) {
        if ($lst[$i] -match "BandeauMoisAnterieur") { $bandeauIdx = $i; break }
    }
    if ($bandeauIdx -ge 0) { $lst.Insert($bandeauIdx, $compSuivi) }
    [System.IO.File]::WriteAllLines($fSuivi, $lst.ToArray(), $encNoBom)
    Write-Host "OK -> suivi/page.tsx" -ForegroundColor Green
} else {
    Write-Host "SKIP suivi (deja patche)" -ForegroundColor DarkYellow
}

# -- Injection budget/page.tsx --
Write-Host "Injection budget/page.tsx..." -ForegroundColor Yellow
$fBudget = "app\(app)\budget\page.tsx"
$lines   = [System.IO.File]::ReadAllLines($fBudget, $enc)
$already = $false
foreach ($line in $lines) { if ($line -match "EnveloppesSection") { $already = $true; break } }
if (-not $already) {
    $lst = [System.Collections.Generic.List[string]]::new()
    $lst.AddRange($lines)
    $clsxIdx = -1
    for ($i = 0; $i -lt $lst.Count; $i++) {
        if ($lst[$i] -match "import.*clsx") { $clsxIdx = $i; break }
    }
    if ($clsxIdx -ge 0) { $lst.Insert($clsxIdx + 1, $importEnv) }
    $bandeauIdx = -1
    for ($i = 0; $i -lt $lst.Count; $i++) {
        if ($lst[$i] -match "BandeauMoisAnterieur") { $bandeauIdx = $i; break }
    }
    if ($bandeauIdx -ge 0) { $lst.Insert($bandeauIdx, $compBudget) }
    [System.IO.File]::WriteAllLines($fBudget, $lst.ToArray(), $encNoBom)
    Write-Host "OK -> budget/page.tsx" -ForegroundColor Green
} else {
    Write-Host "SKIP budget (deja patche)" -ForegroundColor DarkYellow
}

# -- TypeScript check --
Write-Host "TypeScript check..." -ForegroundColor Yellow
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERREUR TypeScript" -ForegroundColor Red
    exit 1
}
Write-Host "0 erreur" -ForegroundColor Green

# -- Git push --
git add -A
git commit -m "feat: D2 enveloppes cards+glissement+push / injection suivi+budget"
git push origin main
Write-Host "Done." -ForegroundColor Green
