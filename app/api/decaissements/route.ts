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

// GET /api/decaissements?annee=2026
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const anneeParam = searchParams.get('annee');
    const annee = anneeParam ? parseInt(anneeParam) : null;

    const comptes = await prisma.compteFonds.findMany({
      where:   { userId: session.user.id, isActive: true },
      orderBy: { ordre: 'asc' },
    });

    let anneeRec = null;
    if (annee) {
      anneeRec = await prisma.annee.findUnique({
        where: { userId_annee: { userId: session.user.id, annee } },
      });
    }

    const whereClause = anneeRec
      ? { userId: session.user.id, anneeId: anneeRec.id }
      : { userId: session.user.id };

    const decaissements = await prisma.decaissement.findMany({
      where:   whereClause,
      include: { repartitions: { include: { compte: true } } },
      orderBy: { dateOperation: 'desc' },
      take:    100, // Limiter à 100 pour la perf
    });

    return NextResponse.json(serial({
      comptes,
      decaissements,
      anneeId: anneeRec?.id ?? null,
    }));
  } catch (e: any) {
    console.error('GET /api/decaissements:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}

// POST /api/decaissements — Créer + impacter les soldes
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const {
      anneeId, description, dateOperation,
      montantTotal, repartitions, notes,
      typeMouvement,
      // ── Nouveaux champs pour impact soldes ──
      compteId,      // fond ciblé (pour mise à jour soldeActuel)
      banqueId,      // banque impactée (optionnel)
      impacterBanque,// boolean
    } = await req.json();

    if (!description || !dateOperation || !montantTotal) {
      return NextResponse.json({ error: 'Champs obligatoires manquants' }, { status: 400 });
    }

    const montantBigInt  = BigInt(Math.round(Number(montantTotal)));
    const mouvType       = typeMouvement ?? 'retrait';
    const isAjout        = mouvType === 'ajout';

    // ── 1. Créer le décaissement ──────────────────────────────────────────
    const dec = await prisma.decaissement.create({
      data: {
        userId:        session.user.id,
        anneeId:       anneeId ?? null,
        description,
        dateOperation: new Date(dateOperation),
        montantTotal:  montantBigInt,
        notes:         notes ?? null,
        typeMouvement: mouvType,
      },
    });

    // ── 2. Créer les répartitions par compte fond ─────────────────────────
    if (repartitions && Object.keys(repartitions).length > 0) {
      const reps = Object.entries(repartitions as Record<string, string>)
        .filter(([_, v]) => parseInt(v) > 0)
        .map(([cid, montant]) => ({
          decaissementId: dec.id,
          compteId:       cid,
          montant:        BigInt(parseInt(montant)),
        }));
      if (reps.length > 0) {
        await prisma.decaissementCompte.createMany({ data: reps });
      }
    }

    // ── 3. Mettre à jour le solde du CompteFonds ciblé ───────────────────
    if (compteId) {
      // Vérifier que le compte appartient à l'utilisateur
      const compte = await prisma.compteFonds.findFirst({
        where: { id: compteId, userId: session.user.id },
        select: { soldeActuel: true },
      });
      if (compte) {
        const soldeActuel = BigInt(Number(compte.soldeActuel ?? 0));
        const newSolde    = isAjout
          ? soldeActuel + montantBigInt
          : soldeActuel - montantBigInt;

        await prisma.compteFonds.update({
          where: { id: compteId },
          data:  { soldeActuel: newSolde < BigInt(0) ? BigInt(0) : newSolde, updatedAt: new Date() },
        });
      }
    }

    // ── 4. Mettre à jour le solde bancaire (optionnel, flux inverse) ──────
    // Ajout fond  → argent sort de la banque (banque diminue)
    // Retrait fond → argent revient en banque (banque augmente)
    if (impacterBanque && banqueId) {
      const banque = await prisma.banque.findFirst({
        where: { id: banqueId, userId: session.user.id },
        select: { solde: true },
      });
      if (banque) {
        const soldeBanque = BigInt(Number(banque.solde ?? 0));
        const newSoldeBanque = isAjout
          ? soldeBanque - montantBigInt  // ajout fond = sortie banque
          : soldeBanque + montantBigInt; // retrait fond = entrée banque

        await prisma.banque.update({
          where: { id: banqueId },
          data:  { solde: newSoldeBanque < BigInt(0) ? BigInt(0) : newSoldeBanque, updatedAt: new Date() },
        });
      }
    }

    return NextResponse.json(serial({ success: true, id: dec.id }), { status: 201 });
  } catch (e: any) {
    console.error('POST /api/decaissements:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}

// DELETE /api/decaissements?id=xxx
// Note : la suppression annule le mouvement sur les soldes
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID manquant' }, { status: 400 });

    // Récupérer le décaissement avant suppression pour annuler l'impact
    const dec = await prisma.decaissement.findFirst({
      where:   { id, userId: session.user.id },
      include: { repartitions: true },
    });
    if (!dec) return NextResponse.json({ error: 'Décaissement introuvable' }, { status: 404 });

    const montantBigInt = BigInt(Number(dec.montantTotal ?? 0));
    const isAjout       = dec.typeMouvement === 'ajout';

    // ── Annuler l'impact sur les CompteFonds ─────────────────────────────
    for (const rep of dec.repartitions) {
      const compte = await prisma.compteFonds.findFirst({
        where:  { id: rep.compteId, userId: session.user.id },
        select: { soldeActuel: true },
      });
      if (compte) {
        const repMontant  = BigInt(Number(rep.montant ?? 0));
        const soldeActuel = BigInt(Number(compte.soldeActuel ?? 0));
        // Inverser : si c'était un ajout, on soustrait ; si retrait, on ajoute
        const newSolde    = isAjout
          ? soldeActuel - repMontant
          : soldeActuel + repMontant;

        await prisma.compteFonds.update({
          where: { id: rep.compteId },
          data:  { soldeActuel: newSolde < BigInt(0) ? BigInt(0) : newSolde, updatedAt: new Date() },
        });
      }
    }

    // ── Supprimer le décaissement (cascade sur repartitions) ─────────────
    await prisma.decaissement.delete({
      where: { id, userId: session.user.id },
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('DELETE /api/decaissements:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}
