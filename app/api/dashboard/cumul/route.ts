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

// GET /api/dashboard/cumul
// Retourne les totaux cumulés (toutes années) avec épargne + correctifs
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const userId = session.user.id;

    // ── Totaux cumulés depuis budget_mensuel ─────────────────────────────────
    const rows = await prisma.$queryRaw<any[]>`
      SELECT 
        COALESCE(SUM(CASE WHEN c.type::text = 'revenu'
          THEN bm."montantReel" ELSE 0 END), 0)::bigint AS "totalRevenus",
        COALESCE(SUM(CASE WHEN c.type::text LIKE 'depense%'
          OR c.type::text = 'remboursement_dette'
          THEN bm."montantReel" ELSE 0 END), 0)::bigint AS "totalDepenses",
        COALESCE(SUM(CASE WHEN c.type::text LIKE 'epargne%'
          THEN bm."montantReel" ELSE 0 END), 0)::bigint AS "totalEpargne"
      FROM budget_mensuel bm
      JOIN annees a   ON a.id  = bm."anneeId"
      JOIN categories c ON c.id = bm."categorieId"
      WHERE a."userId" = ${userId}
        AND (c."isActive" IS NULL OR c."isActive" = true)
    `;

    const base = rows[0] ?? { totalRevenus: 0n, totalDepenses: 0n, totalEpargne: 0n };

    // ── Correctifs (ajustements manuels) ────────────────────────────────────
    let correctifs: any[] = [];
    try {
      correctifs = await (prisma as any).correctifKpi.findMany({
        where:   { userId },
        orderBy: { createdAt: 'desc' },
      });
    } catch {
      // Table non encore créée → migration SQL pas encore exécutée
    }

    const corrRevenus  = correctifs.filter((c: any) => c.kpi === 'revenus').reduce((s: number, c: any) => s + Number(c.montant), 0);
    const corrDepenses = correctifs.filter((c: any) => c.kpi === 'depenses').reduce((s: number, c: any) => s + Number(c.montant), 0);
    const corrEpargne  = correctifs.filter((c: any) => c.kpi === 'epargne').reduce((s: number, c: any) => s + Number(c.montant), 0);

    const totalRevenus  = Number(base.totalRevenus)  + corrRevenus;
    const totalDepenses = Number(base.totalDepenses) + corrDepenses;
    const totalEpargne  = Number(base.totalEpargne)  + corrEpargne;
    const soldeNet      = totalRevenus - totalDepenses - totalEpargne;

    return NextResponse.json(serial({
      totalRevenus,
      totalDepenses,
      totalEpargne,
      soldeNet,
      correctifs,
      base: {
        totalRevenus:  Number(base.totalRevenus),
        totalDepenses: Number(base.totalDepenses),
        totalEpargne:  Number(base.totalEpargne),
      },
    }));
  } catch (e: any) {
    console.error('GET /api/dashboard/cumul:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}
