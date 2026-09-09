// =============================================================================
// lib/reference.ts  --  I1 : source unique de l allocation budgetaire
// Version 4 (S21). Integre Q52, Q53, Q56, Q57, Q58, puis P121 et P122.
// =============================================================================
// Motif (P46). Le montant de reference d une categorie etait recalcule a trois
// endroits avec trois semantiques divergentes :
//   - api/parametres/route.ts   : updateMany, ecrit le montant du TYPE sur
//                                 CHAQUE categorie du type (destructeur, P2)
//   - parametres/page.tsx       : MAX(tauxReference) sur les categories
//   - budget/page.tsx:136       : SUM(tauxReference) -> 296,14 % au lieu de
//                                 22,78 % sur depense_fixe (P29)
// Mesure en base au 06/09 : allocation reelle 790 000, somme portee par
// categories 5 529 763, ecart 4 739 763, facteur x7,0. mini = maxi sur les
// 7 types allouables.
//
// Constat determinant (S14) : enveloppeActive = false sur les 46 categories.
// D2 n a jamais ete allume, et AUCUNE route ne lit categories.montantReference
// hors du filtre enveloppeActive. P46 n est donc pas une anomalie active mais
// une anomalie ARMEE : la colonne est ecrite par P2 et lue par personne. Elle
// deviendrait fausse a l ecran au premier enveloppeActive = true.
//
// Q58 : le perimetre de repartition est l ensemble des categories ACTIVES, pas
// les enveloppes. montantReference est le budget de reference par categorie,
// derive de l allocation du type. enveloppeActive reste ce qu il est dans le
// code : un filtre d affichage de la section D2, sans effet budgetaire. Faire
// dependre l allocation d un toggle d interface rendrait un simple clic
// capable de redistribuer 180 000 FCFA (motif P57).
//
// Regles portees par ce module, et par lui seul :
//   R1  Le taux est la source de verite. montantReference est TOUJOURS derive.
//   R2  L allocation par type vit dans parametres_types. Jamais sur categories.
//   R3  Invariant en deux volets :
//       R3-a  pour chaque type allouable T,
//             SUM(categories.montantReference WHERE type = T AND isActive)
//             == parametres_types.montantReference WHERE type = T
//       R3-b  montantReference == 0 pour toute categorie INACTIVE ou de type
//             `revenu`. Sans R3-b, une categorie soft-deleted conserve sa
//             valeur P46 et redevient fausse des sa reactivation.
//       Les deux volets sont verifiables par verifierInvariant().
//   R4  Aucune fonction de ce module n ecrit une valeur ABSOLUE non derivee.
//       En mode 'conserver_ratios' l ecriture est une homothetie, qui preserve
//       les rapports entre categories d un meme type, donc les glissements D2.
//   R5  Toute repartition d un entier passe par repartirEntier() : methode du
//       plus grand reste, somme exacte garantie, zero derive d arrondi.
//   R6  Le type `revenu` est exclu de l allocation (Q41, confirme Q52 : la
//       ligne parametres_types existe avec taux 0 et n est jamais reecrite).
//   R7  Un glissement D2 est INTRA-TYPE (Q53). Autoriser le cross-type
//       deplacerait de l allocation entre types sans passer par les taux et
//       romprait R3-a silencieusement.
//   R8  (S21, P122) L interpretation d un RapportInvariant vit ici et nulle
//       part ailleurs. Une route ne classe pas elle-meme un ecart : elle
//       appelle classerInvariant() et suit le verdict.
//
// Ce module ne fait AUCUN appel a getServerSession. Le userId lui est toujours
// fourni par l appelant, qui a deja authentifie. Toutes les ecritures brutes
// portent un garde `AND "userId" = $userId` en plus du filtre applicatif.
// =============================================================================

import prisma from '@/lib/prisma';
import { toNum } from '@/lib/serial';
import type { Prisma, TypeCategorie } from '@prisma/client';

// PrismaClient est structurellement assignable a TransactionClient : ce type
// unique accepte donc aussi bien `prisma` que le `tx` d un $transaction.
export type DbClient = Prisma.TransactionClient;

// --- Constantes --------------------------------------------------------------

export const TYPE_REVENU = 'revenu' as const;

/** Les 7 types qui se partagent 100 % du revenu de reference. */
export const TYPES_ALLOUABLES = [
  'epargne_precaution',
  'epargne_investissement',
  'epargne_autre',
  'depense_fixe',
  'depense_variable',
  'depense_occasionnelle',
  'remboursement_dette',
] as const;

export type TypeAllouable = (typeof TYPES_ALLOUABLES)[number];

// Garde a la compilation : si un membre de TypeCategorie est renomme dans
// schema.prisma, tsc --noEmit echoue ici et non a l execution.
const _coherenceEnum: readonly TypeCategorie[] = TYPES_ALLOUABLES;
void _coherenceEnum;

