// =============================================================================
// app/api/budget/route.ts  --  etape 10b, version 4 (S21)
// =============================================================================
// Ferme : Q43 (scope), P41, P43, P45, P55  [v2, inchange]
//       + P62 (verrou serveur), P66 (POST non garde), Q61 (coherence scope)
//       + P119 (annee creee avant le controle de verrou)
//       + P120 / Q182 (bornes de montant, refus 422)
//
// P119 — resoudreAnnee() faisait un upsert AVANT l evaluation du verrou. Une
//        requete refusee en 423 laissait donc une ligne `annees` derriere elle :
//        une ecriture produite par une requete rejetee. Le millesime est
//        desormais lu SANS ecrire (resoudreMillesime), le verrou est evalue sur
//        ce millesime, et la ligne `annees` n est materialisee (materialiserAnnee)
//        qu une fois TOUS les gardes franchis, juste avant la transaction.
//        Nombre de requetes inchange dans le chemin nominal : l upsert est
//        deplace, pas duplique. Dans le chemin refuse il disparait.
//        Le GET conserve sa creation bornee (P55) : decision assumee, une
//        navigation legitime a le droit de materialiser l annee affichee.
//
// P120 / Q182 — versEntier() clampait silencieusement a 0 et n avait aucune
//        borne haute. Un montant negatif devenait 0 sans que l appelant le
//        sache, et 9 223 372 036 854 775 807 passait jusqu au bigint. Trois
//        refus explicites en 422 : valeur non numerique, montant negatif,
//        montant superieur a MONTANT_MAX (1 000 000 000 FCFA).
//        Consequence sur P69 : le clamp silencieux des negatifs disparait cote
//        serveur. La normalisation client (I14) reste utile pour eviter
//        l aller-retour, elle n est plus le seul garde-fou.
//        Seuls les champs REELLEMENT ecrits sont valides : en scope 'suivi' la
//        cle `anticipe` est absente (Q61) et ne doit pas produire de 422.
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
// ORDRE DES GARDES (PUT et POST), a preserver en cas de reprise :
//   1. session         401
//   2. csrf            403
//   3. json            400
//   4. zod             400/422
//   5. Q61 scope       422
//   6. millesime       404          <- LECTURE SEULE
//   7. verrou P62/P66  423
//   8. proprietes cat  404
//   9. montants P120   422
//  10. materialisation annee        <- PREMIERE ECRITURE
//  11. transaction
//
// LIMITE CONNUE (Q67) : aucun jeton de concurrence sur le PUT. Deux onglets sur
// le meme mois : le dernier ecrase. Atenue cote client par l envoi des seules
// lignes modifiees (dirtyCats), pas ferme cote serveur.
//
// LIMITE CONNUE (Q68) : /api/quick-add ecrit montantReel par increment et n est
// pas garde par le verrou. A traiter pour que la cloture soit reelle.
//
// LIMITE CONNUE (S21) : le millesime fourni dans le body n est borne par aucun
// intervalle sur PUT/POST, contrairement au GET (FENETRE_CREATION_ANNEE). Un
// PUT sur annee=1999 materialise donc une ligne `annees` hors de toute fenetre
// utile. Non corrige ici : ce serait un changement de contrat d API, pas une
// correction de P119. A arbitrer.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { serial } from '@/lib/serial';
import { reponsePrisma } from '@/lib/prisma-errors';
import { logAudit } from '@/lib/audit';
import { csrfCheck, validateBody } from '@/lib/api-helpers';
import { BudgetPutSchema, BudgetPostSchema } from '@/lib/validators';
import { revalidateTag } from 'next/cache';
import { estMoisVerrouille, messageVerrou, MOTIF_DEROGATION } from '@/lib/periode';

export const dynamic = 'force-dynamic';

// P88 -- le PUT en masse ouvre une transaction de N upserts. Le defaut Hobby
// de 10 s est insuffisant sur un mois complet avec une base froide.
export const maxDuration = 60;

/** Fenetre dans laquelle un GET a le droit de creer la ligne Annee (P55). */
const FENETRE_CREATION_ANNEE = 1;

/** P120 / Q182 -- plafond d un montant unitaire, en FCFA. */
const MONTANT_MAX = 1000000000;

