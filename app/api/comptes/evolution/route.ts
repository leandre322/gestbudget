import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

const MOIS_COURTS = ['','Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

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

// GET /api/comptes/evolution?id=xxx
// Retourne 12 mois de données de contribution pour un fond
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const compteId = new URL(req.url).searchParams.get('id');
    if (!compteId)
      return NextResponse.json({ error: 'id manquant' }, { status: 400 });

    const userId = session.user.id;

    // ── Charger le fond ──────────────────────────────────────────────────────
    const compte = await prisma.compteFonds.findFirst({
      where:  { id: compteId, userId },
      select: { id: true, nom: true, soldeActuel: true, objectif: true },
    });
    if (!compte)
      return NextResponse.json({ error: 'Compte introuvable' }, { status: 404 });

    // ── Décaissements des 13 derniers mois ───────────────────────────────────
    const depuis = new Date();
    depuis.setDate(1);
    depuis.setMonth(depuis.getMonth() - 12);
    depuis.setHours(0, 0, 0, 0);

    const decaissements = await prisma.decaissement.findMany({
      where: {
        userId,
        dateOperation: { gte: depuis },
        repartitions:  { some: { compteId } },
      },
      include: {
        repartitions: {
          where:  { compteId },
          select: { montant: true },
        },
      },
      orderBy: { dateOperation: 'asc' },
    });

    // ── Regrouper par mois ───────────────────────────────────────────────────
    const parMois: Record<string, { ajouts: number; retraits: number }> = {};
    decaissements.forEach(d => {
      const dt  = new Date(d.dateOperation);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      if (!parMois[key]) parMois[key] = { ajouts: 0, retraits: 0 };
      const mt = d.repartitions.reduce((s, r) => s + Number(r.montant || 0), 0);
      if (d.typeMouvement === 'ajout') parMois[key].ajouts  += mt;
      else                             parMois[key].retraits += mt;
    });

    // ── Calculer le solde de départ (12 mois en arrière) ────────────────────
    const totalNetPeriode = Object.values(parMois)
      .reduce((s, m) => s + m.ajouts - m.retraits, 0);
    let soldeCumulatif = Number(compte.soldeActuel ?? 0) - totalNetPeriode;

    // ── Construire les 12 mois ────────────────────────────────────────────────
    const moisArr = [];
    for (let i = 11; i >= 0; i--) {
      const dt    = new Date();
      dt.setDate(1);
      dt.setMonth(dt.getMonth() - i);
      const annee = dt.getFullYear();
      const mois  = dt.getMonth() + 1;
      const key   = `${annee}-${String(mois).padStart(2, '0')}`;
      const m     = parMois[key] ?? { ajouts: 0, retraits: 0 };
      const net   = m.ajouts - m.retraits;
      soldeCumulatif += net;

      moisArr.push({
        label:                 MOIS_COURTS[mois],
        annee,
        mois,
        contribution:          net,        // net = ajouts - retraits
        contributionAnticipee: 0,          // pas disponible ici
        soldeCumulatif,
        ajouts:   m.ajouts,
        retraits: m.retraits,
      });
    }

    return NextResponse.json(serial({
      compte:      { nom: compte.nom, objectif: compte.objectif },
      soldeActuel: compte.soldeActuel,
      mois:        moisArr,
    }));
  } catch (e: any) {
    console.error('GET /api/comptes/evolution:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}