/** Les taux sont saisis a 2 decimales : tolerance de comparaison flottante. */
export const TOLERANCE_TAUX = 0.005;

/** Fenetre d historique par defaut pour la repartition prorata (Q37). */
export const NB_MOIS_HISTORIQUE = 12;

/**
 * Q56 -- plancher accorde a une categorie sans aucun historique, exprime en
 * fraction de la PART EGALE du type (allocation / nbCategories), et non de
 * l allocation entiere. Motif : une fraction de l allocation ne s adapte pas
 * au nombre de categories. Sur epargne_precaution (2 categories) 2 % de
 * l allocation vaut 1 600 FCFA pour une part egale de 40 013 ; sur
 * depense_fixe (13 categories) 2 % vaut 3 599 pour une part egale de 13 843.
 * Meme constante, deux comportements sans rapport.
 * Avec un tiers de la part egale, la reserve totale est bornee par
 * construction a k/n x 33 % de l allocation.
 */
export const PLANCHER_PART_EGALE = 1 / 3;

export function estTypeAllouable(t: string): t is TypeAllouable {
  return (TYPES_ALLOUABLES as readonly string[]).includes(t);
}

// --- Arithmetique pure (testable sans base) ----------------------------------

/** Montant entier derive d un taux. Unique conversion taux -> montant. */
export function montantDepuisTaux(taux: number, revenu: number): number {
  if (!Number.isFinite(taux) || !Number.isFinite(revenu) || revenu <= 0) return 0;
  return Math.round((taux / 100) * revenu);
}

/** Taux a 2 decimales derive d un montant. Unique conversion montant -> taux. */
export function tauxDepuisMontant(montant: number, revenu: number): number {
  if (!Number.isFinite(montant) || !Number.isFinite(revenu) || revenu <= 0) return 0;
  return Math.round((montant / revenu) * 10000) / 100;
}

/** Objectif du fonds d urgence. Source unique (voir commentaire Annee, S11). */
export function objectifFondsUrgence(revenu: number, nMoisUrgence: number): number {
  const n = Math.min(24, Math.max(1, Math.trunc(nMoisUrgence || 0)));
  return Math.max(0, Math.round(revenu)) * n;
}

/**
 * Repartit `total` (entier >= 0) selon des poids, par la methode du plus grand
 * reste. Garantit SUM(resultat) === total exactement, sans derive d arrondi.
 * Poids nuls ou somme nulle -> repartition egale (repli Q41).
 */
export function repartirEntier(total: number, poids: number[]): number[] {
  const n = poids.length;
  if (n === 0) return [];
  const cible = Math.max(0, Math.trunc(total));

  const poidsSains = poids.map(p => (Number.isFinite(p) && p > 0 ? p : 0));
  const sommePoids = poidsSains.reduce((s, p) => s + p, 0);

  if (sommePoids <= 0) {
    const base = Math.floor(cible / n);
    const out = new Array<number>(n).fill(base);
    let reste = cible - base * n;
    for (let i = 0; i < n && reste > 0; i++, reste--) out[i] += 1;
    return out;
  }

  const exacts = poidsSains.map(p => (cible * p) / sommePoids);
  const out = exacts.map(v => Math.floor(v));
  let reste = cible - out.reduce((s, v) => s + v, 0);

  const ordre = exacts
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));

  for (let k = 0; k < ordre.length && reste > 0; k++, reste--) out[ordre[k].i] += 1;
  return out;
}

export interface ResultatValidation {
  ok: boolean;
  total: number;
  exces: number;
  inconnus: string[];
  message: string | null;
}

/**
 * I5 -- plafond 100 % cote serveur. La contrainte SUM(taux) <= 100 n est pas
 * representable en base : elle est portee ici et nulle part ailleurs.
 * Rejette aussi toute cle hors TYPES_ALLOUABLES (P28 : z.record acceptait
 * n importe quelle chaine, y compris `revenu`).
 */
export function validerSomme(taux: Record<string, number>): ResultatValidation {
  let total = 0;
  const inconnus: string[] = [];

  for (const [cle, valeur] of Object.entries(taux ?? {})) {
    if (!estTypeAllouable(cle)) { inconnus.push(cle); continue; }
    if (!Number.isFinite(valeur) || valeur < 0 || valeur > 100) {
      return {
        ok: false, total, exces: 0, inconnus,
        message: 'Taux hors bornes pour ' + cle + ' : ' + String(valeur),
      };
    }
    total += valeur;
  }

  total = Math.round(total * 100) / 100;
  const exces = Math.max(0, Math.round((total - 100) * 100) / 100);

  if (inconnus.length > 0) {
    return {
      ok: false, total, exces, inconnus,
      message: 'Type(s) non allouable(s) refuse(s) : ' + inconnus.join(', '),
    };
  }
  if (total > 100 + TOLERANCE_TAUX) {
    return {
      ok: false, total, exces, inconnus,
      message: 'Allocation totale ' + total.toFixed(2) + ' %, depassement de ' + exces.toFixed(2) + ' %',
    };
  }
  return { ok: true, total, exces: 0, inconnus, message: null };
}

