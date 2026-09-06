// =============================================================================
// app/api/budget/route.ts  --  etape 10b, version 3 (S15)
// =============================================================================
// Ferme : Q43 (scope), P41, P43, P45, P55  [v2, inchange]
//       + P62 (verrou serveur), P66 (POST non garde), Q61 (coherence scope).
//
// P62 — la regle « verrouille apres le 5 du mois suivant » n existait que dans
//       budget/page.tsx : evaluee sur l horloge du POSTE, annulable par un
//       setLocked(false), et totalement inconnue du serveur. La regle vit
//       desormais dans lib/periode.ts (I16) et cette route l applique.
//       Ecriture sur un mois clos -> 423 Locked.
//       Derogation possible via `forcerMoisVerrouille: true`, tracee dans
//       logAudit avec le motif MOTIF_DEROGATION. Meme regime que les DELETE
//       financiers : la correction reste possible, elle laisse une trace.
//
// P66 — le garde porte sur PUT *et* POST. Sans cela, l ecriture ligne a ligne
//       resterait ouverte sur un mois clos et le verrou serait cosmetique.
//
// Q61 — coherence scope <-> cles. `scope` empechait deja d ECRIRE hors scope,
//       mais un ecran pouvait envoyer une valeur perimee dans la colonne d un
//       autre : elle etait ignoree en silence. Elle est desormais refusee en
//       422. Le controle porte sur le body BRUT et non sur la sortie de Zod :
//       un `.default()` sur `reel` dans BudgetPutSchema materialiserait la cle
//       et ferait echouer tout envoi 'previsionnel' legitime.
//       Etat des appelants au moment de la livraison :
//         suivi/page.tsx  sauvegarder()     { reel }            + 'suivi'      OK
//         suivi/page.tsx  handleModalSave() { anticipe, reel }  + 'les_deux'   OK
//         budget/page.tsx                   { anticipe, reel }  + defaut       KO
//       Seul ⑦ est non conforme, et il est reecrit dans la meme session.
//
// P41 — include: { categorie: true } chargeait la categorie entiere pour chaque
//       ligne (motif P19). Remplace par un select restreint.
//
// P43 — anneeId et categorieId arrivaient du body sans verification de
//       propriete. Le GET faisant un include sur categorie, poser une ligne sur
//       le categorieId d un autre utilisateur permettait d en LIRE le nom et le
//       type : fuite de lecture, pas seulement pollution.
//
// P45 — N upserts sequentiels hors transaction. Regroupes dans un $transaction.
//
// P55 — le GET creait une ligne `annees` quand elle manquait : une ecriture sur
//       une lecture, declenchable via ?annee=1999. Creation bornee a
//       [anneeCourante-1, anneeCourante+1].
//
// LIMITE CONNUE (Q67) : aucun jeton de concurrence sur le PUT. Deux onglets sur
// le meme mois : le dernier ecrase. Atenue cote client par l envoi des seules
// lignes modifiees (dirtyCats), pas ferme cote serveur.
//
// LIMITE CONNUE (Q68) : /api/quick-add ecrit montantReel par increment et n est
// pas garde par le verrou. A traiter pour que la cloture soit reelle.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { serial } from '@/lib/serial';
import { logAudit } from '@/lib/audit';
import { csrfCheck, validateBody } from '@/lib/api-helpers';
import { BudgetPutSchema, BudgetPostSchema } from '@/lib/validators';
import { revalidateTag } from 'next/cache';
import { estMoisVerrouille, messageVerrou, MOTIF_DEROGATION } from '@/lib/periode';

export const dynamic = 'force-dynamic';

/** Fenetre dans laquelle un GET a le droit de creer la ligne Annee (P55). */
const FENETRE_CREATION_ANNEE = 1;

const CATEGORIE_SELECT = {
  select: { id: true, nom: true, type: true, ordre: true },
} as const;

