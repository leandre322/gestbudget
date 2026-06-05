'use client';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

// Donnees lentes — revalidation toutes les 5 minutes
export function useCategories() {
  return useSWR('/api/categories', fetcher, {
    revalidateOnFocus:    false,
    revalidateOnReconnect:true,
    dedupingInterval:     5 * 60 * 1000,
  });
}

export function useParametres() {
  return useSWR('/api/parametres', fetcher, {
    revalidateOnFocus:    false,
    revalidateOnReconnect:true,
    dedupingInterval:     5 * 60 * 1000,
  });
}

// Donnees moderees — revalidation toutes les 30 secondes
export function useBanques() {
  return useSWR('/api/banques', fetcher, {
    revalidateOnFocus:   true,
    dedupingInterval:    30 * 1000,
    refreshInterval:     0,
  });
}

export function useComptes() {
  return useSWR('/api/comptes', fetcher, {
    revalidateOnFocus:   true,
    dedupingInterval:    30 * 1000,
    refreshInterval:     0,
  });
}

// Donnees rapides — revalidation a chaque focus
export function useDashboardGlobal(mois: number, annee: number) {
  return useSWR(
    `/api/dashboard/global?mois=${mois}&annee=${annee}`,
    fetcher,
    {
      revalidateOnFocus:    true,
      dedupingInterval:     10 * 1000,
      refreshInterval:      0,
    }
  );
}

export function useDashboardCumul() {
  return useSWR('/api/dashboard/cumul', fetcher, {
    revalidateOnFocus:    false,
    dedupingInterval:     60 * 1000,
    refreshInterval:      0,
  });
}
// Anomalies — cache 5 min
export function useAnomalies(mois: number, annee: number) {
  return useSWR(
    `/api/anomalies?mois=${mois}&annee=${annee}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5 * 60 * 1000 }
  );
}

// Projets
export function useProjets(statut?: 'actif' | 'atteint' | 'abandonne') {
  const url = statut ? `/api/projets?statut=${statut}` : '/api/projets'
  const { data, error, mutate, isLoading } = useSWR(url, fetcher, {
    refreshInterval: 60000, // refresh toutes les 60s
  })
  return {
    projets:  data?.projets  ?? [],
    nbRetard: data?.nbRetard ?? 0,
    isLoading,
    isError:  !!error,
    mutate,
  }
}

// Badge retard projets (utilise dans Topbar/layout)
export function useNbProjetsEnRetard() {
  const { data } = useSWR('/api/projets', fetcher, { refreshInterval: 300000 })
  return data?.nbRetard ?? 0
}


// Recap annuel — cache fort (donnees historiques)
export function useRecapAnnuel(annee: number, moisCourant: number) {
  return useSWR(
    `/api/dashboard/recap?annee=${annee}&mois=${moisCourant}`,
    (url: string) => fetch(url).then(r => r.json()),
    {
      revalidateOnFocus:     false,
      revalidateOnReconnect: false,
      dedupingInterval:      10 * 60 * 1000, // 10 min — donnees annuelles stables
    }
  );
}