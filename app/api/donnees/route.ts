import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { logAudit } from '@/lib/audit';
import { reponsePrisma } from '@/lib/prisma-errors';
import { estMoisVerrouille, messageVerrou } from '@/lib/periode';
import { revalidateTag } from 'next/cache';

// ─────────────────────────────────────────────────────────────────────────────
// S23 / Lot 0 — corrections de ce fichier
//
//   P144  `mois` n etait pas valide, et le branchement se faisait sur sa
//         VERACITE : `if (mois)`. `mois=0`, `mois=abc` et `mois=` (vide)
//         produisent tous une valeur falsy et tombaient dans la branche
//         `else` = suppression de l ANNEE ENTIERE. Trois facons d ecrire
//         « un mois » detruisaient l exercice complet.
//         Correction (Q15-b) : parametre `portee` OBLIGATOIRE et explicite.
//         L annee ne peut plus etre supprimee par omission ni par erreur de
//         saisie — seulement par une intention ecrite en toutes lettres.
//
//   P143  Aucun controle de verrou. P119 a pose le verrou en ECRITURE sur
//         /api/budget ; le laisser franchissable en SUPPRESSION le vide de
//         son sens. Q23 : verrou ABSOLU, aucune derogation.
//         Le jeton `gb_unlock` autorise a CORRIGER un mois clos ; il n a
//         jamais vocation a autoriser a l EFFACER — une suppression ne
//         laisse rien a corriger.
//         NB : estMoisVerrouille() ne verrouille que les mois PASSES
//         (ligne 60 de lib/periode.ts). Une annee melange donc des mois
//         verrouilles et des mois libres : le controle est fait mois par
//         mois sur les mois PORTEURS DE DONNEES, jamais sur « l annee ».
//
//   P145  Les trois suppressions (budget, decaissements, annee) etaient
//         sequentielles. Un echec au deuxieme laissait le budget detruit,
//         les decaissements intacts et l annee presente — sans retour
//         arriere possible. Desormais dans un $transaction unique.
//
//   P142  Aucune trace. La route la plus destructive de l application
//         n appelait pas logAudit, la ou import et quick-add le font.
//         Patron en DEUX TEMPS (Q16), calque sur le CronLog S10/P1 :
//         intention AVANT (survit a un crash), resultat APRES (avec count).
//
//   P140  `return NextResponse.json({ error: e?.message })` exposait le
//         message Prisma brut : nom de table, contrainte, fragment SQL.
//         app/api/import/route.ts porte deja le commentaire qui l interdit.
//         Remplace par reponsePrisma() — meme mapping que le reste de l API.
//
//   P126  Rappel : decaissements.anneeId est en ON DELETE SET NULL au
//         schema. Ce fichier supprime les decaissements AVANT l annee,
//         dans la meme transaction : aucun orphelin ne peut etre produit
//         par ce chemin. P126 protege contre une suppression par SQL
//         direct, pas contre cette route.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Validation stricte des parametres (P144) ────────────────────────────────
// `portee` est le coeur de la correction. Sans lui, la requete est rejetee en
// 400 : il n existe plus aucun chemin implicite vers la suppression d annee.
const SuppressionSchema = z.object({
  annee:  z.coerce.number().int().min(2000).max(2100),
  portee: z.enum(['mois', 'annee']),
  mois:   z.coerce.number().int().min(1).max(12).optional(),
}).superRefine((v, ctx) => {
  if (v.portee === 'mois' && v.mois === undefined) {
    ctx.addIssue({
      code: 'custom', path: ['mois'],
      message: 'Le mois est obligatoire pour une suppression de portee "mois"',
    });
  }
  if (v.portee === 'annee' && v.mois !== undefined) {
    ctx.addIssue({
      code: 'custom', path: ['mois'],
      message: 'Le parametre mois est incompatible avec une portee "annee"',
    });
  }
});