/**
 * Normalisation defensive. Clampe a 0 : un montant negatif devient 0.
 * P69 : ce clamp est silencieux cote serveur. La saisie doit etre normalisee
 * ET signalee cote client (I14) ; ici on protege la base, pas l utilisateur.
 */
function versEntier(v: unknown): bigint {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? '0'), 10);
  if (!Number.isFinite(n)) return BigInt(0);
  return BigInt(Math.max(0, Math.trunc(n)));
}

/**
 * Resout l anneeId a partir du body : soit un anneeId dont on verifie la
 * propriete, soit une annee que l on cree si besoin (P43).
 * Retourne AUSSI le millesime, indispensable au controle de verrou : sans lui
 * un appelant fournissant seulement anneeId contournerait le garde.
 */
async function resoudreAnnee(
  userId: string,
  anneeId: string | undefined,
  annee: number | undefined,
): Promise<{ id: string; annee: number } | null> {
  if (anneeId) {
    const rec = await prisma.annee.findFirst({
      where: { id: anneeId, userId }, select: { id: true, annee: true },
    });
    return rec ? { id: rec.id, annee: rec.annee } : null;
  }
  if (annee === undefined) return null;

  const rec = await prisma.annee.upsert({
    where:  { userId_annee: { userId, annee } },
    create: { userId, annee },
    update: {},
    select: { id: true, annee: true },
  });
  return { id: rec.id, annee: rec.annee };
}

/** Lit le drapeau de derogation sur le body brut (Zod ne le connait pas). */
function lireDerogation(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null
    && (raw as Record<string, unknown>).forcerMoisVerrouille === true;
}

/**
 * Q61 -- verifie que les cles envoyees correspondent au scope declare.
 * Opere sur le body BRUT : voir l en-tete pour le motif.
 * Retourne la liste des categories fautives, vide si tout est coherent.
 */
function incoherencesScope(raw: unknown, scope: string | undefined): string[] {
  if (scope !== 'previsionnel' && scope !== 'suivi') return [];
  const interdite = scope === 'previsionnel' ? 'reel' : 'anticipe';

  const corps = raw as Record<string, unknown> | null;
  const lignes = corps && typeof corps === 'object' ? corps.lignes : null;
  if (!lignes || typeof lignes !== 'object') return [];

  const fautives: string[] = [];
  for (const [categorieId, vals] of Object.entries(lignes as Record<string, unknown>)) {
    if (vals && typeof vals === 'object'
        && Object.prototype.hasOwnProperty.call(vals, interdite)) {
      fautives.push(categorieId);
    }
  }
  return fautives;
}