// --- Lecture de l allocation -------------------------------------------------

export interface AllocationType {
  type: TypeAllouable;
  taux: number;
  montant: number;
  /** false si montant != montantDepuisTaux(taux, revenu) : desynchronisation. */
  coherent: boolean;
}

export interface Allocation {
  revenuMensuelReference: number;
  nMoisUrgence: number;
  objectifUrgence: number;
  parType: Record<TypeAllouable, AllocationType>;
  totalTaux: number;
  totalMontant: number;
  /** Max des updatedAt. Sert de jeton de concurrence optimiste (I3). */
  version: string;
}

/**
 * Lecture unique de l allocation par type. Aucun appelant ne doit relire
 * parametres_types directement : cette fonction est le seul point d entree.
 */
export async function getAllocationParType(
  userId: string,
  db: DbClient = prisma,
): Promise<Allocation> {
  const [params, lignes] = await Promise.all([
    db.parametres.findUnique({
      where: { userId },
      select: { revenuMensuelReference: true, nMoisUrgence: true, updatedAt: true },
    }),
    db.parametresType.findMany({
      where: { userId },
      select: { type: true, tauxReference: true, montantReference: true, updatedAt: true },
    }),
  ]);

  const revenu = toNum(params?.revenuMensuelReference ?? BigInt(0));
  const nMois = params?.nMoisUrgence ?? 6;

  const parType = {} as Record<TypeAllouable, AllocationType>;
  for (const t of TYPES_ALLOUABLES) {
    parType[t] = { type: t, taux: 0, montant: 0, coherent: true };
  }

  let horodatage = params?.updatedAt ? params.updatedAt.getTime() : 0;

  for (const l of lignes) {
    if (l.updatedAt && l.updatedAt.getTime() > horodatage) horodatage = l.updatedAt.getTime();
    if (!estTypeAllouable(l.type)) continue; // ligne `revenu` : ignoree (R6)
    const taux = l.tauxReference ?? 0;
    const montant = toNum(l.montantReference);
    parType[l.type] = {
      type: l.type,
      taux,
      montant,
      coherent: Math.abs(montant - montantDepuisTaux(taux, revenu)) <= 1,
    };
  }

  let totalTaux = 0;
  let totalMontant = 0;
  for (const t of TYPES_ALLOUABLES) {
    totalTaux += parType[t].taux;
    totalMontant += parType[t].montant;
  }

  return {
    revenuMensuelReference: revenu,
    nMoisUrgence: nMois,
    objectifUrgence: objectifFondsUrgence(revenu, nMois),
    parType,
    totalTaux: Math.round(totalTaux * 100) / 100,
    totalMontant,
    version: new Date(horodatage).toISOString(),
  };
}

// --- Ecriture de l allocation par type ---------------------------------------

/**
 * I6 -- ecrit les 7 lignes de parametres_types en UNE seule instruction, au
 * lieu de 7 allers-retours sequentiels. `updatedAt` est force explicitement
 * dans la branche UPDATE : ON CONFLICT DO UPDATE ne declenche pas @updatedAt
 * de Prisma.
 * N ecrit JAMAIS sur categories (P2). La ligne `revenu` n est pas touchee (R6).
 */
export async function recalculerMontantsTypes(
  db: DbClient,
  userId: string,
  revenu: number,
  taux: Record<string, number>,
): Promise<Record<TypeAllouable, number>> {
  const montants = {} as Record<TypeAllouable, number>;

  const cles: string[] = [];
  const tauxTxt: string[] = [];
  const montantsTxt: string[] = [];

  for (const t of TYPES_ALLOUABLES) {
    const v = Number.isFinite(taux?.[t]) ? Number(taux[t]) : 0;
    const m = montantDepuisTaux(v, revenu);
    montants[t] = m;
    cles.push(t);
    tauxTxt.push(String(v));
    montantsTxt.push(String(m));
  }

  await db.$executeRaw`
    INSERT INTO parametres_types ("userId", "type", "tauxReference", "montantReference", "updatedAt")
    SELECT ${userId},
           s.type::"TypeCategorie",
           s.taux::double precision,
           s.montant::bigint,
           CURRENT_TIMESTAMP
    FROM UNNEST(${cles}::text[], ${tauxTxt}::text[], ${montantsTxt}::text[]) AS s(type, taux, montant)
    ON CONFLICT ("userId", "type") DO UPDATE
      SET "tauxReference"    = EXCLUDED."tauxReference",
          "montantReference" = EXCLUDED."montantReference",
          "updatedAt"        = CURRENT_TIMESTAMP
  `;

  return montants;
}

