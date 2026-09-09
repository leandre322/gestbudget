// =============================================================================
// app/api/version/route.ts  --  I44 (S22) : sonde universelle de deploiement
// =============================================================================
// Motif (Regle 31, corollaire). Le corollaire de la Regle 31 imposait un
// marqueur de version PAR correctif : `plafondMontant` sur /api/budget,
// `verdict` sur /api/enveloppes/repartition. Deux limites mesurees en S22 :
//
//   1. Le marqueur ne peut prouver le deploiement QUE du fichier qui le porte.
//      En S22 la sonde `verdict` repondait undefined ; la cause etait que
//      app/api/enveloppes/repartition/route.ts n avait jamais ete commite,
//      alors que lib/reference.ts (P121 + P122-A) l etait et etait bien
//      deploye. Le marqueur a donc dit vrai sur son fichier et faux sur le
//      lot : il ne mesure pas ce qu on lui demande.
//
//   2. Un marqueur absent ne distingue pas « code non deploye » de « 401 »,
//      « 404 » ou « 405 ». La sonde repond undefined dans les quatre cas.
//
// Cette route repond aux deux : elle renvoie le SHA du commit REELLEMENT
// deploye par Vercel. La comparaison avec `git rev-parse --short HEAD` prouve
// le deploiement de N IMPORTE QUEL fichier du lot en un seul controle.
//
// Les marqueurs metier existants (`plafondMontant`, `verdict`) ne sont PAS
// retires : ils portent une information fonctionnelle propre. Ils cessent
// seulement d etre le moyen de prouver un deploiement.
//
// SECURITE
//   - Session obligatoire. Un SHA sur depot prive n est pas exploitable seul,
//     mais l authentification supprime le debat.
//   - SHA tronque a 7 caracteres : suffisant pour comparer, inutile pour
//     reconstruire quoi que ce soit.
//   - Aucun message de commit, aucun nom de fichier, aucune variable
//     d environnement applicative n est exposee.
//
// PERFORMANCE
//   - Aucun acces base. Lecture de process.env uniquement.
//   - Cache-Control: no-store. Une reponse mise en cache par le navigateur ou
//     par le CDN ferait mentir la sonde apres un redeploiement : c est
//     exactement le mode d echec que cette route existe pour eliminer.
//
// USAGE (bloc console navigateur, lecture seule)
//     const v = await fetch('/api/version');
//     console.log(v.status, await v.json());
//
// Puis en terminal :  git rev-parse --short HEAD
// Les deux SHA doivent etre identiques avant tout test d ecriture (Regle 31).
// =============================================================================

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });
    }

    // Variables injectees automatiquement par Vercel a la construction.
    // En local elles sont absentes : `sha` vaut null et `env` vaut 'local',
    // ce qui distingue sans ambiguite un poste de developpement d un
    // deploiement.
    const shaComplet = process.env.VERCEL_GIT_COMMIT_SHA ?? null;

    const res = NextResponse.json({
      sha: shaComplet ? shaComplet.slice(0, 7) : null,
      env: process.env.VERCEL_ENV ?? 'local',
      branche: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    });

    res.headers.set('Cache-Control', 'no-store, max-age=0');
    return res;
  } catch (e: any) {
    console.error('GET /api/version:', e?.message);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
