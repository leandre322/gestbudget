// =============================================================================
//  scripts/check-integrity.mjs - S26 / P : integrite d'encodage des fichiers
//
//  Lance en prebuild (package.json), apres check-env.mjs. Complementaire de
//  scripts/check-staged.ps1 : celui-ci juge le DIFF pousse (donc limite par la
//  profondeur du clone Vercel, git clone --depth=10) ; check-integrity.mjs
//  juge l'ARBRE FINAL du build, sans dependre de Git ni de son historique.
//  C'est le seul des deux qui reste fiable quelle que soit la taille du push.
//
//  Deux controles, sur chaque fichier texte du depot (meme liste d'extensions
//  que check-staged.ps1 - $extTexte - a garder alignee si l'une des deux
//  change) :
//   1. Decodage UTF-8 strict (TextDecoder fatal:true). Un fichier UTF-16 ou
//      un veritable binaire sous extension texte echoue ici (regle V du hook,
//      etendue a l'ensemble du depot plutot qu'au seul diff).
//   2. Mojibake (Y) : sequences observees le 26/09 sur patrimoine/route.ts
//      (e-accent-aigu, e-accent-grave et deux guillemets typographiques mal
//      reencodes - voir le tableau `mojibake` ci-dessous pour les valeurs
//      exactes), symptome d'un fichier UTF-8 relu comme cp1252 puis reencode.
//      Liste volontairement restreinte a ce qui a ete verifie a la main ; a
//      etendre avec prudence pour eviter les faux positifs.
//      Regle 29 du projet : ce fichier reste 100 % ASCII, donc les sequences
//      elles-memes sont ecrites en \uXXXX ci-dessous, jamais en clair ici.
//
//  Comme check-env.mjs : aucune valeur de fichier n'est jamais affichee,
//  seulement son chemin. Bloque dans TOUS les environnements (dev, preview,
//  production) : un probleme d'encodage n'est jamais specifique a un
//  environnement, contrairement aux regles de check-env.mjs.
//  Fichier 100 % ASCII.
// =============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const racine = process.cwd();

// Identique a check-env.mjs (parcourir) - a garder aligne si l'une des deux change.
const ignores = new Set(['node_modules', '.next', '.git', 'public', 'out', 'build', 'coverage']);
// Identique a $extTexte dans check-staged.ps1 - a garder alignee si l'une des deux change.
const extTexte = new Set(['.md', '.txt', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.css', '.ps1', '.sql', '.yml', '.yaml', '.prisma', '.html', '.sh']);

// Chaque entree : deux octets UTF-8 (0xC3 0xA9 etc.) relus comme cp1252 puis
// reencodes, exactement le symptome observe sur patrimoine/route.ts.
const mojibake = ['\u00C3\u00A9', '\u00C3\u00A8', '\u00C3\u00A2\u20AC', '\u00C3\u00A2\u201D'];

const problemesBinaire  = [];
const problemesMojibake = [];
let fichiersTestes = 0;

function lister(dossier) {
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!ignores.has(e.name)) lister(join(dossier, e.name));
      continue;
    }
    if (!extTexte.has(extname(e.name))) continue;
    tester(join(dossier, e.name));
  }
}

const TAILLE_SONDE_NUL = 8000; // meme fenetre que l'heuristique binaire de Git

function tester(chemin) {
  const relatif = chemin.slice(racine.length + 1).split('\\').join('/');
  const octets = readFileSync(chemin);
  if (octets.length === 0) return; // fichier vide : exclu, comme dans check-staged.ps1

  fichiersTestes++;

  // Etape 1 : octet NUL dans les premiers TAILLE_SONDE_NUL octets - heuristique
  // de Git (git grep -I), reprise ici pour rester coherente avec check-staged.ps1.
  // Necessaire en plus du decodage UTF-8 strict ci-dessous : un fichier ASCII en
  // UTF-16 (un octet NUL entre chaque caractere) DECODE en UTF-8 SANS ERREUR,
  // NUL etant un codepoint valide - c'est exactement le cas du README en S26
  // (# gestbudget) qui a motive ce controle. Sans cette etape, un tel fichier
  // ne serait jamais detecte.
  const sonde = octets.subarray(0, Math.min(octets.length, TAILLE_SONDE_NUL));
  if (sonde.includes(0)) {
    problemesBinaire.push(relatif);
    return;
  }

  // Etape 2 : decodage UTF-8 strict - capte le reste (cp1252/Latin-1 sans NUL,
  // UTF-8 tronque ou corrompu).
  let texte;
  try {
    texte = new TextDecoder('utf-8', { fatal: true }).decode(octets);
  } catch {
    problemesBinaire.push(relatif);
    return; // pas de sens a chercher du mojibake dans du contenu deja invalide
  }

  for (const motif of mojibake) {
    if (texte.includes(motif)) {
      problemesMojibake.push(relatif);
      break;
    }
  }
}

lister(racine);

// ---- Verdict ------------------------------------------------------------------
if (problemesBinaire.length > 0) {
  for (const f of problemesBinaire) console.error('check-integrity : ERREUR ' + f + ' : UTF-8 invalide (UTF-16 ou binaire sous extension texte ?)');
}
if (problemesMojibake.length > 0) {
  for (const f of problemesMojibake) console.error('check-integrity : ERREUR ' + f + ' : sequence mojibake detectee (voir le tableau mojibake du script pour le detail)');
}
if (problemesBinaire.length > 0 || problemesMojibake.length > 0) {
  console.error('check-integrity : BUILD BLOQUE');
  process.exit(1);
}
console.log('check-integrity : OK (' + fichiersTestes + ' fichier(s) texte verifie(s))');
