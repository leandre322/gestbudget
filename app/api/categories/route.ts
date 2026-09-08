// =============================================================================
// app/api/categories/route.ts  --  etape 9 (S14)
// =============================================================================
// Ferme : P40, P56, P57.
//
// P40 — la route n avait ni CSRF, ni Zod, et renvoyait e.message brut au
//       client en 500 (fuite de details Prisma).
//
// P56 — le PUT acceptait `montantReference` depuis le body, sans controle.
//       Depuis Q58, montantReference est une valeur DERIVEE de
//       parametres_types : toute ecriture directe est un contournement de
//       l invariant R3-a. Le champ est absent des schemas Zod, donc retire du
//       body avant traitement. parametres/page.tsx continue d envoyer l objet
//       categorie complet : la valeur est simplement jetee, aucune casse.
//
// P57 — changer le `type` d une categorie deplace son montant d une allocation
//       a l autre ; la desactiver retire son montant du perimetre. Les deux
//       rompent R3-a. Analyse des quatre operations :
//
//         Creation      la nouvelle categorie vaut 0  -> somme inchangee -> NON
//         Reactivation  elle est a 0 par R3-b         -> somme inchangee -> NON
//         Changement    le montant migre T1 -> T2     -> les deux cassent -> OUI
//         Desactivation le montant sort du perimetre  -> la somme chute   -> OUI
//
//       Seuls les deux derniers cas declenchent une homothetie. Une categorie
//       creee demarre donc a 0 jusqu a la prochaine repartition, ce qui est le
//       comportement correct : pas de budget tant qu on n en alloue pas.
//
// Le mode 'conserver_ratios' est utilise partout : il preserve les rapports
// entre categories d un meme type, donc les glissements D2 (R4).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { serial } from '@/lib/serial';
import { logAudit } from '@/lib/audit';
import { csrfCheck, validateBody } from '@/lib/api-helpers';
import { CategorieCreateSchema, CategorieUpdateSchema } from '@/lib/validators';
import {
  calculerRepartition,
  appliquerPlan,
  remettreAZeroHorsPerimetre,
  verifierInvariant,
  type DbClient,
} from '@/lib/reference';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // P88

/**
 * Reequilibre les categories apres une operation qui a rompu R3-a.
 * A appeler DANS une transaction. Leve si l invariant n est pas retabli :
 * mieux vaut annuler l operation que laisser la base incoherente.
 */