const CATEGORIE_SELECT = {
  select: { id: true, nom: true, type: true, ordre: true },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// P120 -- normalisation et bornes des montants
// ─────────────────────────────────────────────────────────────────────────────

type MotifMontant = 'non_numerique' | 'negatif' | 'hors_borne';

interface VerdictMontant {
  ok: boolean;
  valeur: bigint;
  motif: MotifMontant | null;
}

/** Champ absent ou vide : 0, sans erreur. Comportement historique conserve. */
const MONTANT_ABSENT: VerdictMontant = { ok: true, valeur: BigInt(0), motif: null };

/**
 * Convertit une valeur de body en bigint borne.
 * - undefined / null / chaine vide  -> 0, accepte
 * - non numerique                   -> refus 'non_numerique'
 * - < 0                             -> refus 'negatif'      (P120, ex-clamp P69)
 * - > MONTANT_MAX                   -> refus 'hors_borne'   (Q182)
 * Les decimales sont tronquees sans erreur : 12.7 -> 12.
 */
function versEntier(v: unknown): VerdictMontant {
  if (v === undefined || v === null || v === '') return MONTANT_ABSENT;

  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) return { ok: false, valeur: BigInt(0), motif: 'non_numerique' };

  const e = Math.trunc(n);
  if (e < 0)           return { ok: false, valeur: BigInt(0), motif: 'negatif' };
  if (e > MONTANT_MAX) return { ok: false, valeur: BigInt(0), motif: 'hors_borne' };

  return { ok: true, valeur: BigInt(e), motif: null };
}

function messageMontant(motif: MotifMontant | null): string {
  if (motif === 'negatif')    return 'montant negatif refuse';
  if (motif === 'hors_borne') return 'montant superieur au plafond de ' + MONTANT_MAX + ' FCFA';
  return 'valeur non numerique';
}

// ─────────────────────────────────────────────────────────────────────────────
// P119 -- resolution du millesime en deux temps
// ─────────────────────────────────────────────────────────────────────────────

interface CibleAnnee {
  /** null quand la ligne `annees` n existe pas encore : materialisation differee. */
  id: string | null;
  annee: number;
}

/**
 * LECTURE SEULE. Resout le millesime necessaire au controle de verrou sans
 * jamais ecrire. Deux entrees possibles :
 *   - anneeId : verifie la propriete (P43) et retourne le millesime en base.
 *   - annee   : retenu tel quel, la ligne sera creee plus tard si les gardes
 *               passent.
 * Retourne null quand la cible est introuvable ou non fournie -> 404.
 */
async function resoudreMillesime(
  userId: string,
  anneeId: string | undefined,
  annee: number | undefined,
): Promise<CibleAnnee | null> {
  if (anneeId) {
    const rec = await prisma.annee.findFirst({
      where: { id: anneeId, userId }, select: { id: true, annee: true },
    });
    return rec ? { id: rec.id, annee: rec.annee } : null;
  }
  if (annee === undefined) return null;
  return { id: null, annee };
}

/**
 * PREMIERE ECRITURE de la requete. A n appeler qu apres le verrou (P62/P66),
 * le controle de propriete des categories (P43) et la validation des montants
 * (P120). L upsert n est pas duplique : il est simplement deplace ici.
 */
