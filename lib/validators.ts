import { z } from 'zod';
import type { TypeCategorie } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// S14 — modifications de ce fichier
//   P58  nMoisUrgence : .max(60) contredisait le CHECK 1-24 pose en base en
//        S13. Une valeur de 30 passait Zod et cassait sur Postgres en 500.
//   P28  tauxReference : z.record(z.string()) acceptait n importe quelle cle,
//        y compris `revenu`, et n avait aucun plafond a 100 %.
//   Q43  scope sur les schemas budget : le Suivi et le Budget partagent
//        PUT /api/budget. Chaque ecran ne doit ecrire que sa colonne.
//        Defaut 'les_deux' = comportement actuel, donc deploiement non bloquant.
//   P40  CategorieCreateSchema / CategorieUpdateSchema : la route categories
//        parsait le body brut, sans Zod ni CSRF.
//   P56  montantReference est volontairement ABSENT de CategorieUpdateSchema.
//        Zod retire les cles inconnues, donc la valeur envoyee par
//        parametres/page.tsx est jetee au lieu d etre ecrite. montantReference
//        est derive : seul lib/reference.ts l ecrit.
//
// S24 — modifications de ce fichier
//   P120-bis  MONTANT_MAX devient une constante EXPORTEE ici (valeur inchangee,
//        1 000 000 000 — S24-Q9-a, aucune derive avec la const locale de
//        app/api/budget/route.ts, qui l importe desormais d ici). SEUL
//        app/api/quick-add/route.ts en avait reellement besoin cote Zod :
//        sa route n a pas d equivalent de versEntier() en aval. Ce fichier ne
//        borne PAS BudgetPutSchema/BudgetPostSchema avec cette constante —
//        une premiere version de ce tour le faisait, revert explique dans le
//        bloc de commentaire au-dessus de ces deux schemas plus bas.
//
// S25 — modifications de ce fichier (F17)
//   DecaissementSchema : mode 'banque' (S25-Q7, Q13). Depense payee depuis un
//        compte bancaire, sans fonds : banqueId + montantBanque obligatoires,
//        compteId / montantFond interdits, retrait uniquement.
//   BanqueDefautSchema : PUT /api/parametres/banque-defaut (S25-Q9-b, Q25-b).
//        banqueId null explicite = retirer le compte par defaut.
//   PaginationSchema, DecaissementListeSchema, MouvementListeSchema (P171) :
//        limit / offset / annee passaient par parseInt sans garde ;
//        ?limit=abc donnait take: NaN, donc une erreur Prisma et un 500.
// ─────────────────────────────────────────────────────────────────────────────

// Doit rester identique a TYPES_ALLOUABLES de lib/reference.ts.
// L import est volontairement absent : lib/reference importe le client Prisma,
// et ce fichier doit rester utilisable hors contexte serveur. Le garde de
// compilation ci-dessous echoue si un membre de l enum est renomme.
const TYPES_ALLOUABLES_ZOD = [
  'epargne_precaution',
  'epargne_investissement',
  'epargne_autre',
  'depense_fixe',
  'depense_variable',
  'depense_occasionnelle',
  'remboursement_dette',
] as const;

const TOUS_TYPES_ZOD = ['revenu', ...TYPES_ALLOUABLES_ZOD] as const;

const _coherenceAllouables: readonly TypeCategorie[] = TYPES_ALLOUABLES_ZOD;
const _coherenceTous: readonly TypeCategorie[] = TOUS_TYPES_ZOD;
void _coherenceAllouables;
void _coherenceTous;

