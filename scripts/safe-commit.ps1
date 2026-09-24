# =============================================================================
#  scripts/safe-commit.ps1 - D2 (S26) : commit securise, une preoccupation
#  par commit
#
#  Usage (depuis n'importe quel dossier du depot) :
#    .\scripts\safe-commit.ps1 -Message 'fix(S26): ...' -Chemins 'middleware.ts','app/(app)/decaissements/page.tsx'
#
#  - Chemins passes en variables : aucun echappement, parentheses comprises.
#    Chemins relatifs a la racine du depot, / ou \ acceptes.
#  - Refuse tout fichier indexe HORS de -Chemins (evite d'embarquer un fichier
#    indexe plus tot et de melanger deux preoccupations dans un commit).
#  - npx tsc --noEmit avant tout commit.
#  - Controles de scripts/check-staged.ps1 : par le hook pre-commit s'il est
#    actif (core.hooksPath = .githooks), sinon appeles ici directement.
#  - Ne pousse jamais : le push reste une decision separee.
#  - 100 % ASCII (PowerShell 5 lit un .ps1 sans BOM en ANSI).
# =============================================================================
param(
  [Parameter(Mandatory = $true)][string]$Message,
  [Parameter(Mandatory = $true)][string[]]$Chemins
)

$racine = (git rev-parse --show-toplevel)
if ($LASTEXITCODE -ne 0) { Write-Output 'ARRET : pas dans un depot git'; exit 1 }
Set-Location $racine

git add -- $Chemins
if ($LASTEXITCODE -ne 0) { Write-Output 'ARRET : git add a echoue (chemin introuvable ?)'; exit 1 }

$attendus = @($Chemins | ForEach-Object { (($_ -replace '\\', '/') -replace '^\./', '').TrimEnd('/') })
$indexes  = @(git diff --cached --name-only)
if ($indexes.Count -eq 0) { Write-Output 'ARRET : rien a committer'; exit 1 }

$intrus = @($indexes | Where-Object {
  $i = $_
  -not ($attendus | Where-Object { $i -eq $_ -or $i.StartsWith($_ + '/') })
})
if ($intrus.Count -gt 0) {
  Write-Output 'ARRET : fichiers indexes hors de -Chemins :'
  $intrus | ForEach-Object { Write-Output ('  - ' + $_) }
  Write-Output 'Retirez-les avec : git restore --staged <fichier>'
  exit 1
}

Write-Output ('Fichiers du commit : ' + ($indexes -join ', '))
Write-Output 'tsc --noEmit ...'
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { Write-Output 'ARRET : erreurs TypeScript, rien n est committe (fichiers toujours indexes)'; exit 1 }

if ((git config core.hooksPath) -ne '.githooks') {
  & (Join-Path $PSScriptRoot 'check-staged.ps1')
  if ($LASTEXITCODE -ne 0) { exit 1 }
}

git commit -m $Message
if ($LASTEXITCODE -ne 0) { Write-Output 'ARRET : commit refuse'; exit 1 }
git log --oneline -1