// --- Repartition sur les categories ------------------------------------------

export type ModeRepartition = 'auto' | 'egal' | 'conserver_ratios';

export interface LigneRepartition {
  categorieId: string;
  nom: string;
  type: TypeAllouable;
  historique: number;
  ancienMontant: number;
  nouveauMontant: number;
  delta: number;
  plancher: boolean;
  /** Purement informatif : n a aucun effet sur la repartition (Q58). */
  enveloppeActive: boolean;
}

export interface BlocRepartition {
  type: TypeAllouable;
  taux: number;
  allocation: number;
  /** Mode reellement applique, a afficher par type avant tout write (Q41). */
  mode: 'prorata' | 'egal' | 'homothetie' | 'vide';
  nbCategories: number;
  sommeAvant: number;
  sommeApres: number;
  /** true si allocation > 0 mais aucune categorie active : argent orphelin. */
  allocationOrpheline: boolean;
  lignes: LigneRepartition[];
}

/** R3-b : categorie inactive ou de type revenu portant un montant non nul. */
export interface LigneRemiseAZero {
  categorieId: string;
  nom: string;
  type: TypeCategorie;
  motif: 'inactive' | 'type_revenu';
  ancienMontant: number;
}

export interface PlanRepartition {
  userId: string;
  /** Trace de la decision Q58, inscrite dans le plan et dans l audit. */
  perimetre: 'categories_actives';
  revenuMensuelReference: number;
  refAnnee: number;
  refMois: number;
  nbMoisHistorique: number;
  /** Jeton de concurrence optimiste : allocation.version au calcul (I3). */
  version: string;
  blocs: BlocRepartition[];
  /** R3-b. Application controlee par l option remiseAZeroHorsPerimetre. */
  remiseAZero: LigneRemiseAZero[];
  totalAllocation: number;
  totalAvant: number;
  totalApres: number;
  nbLignesModifiees: number;
  nbRemiseAZero: number;
  montantRemisAZero: number;
  avertissements: string[];
  /** Motifs de refus d application. Non vide => applicable = false. */
  bloquants: string[];
  applicable: boolean;
}

/**
 * Somme des montantReel par categorie sur les `nbMois` mois PRECEDANT
 * (refAnnee, refMois). Le mois de reference est exclu : il est en cours,
 * donc incomplet, et biaiserait le prorata a la baisse.
 */
async function chargerHistorique(
  db: DbClient,
  userId: string,
  categorieIds: string[],
  refAnnee: number,
  refMois: number,
  nbMois: number,
): Promise<Record<string, number>> {
  if (categorieIds.length === 0) return {};

  const fenetre: Array<{ annee: number; mois: number }> = [];
  let a = refAnnee;
  let m = refMois;
  for (let i = 0; i < nbMois; i++) {
    m -= 1;
    if (m === 0) { m = 12; a -= 1; }
    fenetre.push({ annee: a, mois: m });
  }

  const anneesVisees = Array.from(new Set(fenetre.map(f => f.annee)));
  const annees = await db.annee.findMany({
    where: { userId, annee: { in: anneesVisees } },
    select: { id: true, annee: true },
  });
  if (annees.length === 0) return {};

  const anneeParId = new Map(annees.map(x => [x.id, x.annee]));
  const cle = (an: number, mo: number) => an + '-' + mo;
  const dansFenetre = new Set(fenetre.map(f => cle(f.annee, f.mois)));

  const lignes = await db.budgetMensuel.findMany({
    where: {
      userId,
      anneeId: { in: annees.map(x => x.id) },
      categorieId: { in: categorieIds },
    },
    select: { categorieId: true, anneeId: true, mois: true, montantReel: true },
  });

  const out: Record<string, number> = {};
  for (const l of lignes) {
    const an = anneeParId.get(l.anneeId);
    if (an === undefined) continue;
    if (!dansFenetre.has(cle(an, l.mois))) continue;
    const v = toNum(l.montantReel);
    if (v <= 0) continue;
    out[l.categorieId] = (out[l.categorieId] ?? 0) + v;
  }
  return out;
}

