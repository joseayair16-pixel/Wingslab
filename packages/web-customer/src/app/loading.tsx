import { SaDelLoader } from '../components/SaDelLoader';

export default function Loading() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100dvh', gap: '16px', padding: '24px', background: '#fafafa',
    }}>
      <SaDelLoader />
    </div>
  );
}
