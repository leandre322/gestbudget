# audit-utf8.ps1 - Detection des corruptions d'encodage (mojibake)
# Lecture seule - ne modifie aucun fichier. VS Code peut rester ouvert.

$root = "C:\Users\leand\LAWDIGITAL-PROJET\gestbudget"
$dirs = @("app", "components", "lib")

# Motifs construits par code caractere (jamais en litteral, pour eviter
# que ce script soit lui-meme victime d'une corruption au copier-coller) :
#   0x00C3 (A tilde)  -> signature "Ã©" "Ã¨" "Ã§"... (accents corrompus)
#   0x00C2 (A circ.)  -> signature "Â " (espaces insecables corrompus)
#   0x00E2 + 0x20AC   -> signature "â€" (tirets/guillemets corrompus)
#   0x00F0 (eth)      -> signature "ðŸ" (emojis corrompus)
$c3 = [string][char]0x00C3
$c2 = [string][char]0x00C2
$e2 = [string][char]0x00E2 + [string][char]0x20AC
$f0 = [string][char]0x00F0
$pattern = "$c3|$c2|$e2|$f0"

$utf8 = [System.Text.UTF8Encoding]::new($false)
$results = @()

foreach ($d in $dirs) {
    $path = Join-Path $root $d
    if (-not (Test-Path $path)) { continue }
    $files = Get-ChildItem -Path $path -Recurse -Include *.ts, *.tsx -File
    foreach ($f in $files) {
        $lines = [System.IO.File]::ReadAllLines($f.FullName, $utf8)
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match $pattern) {
                $results += [PSCustomObject]@{
                    Fichier = $f.FullName.Replace($root + "\", "")
                    Ligne   = $i + 1
                    Extrait = $lines[$i].Trim()
                }
            }
        }
    }
}

if ($results.Count -eq 0) {
    Write-Host "Aucune corruption UTF-8 detectee." -ForegroundColor Green
} else {
    $results | Format-Table -AutoSize -Wrap
    $nbFichiers = ($results | Select-Object -ExpandProperty Fichier -Unique).Count
    Write-Host ""
    Write-Host ("Total : " + $results.Count + " lignes corrompues dans " + $nbFichiers + " fichier(s)") -ForegroundColor Yellow
}