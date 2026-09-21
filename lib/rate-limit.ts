// =============================================================================
// lib/rate-limit.ts  --  Limiteur de debit generique (S26)
// =============================================================================
// DECOUVERTE (2FA, lot 3) : la table rate_limits existe en base depuis
// longtemps et deux crons la PURGENT (cron/bilan-hebdo, cron/patrimoine),
// mais AUCUN code n'ecrivait ni ne lisait cette table pour appliquer une
// limite reelle. La connexion elle-meme n'avait donc aucune protection
// brute-force. Ce module construit le mecanisme manquant ; il est generique,
// pas specifique au 2FA, pour pouvoir couvrir la connexion elle-meme si
// Law le decide.
//
// ATOMICITE : un SELECT puis un UPDATE separes permettraient a deux requetes
// concurrentes de lire toutes deux "0 tentative" avant que l'une des deux
// n'incremente -- desynchronisant le compteur reel du nombre de tentatives
// autorisees. Une seule instruction INSERT ... ON CONFLICT DO UPDATE, geree
// par Postgres comme une operation atomique par ligne, l'exclut.
//
// FENETRE : glissante par cle, pas par horloge murale. Le compteur ne se
// reinitialise qu'a la PREMIERE requete suivant l'expiration de reset_at,
// pas a un instant fixe partage entre toutes les cles.
//
// REGLE P116 : ce module ne doit jamais etre appele sur le polling de
// session (`/api/auth/session`) ni sur la recuperation d'un jeton CSRF --
// des endpoints legitimement appeles en rafale par le client, sans rapport
// avec une tentative d'authentification.
// =============================================================================

import type { Prisma } from '@prisma/client';

type DbClient = Prisma.TransactionClient | typeof import('@/lib/prisma').default;

export interface ResultatLimite {
  /** false => la limite est atteinte, l'appelant doit refuser la requete. */
  autorise: boolean;
  tentativesRestantes: number;
  /** Instant auquel le compteur redevient disponible. */
  reinitialiseA: Date;
}

/**
 * Verifie et incremente atomiquement un compteur borne dans le temps.
 *
 * @param cle             Identifiant du seau a limiter. Prefixer par le
 *                         contexte pour eviter toute collision entre limiteurs
 *                         independants : 'totp:', 'totp-secours:', 'login:'.
 * @param maxTentatives   Nombre de tentatives autorisees sur la fenetre.
 * @param fenetreSecondes Duree de la fenetre glissante, en secondes.
 */
export async function verifierEtIncrementerLimite(
  db: DbClient,
  cle: string,
  maxTentatives: number,
  fenetreSecondes: number,
): Promise<ResultatLimite> {
  const maintenant = new Date();
  const expirationSiNeuve = new Date(maintenant.getTime() + fenetreSecondes * 1000);

  const lignes = await db.$queryRaw<{ count: number; reset_at: Date }[]>`
    INSERT INTO rate_limits (key, count, reset_at)
    VALUES (${cle}, 1, ${expirationSiNeuve})
    ON CONFLICT (key) DO UPDATE
      SET count = CASE
                     WHEN rate_limits.reset_at < ${maintenant} THEN 1
                     ELSE rate_limits.count + 1
                   END,
          reset_at = CASE
                       WHEN rate_limits.reset_at < ${maintenant} THEN ${expirationSiNeuve}
                       ELSE rate_limits.reset_at
                     END
    RETURNING count, reset_at
  `;

  const ligne = lignes[0];
  const count = Number(ligne.count ?? 1);

  return {
    autorise: count <= maxTentatives,
    tentativesRestantes: Math.max(0, maxTentatives - count),
    reinitialiseA: ligne.reset_at,
  };
}

/**
 * Remet une cle a zero immediatement. A appeler apres une authentification
 * reussie : sans ca, un utilisateur legitime qui s'est trompe deux fois avant
 * de reussir resterait plus proche de la limite qu'il ne devrait, jusqu'a
 * expiration naturelle de la fenetre.
 */
export async function reinitialiserLimite(db: DbClient, cle: string): Promise<void> {
  await db.$executeRaw`DELETE FROM rate_limits WHERE key = ${cle}`;
}
