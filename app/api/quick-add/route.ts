import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { verifierSeuilsBudget } from '@/lib/alertes'
import { revalidateTag } from 'next/cache' // S6 : même invalidation que /api/budget
import { MONTANT_MAX } from '@/lib/validators' // S24 / P120-bis

const QuickAddSchema = z.object({
  montant: z.number().int().positive().max(MONTANT_MAX, `Montant superieur au plafond de ${MONTANT_MAX} FCFA`),
  categorieId: z.string().min(1),
  libelle: z.string().max(100).optional().nullable(),
})

// ── POST — Ajout rapide : incrémente montantReel du MOIS RÉEL COURANT ────────
// Décision S6 : date serveur (alignée avec le layout qui initialise sur new Date()
// et avec le cron des récurrentes) — jamais Parametres.moisCourant.
// Le client ne peut PAS choisir le mois → aucune falsification possible.
//
// P120-bis (S24) — le plafond ci-dessus ne protege qu un seul appel. Une
// succession d ajouts rapides peut toujours faire depasser MONTANT_MAX en
// cumul sur montantReel : seule la contrainte CHECK Postgres (S24-Q10, pas
// encore deployee) ferme ce cas, via l increment atomique ci-dessous.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Non autorise' }, { status: 401 })
  }
  const userId = session.user.id

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ message: 'JSON invalide' }, { status: 400 })
  }

  const parsed = QuickAddSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ message: 'Donnees invalides', errors: parsed.error.flatten() }, { status: 422 })
  }
  const { montant, categorieId, libelle } = parsed.data

  try {
    // Sécurité : catégorie appartenant à l'utilisateur et active
    const categorie = await prisma.categorie.findUnique({ where: { id: categorieId } })
    if (!categorie || categorie.userId !== userId || !categorie.isActive) {
      return NextResponse.json({ message: 'Categorie introuvable' }, { status: 404 })
    }

    // Mois réel courant (côté serveur). S24 / P120-bis : getUTCMonth /
    // getUTCFullYear plutot que getMonth / getFullYear. Vercel execute deja
    // en UTC, donc ceci ne change rien en production aujourd'hui — mais rend
    // le comportement independant du fuseau du serveur d'execution, et
    // aligne avec lib/periode.ts (I16), deja UTC-normalise pour le verrou.
    // Sans cet alignement, un futur changement de region d'execution ferait
    // deriver silencieusement le mois que quick-add ecrit par rapport au
    // mois que le verrou evalue — les deux doivent lire la meme horloge.
    const now = new Date()
    const mois = now.getUTCMonth() + 1
    const anneeNum = now.getUTCFullYear()

    const annee = await prisma.annee.findUnique({
      where: { userId_annee: { userId, annee: anneeNum } },
    })
    if (!annee) {
      return NextResponse.json({ message: `Annee ${anneeNum} introuvable — ouvrez d'abord le suivi mensuel` }, { status: 422 })
    }

    // Upsert atomique : incrément de montantReel (jamais d'écrasement)
    const ligne = await prisma.budgetMensuel.upsert({
      where: {
        userId_anneeId_categorieId_mois: { userId, anneeId: annee.id, categorieId, mois },
      },
      create: {
        userId,
        anneeId: annee.id,
        categorieId,
        mois,
        montantAnticipe: BigInt(0),
        montantReel: BigInt(montant),
      },
      update: {
        montantReel: { increment: BigInt(montant) },
      },
    })

    await logAudit({
      userId,
      action: 'update',        // S6 : AuditAction est un union strict — filtrer via entityType='budget_mensuel'
      entityType: 'budget_mensuel',
      entityId: ligne.id,
      entityNom: categorie.nom,
      details: { montant, mois, annee: anneeNum, libelle: libelle ?? null },
      req,
    })

    // S6 : invalide le cache analytiques (aligné sur PUT/POST /api/budget)
    revalidateTag(`analytiques-${userId}`)

    // P138-bis (S24 / Q7-c) — verifierSeuilsBudget ne peut pas lever : elle
    // encapsule tout son corps dans un try/catch (lib/alertes.ts) et chaque
    // sendPushToUser a son propre .catch. Mais elle peut etre LENTE : jusqu'a
    // deux appels reseau vers le service push en serie, apres la mutation
    // deja committee. Sans plafond, cette latence peut pousser la reponse HTTP
    // au-dela du temps que l'utilisateur attend, avec un re-clic → nouvel
    // appel recu par le serveur, qui incremente une seconde fois.
    // Plafond de 3 s, sans nouvelle dependance. Limite connue : passe le
    // plafond, la promesse continue en arriere-plan sans garantie de
    // completion sur Vercel serverless — une alerte de seuil peut alors etre
    // perdue en silence. Correctif definitif prevu : I52 (cle d'idempotence
    // sur quick-add), pas encore fait.
    await Promise.race([
      verifierSeuilsBudget({ userId, anneeId: annee.id, categorieId, mois }),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ])

    return NextResponse.json({
      ok: true,
      categorie: categorie.nom,
      montantReel: Number(ligne.montantReel),
      mois,
      annee: anneeNum,
    }, { status: 201 })
  } catch (e) {
    console.error('[POST /api/quick-add]', e)
    return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 })
  }
}