/**
 * I9 -- calcule le plan de repartition SANS RIEN ECRIRE. C est le dry-run
 * a presenter a l utilisateur (mode affiche par type, Q41) avant tout write.
 *
 * Perimetre (Q58) : toutes les categories actives d un type allouable.
 * enveloppeActive n intervient pas.
 *
 * Modes :
 *   'auto'             prorata sur 12 mois, repli egal si historique nul,
 *                      plancher pour les categories sans historique.
 *   'egal'             part egale, quel que soit l historique.
 *   'conserver_ratios' homothetie : preserve les rapports actuels entre
 *                      categories d un meme type, donc les glissements D2.
 *                      Mode a utiliser quand le revenu change (Q50).
 *                      Repli sur 'egal' si les rapports sont degeneres
 *                      (min == max). Ce repli ne change JAMAIS le resultat :
 *                      si tous les poids sont egaux, l homothetie EST la
 *                      repartition egale. Il n existe que pour eviter une
 *                      division par zero.
 *
 * P121 (S21) -- le repli etait implicite : la branche 'egal' etait conditionnee
 * a `modeDemande === 'egal' || sommeHist <= 0`. En 'conserver_ratios' avec des
 * rapports degeneres ET un historique non nul, le flux tombait dans le `else`
 * final, donc en PRORATA -- exactement le mode que 'conserver_ratios' exclut.
 * Le bug etait masque par I41 : depuis S20 l historique n est charge qu en mode
 * 'auto', donc sommeHist vaut 0 en 'conserver_ratios' et la branche 'egal' est
 * prise par accident. Anomalie ARMEE, pas corrigee : elle reapparait au premier
 * appelant qui recharge l historique dans ce mode. Le repli est desormais
 * explicite et independant de sommeHist.
 */