/** Meme controle pour le POST, ou les montants sont des champs de premier niveau. */
function incoherenceScopePost(raw: unknown, scope: string | undefined): string | null {
  if (scope !== 'previsionnel' && scope !== 'suivi') return null;
  const corps = raw as Record<string, unknown> | null;
  if (!corps || typeof corps !== 'object') return null;

  const interdit = scope === 'previsionnel' ? 'montantReel' : 'montantAnticipe';
  return Object.prototype.hasOwnProperty.call(corps, interdit) ? interdit : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/budget?annee=&mois=
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });
    }
    const userId = session.user.id;

    const { searchParams } = new URL(req.url);
    const annee = parseInt(searchParams.get('annee') ?? '', 10);
    const mois  = parseInt(searchParams.get('mois')  ?? '', 10);

    if (!annee || !mois || mois < 1 || mois > 12) {
      return NextResponse.json({ error: 'Parametres invalides' }, { status: 400 });
    }

    let anneeRec = await prisma.annee.findUnique({
      where: { userId_annee: { userId, annee } },
    });

    // P55 -- creation bornee a la fenetre utile.
    if (!anneeRec) {
      const courante = new Date().getFullYear();
      const dansFenetre =
        annee >= courante - FENETRE_CREATION_ANNEE &&
        annee <= courante + FENETRE_CREATION_ANNEE;
      if (dansFenetre) {
        anneeRec = await prisma.annee.create({ data: { userId, annee } });
      }
    }

    const [budget, categories] = await Promise.all([
      anneeRec
        ? prisma.budgetMensuel.findMany({
            where:   { userId, anneeId: anneeRec.id, mois },
            include: { categorie: CATEGORIE_SELECT },
            orderBy: { categorie: { ordre: 'asc' } },
          })
        : Promise.resolve([] as any[]),
      prisma.categorie.findMany({
        where:   { userId, isActive: true },
        orderBy: { ordre: 'asc' },
      }),
    ]);

    // Le verrou est expose en lecture : le client affiche l etat sans avoir a
    // recalculer la regle, et sans risque de divergence d horloge (I16).
    const verrouille = estMoisVerrouille(annee, mois);

    return NextResponse.json(serial({
      anneeId:   anneeRec?.id ?? null,
      annee,
      anneeData: anneeRec,
      budget,
      categories,
      verrouille,
      messageVerrou: verrouille ? messageVerrou(annee, mois) : null,
    }));
  } catch (e: any) {
    console.error('GET /api/budget:', e?.message);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/budget  -- ecriture en masse d un mois
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

    const derogation = lireDerogation(raw);

    const { data: body, error: zodErr } = validateBody(BudgetPutSchema, raw);
    if (zodErr) return zodErr;

    const { mois, lignes, scope } = body!;

    // Q61 -- coherence scope <-> cles, sur le body brut.
    const fautives = incoherencesScope(raw, scope);
    if (fautives.length > 0) {
      const interdite = scope === 'previsionnel' ? 'reel' : 'anticipe';
      return NextResponse.json(
        {
          error: 'Cle "' + interdite + '" interdite avec scope "' + scope + '"',
          categories: fautives.slice(0, 10),
          nbFautives: fautives.length,
        },
        { status: 422 },
      );
    }

    const cible = await resoudreAnnee(userId, body!.anneeId, body!.annee);
    if (!cible) {
      return NextResponse.json({ error: 'Annee introuvable' }, { status: 404 });
    }
    const anneeId = cible.id;

    // P62 -- garde de verrou. Le millesime vient de la BASE, pas du body.
    const verrouille = estMoisVerrouille(cible.annee, mois);
    if (verrouille && !derogation) {
      return NextResponse.json(
        {
          error: messageVerrou(cible.annee, mois),
          verrouille: true,
          annee: cible.annee,
          mois,
        },
        { status: 423 },
      );
    }

    // P43 -- toutes les categories citees doivent appartenir a l utilisateur.
    const categorieIds = Object.keys(lignes);
    if (categorieIds.length === 0) {
      return NextResponse.json({ success: true, lignesEcrites: 0 });
    }

    const possedees = await prisma.categorie.findMany({
      where:  { id: { in: categorieIds }, userId },
      select: { id: true },
    });
    if (possedees.length !== categorieIds.length) {
      const connues = new Set(possedees.map(c => c.id));
      const inconnues = categorieIds.filter(id => !connues.has(id));
      return NextResponse.json(
        { error: 'Categorie(s) inconnue(s)', categories: inconnues.slice(0, 10) },
        { status: 404 },
      );
    }

    const ecrireAnticipe = scope === 'previsionnel' || scope === 'les_deux';
    const ecrireReel     = scope === 'suivi'        || scope === 'les_deux';

    // P45 -- une seule transaction, atomique.
    const operations = categorieIds.map(categorieId => {
      const vals = lignes[categorieId];
      const anticipe = versEntier(vals.anticipe);
      const reel     = versEntier(vals.reel);

      return prisma.budgetMensuel.upsert({
        where: {
          userId_anneeId_categorieId_mois: { userId, anneeId, categorieId, mois },
        },
        update: {
          ...(ecrireAnticipe ? { montantAnticipe: anticipe } : {}),
          ...(ecrireReel     ? { montantReel:     reel     } : {}),
        },
        create: {
          userId, anneeId, categorieId, mois,
          montantAnticipe: ecrireAnticipe ? anticipe : BigInt(0),
          montantReel:     ecrireReel     ? reel     : BigInt(0),
        },
      });
    });

    await prisma.$transaction(operations);

    await logAudit({
      userId, action: 'update', entityType: 'budget',
      details: {
        mois,
        anneeId,
        annee: cible.annee,
        scope,
        nbLignes: categorieIds.length,
        ...(verrouille ? { motif: MOTIF_DEROGATION, moisVerrouille: true } : {}),
      },
      req,
    });

    revalidateTag('analytiques-' + userId);

    return NextResponse.json({
      success: true,
      scope,
      lignesEcrites: categorieIds.length,
      derogation: verrouille,
    });
  } catch (e: any) {
    console.error('PUT /api/budget:', e?.message);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/budget  -- ecriture d une ligne unique
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

    const derogation = lireDerogation(raw);

    const { data: body, error: zodErr } = validateBody(BudgetPostSchema, raw);
    if (zodErr) return zodErr;

    const { categorieId, mois, montantAnticipe, montantReel, notes, scope } = body!;

    // Q61 -- coherence scope <-> champs.
    const champFautif = incoherenceScopePost(raw, scope);
    if (champFautif) {
      return NextResponse.json(
        { error: 'Champ "' + champFautif + '" interdit avec scope "' + scope + '"' },
        { status: 422 },
      );
    }

    const cible = await resoudreAnnee(userId, body!.anneeId, body!.annee);
    if (!cible) {
      return NextResponse.json({ error: 'Annee introuvable' }, { status: 404 });
    }
    const anneeId = cible.id;

    // P66 -- meme garde que le PUT. Sans lui, l edition ligne a ligne resterait
    // ouverte sur un mois clos et le verrou serait purement cosmetique.
    const verrouille = estMoisVerrouille(cible.annee, mois);
    if (verrouille && !derogation) {
      return NextResponse.json(
        {
          error: messageVerrou(cible.annee, mois),
          verrouille: true,
          annee: cible.annee,
          mois,
        },
        { status: 423 },
      );
    }

    const cat = await prisma.categorie.findFirst({
      where: { id: categorieId, userId }, select: { id: true, nom: true },
    });
    if (!cat) {
      return NextResponse.json({ error: 'Categorie introuvable' }, { status: 404 });
    }

    const ecrireAnticipe = scope === 'previsionnel' || scope === 'les_deux';
    const ecrireReel     = scope === 'suivi'        || scope === 'les_deux';

    const ligne = await prisma.budgetMensuel.upsert({
      where: {
        userId_anneeId_categorieId_mois: { userId, anneeId, categorieId, mois },
      },
      update: {
        ...(ecrireAnticipe && montantAnticipe !== undefined
          ? { montantAnticipe: versEntier(montantAnticipe) } : {}),
        ...(ecrireReel && montantReel !== undefined
          ? { montantReel: versEntier(montantReel) } : {}),
        ...(notes !== undefined ? { notes: notes ?? null } : {}),
      },
      create: {
        userId, anneeId, categorieId, mois,
        montantAnticipe: ecrireAnticipe ? versEntier(montantAnticipe) : BigInt(0),
        montantReel:     ecrireReel     ? versEntier(montantReel)     : BigInt(0),
        notes: notes ?? null,
      },
    });

    await logAudit({
      userId, action: 'update', entityType: 'budget',
      entityId: ligne.id, entityNom: cat.nom,
      details: {
        mois,
        anneeId,
        annee: cible.annee,
        scope,
        ...(verrouille ? { motif: MOTIF_DEROGATION, moisVerrouille: true } : {}),
      },
      req,
    });

    revalidateTag('analytiques-' + userId);

    return NextResponse.json(serial({
      success: true, id: ligne.id, scope, derogation: verrouille,
    }));
  } catch (e: any) {
    console.error('POST /api/budget:', e?.message);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}