// ─────────────────────────────────────────────────────────────────────────────
// Pagination des listes — S25 / P171
// Les routes passent `searchParams.get(x) ?? undefined` : un parametre absent
// doit arriver en undefined pour que .default() s applique (null serait
// coerce en 0 et echouerait sur min(1)).
// ─────────────────────────────────────────────────────────────────────────────
export const PaginationSchema = z.object({
  limit:  z.coerce.number().int().min(1).max(10_000).default(100),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const DecaissementListeSchema = PaginationSchema.extend({
  annee: z.coerce.number().int().min(2000).max(2100).optional(),
});

// inclureLies : les lignes de journal nees d un decaissement (decaissementId
// renseigne) sont masquees par defaut — l historique fusionne d Ajout / Retrait
// Fonds affiche deja le decaissement lui-meme (S25-Q22-a). '1' les inclut,
// pour un historique propre a une banque.
export const MouvementListeSchema = PaginationSchema.extend({
  banqueId:    z.string().min(1).max(64).optional(),
  inclureLies: z.enum(['0', '1']).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Decaissement — S7 FIX
//   1. banqueId / compteId / notes en .nullish() : le front envoie `null`
//      explicitement, et .optional() n'accepte QUE `undefined` (bug Zod 4).
//   2. `mode` explicite ('fond' | 'transfert' | 'banque') : le serveur ne
//      DEDUIT plus l'intention a partir de la presence des champs.
//   3. superRefine : coherence mode / banqueId / montants.
// S25 / F17 : mode 'banque' ajoute (voir en-tete).
// ─────────────────────────────────────────────────────────────────────────────
export const DecaissementSchema = z.object({
  mode:           z.enum(['fond', 'transfert', 'banque']).default('fond'),
  impacterBanque: z.boolean().nullish(),
  description:    z.string().min(1, 'Description requise').max(200).trim(),
  dateOperation:  z.string().refine(v => !isNaN(Date.parse(v)), 'Date invalide'),
  montantFond:    z.number().min(0).max(999_999_999).optional().default(0),
  montantBanque:  z.number().min(0).max(999_999_999).optional().default(0),
  banqueId:       z.string().min(1).nullish(),
  compteId:       z.string().min(1).nullish(),
  notes:          z.string().max(500).nullish(),
  typeMouvement:  z.enum(['retrait', 'ajout']).default('retrait'),
  sourceVocale:   z.boolean().optional().default(false), // D1 — dictee vocale
}).superRefine((v, ctx) => {
  // S25 / F17 — mode « Banque seule » : depense payee depuis un compte
  // bancaire, aucun fond touche. Retrait uniquement (S25-Q13) : les ajouts
  // bancaires passent par /api/banques/mouvements.
  if (v.mode === 'banque') {
    if (!v.banqueId) {
      ctx.addIssue({ code: 'custom', path: ['banqueId'], message: 'Selectionnez un compte bancaire' });
    }
    if (!v.montantBanque || v.montantBanque <= 0) {
      ctx.addIssue({ code: 'custom', path: ['montantBanque'], message: 'Montant obligatoire' });
    }
    if (v.compteId) {
      ctx.addIssue({ code: 'custom', path: ['compteId'], message: 'Aucun fond attendu en mode Banque' });
    }
    if (v.montantFond && v.montantFond > 0) {
      ctx.addIssue({ code: 'custom', path: ['montantFond'], message: 'Aucun montant fond attendu en mode Banque' });
    }
    if (v.typeMouvement !== 'retrait') {
      ctx.addIssue({ code: 'custom', path: ['typeMouvement'], message: 'Le mode Banque accepte uniquement un retrait' });
    }
    return;
  }

  // Modes « Fond seul » et « Fond + Banque » : un fond et un montant fond
  // sont obligatoires (regles S7 inchangees)
  if (!v.compteId) {
    ctx.addIssue({ code: 'custom', path: ['compteId'], message: 'Selectionnez un fond' });
  }
  if (!v.montantFond || v.montantFond <= 0) {
    ctx.addIssue({ code: 'custom', path: ['montantFond'], message: 'Montant du fond obligatoire' });
  }

  // Mode « Fond seul » : aucune banque ne doit etre impliquee
  if (v.mode === 'fond') {
    if (v.banqueId) {
      ctx.addIssue({ code: 'custom', path: ['banqueId'], message: 'Aucune banque attendue en mode Fond seul' });
    }
    if (v.montantBanque && v.montantBanque > 0) {
      ctx.addIssue({ code: 'custom', path: ['montantBanque'], message: 'Aucun montant banque attendu en mode Fond seul' });
    }
  }

  // Mode « Fond + Banque » : banque ET montant banque obligatoires
  if (v.mode === 'transfert') {
    if (!v.banqueId) {
      ctx.addIssue({ code: 'custom', path: ['banqueId'], message: 'Selectionnez une banque' });
    }
    if (!v.montantBanque || v.montantBanque <= 0) {
      ctx.addIssue({ code: 'custom', path: ['montantBanque'], message: 'Montant banque obligatoire pour un transfert' });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Mouvement bancaire (mode « Banque seule ») — S7 NOUVEAU
// Cette route parsait le body brut : `motif` sans limite de taille,
// `dateOperation` non validee (Invalid Date envoye a Prisma), banqueId non type.
// ─────────────────────────────────────────────────────────────────────────────
export const BanqueMouvementSchema = z.object({
  banqueId:      z.string().min(1, 'Compte bancaire obligatoire'),
  typeMouvement: z.enum(['ajout', 'retrait', 'set']),
  montant:       z.number().min(0).max(9_999_999_999).optional().default(0),
  motif:         z.string().max(500).nullish(),
  dateOperation: z.string().refine(v => !isNaN(Date.parse(v)), 'Date invalide').nullish(),
}).superRefine((v, ctx) => {
  if (v.typeMouvement !== 'set' && (!v.montant || v.montant <= 0)) {
    ctx.addIssue({ code: 'custom', path: ['montant'], message: 'Montant obligatoire' });
  }
  if (v.typeMouvement === 'set' && !v.motif?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['motif'], message: 'Le motif est obligatoire pour une correction de solde' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Compte bancaire par defaut — S25 / F17 (Q9-b, Q20-a, Q25-b)
// null explicite = retirer le compte par defaut. La cle doit etre presente :
// un body vide ne doit pas effacer la valeur en silence.
// ─────────────────────────────────────────────────────────────────────────────
export const BanqueDefautSchema = z.object({
  banqueId: z.string().min(1).max(64).nullable(),
});

export const CompteFondsUpdateSchema = z.object({
  nom:         z.string().min(1).max(100).trim().optional(),
  ordre:       z.number().int().min(0).max(100).optional(),
  isActive:    z.boolean().optional(),
  objectif:    z.number().min(0).max(9_999_999_999).optional(),
  seuilAlerte: z.number().min(0).max(9_999_999_999).optional(),
  action:      z.enum(['increment','decrement','set']).optional(),
  montant:     z.number().min(0).max(9_999_999_999).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Banque — S12 / P8
// Avant : ce schema etait importe par app/api/banques/route.ts mais JAMAIS
// appele. Le PUT parsait le body brut, donc `montant: "abc"` atteignait
// BigInt(Math.round(NaN)) et sortait en RangeError -> 500 avec un message
// Prisma brut renvoye au client.
//
// Regles superRefine :
//   1. `montant` sans `action` est ambigu (increment ? correction ?) -> rejet.
//   2. `action` sans `montant` -> rejet.
//   3. increment / decrement exigent un montant strictement positif ;
//      `set` accepte 0 (remise a zero volontaire d'un compte).
//   4. `action:'set'` et `solde` simultanes = deux sources pour la meme
//      valeur -> rejet plutot que priorite implicite.
//   5. Un PUT sans aucun champ exploitable est rejete : il produisait une
//      ecriture updatedAt seule et une ligne d'audit vide.
// ─────────────────────────────────────────────────────────────────────────────
export const BanqueUpdateSchema = z.object({
  nomBanque:     z.string().min(1).max(100).trim().optional(),
  typeCompte:    z.string().max(50).nullish(),
  seuilAlerte:   z.number().int().min(0).max(9_999_999_999).optional(),
  isActive:      z.boolean().optional(),
  ordre:         z.number().int().min(0).max(100).optional(),
  roleEpargne:   z.enum(['aucun', 'urgence', 'precaution']).optional(),
  action:        z.enum(['set','increment','decrement']).optional(),
  montant:       z.number().int().min(0).max(9_999_999_999).optional(),
  solde:         z.number().int().min(0).max(9_999_999_999).optional(),
  motif:         z.string().max(500).nullish(),
}).superRefine((v, ctx) => {
  const aMontant = v.montant !== undefined;
  const aAction  = v.action  !== undefined;
  const aSolde   = v.solde   !== undefined;

  if (aMontant && !aAction) {
    ctx.addIssue({ code: 'custom', path: ['action'], message: "Precisez l'action (set, increment ou decrement)" });
  }
  if (aAction && !aMontant) {
    ctx.addIssue({ code: 'custom', path: ['montant'], message: 'Montant obligatoire pour cette action' });
  }
  if (aAction && aMontant && v.action !== 'set' && (v.montant ?? 0) <= 0) {
    ctx.addIssue({ code: 'custom', path: ['montant'], message: 'Montant strictement positif requis' });
  }
  if (aSolde && v.action === 'set') {
    ctx.addIssue({ code: 'custom', path: ['solde'], message: "Utilisez soit action:'set' + montant, soit solde, pas les deux" });
  }
  if (aSolde && aAction && v.action !== 'set') {
    ctx.addIssue({ code: 'custom', path: ['solde'], message: 'solde est incompatible avec increment / decrement' });
  }

  const champs = [
    v.nomBanque, v.typeCompte, v.seuilAlerte, v.isActive,
    v.ordre, v.roleEpargne, v.action, v.solde,
  ];
  if (champs.every(c => c === undefined)) {
    ctx.addIssue({ code: 'custom', path: [], message: 'Aucun champ a modifier' });
  }
});

export const PushSendSchema = z.object({
  title: z.string().min(1).max(100),
  body:  z.string().min(1).max(200),
  url:   z.string().optional(),
  tag:   z.string().max(50).optional(),
});

export const RegisterSchema = z.object({
  email:    z.string().email('Email invalide').toLowerCase().trim(),
  password: z.string().min(8,'Minimum 8 caracteres')
              .regex(/[A-Z]/,'Une majuscule requise')
              .regex(/[0-9]/,'Un chiffre requis'),
  nom:      z.string().min(1).max(100).trim().optional(),
});

// S12 / P8 — le POST parsait lui aussi le body brut : `soldeInitial: "abc"`
// atteignait BigInt() sans filtre. Defauts alignes sur prisma/schema.prisma
// (compteUrgence @default(true), seuilAlerte @default(0)).
export const BanqueCreateSchema = z.object({
  nomBanque:     z.string().min(1).max(100).trim().optional().default('Nouvelle banque'),
  typeCompte:    z.string().max(50).nullish(),
  soldeInitial:  z.number().int().min(0).max(9_999_999_999).optional().default(0),
  ordre:         z.number().int().min(0).max(100).optional().default(0),
  seuilAlerte:   z.number().int().min(0).max(9_999_999_999).optional().default(0),
  roleEpargne:   z.enum(['aucun', 'urgence', 'precaution']).optional().default('aucun'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Parametres — S14
// nMoisUrgence : borne alignee sur le CHECK Postgres 1-24 (P58).
// tauxReference : cles restreintes aux 7 types allouables et somme plafonnee
//   a 100 % (P28 / I5). Le controle est duplique cote route via
//   validerSomme() de lib/reference.ts, qui reste la reference : ce
//   superRefine est une defense en profondeur, pas la source de la regle.
// ─────────────────────────────────────────────────────────────────────────────
export const ParametresSchema = z.object({
  revenuMensuelReference: z.number().min(0).max(9_999_999_999).optional(),
  nMoisUrgence:           z.number().int().min(1).max(24).optional(),
  nMoisPrecaution:        z.number().int().min(1).max(12).optional(),
  tauxReference:          z.record(z.string(), z.number().min(0).max(100)).optional(),
  rapportEmailActif:      z.boolean().optional(),
  rapportEmailJour:       z.number().int().min(1).max(28).optional(),
  rapportEmailHeure:      z.number().int().min(0).max(23).optional(),
  seuilAnomaliesPct:      z.number().int().min(10).max(200).optional(),
  langueVocale:           z.string().max(10).optional(), // D1 — dictee vocale
}).superRefine((v, ctx) => {
  if (v.tauxReference === undefined) return;

  const autorises = TYPES_ALLOUABLES_ZOD as readonly string[];
  let total = 0;

  for (const [cle, valeur] of Object.entries(v.tauxReference)) {
    if (!autorises.includes(cle)) {
      ctx.addIssue({
        code: 'custom', path: ['tauxReference', cle],
        message: 'Type non allouable : ' + cle,
      });
      continue;
    }
    total += valeur;
  }

  // Tolerance 0,005 : les taux sont saisis a deux decimales.
  if (Math.round(total * 100) / 100 > 100.005) {
    ctx.addIssue({
      code: 'custom', path: ['tauxReference'],
      message: 'Allocation totale ' + total.toFixed(2) + ' %, plafond 100 %',
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Budget — S14 / Q43
// `scope` decide quelles colonnes la route ecrit :
//   'previsionnel' -> montantAnticipe seul  (ecran Budget)
//   'suivi'        -> montantReel seul      (ecran Suivi, Quick Add, modale)
//   'les_deux'     -> comportement historique, defaut pour ne rien casser
// `annee` est accepte en alternative a `anneeId` : il permet a la route de
// creer la ligne Annee au moment de l ECRITURE, et donc au GET de cesser
// d ecrire sur une lecture (P55).
//
// MONTANT_MAX — S24 / P120-bis (S24-Q9-a). Source unique du plafond sur
// budget_mensuel, reprise telle quelle de app/api/budget/route.ts (qui
// l importe desormais d ici au lieu de la redeclarer localement).
//
// CE FICHIER NE BORNE PAS montantAnticipe/montantReel/lignes[].anticipe|reel
// avec MONTANT_MAX. Une premiere version de ce tour le faisait ; revert apres
// lecture de app/api/budget/route.ts (obtenue apres coup, fichier normalement
// hors recollage). Sa fonction versEntier() gere deja tout le necessaire en
// amont de BigInt() :
//   - Number.isFinite(n) rejette NaN ET Infinity ('non_numerique') AVANT
//     Math.trunc/BigInt — contrairement a toNum() de l import Excel, qui
//     teste isNaN() (faux pour Infinity) et atteint BigInt(Infinity) =
//     RangeError (P135, confirme, distinct de ce fichier) ;
//   - negatif et hors-plafond sont deja refuses explicitement, avec une
//     reponse 422 detaillee (plafond + motif par categorie/champ) que le
//     front consomme vraisemblablement.
// Ajouter une borne Zod ici interceptait ces cas plus tot mais sous un format
// plus pauvre (celui, generique, de validateBody/Zod) — une regression de
// contrat silencieuse plutot qu un gain. BudgetPostSchema garde donc son
// plafond historique 9 999 999 999 (garde-fou de type large, comme ses
// voisines BanqueUpdateSchema etc. — jamais la regle metier reelle, que la
// route seule applique) ; BudgetPutSchema reste sans borne Zod sur les
// montants, versEntier() etant deja l unique autorite sur ce champ.
// ─────────────────────────────────────────────────────────────────────────────
export const MONTANT_MAX = 1_000_000_000;

export const BudgetScope = z.enum(['previsionnel', 'suivi', 'les_deux']);

const MontantSaisi = z.union([z.string(), z.number()]);

export const BudgetPutSchema = z.object({
  anneeId: z.string().min(1).optional(),
  annee:   z.number().int().min(2000).max(2100).optional(),
  mois:    z.number().int().min(1).max(12),
  scope:   BudgetScope.optional().default('les_deux'),
  lignes:  z.record(z.string(), z.object({
    anticipe: MontantSaisi.optional(),
    reel:     MontantSaisi.optional(),
  })).refine(l => Object.keys(l).length <= 500, 'Trop de lignes (500 maximum)'),
}).superRefine((v, ctx) => {
  if (!v.anneeId && v.annee === undefined) {
    ctx.addIssue({ code: 'custom', path: ['anneeId'], message: 'anneeId ou annee requis' });
  }
});

export const BudgetPostSchema = z.object({
  anneeId:         z.string().min(1).optional(),
  annee:           z.number().int().min(2000).max(2100).optional(),
  categorieId:     z.string().min(1),
  mois:            z.number().int().min(1).max(12),
  scope:           BudgetScope.optional().default('les_deux'),
  montantAnticipe: z.number().min(0).max(9_999_999_999).optional(),
  montantReel:     z.number().min(0).max(9_999_999_999).optional(),
  notes:           z.string().max(500).nullish(),
}).superRefine((v, ctx) => {
  if (!v.anneeId && v.annee === undefined) {
    ctx.addIssue({ code: 'custom', path: ['anneeId'], message: 'anneeId ou annee requis' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Categories — S14 / P40, P56
// montantReference est volontairement absent : Zod retire les cles inconnues,
// donc la valeur envoyee par le front est jetee. Cette colonne est derivee de
// parametres_types et n est ecrite que par lib/reference.ts.
// ─────────────────────────────────────────────────────────────────────────────
export const CategorieCreateSchema = z.object({
  nom:             z.string().min(1, 'Nom requis').max(100).trim(),
  type:            z.enum(TOUS_TYPES_ZOD),
  sousType:        z.string().max(100).nullish(),
  ordre:           z.number().int().min(0).max(1000).optional().default(0),
  compteFondsId:   z.string().min(1).nullish(),
  banqueId:        z.string().min(1).nullish(),
  enveloppeActive: z.boolean().optional().default(false),
});

export const CategorieUpdateSchema = z.object({
  id:              z.string().min(1, 'Identifiant requis'),
  nom:             z.string().min(1).max(100).trim().optional(),
  type:            z.enum(TOUS_TYPES_ZOD).optional(),
  sousType:        z.string().max(100).nullish(),
  ordre:           z.number().int().min(0).max(1000).optional(),
  isActive:        z.boolean().optional(),
  compteFondsId:   z.string().min(1).nullish(),
  banqueId:        z.string().min(1).nullish(),
  enveloppeActive: z.boolean().optional(),
}).superRefine((v, ctx) => {
  const champs = [
    v.nom, v.type, v.sousType, v.ordre, v.isActive,
    v.compteFondsId, v.banqueId, v.enveloppeActive,
  ];
  if (champs.every(c => c === undefined)) {
    ctx.addIssue({ code: 'custom', path: [], message: 'Aucun champ a modifier' });
  }
});
