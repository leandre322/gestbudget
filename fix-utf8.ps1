# fix-utf8.ps1 - Repare le mojibake (UTF-8 -> CP1252 -> UTF-8)
# MODIFIE les fichiers. FERMER VS CODE AVANT (REGLE 10). Backup automatique.

$root = "C:\Users\leand\LAWDIGITAL-PROJET\gestbudget"
$dirs = @("app", "components", "lib")

$c3 = [string][char]0x00C3
$c2 = [string][char]0x00C2
$e2 = [string][char]0x00E2 + [string][char]0x20AC
$f0 = [string][char]0x00F0
$pattern = "$c3|$c2|$e2|$f0"

# Encodeurs stricts : jettent une exception si conversion ambigue -> ligne ignoree
$cp1252 = [System.Text.Encoding]::GetEncoding(
    1252,
    [System.Text.EncoderExceptionFallback]::new(),
    [System.Text.DecoderExceptionFallback]::new()
)
$utf8read   = [System.Text.UTF8Encoding]::new($false)
$utf8strict = [System.Text.UTF8Encoding]::new($false, $true)
$utf8write  = [System.Text.UTF8Encoding]::new($false)

$stamp  = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $root ("_utf8-backup-" + $stamp)
New-Item -ItemType Directory -Path $backup -Force | Out-Null

$fixedLines = 0
$fixedFiles = 0
$skipped    = @()

foreach ($d in $dirs) {
    $path = Join-Path $root $d
    if (-not (Test-Path $path)) { continue }
    $files = Get-ChildItem -Path $path -Recurse -Include *.ts, *.tsx -File
    foreach ($f in $files) {
        $lines = [System.IO.File]::ReadAllLines($f.FullName, $utf8read)
        $changed = $false
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match $pattern) {
                try {
                    $bytes = $cp1252.GetBytes($lines[$i])
                    $fixed = $utf8strict.GetString($bytes)
                    if ($fixed -ne $lines[$i]) {
                        $lines[$i] = $fixed
                        $changed = $true
                        $fixedLines++
                    }
                } catch {
                    $skipped += [PSCustomObject]@{
                        Fichier = $f.FullName.Replace($root + "\", "")
                        Ligne   = $i + 1
                        Extrait = $lines[$i].Trim()
                    }
                }
            }
        }
        if ($changed) {
            $rel     = $f.FullName.Replace($root + "\", "")
            $bakPath = Join-Path $backup $rel
            New-Item -ItemType Directory -Path (Split-Path $bakPath) -Force | Out-Null
            Copy-Item $f.FullName $bakPath -Force
            [System.IO.File]::WriteAllLines($f.FullName, $lines, $utf8write)
            $fixedFiles++
        }
    }
}

Write-Host ""
Write-Host ("Lignes corrigees : " + $fixedLines + " dans " + $fixedFiles + " fichier(s)") -ForegroundColor Green
Write-Host ("Backup : " + $backup) -ForegroundColor Cyan
if ($skipped.Count -gt 0) {
    Write-Host ""
    Write-Host ("A CORRIGER A LA MAIN : " + $skipped.Count + " ligne(s) mixtes ignorees :") -ForegroundColor Yellow
    $skipped | Format-Table -AutoSize -Wrap
}