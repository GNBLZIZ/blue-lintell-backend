import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend
} from 'recharts';
import { AlertTriangle, TrendingUp, TrendingDown, Shield, ChevronRight, Radio, Target, AlertCircle, CheckCircle, Eye, X } from 'lucide-react';
import { api } from '../api';

const COLORS = {
  navy: '#1a3a5c',
  gold: '#c9a961',
  danger: '#dc2626',
  warning: '#f59e0b',
  success: '#10b981',
  neutral: '#6b7280',
  cardBg: '#151b2e',
  border: '#1e293b'
};

const SCORE_KEYS = [
  'Sentiment', 'Credibility', 'Likeability', 'Leadership', 'Authenticity', 'Controversy', 'Relevance', 'Influence'
];
const SCORE_FIELDS = [
  'sentiment_score', 'credibility_score', 'likeability_score', 'leadership_score',
  'authenticity_score', 'controversy_score', 'relevance_score', 'influence_score'
];

export default function AthleteDetail() {
  const { athleteId } = useParams();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [rollingData, setRollingData] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyDays, setHistoryDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedScore, setExpandedScore] = useState(null);
  const [disclaimerVisible, setDisclaimerVisible] = useState(true);

  const loadDashboard = () => {
    setError(null);
    api.athlete(athleteId).then(setDashboard).catch((e) => setError(e.message));
  };

  const loadRollingAverage = async () => {
    if (!athleteId) return;
    try {
      const response = await fetch(`https://blue-lintell-backend-production-4040.up.railway.app/api/athlete/${athleteId}/rolling/7`);
      if (response.ok) {
        const data = await response.json();
        setRollingData(data);
      }
    } catch (err) {
      console.log('Rolling average not available:', err);
      setRollingData(null);
    }
  };

  const loadHistory = () => {
    if (!athleteId) return;
    api.athleteHistory(athleteId, historyDays).then(setHistory).catch(() => setHistory([]));
  };

  useEffect(() => {
    setLoading(true);
    loadDashboard();
    loadRollingAverage();
    loadHistory();
    setLoading(false);
  }, [athleteId]);

  useEffect(() => {
    if (!athleteId) return;
    loadHistory();
  }, [athleteId, historyDays]);

  // Auto-hide disclaimer after 8 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setDisclaimerVisible(false);
    }, 8000);
    return () => clearTimeout(timer);
  }, []);

  const handleRefresh = () => {
    if (!dashboard) return;
    setRefreshing(true);
    api
      .refresh({
        athleteId: dashboard.athlete_id,
        athleteName: dashboard.athlete_name,
        twitterHandle: dashboard.twitter_handle,
        instagramBusinessId: dashboard.instagram_business_id || '',
        userName: dashboard.perception_details?.instagram_handle || dashboard.instagram_business_id || ''
      })
      .then((res) => {
        if (res.success) {
          loadDashboard();
          loadRollingAverage();
          loadHistory();
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setRefreshing(false));
  };

  if (loading && !dashboard) return <div className="loading">Loading…</div>;
  if (error && !dashboard) {
    return (
      <div className="card">
        <p className="error">{error}</p>
        <button className="btn secondary" onClick={() => navigate('/')}>Back to list</button>
      </div>
    );
  }
  if (!dashboard) return null;

  const alertLevel = dashboard.overall_alert_level || 'nominal';
  const pd = dashboard.perception_details || {};
  const agg = pd.engagement_aggregates || {};
  
  // Calculate Influence score
  const calculateInfluence = () => {
    const twitterFollowers = dashboard.twitter_followers || 0;
    const instagramFollowers = dashboard.instagram_followers || 0;
    const totalFollowers = twitterFollowers + instagramFollowers;
    
    // Base score from follower count (normalize to 0-100)
    let baseScore = Math.min(100, Math.sqrt(totalFollowers / 10000) * 50);
    
    // Engagement multiplier (0.5 to 1.5)
    const twitterEngagement = dashboard.avg_engagement_rate_twitter || 0;
    const instagramEngagement = dashboard.avg_engagement_rate_instagram || 0;
    const avgEngagement = (twitterEngagement + instagramEngagement) / 2;
    const engagementMultiplier = 0.5 + (avgEngagement / 10);
    
    // News coverage bonus (up to +20 points)
    const newsBonus = Math.min(20, (dashboard.news_articles_count || 0) * 2);
    
    // Final calculation
    let influence = (baseScore * engagementMultiplier) + newsBonus;
    influence = Math.min(100, Math.max(0, Math.round(influence)));
    
    return influence;
  };

  // Build scores array with rolling average integration
  const scores = SCORE_KEYS.map((label, i) => {
    const field = SCORE_FIELDS[i];
    let currentValue = dashboard[field] ?? '—';
    
    // Special handling for Influence (calculated field)
    if (field === 'influence_score') {
      currentValue = calculateInfluence();
    }
    
    let rollingAvg = currentValue;
    let changeFromYesterday = null;
    let trend = 'stable';
    
    if (rollingData?.scores?.[field]) {
      rollingAvg = rollingData.scores[field].rolling_avg ?? currentValue;
      changeFromYesterday = rollingData.scores[field].change_from_yesterday ?? null;
      trend = rollingData.scores[field].trend ?? 'stable';
    }
    
    return {
      label,
      value: rollingAvg,
      currentValue,
      changeFromYesterday,
      trend,
      key: field
    };
  });

  const sentimentHistory = (history || [])
    .map((h) => ({ date: h.snapshot_date, sentiment: h.sentiment_score ?? 0 }))
    .filter((d) => d.sentiment > 0);

  const thresholds = { sentiment: { critical: 50, warning: 60 }, controversy: { critical: 40, warning: 30 } };

  const getSnapshotForDaysAgo = (days) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    const target = d.toISOString().split('T')[0];
    const exact = history.find((h) => h.snapshot_date === target);
    if (exact) return exact;
    const after = history.filter((h) => h.snapshot_date >= target);
    return after.length ? after[after.length - 1] : null;
  };

  const snap7 = getSnapshotForDaysAgo(7);
  const snap30 = getSnapshotForDaysAgo(30);

  const scoreEvolution = SCORE_KEYS.map((metric, i) => {
    const field = SCORE_FIELDS[i];
    let current = dashboard[field] ?? 0;
    
    // Special handling for Influence
    if (field === 'influence_score') {
      current = calculateInfluence();
    }
    
    const day7 = snap7?.[field] ?? current;
    const day30 = snap30?.[field] ?? current;
    
    let rolling7d = current;
    if (rollingData?.scores?.[field]) {
      rolling7d = rollingData.scores[field].rolling_avg ?? current;
    }
    
    const change = current - (day30 || current);
    const trend = change > 0 ? 'up' : change < 0 ? 'down' : 'stable';
    return {
      metric,
      current,
      rolling7d,
      day7,
      day30,
      trend,
      change: trend !== 'stable' ? (change > 0 ? `+${change}` : `${change}`) : '0'
    };
  });

  const radarData = scoreEvolution.map((s) => ({
    metric: s.metric,
    current: s.current,
    rolling7d: s.rolling7d,
    day30: s.day30
  }));

  const alerts = [];
  if ((dashboard.sentiment_score ?? 70) < thresholds.sentiment.warning) {
    alerts.push({
      severity: (dashboard.sentiment_score ?? 0) < thresholds.sentiment.critical ? 'critical' : 'elevated',
      type: 'sentiment_drop',
      message: `Sentiment at ${dashboard.sentiment_score} - ${(dashboard.sentiment_score ?? 0) < 50 ? 'Critical' : 'Warning'} threshold`,
      threshold: (dashboard.sentiment_score ?? 0) < 50 ? `<50` : `<60`,
      current: dashboard.sentiment_score
    });
  }
  if ((dashboard.controversy_score ?? 0) > thresholds.controversy.warning) {
    alerts.push({
      severity: (dashboard.controversy_score ?? 0) > thresholds.controversy.critical ? 'critical' : 'elevated',
      type: 'controversy',
      message: `Controversy score ${dashboard.controversy_score} - above warning`,
      threshold: '>30',
      current: dashboard.controversy_score
    });
  }
  if (alerts.length === 0) {
    alerts.push({
      severity: 'nominal',
      type: 'ok',
      message: 'All metrics within normal range.',
      threshold: '—',
      current: '—'
    });
  }

  const statusConfig = {
    nominal: { color: COLORS.success, label: 'NOMINAL', Icon: Shield },
    elevated: { color: COLORS.warning, label: 'ELEVATED', Icon: AlertTriangle },
    critical: { color: COLORS.danger, label: 'CRITICAL', Icon: AlertTriangle }
  };
  const alertConfig = statusConfig[alertLevel] || statusConfig.nominal;
  const AlertIcon = alertConfig.Icon;

  const formatFollowers = (n) => {
    if (n == null) return '—';
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return String(n);
  };

  // Custom Tooltip for charts
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{ background: COLORS.cardBg, border: `2px solid ${COLORS.gold}`, borderRadius: 8, padding: '0.75rem', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
          <p style={{ margin: 0, fontWeight: 600, color: COLORS.gold }}>{label}</p>
          <p style={{ margin: '0.25rem 0 0', color: '#fff' }}>{payload[0].name}: {payload[0].value}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0a0e1a 0%, #151b2e 100%)', color: '#fff', padding: '1.5rem', paddingBottom: disclaimerVisible ? '5rem' : '2rem' }}>
      {/* Header */}
      <div style={{ background: COLORS.navy, borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem', border: `2px solid ${COLORS.gold}40`, boxShadow: '0 6px 20px rgba(0,0,0,0.35), 0 2px 8px rgba(201,169,97,0.15)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <button className="btn secondary" style={{ marginRight: '0.5rem' }} onClick={() => navigate('/')}>← Back</button>
            <h1 style={{ display: 'inline-block', margin: 0, fontSize: '1.75rem', fontWeight: 700 }}>
              {dashboard.athlete_name?.toUpperCase() || 'Athlete'}
            </h1>
            <span style={{ marginLeft: '0.5rem', background: `${alertConfig.color}20`, border: `2px solid ${alertConfig.color}`, color: alertConfig.color, padding: '4px 10px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 700 }}>
              {alertConfig.label}
            </span>
            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#94a3b8' }}>
              {dashboard.twitter_handle && (
                <span>Twitter: {dashboard.twitter_handle} · {formatFollowers(dashboard.twitter_followers)} followers</span>
              )}
              {(pd.instagram_handle || dashboard.instagram_followers) && (
                <span style={{ marginLeft: '1rem' }}>
                  Instagram: @{pd.instagram_handle || '—'} · {formatFollowers(dashboard.instagram_followers)} followers
                </span>
              )}
            </div>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>
              Last updated: {dashboard.updated_at ? new Date(dashboard.updated_at).toLocaleString() : '—'}
              {rollingData?.period_start && rollingData?.period_end && (
                <span style={{ marginLeft: '1rem', color: COLORS.gold }}>
                  7-day rolling average ({new Date(rollingData.period_start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} - {new Date(rollingData.period_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })})
                </span>
              )}
            </p>
            {pd.data_quality && (pd.data_quality.twitter_ok === false || pd.data_quality.sentiment_ok === false) && (
              <p style={{ margin: '0.5rem 0 0', padding: '0.4rem 0.6rem', background: 'rgba(245,158,11,0.15)', borderRadius: 6, fontSize: '0.8rem' }}>
                ⚠ Limited data: {pd.data_quality.twitter_ok === false && 'Twitter unavailable. '}{pd.data_quality.sentiment_ok === false && 'Sentiment unavailable.'}
              </p>
            )}
          </div>
          <button className="btn" onClick={handleRefresh} disabled={refreshing} style={{ background: COLORS.gold, color: COLORS.navy, fontWeight: 700 }}>
            {refreshing ? 'Refreshing…' : 'Refresh data'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: `2px solid ${COLORS.border}` }}>
        {['overview', 'temporal', 'alerts', 'intelligence'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: activeTab === tab ? COLORS.cardBg : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab ? `3px solid ${COLORS.gold}` : '3px solid transparent',
              color: activeTab === tab ? COLORS.gold : '#94a3b8',
              padding: '0.75rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              cursor: 'pointer',
              letterSpacing: '0.5px'
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <>
          {/* FIXED LAYOUT SCORE CARDS - 4 + 4 for perfect balance */}
          <style>{`
            .score-grid {
              display: grid;
              gap: 1.5rem;
              margin-bottom: 2rem;
            }
            
            /* Desktop: 4 columns */
            @media (min-width: 1024px) {
              .score-grid {
                grid-template-columns: repeat(4, 1fr);
              }
            }
            
            /* Tablet: 2 columns */
            @media (min-width: 640px) and (max-width: 1023px) {
              .score-grid {
                grid-template-columns: repeat(2, 1fr);
              }
            }
            
            /* Mobile: 1 column */
            @media (max-width: 639px) {
              .score-grid {
                grid-template-columns: 1fr;
              }
            }
          `}</style>
          
          <div className="score-grid">
            {scores.map((s) => {
              const details = pd[s.label];
              const isExpanded = expandedScore === s.label;
              const isDanger = s.label === 'Controversy' ? (s.value || 0) > thresholds.controversy.warning : (s.value || 0) < thresholds.sentiment.warning;
              
              let changeColor = COLORS.neutral;
              if (s.changeFromYesterday !== null) {
                if (s.label === 'Controversy') {
                  changeColor = s.trend === 'down' ? COLORS.success : s.trend === 'up' ? COLORS.danger : COLORS.neutral;
                } else {
                  changeColor = s.trend === 'up' ? COLORS.success : s.trend === 'down' ? COLORS.danger : COLORS.neutral;
                }
              }
              
              // Determine border color - use gold for high performers
              let borderColor = COLORS.border;
              if (s.label === 'Controversy') {
                if (s.value < 20) borderColor = COLORS.success;
                else if (s.value > 30) borderColor = COLORS.danger;
              } else {
                if (s.value >= 80) borderColor = COLORS.gold;
                else if (s.value < 60) borderColor = COLORS.danger + '60';
              }
              
              return (
                <div
                  key={s.label}
                  className="score-card"
                  onClick={() => setExpandedScore(isExpanded ? null : s.label)}
                  style={{
                    background: COLORS.cardBg,
                    border: `2px solid ${borderColor}`,
                    borderRadius: 12,
                    padding: '2.5rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    boxShadow: '0 6px 20px rgba(0,0,0,0.35), 0 2px 8px rgba(201,169,97,0.15)',
                    transform: isExpanded ? 'translateY(-2px)' : 'none'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-4px)';
                    e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4), 0 4px 12px rgba(201,169,97,0.2)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = isExpanded ? 'translateY(-2px)' : 'none';
                    e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.35), 0 2px 8px rgba(201,169,97,0.15)';
                  }}
                >
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.label}</div>
                  
                  {/* MASSIVE SCORE NUMBER with color coding */}
                  <div style={{ 
                    fontSize: '3.5rem', 
                    fontWeight: 800, 
                    lineHeight: 1, 
                    marginBottom: '0.5rem',
                    color: s.label === 'Controversy' 
                      ? (s.value > 40 ? COLORS.danger : s.value > 30 ? COLORS.warning : COLORS.gold)
                      : (s.value >= 80 ? COLORS.gold : s.value < 60 ? COLORS.danger : '#fff')
                  }}>
                    {s.value ?? '—'}
                  </div>
                  
                  {/* BIGGER Change indicator with more prominence */}
                  {s.changeFromYesterday !== null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', padding: '0.5rem', background: `${changeColor}15`, borderRadius: 6 }}>
                      <span style={{ color: changeColor, fontSize: '1.2rem', fontWeight: 800 }}>
                        {s.trend === 'up' ? '▲' : s.trend === 'down' ? '▼' : '●'}
                      </span>
                      <span style={{ color: changeColor, fontSize: '1.1rem', fontWeight: 700 }}>
                        {s.changeFromYesterday > 0 ? '+' : ''}{s.changeFromYesterday}
                      </span>
                      <span style={{ color: changeColor, fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 600, marginLeft: '0.25rem' }}>
                        vs yesterday
                      </span>
                    </div>
                  )}
                  
                  {/* 7-day average label */}
                  {rollingData && (
                    <div style={{ fontSize: '0.75rem', color: COLORS.gold, marginBottom: '0.75rem', fontWeight: 600 }}>7-day rolling average</div>
                  )}
                  
                  {(details?.summary || isExpanded) && (
                    <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.75rem', lineHeight: 1.5, borderTop: `1px solid ${COLORS.border}`, paddingTop: '0.75rem' }}>
                      {details?.summary || `Score: ${s.value ?? '—'}. Click for details.`}
                    </div>
                  )}
                  <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: COLORS.gold, fontWeight: 600 }}>{isExpanded ? '▲ Collapse' : '▼ Expand rationale'}</div>
                  {isExpanded && (details?.breakdown?.length > 0 ? (
                    <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: `1px solid ${COLORS.border}`, fontSize: '0.8rem', color: '#cbd5e1' }}>
                      {details.breakdown.map((line, i) => (
                        <div key={i} style={{ marginBottom: '0.35rem' }}>• {line}</div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#64748b' }}>No additional breakdown available.</div>
                  ))}
                </div>
              );
            })}
          </div>

          {/* CHARTS ROW - Sentiment + Radar */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
            {/* Sentiment Chart */}
            <div style={{ background: COLORS.cardBg, border: `2px solid ${COLORS.gold}40`, borderRadius: 12, padding: '2rem', boxShadow: '0 6px 20px rgba(0,0,0,0.35), 0 2px 8px rgba(201,169,97,0.15)' }}>
              <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Sentiment evolution</h3>
              {sentimentHistory.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={sentimentHistory}>
                    <defs>
                      <linearGradient id="sentimentGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLORS.gold} stopOpacity={0.3}/>
                        <stop offset="95%" stopColor={COLORS.gold} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                    <XAxis dataKey="date" stroke="#94a3b8" style={{ fontSize: '0.8rem' }} tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
                    <YAxis stroke="#94a3b8" domain={[0, 100]} style={{ fontSize: '0.8rem' }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="sentiment" stroke={COLORS.gold} fill="url(#sentimentGradient)" strokeWidth={3} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p style={{ color: '#64748b' }}>No history yet. Run Refresh to record snapshots.</p>
              )}
            </div>

            {/* Radar Chart - IMPROVED with thicker lines and better distinction */}
            {radarData.length > 0 && (
              <div style={{ background: COLORS.cardBg, border: `2px solid ${COLORS.gold}40`, borderRadius: 12, padding: '2rem', boxShadow: '0 6px 20px rgba(0,0,0,0.35), 0 2px 8px rgba(201,169,97,0.15)' }}>
                <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Reputation snapshot</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke={COLORS.border} strokeWidth={1.5} />
                    <PolarAngleAxis dataKey="metric" stroke="#cbd5e1" style={{ fontSize: '0.85rem', fontWeight: 600 }} />
                    <PolarRadiusAxis stroke="#94a3b8" domain={[0, 100]} style={{ fontSize: '0.75rem' }} />
                    <Radar name="Today's score" dataKey="current" stroke={COLORS.gold} fill={COLORS.gold} fillOpacity={0.4} strokeWidth={4} />
                    <Radar name="7-day average" dataKey="rolling7d" stroke="#fbbf24" fill="#fbbf24" fillOpacity={0.15} strokeDasharray="8 4" strokeWidth={3} />
                    <Legend wrapperStyle={{ fontSize: '0.9rem', fontWeight: 600 }} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Platform Performance + Aggregate Engagement */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '2rem', marginBottom: '2rem' }}>
            <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '2rem', boxShadow: '0 4px 16px rgba(0,0,0,0.3), 0 1px 3px rgba(201,169,97,0.1)' }}>
              <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Platform performance</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ padding: '1rem', background: `${COLORS.border}20`, borderRadius: 8 }}>
                  <div style={{ fontWeight: 600 }}>Twitter · @{dashboard.twitter_handle?.replace('@', '') || '—'}</div>
                  <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{formatFollowers(dashboard.twitter_followers)} followers · {dashboard.avg_tweet_engagement ?? 0} avg engagement</div>
                </div>
                <div style={{ padding: '1rem', background: `${COLORS.border}20`, borderRadius: 8 }}>
                  <div style={{ fontWeight: 600 }}>Instagram · @{pd.instagram_handle || '—'}</div>
                  <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{formatFollowers(dashboard.instagram_followers)} followers · {pd.avg_instagram_engagement ?? 0} avg engagement</div>
                </div>
                <div style={{ padding: '1rem', background: `${COLORS.border}20`, borderRadius: 8 }}>
                  <div style={{ fontWeight: 600 }}>News</div>
                  <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{dashboard.news_articles_count ?? 0} mentions</div>
                </div>
              </div>
            </div>

            <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '2rem', boxShadow: '0 4px 16px rgba(0,0,0,0.3), 0 1px 3px rgba(201,169,97,0.1)' }}>
              <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Aggregate engagement</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                <div style={{ padding: '1rem', background: `${COLORS.border}20`, borderRadius: 8 }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Twitter avg engagement rate</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: COLORS.gold }}>{(dashboard.avg_engagement_rate_twitter ?? agg.avg_engagement_rate_twitter_pct) != null ? `${(dashboard.avg_engagement_rate_twitter ?? agg.avg_engagement_rate_twitter_pct)}%` : '—'}</div>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.5rem' }}>Avg likes: {dashboard.avg_likes_twitter ?? agg.avg_likes_per_post_twitter ?? '—'}</div>
                </div>
                <div style={{ padding: '1rem', background: `${COLORS.border}20`, borderRadius: 8 }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Instagram avg engagement rate</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: COLORS.gold }}>{(dashboard.avg_engagement_rate_instagram ?? agg.avg_engagement_rate_instagram_pct) != null ? `${(dashboard.avg_engagement_rate_instagram ?? agg.avg_engagement_rate_instagram_pct)}%` : '—'}</div>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.5rem' }}>Avg likes: {dashboard.avg_likes_instagram ?? agg.avg_likes_per_post_instagram ?? '—'}</div>
                </div>
                <div style={{ padding: '1rem', background: `${COLORS.border}20`, borderRadius: 8 }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Combined visibility</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: COLORS.gold }}>{dashboard.total_mentions ?? 0}</div>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.5rem' }}>Total mentions</div>
                </div>
              </div>
            </div>
          </div>

          {/* Timeline */}
          {(dashboard.timeline_events?.length > 0) && (
            <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '2rem', boxShadow: '0 4px 16px rgba(0,0,0,0.3), 0 1px 3px rgba(201,169,97,0.1)' }}>
              <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Timeline</h3>
              {dashboard.timeline_events.slice(0, 10).map((ev, i) => (
                <div key={i} style={{ padding: '0.75rem 0', borderBottom: i < 9 ? `1px solid ${COLORS.border}` : 'none' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{ev.date} · {ev.platforms}</div>
                  <div style={{ fontWeight: 600, marginTop: '0.25rem' }}>{ev.title}</div>
                  {ev.description && <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.25rem' }}>{ev.description}</div>}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* TEMPORAL TAB */}
      {activeTab === 'temporal' && (
        <>
          <div style={{ background: COLORS.cardBg, border: `2px solid ${COLORS.gold}40`, borderRadius: 12, padding: '2rem', marginBottom: '2rem', overflowX: 'auto', boxShadow: '0 6px 20px rgba(0,0,0,0.35), 0 2px 8px rgba(201,169,97,0.15)' }}>
            <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Score evolution over time</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${COLORS.gold}60` }}>
                  <th style={{ textAlign: 'left', padding: '1rem', fontSize: '0.8rem', color: COLORS.gold, fontWeight: 700, textTransform: 'uppercase' }}>Metric</th>
                  <th style={{ textAlign: 'right', padding: '1rem', fontSize: '0.8rem', color: COLORS.gold, fontWeight: 700, textTransform: 'uppercase' }}>Today's score<br/><span style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 400 }}>(24hr snapshot)</span></th>
                  <th style={{ textAlign: 'right', padding: '1rem', fontSize: '0.8rem', color: COLORS.gold, fontWeight: 700, textTransform: 'uppercase' }}>7-day average</th>
                  <th style={{ textAlign: 'right', padding: '1rem', fontSize: '0.8rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>1 week ago</th>
                  <th style={{ textAlign: 'right', padding: '1rem', fontSize: '0.8rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>1 month ago</th>
                  <th style={{ textAlign: 'right', padding: '1rem', fontSize: '0.8rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Monthly trend</th>
                </tr>
              </thead>
              <tbody>
                {scoreEvolution.map((row) => (
                  <tr key={row.metric} style={{ borderBottom: `1px solid ${COLORS.border}20` }}>
                    <td style={{ padding: '1rem', fontWeight: 600, fontSize: '0.95rem' }}>{row.metric}</td>
                    <td style={{ padding: '1rem', textAlign: 'right', fontWeight: 700, fontSize: '1.1rem', color: '#fff' }}>{row.current}</td>
                    <td style={{ padding: '1rem', textAlign: 'right', color: COLORS.gold, fontWeight: 700, fontSize: '1.1rem' }}>{row.rolling7d}</td>
                    <td style={{ padding: '1rem', textAlign: 'right', color: '#94a3b8', fontSize: '0.95rem' }}>{row.day7}</td>
                    <td style={{ padding: '1rem', textAlign: 'right', color: '#94a3b8', fontSize: '0.95rem' }}>{row.day30}</td>
                    <td style={{ padding: '1rem', textAlign: 'right', fontWeight: 700, fontSize: '0.95rem' }}>
                      <span style={{ color: row.trend === 'up' ? COLORS.success : row.trend === 'down' ? COLORS.danger : COLORS.neutral }}>
                        {row.trend === 'up' ? '↗ ' : row.trend === 'down' ? '↘ ' : '→ '}
                        {row.trend === 'up' ? 'Improving' : row.trend === 'down' ? 'Declining' : 'Stable'}
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem' }}>({row.change})</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ALERTS TAB */}
      {activeTab === 'alerts' && (
        <div style={{ background: COLORS.cardBg, border: `2px solid ${COLORS.gold}40`, borderRadius: 12, padding: '2rem', boxShadow: '0 6px 20px rgba(0,0,0,0.35), 0 2px 8px rgba(201,169,97,0.15)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem', padding: '1.5rem', background: `${alertConfig.color}15`, border: `2px solid ${alertConfig.color}40`, borderRadius: 8 }}>
            <AlertIcon size={32} color={alertConfig.color} />
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', color: alertConfig.color, letterSpacing: '0.5px' }}>THREAT LEVEL: {alertConfig.label}</div>
              <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.25rem' }}>Last updated: {dashboard.updated_at ? new Date(dashboard.updated_at).toLocaleString() : '—'}</div>
            </div>
          </div>
          <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Active alerts</h3>
          {alerts.map((alert, i) => (
            <div
              key={i}
              style={{
                padding: '1.25rem',
                marginBottom: '1rem',
                background: `${(alert.severity === 'critical' ? COLORS.danger : alert.severity === 'elevated' ? COLORS.warning : COLORS.success)}15`,
                border: `2px solid ${(alert.severity === 'critical' ? COLORS.danger : alert.severity === 'elevated' ? COLORS.warning : COLORS.success)}40`,
                borderRadius: 8,
                borderLeft: `4px solid ${alert.severity === 'critical' ? COLORS.danger : alert.severity === 'elevated' ? COLORS.warning : COLORS.success}`
              }}
            >
              <div style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: '0.75rem', color: alert.severity === 'critical' ? COLORS.danger : alert.severity === 'elevated' ? COLORS.warning : COLORS.success }}>{alert.severity}</div>
              <div style={{ marginTop: '0.5rem', fontSize: '0.95rem' }}>{alert.message}</div>
              <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.5rem' }}>Threshold: {alert.threshold} · Current: {alert.current}</div>
            </div>
          ))}
          <h3 style={{ margin: '2rem 0 1rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Alert threshold configuration</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', fontSize: '0.9rem' }}>
            <div style={{ padding: '1rem', background: `${COLORS.border}40`, borderRadius: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Sentiment</div>
              <div style={{ color: COLORS.danger, marginBottom: '0.25rem' }}>Critical &lt;50</div>
              <div style={{ color: COLORS.warning, marginBottom: '0.25rem' }}>Warning &lt;60</div>
              <div style={{ color: COLORS.success }}>Optimal &gt;70</div>
            </div>
            <div style={{ padding: '1rem', background: `${COLORS.border}40`, borderRadius: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Controversy</div>
              <div style={{ color: COLORS.danger, marginBottom: '0.25rem' }}>Critical &gt;40</div>
              <div style={{ color: COLORS.warning, marginBottom: '0.25rem' }}>Warning &gt;30</div>
              <div style={{ color: COLORS.success }}>Optimal &lt;20</div>
            </div>
          </div>
        </div>
      )}

      {/* INTELLIGENCE TAB - NO BULLETS, REGULAR PARAGRAPHS */}
      {activeTab === 'intelligence' && (
        <>
          {/* Strategic Intelligence Section */}
          {pd.strategic_intelligence && (
            <div style={{ background: COLORS.cardBg, border: `2px solid ${COLORS.gold}40`, borderRadius: 12, padding: '2.5rem', marginBottom: '2rem', boxShadow: '0 6px 20px rgba(0,0,0,0.35), 0 2px 8px rgba(201,169,97,0.15)' }}>
              <h3 style={{ margin: '0 0 2rem', color: COLORS.gold, fontSize: '1.5rem', fontWeight: 800 }}>Strategic Intelligence</h3>
              
              {/* Strategic Overview */}
              {pd.strategic_intelligence.strategic_overview && (
                <div style={{ marginBottom: '2rem', padding: '1.5rem', background: `${COLORS.border}20`, borderRadius: 8, borderLeft: `4px solid ${COLORS.gold}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                    <Target size={24} color={COLORS.gold} />
                    <h4 style={{ margin: 0, color: COLORS.gold, fontSize: '1.1rem', fontWeight: 700 }}>Strategic Overview</h4>
                  </div>
                  <p style={{ lineHeight: 1.7, color: '#e2e8f0', margin: 0, fontSize: '0.95rem' }}>
                    {pd.strategic_intelligence.strategic_overview}
                  </p>
                </div>
              )}

              {/* Key Risks - NO BULLETS */}
              {pd.strategic_intelligence.key_risks?.length > 0 && (
                <div style={{ marginBottom: '2rem', padding: '1.5rem', background: `${COLORS.danger}10`, border: `2px solid ${COLORS.danger}40`, borderRadius: 8, borderLeft: `4px solid ${COLORS.danger}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                    <AlertCircle size={24} color={COLORS.danger} />
                    <h4 style={{ margin: 0, color: COLORS.danger, fontSize: '1.1rem', fontWeight: 700 }}>Key Risks</h4>
                  </div>
                  <div style={{ color: '#fca5a5', lineHeight: 1.8, fontSize: '0.95rem' }}>
                    {pd.strategic_intelligence.key_risks.map((risk, i) => (
                      <p key={i} style={{ margin: i > 0 ? '1rem 0 0' : 0 }}>{risk}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Immediate Recommendations - NO BULLETS */}
              {pd.strategic_intelligence.immediate_recommendations?.length > 0 && (
                <div style={{ marginBottom: '2rem', padding: '1.5rem', background: `${COLORS.success}10`, border: `2px solid ${COLORS.success}40`, borderRadius: 8, borderLeft: `4px solid ${COLORS.success}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                    <CheckCircle size={24} color={COLORS.success} />
                    <h4 style={{ margin: 0, color: COLORS.success, fontSize: '1.1rem', fontWeight: 700 }}>Immediate Recommendations</h4>
                  </div>
                  <div style={{ color: '#86efac', lineHeight: 1.8, fontSize: '0.95rem' }}>
                    {pd.strategic_intelligence.immediate_recommendations.map((rec, i) => (
                      <p key={i} style={{ margin: i > 0 ? '1rem 0 0' : 0 }}>{rec}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Watch-Outs - NO BULLETS */}
              {pd.strategic_intelligence.watch_outs?.length > 0 && (
                <div style={{ padding: '1.5rem', background: `${COLORS.warning}10`, border: `2px solid ${COLORS.warning}40`, borderRadius: 8, borderLeft: `4px solid ${COLORS.warning}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                    <Eye size={24} color={COLORS.warning} />
                    <h4 style={{ margin: 0, color: COLORS.warning, fontSize: '1.1rem', fontWeight: 700 }}>Watch-Outs</h4>
                  </div>
                  <div style={{ color: '#fcd34d', lineHeight: 1.8, fontSize: '0.95rem' }}>
                    {pd.strategic_intelligence.watch_outs.map((watch, i) => (
                      <p key={i} style={{ margin: i > 0 ? '1rem 0 0' : 0 }}>{watch}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Perception Summary */}
          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '2rem', boxShadow: '0 4px 16px rgba(0,0,0,0.3), 0 1px 3px rgba(201,169,97,0.1)' }}>
            <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Overall perception summary</h3>
            <p style={{ lineHeight: 1.7, color: '#e2e8f0', fontSize: '0.95rem' }}>
              {(pd.Sentiment?.summary && pd.Sentiment.summary.trim()) ? pd.Sentiment.summary : `${dashboard.athlete_name} maintains a reputation driven by sentiment (${dashboard.sentiment_score ?? '—'}), credibility (${dashboard.credibility_score ?? '—'}), and relevance (${dashboard.relevance_score ?? '—'}). Twitter and Instagram follower counts and news mentions feed into these scores. Click each score card in the Overview tab for detailed breakdowns.`}
            </p>
            <h4 style={{ margin: '1.5rem 0 1rem', fontSize: '1rem', fontWeight: 700, color: COLORS.gold }}>Key metrics</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              {pd.twitter_pct_positive != null && (
                <div style={{ padding: '1rem', background: `${COLORS.border}40`, borderRadius: 8 }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: COLORS.gold }}>{pd.twitter_pct_positive}%</div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Positive sentiment Twitter/X</div>
                </div>
              )}
              {pd.instagram_pct_positive != null && (
                <div style={{ padding: '1rem', background: `${COLORS.border}40`, borderRadius: 8 }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: COLORS.gold }}>{pd.instagram_pct_positive}%</div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Positive sentiment Instagram</div>
                </div>
              )}
              <div style={{ padding: '1rem', background: `${COLORS.border}40`, borderRadius: 8 }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: COLORS.gold }}>{formatFollowers(dashboard.twitter_followers)}</div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Twitter followers</div>
              </div>
              <div style={{ padding: '1rem', background: `${COLORS.border}40`, borderRadius: 8 }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: COLORS.gold }}>{formatFollowers(dashboard.instagram_followers)}</div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Instagram followers</div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Recent content grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem', marginTop: '2rem' }}>
        {dashboard.recent_tweets?.length > 0 && (
          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '2rem', boxShadow: '0 4px 16px rgba(0,0,0,0.3), 0 1px 3px rgba(201,169,97,0.1)' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Recent tweets</h3>
            {dashboard.recent_tweets.slice(0, 5).map((t) => (
              <div key={t.id} style={{ padding: '0.75rem 0', borderBottom: '1px solid ' + COLORS.border }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>♥ {t.likes ?? 0} · 🔁 {t.retweets ?? 0}</div>
                <div style={{ fontSize: '0.9rem', marginTop: '0.25rem' }}>{(t.text || '').substring(0, 120)}…</div>
              </div>
            ))}
          </div>
        )}
        {(dashboard.recent_instagram_posts?.length > 0 || pd.recent_instagram_posts?.length > 0) && (
          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '2rem', boxShadow: '0 4px 16px rgba(0,0,0,0.3), 0 1px 3px rgba(201,169,97,0.1)' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Recent Instagram posts</h3>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.75rem' }}>@{pd.instagram_handle || '—'}</div>
            {(dashboard.recent_instagram_posts || pd.recent_instagram_posts || []).slice(0, 5).map((p, i) => (
              <div key={p.id || i} style={{ padding: '0.75rem 0', borderBottom: '1px solid ' + COLORS.border }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>♥ {p.likes ?? 0} · 💬 {p.comments ?? 0}</div>
                <div style={{ fontSize: '0.9rem', marginTop: '0.25rem' }}>{(p.caption || 'Instagram post').substring(0, 120)}{(p.caption && p.caption.length > 120) ? '…' : ''}</div>
              </div>
            ))}
          </div>
        )}
        {dashboard.recent_news?.length > 0 && (
          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '2rem', boxShadow: '0 4px 16px rgba(0,0,0,0.3), 0 1px 3px rgba(201,169,97,0.1)' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Recent news</h3>
            {dashboard.recent_news.slice(0, 5).map((a, i) => (
              <div key={i} style={{ padding: '0.75rem 0', borderBottom: '1px solid ' + COLORS.border }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : ''}</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 500, marginTop: '0.25rem' }}>{a.title}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AUTO-HIDING DISCLAIMER FOOTER with toggle */}
      {disclaimerVisible && (
        <div style={{ 
          position: 'fixed', 
          bottom: 0, 
          left: 0, 
          right: 0, 
          background: 'rgba(26, 58, 92, 0.98)', 
          backdropFilter: 'blur(10px)',
          borderTop: `2px solid ${COLORS.gold}`, 
          padding: '1rem 2rem', 
          fontSize: '0.75rem', 
          color: '#94a3b8',
          lineHeight: 1.5,
          zIndex: 1000,
          boxShadow: '0 -4px 12px rgba(0,0,0,0.3)'
        }}>
          <button
            onClick={() => setDisclaimerVisible(false)}
            style={{
              position: 'absolute',
              top: '0.5rem',
              right: '1rem',
              background: 'transparent',
              border: 'none',
              color: COLORS.gold,
              cursor: 'pointer',
              fontSize: '1.2rem',
              padding: '0.25rem'
            }}
            title="Hide disclaimer"
          >
            <X size={20} />
          </button>
          <div style={{ maxWidth: '1400px', margin: '0 auto', paddingRight: '3rem' }}>
            <strong style={{ color: COLORS.gold }}>Legal Disclaimer:</strong> This dashboard presents data-driven intelligence based on publicly available information and automated analysis. Scores are indicative assessments and should not be considered definitive measures of reputation or character. Blue & Lintell Limited provides this information for strategic guidance purposes only and accepts no liability for decisions made based on this data. All data is subject to limitations in collection methods, API availability, and algorithmic interpretation. Users should conduct independent verification and exercise professional judgement when acting on insights provided.
          </div>
        </div>
      )}

      {/* Show disclaimer button when hidden */}
      {!disclaimerVisible && (
        <button
          onClick={() => setDisclaimerVisible(true)}
          style={{
            position: 'fixed',
            bottom: '1rem',
            right: '1.5rem',
            background: COLORS.navy,
            border: `2px solid ${COLORS.gold}`,
            color: COLORS.gold,
            padding: '0.5rem 1rem',
            borderRadius: 8,
            fontSize: '0.75rem',
            cursor: 'pointer',
            fontWeight: 600,
            zIndex: 1000,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
          }}
        >
          Show Legal Disclaimer
        </button>
      )}

      {/* Watermark */}
      <div style={{ position: 'fixed', bottom: disclaimerVisible ? '5rem' : '1rem', left: '1.5rem', opacity: 0.3, fontSize: '0.7rem', color: COLORS.gold, fontWeight: 600, letterSpacing: '1px' }}>
        Blue & Lintell Intelligence
      </div>
    </div>
  );
}
