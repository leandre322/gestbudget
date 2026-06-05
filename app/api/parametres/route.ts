import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { toNum } from '@/lib/serial';
import { logAudit } from '@/lib/audit';
import { csrfCheck, validateBody } from '@/lib/api-helpers';
import { ParametresSchema } from '@/lib/validators';

function n(v: any) { return typeof v === 'bigint' ? Number(v) : (Number(v) || 0); }

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/parametres
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const [params, categories] = await Promise.all([
      prisma.parametres.findUnique({ where: { userId: session.user.id } }),
      prisma.categorie.findMany({
        where:  { userId: session.user.id, isActive: true },
        select: {
          id: true,
          type: true,
          tauxReference: true,
          montantReference: true,
          enveloppeActive: true,  // D2
        },
      }),
    ]);

    return NextResponse.json({
      devise:                 params?.devise          ?? 'FCFA',
      themeCouleur:           params?.themeCouleur    ?? 'blue',
      anneeCourante:          params?.anneeCourante   ?? new Date().getFullYear(),
      moisCourant:            params?.moisCourant     ?? new Date().getMonth() + 1,
      revenuMensuelReference: toNum(params?.revenuMensuelReference ?? 0),
      // Alertes — retournes explicitement (corrige bug GET incomplet)
      rapportEmailActif:  params?.rapportEmailActif  ?? true,
      rapportEmailJour:   params?.rapportEmailJour   ?? 1,
      rapportEmailHeure:  params?.rapportEmailHeure  ?? 8,
      seuilAnomaliesPct:  params?.seuilAnomaliesPct  ?? 50,
      // D1 — dictee vocale
      langueVocale:       params?.langueVocale       ?? 'fr-FR',
      categories: categories.map(c => ({
        id:               c.id,
        type:             c.type,
        tauxReference:    c.tauxReference    ?? 0,
        montantReference: toNum(c.montantReference),
        enveloppeActive:  c.enveloppeActive  ?? false, // D2
      })),
    });
  } catch (e: any) {
    console.error('GET /api/parametres:', e?.message);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/parametres
// Gere 3 sections : taux/revenus | alertes | (futur)
// Seuls les champs fournis sont mis a jour (patch partiel safe)
// ─────────────────────────────────────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const csrfErr = csrfCheck(req); if (csrfErr) return csrfErr;

    const rawParams = await req.json();
    const { data: paramsData, error: zodParamsErr } = validateBody(ParametresSchema, rawParams);
    if (zodParamsErr) return zodParamsErr;

    const {
      revenuMensuelReference,
      tauxReference,
      nMoisUrgence,
      rapportEmailActif,
      rapportEmailJour,
      rapportEmailHeure,
      seuilAnomaliesPct,
      langueVocale,
    } = paramsData!;

    // ── Construire l'objet update de façon selective ──────────────────────
    const updateData: Record<string, any> = { updatedAt: new Date() };

    if (revenuMensuelReference !== undefined)
      updateData.revenuMensuelReference = BigInt(revenuMensuelReference);
    if (nMoisUrgence !== undefined)
      updateData.nMoisUrgence = nMoisUrgence;
    if (rapportEmailActif !== undefined)
      updateData.rapportEmailActif = rapportEmailActif;
    if (rapportEmailJour !== undefined)
      updateData.rapportEmailJour = rapportEmailJour;
    if (rapportEmailHeure !== undefined)
      updateData.rapportEmailHeure = rapportEmailHeure;
    if (seuilAnomaliesPct !== undefined)
      updateData.seuilAnomaliesPct = seuilAnomaliesPct;
    if (langueVocale !== undefined)
      updateData.langueVocale = langueVocale;

    // ── Upsert parametres ─────────────────────────────────────────────────
    await prisma.parametres.upsert({
      where:  { userId: session.user.id },
      create: {
        userId: session.user.id,
        revenuMensuelReference: BigInt(revenuMensuelReference ?? 0),
        nMoisUrgence: nMoisUrgence ?? 6,
        ...(rapportEmailActif !== undefined ? { rapportEmailActif } : {}),
        ...(rapportEmailJour  !== undefined ? { rapportEmailJour  } : {}),
        ...(rapportEmailHeure !== undefined ? { rapportEmailHeure } : {}),
        ...(seuilAnomaliesPct !== undefined ? { seuilAnomaliesPct } : {}),
        ...(langueVocale      !== undefined ? { langueVocale      } : {}),
      },
      update: updateData,
    });

    // ── Mise a jour des taux/montants par categorie ───────────────────────
    if (tauxReference) {
      for (const [type, taux] of Object.entries(tauxReference)) {
        const montant = (revenuMensuelReference ?? 0) > 0
          ? Math.round(((taux as number) / 100) * (revenuMensuelReference ?? 0))
          : 0;
        await prisma.categorie.updateMany({
          where: { userId: session.user.id, type: type as any },
          data:  { tauxReference: taux as number, montantReference: BigInt(montant) },
        });
      }
    }

    await logAudit({ userId: session.user.id, action: 'update', entityType: 'parametres', req });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('PUT /api/parametres:', e?.message);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