async function reequilibrer(tx: DbClient, userId: string) {
  const plan = await calculerRepartition(userId, { db: tx, mode: 'conserver_ratios' });
  const nbCategories = await appliquerPlan(tx, plan);
  const nbRemisAZero = await remettreAZeroHorsPerimetre(tx, plan);
  const invariant = await verifierInvariant(userId, tx);

  const anormaux = invariant.ecarts.filter(e => e.nbCategories > 0 && e.ecart !== 0);
  if (anormaux.length > 0) {
    throw new Error(
      'Invariant R3-a rompu apres reequilibrage : ' +
      anormaux.map(e => e.type + ' (ecart ' + e.ecart + ')').join(', '),
    );
  }

  return {
    nbCategories,
    nbRemisAZero,
    invariantOk: invariant.ok,
    // Un type ayant perdu sa derniere categorie active garde une allocation
    // non distribuable : alerte, pas erreur.
    alertes: plan.bloquants,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/categories
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });
    }

    const categories = await prisma.categorie.findMany({
      where:   { userId: session.user.id },
      orderBy: { ordre: 'asc' },
      include: { compteFonds: { select: { id: true, nom: true } } },
    });

    return NextResponse.json(serial({ categories }));
  } catch (e: any) {
    console.error('GET /api/categories:', e?.message);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/categories
// Aucune repartition : la categorie naît a montantReference = 0, la somme du
// type est donc inchangee et R3-a reste vrai.
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

    const { data: body, error: zodErr } = validateBody(CategorieCreateSchema, raw);
    if (zodErr) return zodErr;

    // Les liaisons doivent appartenir a l utilisateur.
    if (body!.compteFondsId) {
      const f = await prisma.compteFonds.findFirst({
        where: { id: body!.compteFondsId, userId }, select: { id: true },
      });
      if (!f) return NextResponse.json({ error: 'Fonds introuvable' }, { status: 404 });
    }
    if (body!.banqueId) {
      const b = await prisma.banque.findFirst({
        where: { id: body!.banqueId, userId }, select: { id: true },
      });
      if (!b) return NextResponse.json({ error: 'Banque introuvable' }, { status: 404 });
    }

    const cat = await prisma.categorie.create({
      data: {
        userId,
        nom:             body!.nom,
        type:            body!.type,
        sousType:        body!.sousType ?? null,
        ordre:           body!.ordre,
        compteFondsId:   body!.compteFondsId ?? null,
        banqueId:        body!.banqueId ?? null,
        enveloppeActive: body!.enveloppeActive,
        // montantReference reste a son defaut 0 : derive, jamais saisi.
      },
    });

    await logAudit({
      userId, action: 'create', entityType: 'categorie',
      entityId: cat.id, entityNom: cat.nom,
      details: { type: cat.type, enveloppeActive: cat.enveloppeActive },
      req,
    });

    return NextResponse.json(
      serial({
        success: true,
        categorie: cat,
        info: 'Categorie creee avec un budget de reference a 0. '
            + 'Lancez une repartition pour lui attribuer une part de son type.',
      }),
      { status: 201 },
    );
  } catch (e: any) {
    console.error('POST /api/categories:', e?.message);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/categories
// ─────────────────────────────────────────────────────────────────────────────
export async function PUT(req: NextRequest) {
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

    const { data: body, error: zodErr } = validateBody(CategorieUpdateSchema, raw);
    if (zodErr) return zodErr;

    const avant = await prisma.categorie.findFirst({
      where:  { id: body!.id, userId },
      select: { id: true, nom: true, type: true, isActive: true, montantReference: true },
    });
    if (!avant) {
      return NextResponse.json({ error: 'Categorie introuvable' }, { status: 404 });
    }

    if (body!.compteFondsId) {
      const f = await prisma.compteFonds.findFirst({
        where: { id: body!.compteFondsId, userId }, select: { id: true },
      });
      if (!f) return NextResponse.json({ error: 'Fonds introuvable' }, { status: 404 });
    }
    if (body!.banqueId) {
      const b = await prisma.banque.findFirst({
        where: { id: body!.banqueId, userId }, select: { id: true },
      });
      if (!b) return NextResponse.json({ error: 'Banque introuvable' }, { status: 404 });
    }

    // P57 — seules ces deux transitions rompent R3-a (voir en-tete de fichier).
    const changeType  = body!.type !== undefined && body!.type !== avant.type;
    const desactivee  = body!.isActive === false && avant.isActive === true;
    const besoinRepartition = changeType || desactivee;

    const resultat = await prisma.$transaction(async (tx) => {
      const cat = await tx.categorie.update({
        where: { id: body!.id, userId },
        data: {
          ...(body!.nom             !== undefined ? { nom: body!.nom } : {}),
          ...(body!.type            !== undefined ? { type: body!.type } : {}),
          ...(body!.sousType        !== undefined ? { sousType: body!.sousType ?? null } : {}),
          ...(body!.ordre           !== undefined ? { ordre: body!.ordre } : {}),
          ...(body!.isActive        !== undefined ? { isActive: body!.isActive } : {}),
          ...(body!.compteFondsId   !== undefined ? { compteFondsId: body!.compteFondsId || null } : {}),
          ...(body!.banqueId        !== undefined ? { banqueId: body!.banqueId || null } : {}),
          ...(body!.enveloppeActive !== undefined ? { enveloppeActive: body!.enveloppeActive } : {}),
          // montantReference : jamais ecrit ici (P56).
        },
      });

      const reeq = besoinRepartition ? await reequilibrer(tx, userId) : null;
      return { cat, reeq };
    }, { maxWait: 15_000, timeout: 30_000 });

    await logAudit({
      userId, action: 'update', entityType: 'categorie',
      entityId: avant.id, entityNom: resultat.cat.nom,
      details: {
        champs: Object.keys(body!).filter(k => k !== 'id' && (body as any)[k] !== undefined),
        typeAvant: avant.type,
        typeApres: resultat.cat.type,
        isActiveAvant: avant.isActive,
        isActiveApres: resultat.cat.isActive,
        repartitionDeclenchee: besoinRepartition,
        motifRepartition: changeType ? 'changement_type' : desactivee ? 'desactivation' : null,
        nbCategoriesReequilibrees: resultat.reeq?.nbCategories ?? 0,
        invariantOk: resultat.reeq?.invariantOk ?? null,
      },
      req,
    });

    return NextResponse.json(serial({
      success: true,
      categorie: resultat.cat,
      repartition: resultat.reeq,
    }));
  } catch (e: any) {
    if (typeof e?.message === 'string' && e.message.startsWith('Invariant R3-a rompu')) { return NextResponse.json({ error: e.message, invariantRompu: true }, { status: 422 }); } // P86
    console.error('PUT /api/categories:', e?.message);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/categories?id=xxx  (desactivation soft)
// Retire le montant du perimetre : R3-a est rompu, reequilibrage obligatoire.
// R3-b remet ensuite la categorie desactivee a 0, pour qu elle ne redevienne
// pas fausse le jour ou on la reactive.
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });
    }
    const userId = session.user.id;

    const csrfErr = csrfCheck(req);
    if (csrfErr) return csrfErr;

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Identifiant manquant' }, { status: 400 });

    const avant = await prisma.categorie.findFirst({
      where:  { id, userId },
      select: { id: true, nom: true, type: true, isActive: true, montantReference: true },
    });
    if (!avant) {
      return NextResponse.json({ error: 'Categorie introuvable' }, { status: 404 });
    }
    if (!avant.isActive) {
      return NextResponse.json({ success: true, dejaDesactivee: true });
    }

    const resultat = await prisma.$transaction(async (tx) => {
      await tx.categorie.update({
        where: { id, userId },
        data:  { isActive: false },
      });
      return reequilibrer(tx, userId);
    }, { maxWait: 15_000, timeout: 30_000 });

    await logAudit({
      userId, action: 'delete', entityType: 'categorie',
      entityId: avant.id, entityNom: avant.nom,
      details: {
        type: avant.type,
        montantLibere: Number(avant.montantReference),
        nbCategoriesReequilibrees: resultat.nbCategories,
        nbRemisAZero: resultat.nbRemisAZero,
        invariantOk: resultat.invariantOk,
      },
      req,
    });

    return NextResponse.json({ success: true, repartition: resultat });
  } catch (e: any) {
    if (typeof e?.message === 'string' && e.message.startsWith('Invariant R3-a rompu')) { return NextResponse.json({ error: e.message, invariantRompu: true }, { status: 422 }); } // P86
    console.error('DELETE /api/categories:', e?.message);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
