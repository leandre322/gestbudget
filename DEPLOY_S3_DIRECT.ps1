# ==============================================================
# APPLIQUER DEPUIS : C:\Users\leand\LAWDIGITAL-PROJET\gestbudget
# AVANT : telecharger tous les fichiers depuis le chat Claude
#         et les placer dans le dossier $dl ci-dessous
# ==============================================================

# ETAPE 0 — Ajuster ce chemin si les fichiers sont ailleurs
$dl = "$env:USERPROFILE\Downloads"

$utf8NoBom = New-Object System.Text.UTF8Encoding $false

function Dep($src, $dest) {
    $dir = Split-Path $dest -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
    [System.IO.File]::WriteAllText(
        (Join-Path (Resolve-Path ".").Path $dest),
        [System.IO.File]::ReadAllText($src, [System.Text.Encoding]::UTF8),
        $utf8NoBom
    )
    Write-Host "OK -> $dest" -ForegroundColor Green
}

Write-Host "`n=== SESSION 3 — DEPLOIEMENT ===" -ForegroundColor Cyan

# ── 8 fichiers modifies ───────────────────────────────────────
Dep "$dl\schema.prisma"           "prisma\schema.prisma"
Dep "$dl\validators.ts"           "lib\validators.ts"
Dep "$dl\decaissements_route.ts"  "app\api\decaissements\route.ts"
Dep "$dl\parametres_route.ts"     "app\api\parametres\route.ts"
Dep "$dl\categories_route.ts"     "app\api\categories\route.ts"
Dep "$dl\middleware.ts"           "middleware.ts"
Dep "$dl\Sidebar.tsx"             "components\Sidebar.tsx"
Dep "$dl\parametres_page.tsx"     "app\(app)\parametres\page.tsx"

# ── D3 : nouveaux dossiers + fichiers ────────────────────────
Write-Host "`nCreation dossiers D3..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force "app\api\projets"   | Out-Null
New-Item -ItemType Directory -Force "app\(app)\projets" | Out-Null
Dep "$dl\projets_route.ts"  "app\api\projets\route.ts"
Dep "$dl\projets_page.tsx"  "app\(app)\projets\page.tsx"

# ── Prisma generate ───────────────────────────────────────────
Write-Host "`nnpx prisma generate..." -ForegroundColor Yellow
npx prisma generate

# ── Git push → Vercel deploie automatiquement ─────────────────
Write-Host "`nGit commit + push..." -ForegroundColor Yellow
git add -A
git commit -m "feat: D1 vocal decaissements + D2 schema enveloppes + D3 projets page/api + fix parametres route + middleware microphone"
git push origin main

Write-Host "`nDone. Verifier Vercel dashboard." -ForegroundColor Green
