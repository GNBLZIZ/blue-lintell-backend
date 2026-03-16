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

function getSponsorStatus(d) {
  const controversy = d.controversy_score ?? 0;
  const sentiment = d.sentiment_score ?? 70;
  if (controversy > 40 || sentiment < 50) return { color: COLORS.danger,  label: 'COMMERCIAL RISK',    bg: '#dc262618' };
  if (controversy > 25 || sentiment < 60) return { color: COLORS.warning, label: 'REVIEW ADVISED',  bg: '#f59e0b18' };
  return { color: COLORS.success, label: 'COMMERCIALLY STRONG', bg: '#10b98118' };
}

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

function ScoreBar({ label, shortLabel, value, invert = false }) {
  const pct = Math.min(100, Math.max(0, value ?? 0));
  const isGood = invert ? pct < 25 : pct >= 65;
  const isBad  = invert ? pct > 40 : pct < 50;
  const color  = isGood ? COLORS.success : isBad ? COLORS.danger : COLORS.warning;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.25rem' }}>
        <span style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, minWidth: 0, overflow: 'hidden' }}>
          <span className="label-full">{label}</span>
          <span className="label-short">{shortLabel || label}</span>
        </span>
        <span style={{ fontSize: '1.1rem', fontWeight: 800, color, lineHeight: 1, flexShrink: 0 }}>{value ?? '—'}</span>
      </div>
      <div style={{ height: 3, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 1s ease' }} />
      </div>
    </div>
  );
}

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
  const [rollingMap, setRollingMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    api.athletes()
      .then(async (data) => {
        setDashboards(data);
        const rollingResults = await Promise.allSettled(
          data.map(d =>
            fetch(`https://blue-lintell-backend-production-4040.up.railway.app/api/athlete/${d.athlete_id}/rolling/7`)
              .then(r => r.ok ? r.json() : null)
              .then(r => r ? ({ id: d.athlete_id, scores: r.scores }) : null)
              .catch(() => null)
          )
        );
        const map = {};
        rollingResults.forEach(result => {
          if (result.status === 'fulfilled' && result.value) {
            map[result.value.id] = result.value.scores;
          }
        });
        setRollingMap(map);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    const ticker = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(ticker);
  }, []);

  const sorted = [...dashboards].sort((a, b) => {
    const order = { critical: 0, elevated: 1, nominal: 2 };
    const aLevel = order[a.overall_alert_level] ?? 2;
    const bLevel = order[b.overall_alert_level] ?? 2;
    if (aLevel !== bLevel) return aLevel - bLevel;
    return (getOverallScore(b) ?? 0) - (getOverallScore(a) ?? 0);
  });

  const criticalCount = dashboards.filter(d => d.overall_alert_level === 'critical').length;
  const warningCount  = dashboards.filter(d => d.overall_alert_level === 'elevated').length;
  const healthyCount  = dashboards.filter(d => !d.overall_alert_level || d.overall_alert_level === 'nominal').length;

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
        @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulseRing { 0%,100% { box-shadow: 0 0 0 0 rgba(220,38,38,0.4); } 50% { box-shadow: 0 0 0 6px rgba(220,38,38,0); } }
        .athlete-card { animation: fadeSlideIn 0.5s ease-out backwards; transition: transform 0.25s cubic-bezier(0.4,0,0.2,1), box-shadow 0.25s ease; cursor: pointer; }
        .athlete-card:hover { transform: translateY(-3px) scale(1.005); }
        .critical-pulse { animation: pulseRing 2s ease-in-out infinite; }
        .label-short { display: none; }
        .label-full  { display: inline; }
        @media (max-width: 600px) {
          .label-short { display: inline; }
          .label-full  { display: none; }
        }
        .card-inner { display: grid; grid-template-columns: 1fr auto; gap: 1.5rem; align-items: center; }
        @media (max-width: 480px) {
          .card-inner { grid-template-columns: 1fr; }
          .score-ring { display: none; }
          .score-bars-grid { grid-template-columns: repeat(3, 1fr) !important; }
        }
        .fleet-subbar { display: flex; align-items: center; justify-content: flex-end; gap: 1.25rem; flex-wrap: wrap; }
        .home-content { max-width: 1100px; margin: 0 auto; padding: 2rem 1rem; }
        @media (min-width: 640px) { .home-content { padding: 2.5rem 2rem; } }
        @media (max-width: 500px) {
          .fleet-subbar { justify-content: flex-start; padding: 0.6rem 1rem; }
        }
        .rolling-badge { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.6rem; color: ${COLORS.gold}; background: ${COLORS.gold}15; border: 1px solid ${COLORS.gold}30; padding: 1px 6px; borderRadius: 3px; fontWeight: 700; letterSpacing: 0.05em; textTransform: uppercase; margin-left: 0.5rem; }
      `}</style>

      {/* Fleet status sub-bar */}
      <div className="fleet-subbar" style={{ borderBottom: `1px solid ${COLORS.border}`, padding: '0.6rem 2.5rem', background: 'rgba(10,14,26,0.6)' }}>
        {criticalCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: COLORS.danger, animation: 'pulseRing 2s infinite' }} />
            <span style={{ fontSize: '0.75rem', color: COLORS.danger, fontWeight: 700 }}>{criticalCount} Critical</span>
          </div>
        )}
        {warningCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: COLORS.warning }} />
            <span style={{ fontSize: '0.75rem', color: COLORS.warning, fontWeight: 700 }}>{warningCount} Warning</span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: COLORS.success }} />
          <span style={{ fontSize: '0.75rem', color: COLORS.success, fontWeight: 700 }}>{healthyCount} Healthy</span>
        </div>
        <div style={{ height: 14, width: 1, background: COLORS.border }} />
        <div style={{ fontSize: '0.7rem', color: '#475569' }}>{dashboards.length} athlete{dashboards.length !== 1 ? 's' : ''} monitored</div>
        <div style={{ height: 14, width: 1, background: COLORS.border }} />
        <div style={{ fontSize: '0.7rem', color: COLORS.gold, fontWeight: 600 }}>7-day rolling averages</div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div className="home-content">

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
              const rolling = rollingMap[d.athlete_id];
              const rd = rolling ? {
                sentiment_score:    rolling.sentiment?.rolling_avg    ?? d.sentiment_score,
                credibility_score:  rolling.credibility?.rolling_avg  ?? d.credibility_score,
                likeability_score:  rolling.likeability?.rolling_avg  ?? d.likeability_score,
                controversy_score:  rolling.controversy?.rolling_avg  ?? d.controversy_score,
                relevance_score:    rolling.relevance?.rolling_avg    ?? d.relevance_score,
                composite_score:    d.composite_score,
                overall_alert_level: d.overall_alert_level
              } : d;

              const status     = STATUS[d.overall_alert_level] || STATUS.nominal;
              const sponsor    = getSponsorStatus(rd);
              const overall    = getOverallScore(rd);
              const flags      = getFlags(rd);
              const isCritical = d.overall_alert_level === 'critical';
              const isWarning  = d.overall_alert_level === 'elevated';
              const twitterFmt = formatFollowers(d.twitter_followers);
              const igFmt      = formatFollowers(d.instagram_followers);
              const accentColor = isCritical ? COLORS.danger : isWarning ? COLORS.warning : COLORS.success;
              const hasRolling = !!rolling;

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
                    <div className="card-inner">

                      <div style={{ minWidth: 0 }}>

                        {/* Name row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '1.15rem', fontWeight: 800, letterSpacing: '-0.01em', color: '#f1f5f9' }}>{d.athlete_name || 'Unknown'}</span>
                          <span style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: status.color, background: `${status.color}18`, border: `1px solid ${status.color}40`, padding: '2px 8px', borderRadius: 4 }}>
                            {status.label}
                          </span>
                          <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: sponsor.color, background: sponsor.bg, border: `1px solid ${sponsor.color}30`, padding: '2px 8px', borderRadius: 4 }}>
                            {sponsor.label}
                          </span>
                          {flags.map((f, fi) => (
                            <span key={fi} style={{ fontSize: '0.62rem', fontWeight: 700, color: f.color, background: `${f.color}15`, border: `1px solid ${f.color}30`, padding: '2px 7px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                              ⚠ {f.label}
                            </span>
                          ))}
                        </div>

                        {/* Follower meta */}
                        {(twitterFmt || igFmt) && (
                          <div style={{ fontSize: '0.75rem', color: '#475569', marginBottom: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                            {twitterFmt && <span>𝕏 {twitterFmt}</span>}
                            {igFmt      && <span>IG {igFmt}</span>}
                            <span style={{ color: '#334155' }}>· Updated {d.updated_at ? new Date(d.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                            {hasRolling && <span style={{ color: COLORS.gold, fontWeight: 600 }}>· 7-day avg</span>}
                          </div>
                        )}

                        {/* Score bars — using rolling averages */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.75rem' }}>
                          <ScoreBar label="Sentiment"   shortLabel="Sent."  value={rd.sentiment_score} />
                          <ScoreBar label="Credibility" shortLabel="Cred."  value={rd.credibility_score} />
                          <ScoreBar label="Likeability" shortLabel="Like."  value={rd.likeability_score} />
                          <ScoreBar label="Relevance"   shortLabel="Rel."   value={rd.relevance_score} />
                          <ScoreBar label="Controversy" shortLabel="Cont."  value={rd.controversy_score} invert />
                        </div>
                      </div>

                      {/* RIGHT: Overall score circle */}
                      <div className="score-ring" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
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
    </div>
  );
}
