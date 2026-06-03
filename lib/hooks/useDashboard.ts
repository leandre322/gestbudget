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