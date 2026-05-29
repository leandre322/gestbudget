export default function OfflinePage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '16px',
      padding: '24px',
      fontFamily: 'Inter, system-ui, sans-serif',
      background: '#060914',
      color: '#E2E8F0',
    }}>
      <div style={{
        width: '64px', height: '64px',
        borderRadius: '16px',
        background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 8px 24px rgba(59,130,246,0.40)',
        fontSize: '28px',
      }}>
        📊
      </div>
      <h1 style={{ fontSize: '22px', fontWeight: '600', margin: 0 }}>
        GestBudget
      </h1>
      <p style={{ fontSize: '15px', color: '#94A3B8', textAlign: 'center', margin: 0, maxWidth: '320px' }}>
        Vous êtes hors ligne. Reconnectez-vous à internet pour accéder à votre budget.
      </p>
      <button
        onClick={() => window.location.reload()}
        style={{
          marginTop: '8px',
          padding: '10px 24px',
          borderRadius: '12px',
          background: '#3B82F6',
          color: '#fff',
          border: 'none',
          fontSize: '14px',
          fontWeight: '600',
          cursor: 'pointer',
        }}
      >
        Réessayer
      </button>
    </div>
  );
}
