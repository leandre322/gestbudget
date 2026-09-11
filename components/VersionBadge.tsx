'use client'

// =============================================================================
// components/VersionBadge.tsx  --  I65 (S25-Q17-b)
// =============================================================================
// Remplace la chaine "v1.0" codee en dur dans components/Sidebar.tsx, jamais
// incrementee depuis sa creation.
//
// DEUX SHA
//   - SHA client : fige dans le bundle au build via
//     NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA (exposee par Vercel quand
//     "Automatically expose System Environment Variables" est cochee).
//     Absent en local ou si l option est decochee : null, sans erreur.
//   - SHA serveur : /api/version (I44), session obligatoire, no-store.
//   S ils different, le navigateur execute un ancien bundle (cache du service
//   worker next-pwa) : un bouton "Recharger" apparait.
//
// AFFICHAGE
//   SHA serveur en priorite (c est lui que la Regle 31 compare a
//   git rev-parse --short HEAD), sinon SHA client, sinon "local".
//   Clic sur le SHA : copie dans le presse-papiers (controle 2 sur mobile,
//   sans console). L infobulle montre les deux SHA.
//
// PERFORMANCE
//   - Cache et horodatage au niveau MODULE : ouvrir et fermer le tiroir mobile
//     remonte le composant sans refaire l appel.
//   - Un appel au montage, puis au retour au premier plan, au plus toutes les
//     5 minutes. Aucun appel par navigation : la barre laterale vit dans le
//     layout.
//   - Aucun acces base (I44 ne lit que process.env).
//
// SECURITE
//   - Sept caracteres de SHA, aucune donnee metier.
//   - Le SHA client est lisible dans le bundle public, sans session : ecart
//     assume avec I44 tant que le depot reste prive (S25-Q21).
//   - Echec reseau ou 401 : silencieux, repli sur le SHA client.
// =============================================================================

import { useCallback, useEffect, useState } from 'react'

const SHA_CLIENT: string | null =
  (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || null

const INTERVALLE_MIN_MS = 5 * 60 * 1000

// Etat partage entre montages successifs du composant (tiroir mobile).
// Ecrit uniquement cote navigateur : sonderServeur() n est appelee que
// depuis useEffect, jamais pendant le rendu serveur.
let shaServeurCache: string | null = null
let dernierAppel = 0

async function sonderServeur(): Promise<string | null> {
  const maintenant = Date.now()
  if (maintenant - dernierAppel < INTERVALLE_MIN_MS) return shaServeurCache
  dernierAppel = maintenant
  try {
    const r = await fetch('/api/version', { cache: 'no-store' })
    if (!r.ok) return shaServeurCache
    const d = await r.json()
    if (typeof d?.sha === 'string' && d.sha.length > 0) shaServeurCache = d.sha
  } catch {
    // Informatif : un echec ne doit jamais gener la navigation.
  }
  return shaServeurCache
}

export default function VersionBadge({ className }: { className?: string }) {
  const [serveur, setServeur] = useState<string | null>(shaServeurCache)
  const [copie, setCopie] = useState(false)

  const rafraichir = useCallback(() => {
    sonderServeur().then(sha => {
      if (sha) setServeur(sha)
    })
  }, [])

  useEffect(() => {
    rafraichir()
    const surVisibilite = () => {
      if (document.visibilityState === 'visible') rafraichir()
    }
    document.addEventListener('visibilitychange', surVisibilite)
    return () => document.removeEventListener('visibilitychange', surVisibilite)
  }, [rafraichir])

  const affiche = serveur ?? SHA_CLIENT ?? 'local'
  const perimee = SHA_CLIENT !== null && serveur !== null && SHA_CLIENT !== serveur
  const titre =
    'Client ' + (SHA_CLIENT ?? 'inconnu') +
    ' / Serveur ' + (serveur ?? 'inconnu') +
    ' (cliquer pour copier)'

  const copier = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(affiche)
      setCopie(true)
      window.setTimeout(() => setCopie(false), 1500)
    } catch {
      // Presse-papiers indisponible : le SHA reste lisible a l ecran.
    }
  }, [affiche])

  const recharger = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker?.getRegistration()
      await reg?.update()
    } catch {
      // Sans service worker actif, un rechargement simple suffit.
    }
    window.location.reload()
  }, [])

  return (
    <span className={'inline-flex items-center gap-1.5 ' + (className ?? '')}>
      {perimee && (
        <button
          type="button"
          onClick={recharger}
          title="Une version plus récente est en ligne"
          className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-400 hover:bg-amber-500/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        >
          Recharger
        </button>
      )}
      <button
        type="button"
        onClick={copier}
        title={titre}
        aria-label={'Version ' + affiche + ', cliquer pour copier'}
        className="min-w-[7ch] text-right tabular-nums hover:underline focus:outline-none focus-visible:underline"
      >
        {copie ? 'Copié' : affiche}
      </button>
    </span>
  )
}
