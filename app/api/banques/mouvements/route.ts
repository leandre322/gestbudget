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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/banques/mouvements?limit=100&offset=0&banqueId=xxx
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const limit    = Math.min(parseInt(searchParams.get('limit')    ?? '100'), 200);
    const offset   = parseInt(searchParams.get('offset')   ?? '0');
    const banqueId = searchParams.get('banqueId');

    const where = {
      userId: session.user.id,
      ...(banqueId ? { banqueId } : {}),
    };

    const [mouvements, total] = await Promise.all([
      prisma.mouvementBanque.findMany({
        where,
        include: { banque: { select: { nomBanque: true } } },
        orderBy: { dateOperation: 'desc' },
        take:    limit,
        skip:    offset,
      }),
      prisma.mouvementBanque.count({ where }),
    ]);

    return NextResponse.json(serial({ mouvements, total }));
  } catch (e: any) {
    console.error('GET /api/banques/mouvements:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/banques/mouvements
// Impact exclusif : banques.solde
// Types supportés : ajout | retrait | set
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const body = await req.json();
    const { banqueId, typeMouvement, montant, motif, dateOperation } = body;

    // ── Validations ────────────────────────────────────────────────────────
    if (!banqueId)
      return NextResponse.json({ error: 'Compte bancaire obligatoire' }, { status: 400 });

    if (!typeMouvement || !['ajout', 'retrait', 'set'].includes(typeMouvement))
      return NextResponse.json({ error: "Type invalide : 'ajout', 'retrait' ou 'set'" }, { status: 400 });

    const mt = BigInt(Math.round(Math.max(0, Number(montant) || 0)));

    if (mt === BigInt(0) && typeMouvement !== 'set')
      return NextResponse.json({ error: 'Montant obligatoire' }, { status: 400 });

    if (typeMouvement === 'set' && !motif?.trim())
      return NextResponse.json({ error: 'Le motif est obligatoire pour une correction de solde' }, { status: 400 });

    const opDate = dateOperation ? new Date(dateOperation) : new Date();

    let mvt: any;

    try {
      mvt = await prisma.$transaction(async (tx) => {
        // Lire le solde actuel
        const banque = await tx.banque.findFirst({
          where:  { id: banqueId, userId: session.user.id },
          select: { solde: true, nomBanque: true },
        });
        if (!banque)
          throw Object.assign(new Error('BANQUE_INTROUVABLE'), { code: 404 });

        const soldeAvant = BigInt(Number(banque.solde ?? 0));
        let soldeApres:  bigint;
        let montantLog:  bigint; // montant à stocker dans l'historique

        if (typeMouvement === 'set') {
          soldeApres  = mt;
          montantLog  = mt > soldeAvant ? mt - soldeAvant : soldeAvant - mt;
        } else if (typeMouvement === 'ajout') {
          soldeApres = soldeAvant + mt;
          montantLog = mt;
        } else {
          // retrait
          if (soldeAvant < mt) {
            throw Object.assign(new Error('SOLDE_INSUFFISANT'), {
              code: 422,
              details: `${banque.nomBanque} : disponible ${Number(soldeAvant).toLocaleString('fr-FR')} FCFA, demandé ${Number(mt).toLocaleString('fr-FR')} FCFA`,
            });
          }
          soldeApres = soldeAvant - mt;
          montantLog = mt;
        }

        // Mettre à jour le solde bancaire
        await tx.banque.update({
          where: { id: banqueId },
          data:  { solde: soldeApres, updatedAt: new Date() },
        });

        // Enregistrer dans l'historique
        return await tx.mouvementBanque.create({
          data: {
            userId:        session.user.id,
            banqueId,
            typeMouvement,
            montant:       montantLog,
            soldeAvant,
            soldeApres,
            motif:         motif?.trim() || null,
            dateOperation: opDate,
          },
        });
      });
    } catch (txErr: any) {
      if (txErr.message === 'SOLDE_INSUFFISANT')
        return NextResponse.json({ error: txErr.details }, { status: 422 });
      if (txErr.message === 'BANQUE_INTROUVABLE')
        return NextResponse.json({ error: 'Banque introuvable' }, { status: 404 });
      throw txErr;
    }

    return NextResponse.json(serial({ success: true, id: mvt.id }), { status: 201 });
  } catch (e: any) {
    console.error('POST /api/banques/mouvements:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/banques/mouvements?id=xxx
// Rollback : restaure le soldeAvant stocké lors de la création
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID manquant' }, { status: 400 });

    await prisma.$transaction(async (tx) => {
      const mvt = await tx.mouvementBanque.findFirst({
        where: { id, userId: session.user.id },
      });
      if (!mvt) throw Object.assign(new Error('NOT_FOUND'), { code: 404 });

      // Restaurer le soldeAvant exact (pas de calcul inverse — snapshot fiable)
      await tx.banque.update({
        where: { id: mvt.banqueId },
        data:  { solde: mvt.soldeAvant, updatedAt: new Date() },
      });

      await tx.mouvementBanque.delete({ where: { id } });
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e.message === 'NOT_FOUND')
      return NextResponse.json({ error: 'Mouvement introuvable' }, { status: 404 });
    console.error('DELETE /api/banques/mouvements:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}
