import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

function serial(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return Number(obj);
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(serial);
  if (typeof obj === 'object') {
    const r: any = {};
    for (const k of Object.keys(obj)) r[k] = serial(obj[k]);
    return r;
  }
  return obj;
}

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
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const body = await req.json();
    const { compteId, nouveauSolde, motif } = body;

    if (!compteId)
      return NextResponse.json({ error: 'compteId obligatoire' }, { status: 400 });
    if (nouveauSolde === undefined || nouveauSolde === null)
      return NextResponse.json({ error: 'nouveauSolde obligatoire' }, { status: 400 });
    if (!motif?.trim())
      return NextResponse.json({ error: 'Motif obligatoire pour une correction' }, { status: 400 });

    const newSolde = BigInt(Math.round(Math.max(0, Number(nouveauSolde))));
    const today    = new Date();
    const opAnnee  = today.getFullYear();

    let result: any;

    try {
      result = await prisma.$transaction(async (tx) => {
        const compte = await tx.compteFonds.findFirst({
          where:  { id: compteId, userId: session.user.id },
          select: { soldeActuel: true, nom: true },
        });
        if (!compte)
          throw Object.assign(new Error('COMPTE_INTROUVABLE'), { code: 404 });

        const soldeAvant = BigInt(Number(compte.soldeActuel ?? 0));
        const diff       = newSolde > soldeAvant
          ? newSolde - soldeAvant
          : soldeAvant - newSolde;

        // Mettre à jour le solde
        await tx.compteFonds.update({
          where: { id: compteId },
          data:  { soldeActuel: newSolde, updatedAt: new Date() },
        });

        // Créer l'enregistrement historique (visible dans Ajout/Retrait page)
        const anneeRec = await getOrCreateAnnee(tx, session.user.id, opAnnee);
        const dec = await tx.decaissement.create({
          data: {
            userId:          session.user.id,
            anneeId:         anneeRec.id,
            description:     `Correction — ${compte.nom}`,
            dateOperation:   today,
            montantTotal:    diff,
            montantFond:     diff,
            montantBanque:   BigInt(0),
            banqueId:        null,
            notes:           motif.trim(),
            typeMouvement:   'set',
            soldeAvantFond:  soldeAvant,
            soldeApresFond:  newSolde,
          },
        });

        // Répartition fond
        await tx.decaissementCompte.create({
          data: { decaissementId: dec.id, compteId, montant: diff },
        });

        return { nouveauSolde: Number(newSolde), ancienSolde: Number(soldeAvant), nom: compte.nom };
      });
    } catch (txErr: any) {
      if (txErr.message === 'COMPTE_INTROUVABLE')
        return NextResponse.json({ error: 'Compte introuvable' }, { status: 404 });
      throw txErr;
    }

    return NextResponse.json(serial({ success: true, ...result }));
  } catch (e: any) {
    console.error('POST /api/comptes/correction:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}
