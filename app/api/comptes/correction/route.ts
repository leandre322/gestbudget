import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { serial } from '@/lib/serial';
import { logAudit } from '@/lib/audit';
import { csrfCheck } from '@/lib/api-helpers';
import { reponsePrisma } from '@/lib/prisma-errors';
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// S26 / P176 — durcissement de cette route (differe depuis S25) :
//   CSRF   : csrfCheck(req) ajoute, en defense en profondeur (le middleware
//            couvre deja /api/*, comme partout ailleurs dans l'API - ce
//            n'etait donc pas une faille ouverte, mais une incoherence avec
//            le reste des routes financieres).
//   Zod    : CorrectionSchema local (compteId, nouveauSolde borne a
//            MONTANT_MAX, motif borne en longueur) - remplace les
//            verifications manuelles qui laissaient passer un nouveauSolde
//            non numerique jusqu'a un BigInt(NaN), qui leve un RangeError
//            brut recupere ensuite par le catch generique.
//            Reste LOCAL a ce fichier plutot que lib/validators.ts : je n'ai
//            pas relu ce fichier en entier, je prefere ne pas y ajouter un
//            export a l'aveugle (Regle 1). Deplacable plus tard si souhaite.
//   Audit  : logAudit ajoute. Le decaissement typeMouvement:'set' cree
//            ci-dessous restait la seule trace ; il n'apparaissait dans
//            aucun journal d'audit centralise, contrairement a toutes les
//            autres routes qui modifient un solde (decaissements,
//            banques/mouvements, budget).
//   Verrou : SELECT ... FOR UPDATE avant lecture du solde (meme motif que
//            I66) - sans ca, une correction et un decaissement simultanes
//            sur le meme compte peuvent lire un soldeActuel perime et
//            produire un solde final incorrect.
//   P15    : reponsePrisma() remplace `error: e?.message` - le message
//            Prisma brut (nom de colonne, contrainte SQL) ne sort plus vers
//            le client.
//
// Date de l'operation : toujours `new Date()` (aujourd'hui), jamais
// modifiable par l'appelant. Le mois courant n'est jamais verrouille
// (estMoisVerrouille ne verrouille que les mois PASSES) : aucun controle
// I69/P177 necessaire ici, par construction.
// ─────────────────────────────────────────────────────────────────────────────

const MONTANT_MAX = 1_000_000_000; // aligne sur le reste du projet (inclusif)

const CorrectionSchema = z.object({
  compteId:     z.string().min(1).max(64),
  nouveauSolde: z.coerce.number().finite().min(0).max(MONTANT_MAX),
  motif:        z.string().trim().min(1).max(500),
});

async function getOrCreateAnnee(tx: any, userId: string, annee: number) {
  let rec = await tx.annee.findUnique({ where: { userId_annee: { userId, annee } } });
  if (!rec) rec = await tx.annee.create({ data: { userId, annee } });
  return rec;
}

// POST /api/comptes/correction
// Correction inline de solde depuis le Dashboard
// Impact : comptes_fonds.soldeActuel + historique dans decaissements (typeMouvement: 'set')
// Visible dans page Ajout/Retrait avec badge ✎ Correction
export async function POST(req: NextRequest) {
  try {
    const csrfErr = csrfCheck(req);
    if (csrfErr) return csrfErr;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
    }

    const parsed = CorrectionSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Parametres invalides', errors: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { compteId, nouveauSolde, motif } = parsed.data;

    const userId   = session.user.id;
    const newSolde = BigInt(Math.round(nouveauSolde));
    const today    = new Date();
    const opAnnee  = today.getFullYear();

    let result: any;

    try {
      result = await prisma.$transaction(async (tx) => {
        // Verrou de ligne avant lecture du solde (meme motif que I66).
        const lignes = await tx.$queryRaw<{ soldeActuel: bigint; nom: string }[]>`
          SELECT "soldeActuel", nom
            FROM comptes_fonds
           WHERE id = ${compteId}
             AND "userId" = ${userId}
             FOR UPDATE`;
        const compte = lignes[0];
        if (!compte)
          throw Object.assign(new Error('COMPTE_INTROUVABLE'), { code: 404 });

        const soldeAvant = BigInt(compte.soldeActuel);
        const diff       = newSolde > soldeAvant
          ? newSolde - soldeAvant
          : soldeAvant - newSolde;

        // Mettre à jour le solde
        await tx.compteFonds.update({
          where: { id: compteId },
          data:  { soldeActuel: newSolde, updatedAt: new Date() },
        });

        // Créer l'enregistrement historique (visible dans Ajout/Retrait page)
        const anneeRec = await getOrCreateAnnee(tx, userId, opAnnee);
        const dec = await tx.decaissement.create({
          data: {
            userId,
            anneeId:         anneeRec.id,
            description:     `Correction — ${compte.nom}`,
            dateOperation:   today,
            montantTotal:    diff,
            montantFond:     diff,
            montantBanque:   BigInt(0),
            banqueId:        null,
            notes:           motif,
            typeMouvement:   'set',
            soldeAvantFond:  soldeAvant,
            soldeApresFond:  newSolde,
          },
        });

        // Répartition fond
        await tx.decaissementCompte.create({
          data: { decaissementId: dec.id, compteId, montant: diff },
        });

        return {
          decId: dec.id, nouveauSolde: Number(newSolde), ancienSolde: Number(soldeAvant), nom: compte.nom,
        };
      });
    } catch (txErr: any) {
      if (txErr.message === 'COMPTE_INTROUVABLE')
        return NextResponse.json({ error: 'Compte introuvable' }, { status: 404 });
      throw txErr;
    }

    await logAudit({
      userId,
      action:     'update',
      entityType: 'compte_fonds',
      entityId:   compteId,
      entityNom:  result.nom,
      details:    {
        ancienSolde: result.ancienSolde, nouveauSolde: result.nouveauSolde,
        motif, decaissementId: result.decId,
      },
      req,
    });

    return NextResponse.json(serial({ success: true, ...result }));
  } catch (e: any) {
    return reponsePrisma(e, 'POST /api/comptes/correction');
  }
}
