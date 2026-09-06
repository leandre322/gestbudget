// =============================================================================
// lib/periode.ts  --  I16 : source unique de la regle de verrouillage mensuel
// =============================================================================
// Motif (P62). La regle « verrouille apres le 5 du mois suivant » etait ecrite
// dans budget/page.tsx et nulle part ailleurs. Elle etait donc :
//   - evaluee sur l horloge du POSTE, reculable ;
//   - annulable par un simple setLocked(false) ;
//   - inconnue du serveur, qui acceptait n importe quelle ecriture.
//
// Ce module est importe par le client (affichage) ET par api/budget (garde).
// Le serveur reste seul juge : le client ne fait qu anticiper sa reponse.
//
// Fuseau : tout est calcule en UTC. Le serveur Vercel tourne en UTC, le poste
// est en UTC+1 (Cotonou). Sans cette normalisation, client et serveur
// divergeraient d une heure autour de l echeance -- soit exactement le genre
// d ecart qui produit un 423 inexplique a l ecran.
// L echeance tombe donc le 5 a 00:00 UTC, soit 01:00 heure locale.
// =============================================================================

/** Jour du mois SUIVANT a partir duquel un mois est clos. */
export const JOUR_VERROU = 5;

/** Motif inscrit dans logAudit lors d une ecriture en derogation (Q62). */
export const MOTIF_DEROGATION = 'derogation_mois_verrouille' as const;

/** Rang absolu d un mois, pour comparer (annee, mois) sans passer par Date. */
export function cleMois(annee: number, mois: number): number {
  return annee * 12 + (mois - 1);
}

export function moisValide(annee: number, mois: number): boolean {
  return (
    Number.isInteger(annee) && annee >= 1970 && annee <= 9999 &&
    Number.isInteger(mois) && mois >= 1 && mois <= 12
  );
}

/**
 * Instant a partir duquel (annee, mois) devient verrouille : le JOUR_VERROU du
 * mois suivant, 00:00 UTC. `mois` etant 1-indexe et Date.UTC 0-indexe, passer
 * `mois` tel quel designe bien le mois suivant, y compris pour decembre
 * (Date.UTC(2025, 12, 5) === 5 janvier 2026).
 */
export function echeanceVerrou(annee: number, mois: number): number {
  return Date.UTC(annee, mois, JOUR_VERROU);
}

/**
 * true si le mois est ANTERIEUR au mois courant ET que l echeance est passee.
 * Le mois courant et les mois futurs ne sont jamais verrouilles.
 */
export function estMoisVerrouille(
  annee: number,
  mois: number,
  maintenant: Date = new Date(),
): boolean {
  if (!moisValide(annee, mois)) return false;

  const cleCourante = cleMois(maintenant.getUTCFullYear(), maintenant.getUTCMonth() + 1);
  if (cleMois(annee, mois) >= cleCourante) return false;

  return maintenant.getTime() > echeanceVerrou(annee, mois);
}

/**
 * Nombre de jours restants avant verrouillage. null si deja verrouille ou si
 * le mois n est pas encore concerne. Sert au bandeau d avertissement de l ecran
 * Budget.
 */
export function joursAvantVerrou(
  annee: number,
  mois: number,
  maintenant: Date = new Date(),
): number | null {
  if (!moisValide(annee, mois)) return null;
  if (estMoisVerrouille(annee, mois, maintenant)) return null;

  const cleCourante = cleMois(maintenant.getUTCFullYear(), maintenant.getUTCMonth() + 1);
  if (cleMois(annee, mois) >= cleCourante) return null;

  const restant = echeanceVerrou(annee, mois) - maintenant.getTime();
  return Math.max(0, Math.ceil(restant / 86400000));
}

/** Message unique, partage par le bandeau client et le corps du 423. */
export function messageVerrou(annee: number, mois: number): string {
  const d = new Date(echeanceVerrou(annee, mois));
  const jour = d.getUTCDate();
  const moisSuivant = d.getUTCMonth() + 1;
  const anneeSuivante = d.getUTCFullYear();
  return (
    'Mois cloture : les ecritures sont fermees depuis le ' +
    jour + '/' + moisSuivant + '/' + anneeSuivante + '. ' +
    'Une modification reste possible en derogation, et sera tracee.'
  );
}