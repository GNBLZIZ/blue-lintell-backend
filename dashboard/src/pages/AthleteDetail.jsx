import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend
} from 'recharts';
import { AlertTriangle, TrendingUp, TrendingDown, Shield, ChevronRight, Radio } from 'lucide-react';
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
  'Sentiment', 'Credibility', 'Likeability', 'Leadership', 'Authenticity', 'Controversy', 'Relevance'
];
const SCORE_FIELDS = [
  'sentiment_score', 'credibility_score', 'likeability_score', 'leadership_score',
  'authenticity_score', 'controversy_score', 'relevance_score'
];

export default function AthleteDetail() {
  const { athleteId } = useParams();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [rollingData, setRollingData] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyDays, setHistoryDays] = useState(30); // 30 days for temporal comparison
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedScore, setExpandedScore] = useState(null);

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
  
  // Build scores array with rolling average integration
  const scores = SCORE_KEYS.map((label, i) => {
    const field = SCORE_FIELDS[i];
    const currentValue = dashboard[field] ?? '—';
    
    // Get rolling average data if available
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

  const today = new Date().toISOString().split('T')[0];
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
  const snap14 = getSnapshotForDaysAgo(14);
  const snap30 = getSnapshotForDaysAgo(30);

  const scoreEvolution = SCORE_KEYS.map((metric, i) => {
    const field = SCORE_FIELDS[i];
    const current = dashboard[field] ?? 0;
    const day7 = snap7?.[field] ?? current;
    const day14 = snap14?.[field] ?? current;
    const day30 = snap30?.[field] ?? current;
    
    // Add rolling average to evolution
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
      day14,
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

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0a0e1a 0%, #151b2e 100%)', color: '#fff', padding: '1.5rem' }}>
      {/* Header */}
      <div style={{ background: COLORS.navy, borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem', border: `1px solid ${COLORS.gold}40` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <button className="btn secondary" style={{ marginRight: '0.5rem' }} onClick={() => navigate('/')}>← Back</button>
            <h1 style={{ display: 'inline-block', margin: 0, fontSize: '1.75rem', fontWeight: 700 }}>
              {dashboard.athlete_name?.toUpperCase() || 'Athlete'}
            </h1>
            <span style={{ marginLeft: '0.5rem', background: `${alertConfig.color}20`, border: `1px solid ${alertConfig.color}`, color: alertConfig.color, padding: '4px 10px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 700 }}>
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
                <span style={{ marginLeft: '1rem' }}>
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
          <button className="btn" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh data'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: `1px solid ${COLORS.border}` }}>
        {['overview', 'temporal', 'alerts', 'intelligence'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: activeTab === tab ? COLORS.cardBg : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab ? `2px solid ${COLORS.gold}` : '2px solid transparent',
              color: activeTab === tab ? COLORS.gold : '#94a3b8',
              padding: '0.75rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              cursor: 'pointer'
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            {scores.map((s) => {
              const details = pd[s.label];
              const isExpanded = expandedScore === s.label;
              const isDanger = s.label === 'Controversy' ? (s.value || 0) > thresholds.controversy.warning : (s.value || 0) < thresholds.sentiment.warning;
              
              // Determine change indicator color
              let changeColor = COLORS.neutral;
              if (s.changeFromYesterday !== null) {
                if (s.label === 'Controversy') {
                  // For controversy, down is good, up is bad
                  changeColor = s.trend === 'down' ? COLORS.success : s.trend === 'up' ? COLORS.danger : COLORS.neutral;
                } else {
                  // For other metrics, up is good, down is bad
                  changeColor = s.trend === 'up' ? COLORS.success : s.trend === 'down' ? COLORS.danger : COLORS.neutral;
                }
              }
              
              return (
                <div
                  key={s.label}
                  onClick={() => setExpandedScore(isExpanded ? null : s.label)}
                  style={{
                    background: COLORS.cardBg,
                    border: `1px solid ${isDanger ? COLORS.danger + '40' : COLORS.border}`,
                    borderRadius: 12,
                    padding: '1.25rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase' }}>{s.label}</div>
                  <div style={{ fontSize: '2rem', fontWeight: 700 }}>{s.value ?? '—'}</div>
                  
                  {/* Change indicator */}
                  {s.changeFromYesterday !== null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.25rem' }}>
                      <span style={{ color: changeColor, fontSize: '0.9rem', fontWeight: 600 }}>
                        {s.trend === 'up' ? '▲' : s.trend === 'down' ? '▼' : '●'} {s.changeFromYesterday > 0 ? '+' : ''}{s.changeFromYesterday}
                      </span>
                    </div>
                  )}
                  
                  {/* 7-day average label */}
                  {rollingData && (
                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.25rem' }}>7-day average</div>
                  )}
                  
                  {(details?.summary || isExpanded) && (
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.5rem', lineHeight: 1.4 }}>
                      {details?.summary || `Score: ${s.value ?? '—'}. Click for details.`}
                    </div>
                  )}
                  <div style={{ marginTop: '0.35rem', fontSize: '0.7rem', color: COLORS.gold }}>{isExpanded ? '▲ Collapse' : '▼ Expand rationale'}</div>
                  {isExpanded && (details?.breakdown?.length > 0 ? (
                    <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: `1px solid ${COLORS.border}`, fontSize: '0.75rem', color: '#cbd5e1' }}>
                      {details.breakdown.map((line, i) => (
                        <div key={i} style={{ marginBottom: '0.25rem' }}>{line}</div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#64748b' }}>No additional breakdown available.</div>
                  ))}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem', alignItems: 'start' }}>
            <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '1.5rem' }}>
              <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: COLORS.gold }}>Sentiment evolution</h3>
              {sentimentHistory.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={sentimentHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                    <XAxis dataKey="date" stroke="#64748b" tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
                    <YAxis stroke="#64748b" domain={[0, 100]} />
                    <Tooltip contentStyle={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}` }} />
                    <Area type="monotone" dataKey="sentiment" stroke={COLORS.gold} fill={COLORS.gold} fillOpacity={0.2} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p style={{ color: '#64748b' }}>No history yet. Run Refresh to record snapshots.</p>
              )}
            </div>
            <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '1.5rem' }}>
              <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: COLORS.gold }}>Platform performance</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ padding: '0.75rem', background: `${COLORS.border}20`, borderRadius: 8 }}>
                  <div style={{ fontWeight: 600 }}>Twitter · @{dashboard.twitter_handle?.replace('@', '') || '—'}</div>
                  <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{formatFollowers(dashboard.twitter_followers)} followers · {dashboard.avg_tweet_engagement ?? 0} avg engagement</div>
                </div>
                <div style={{ padding: '0.75rem', background: `${COLORS.border}20`, borderRadius: 8 }}>
                  <div style={{ fontWeight: 600 }}>Instagram · @{pd.instagram_handle || '—'}</div>
                  <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{formatFollowers(dashboard.instagram_followers)} followers · {pd.avg_instagram_engagement ?? 0} avg engagement</div>
                </div>
                <div style={{ padding: '0.75rem', background: `${COLORS.border}20`, borderRadius: 8 }}>
                  <div style={{ fontWeight: 600 }}>News</div>
                  <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{dashboard.news_articles_count ?? 0} mentions</div>
                </div>
              </div>
            </div>
          </div>

          {/* Aggregate engagement metrics */}
          <div style={{ marginTop: '1.5rem', background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem', color: COLORS.gold }}>Aggregate engagement</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              <div style={{ padding: '1rem', background: `${COLORS.border}20`, borderRadius: 8 }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Twitter avg engagement rate</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: COLORS.gold }}>{(dashboard.avg_engagement_rate_twitter ?? agg.avg_engagement_rate_twitter_pct) != null ? `${(dashboard.avg_engagement_rate_twitter ?? agg.avg_engagement_rate_twitter_pct)}%` : '—'}</div>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Avg likes: {dashboard.avg_likes_twitter ?? agg.avg_likes_per_post_twitter ?? '—'} · Replies/RTs: {dashboard.avg_comments_retweets_twitter ?? (agg.avg_comments_replies_twitter != null || agg.avg_retweets != null ? (Number(agg.avg_comments_replies_twitter) || 0) + (Number(agg.avg_retweets) || 0) : '—')}</div>
              </div>
              <div style={{ padding: '1rem', background: `${COLORS.border}20`, borderRadius: 8 }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Instagram avg engagement rate</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: COLORS.gold }}>{(dashboard.avg_engagement_rate_instagram ?? agg.avg_engagement_rate_instagram_pct) != null ? `${(dashboard.avg_engagement_rate_instagram ?? agg.avg_engagement_rate_instagram_pct)}%` : '—'}</div>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Avg likes: {dashboard.avg_likes_instagram ?? agg.avg_likes_per_post_instagram ?? '—'} · Avg comments: {dashboard.avg_comments_instagram ?? agg.avg_comments_per_post_instagram ?? '—'}</div>
              </div>
              <div style={{ padding: '1rem', background: `${COLORS.border}20`, borderRadius: 8 }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Combined visibility</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: COLORS.gold }}>{dashboard.total_mentions ?? 0}</div>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Twitter @mentions + news articles (total_mentions)</div>
              </div>
            </div>
          </div>

          {(dashboard.timeline_events?.length > 0) && (
            <div style={{ marginTop: '1.5rem', background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '1.5rem' }}>
              <h3 style={{ margin: '0 0 1rem', color: COLORS.gold }}>Timeline</h3>
              {dashboard.timeline_events.slice(0, 10).map((ev, i) => (
                <div key={i} style={{ padding: '0.5rem 0', borderBottom: i < 9 ? `1px solid ${COLORS.border}` : 'none' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{ev.date} · {ev.platforms}</div>
                  <div style={{ fontWeight: 500 }}>{ev.title}</div>
                  {ev.description && <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{ev.description}</div>}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* TEMPORAL TAB */}
      {activeTab === 'temporal' && (
        <>
          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem', overflowX: 'auto' }}>
            <h3 style={{ margin: '0 0 1rem', color: COLORS.gold }}>Score evolution</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <th style={{ textAlign: 'left', padding: '0.75rem', fontSize: '0.75rem', color: '#64748b' }}>Metric</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem', fontSize: '0.75rem', color: '#64748b' }}>Current</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem', fontSize: '0.75rem', color: '#64748b' }}>7d avg</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem', fontSize: '0.75rem', color: '#64748b' }}>7d ago</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem', fontSize: '0.75rem', color: '#64748b' }}>14d ago</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem', fontSize: '0.75rem', color: '#64748b' }}>30d ago</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem', fontSize: '0.75rem', color: '#64748b' }}>Change</th>
                </tr>
              </thead>
              <tbody>
                {scoreEvolution.map((row) => (
                  <tr key={row.metric} style={{ borderBottom: `1px solid ${COLORS.border}20` }}>
                    <td style={{ padding: '0.75rem', fontWeight: 600 }}>{row.metric}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 700 }}>{row.current}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', color: COLORS.gold, fontWeight: 600 }}>{row.rolling7d}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', color: '#94a3b8' }}>{row.day7}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', color: '#94a3b8' }}>{row.day14}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', color: '#94a3b8' }}>{row.day30}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', color: row.trend === 'up' ? COLORS.success : row.trend === 'down' ? COLORS.danger : COLORS.neutral, fontWeight: 600 }}>{row.change}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {radarData.length > 0 && (
            <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '1.5rem' }}>
              <h3 style={{ margin: '0 0 1rem', color: COLORS.gold }}>Reputation: current vs 7-day average vs 30d ago</h3>
              <ResponsiveContainer width="100%" height={350}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke={COLORS.border} />
                  <PolarAngleAxis dataKey="metric" stroke="#94a3b8" />
                  <PolarRadiusAxis stroke="#64748b" />
                  <Radar name="Current" dataKey="current" stroke={COLORS.gold} fill={COLORS.gold} fillOpacity={0.3} strokeWidth={2} />
                  <Radar name="7-day avg" dataKey="rolling7d" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} strokeDasharray="3 3" />
                  <Radar name="30d ago" dataKey="day30" stroke="#64748b" fill="#64748b" fillOpacity={0.1} strokeDasharray="5 5" />
                  <Legend />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      {/* ALERTS TAB */}
      {activeTab === 'alerts' && (
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', padding: '1rem', background: `${alertConfig.color}15`, border: `1px solid ${alertConfig.color}40`, borderRadius: 8 }}>
            <AlertIcon size={28} color={alertConfig.color} />
            <div>
              <div style={{ fontWeight: 700, color: alertConfig.color, letterSpacing: '0.5px' }}>THREAT LEVEL: {alertConfig.label}</div>
              <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Last updated: {dashboard.updated_at ? new Date(dashboard.updated_at).toLocaleString() : '—'}</div>
            </div>
          </div>
          <h3 style={{ margin: '0 0 1rem', color: COLORS.gold }}>Active alerts</h3>
          {alerts.map((alert, i) => (
            <div
              key={i}
              style={{
                padding: '1rem',
                marginBottom: '0.75rem',
                background: `${(alert.severity === 'critical' ? COLORS.danger : alert.severity === 'elevated' ? COLORS.warning : COLORS.success)}15`,
                border: `1px solid ${(alert.severity === 'critical' ? COLORS.danger : alert.severity === 'elevated' ? COLORS.warning : COLORS.success)}40`,
                borderRadius: 8,
                borderLeft: `4px solid ${alert.severity === 'critical' ? COLORS.danger : alert.severity === 'elevated' ? COLORS.warning : COLORS.success}`
              }}
            >
              <div style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem', color: alert.severity === 'critical' ? COLORS.danger : alert.severity === 'elevated' ? COLORS.warning : COLORS.success }}>{alert.severity}</div>
              <div style={{ marginTop: '0.25rem' }}>{alert.message}</div>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.5rem' }}>Threshold: {alert.threshold} · Current: {alert.current}</div>
            </div>
          ))}
          <h3 style={{ margin: '1.5rem 0 0.75rem', color: COLORS.gold }}>Alert threshold configuration</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', fontSize: '0.9rem' }}>
            <div style={{ padding: '0.75rem', background: `${COLORS.border}40`, borderRadius: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Sentiment</div>
              <div style={{ color: COLORS.danger }}>Critical &lt;50</div>
              <div style={{ color: COLORS.warning }}>Warning &lt;60</div>
              <div style={{ color: COLORS.success }}>Optimal &gt;70</div>
            </div>
            <div style={{ padding: '0.75rem', background: `${COLORS.border}40`, borderRadius: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Controversy</div>
              <div style={{ color: COLORS.danger }}>Critical &gt;40</div>
              <div style={{ color: COLORS.warning }}>Warning &gt;30</div>
              <div style={{ color: COLORS.success }}>Optimal &lt;20</div>
            </div>
          </div>
        </div>
      )}

      {/* INTELLIGENCE TAB */}
      {activeTab === 'intelligence' && (
        <>
          {/* Strategic Intelligence Section */}
          {pd.strategic_intelligence && (
            <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem' }}>
              <h3 style={{ margin: '0 0 1rem', color: COLORS.gold, fontSize: '1.25rem' }}>Strategic Intelligence</h3>
              
              {/* Strategic Overview */}
              {pd.strategic_intelligence.strategic_overview && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 style={{ margin: '0 0 0.75rem', color: '#e2e8f0', fontSize: '1rem', fontWeight: 600 }}>Strategic Overview</h4>
                  <p style={{ lineHeight: 1.7, color: '#cbd5e1', margin: 0 }}>
                    {pd.strategic_intelligence.strategic_overview}
                  </p>
                </div>
              )}

              {/* Key Risks */}
              {pd.strategic_intelligence.key_risks?.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 style={{ margin: '0 0 0.75rem', color: '#e2e8f0', fontSize: '1rem', fontWeight: 600 }}>Key Risks</h4>
                  <div style={{ background: `${COLORS.danger}10`, border: `1px solid ${COLORS.danger}40`, borderRadius: 8, padding: '1rem' }}>
                    {pd.strategic_intelligence.key_risks.map((risk, i) => (
                      <div key={i} style={{ color: '#fca5a5', marginBottom: i < pd.strategic_intelligence.key_risks.length - 1 ? '0.5rem' : 0, lineHeight: 1.6 }}>
                        {risk}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Immediate Recommendations */}
              {pd.strategic_intelligence.immediate_recommendations?.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 style={{ margin: '0 0 0.75rem', color: '#e2e8f0', fontSize: '1rem', fontWeight: 600 }}>Immediate Recommendations</h4>
                  <div style={{ background: `${COLORS.success}10`, border: `1px solid ${COLORS.success}40`, borderRadius: 8, padding: '1rem' }}>
                    {pd.strategic_intelligence.immediate_recommendations.map((rec, i) => (
                      <div key={i} style={{ color: '#86efac', marginBottom: i < pd.strategic_intelligence.immediate_recommendations.length - 1 ? '0.5rem' : 0, lineHeight: 1.6 }}>
                        {rec}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Watch-Outs */}
              {pd.strategic_intelligence.watch_outs?.length > 0 && (
                <div>
                  <h4 style={{ margin: '0 0 0.75rem', color: '#e2e8f0', fontSize: '1rem', fontWeight: 600 }}>Watch-Outs</h4>
                  <div style={{ background: `${COLORS.warning}10`, border: `1px solid ${COLORS.warning}40`, borderRadius: 8, padding: '1rem' }}>
                    {pd.strategic_intelligence.watch_outs.map((watch, i) => (
                      <div key={i} style={{ color: '#fcd34d', marginBottom: i < pd.strategic_intelligence.watch_outs.length - 1 ? '0.5rem' : 0, lineHeight: 1.6 }}>
                        {watch}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Existing Intelligence Summary */}
          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem', color: COLORS.gold }}>Overall perception summary</h3>
            <p style={{ lineHeight: 1.7, color: '#e2e8f0' }}>
              {(pd.Sentiment?.summary && pd.Sentiment.summary.trim()) ? pd.Sentiment.summary : `${dashboard.athlete_name} maintains a reputation driven by sentiment (${dashboard.sentiment_score ?? '—'}), credibility (${dashboard.credibility_score ?? '—'}), and relevance (${dashboard.relevance_score ?? '—'}). Twitter and Instagram follower counts and news mentions feed into these scores. Click each score card in the Overview tab for detailed breakdowns.`}
            </p>
            <h4 style={{ margin: '1.5rem 0 0.75rem', color: COLORS.gold, fontSize: '1rem' }}>Key metrics</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              {pd.twitter_pct_positive != null && (
                <div style={{ padding: '1rem', background: `${COLORS.border}40`, borderRadius: 8 }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: COLORS.gold }}>{pd.twitter_pct_positive}%</div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Positive sentiment Twitter/X</div>
                </div>
              )}
              {pd.instagram_pct_positive != null && (
                <div style={{ padding: '1rem', background: `${COLORS.border}40`, borderRadius: 8 }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: COLORS.gold }}>{pd.instagram_pct_positive}%</div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Positive sentiment Instagram</div>
                </div>
              )}
              <div style={{ padding: '1rem', background: `${COLORS.border}40`, borderRadius: 8 }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: COLORS.gold }}>{formatFollowers(dashboard.twitter_followers)}</div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Twitter followers</div>
              </div>
              <div style={{ padding: '1rem', background: `${COLORS.border}40`, borderRadius: 8 }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: COLORS.gold }}>{formatFollowers(dashboard.instagram_followers)}</div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Instagram followers</div>
              </div>
            </div>
            <h4 style={{ margin: '0 0 0.75rem', color: COLORS.gold, fontSize: '1rem' }}>Score summary</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
              {scores.slice(0, 4).map((s) => (
                <div key={s.label} style={{ textAlign: 'center', padding: '1rem', background: `${COLORS.border}20`, borderRadius: 8 }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: COLORS.gold }}>{s.value ?? '—'}</div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase' }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Follower summary in header-style card */}
      <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: `${COLORS.border}30`, borderRadius: 8, fontSize: '0.9rem' }}>
        <strong>Followers:</strong> Twitter: {formatFollowers(dashboard.twitter_followers)} · Instagram: {formatFollowers(dashboard.instagram_followers)}
        {pd.instagram_handle && <span> · Handle: @{pd.instagram_handle}</span>}
      </div>

      {/* Recent tweets, Instagram posts & news */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
        {dashboard.recent_tweets?.length > 0 && (
          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '1.5rem' }}>
            <h3 style={{ margin: '0 0 0.75rem', color: COLORS.gold }}>Recent tweets</h3>
            {dashboard.recent_tweets.slice(0, 5).map((t) => (
              <div key={t.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid ' + COLORS.border }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>♥ {t.likes ?? 0} · 🔁 {t.retweets ?? 0}</div>
                <div style={{ fontSize: '0.9rem' }}>{(t.text || '').substring(0, 120)}…</div>
              </div>
            ))}
          </div>
        )}
        {(dashboard.recent_instagram_posts?.length > 0 || pd.recent_instagram_posts?.length > 0) && (
          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '1.5rem' }}>
            <h3 style={{ margin: '0 0 0.75rem', color: COLORS.gold }}>Recent Instagram posts</h3>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.5rem' }}>@{pd.instagram_handle || '—'}</div>
            {(dashboard.recent_instagram_posts || pd.recent_instagram_posts || []).slice(0, 5).map((p, i) => (
              <div key={p.id || i} style={{ padding: '0.5rem 0', borderBottom: '1px solid ' + COLORS.border }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>♥ {p.likes ?? 0} · 💬 {p.comments ?? 0}</div>
                <div style={{ fontSize: '0.9rem' }}>{(p.caption || 'Instagram post').substring(0, 120)}{(p.caption && p.caption.length > 120) ? '…' : ''}</div>
              </div>
            ))}
          </div>
        )}
        {dashboard.recent_news?.length > 0 && (
          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '1.5rem' }}>
            <h3 style={{ margin: '0 0 0.75rem', color: COLORS.gold }}>Recent news</h3>
            {dashboard.recent_news.slice(0, 5).map((a, i) => (
              <div key={i} style={{ padding: '0.5rem 0', borderBottom: '1px solid ' + COLORS.border }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : ''}</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>{a.title}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