export async function calculerRepartition(
  userId: string,
  options: {
    db?: DbClient;
    mode?: ModeRepartition;
    refAnnee?: number;
    refMois?: number;
    nbMois?: number;
    plancherPartEgale?: number;
    /** Allocation deja lue en memoire (evite une relecture). */
    allocation?: Allocation;
  } = {},
): Promise<PlanRepartition> {
  const db = options.db ?? prisma;
  const maintenant = new Date();
  const refAnnee = options.refAnnee ?? maintenant.getFullYear();
  const refMois = options.refMois ?? maintenant.getMonth() + 1;
  const nbMois = options.nbMois ?? NB_MOIS_HISTORIQUE;
  const modeDemande: ModeRepartition = options.mode ?? 'auto';
  const plancherPartEgale = options.plancherPartEgale ?? PLANCHER_PART_EGALE;

  const allocation = options.allocation ?? (await getAllocationParType(userId, db));

  // Toutes les categories, actives ET inactives : les inactives sont
  // necessaires pour construire le bloc R3-b.
  const toutes = await db.categorie.findMany({
    where: { userId },
    select: {
      id: true, nom: true, type: true, isActive: true,
      montantReference: true, enveloppeActive: true, ordre: true,
    },
    orderBy: [{ type: 'asc' }, { ordre: 'asc' }, { id: 'asc' }],
  });

  const dansPerimetre = toutes.filter(c => c.isActive && estTypeAllouable(c.type));

  // R3-b : inactive OU type non allouable (revenu).
  const remiseAZero: LigneRemiseAZero[] = toutes
    .filter(c => (!c.isActive || !estTypeAllouable(c.type)) && toNum(c.montantReference) !== 0)
    .map(c => ({
      categorieId: c.id,
      nom: c.nom,
      type: c.type,
      motif: (!c.isActive ? 'inactive' : 'type_revenu') as 'inactive' | 'type_revenu',
      ancienMontant: toNum(c.montantReference),
    }));

  const avertissements: string[] = [];
  const bloquants: string[] = [];

  const besoinHistorique = modeDemande === 'auto'; // I41
  const historique = besoinHistorique
    ? await chargerHistorique(db, userId, dansPerimetre.map(c => c.id), refAnnee, refMois, nbMois)
    : {};

  const blocs: BlocRepartition[] = [];
  let totalAllocation = 0;
  let totalAvant = 0;
  let totalApres = 0;
  let nbLignesModifiees = 0;

  for (const type of TYPES_ALLOUABLES) {
    const cats = dansPerimetre.filter(c => c.type === type);
    const alloc = allocation.parType[type].montant;
    const taux = allocation.parType[type].taux;
    totalAllocation += alloc;

    if (cats.length === 0) {
      const orpheline = alloc > 0;
      if (orpheline) {
        bloquants.push(
          'Type ' + type + ' : ' + alloc + ' FCFA alloues mais aucune categorie active. '
          + 'Creez une categorie sur ce type, ou ramenez son taux a 0.',
        );
      }
      blocs.push({
        type, taux, allocation: alloc, mode: 'vide',
        nbCategories: 0, sommeAvant: 0, sommeApres: 0,
        allocationOrpheline: orpheline, lignes: [],
      });
      continue;
    }

    const anciens = cats.map(c => toNum(c.montantReference));
    const hist = cats.map(c => historique[c.id] ?? 0);
    const sommeHist = hist.reduce((s, v) => s + v, 0);
    const sommeAnciens = anciens.reduce((s, v) => s + v, 0);
    const ratiosDegeneres =
      sommeAnciens <= 0 || (Math.min.apply(null, anciens) === Math.max.apply(null, anciens));

    // P121 -- les trois modes effectifs sont decides ici, explicitement, sans
    // qu aucun d eux ne depende d un effet de bord d un autre.
    const homothetie = modeDemande === 'conserver_ratios' && !ratiosDegeneres;
    const repliEgal =
      modeDemande === 'egal'
      || (modeDemande === 'conserver_ratios' && ratiosDegeneres)
      || (modeDemande === 'auto' && sommeHist <= 0);

    let mode: BlocRepartition['mode'];
    let poids: number[];
    const marqueurPlancher = new Array<boolean>(cats.length).fill(false);

    if (homothetie) {
      mode = 'homothetie';
      poids = anciens.slice();
    } else if (repliEgal) {
      mode = 'egal';
      poids = new Array<number>(cats.length).fill(1);
      if (modeDemande === 'conserver_ratios') {
        avertissements.push(
          'Type ' + type + ' : rapports actuels uniformes (min == max). '
          + 'Repartition egale, identique a l homothetie dans ce cas.',
        );
      } else if (modeDemande === 'auto') {
        avertissements.push(
          'Type ' + type + ' : aucun historique sur ' + nbMois + ' mois. Repli sur repartition egale (Q41).',
        );
      }
    } else {
      // Reste uniquement 'auto' avec sommeHist > 0.
      mode = 'prorata';
      poids = hist.slice();
    }

    let montants: number[];

    if (mode === 'prorata' && plancherPartEgale > 0) {
      // Q56 -- plancher exprime en fraction de la PART EGALE du type.
      // Reserve bornee par construction a k/n x plancherPartEgale x alloc.
      // Le plafond a 50 % ci-dessous est une ceinture de securite : avec
      // plancherPartEgale = 1/3 il ne peut jamais se declencher.
      const partEgale = Math.floor(alloc / cats.length);
      const unitaire = Math.round(partEgale * plancherPartEgale);

      const indicesSansHist: number[] = [];
      for (let i = 0; i < cats.length; i++) if (hist[i] <= 0) indicesSansHist.push(i);

      if (unitaire > 0 && indicesSansHist.length > 0) {
        const plafond = Math.floor(alloc * 0.5);
        const brut = unitaire * indicesSansHist.length;
        const unitaireEffectif = brut > plafond
          ? Math.floor(plafond / indicesSansHist.length)
          : unitaire;

        const planchers = new Array<number>(cats.length).fill(0);
        if (unitaireEffectif > 0) {
          for (const i of indicesSansHist) {
            planchers[i] = unitaireEffectif;
            marqueurPlancher[i] = true;
          }
        }
        const reserve = unitaireEffectif > 0 ? unitaireEffectif * indicesSansHist.length : 0;
        const restant = Math.max(0, alloc - reserve);
        const repartis = repartirEntier(restant, poids);
        montants = repartis.map((v, i) => v + planchers[i]);
      } else {
        montants = repartirEntier(alloc, poids);
      }
    } else {
      montants = repartirEntier(alloc, poids);
    }

    // R5 : garantie de somme exacte, y compris apres application des planchers.
    const controle = montants.reduce((s, v) => s + v, 0);
    if (controle !== alloc && montants.length > 0) {
      montants[montants.length - 1] += alloc - controle;
    }

    const lignes: LigneRepartition[] = cats.map((c, i) => ({
      categorieId: c.id,
      nom: c.nom,
      type,
      historique: hist[i],
      ancienMontant: anciens[i],
      nouveauMontant: montants[i],
      delta: montants[i] - anciens[i],
      plancher: marqueurPlancher[i],
      enveloppeActive: c.enveloppeActive === true,
    }));

    const sommeApres = montants.reduce((s, v) => s + v, 0);
    totalAvant += sommeAnciens;
    totalApres += sommeApres;
    nbLignesModifiees += lignes.filter(l => l.delta !== 0).length;

    blocs.push({
      type, taux, allocation: alloc, mode,
      nbCategories: cats.length,
      sommeAvant: sommeAnciens,
      sommeApres,
      allocationOrpheline: false,
      lignes,
    });
  }

  if (allocation.revenuMensuelReference <= 0) {
    bloquants.push('Revenu mensuel de reference a 0 : aucune allocation a repartir.');
  }
  for (const t of TYPES_ALLOUABLES) {
    if (!allocation.parType[t].coherent) {
      avertissements.push(
        'Type ' + t + ' : parametres_types desynchronise (montant != taux x revenu). '
        + 'Sauvegardez les taux dans Parametres avant de repartir.',
      );
    }
  }

  const montantRemisAZero = remiseAZero.reduce((s, l) => s + l.ancienMontant, 0);

  return {
    userId,
    perimetre: 'categories_actives',
    revenuMensuelReference: allocation.revenuMensuelReference,
    refAnnee, refMois, nbMoisHistorique: nbMois,
    version: allocation.version,
    blocs,
    remiseAZero,
    totalAllocation,
    totalAvant,
    totalApres,
    nbLignesModifiees,
    nbRemiseAZero: remiseAZero.length,
    montantRemisAZero,
    avertissements,
    bloquants,
    applicable: bloquants.length === 0,
  };
}

