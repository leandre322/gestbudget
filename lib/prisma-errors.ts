// =============================================================================
// lib/prisma-errors.ts  --  I22 (S16)
// =============================================================================
// Q80 — repond au mode d echec le plus couteux rencontre a ce jour.
//
// CONSTAT S16. La colonne categories.tauxReference a ete supprimee en base
// avant le deploiement du code correspondant. Prisma a leve P2022, un code
// parfaitement explicite : « The column categories.tauxReference does not
// exist in the current database. » Ce diagnostic a ete integralement detruit
// par le catch generique de la route :
//
//     } catch (e: any) {
//       console.error('GET /api/budget:', e?.message);
//       return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
//     }
//
// Cote client, `if (!res.ok) return;` acheveait l effacement. Resultat : quatre
// jours de production aveugle et deux sessions de diagnostic pour une erreur
// que la base nommait des la premiere requete.
//
// PRINCIPE. Le corps de reponse ne divulgue JAMAIS de detail de schema (nom de
// colonne, de table, de contrainte) : il n y a rien la-dedans a offrir a un
// attaquant. En revanche il porte le CODE Prisma, qui n apprend rien sur la
// structure et rend l incident identifiable au premier coup d oeil. La stack
// complete part dans les logs serveur (Vercel / Sentry), pas dans la reponse.
//
// SEMANTIQUE DES STATUTS. Une derive de schema n est pas un 500 : le serveur
// n est pas casse, il est temporairement desaligne avec sa base pendant un
// deploiement. C est un 503 avec Retry-After — le client sait qu il peut
// reessayer, et un moniteur externe distingue l incident de deploiement d un
// bug applicatif.
//
// USAGE
//     import { reponsePrisma } from '@/lib/prisma-errors';
//     ...
//     } catch (e: any) {
//       return reponsePrisma(e, 'GET /api/budget');
//     }
//
// DEPLOIEMENT PROGRESSIF. Branche d abord sur /api/budget seulement. Les
// autres routes suivront route par route, en verifiant a chaque fois qu aucun
// appelant ne depend du 500 actuel.
// =============================================================================

import { NextResponse } from 'next/server';

/** Delai de reprise suggere au client sur une derive de schema, en secondes. */
const RETRY_APRES_DERIVE = 30;

type Traduction = {
  statut: number;
  message: string;
  /** true : l incident releve de l exploitation, pas de la saisie utilisateur. */
  exploitation: boolean;
};

/**
 * Codes Prisma traduits. Tout code absent de cette table retombe sur 500
 * « Erreur interne », comportement historique : l ajout d une entree est un
 * acte deliberé, jamais un effet de bord.
 *
 * Reference : les codes P2xxx sont ceux du Prisma Client (P1xxx concernent la
 * connexion et ne remontent pas jusqu ici en pratique).
 */
const TABLE: Record<string, Traduction> = {
  // ── Derive de schema : la base et le client Prisma divergent ─────────────
  P2021: {
    statut: 503,
    message: 'Base de donnees temporairement desalignee avec l application. Reessayez dans quelques instants.',
    exploitation: true,
  },
  P2022: {
    statut: 503,
    message: 'Base de donnees temporairement desalignee avec l application. Reessayez dans quelques instants.',
    exploitation: true,
  },

  // ── Contraintes : la demande est recevable, la donnee ne l est pas ───────
  P2002: {
    statut: 409,
    message: 'Cet enregistrement existe deja.',
    exploitation: false,
  },
  P2003: {
    statut: 409,
    message: 'Operation impossible : cet element est reference ailleurs.',
    exploitation: false,
  },
  P2025: {
    statut: 404,
    message: 'Enregistrement introuvable.',
    exploitation: false,
  },
  P2000: {
    statut: 400,
    message: 'Valeur trop longue pour ce champ.',
    exploitation: false,
  },
  P2011: {
    statut: 400,
    message: 'Champ obligatoire manquant.',
    exploitation: false,
  },

  // ── Charge / disponibilite ──────────────────────────────────────────────
  P2024: {
    statut: 503,
    message: 'Base de donnees momentanement saturee. Reessayez dans quelques instants.',
    exploitation: true,
  },
  P2034: {
    statut: 409,
    message: 'Conflit d ecriture concurrent. Rechargez puis reessayez.',
    exploitation: false,
  },
};

/** Extrait le code Prisma quelle que soit la forme de l exception. */
function codePrisma(e: any): string | null {
  const c = e?.code;
  return typeof c === 'string' && /^P\d{4}$/.test(c) ? c : null;
}

/**
 * Traduit une exception en reponse HTTP.
 *
 * @param e         l exception capturee
 * @param contexte  identifiant lisible pour le log, ex. 'GET /api/budget'
 */
export function reponsePrisma(e: any, contexte: string): NextResponse {
  const code = codePrisma(e);
  const trad = code ? TABLE[code] : undefined;

  // Le log serveur porte TOUT : code, message brut, meta Prisma, stack. C est
  // la seule copie complete de l information, et elle ne quitte pas le serveur.
  console.error(
    `${contexte}:`,
    code ?? 'sans-code',
    e?.message,
    e?.meta ? JSON.stringify(e.meta) : '',
    e?.stack,
  );

  if (!trad) {
    // Comportement historique preserve pour tout ce qui n est pas explicitement
    // traduit : aucune route ne change de contrat par surprise.
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }

  const corps: Record<string, unknown> = { error: trad.message, code };

  // Signal explicite a destination du client : un ecran peut proposer un
  // « Reessayer » plutot qu afficher un echec definitif.
  if (trad.exploitation) corps.reessayable = true;

  const res = NextResponse.json(corps, { status: trad.statut });
  if (trad.statut === 503) res.headers.set('Retry-After', String(RETRY_APRES_DERIVE));
  return res;
}

/**
 * Variante pour les blocs qui doivent distinguer « erreur Prisma connue » de
 * « autre chose » avant de decider. Utile dans les $transaction ou une erreur
 * metier maison (throw new Error('SOLDE_INSUFFISANT')) cotoie les erreurs
 * Prisma : elle ne doit pas etre avalee par la traduction.
 */
export function estErreurPrismaConnue(e: any): boolean {
  const code = codePrisma(e);
  return code !== null && TABLE[code] !== undefined;
}
