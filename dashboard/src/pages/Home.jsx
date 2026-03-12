import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const COLORS = {
  navy: '#1a3a5c',
  gold: '#c9a961',
  danger: '#dc2626',
  warning: '#f59e0b',
  success: '#10b981',
  neutral: '#6b7280',
  cardBg: '#151b2e',
  border: '#1e293b',
  bg: '#0a0e1a',
};

const STATUS = {
  nominal:  { color: COLORS.success, label: 'HEALTHY',  dot: '#10b981' },
  elevated: { color: COLORS.warning, label: 'WARNING',  dot: '#f59e0b' },
  critical: { color: COLORS.danger,  label: 'CRITICAL', dot: '#dc2626' },
};

// Derive a simple sponsor readiness from scores
function getSponsorStatus(d) {
  const controversy = d.controversy_score ?? 0;
  const sentiment = d.sentiment_score ?? 70;
  if (controversy > 40 || sentiment < 50) return { color: COLORS.danger,  label: 'SPONSOR RISK',    bg: '#dc262618' };
  if (controversy > 25 || sentiment < 60) return { color: COLORS.warning, label: 'REVIEW ADVISED',  bg: '#f59e0b18' };
  return { color: COLORS.success, label: 'SPONSOR READY', bg: '#10b98118' };
}

// Derive overall score from available fields
function getOverallScore(d) {
  if (d.composite_score != null) return d.composite_score;
  const fields = ['sentiment_score','credibility_score','likeability_score','leadership_score','authenticity_score','relevance_score'];
  const vals = fields.map(f => d[f]).filter(v => v != null);
  if (!vals.length) return null;
  const avg = Math.round(vals.reduce((a,b) => a+b,0) / vals.length);
  return Math.max(0, Math.min(100, avg - Math.round((d.controversy_score ?? 0) * 0.3)));
}

function formatFollowers(n) {
  if (!n) return null;
  if (n >= 1e6) return `${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n/1e3).toFixed(0)}K`;
  return String(n);
}