/**
 * Applique la repartition (R3-a) en UNE instruction pour les N lignes au lieu
 * de N updates sequentiels (motif P45).
 * Le garde `AND c."userId" = plan.userId` est redondant avec la construction
 * du plan : il est la pour qu un plan falsifie cote appelant ne puisse pas
 * ecrire hors du perimetre de l utilisateur. `isActive = true` garantit que la
 * passe R3-a ne peut jamais reecrire une ligne que R3-b doit remettre a zero.
 * A appeler dans un $transaction.
 */
export async function appliquerPlan(db: DbClient, plan: PlanRepartition): Promise<number> {
  const ids: string[] = [];
  const montants: string[] = [];

  for (const bloc of plan.blocs) {
    for (const ligne of bloc.lignes) {
      if (ligne.delta === 0) continue;
      ids.push(ligne.categorieId);
      montants.push(String(ligne.nouveauMontant));
    }
  }
  if (ids.length === 0) return 0;

  return db.$executeRaw`
    UPDATE categories c
    SET "montantReference" = v.montant::bigint
    FROM UNNEST(${ids}::text[], ${montants}::text[]) AS v(id, montant)
    WHERE c.id = v.id
      AND c."userId" = ${plan.userId}
      AND c."isActive" = true
  `;
}

/**
 * Applique R3-b : remet a 0 le montantReference des categories hors perimetre,
 * c est-a-dire inactives ou de type `revenu`. Sans cette passe, une categorie
 * soft-deleted conserve sa valeur P46 et redevient fausse a sa reactivation.
 */
export async function remettreAZeroHorsPerimetre(
  db: DbClient,
  plan: PlanRepartition,
): Promise<number> {
  const ids = plan.remiseAZero.map(l => l.categorieId);
  if (ids.length === 0) return 0;

  return db.$executeRaw`
    UPDATE categories c
    SET "montantReference" = 0
    WHERE c.id = ANY(${ids}::text[])
      AND c."userId" = ${plan.userId}
      AND (c."isActive" = false OR c."type" = 'revenu'::"TypeCategorie")
  `;
}

// --- Verification de l invariant R3 ------------------------------------------

export interface EcartInvariant {
  type: TypeAllouable;
  allocation: number;
  sommeCategories: number;
  ecart: number;
  nbCategories: number;
  /** Signature P46 : toutes les categories du type portent la meme valeur. */
  signatureP46: boolean;
}

export interface RapportInvariant {
  /** R3-a et R3-b tous deux satisfaits. */
  ok: boolean;
  okR3a: boolean;
  okR3b: boolean;
  ecarts: EcartInvariant[];
  /** R3-b : categories inactives ou `revenu` portant un montant non nul. */
  horsPerimetreNonNuls: number;
  montantHorsPerimetre: number;
  totalAllocation: number;
  totalCategories: number;
}

/**
 * Controle R3-a + R3-b. A appeler en diagnostic, ou juste avant le commit d un
 * write sensible. Ne corrige rien : constate. Un ecart non nul signifie qu une
 * ecriture a contourne ce module.
 */
export async function verifierInvariant(
  userId: string,
  db: DbClient = prisma,
): Promise<RapportInvariant> {
  const [allocation, categories] = await Promise.all([
    getAllocationParType(userId, db),
    db.categorie.findMany({
      where: { userId },
      select: { type: true, montantReference: true, isActive: true },
    }),
  ]);

  const ecarts: EcartInvariant[] = [];
  let totalAllocation = 0;
  let totalCategories = 0;

  for (const type of TYPES_ALLOUABLES) {
    const valeurs = categories
      .filter(c => c.type === type && c.isActive)
      .map(c => toNum(c.montantReference));
    const somme = valeurs.reduce((s, v) => s + v, 0);
    const alloc = allocation.parType[type].montant;
    totalAllocation += alloc;
    totalCategories += somme;
    ecarts.push({
      type,
      allocation: alloc,
      sommeCategories: somme,
      ecart: somme - alloc,
      nbCategories: valeurs.length,
      signatureP46:
        valeurs.length > 1 &&
        Math.min.apply(null, valeurs) === Math.max.apply(null, valeurs) &&
        Math.max.apply(null, valeurs) > 0,
    });
  }

  const hors = categories.filter(
    c => (!c.isActive || !estTypeAllouable(c.type)) && toNum(c.montantReference) !== 0,
  );
  const montantHorsPerimetre = hors.reduce((s, c) => s + toNum(c.montantReference), 0);

  const okR3a = ecarts.every(e => e.ecart === 0);
  const okR3b = hors.length === 0;

  return {
    ok: okR3a && okR3b,
    okR3a,
    okR3b,
    ecarts,
    horsPerimetreNonNuls: hors.length,
    montantHorsPerimetre,
    totalAllocation,
    totalCategories,
  };
}

