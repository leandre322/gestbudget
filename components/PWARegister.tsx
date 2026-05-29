'use client';

import { useEffect } from 'react';

export default function PWARegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then(reg => {
            console.log('[PWA] Service Worker enregistré:', reg.scope);

            // Vérifier les mises à jour toutes les 60 secondes
            setInterval(() => reg.update(), 60_000);

            reg.addEventListener('updatefound', () => {
              const newWorker = reg.installing;
              newWorker?.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  console.log('[PWA] Nouvelle version disponible — rechargez la page');
                }
              });
            });
          })
          .catch(err => console.error('[PWA] Erreur SW:', err));
      });
    }
  }, []);

  return null; // Composant invisible
}
