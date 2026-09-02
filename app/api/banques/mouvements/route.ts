import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { serial } from '@/lib/serial';
import { logAudit } from '@/lib/audit';
import { csrfCheck, validateBody } from '@/lib/api-helpers';
import { BanqueMouvementSchema } from '@/lib/validators';

const fmt = (v: bigint) => Number(v).toLocaleString('fr-FR');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/banques/mouvements?limit=100&offset=0&banqueId=xxx
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const limit    = Math.min(parseInt(searchParams.get('limit')  ?? '100'), 200);
    const offset   = parseInt(searchParams.get('offset') ?? '0');
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
    // S7 : detail logue cote serveur, jamais renvoye au client
    console.error('GET /api/banques/mouvements:', e?.message, e?.stack);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/banques/mouvements
// Impact exclusif : banques.solde
// Types supportes : ajout | retrait | set
// S7 : validation Zod (le body etait parse brut), CSRF, audit, 500 sanitises
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const csrfErr = csrfCheck(req);
    if (csrfErr) return csrfErr;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
    }

    const parsed = validateBody(BanqueMouvementSchema, rawBody);
    if (parsed.error) return parsed.error;
    const { banqueId, typeMouvement, montant, motif, dateOperation } = parsed.data;

    const mt     = BigInt(Math.round(Math.max(0, Number(montant) || 0)));
    const opDate = dateOperation ? new Date(dateOperation) : new Date();

    let mvt: any;

    try {
      mvt = await prisma.$transaction(async (tx) => {
        const banque = await tx.banque.findFirst({
          where:  { id: banqueId, userId: session.user.id },
          select: { solde: true, nomBanque: true },
        });
        if (!banque)
          throw Object.assign(new Error('BANQUE_INTROUVABLE'), { code: 404 });

        const soldeAvant = BigInt(Number(banque.solde ?? 0));
        let soldeApres: bigint;
        let montantLog: bigint; // montant a stocker dans l'historique

        if (typeMouvement === 'set') {
          soldeApres = mt;
          montantLog = mt > soldeAvant ? mt - soldeAvant : soldeAvant - mt;
        } else if (typeMouvement === 'ajout') {
          soldeApres = soldeAvant + mt;
          montantLog = mt;
        } else {
          // retrait — un solde bancaire ne peut pas devenir negatif
          if (soldeAvant < mt) {
            throw Object.assign(new Error('SOLDE_INSUFFISANT'), {
              code: 422,
              details: `${banque.nomBanque} : disponible ${fmt(soldeAvant)} FCFA, demande ${fmt(mt)} FCFA. Le solde d'un compte bancaire ne peut pas etre negatif.`,
            });
          }
          soldeApres = soldeAvant - mt;
          montantLog = mt;
        }

        await tx.banque.update({
          where: { id: banqueId },
          data:  { solde: soldeApres, updatedAt: new Date() },
        });

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

    // S7 : cette route modifiait des soldes bancaires sans laisser de trace
    await logAudit({
      userId:     session.user.id,
      action:     typeMouvement === 'set' ? 'update' : 'create',
      entityType: 'mouvement_banque',
      entityId:   mvt.id,
      entityNom:  motif?.trim() || typeMouvement,
      req,
    });

    return NextResponse.json(serial({ success: true, id: mvt.id }), { status: 201 });
  } catch (e: any) {
    console.error('POST /api/banques/mouvements:', e?.message, e?.stack);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/banques/mouvements?id=xxx
// S7 FIX CRITIQUE — rollback par DELTA.
//
// L'ancienne version restaurait `mvt.soldeAvant` en absolu. Ce snapshot n'est
// exact que pour le DERNIER mouvement du compte. Exemple :
//   solde 100 000 -> A (retrait 10 000, soldeAvant=100 000) -> B (ajout 50 000)
//   solde reel 140 000. Supprimer A ecrasait le solde a 100 000 :
//   l'ajout B de 50 000 disparaissait purement et simplement.
//
// Le delta compose correctement quel que soit l'ordre, et couvre les trois
// types (ajout / retrait / set) sans distinction de cas :
//   nouveauSolde = soldeActuel - (soldeApres - soldeAvant)
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const csrfErr = csrfCheck(req);
    if (csrfErr) return csrfErr;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID manquant' }, { status: 400 });

    await prisma.$transaction(async (tx) => {
      const mvt = await tx.mouvementBanque.findFirst({
        where: { id, userId: session.user.id },
      });
      if (!mvt) throw Object.assign(new Error('NOT_FOUND'), { code: 404 });

      const banque = await tx.banque.findFirst({
        where:  { id: mvt.banqueId, userId: session.user.id },
        select: { solde: true, nomBanque: true },
      });
      if (!banque) throw Object.assign(new Error('BANQUE_INTROUVABLE'), { code: 404 });

      const soldeActuel = BigInt(Number(banque.solde ?? 0));
      const delta       = BigInt(Number(mvt.soldeApres ?? 0)) - BigInt(Number(mvt.soldeAvant ?? 0));
      const rawApres    = soldeActuel - delta;

      if (rawApres < BigInt(0)) {
        throw Object.assign(new Error('ROLLBACK_NEGATIF'), {
          code: 422,
          details: `Annulation impossible : ${banque.nomBanque} tomberait a ${fmt(rawApres)} FCFA. Des operations posterieures ont deja consomme ce montant.`,
        });
      }

      await tx.banque.update({
        where: { id: mvt.banqueId },
        data:  { solde: rawApres, updatedAt: new Date() },
      });

      await tx.mouvementBanque.delete({ where: { id } });
    });

    await logAudit({
      userId:     session.user.id,
      action:     'delete',
      entityType: 'mouvement_banque',
      entityId:   id,
      req,
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e.message === 'NOT_FOUND')
      return NextResponse.json({ error: 'Mouvement introuvable' }, { status: 404 });
    if (e.message === 'BANQUE_INTROUVABLE')
      return NextResponse.json({ error: 'Banque introuvable' }, { status: 404 });
    if (e.message === 'ROLLBACK_NEGATIF')
      return NextResponse.json({ error: e.details }, { status: 422 });
    console.error('DELETE /api/banques/mouvements:', e?.message, e?.stack);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
