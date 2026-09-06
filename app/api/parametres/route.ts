// =============================================================================
// app/api/parametres/route.ts  --  etape 4 (S14), version 2
// =============================================================================
// Ferme : P2, P28, P37, P58 (garde), Q40, Q45, Q50, I2, I3, I4, I5, I6.
//
// Ce qui disparait par rapport a la version d origine :
//   - le updateMany sur categories.montantReference (P2). Il ecrivait le
//     montant du TYPE ENTIER sur chaque categorie : origine mesuree de P46
//     (5 529 763 portes pour 790 000 alloues, facteur x7,0).
//   - la fonction n() morte et le parametre req inutilise (P37).
//   - la lecture de categories.tauxReference (Q40). Plus aucune route ne lit
//     cette colonne : la sequence expand/contract peut aller jusqu au DROP.
//   - themeCouleur / anneeCourante / moisCourant du GET (Q45). Colonnes mortes,
//     conservees en base, retirees de la reponse.
//
// COMPATIBILITE VOULUE : la reponse GET expose toujours un `tauxReference` par
// categorie, mais DERIVE de parametres_types (taux du type recopie sur chaque
// categorie du type), plus lu depuis categories. Le MAX que fait
// parametres/page.tsx continue de renvoyer la bonne valeur, donc ④ peut etre
// deploye sans attendre ⑥. Le SUM que fait budget/page.tsx:136 reste faux
// (P29) exactement comme aujourd hui : pas de regression, correction en ⑦ via
// le nouveau champ `parType`.
//
// Option B (Q54). La regle P2 devient : cette route n ecrit jamais de valeur
// ABSOLUE sur categories, mais applique une homothetie via lib/reference dans
// la meme transaction. Une homothetie preserve les rapports entre categories
// d un meme type, donc les glissements D2 : elle est incapable de reproduire
// le bug qu elle remplace. L invariant R3-a est verifie avant commit.
//
// Perimetre (Q58) : toutes les categories actives. Delegue a lib/reference,
// cette route n en a aucune connaissance.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { toNum } from '@/lib/serial';
import { logAudit } from '@/lib/audit';
import { csrfCheck, validateBody } from '@/lib/api-helpers';
import { ParametresSchema } from '@/lib/validators';
import { createHash } from 'crypto';
import {
  TYPES_ALLOUABLES,
  getAllocationParType,
  recalculerMontantsTypes,
  validerSomme,
  calculerRepartition,
  appliquerPlan,
  remettreAZeroHorsPerimetre,
  verifierInvariant,
  type TypeAllouable,
} from '@/lib/reference';

export const dynamic = 'force-dynamic';

