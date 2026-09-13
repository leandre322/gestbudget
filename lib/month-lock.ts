import { createHmac } from 'crypto';

// I69/P177 : checkMonthAccess() et verifyUnlockToken() ont ete retires (grep
// complet sur app/ et lib/ : aucun appelant, confirme). Le verrou financier
// reel vit desormais dans lib/periode.ts (estMoisVerrouille +
// forcerMoisVerrouille + logAudit), cable sur /api/budget, /api/donnees,
// /api/decaissements et /api/banques/mouvements. Ce fichier ne sert plus
// qu'a emettre le jeton affiche par le bandeau de deverrouillage GLOBAL
// (isLocked du layout) : une friction de confirmation d'edition de session,
// pas une barriere financiere. Le jeton genere n'est plus verifie nulle
// part : isLocked passe a false que /api/month-lock reponde ou non.

// NEXTAUTH_SECRET est de toute facon requis par NextAuth pour signer les
// sessions : un repli devine ici degraderait silencieusement la securite
// sans jamais etre remarque en usage normal. Echec explicite au chargement
// du module plutot qu'une degradation invisible.
//
// L'IIFE donne a SECRET le type `string` des sa DECLARATION, pas seulement
// un retrecissement local : TypeScript ne fait pas persister un
// `if (!x) throw` a travers la frontiere d'une fonction declaree plus loin
// dans le meme module (generateUnlockToken ci-dessous verrait sinon
// `string | undefined`, meme si le throw a deja eu lieu a l'execution).
const SECRET: string = (() => {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) {
    throw new Error('NEXTAUTH_SECRET manquant : impossible de signer un jeton de deverrouillage');
  }
  return s;
})();

// ── Generer un jeton signe pour deverrouiller un mois ─────────────────────────
export function generateUnlockToken(userId: string, mois: number, annee: number): string {
  const ts   = Math.floor(Date.now() / 1000);
  const data = `${userId}:${mois}:${annee}:${ts}`;
  const hmac = createHmac('sha256', SECRET).update(data).digest('hex');
  return Buffer.from(JSON.stringify({ userId, mois, annee, ts, hmac })).toString('base64url');
}

// ── Determiner si un mois est passe ───────────────────────────────────────────
export function isMonthPast(mois: number, annee: number): boolean {
  const now = new Date();
  return annee < now.getFullYear() ||
    (annee === now.getFullYear() && mois < now.getMonth() + 1);
}