async function materialiserAnnee(userId: string, cible: CibleAnnee): Promise<string> {
  if (cible.id) return cible.id;
  const rec = await prisma.annee.upsert({
    where:  { userId_annee: { userId, annee: cible.annee } },
    create: { userId, annee: cible.annee },
    update: {},
    select: { id: true },
  });
  return rec.id;
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

    // P55 -- creation bornee a la fenetre utile. Conservee volontairement (S21) :
    // une navigation legitime a le droit de materialiser l annee affichee.
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
      plafondMontant: MONTANT_MAX,   // P120 -- le client peut borner la saisie
    }));
  } catch (e: any) {
    return reponsePrisma(e, 'GET /api/budget');   // I22 - voir lib/prisma-errors.ts
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

    // ── 5. Q61 -- coherence scope <-> cles, sur le body brut.
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

    // ── 6. P119 -- millesime en LECTURE SEULE. Aucune ecriture avant le verrou.
    const cible = await resoudreMillesime(userId, body!.anneeId, body!.annee);
    if (!cible) {
      return NextResponse.json({ error: 'Annee introuvable' }, { status: 404 });
    }

    // ── 7. P62 -- garde de verrou. Le millesime vient de la BASE quand un
    //      anneeId est fourni, jamais d une valeur libre du body.
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

    // ── 8. P43 -- toutes les categories citees doivent appartenir a l utilisateur.
    const categorieIds = Object.keys(lignes);
    if (categorieIds.length === 0) {
      // P119 : sortie avant toute ecriture, la ligne `annees` n est pas creee.
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

    // ── 9. P120 -- validation des montants AVANT toute ecriture. Seules les
    //      colonnes reellement ecrites sont validees : en scope 'suivi' la cle
    //      `anticipe` est absente (Q61) et ne doit pas produire de refus.
    const invalides: Array<{ categorieId: string; champ: string; motif: string }> = [];
    const valides = new Map<string, { anticipe: bigint; reel: bigint }>();

    for (const categorieId of categorieIds) {
      const vals = lignes[categorieId];
      const va = ecrireAnticipe ? versEntier(vals?.anticipe) : MONTANT_ABSENT;
      const vr = ecrireReel     ? versEntier(vals?.reel)     : MONTANT_ABSENT;

      if (!va.ok) invalides.push({ categorieId, champ: 'anticipe', motif: messageMontant(va.motif) });
      if (!vr.ok) invalides.push({ categorieId, champ: 'reel',     motif: messageMontant(vr.motif) });

      valides.set(categorieId, { anticipe: va.valeur, reel: vr.valeur });
    }

    if (invalides.length > 0) {
      return NextResponse.json(
        {
          error: 'Montant(s) refuse(s)',
          plafond: MONTANT_MAX,
          nbInvalides: invalides.length,
          lignes: invalides.slice(0, 10),
        },
        { status: 422 },
      );
    }

    // ── 10. P119 -- premiere ecriture, tous les gardes franchis.
    const anneeId = await materialiserAnnee(userId, cible);

    // ── 11. P45 -- une seule transaction, atomique.
    const operations = categorieIds.map(categorieId => {
      const v = valides.get(categorieId)!;

      return prisma.budgetMensuel.upsert({
        where: {
          userId_anneeId_categorieId_mois: { userId, anneeId, categorieId, mois },
        },
        update: {
          ...(ecrireAnticipe ? { montantAnticipe: v.anticipe } : {}),
          ...(ecrireReel     ? { montantReel:     v.reel     } : {}),
        },
        create: {
          userId, anneeId, categorieId, mois,
          montantAnticipe: ecrireAnticipe ? v.anticipe : BigInt(0),
          montantReel:     ecrireReel     ? v.reel     : BigInt(0),
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
    return reponsePrisma(e, 'PUT /api/budget');   // I22 - voir lib/prisma-errors.ts
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

    // ── 5. Q61 -- coherence scope <-> champs.
    const champFautif = incoherenceScopePost(raw, scope);
    if (champFautif) {
      return NextResponse.json(
        { error: 'Champ "' + champFautif + '" interdit avec scope "' + scope + '"' },
        { status: 422 },
      );
    }

    // ── 6. P119 -- millesime en LECTURE SEULE.
    const cible = await resoudreMillesime(userId, body!.anneeId, body!.annee);
    if (!cible) {
      return NextResponse.json({ error: 'Annee introuvable' }, { status: 404 });
    }

    // ── 7. P66 -- meme garde que le PUT. Sans lui, l edition ligne a ligne
    //      resterait ouverte sur un mois clos et le verrou serait cosmetique.
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

    // ── 8. P43 -- propriete de la categorie.
    const cat = await prisma.categorie.findFirst({
      where: { id: categorieId, userId }, select: { id: true, nom: true },
    });
    if (!cat) {
      return NextResponse.json({ error: 'Categorie introuvable' }, { status: 404 });
    }

    const ecrireAnticipe = scope === 'previsionnel' || scope === 'les_deux';
    const ecrireReel     = scope === 'suivi'        || scope === 'les_deux';

    // ── 9. P120 -- bornes. `undefined` reste `undefined` : le POST doit pouvoir
    //      ne toucher qu une seule colonne, l absence n est pas une valeur nulle.
    const majAnticipe = ecrireAnticipe && montantAnticipe !== undefined;
    const majReel     = ecrireReel     && montantReel     !== undefined;

    const va = majAnticipe ? versEntier(montantAnticipe) : MONTANT_ABSENT;
    const vr = majReel     ? versEntier(montantReel)     : MONTANT_ABSENT;

    if (!va.ok || !vr.ok) {
      const detail: Array<{ champ: string; motif: string }> = [];
      if (!va.ok) detail.push({ champ: 'montantAnticipe', motif: messageMontant(va.motif) });
      if (!vr.ok) detail.push({ champ: 'montantReel',     motif: messageMontant(vr.motif) });
      return NextResponse.json(
        { error: 'Montant(s) refuse(s)', plafond: MONTANT_MAX, champs: detail },
        { status: 422 },
      );
    }

    // ── 10. P119 -- premiere ecriture, tous les gardes franchis.
    const anneeId = await materialiserAnnee(userId, cible);

    // ── 11. ecriture.
    const ligne = await prisma.budgetMensuel.upsert({
      where: {
        userId_anneeId_categorieId_mois: { userId, anneeId, categorieId, mois },
      },
      update: {
        ...(majAnticipe ? { montantAnticipe: va.valeur } : {}),
        ...(majReel     ? { montantReel:     vr.valeur } : {}),
        ...(notes !== undefined ? { notes: notes ?? null } : {}),
      },
      create: {
        userId, anneeId, categorieId, mois,
        montantAnticipe: ecrireAnticipe ? va.valeur : BigInt(0),
        montantReel:     ecrireReel     ? vr.valeur : BigInt(0),
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
    return reponsePrisma(e, 'POST /api/budget');   // I22 - voir lib/prisma-errors.ts
  }
}