// ── DELETE ───────────────────────────────────────────────────────────────────
// DELETE /api/donnees?annee=2027&portee=mois&mois=3
// DELETE /api/donnees?annee=2027&portee=annee
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });
  }
  const userId = session.user.id;

  const { searchParams } = new URL(req.url);
  const parsed = SuppressionSchema.safeParse({
    annee:  searchParams.get('annee'),
    portee: searchParams.get('portee'),
    mois:   searchParams.get('mois') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parametres invalides', errors: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { annee, portee, mois } = parsed.data;

  try {
    const anneeRec = await prisma.annee.findUnique({
      where: { userId_annee: { userId, annee } },
    });
    if (!anneeRec) {
      return NextResponse.json({ error: 'Annee introuvable' }, { status: 404 });
    }

    // ── Controle de verrou, AVANT toute suppression (P143) ──────────────────
    if (portee === 'mois') {
      if (estMoisVerrouille(annee, mois!)) {
        return NextResponse.json(
          { error: messageVerrou(annee, mois!), motif: 'mois_verrouille' },
          { status: 423 }
        );
      }
    } else {
      // Portee annee : on ne verrouille pas « l annee », qui n est pas une
      // periode. On verifie chaque mois PORTEUR DE DONNEES. Un seul mois
      // verrouille suffit a refuser : on n efface pas un exercice clos,
      // meme partiellement.
      const moisPorteurs = await prisma.budgetMensuel.findMany({
        where:    { userId, anneeId: anneeRec.id },
        select:   { mois: true },
        distinct: ['mois'],
      });
      const verrouilles = moisPorteurs
        .map((m: { mois: number }) => m.mois)
        .filter((m: number) => estMoisVerrouille(annee, m))
        .sort((a: number, b: number) => a - b);

      if (verrouilles.length > 0) {
        return NextResponse.json(
          {
            error:
              'Suppression refusee : ' + verrouilles.length +
              ' mois verrouille(s) dans cette annee (' + verrouilles.join(', ') + ').',
            motif: 'annee_partiellement_verrouillee',
            moisVerrouilles: verrouilles,
          },
          { status: 423 }
        );
      }
    }

    // ── Audit, temps 1 : INTENTION (P142 / Q16) ─────────────────────────────
    // Ecrit AVANT la suppression. Une interruption entre les deux laisse une
    // trace d intention sans trace de resultat : l anomalie devient visible,
    // au lieu de disparaitre avec la reponse HTTP.
    await logAudit({
      userId,
      action:     'delete',
      entityType: 'donnees',
      entityId:   anneeRec.id,
      entityNom:  portee === 'mois' ? annee + '-' + String(mois).padStart(2, '0') : String(annee),
      details:    { phase: 'intention', portee, annee, mois: mois ?? null },
      req,
    });

    // ── Suppression ─────────────────────────────────────────────────────────
    if (portee === 'mois') {
      const supprime = await prisma.budgetMensuel.deleteMany({
        where: { userId, anneeId: anneeRec.id, mois },
      });

      await logAudit({
        userId,
        action:     'delete',
        entityType: 'donnees',
        entityId:   anneeRec.id,
        entityNom:  annee + '-' + String(mois).padStart(2, '0'),
        details:    { phase: 'resultat', portee, annee, mois, budgetSupprimes: supprime.count },
        req,
      });

      revalidateTag('analytiques-' + userId);

      return NextResponse.json({
        success: true,
        message: supprime.count + ' entree(s) supprimee(s) pour ' + annee + '/' + mois,
        count:   supprime.count,
      });
    }

    // Portee annee — P145 : les trois operations sont atomiques. L ordre
    // (decaissements, budget, annee) evite tout orphelin, y compris si le
    // ON DELETE SET NULL du schema devenait RESTRICT (P126).
    const [supprDec, supprBudget] = await prisma.$transaction([
      prisma.decaissement.deleteMany({ where: { userId, anneeId: anneeRec.id } }),
      prisma.budgetMensuel.deleteMany({ where: { userId, anneeId: anneeRec.id } }),
      prisma.annee.delete({ where: { id: anneeRec.id } }),
    ]);

    await logAudit({
      userId,
      action:     'delete',
      entityType: 'donnees',
      entityId:   anneeRec.id,
      entityNom:  String(annee),
      details:    {
        phase: 'resultat', portee, annee,
        budgetSupprimes:       supprBudget.count,
        decaissementsSupprimes: supprDec.count,
      },
      req,
    });

    revalidateTag('analytiques-' + userId);

    return NextResponse.json({
      success: true,
      message:
        'Annee ' + annee + ' supprimee (' + supprBudget.count +
        ' entrees budget, ' + supprDec.count + ' decaissements)',
      count: supprBudget.count + supprDec.count,
    });

  } catch (e: any) {
    // P140 : le message brut ne sort plus. reponsePrisma() applique le meme
    // mapping que le reste de l API et journalise cote serveur.
    return reponsePrisma(e, 'DELETE /api/donnees');
  }
}

// ── GET — Liste des annees avec stats ────────────────────────────────────────
// Inchange fonctionnellement. Seul le catch est corrige (P140).
// I46 (N+1 : deux requetes par annee) est identifie mais hors perimetre du
// lot : a 3 annees le cout est negligeable.
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });
    }
    const userId = session.user.id;

    const annees = await prisma.annee.findMany({
      where:   { userId },
      orderBy: { annee: 'asc' },
    });

    const stats = await Promise.all(annees.map(async (a: { id: string; annee: number }) => {
      const moisAvecDonnees = await prisma.budgetMensuel.findMany({
        where:    { userId, anneeId: a.id },
        select:   { mois: true },
        distinct: ['mois'],
      });
      const nbDecaissements = await prisma.decaissement.count({
        where: { userId, anneeId: a.id },
      });

      const listeMois = moisAvecDonnees
        .map((m: { mois: number }) => m.mois)
        .sort((x: number, y: number) => x - y);

      return {
        id:              a.id,
        annee:           a.annee,
        nbMois:          listeMois.length,
        moisAvecDonnees: listeMois,
        // S23 : expose les mois verrouilles pour que le front puisse desactiver
        // le bouton de suppression au lieu de laisser l utilisateur decouvrir
        // le 423 apres coup.
        moisVerrouilles: listeMois.filter((m: number) => estMoisVerrouille(a.annee, m)),
        nbDecaissements,
      };
    }));

    return NextResponse.json({ annees: stats });
  } catch (e: any) {
    return reponsePrisma(e, 'GET /api/donnees');
  }
}