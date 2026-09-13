'use client';
import { useEffect, useState } from 'react';

export default function ProbePWA() {
  const [resultat, setResultat] = useState<string>('Mesure en cours...');

  useEffect(() => {
    const a = document.querySelector('aside');
    const r = a ? a.getBoundingClientRect() : null;
    const vv = window.visualViewport;
    const data = {
      asideBas: r ? Math.round(r.bottom) : null,
      vvHeight: vv ? Math.round(vv.height) : null,
      standalone: window.matchMedia('(display-mode: standalone)').matches,
      windowInnerHeight: window.innerHeight,
      screenHeight: window.screen.height,
    };
    const texte = JSON.stringify(data, null, 2);
    setResultat(texte);
    alert(texte);
  }, []);

  return (
    <div style={{ padding: 20, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
      <h1>Sonde PWA — P174</h1>
      <p>Résultat (aussi affiché en popup) :</p>
      <pre>{resultat}</pre>
    </div>
  );
}
