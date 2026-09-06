// =============================================================================
// app/api/enveloppes/glissement/route.ts  --  etape 8 (S15)
// =============================================================================
// Ferme : P31 (CSRF), P32 (TOCTOU), P53 (glissement cross-type), P70 (categorie
//         inactive receveuse).
//
// P31 — la route n appelait pas csrfCheck. Le middleware catch-all /api/:path*
//       couvre cette route, mais la defense en profondeur est la regle du
//       projet : NEXT_PUBLIC_APP_URL absent des variables Vercel fait echouer
//       le middleware en fail-open. Un POST cross-origin pouvait alors deplacer
//       du budget entre enveloppes.
//
// P32 (critique) — les deux findUnique etaient HORS de la transaction. Le
//       $transaction([...]) n encadrait que les deux UPDATE : il rendait
//       l ECRITURE atomique, pas la DECISION. Deux glissements concurrents
//       lisaient le meme montantReference, validaient chacun newFrom >= 0, et
//       la somme des deux passait sous zero. La lecture se fait desormais dans
//       la transaction avec SELECT ... FOR UPDATE : la seconde requete attend
//       la premiere et relit une valeur a jour.
//       Les lignes sont verrouillees dans un ORDRE DETERMINISTE (par id). Sans
//       cela, un glissement A->B concurrent d un glissement B->A verrouillerait
//       les memes lignes en sens inverse : interblocage Postgres, resolu par
//       l abandon d une des deux transactions.
//
// P53 — aucun controle from.type === to.type. Un glissement cross-type
//       deplacait de l allocation entre types SANS passer par les taux : la
//       somme des montantReference d un type cessait d egaler
//       parametres_types.montantReference, et l invariant R3-a se rompait
//       silencieusement. C est la regle R7 de lib/reference, appliquee ici.
//       Corollaire utile : un glissement INTRA-type laisse la somme du type
//       rigoureusement inchangee. R3-a est donc preserve par construction, et
//       cette route n a pas besoin d appeler verifierInvariant.
//
// P70 (nouveau, S15) — aucun filtre isActive. Une categorie soft-deleted
//       portant encore enveloppeActive = true pouvait RECEVOIR un montant.
//       R3-b exige montantReference == 0 sur toute categorie inactive : la
//       prochaine passe remettreAZeroHorsPerimetre aurait efface le montant
//       recu, et le glissement se serait traduit par une perte seche.
//
// Perimetre (Q58) — enveloppeActive reste exige sur les deux categories. Le
//       glissement EST la mecanique D2 : contrairement a la repartition, ou le
//       toggle n a aucun effet budgetaire, il est ici le geste explicite par
//       lequel l utilisateur declare gerer cette categorie en enveloppe.
//
// Convention projet : import prisma par defaut, jamais destructure.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { toNum } from '@/lib/serial';
import { logAudit } from '@/lib/audit';
import { csrfCheck } from '@/lib/api-helpers';
import { estTypeAllouable } from '@/lib/reference';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const GlissementSchema = z.object({
  fromId:  z.string().min(1),
  toId:    z.string().min(1),
  montant: z.number().int().positive(),
});

/** Ligne verrouillee lue dans la transaction. */
interface LigneVerrouillee {
  id: string;
  nom: string;
  type: string;
  montantReference: bigint;
  enveloppeActive: boolean | null;
  isActive: boolean;
}

