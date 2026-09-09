// =============================================================================
// app/api/parametres/route.ts  --  etape 4 (S14), version 3 (S22)
// =============================================================================
// Ferme : P2, P28, P37, P58 (garde), Q40, Q45, Q50, I2, I3, I4, I5, I6.
//       + P122-B2 (classement de l invariant delegue a lib/reference)
//       + Q188    (erreur typee au lieu d un test sur le texte du message)
//       + Q187    (alerte de sous-allocation remontee au client)
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
// P122-B2 (S22) -- le filtre suivant etait recopie ici a l identique :
//
//     const anormaux = invariant.ecarts.filter(
//       e => e.nbCategories > 0 && e.ecart !== 0);
//
// Deux autres exemplaires existaient dans app/api/categories/route.ts et dans
// app/api/enveloppes/repartition/route.ts : trois copies d une regle
// d interpretation, donc trois occasions de diverger. Le classement vit
// desormais dans lib/reference.ts (R8). Le PREDICAT DE ROLLBACK EST INCHANGE :
// classerInvariant() reproduit exactement `nbCategories > 0 && ecart !== 0`
// dans sa branche `bloquants`. Ce qui change est ce que le client recoit quand
// il n y a PAS de rollback : les alertes expliquent desormais un
// `invariant.ok: false` qui arrivait jusqu ici en HTTP 200 et sans motif.
//
// Q188 (S22) -- le catch testait `e.message.startsWith('Invariant R3-a rompu')`.
// Remplace par estInvariantRompu(), qui reconnait la classe et non le texte.
// La reponse 422 porte en plus `bloquants`, disponible sans reparser le message.
//
// Q187 (S22) -- une somme de taux a 97 % etait acceptee en silence : 3 % du
// revenu n etaient alloues a aucun type. L avertissement est produit par
// calculerRepartition() (source unique) et remonte ici dans `alertes`, avec
// les deux champs chiffres `sousAllocationTaux` / `sousAllocationMontant`
// pour qu un ecran puisse l afficher sans parser de texte. Non bloquant :
// ne pas tout allouer reste une decision legitime.
//
// COMPATIBILITE VOULUE : la reponse GET expose toujours un `tauxReference` par
// categorie, mais DERIVE de parametres_types (taux du type recopie sur chaque
// categorie du type), plus lu depuis categories. Le MAX que fait
// parametres/page.tsx continue de renvoyer la bonne valeur.
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
  classerInvariant,
  InvariantRompuError,
  estInvariantRompu,
  type TypeAllouable,
  type VerdictInvariant,
} from '@/lib/reference';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // P88

// CHECK pose en base en S13 : nMoisUrgence BETWEEN 1 AND 24.
// P58 : lib/validators.ts declare encore .max(60). Un envoi a 30 passe Zod et
// casse sur la contrainte Postgres en 500 avec un message Prisma brut. Ce
// garde le rattrape en 400 lisible.
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

      // Q187 -- part du revenu non allouee, lisible sans calcul cote client.
      // 0 quand la somme des taux atteint 100 %.
      sousAllocationTaux: Math.max(0, Math.round((100 - allocation.totalTaux) * 100) / 100),

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
    // l ignorera. Optionnel pour ne pas casser le front actuel.
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
    // Q187 : un total INFERIEUR a 100 % passe ce controle. C est voulu ; il
    // produira une alerte, pas un refus.
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
        return {
          ok: true as const,
          plan: null,
          invariant: null,
          verdict: null as VerdictInvariant | null,
          avant,
          nbCategories: 0,
          nbRemisAZero: 0,
        };
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

      // Q186 -- alignement sur POST /api/enveloppes/repartition : un plan
      // non applicable (type alloue sans categorie active, revenu a 0) est
      // refuse au lieu d etre applique en laissant une alerte cosmetique.
      if (!plan.applicable) { return { bloque: true as const, bloquants: plan.bloquants }; }

      const nbCategories = await appliquerPlan(tx, plan);
      const nbRemisAZero = await remettreAZeroHorsPerimetre(tx, plan); // R3-b, Q57

      const invariant = await verifierInvariant(userId, tx);

      // ── P122-B2 : classement unique (R8) ──────────────────────────────
      // `bloquants` = ecart R3-a sur un type POURVU de categories actives :
      // c est un bug de calcul ou une ecriture ayant contourne lib/reference,
      // donc rollback. `alertes` = type orphelin (allocation sans categorie)
      // ou residu R3-b : situations metier, remontees avec un HTTP 200.
      // On ne bloque pas l ecran Parametres sur une alerte : c est
      // precisement l endroit ou l on corrige les taux fautifs.
      const verdict = classerInvariant(invariant);
      if (verdict.bloquants.length > 0) {
        throw new InvariantRompuError(verdict, 'mise a jour des taux');
      }

      return { ok: true as const, plan, invariant, verdict, avant, nbCategories, nbRemisAZero };
    }, { maxWait: 15_000, timeout: 30_000 });

    if ('bloque' in resultat) {
      return NextResponse.json(
        { error: 'Repartition impossible avec ces taux', bloquants: resultat.bloquants },
        { status: 422 },
      );
    }

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
      // P122 -- un `invariantOk: false` archive sans motif est illisible six
      // mois plus tard. Les alertes sont tracees avec lui.
      details.invariantAlertes = resultat.verdict?.alertes ?? [];
      // Q187 -- la sous-allocation au moment de l ecriture est archivee : elle
      // explique un ecart entre revenu et somme des allocations dans un audit
      // relu longtemps apres.
      details.sousAllocationTaux = resultat.plan.sousAllocationTaux;
      details.sousAllocationMontant = resultat.plan.sousAllocationMontant;
      details.diff = diff;
    }

    await logAudit({
      userId,
      action: 'update',
      entityType: 'parametres',
      details,
      req,
    });

    // Les alertes remontees au client agregent trois sources de semantiques
    // distinctes, toutes non bloquantes a ce stade :
    //   - plan.bloquants        : vide ici, sinon le plan aurait ete refuse
    //   - plan.avertissements   : modes de repli, desynchronisation, Q187
    //   - verdict.alertes       : type orphelin, residu R3-b (P122)
    const alertes: string[] = [];
    if (resultat.plan) {
      alertes.push(...resultat.plan.bloquants, ...resultat.plan.avertissements);
    }
    if (resultat.verdict) {
      alertes.push(...resultat.verdict.alertes);
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
            // P122 -- `invariant.ok: false` accompagne d un 200 n est
            // acceptable que si le verdict l explique. Il est donc expose.
            verdict: resultat.verdict,
            // Q187 -- chiffres, pour affichage sans parsing de texte.
            sousAllocationTaux: resultat.plan.sousAllocationTaux,
            sousAllocationMontant: resultat.plan.sousAllocationMontant,
          }
        : null,
      alertes,
    });
  } catch (e: any) {
    // Q188 -- reconnaissance par le TYPE de l erreur, plus par son texte.
    if (estInvariantRompu(e)) {
      return NextResponse.json(
        { error: e.message, invariantRompu: true, bloquants: e.verdict.bloquants },
        { status: 422 },
      );
    }
    console.error('PUT /api/parametres:', e?.message);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
