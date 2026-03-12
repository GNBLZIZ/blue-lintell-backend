import { Link, useLocation } from 'react-router-dom';

const COLORS = {
  navy: '#1a3a5c',
  gold: '#c9a961',
  border: '#1e293b',
  cardBg: '#151b2e',
};

export default function Layout({ children }) {
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #080c16 0%, #0d1424 50%, #0a0e1a 100%)', display: 'flex', flexDirection: 'column' }}>

      {/* ── GLOBAL STICKY NAV ── */}
      <header style={{
        borderBottom: `1px solid ${COLORS.border}`,
        padding: '0 2.5rem',
        height: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(13,20,36,0.92)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        position: 'sticky',
        top: 0,
        zIndex: 200,
        boxShadow: '0 1px 0 rgba(201,169,97,0.1)',
      }}>

        {/* Brand */}
        <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
          <div style={{ width: 3, height: 26, background: COLORS.gold, borderRadius: 2, flexShrink: 0 }} />
          <div>
            <div style={{
              fontSize: '1.15rem',
              fontWeight: 900,
              letterSpacing: '0.08em',
              color: '#fff',
              lineHeight: 1.1,
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}>
              BLUE <span style={{ color: COLORS.gold }}>&amp;</span> LINTELL
            </div>
            <div style={{
              fontSize: '0.55rem',
              color: '#475569',
              textTransform: 'uppercase',
              letterSpacing: '0.2em',
              marginTop: '1px',
            }}>
              Intelligence Platform
            </div>
          </div>
        </Link>

        {/* Right side nav */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <Link
            to="/"
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: isHome ? COLORS.gold : '#475569',
              textDecoration: 'none',
              padding: '0.4rem 0.9rem',
              borderRadius: 6,
              background: isHome ? `${COLORS.gold}12` : 'transparent',
              border: `1px solid ${isHome ? COLORS.gold + '30' : 'transparent'}`,
              transition: 'all 0.2s ease',
            }}
          >
            Flight Deck
          </Link>
        </nav>
      </header>

      {/* ── PAGE CONTENT ── */}
      <main style={{ flex: 1 }}>
        {children}
      </main>

      {/* ── GLOBAL FOOTER WATERMARK ── */}
      <div style={{
        textAlign: 'center',
        padding: '1.5rem',
        fontSize: '0.6rem',
        color: '#1e293b',
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        fontWeight: 700,
        borderTop: `1px solid ${COLORS.border}20`,
      }}>
        Blue &amp; Lintell Intelligence · Confidential
      </div>
    </div>
  );
}
