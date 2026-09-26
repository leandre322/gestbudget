# =============================================================================
#  scripts/check-staged.ps1 - D2 (S26) : controles avant commit
#
#  Appele par .githooks/pre-commit (tout commit, y compris depuis VS Code) et
#  par scripts/safe-commit.ps1 quand le hook n'est pas actif.
#  Examine UNIQUEMENT ce qui est indexe (git diff --cached), jamais le disque.
#  Code de sortie 1 = commit refuse. Contournement d'urgence, a eviter :
#  git commit --no-verify
#
#  Les motifs sont ecrits pour ne pas se detecter eux-memes (x[-]debug, etc.) :
#  ce fichier se committe sans declencher ses propres regles.
#  Aucune valeur detectee n'est affichee : seulement le fichier et la regle.
#  PowerShell 5 lit un .ps1 sans BOM en ANSI : ce fichier reste 100 % ASCII.
# =============================================================================

$problemes = New-Object System.Collections.Generic.List[string]

$fichiers = @(git -c core.quotePath=false diff --cached --name-only --diff-filter=ACMR)
if ($fichiers.Count -eq 0) { Write-Output 'check-staged : rien a controler'; exit 0 }

# ---- 1. Regles sur les noms de fichiers -------------------------------------
foreach ($f in $fichiers) {
  $nom = Split-Path $f -Leaf
  if ($nom -match '^\.env(\..+)?$' -and $nom -ne '.env.example') {
    $problemes.Add($f + ' : fichier d environnement (secrets)')
  }
  if ($nom -match '(_old|\.old|\.bak|\.orig|\.tmp)$') {
    $problemes.Add($f + ' : copie de travail a ne pas versionner')
  }
}

# ---- 2. Fichiers texte vus comme binaires par Git (UTF-16, octets NUL) ------
# V (S26) : on juge le CONTENU INDEXE, pas le diff. git diff --numstat declare
# un diff binaire des que l'un des deux cotes l'est : l'ancienne regle
# bloquait donc la reparation d'un fichier devenu binaire (README.md, S26).
# git grep --cached -I ignore les blobs binaires (octet NUL dans les 8000
# premiers octets, heuristique de Git) : un fichier a extension texte absent
# de sa sortie est binaire.
#  - --literal-pathspecs : les routes Next.js ([id], [...slug]) ne doivent pas
#    etre lues comme des motifs glob (sinon faux positif systematique).
#  - fichier vide : aucune ligne, donc absent de la sortie ; exclu par taille.
#  - si git grep echoue, la liste est vide et tout est refuse (echec ferme).
$extTexte = '\.(md|txt|ts|tsx|js|mjs|cjs|json|css|ps1|sql|yml|yaml|prisma|html|sh)$'
$aTester = @($fichiers | Where-Object { $_ -match $extTexte })
if ($aTester.Count -gt 0) {
  $textes = @(git --literal-pathspecs -c core.quotePath=false grep --cached -I -l -e '^' -- $aTester)
  foreach ($f in $aTester) {
    if ($textes -contains $f) { continue }
    $taille = git --literal-pathspecs cat-file -s (':' + $f)
    if ("$taille".Trim() -eq '0') { continue }
    $problemes.Add($f + ' : fichier texte vu comme binaire (UTF-16 ou octets NUL ?)')
  }
}

# ---- 3. Regles sur le contenu AJOUTE ----------------------------------------
$regles = @(
  @{ nom = 'en-tete de debogage x-debug'; motif = 'x[-]debug[-]' },
  @{ nom = 'mot de passe Neon (npg_)';    motif = 'npg_[A-Za-z0-9]{8,}' },
  @{ nom = 'cle Brevo (API)';             motif = 'xkeysib[-][0-9A-Fa-f]{16,}' },
  @{ nom = 'cle Brevo (SMTP)';            motif = 'xsmtpsib[-][0-9A-Fa-f]{16,}' },
  @{ nom = 'cle privee PEM';              motif = '-----BEGIN [A-Z ]*PRIVATE KEY-----' }
)
# Affectation d'un secret connu a une valeur litterale (fichiers env, scripts).
$reSecret = '(NEXTAUTH_SECRET|CRON_SECRET|TOTP_ENCRYPTION_KEY|VAPID_PRIVATE_KEY|BREVO_SMTP_KEY)\s*=\s*["'']?([^"''\s#;,]{12,})'
$modele   = '(?i)^(your|<|\$\{|x{3,}|changeme|example|placeholder|process\.env)'
# Chaine de connexion Postgres avec un mot de passe qui n'est pas un modele.
$reConn   = 'postgres(ql)?://[^:/@\s]+:([^@\s]+)@'
$pwModele = '(?i)^(YOUR_PASSWORD|password|\*+|<[^>]*>|\$\{[^}]*\})$'

$courant = ''
foreach ($ligne in @(git diff --cached -U0 --no-color --diff-filter=ACMR)) {
  if ($ligne.StartsWith('+++ ')) { $courant = $ligne -replace '^\+\+\+ (b/)?', ''; continue }
  if (-not $ligne.StartsWith('+')) { continue }
  $txt = $ligne.Substring(1)

  foreach ($r in $regles) {
    if ($txt -match $r.motif) { $problemes.Add($courant + ' : ' + $r.nom) }
  }

  $m = [regex]::Match($txt, $reSecret)
  if ($m.Success -and $m.Groups[2].Value -notmatch $modele) {
    $problemes.Add($courant + ' : valeur de ' + $m.Groups[1].Value + ' en clair')
  }

  $m = [regex]::Match($txt, $reConn)
  if ($m.Success -and $m.Groups[2].Value -notmatch $pwModele) {
    $problemes.Add($courant + ' : chaine de connexion avec mot de passe reel')
  }
}

# ---- Verdict ----------------------------------------------------------------
if ($problemes.Count -gt 0) {
  Write-Output 'check-staged : COMMIT REFUSE'
  $problemes | Sort-Object -Unique | ForEach-Object { Write-Output ('  - ' + $_) }
  Write-Output 'Retirer un fichier de l index : git restore --staged <fichier>'
  exit 1
}
Write-Output ('check-staged : OK (' + $fichiers.Count + ' fichier(s))')
exit 0
