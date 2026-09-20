// =============================================================================
// lib/totp.ts  --  2FA TOTP (S26)
// =============================================================================
// Source unique de la logique 2FA. Aucune route ne doit reimplementer le
// chiffrement du secret, la verification d'un code, ni le hachage des codes
// de secours : tout passe par ce module.
//
// RUNTIME : Node uniquement (crypto natif + otplib). Ne JAMAIS importer ce
// module depuis middleware.ts, qui tourne en Edge runtime — l'import echouerait
// au build.
//
// VARIABLE D'ENVIRONNEMENT REQUISE : TOTP_ENCRYPTION_KEY (32 caracteres
// minimum, aleatoire). A definir dans Vercel ET en local AVANT tout deploiement
// important ce module, sinon chaque fonction serverless qui l'importe leve au
// demarrage a froid. Pas de valeur de repli codee en dur : c'est precisement la
// vulnerabilite relevee dans lib/month-lock.ts.
//
// CHOIX DE HACHAGE — trois cas, trois reponses differentes, volontairement :
//
//   totpSecret      -> CHIFFRE (AES-256-GCM), pas hache : il doit etre
//                      recuperable en clair pour verifier chaque code.
//   codes de secours-> bcrypt cout 10. Ce sont des secrets a faible entropie
//                      relative (~40 bits) : sans facteur de travail, un dump
//                      de base se casse au GPU en quelques heures.
//   jeton d'appareil-> SHA-256. Deux raisons : l'entropie est de 256 bits
//                      (le facteur de travail n'apporte rien), et surtout le
//                      jeton doit etre RETROUVE par son hachage
//                      (WHERE "tokenHash" = ...) — le sel aleatoire de bcrypt
//                      rend cette recherche impossible.
//
// PERFORMANCE : la cle AES est derivee par SHA-256, pas par scrypt/PBKDF2.
// L'etirement de cle protege des secrets a faible entropie choisis par un
// humain ; TOTP_ENCRYPTION_KEY est une chaine aleatoire de 32+ caracteres, donc
// l'etirement ne ferait qu'ajouter ~100 ms a chaque demarrage a froid Vercel
// sans gain de securite reel.
// =============================================================================

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { authenticator } from '@otplib/v12-adapter';
import QRCode from 'qrcode';

// ─── Configuration ───────────────────────────────────────────────────────────

const NOM_EMETTEUR = 'GestBudget';

/** Tolerance de derive d'horloge : +/- 1 fenetre de 30 s. */
authenticator.options = { window: 1 };

/** Nombre de codes de secours generes a l'activation. */
export const NB_CODES_SECOURS = 10;

/** Duree de vie d'un appareil de confiance. */
export const JOURS_APPAREIL_CONFIANCE = 30;

/** Cout bcrypt des codes de secours — voir l'en-tete pour le raisonnement. */
const COUT_BCRYPT_SECOURS = 10;

const CLE_MAITRE: Buffer = (() => {
  const brut = process.env.TOTP_ENCRYPTION_KEY;
  if (!brut) {
    throw new Error('TOTP_ENCRYPTION_KEY manquante : le 2FA ne peut pas demarrer.');
  }
  if (brut.length < 32) {
    throw new Error('TOTP_ENCRYPTION_KEY trop courte (32 caracteres minimum).');
  }
  // Contexte inclus dans la derivation : si la meme valeur servait un jour a
  // autre chose, les deux cles resteraient distinctes.
  return createHash('sha256').update(`gestbudget-totp-v1:${brut}`).digest();
})();

// ─── Chiffrement du secret TOTP ──────────────────────────────────────────────

/**
 * Chiffre le secret TOTP pour stockage. Format : iv:tag:chiffre (base64).
 * GCM fournit l'authentification : une modification du champ en base est
 * detectee au dechiffrement au lieu de produire un secret silencieusement faux.
 */
export function chiffrerSecret(secret: string): string {
  const iv = randomBytes(12); // 96 bits, taille recommandee pour GCM
  const cipher = createCipheriv('aes-256-gcm', CLE_MAITRE, iv);
  const chiffre = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), chiffre.toString('base64')].join(':');
}

/**
 * Dechiffre un secret stocke. Leve si le format est invalide ou si
 * l'authentification GCM echoue (champ altere, mauvaise cle).
 */