// --- P122 : interpretation de l invariant (R8) --------------------------------

export interface VerdictInvariant {
  /** Ecarts imputables a un bug de calcul. Non vide => rollback obligatoire. */
  bloquants: string[];
  /** Situations metier legitimes qui rendent `ok` faux sans etre des erreurs. */
  alertes: string[];
  /** Recopie de rapport.ok, sans reinterpretation. */
  ok: boolean;
  /**
   * true quand `ok === false` est ENTIEREMENT justifie par les alertes.
   * Un HTTP 200 accompagne de `ok: false` n est acceptable que dans ce cas,
   * et seulement si les alertes sont remontees a l appelant.
   */
  explique: boolean;
}

/**
 * P122 -- ce filtre etait recopie a l identique dans trois routes :
 *   app/api/categories/route.ts:63
 *   app/api/enveloppes/repartition/route.ts:165
 *   app/api/parametres/route.ts:291
 * Chacune ne testait que R3-a AVEC categories. Deux cas restaient donc muets :
 *
 *   1. Type ORPHELIN (nbCategories === 0, allocation > 0). ecart = -allocation,
 *      donc okR3a = false. Exclu du filtre a dessein : c est une situation
 *      metier, pas un bug. Rendre ce cas bloquant fermerait l ecran Parametres
 *      a l endroit precis ou l on corrige les taux.
 *   2. R3-b. Aucun des trois filtres ne le regardait. Sur la route repartition
 *      la remise a zero est conditionnee au drapeau remiseAZeroHorsPerimetre :
 *      a false, okR3b reste legitimement faux.
 *
 * Dans les deux cas l appelant recevait `invariantOk: false` avec un HTTP 200
 * et aucune explication. Le correctif n est donc pas d elargir le filtre mais
 * de cesser d exposer un booleen qui agrege trois conditions de semantiques
 * differentes : `bloquants` declenche le rollback, `alertes` explique le 200.
 *
 * Ne fait AUCUN acces base : pure fonction du rapport. Testable seule.
 */
export function classerInvariant(rapport: RapportInvariant): VerdictInvariant {
  const bloquants: string[] = [];
  const alertes: string[] = [];

  for (const e of rapport.ecarts) {
    if (e.ecart === 0) continue;

    if (e.nbCategories > 0) {
      // Bug de calcul : une ecriture a contourne ce module, ou la repartition
      // n a pas somme juste. Comportement identique aux trois filtres remplaces.
      bloquants.push(e.type + ' (ecart ' + e.ecart + ')');
    } else {
      // nbCategories === 0 => sommeCategories === 0 => ecart === -allocation.
      alertes.push(
        'Type ' + e.type + ' : ' + e.allocation + ' FCFA alloues, aucune categorie active. '
        + 'Creez une categorie sur ce type, ou ramenez son taux a 0.',
      );
    }
  }

  if (rapport.horsPerimetreNonNuls > 0) {
    alertes.push(
      rapport.horsPerimetreNonNuls + ' categorie(s) hors perimetre portent '
      + rapport.montantHorsPerimetre + ' FCFA (R3-b). '
      + 'Relancez une repartition avec remiseAZeroHorsPerimetre pour les remettre a zero.',
    );
  }

  // Demonstration de l exhaustivite : okR3a faux implique un ecart non nul,
  // classe soit en bloquant soit en alerte ; okR3b faux implique
  // horsPerimetreNonNuls > 0, donc une alerte. Sans bloquant, `ok: false` est
  // donc toujours entierement couvert par `alertes`.
  return {
    bloquants,
    alertes,
    ok: rapport.ok,
    explique: bloquants.length === 0,
  };
}

/**
 * Message de rollback normalise, pour remplacer les trois chaines divergentes
 * construites dans les routes. `contexte` situe l operation : 'reequilibrage',
 * 'repartition', 'mise a jour des taux'.
 */
export function messageRollbackInvariant(verdict: VerdictInvariant, contexte: string): string {
  return 'Invariant R3-a rompu apres ' + contexte + ' : ' + verdict.bloquants.join(', ');
}