// Mini sparkline-style score bar
function ScoreBar({ label, value, invert = false }) {
  const pct = Math.min(100, Math.max(0, value ?? 0));
  const isGood = invert ? pct < 25 : pct >= 65;
  const isBad  = invert ? pct > 40 : pct < 50;
  const color  = isGood ? COLORS.success : isBad ? COLORS.danger : COLORS.warning;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{label}</span>
        <span style={{ fontSize: '1.1rem', fontWeight: 800, color, lineHeight: 1 }}>{value ?? '—'}</span>
      </div>
      <div style={{ height: 3, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 1s ease' }} />
      </div>
    </div>
  );
}

// Concern flag chips
function getFlags(d) {
  const flags = [];
  if ((d.controversy_score ?? 0) > 40) flags.push({ label: 'High controversy', color: COLORS.danger });
  else if ((d.controversy_score ?? 0) > 25) flags.push({ label: 'Controversy rising', color: COLORS.warning });
  if ((d.sentiment_score ?? 100) < 50) flags.push({ label: 'Sentiment critical', color: COLORS.danger });
  else if ((d.sentiment_score ?? 100) < 60) flags.push({ label: 'Sentiment low', color: COLORS.warning });
  if ((d.credibility_score ?? 100) < 55) flags.push({ label: 'Credibility concern', color: COLORS.warning });
  return flags;
}

export default function Home() {
  const [dashboards, setDashboards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    api.athletes()
      .then(setDashboards)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // Tick every minute so "last updated" stays fresh
    const ticker = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(ticker);
  }, []);

  // Sort: critical first, then warning, then healthy — within each group by overall score desc
  const sorted = [...dashboards].sort((a, b) => {
    const order = { critical: 0, elevated: 1, nominal: 2 };
    const aLevel = order[a.overall_alert_level] ?? 2;
    const bLevel = order[b.overall_alert_level] ?? 2;
    if (aLevel !== bLevel) return aLevel - bLevel;
    return (getOverallScore(b) ?? 0) - (getOverallScore(a) ?? 0);
  });

  const criticalCount  = dashboards.filter(d => d.overall_alert_level === 'critical').length;
  const warningCount   = dashboards.filter(d => d.overall_alert_level === 'elevated').length;
  const healthyCount   = dashboards.filter(d => !d.overall_alert_level || d.overall_alert_level === 'nominal').length;

  if (loading) return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLORS.gold, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.4 }}>◎</div>
        <div style={{ fontSize: '0.85rem', color: '#64748b', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Loading intelligence…</div>
      </div>
    </div>
  );

  if (error) return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLORS.danger, fontFamily: 'system-ui, sans-serif' }}>
      Error: {error}
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: `linear-gradient(160deg, #080c16 0%, #0d1424 50%, #0a0e1a 100%)`, fontFamily: 'system-ui, -apple-system, sans-serif', color: '#fff' }}>
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulseRing {
          0%,100% { box-shadow: 0 0 0 0 rgba(220,38,38,0.4); }
          50%      { box-shadow: 0 0 0 6px rgba(220,38,38,0); }
        }
        @keyframes scanline {
          0%   { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        .athlete-card {
          animation: fadeSlideIn 0.5s ease-out backwards;
          transition: transform 0.25s cubic-bezier(0.4,0,0.2,1), box-shadow 0.25s ease;
          cursor: pointer;
        }
        .athlete-card:hover {
          transform: translateY(-3px) scale(1.005);
        }
        .critical-pulse { animation: pulseRing 2s ease-in-out infinite; }
        .stat-bar-fill { transition: width 1.2s cubic-bezier(0.4,0,0.2,1); }
      `}</style>

      {/* ── PAGE HEADER ── */}
      <div style={{ borderBottom: `1px solid ${COLORS.border}`, padding: '1.5rem 2.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(21,27,46,0.8)', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: 3, height: 28, background: COLORS.gold, borderRadius: 2 }} />
          <div>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, letterSpacing: '-0.01em', color: '#fff' }}>BLUE <span style={{ color: COLORS.gold }}>&</span> LINTELL</div>
            <div style={{ fontSize: '0.65rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: '1px' }}>Intelligence Dashboard</div>
          </div>
        </div>

        {/* Fleet status summary */}
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
          {criticalCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.danger, animation: 'pulseRing 2s infinite' }} />
              <span style={{ fontSize: '0.8rem', color: COLORS.danger, fontWeight: 700 }}>{criticalCount} Critical</span>
            </div>
          )}
          {warningCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.warning }} />
              <span style={{ fontSize: '0.8rem', color: COLORS.warning, fontWeight: 700 }}>{warningCount} Warning</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.success }} />
            <span style={{ fontSize: '0.8rem', color: COLORS.success, fontWeight: 700 }}>{healthyCount} Healthy</span>
          </div>
          <div style={{ height: 20, width: 1, background: COLORS.border }} />
          <div style={{ fontSize: '0.75rem', color: '#475569' }}>{dashboards.length} athlete{dashboards.length !== 1 ? 's' : ''} monitored</div>
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '2.5rem 2rem' }}>

        {/* Section label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.75rem' }}>
          <h2 style={{ margin: 0, fontSize: '0.75rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700 }}>Athlete roster</h2>
          <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${COLORS.border}, transparent)` }} />
          <span style={{ fontSize: '0.7rem', color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Sorted by priority</span>
        </div>

        {dashboards.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: '#475569' }}>
            <div style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.3 }}>◎</div>
            <p>No athlete data yet. Run a refresh to populate.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {sorted.map((d, idx) => {
              const status      = STATUS[d.overall_alert_level] || STATUS.nominal;
              const sponsor     = getSponsorStatus(d);
              const overall     = getOverallScore(d);
              const flags       = getFlags(d);
              const isCritical  = d.overall_alert_level === 'critical';
              const isWarning   = d.overall_alert_level === 'elevated';
              const twitterFmt  = formatFollowers(d.twitter_followers);
              const igFmt       = formatFollowers(d.instagram_followers);

              // Left accent color based on status
              const accentColor = isCritical ? COLORS.danger : isWarning ? COLORS.warning : COLORS.success;

              return (
                <Link key={d.athlete_id} to={`/athlete/${d.athlete_id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div
                    className={`athlete-card ${isCritical ? 'critical-pulse' : ''}`}
                    style={{
                      animationDelay: `${idx * 0.06}s`,
                      background: `linear-gradient(135deg, ${COLORS.cardBg} 0%, rgba(26,58,92,0.15) 100%)`,
                      border: `1px solid ${isCritical ? COLORS.danger + '50' : isWarning ? COLORS.warning + '30' : COLORS.border}`,
                      borderLeft: `4px solid ${accentColor}`,
                      borderRadius: 10,
                      padding: '1.5rem 1.75rem',
                      boxShadow: isCritical
                        ? `0 4px 24px rgba(220,38,38,0.15), 0 1px 4px rgba(0,0,0,0.4)`
                        : `0 4px 16px rgba(0,0,0,0.3)`,
                    }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '1.5rem', alignItems: 'center' }}>

                      {/* LEFT: name + meta + score bars */}
                      <div style={{ minWidth: 0 }}>

                        {/* Name row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '1.15rem', fontWeight: 800, letterSpacing: '-0.01em', color: '#f1f5f9' }}>{d.athlete_name || 'Unknown'}</span>

                          {/* Status badge */}
                          <span style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: status.color, background: `${status.color}18`, border: `1px solid ${status.color}40`, padding: '2px 8px', borderRadius: 4 }}>
                            {status.label}
                          </span>

                          {/* Sponsor status badge */}
                          <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: sponsor.color, background: sponsor.bg, border: `1px solid ${sponsor.color}30`, padding: '2px 8px', borderRadius: 4 }}>
                            {sponsor.label}
                          </span>

                          {/* Concern flags */}
                          {flags.map((f, fi) => (
                            <span key={fi} style={{ fontSize: '0.62rem', fontWeight: 700, color: f.color, background: `${f.color}15`, border: `1px solid ${f.color}30`, padding: '2px 7px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                              ⚠ {f.label}
                            </span>
                          ))}
                        </div>

                        {/* Follower meta */}
                        {(twitterFmt || igFmt) && (
                          <div style={{ fontSize: '0.75rem', color: '#475569', marginBottom: '1rem', display: 'flex', gap: '1rem' }}>
                            {twitterFmt && <span>𝕏 {twitterFmt}</span>}
                            {igFmt      && <span>IG {igFmt}</span>}
                            <span style={{ color: '#334155' }}>· Updated {d.updated_at ? new Date(d.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                          </div>
                        )}

                        {/* Score bars */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem' }}>
                          <ScoreBar label="Sentiment"   value={d.sentiment_score} />
                          <ScoreBar label="Credibility" value={d.credibility_score} />
                          <ScoreBar label="Likeability" value={d.likeability_score} />
                          <ScoreBar label="Relevance"   value={d.relevance_score} />
                          <ScoreBar label="Controversy" value={d.controversy_score} invert />
                        </div>
                      </div>

                      {/* RIGHT: Overall score circle + drill arrow */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                        {/* Score ring */}
                        <div style={{ position: 'relative', width: 72, height: 72 }}>
                          <svg width="72" height="72" style={{ transform: 'rotate(-90deg)' }}>
                            <circle cx="36" cy="36" r="30" fill="none" stroke={COLORS.border} strokeWidth="4" />
                            <circle
                              cx="36" cy="36" r="30"
                              fill="none"
                              stroke={overall >= 70 ? COLORS.gold : overall >= 55 ? COLORS.warning : COLORS.danger}
                              strokeWidth="4"
                              strokeLinecap="round"
                              strokeDasharray={`${2 * Math.PI * 30}`}
                              strokeDashoffset={`${2 * Math.PI * 30 * (1 - (overall ?? 0) / 100)}`}
                              style={{ transition: 'stroke-dashoffset 1.2s ease' }}
                            />
                          </svg>
                          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                            <span style={{ fontSize: '1.25rem', fontWeight: 900, lineHeight: 1, color: overall >= 70 ? COLORS.gold : overall >= 55 ? COLORS.warning : COLORS.danger }}>
                              {overall ?? '—'}
                            </span>
                            <span style={{ fontSize: '0.5rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '1px' }}>Overall</span>
                          </div>
                        </div>

                        {/* Drill-in arrow */}
                        <div style={{ fontSize: '0.7rem', color: COLORS.gold, fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem', letterSpacing: '0.05em' }}>
                          VIEW <span style={{ fontSize: '0.9rem' }}>→</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Watermark */}
      <div style={{ textAlign: 'center', padding: '2rem', fontSize: '0.65rem', color: '#1e293b', letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 700 }}>
        Blue & Lintell Intelligence · Confidential
      </div>
    </div>
  );
}
