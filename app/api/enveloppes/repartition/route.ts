// =============================================================================
// app/api/enveloppes/repartition/route.ts  --  I9 (etape 5), version 2
// =============================================================================
// Remplace la migration SQL brute decidee en S13. Motifs :
//   - rejouable et testable d abord sur le compte de test ;
//   - tracee dans audit_logs (regle : les ecritures financieres passent par
//     l API, jamais par du SQL direct) ;
//   - previsualisable : le mode retenu est affiche PAR TYPE avant tout write
//     (Q41), et l utilisateur voit le diff ligne a ligne.
//
// Perimetre (Q58) : toutes les categories ACTIVES d un type allouable.
// enveloppeActive n intervient pas — c est un filtre d affichage D2, et il
// vaut false sur les 46 categories au moment de la premiere execution.
//
// GET  = dry-run pur, aucune ecriture.
// POST = application, dans UNE transaction, avec :
//   - CSRF (P31 : la route glissement en manquait) ;
//   - Zod sur le body ;
//   - concurrence optimiste sur `version` (I3) : le plan est RECALCULE cote
//     serveur a l interieur de la transaction, jamais recu du client (P32 :
//     TOCTOU lecture-puis-ecriture) ;
//   - logAudit portant le diff complet compacte, qui sert de sauvegarde.
//
// Le schema Zod est defini ici plutot que dans lib/validators.ts (precedent :
// GlissementSchema). Il y sera deplace lors de la reecriture de validators.ts,
// qui doit de toute facon aligner nMoisUrgence sur le CHECK 1-24 (P58).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { csrfCheck, validateBody } from '@/lib/api-helpers';
import { z } from 'zod';
import {
  calculerRepartition,
  appliquerPlan,
  remettreAZeroHorsPerimetre,
  verifierInvariant,
  NB_MOIS_HISTORIQUE,
  PLANCHER_PART_EGALE,
} from '@/lib/reference';

export const dynamic = 'force-dynamic';

const MODES = ['auto', 'egal', 'conserver_ratios'] as const;

const RepartitionSchema = z.object({
  mode: z.enum(MODES).optional().default('auto'),
  refAnnee: z.number().int().min(2000).max(2100).optional(),
  refMois: z.number().int().min(1).max(12).optional(),
  nbMois: z.number().int().min(1).max(36).optional(),
  /** Fraction de la part egale accordee a une categorie sans historique. */
  plancherPartEgale: z.number().min(0).max(1).optional(),
  /** R3-b : remettre a 0 les categories inactives et de type revenu. */
  remiseAZeroHorsPerimetre: z.boolean().optional().default(true),
  /**
   * Jeton de concurrence (I3). Doit valoir le `version` renvoye par le GET de
   * previsualisation.
   */
  version: z.string().min(1),
  /**
   * Garde-fou explicite : l appelant confirme avoir vu la prevision.
   * Empeche un POST accidentel depuis un outil externe.
   */
  confirme: z.literal(true),
});