// CHECK pose en base en S13 : nMoisUrgence BETWEEN 1 AND 24.
// P58 : lib/validators.ts declare encore .max(60). Un envoi a 30 passe Zod et
// casse sur la contrainte Postgres en 500 avec un message Prisma brut. Ce
// garde le rattrape en 400 lisible ; l alignement de validators.ts est du
// ressort de ⑥.
const N_MOIS_URGENCE_MIN = 1;
const N_MOIS_URGENCE_MAX = 24;

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/parametres
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });
    }
    const userId = session.user.id;

    const [params, allocation, categories] = await Promise.all([
      prisma.parametres.findUnique({ where: { userId } }),
      getAllocationParType(userId),
      prisma.categorie.findMany({
        where: { userId, isActive: true },
        select: {
          id: true, nom: true, type: true,
          montantReference: true, enveloppeActive: true, ordre: true,
        },
        orderBy: [{ type: 'asc' }, { ordre: 'asc' }],
      }),
    ]);

    const parType: Record<string, { taux: number; montant: number; coherent: boolean }> = {};
    for (const t of TYPES_ALLOUABLES) {
      parType[t] = {
        taux: allocation.parType[t].taux,
        montant: allocation.parType[t].montant,
        coherent: allocation.parType[t].coherent,
      };
    }

    const corps = {
      devise: params?.devise ?? 'FCFA',
      revenuMensuelReference: allocation.revenuMensuelReference,
      nMoisUrgence: allocation.nMoisUrgence,
      objectifUrgence: allocation.objectifUrgence,

      rapportEmailActif: params?.rapportEmailActif ?? true,
      rapportEmailJour: params?.rapportEmailJour ?? 1,
      rapportEmailHeure: params?.rapportEmailHeure ?? 8,
      seuilAnomaliesPct: params?.seuilAnomaliesPct ?? 50,
      langueVocale: params?.langueVocale ?? 'fr-FR',

      // Source unique de l allocation par type (I1).
      parType,
      totalTaux: allocation.totalTaux,
      totalMontant: allocation.totalMontant,

      // Jeton de concurrence optimiste, a renvoyer dans le PUT (I3).
      version: allocation.version,

      categories: categories.map(c => ({
        id: c.id,
        nom: c.nom,
        type: c.type,
        montantReference: toNum(c.montantReference),
        enveloppeActive: c.enveloppeActive ?? false,
        // Compat : derive de parametres_types, plus lu depuis categories (Q40).
        tauxReference: (parType[c.type]?.taux ?? 0),
      })),
    };

    // I2 -- ETag calcule sur le corps complet. Un ETag base sur la seule
    // version de l allocation renverrait un 304 errone apres un toggle
    // enveloppeActive ou une creation de categorie (categories n a pas de
    // colonne updatedAt).
    const json = JSON.stringify(corps);
    const etag = '"' + createHash('sha1').update(json).digest('base64') + '"';

    if (req.headers.get('if-none-match') === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag } });
    }

    return new NextResponse(json, {
      status: 200,
      headers: { 'Content-Type': 'application/json', ETag: etag },
    });
  } catch (e: any) {
    console.error('GET /api/parametres:', e?.message);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/parametres
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

    let raw: any;
    try { raw = await req.json(); } catch {
      return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
    }

    // `version` n est pas dans ParametresSchema : on le lit avant Zod, qui
    // l ignorera. Optionnel pour ne pas casser le front actuel ; a rendre
    // obligatoire en ⑥ une fois parametres/page.tsx mis a jour.
    const versionClient: string | undefined =
      typeof raw?.version === 'string' ? raw.version : undefined;

    const { data: paramsData, error: zodErr } = validateBody(ParametresSchema, raw);
    if (zodErr) return zodErr;

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

    // Garde CHECK base (P58).
    if (nMoisUrgence !== undefined &&
        (nMoisUrgence < N_MOIS_URGENCE_MIN || nMoisUrgence > N_MOIS_URGENCE_MAX)) {
      return NextResponse.json(
        { error: 'nMoisUrgence doit etre compris entre ' + N_MOIS_URGENCE_MIN + ' et ' + N_MOIS_URGENCE_MAX },
        { status: 400 },
      );
    }

    // I5 / P28 -- plafond 100 % et cles autorisees, cote serveur.
    // z.record(z.string()) accepte n importe quelle cle, y compris `revenu`.
    if (tauxReference !== undefined) {
      const v = validerSomme(tauxReference as Record<string, number>);
      if (!v.ok) {
        return NextResponse.json(
          { error: v.message, totalTaux: v.total, clesRefusees: v.inconnus },
          { status: 422 },
        );
      }
    }

    const toucheAllocation =
      tauxReference !== undefined || revenuMensuelReference !== undefined;

    const resultat = await prisma.$transaction(async (tx) => {
      const avant = await getAllocationParType(userId, tx);

      // I3 -- concurrence optimiste.
      if (versionClient !== undefined && versionClient !== avant.version) {
        return { conflit: true as const, versionActuelle: avant.version };
      }

      // ── Upsert parametres (patch partiel) ─────────────────────────────
      const updateData: Record<string, any> = {};
      if (revenuMensuelReference !== undefined)
        updateData.revenuMensuelReference = BigInt(Math.round(revenuMensuelReference));
      if (nMoisUrgence !== undefined) updateData.nMoisUrgence = nMoisUrgence;
      if (rapportEmailActif !== undefined) updateData.rapportEmailActif = rapportEmailActif;
      if (rapportEmailJour !== undefined) updateData.rapportEmailJour = rapportEmailJour;
      if (rapportEmailHeure !== undefined) updateData.rapportEmailHeure = rapportEmailHeure;
      if (seuilAnomaliesPct !== undefined) updateData.seuilAnomaliesPct = seuilAnomaliesPct;
      if (langueVocale !== undefined) updateData.langueVocale = langueVocale;

      await tx.parametres.upsert({
        where: { userId },
        create: {
          userId,
          revenuMensuelReference: BigInt(Math.round(revenuMensuelReference ?? 0)),
          nMoisUrgence: nMoisUrgence ?? 6,
          ...(rapportEmailActif !== undefined ? { rapportEmailActif } : {}),
          ...(rapportEmailJour !== undefined ? { rapportEmailJour } : {}),
          ...(rapportEmailHeure !== undefined ? { rapportEmailHeure } : {}),
          ...(seuilAnomaliesPct !== undefined ? { seuilAnomaliesPct } : {}),
          ...(langueVocale !== undefined ? { langueVocale } : {}),
        },
        update: updateData,
      });

      // Un PUT « alertes » seul (le cas de sauvegarderAlertes) ne touche pas
      // a l allocation : on s arrete la, aucune ecriture sur categories.
      if (!toucheAllocation) {
        return { ok: true as const, plan: null, invariant: null, avant, nbCategories: 0, nbRemisAZero: 0 };
      }

      // ── Q50 : taux = source de verite, montants recalcules ────────────
      // Si seul le revenu change, on reprend les taux stockes : les montants
      // par type suivent automatiquement.
      const tauxEffectifs: Record<string, number> = {};
      for (const t of TYPES_ALLOUABLES) {
        tauxEffectifs[t] = tauxReference !== undefined
          ? Number((tauxReference as Record<string, number>)[t] ?? 0)
          : avant.parType[t as TypeAllouable].taux;
      }
      const revenuEffectif = revenuMensuelReference !== undefined
        ? Math.round(revenuMensuelReference)
        : avant.revenuMensuelReference;

      await recalculerMontantsTypes(tx, userId, revenuEffectif, tauxEffectifs);

      // ── Option B (Q54) : homothetie sur les categories actives ────────
      // Aucune valeur absolue n est ecrite. `conserver_ratios` preserve les
      // rapports entre categories d un meme type, donc les glissements D2.
      // Quand les rapports sont uniformes (min == max), le repli sur la
      // repartition egale produit le MEME resultat que l homothetie.
      const plan = await calculerRepartition(userId, { db: tx, mode: 'conserver_ratios' });

      const nbCategories = await appliquerPlan(tx, plan);
      const nbRemisAZero = await remettreAZeroHorsPerimetre(tx, plan); // R3-b, Q57

      const invariant = await verifierInvariant(userId, tx);

      // Un type SANS categorie active mais avec une allocation > 0 est une
      // alerte, pas une erreur : on ne bloque pas l ecran Parametres, qui est
      // precisement l endroit ou l on regle les taux. En revanche un type AVEC
      // categories dont la somme ne tombe pas juste signale un bug de calcul :
      // rollback.
      const anormaux = invariant.ecarts.filter(e => e.nbCategories > 0 && e.ecart !== 0);
      if (anormaux.length > 0) {
        throw new Error(
          'Invariant R3-a rompu apres repartition sur : ' +
          anormaux.map(e => e.type + ' (ecart ' + e.ecart + ')').join(', '),
        );
      }

      return { ok: true as const, plan, invariant, avant, nbCategories, nbRemisAZero };
    }, { maxWait: 15_000, timeout: 30_000 });

    if ('conflit' in resultat) {
      return NextResponse.json(
        {
          error: 'Parametres modifies depuis le chargement de la page. Rechargez avant de sauvegarder.',
          versionAttendue: versionClient,
          versionActuelle: resultat.versionActuelle,
        },
        { status: 409 },
      );
    }

    // ── I4 : audit avec diff ──────────────────────────────────────────────
    const details: Record<string, any> = {
      champs: Object.keys(paramsData!).filter(k => (paramsData as any)[k] !== undefined),
    };

    if (resultat.plan) {
      const diff: Array<[string, number, number]> = [];
      for (const bloc of resultat.plan.blocs) {
        for (const l of bloc.lignes) {
          if (l.delta !== 0) diff.push([l.categorieId, l.ancienMontant, l.nouveauMontant]);
        }
      }
      details.perimetre = resultat.plan.perimetre;
      details.mode = 'conserver_ratios';
      details.revenuAvant = resultat.avant.revenuMensuelReference;
      details.revenuApres = resultat.plan.revenuMensuelReference;
      details.tauxAvant = TYPES_ALLOUABLES.map(t => [t, resultat.avant.parType[t].taux]);
      details.tauxApres = resultat.plan.blocs.map(b => [b.type, b.taux, b.allocation]);
      details.nbCategoriesModifiees = resultat.nbCategories;
      details.nbRemisAZero = resultat.nbRemisAZero;
      details.invariantOk = resultat.invariant?.ok ?? null;
      details.diff = diff;
    }

    await logAudit({
      userId,
      action: 'update',
      entityType: 'parametres',
      details,
      req,
    });

    const alertes: string[] = [];
    if (resultat.plan) {
      alertes.push(...resultat.plan.bloquants, ...resultat.plan.avertissements);
    }

    const apres = await getAllocationParType(userId);

    return NextResponse.json({
      success: true,
      version: apres.version,
      totalTaux: apres.totalTaux,
      totalMontant: apres.totalMontant,
      repartition: resultat.plan
        ? {
            perimetre: resultat.plan.perimetre,
            modeParType: resultat.plan.blocs.map(b => ({
              type: b.type,
              mode: b.mode,
              allocation: b.allocation,
              nbCategories: b.nbCategories,
              sommeAvant: b.sommeAvant,
              sommeApres: b.sommeApres,
            })),
            nbCategoriesModifiees: resultat.nbCategories,
            nbRemisAZero: resultat.nbRemisAZero,
            invariant: resultat.invariant,
          }
        : null,
      alertes,
    });
  } catch (e: any) {
    console.error('PUT /api/parametres:', e?.message);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
