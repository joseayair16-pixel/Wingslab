export default function Loading() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100dvh', gap: '16px', padding: '24px', background: '#fafafa',
    }}>
      <div style={{
        width: 48, height: 48, border: '4px solid #e0e0e0', borderTopColor: '#0ea5e9',
        borderRadius: '50%', animation: 'spin 0.8s linear infinite',
      }} />
      <p style={{ color: '#666', fontSize: '0.875rem' }}>Cargando...</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