function parseModeQuery(v: string | null): (typeof MODES)[number] {
  return (MODES as readonly string[]).includes(v ?? '') ? (v as (typeof MODES)[number]) : 'auto';
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/enveloppes/repartition   -- previsualisation, aucune ecriture
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });
    }

    const sp = new URL(req.url).searchParams;
    const now = new Date();

    const refAnnee = Number.parseInt(sp.get('annee') ?? '', 10);
    const refMois = Number.parseInt(sp.get('mois') ?? '', 10);
    const nbMois = Number.parseInt(sp.get('nbMois') ?? '', 10);
    const plancher = Number.parseFloat(sp.get('plancherPartEgale') ?? '');

    const plan = await calculerRepartition(session.user.id, {
      mode: parseModeQuery(sp.get('mode')),
      refAnnee: Number.isFinite(refAnnee) && refAnnee > 0 ? refAnnee : now.getFullYear(),
      refMois: Number.isFinite(refMois) && refMois >= 1 && refMois <= 12 ? refMois : now.getMonth() + 1,
      nbMois: Number.isFinite(nbMois) && nbMois > 0 ? nbMois : NB_MOIS_HISTORIQUE,
      plancherPartEgale: Number.isFinite(plancher) && plancher >= 0 ? plancher : PLANCHER_PART_EGALE,
    });

    const invariant = await verifierInvariant(session.user.id);

    return NextResponse.json({ plan, invariant });
  } catch (e: any) {
    console.error('GET /api/enveloppes/repartition:', e?.message);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/enveloppes/repartition  -- application transactionnelle
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });
    }
    const userId = session.user.id;

    const csrfErr = csrfCheck(req);
    if (csrfErr) return csrfErr;

    let raw: unknown;
    try { raw = await req.json(); } catch {
      return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
    }

    const { data: body, error: zodErr } = validateBody(RepartitionSchema, raw);
    if (zodErr) return zodErr;

    const now = new Date();

    // Le plan est RECALCULE dans la transaction. Rien de ce que le client
    // envoie ne devient une valeur ecrite : il ne fournit que des options.
    const resultat = await prisma.$transaction(async (tx) => {
      const plan = await calculerRepartition(userId, {
        db: tx,
        mode: body!.mode,
        refAnnee: body!.refAnnee ?? now.getFullYear(),
        refMois: body!.refMois ?? now.getMonth() + 1,
        nbMois: body!.nbMois ?? NB_MOIS_HISTORIQUE,
        plancherPartEgale: body!.plancherPartEgale ?? PLANCHER_PART_EGALE,
      });

      // I3 -- concurrence optimiste. Si les taux ont bouge entre la
      // previsualisation et l application, on refuse plutot que d ecrire un
      // plan calcule sur une allocation perimee.
      if (plan.version !== body!.version) {
        return { conflit: true as const, plan };
      }
      if (!plan.applicable) {
        return { bloque: true as const, plan };
      }

      const nbCategories = await appliquerPlan(tx, plan);
      const nbRemisAZero = body!.remiseAZeroHorsPerimetre
        ? await remettreAZeroHorsPerimetre(tx, plan)
        : 0;

      const invariant = await verifierInvariant(userId, tx);

      // R3-a doit etre exact apres application : un ecart signale un bug de
      // calcul, pas une situation metier. Rollback.
      const anormaux = invariant.ecarts.filter(e => e.nbCategories > 0 && e.ecart !== 0);
      if (anormaux.length > 0) {
        throw new Error(
          'Invariant R3-a rompu apres repartition sur : ' +
          anormaux.map(e => e.type + ' (ecart ' + e.ecart + ')').join(', '),
        );
      }

      return { ok: true as const, plan, nbCategories, nbRemisAZero, invariant };
    }, { maxWait: 15_000, timeout: 30_000 });

    if ('conflit' in resultat) {
      return NextResponse.json(
        {
          error: 'Allocation modifiee depuis la previsualisation. Rechargez la prevision.',
          versionAttendue: body!.version,
          versionActuelle: resultat.plan.version,
        },
        { status: 409 },
      );
    }

    if ('bloque' in resultat) {
      return NextResponse.json(
        { error: 'Repartition impossible', bloquants: resultat.plan.bloquants },
        { status: 422 },
      );
    }

    // Diff compacte : [categorieId, avant, apres]. Sert de sauvegarde et de
    // base a un rollback manuel si necessaire.
    const diff: Array<[string, number, number]> = [];
    for (const bloc of resultat.plan.blocs) {
      for (const l of bloc.lignes) {
        if (l.delta !== 0) diff.push([l.categorieId, l.ancienMontant, l.nouveauMontant]);
      }
    }
    const diffZero: Array<[string, number]> = body!.remiseAZeroHorsPerimetre
      ? resultat.plan.remiseAZero.map(l => [l.categorieId, l.ancienMontant] as [string, number])
      : [];

    await logAudit({
      userId,
      action: 'update',
      entityType: 'enveloppes_repartition',
      entityNom: 'Repartition ' + body!.mode,
      details: {
        perimetre: resultat.plan.perimetre,
        mode: body!.mode,
        refAnnee: resultat.plan.refAnnee,
        refMois: resultat.plan.refMois,
        nbMoisHistorique: resultat.plan.nbMoisHistorique,
        version: resultat.plan.version,
        modeParType: resultat.plan.blocs.map(b => [b.type, b.mode, b.allocation, b.nbCategories]),
        totalAvant: resultat.plan.totalAvant,
        totalApres: resultat.plan.totalApres,
        nbCategoriesModifiees: resultat.nbCategories,
        nbRemisAZero: resultat.nbRemisAZero,
        montantRemisAZero: resultat.plan.montantRemisAZero,
        invariantOk: resultat.invariant.ok,
        diff,
        diffZero,
      },
      req,
    });

    return NextResponse.json({
      success: true,
      perimetre: resultat.plan.perimetre,
      nbCategoriesModifiees: resultat.nbCategories,
      nbRemisAZero: resultat.nbRemisAZero,
      totalAvant: resultat.plan.totalAvant,
      totalApres: resultat.plan.totalApres,
      avertissements: resultat.plan.avertissements,
      invariant: resultat.invariant,
    });
  } catch (e: any) {
    console.error('POST /api/enveloppes/repartition:', e?.message);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
