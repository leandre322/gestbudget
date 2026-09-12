// =============================================================================
// lib/journal-banque.ts  --  I66 (S25, F17)
// =============================================================================
// Point d ecriture unique de banques.solde pour un MOUVEMENT (ajout, retrait,
// set). Tout se passe dans la transaction de l appelant :
//
//   1. Verrou de ligne (SELECT ... FOR UPDATE). Deux requetes simultanees sur
//      le meme compte sont serialisees. L ancien schema lecture-puis-ecriture,
//      en READ COMMITTED, pouvait perdre une mise a jour (double tap mobile) :
//      les deux lisaient le meme solde, la seconde ecrasait la premiere.
//   2. Propriete. La ligne n est verrouillee que si "userId" correspond : un
//      identifiant de banque d un autre compte donne BANQUE_INTROUVABLE.
//   3. Journal. La ligne mouvements_banque nait dans la meme transaction que
//      l ecriture du solde (Q14 mode B, P10). En base, chk_mvt_banque_coherent
//      verifie deja soldeApres = soldeAvant +/- montant.
//   4. Lien. decaissementId est renseigne quand le mouvement vient d un
//      decaissement (S25-Q19-a). Ces lignes ne sont pas supprimables par
//      /api/banques/mouvements (409) et sont masquees de l historique
//      fusionne (S25-Q22-a).
//
// Conventions (alignees sur /api/banques et /api/banques/mouvements) :
//   ajout   -> soldeApres = soldeAvant + montant
//   retrait -> soldeApres = soldeAvant - montant, refus si negatif (422)
//   set     -> soldeApres = montant, journalise |montant - soldeAvant|
//
// Erreurs levees (convention Object.assign des routes appelantes) :
//   BANQUE_INTROUVABLE        404
//   BANQUE_INACTIVE           422  (seulement si exigerActive)
//   SOLDE_BANQUE_INSUFFISANT  422
//   MONTANT_INVALIDE          422
//
// Hors perimetre : PUT /api/banques garde sa propre ecriture (I66-bis).
// =============================================================================

import type { Prisma } from '@prisma/client';

export type TypeMouvementBanque = 'ajout' | 'retrait' | 'set';

export interface MouvementBanqueEntree {
  userId:          string;
  banqueId:        string;
  type:            TypeMouvementBanque;
  montant:         bigint;
  motif:           string | null;
  dateOperation:   Date;
  decaissementId?: string | null;
  // true pour une NOUVELLE depense : on ne debite pas un compte desactive.
  // false pour une annulation : il faut pouvoir recrediter un compte meme
  // desactive depuis.
  exigerActive?:   boolean;
}

export interface MouvementBanqueResultat {
  mouvementId: string;
  nomBanque:   string;
  soldeAvant:  bigint;
  soldeApres:  bigint;
  montantLog:  bigint;
}

type LigneVerrouillee = { solde: bigint; nomBanque: string; isActive: boolean };

const ZERO = BigInt(0);
const fmt = (v: bigint) => Number(v).toLocaleString('fr-FR');

function erreur(message: string, code: number, details?: string): Error {
  return Object.assign(new Error(message), { code, details });
}

export async function appliquerMouvementBanque(
  tx: Prisma.TransactionClient,
  e: MouvementBanqueEntree,
): Promise<MouvementBanqueResultat> {
  if (e.montant < ZERO || (e.type !== 'set' && e.montant === ZERO)) {
    throw erreur('MONTANT_INVALIDE', 422, 'Montant invalide pour ce mouvement');
  }

  // Requete parametree (tagged template) : aucune concatenation, donc aucune
  // injection possible via banqueId ou userId.
  const lignes = await tx.$queryRaw<LigneVerrouillee[]>`
    SELECT solde, "nomBanque", "isActive"
      FROM banques
     WHERE id = ${e.banqueId}
       AND "userId" = ${e.userId}
       FOR UPDATE`;

  if (lignes.length === 0) throw erreur('BANQUE_INTROUVABLE', 404);

  const { nomBanque, isActive } = lignes[0];
  if (e.exigerActive && !isActive) {
    throw erreur('BANQUE_INACTIVE', 422, nomBanque + ' est desactivee : choisissez un autre compte.');
  }

  const soldeAvant = BigInt(lignes[0].solde);
  let soldeApres: bigint;
  let montantLog: bigint;

  if (e.type === 'ajout') {
    soldeApres = soldeAvant + e.montant;
    montantLog = e.montant;
  } else if (e.type === 'retrait') {
    if (soldeAvant < e.montant) {
      throw erreur(
        'SOLDE_BANQUE_INSUFFISANT', 422,
        nomBanque + ' : disponible ' + fmt(soldeAvant) + ' FCFA, demande ' + fmt(e.montant) +
        " FCFA. Le solde d'un compte bancaire ne peut pas etre negatif.",
      );
    }
    soldeApres = soldeAvant - e.montant;
    montantLog = e.montant;
  } else {
    soldeApres = e.montant;
    montantLog = e.montant > soldeAvant ? e.montant - soldeAvant : soldeAvant - e.montant;
  }

  await tx.banque.update({
    where: { id: e.banqueId, userId: e.userId },   // P16 : propriete portee jusqu a l ecriture
    data:  { solde: soldeApres, updatedAt: new Date() },
  });

  const mvt = await tx.mouvementBanque.create({
    data: {
      userId:         e.userId,
      banqueId:       e.banqueId,
      typeMouvement:  e.type,
      montant:        montantLog,
      soldeAvant,
      soldeApres,
      motif:          e.motif,
      dateOperation:  e.dateOperation,
      decaissementId: e.decaissementId ?? null,
    },
    select: { id: true },
  });

  return { mouvementId: mvt.id, nomBanque, soldeAvant, soldeApres, montantLog };
}