/** Motif de refus, remonte tel quel a l appelant avec son code HTTP. */
type Refus = { code: number; message: string };

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ message: 'Non autorise' }, { status: 401 });
    }
    const userId = session.user.id;

    // P31 — defense en profondeur, independante du middleware.
    const csrfErr = csrfCheck(req);
    if (csrfErr) return csrfErr;

    let body: unknown;
    try { body = await req.json(); } catch {
      return NextResponse.json({ message: 'JSON invalide' }, { status: 400 });
    }

    const parsed = GlissementSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { message: 'Donnees invalides', errors: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const { fromId, toId, montant } = parsed.data;

    if (fromId === toId) {
      return NextResponse.json({ message: 'Source et cible identiques' }, { status: 422 });
    }

    const montantBig = BigInt(montant);

    // ── P32 : lecture ET decision dans la meme transaction ──────────────────
    const resultat = await prisma.$transaction(async (tx) => {
      // FOR UPDATE verrouille les deux lignes jusqu au commit. ORDER BY id
      // impose un ordre de verrouillage identique a toutes les transactions
      // concurrentes : A->B et B->A ne peuvent plus s interbloquer.
      const lignes = await tx.$queryRaw<LigneVerrouillee[]>`
        SELECT id, nom, "type"::text AS type, "montantReference",
               "enveloppeActive", "isActive"
        FROM categories
        WHERE id = ANY(${[fromId, toId]}::text[])
          AND "userId" = ${userId}
        ORDER BY id
        FOR UPDATE
      `;

      const from = lignes.find(l => l.id === fromId);
      const to   = lignes.find(l => l.id === toId);

      if (!from) {
        return { refus: { code: 404, message: 'Categorie source introuvable' } as Refus };
      }
      if (!to) {
        return { refus: { code: 404, message: 'Categorie cible introuvable' } as Refus };
      }

      // P70 — une categorie inactive est hors perimetre R3-b : son
      // montantReference doit rester a 0. Lui glisser un montant reviendrait a
      // le perdre a la prochaine remise a zero.
      if (!from.isActive || !to.isActive) {
        return {
          refus: {
            code: 422,
            message: 'Les deux categories doivent etre actives',
          } as Refus,
        };
      }

      // P53 / R7 — intra-type obligatoire.
      if (from.type !== to.type) {
        return {
          refus: {
            code: 422,
            message:
              'Glissement impossible entre deux types differents. '
              + 'Le budget d un type se regle par son taux dans Parametres, '
              + 'pas par un glissement d enveloppe.',
          } as Refus,
        };
      }

      // Un type non allouable (revenu) ne porte aucune allocation : y glisser
      // un montant creerait de la valeur hors invariant.
      if (!estTypeAllouable(from.type)) {
        return {
          refus: {
            code: 422,
            message: 'Le type ' + from.type + ' ne porte pas d allocation budgetaire',
          } as Refus,
        };
      }

      if (from.enveloppeActive !== true || to.enveloppeActive !== true) {
        return {
          refus: {
            code: 422,
            message: 'Les deux categories doivent avoir une enveloppe active',
          } as Refus,
        };
      }

      // Valeur relue SOUS VERROU : elle ne peut plus etre perimee.
      const disponible = from.montantReference;
      if (montantBig > disponible) {
        return {
          refus: {
            code: 422,
            message:
              'Montant superieur au budget disponible ('
              + toNum(disponible) + ' FCFA)',
          } as Refus,
        };
      }

      const nouveauFrom = disponible - montantBig;
      const nouveauTo   = to.montantReference + montantBig;

      await tx.categorie.update({
        where: { id: fromId },
        data:  { montantReference: nouveauFrom },
      });
      await tx.categorie.update({
        where: { id: toId },
        data:  { montantReference: nouveauTo },
      });

      return {
        refus: null,
        type: from.type,
        fromNom: from.nom,
        toNom: to.nom,
        ancienFrom: disponible,
        ancienTo: to.montantReference,
        nouveauFrom,
        nouveauTo,
      };
    });

    if (resultat.refus) {
      return NextResponse.json(
        { message: resultat.refus.message },
        { status: resultat.refus.code },
      );
    }

    // Audit apres commit : une transaction annulee ne doit pas laisser de trace
    // d une operation qui n a pas eu lieu.
    await logAudit({
      userId,
      action:     'update',
      entityType: 'enveloppe_glissement',
      entityId:   fromId,
      entityNom:  resultat.fromNom + ' -> ' + resultat.toNom,
      details: {
        type:               resultat.type,
        intraType:          true,
        fromId,
        fromNom:            resultat.fromNom,
        ancienMontantFrom:  toNum(resultat.ancienFrom),
        nouveauMontantFrom: toNum(resultat.nouveauFrom),
        toId,
        toNom:              resultat.toNom,
        ancienMontantTo:    toNum(resultat.ancienTo),
        nouveauMontantTo:   toNum(resultat.nouveauTo),
        montantGlisse:      montant,
      },
      req,
    });

    return NextResponse.json({
      ok:   true,
      type: resultat.type,
      from: { id: fromId, montantReference: toNum(resultat.nouveauFrom) },
      to:   { id: toId,   montantReference: toNum(resultat.nouveauTo)   },
    });
  } catch (e: any) {
    console.error('POST /api/enveloppes/glissement:', e?.message);
    return NextResponse.json({ message: 'Erreur interne' }, { status: 500 });
  }
}
