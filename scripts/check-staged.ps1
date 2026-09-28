# =============================================================================
#  scripts/check-staged.ps1 - D2 (S26) : controles avant commit
#
#  Appele par .githooks/pre-commit (tout commit, y compris depuis VS Code) et
#  par scripts/safe-commit.ps1 quand le hook n'est pas actif.
#  Sans -Base/-Head : mode local, examine UNIQUEMENT ce qui est indexe
#  (git diff --cached), jamais le disque. Code de sortie 1 = commit refuse.
#  Contournement d'urgence, a eviter : git commit --no-verify
#
#  S26 / P - Avec -Base et -Head (deux SHA) : mode CI (GitHub Action), examine
#  TOUS les commits de la plage poussee, un par un (git log -p Base..Head),
#  pas un diff a 2 arbres : celui-ci est aveugle a un fichier ou un secret
#  ajoute PUIS retire dans la meme plage (net = 0 entre Base et Head).
#  Meme jeu de regles, seule la source de comparaison change. Utilise aussi
#  par test-check-staged.ps1 (W) pour rejouer des cas connus.
#
#  Les motifs sont ecrits pour ne pas se detecter eux-memes (x[-]debug, etc.) :
#  ce fichier se committe sans declencher ses propres regles.
#  Aucune valeur detectee n'est affichee : seulement le fichier et la regle.
#  PowerShell 5 lit un .ps1 sans BOM en ANSI : ce fichier reste 100 % ASCII.
# =============================================================================

param(
  [string]$Base = '',
  [string]$Head = ''
)

# S26 / P - mode CI si l'un des deux est fourni ; les deux sont alors requis.
$UsePlage = [bool]$Base -or [bool]$Head
if ($UsePlage -and (-not $Base -or -not $Head)) {
  Write-Output 'check-staged : ARRET - -Base et -Head doivent etre fournis ensemble'
  exit 1
}
# Premier push d'une branche : GitHub fournit une SHA nulle comme Base. On
# compare alors a l'arbre vide plutot que de tout laisser passer (echec ferme,
# meme logique que le git grep en echec plus bas).
if ($UsePlage -and $Base -match '^0{40}$') {
  $Base = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
}

$problemes = New-Object System.Collections.Generic.List[string]

if ($UsePlage) {
  # S26 / P - IMPORTANT : un diff a 2 arbres (git diff Base Head) est AVEUGLE a
  # un fichier ajoute PUIS retire a l'interieur de la meme plage (net = aucun
  # changement entre Base et Head). Verifie empiriquement le 27/09 : un secret
  # ainsi introduit puis supprime dans le meme push devenait invisible. On
  # utilise donc l'historique commit par commit (git log), qui voit chaque
  # commit individuellement - exactement ce que ferait le hook local s'il
  # avait tourne sur chacun d'eux.
  $fichiers = @(git -c core.quotePath=false log --name-only --diff-filter=ACMR --pretty=format: $Base..$Head |
    Where-Object { $_ -ne '' } | Sort-Object -Unique)
} else {
  $fichiers = @(git -c core.quotePath=false diff --cached --name-only --diff-filter=ACMR)
}
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
$extTexte = '\.(md|txt|ts|tsx|js|mjs|cjs|json|css|ps1|sql|yml|yaml|prisma|html|sh)$'
$aTester = @($fichiers | Where-Object { $_ -match $extTexte })
if ($aTester.Count -gt 0) {
  if ($UsePlage) {
    # Mode CI : on juge l'arbre final (Head), pas un index qui n'existe pas ici.
    $textes = @(git --literal-pathspecs -c core.quotePath=false grep -I -l -e '^' $Head -- $aTester)
  } else {
    $textes = @(git --literal-pathspecs -c core.quotePath=false grep --cached -I -l -e '^' -- $aTester)
  }
  foreach ($f in $aTester) {
    if ($textes -contains $f) { continue }
    if ($UsePlage) {
      $taille = git --literal-pathspecs cat-file -s ($Head + ':' + $f)
    } else {
      $taille = git --literal-pathspecs cat-file -s (':' + $f)
    }
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
$reSecret = '(NEXTAUTH_SECRET|CRON_SECRET|TOTP_ENCRYPTION_KEY|VAPID_PRIVATE_KEY|BREVO_SMTP_KEY)\s*=\s*["'']?([^"''\s#;,]{12,})'
$modele   = '(?i)^(your|<|\$\{|x{3,}|changeme|example|placeholder|process\.env)'
$reConn   = 'postgres(ql)?://[^:/@\s]+:([^@\s]+)@'
$pwModele = '(?i)^(YOUR_PASSWORD|password|\*+|<[^>]*>|\$\{[^}]*\})$'

$courant = ''
if ($UsePlage) {
  # Meme raison qu'au-dessus : historique commit par commit, pas un diff a 2
  # arbres. --pretty=format: (vide) supprime les en-tetes de commit (hash,
  # auteur, date, message) : seuls les blocs diff --git/+++/+  subsistent, donc
  # aucun risque qu'un message de commit commencant par '+' soit lu comme une
  # ligne ajoutee.
  $lignesDiff = @(git log -p --pretty=format: -U0 --no-color --diff-filter=ACMR $Base..$Head)
} else {
  $lignesDiff = @(git diff --cached -U0 --no-color --diff-filter=ACMR)
}
foreach ($ligne in $lignesDiff) {
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