export function dechiffrerSecret(stocke: string): string {
  const parts = stocke.split(':');
  if (parts.length !== 3) {
    throw new Error('Format de secret TOTP invalide.');
  }
  const [ivB64, tagB64, chiffreB64] = parts;
  const decipher = createDecipheriv('aes-256-gcm', CLE_MAITRE, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(chiffreB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

// ─── Enrolement ──────────────────────────────────────────────────────────────

/** Nouveau secret TOTP, en clair. A chiffrer avant stockage. */
export function genererSecret(): string {
  return authenticator.generateSecret();
}

/**
 * Data URL d'un QR code a scanner (Google Authenticator, Authy, 1Password...).
 * L'URI otpauth:// contient le secret EN CLAIR : ne jamais la journaliser, ni
 * la renvoyer ailleurs que dans la reponse de l'enrolement.
 */
export async function genererQrCode(email: string, secret: string): Promise<string> {
  const uri = authenticator.keyuri(email, NOM_EMETTEUR, secret);
  return QRCode.toDataURL(uri, { margin: 1, width: 240 });
}

// ─── Verification d'un code ──────────────────────────────────────────────────

/**
 * Verifie un code a 6 chiffres contre le secret EN CLAIR (deja dechiffre).
 * Ne leve jamais : renvoie false sur secret corrompu ou code malforme, pour
 * qu'un appelant ne puisse pas distinguer les cas d'echec.
 */
export function verifierCode(secretClair: string, code: string): boolean {
  const propre = (code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(propre)) return false;
  try {
    return authenticator.verify({ token: propre, secret: secretClair });
  } catch {
    return false;
  }
}

// ─── Codes de secours ────────────────────────────────────────────────────────

// Alphabet sans caracteres ambigus (ni 0/O, ni 1/I/L) : ces codes sont recopies
// a la main depuis un papier ou un gestionnaire de mots de passe.
const ALPHABET_SECOURS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Un code au format XXXX-XXXX, ~40 bits d'entropie. */
function genererUnCodeSecours(): string {
  const octets = randomBytes(8);
  const chars = Array.from(octets, (o) => ALPHABET_SECOURS[o % ALPHABET_SECOURS.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}`;
}

/**
 * Genere les codes de secours en clair ET leurs hachages.
 * Les codes en clair ne sont affiches QU'UNE FOIS a l'activation ; seuls les
 * hachages sont conserves.
 */
export async function genererCodesSecours(): Promise<{ codes: string[]; hachages: string[] }> {
  const codes = Array.from({ length: NB_CODES_SECOURS }, genererUnCodeSecours);
  const hachages = await Promise.all(
    codes.map((c) => bcrypt.hash(normaliserCodeSecours(c), COUT_BCRYPT_SECOURS)),
  );
  return { codes, hachages };
}

/** Normalisation avant hachage et avant comparaison : majuscules, sans tiret ni espace. */
export function normaliserCodeSecours(code: string): string {
  return (code ?? '').toUpperCase().replace(/[\s-]/g, '');
}

/**
 * Compare un code saisi a un hachage stocke.
 *
 * L'appelant boucle sur les codes NON UTILISES de l'utilisateur. Cout au pire
 * (code faux) : NB_CODES_SECOURS comparaisons bcrypt, soit ~650 ms. Acceptable
 * sur un chemin de secours rare, et de toute facon protege par le limiteur de
 * debit — mais c'est la raison pour laquelle le cout bcrypt est fixe a 10 et
 * non a 12.
 */
export async function verifierCodeSecours(codeSaisi: string, hachage: string): Promise<boolean> {
  const normalise = normaliserCodeSecours(codeSaisi);
  if (!/^[A-Z0-9]{8}$/.test(normalise)) return false;
  try {
    return await bcrypt.compare(normalise, hachage);
  } catch {
    return false;
  }
}

// ─── Appareils de confiance ──────────────────────────────────────────────────

/**
 * Jeton d'appareil : 256 bits d'aleatoire. Renvoye en clair pour etre depose
 * dans un cookie HttpOnly ; seul son SHA-256 est stocke.
 */
export function genererJetonAppareil(): { jetonClair: string; jetonHash: string } {
  const jetonClair = randomBytes(32).toString('base64url');
  return { jetonClair, jetonHash: hacherJetonAppareil(jetonClair) };
}

/** Hachage deterministe — permet la recherche WHERE "tokenHash" = ... */
export function hacherJetonAppareil(jetonClair: string): string {
  return createHash('sha256').update(jetonClair).digest('hex');
}

/**
 * Comparaison a temps constant de deux hachages hexadecimaux.
 * La recherche en base se fait par egalite SQL, mais toute comparaison
 * applicative de jetons doit passer ici (lecon lib/month-lock.ts : une
 * comparaison non a temps constant est une vulnerabilite connue du projet).
 */
export function comparerHash(a: string, b: string): boolean {
  const ba = Buffer.from(a ?? '', 'utf8');
  const bb = Buffer.from(b ?? '', 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Date d'expiration d'un appareil de confiance, a partir de maintenant. */
export function dateExpirationAppareil(): Date {
  return new Date(Date.now() + JOURS_APPAREIL_CONFIANCE * 24 * 60 * 60 * 1000);
}
