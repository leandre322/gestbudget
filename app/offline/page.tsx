'use client';
import { useEffect, useState } from 'react';

export default function OfflinePage() {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(d => d.length >= 3 ? '' : d + '.');
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '20px',
      padding: '32px 24px',
      fontFamily: 'Inter, system-ui, sans-serif',
      background: 'linear-gradient(135deg, #060914 0%, #0f172a 100%)',
      color: '#E2E8F0',
    }}>
      {/* Logo */}
      <div style={{
        width: '80px',
        height: '80px',
        borderRadius: '20px',
        background: 'linear-gradient(135deg, #3B82F6, #1E40AF)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 12px 32px rgba(59,130,246,0.35)',
        fontSize: '36px',
        fontWeight: 'bold',
        color: 'white',
      }}>G</div>

      {/* Titre */}
      <h1 style={{ fontSize: '24px', fontWeight: '700', margin: 0, letterSpacing: '-0.5px' }}>
        GestBudget
      </h1>

      {/* Icone wifi off */}
      <div style={{
        width: '56px',
        height: '56px',
        borderRadius: '50%',
        background: 'rgba(239,68,68,0.12)',
        border: '1.5px solid rgba(239,68,68,0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '24px',
      }}>
        📵
      </div>

      {/* Message */}
      <div style={{ textAlign: 'center', maxWidth: '300px' }}>
        <p style={{ fontSize: '17px', fontWeight: '600', margin: '0 0 8px', color: '#F1F5F9' }}>
          Vous etes hors ligne
        </p>
        <p style={{ fontSize: '14px', color: '#64748B', margin: 0, lineHeight: '1.6' }}>
          Verifiez votre connexion internet et reessayez pour acceder a votre tableau de bord.
        </p>
      </div>

      {/* Indicateur attente */}
      <p style={{ fontSize: '13px', color: '#475569', minWidth: '140px', textAlign: 'center' }}>
        Attente de connexion{dots}
      </p>

      {/* Bouton retry */}
      <button
        onClick={() => window.location.href = '/dashboard'}
        style={{
          marginTop: '4px',
          padding: '12px 32px',
          borderRadius: '14px',
          background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
          color: '#fff',
          border: 'none',
          fontSize: '15px',
          fontWeight: '600',
          cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(59,130,246,0.4)',
          transition: 'transform 0.1s, box-shadow 0.1s',
        }}
        onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.97)')}
        onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
      >
        Reessayer
      </button>

      {/* Version */}
      <p style={{ position: 'absolute', bottom: '24px', fontSize: '11px', color: '#334155' }}>
        GestBudget — Mode hors ligne
      </p>
    </div>
  );
}