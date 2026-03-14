import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend
} from 'recharts';
import { AlertTriangle, Shield, Target, AlertCircle, CheckCircle, Eye, X } from 'lucide-react';
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

const SPONSOR_READINESS_CONFIG = {
  GREEN:  { color: '#10b981', bg: '#10b98118', border: '#10b98140', label: 'COMMERCIALLY STRONG' },
  AMBER:  { color: '#f59e0b', bg: '#f59e0b18', border: '#f59e0b40', label: 'REVIEW ADVISED' },
  RED:    { color: '#dc2626', bg: '#dc262618', border: '#dc262640', label: 'COMMERCIAL RISK' },
};

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
  const [cardsVisible, setCardsVisible] = useState(false);
  const [incidents, setIncidents] = useState([]);

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

  const loadIncidents = () => {
    if (!athleteId) return;
    api.controversies(athleteId).then(data => setIncidents(data.incidents || [])).catch(() => setIncidents([]));
  };

  useEffect(() => {
    setLoading(true);
    loadDashboard();
    loadRollingAverage();
    loadHistory();
    loadIncidents();
    setLoading(false);
  }, [athleteId]);

  useEffect(() => {
    if (!athleteId) return;
    loadHistory();
  }, [athleteId, historyDays]);

  useEffect(() => {
    const timer = setTimeout(() => setDisclaimerVisible(false), 8000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (dashboard) setTimeout(() => setCardsVisible(true), 100);
  }, [dashboard]);

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
          loadIncidents();
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

  const formatFollowers = (n) => {
    if (n == null || n === 0) return null;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return String(n);
  };

  const compositeScore = dashboard.composite_score ?? (() => {
    const fields = ['sentiment_score','credibility_score','likeability_score','leadership_score','authenticity_score','relevance_score'];
    const vals = fields.map(f => dashboard[f]).filter(v => v != null);
    if (!vals.length) return null;
    const avg = Math.round(vals.reduce((a,b) => a+b, 0) / vals.length);
    const controversy = dashboard.controversy_score ?? 0;
    return Math.max(0, Math.min(100, avg - Math.round(controversy * 0.3)));
  })();

  const sponsorReadiness = (() => {
    if (dashboard.sponsor_readiness?.status) return dashboard.sponsor_readiness.status;
    if (typeof dashboard.sponsor_readiness === 'string') return dashboard.sponsor_readiness;
    const controversy = dashboard.controversy_score ?? 0;
    const sentiment = dashboard.sentiment_score ?? 70;
    if (controversy > 40 || sentiment < 50) return 'RED';
    if (controversy > 25 || sentiment < 60) return 'AMBER';
    return 'GREEN';
  })();

  const srConfig = SPONSOR_READINESS_CONFIG[sponsorReadiness] || SPONSOR_READINESS_CONFIG.GREEN;

  const scores = SCORE_KEYS.map((label, i) => {
    const field = SCORE_FIELDS[i];
    let currentValue = dashboard[field] ?? '—';
    let rollingAvg = currentValue;
    let changeFromYesterday = null;
    let trend = 'stable';
    const scoreKey = field.replace('_score', '');
    if (rollingData?.scores?.[scoreKey]) {
      rollingAvg = rollingData.scores[scoreKey].rolling_avg ?? currentValue;
      changeFromYesterday = rollingData.scores[scoreKey].change_from_yesterday ?? null;
      trend = rollingData.scores[scoreKey].trend ?? 'stable';
    }
    const details = pd[label];
    return { label, value: rollingAvg, currentValue, changeFromYesterday, trend, key: field, details };
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
    const scoreKey = field.replace('_score', '');
    let current = dashboard[field] ?? 0;
    const day7 = snap7?.[field] ?? current;
    const day30 = snap30?.[field] ?? current;
    let rolling7d = current;
    if (rollingData?.scores?.[scoreKey]) rolling7d = rollingData.scores[scoreKey].rolling_avg ?? current;
    const change = current - (day30 || current);
    const trend = change > 0 ? 'up' : change < 0 ? 'down' : 'stable';
    return { metric, current, rolling7d, day7, day30, trend, change: trend !== 'stable' ? (change > 0 ? `+${change}` : `${change}`) : '0' };
  });

  const radarData = scoreEvolution.map((s) => ({ metric: s.metric, current: s.current, rolling7d: s.rolling7d, day30: s.day30 }));

  const alerts = [];
  if ((dashboard.sentiment_score ?? 70) < thresholds.sentiment.warning) {
    alerts.push({ severity: (dashboard.sentiment_score ?? 0) < thresholds.sentiment.critical ? 'critical' : 'elevated', type: 'sentiment_drop', message: `Sentiment at ${dashboard.sentiment_score} — ${(dashboard.sentiment_score ?? 0) < 50 ? 'Critical' : 'Warning'} threshold`, threshold: (dashboard.sentiment_score ?? 0) < 50 ? '<50' : '<60', current: dashboard.sentiment_score });
  }
  if ((dashboard.controversy_score ?? 0) > thresholds.controversy.warning) {
    alerts.push({ severity: (dashboard.controversy_score ?? 0) > thresholds.controversy.critical ? 'critical' : 'elevated', type: 'controversy', message: `Controversy score ${dashboard.controversy_score} — above warning threshold`, threshold: '>30', current: dashboard.controversy_score });
  }
  if (alerts.length === 0) {
    alerts.push({ severity: 'nominal', type: 'ok', message: 'All metrics within normal range.', threshold: '—', current: '—' });
  }

  const statusConfig = {
    nominal:  { color: COLORS.success, label: 'HEALTHY',  Icon: Shield },
    elevated: { color: COLORS.warning, label: 'WARNING',  Icon: AlertTriangle },
    critical: { color: COLORS.danger,  label: 'CRITICAL', Icon: AlertTriangle }
  };
  const alertConfig = statusConfig[alertLevel] || statusConfig.nominal;
  const AlertIcon = alertConfig.Icon;
  const sentimentVal = dashboard.sentiment_score ?? 70;
  const controversyVal = dashboard.controversy_score ?? 0;
  const sentimentSparkData = (history || []).slice(-14).map(h => ({ value: h.sentiment_score ?? 0 })).filter(d => d.value > 0);
  const controversySparkData = (history || []).slice(-14).map(h => ({ value: h.controversy_score ?? 0 })).filter(d => d.value >= 0);

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

  const ThresholdBar = ({ label, value, isInverse, zones }) => {
    const pct = Math.min(100, Math.max(0, value));
    const barColor = isInverse
      ? (value >= zones.critical ? COLORS.danger : value >= zones.warning ? COLORS.warning : COLORS.success)
      : (value <= zones.critical ? COLORS.danger : value <= zones.warning ? COLORS.warning : COLORS.success);
    return (
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{label}</span>
          <span style={{ fontWeight: 800, fontSize: '1.4rem', color: barColor }}>{value}</span>
        </div>
        <div style={{ position: 'relative', height: 12, borderRadius: 6, background: '#1e293b', overflow: 'hidden' }}>
          {isInverse ? (
            <>
              <div style={{ position: 'absolute', left: '0%', width: '20%', height: '100%', background: `${COLORS.success}30` }} />
              <div style={{ position: 'absolute', left: '20%', width: '10%', height: '100%', background: `${COLORS.warning}30` }} />
              <div style={{ position: 'absolute', left: '30%', width: '10%', height: '100%', background: `${COLORS.danger}30` }} />
              <div style={{ position: 'absolute', left: '40%', width: '60%', height: '100%', background: `${COLORS.danger}20` }} />
            </>
          ) : (
            <>
              <div style={{ position: 'absolute', left: '0%', width: '50%', height: '100%', background: `${COLORS.danger}20` }} />
              <div style={{ position: 'absolute', left: '50%', width: '10%', height: '100%', background: `${COLORS.danger}30` }} />
              <div style={{ position: 'absolute', left: '60%', width: '10%', height: '100%', background: `${COLORS.warning}30` }} />
              <div style={{ position: 'absolute', left: '70%', width: '30%', height: '100%', background: `${COLORS.success}30` }} />
            </>
          )}
          <div style={{ position: 'absolute', left: `${pct}%`, top: 0, bottom: 0, width: 3, background: barColor, borderRadius: 2, transform: 'translateX(-50%)', boxShadow: `0 0 6px ${barColor}` }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#475569', marginTop: '0.3rem' }}>
          {isInverse ? <><span>0 — Safe</span><span>20 — Watch</span><span>30 — Warning</span><span>40+ — Critical</span></> : <><span>0</span><span>50 — Critical</span><span>60 — Warning</span><span>70+ — Healthy</span></>}
        </div>
      </div>
    );
  };

  const Sparkline = ({ data, color, inverse }) => {
    if (!data || data.length < 2) return <span style={{ fontSize: '0.75rem', color: '#475569' }}>Building…</span>;
    const vals = data.map(d => d.value);
    const min = Math.min(...vals); const max = Math.max(...vals);
    const range = max - min || 1;
    const w = 120; const h = 32;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
    const trend = vals[vals.length - 1] - vals[0];
    const trendColor = inverse ? (trend > 0 ? COLORS.danger : COLORS.success) : (trend > 0 ? COLORS.success : COLORS.danger);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <svg width={w} height={h} style={{ overflow: 'visible' }}>
          <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        </svg>
        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: trendColor }}>
          {trend > 0 ? '↗' : trend < 0 ? '↘' : '→'} {Math.abs(Math.round(trend))}
        </span>
      </div>
    );
  };

  const twitterFollowersFormatted = formatFollowers(dashboard.twitter_followers);
  const instagramHandle = pd.instagram_handle || null;
  const instagramFollowersFormatted = formatFollowers(dashboard.instagram_followers);
  const showInstagram = instagramHandle || instagramFollowersFormatted;

  return (
    <div className="page-wrap" style={{ color: '#fff' }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideInStagger { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
        @keyframes shimmer { 0% { background-position: -1000px 0; } 100% { background-position: 1000px 0; } }
        @keyframes borderGlow { 0%, 100% { box-shadow: 0 0 5px rgba(201,169,97,0.3); } 50% { box-shadow: 0 0 20px rgba(201,169,97,0.6); } }
        @keyframes compositeEntrance { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .fade-in { animation: fadeIn 0.6s ease-out; }
        .score-card { animation: slideInStagger 0.5s ease-out backwards; }
        .score-card:nth-child(1) { animation-delay: 0.05s; }
        .score-card:nth-child(2) { animation-delay: 0.1s; }
        .score-card:nth-child(3) { animation-delay: 0.15s; }
        .score-card:nth-child(4) { animation-delay: 0.2s; }
        .score-card:nth-child(5) { animation-delay: 0.25s; }
        .score-card:nth-child(6) { animation-delay: 0.3s; }
        .score-card:nth-child(7) { animation-delay: 0.35s; }
        .score-card:nth-child(8) { animation-delay: 0.4s; }
        .change-indicator { animation: pulse 2s ease-in-out infinite; }
        .gold-shimmer { background: linear-gradient(90deg, transparent, rgba(201,169,97,0.3), transparent); background-size: 1000px 100%; animation: shimmer 3s infinite; }
        .critical-glow { animation: borderGlow 2s ease-in-out infinite; }
        .composite-hero { animation: compositeEntrance 0.8s cubic-bezier(0.34,1.56,0.64,1) 0.3s backwards; }
        .progress-ring { transform: rotate(-90deg); }
        .sr-badge { transition: all 0.3s ease; }
        .sr-badge:hover { transform: translateY(-1px); filter: brightness(1.15); }
        .refresh-spinner { animation: spin 1s linear infinite; }

        .score-grid { display: grid; gap: 1rem; margin-bottom: 2rem; grid-template-columns: repeat(2, 1fr); }
        @media (min-width: 768px) { .score-grid { grid-template-columns: repeat(3, 1fr); gap: 1.25rem; } }
        @media (min-width: 1100px) { .score-grid { grid-template-columns: repeat(4, 1fr); gap: 1.5rem; } }
        @media (max-width: 639px) { .score-card { padding: 1.25rem !important; } }

        .header-right { display: flex; align-items: center; gap: 1.25rem; flex-shrink: 0; }
        @media (max-width: 700px) {
          .header-inner { flex-direction: column !important; align-items: stretch !important; }
          .header-right { flex-direction: row; justify-content: flex-start; flex-wrap: wrap; margin-top: 0.75rem; }
          .refresh-btn { width: 100% !important; margin-top: 0.5rem; }
        }

        .charts-row { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-bottom: 2rem; }
        @media (max-width: 700px) { .charts-row { grid-template-columns: 1fr; gap: 1rem; } }

        .platform-row { display: grid; grid-template-columns: 1fr 2fr; gap: 2rem; margin-bottom: 2rem; }
        @media (max-width: 700px) { .platform-row { grid-template-columns: 1fr; gap: 1rem; } }

        .engagement-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
        @media (max-width: 500px) { .engagement-grid { grid-template-columns: repeat(2, 1fr); } }

        .temporal-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .temporal-table { min-width: 560px; width: 100%; border-collapse: collapse; }

        .tabs-row { display: flex; gap: 0.25rem; margin-bottom: 1.5rem; border-bottom: 2px solid #1e293b; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
        .tabs-row::-webkit-scrollbar { display: none; }
        .tab-btn { white-space: nowrap; flex-shrink: 0; }

        .page-wrap { padding: 1rem; padding-bottom: 4rem; }
        @media (min-width: 640px) { .page-wrap { padding: 1.5rem; padding-bottom: 2rem; } }
      `}</style>

      {/* ── HEADER ── */}
      <div className="fade-in" style={{ background: COLORS.navy, borderRadius: 12, padding: '1.5rem 2rem', marginBottom: '1.5rem', border: `2px solid ${COLORS.gold}40`, boxShadow: '0 8px 24px rgba(0,0,0,0.4), 0 3px 10px rgba(201,169,97,0.2)' }}>
        <div className="header-inner" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <button className="btn secondary" style={{ flexShrink: 0, fontSize: '0.8rem', padding: '0.4rem 0.9rem' }} onClick={() => navigate('/')}>← Back</button>
              <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                {dashboard.athlete_name?.toUpperCase() || 'Athlete'}
              </h1>
              <span style={{ background: `${alertConfig.color}20`, border: `2px solid ${alertConfig.color}`, color: alertConfig.color, padding: '4px 10px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 700, flexShrink: 0 }}>
                {alertConfig.label}
              </span>
            </div>

            <div style={{ fontSize: '0.875rem', color: '#94a3b8', display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.4rem' }}>
              {dashboard.twitter_handle && (
                <span>
                  𝕏 {dashboard.twitter_handle}
                  {twitterFollowersFormatted && <span style={{ color: '#cbd5e1', marginLeft: '0.3rem' }}>· {twitterFollowersFormatted}</span>}
                </span>
              )}
              {showInstagram && (
                <span>
                  IG {instagramHandle ? `@${instagramHandle}` : ''}
                  {instagramFollowersFormatted && <span style={{ color: '#cbd5e1', marginLeft: '0.3rem' }}>· {instagramFollowersFormatted}</span>}
                </span>
              )}
            </div>

            <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
              Last updated: {dashboard.updated_at ? new Date(dashboard.updated_at).toLocaleString() : '—'}
              {rollingData?.period_start && rollingData?.period_end && (
                <span style={{ marginLeft: '1rem', color: COLORS.gold }}>
                  7-day rolling average ({new Date(rollingData.period_start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – {new Date(rollingData.period_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })})
                </span>
              )}
            </p>
          </div>

          <div className="header-right">
            {compositeScore != null && (
              <div className="composite-hero" style={{ textAlign: 'center', background: `${COLORS.gold}12`, border: `2px solid ${COLORS.gold}60`, borderRadius: 12, padding: '0.75rem 1.25rem', minWidth: 90 }}>
                <div style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: '0.2rem' }}>Overall Score</div>
                <div style={{ fontSize: '2.6rem', fontWeight: 900, lineHeight: 1, color: compositeScore >= 70 ? COLORS.gold : compositeScore >= 55 ? COLORS.warning : COLORS.danger, textShadow: `0 0 24px ${COLORS.gold}30` }}>
                  {compositeScore}
                </div>
                <div style={{ fontSize: '0.6rem', color: '#64748b', marginTop: '0.2rem' }}>/100</div>
              </div>
            )}

            <div className="sr-badge" style={{ textAlign: 'center', background: srConfig.bg, border: `2px solid ${srConfig.border}`, borderRadius: 12, padding: '0.75rem 1.25rem', minWidth: 120 }}>
              <div style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: '0.35rem' }}>Commercial Status</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                <div style={{ width: 14, height: 14, borderRadius: '50%', background: srConfig.color, boxShadow: `0 0 8px ${srConfig.color}80`, flexShrink: 0 }} />
                <span style={{ color: srConfig.color, fontWeight: 800, fontSize: '0.85rem', letterSpacing: '0.04em' }}>{srConfig.label}</span>
              </div>
            </div>

            <button
              className="btn refresh-btn"
              onClick={handleRefresh}
              disabled={refreshing}
              style={{
                background: refreshing ? `${COLORS.gold}80` : COLORS.gold,
                color: COLORS.navy,
                fontWeight: 700,
                boxShadow: '0 4px 12px rgba(201,169,97,0.3)',
                alignSelf: 'flex-start',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.85rem',
                padding: '0.6rem 1.1rem',
                borderRadius: 8,
                border: 'none',
                cursor: refreshing ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              {refreshing ? (
                <>
                  <svg className="refresh-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={COLORS.navy} strokeWidth="3" strokeLinecap="round">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Refreshing…
                </>
              ) : (
                '↻ Refresh data'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs-row">
        {[
          { key: 'overview', label: 'Overview' },
          { key: 'temporal', label: 'Score History' },
          { key: 'alerts', label: 'Alerts' },
          { key: 'intelligence', label: 'Intelligence' },
        ].map(({ key, label }) => (
          <button key={key} className="tab-btn" onClick={() => setActiveTab(key)} style={{ background: activeTab === key ? COLORS.cardBg : 'transparent', border: 'none', borderBottom: activeTab === key ? `3px solid ${COLORS.gold}` : '3px solid transparent', color: activeTab === key ? COLORS.gold : '#94a3b8', padding: '0.75rem 1.25rem', fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase', cursor: 'pointer', letterSpacing: '0.5px', transition: 'all 0.3s ease' }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === 'overview' && (
        <>
          <div className="score-grid">
            {scores.map((s) => {
              const isExpanded = expandedScore === s.label;
              let changeColor = COLORS.neutral;
              if (s.changeFromYesterday !== null) {
                if (s.label === 'Controversy') { changeColor = s.trend === 'down' ? COLORS.success : s.trend === 'up' ? COLORS.danger : COLORS.neutral; }
                else { changeColor = s.trend === 'up' ? COLORS.success : s.trend === 'down' ? COLORS.danger : COLORS.neutral; }
              }
              let borderColor = COLORS.border;
              let hasShimmer = false;
              if (s.label === 'Controversy') {
                if (s.value < 20) { borderColor = COLORS.success; hasShimmer = true; }
                else if (s.value > 30) borderColor = COLORS.danger;
              } else {
                if (s.value >= 80) { borderColor = COLORS.gold; hasShimmer = true; }
                else if (s.value < 60) borderColor = COLORS.danger + '60';
              }
              const circumference = 2 * Math.PI * 45;
              const offset = circumference - (s.value / 100) * circumference;

              return (
                <div key={s.label} className={`score-card ${hasShimmer ? 'gold-shimmer' : ''}`}
                  onClick={() => setExpandedScore(isExpanded ? null : s.label)}
                  style={{ background: `linear-gradient(135deg, ${COLORS.cardBg} 0%, rgba(26,58,92,0.3) 100%)`, border: `2px solid ${borderColor}`, borderRadius: 12, padding: '2.5rem', cursor: 'pointer', transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)', boxShadow: '0 8px 24px rgba(0,0,0,0.4), 0 3px 10px rgba(201,169,97,0.15)', transform: isExpanded ? 'translateY(-4px) scale(1.02)' : 'none', position: 'relative', overflow: 'hidden' }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-6px) scale(1.02)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.5), 0 5px 16px rgba(201,169,97,0.25)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = isExpanded ? 'translateY(-4px) scale(1.02)' : 'none'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4), 0 3px 10px rgba(201,169,97,0.15)'; }}
                >
                  <svg style={{ position: 'absolute', top: '1rem', right: '1rem', opacity: 0.15 }} width="100" height="100">
                    <circle className="progress-ring" stroke={s.label === 'Controversy' ? (s.value < 20 ? COLORS.success : COLORS.danger) : (s.value >= 80 ? COLORS.gold : '#94a3b8')} strokeWidth="3" fill="transparent" r="45" cx="50" cy="50" style={{ strokeDasharray: `${circumference} ${circumference}`, strokeDashoffset: offset }} />
                  </svg>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.label}</div>
                  <div style={{ fontSize: '3.5rem', fontWeight: 800, lineHeight: 1, marginBottom: '0.5rem', color: s.label === 'Controversy' ? (s.value > 40 ? COLORS.danger : s.value > 30 ? COLORS.warning : COLORS.gold) : (s.value >= 80 ? COLORS.gold : s.value < 60 ? COLORS.danger : '#fff'), textShadow: hasShimmer ? `0 0 20px ${COLORS.gold}40` : 'none' }}>
                    {s.value ?? '—'}
                  </div>
                  {s.changeFromYesterday !== null && (
                    <div className="change-indicator" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', padding: '0.75rem', background: `${changeColor}20`, borderRadius: 8, border: `2px solid ${changeColor}40` }}>
                      <span style={{ color: changeColor, fontSize: '1.4rem', fontWeight: 900 }}>{s.trend === 'up' ? '▲' : s.trend === 'down' ? '▼' : '●'}</span>
                      <span style={{ color: changeColor, fontSize: '1.3rem', fontWeight: 800 }}>{s.changeFromYesterday > 0 ? '+' : ''}{s.changeFromYesterday}</span>
                      <span style={{ color: changeColor, fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 700, marginLeft: '0.25rem' }}>vs yesterday</span>
                    </div>
                  )}
                  {rollingData && (
                    <div style={{ fontSize: '0.8rem', color: COLORS.gold, marginBottom: '0.75rem', fontWeight: 700, letterSpacing: '0.5px' }}>7-DAY ROLLING AVERAGE</div>
                  )}
                  {(s.details?.summary || isExpanded) && (
                    <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.75rem', lineHeight: 1.5, borderTop: `1px solid ${COLORS.border}`, paddingTop: '0.75rem' }}>
                      {s.details?.summary || `Score: ${s.value ?? '—'}. Click for details.`}
                    </div>
                  )}
                  <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: COLORS.gold, fontWeight: 600 }}>{isExpanded ? '▲ Collapse' : '▼ Expand rationale'}</div>
                  {isExpanded && (s.details?.breakdown?.length > 0 ? (
                    <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: `1px solid ${COLORS.border}`, fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.6 }}>
                      {s.details.breakdown.map((line, i) => <p key={i} style={{ margin: i > 0 ? '0.75rem 0 0' : 0 }}>{line}</p>)}
                    </div>
                  ) : (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#64748b' }}>No additional breakdown available.</div>
                  ))}
                </div>
              );
            })}
          </div>

          {/* Charts row */}
          <div className="charts-row">
            <div className="fade-in" style={{ background: COLORS.cardBg, border: `2px solid ${COLORS.gold}40`, borderRadius: 12, padding: '2rem', boxShadow: '0 8px 24px rgba(0,0,0,0.4), 0 3px 10px rgba(201,169,97,0.2)' }}>
              <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Sentiment evolution</h3>
              {sentimentHistory.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={sentimentHistory}>
                    <defs>
                      <linearGradient id="sentimentGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLORS.gold} stopOpacity={0.4}/>
                        <stop offset="95%" stopColor={COLORS.gold} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                    <XAxis dataKey="date" stroke="#94a3b8" style={{ fontSize: '0.8rem' }} tickFormatter={(d) => new Date(d).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })} />
                    <YAxis stroke="#94a3b8" domain={[0, 100]} style={{ fontSize: '0.8rem' }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="sentiment" stroke={COLORS.gold} fill="url(#sentimentGradient)" strokeWidth={3} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p style={{ color: '#64748b' }}>No history yet. Run Refresh to record snapshots.</p>
              )}
            </div>

            {radarData.length > 0 && (
              <div className="fade-in" style={{ background: COLORS.cardBg, border: `2px solid ${COLORS.gold}40`, borderRadius: 12, padding: '2rem', boxShadow: '0 8px 24px rgba(0,0,0,0.4), 0 3px 10px rgba(201,169,97,0.2)' }}>
                <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Reputation snapshot</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke={COLORS.border} strokeWidth={1.5} />
                    <PolarAngleAxis dataKey="metric" stroke="#cbd5e1" style={{ fontSize: '0.95rem', fontWeight: 600 }} />
                    <PolarRadiusAxis stroke="#94a3b8" domain={[0, 100]} style={{ fontSize: '0.75rem' }} />
                    <Radar name="Today's score" dataKey="current" stroke={COLORS.gold} fill={COLORS.gold} fillOpacity={0.4} strokeWidth={4} />
                    <Radar name="7-day average" dataKey="rolling7d" stroke="#fbbf24" fill="#fbbf24" fillOpacity={0.15} strokeDasharray="8 4" strokeWidth={3} />
                    <Legend wrapperStyle={{ fontSize: '0.9rem', fontWeight: 600 }} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Platform + Engagement */}
          <div className="platform-row">
            <div className="fade-in" style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '2rem', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
              <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Platform performance</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ padding: '1rem', background: `${COLORS.border}20`, borderRadius: 8 }}>
                  <div style={{ fontWeight: 600 }}>𝕏 · {dashboard.twitter_handle || '—'}</div>
                  <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                    {twitterFollowersFormatted ? `${twitterFollowersFormatted} followers` : 'Follower data pending'}
                  </div>
                </div>
                <div style={{ padding: '1rem', background: `${COLORS.border}20`, borderRadius: 8 }}>
                  <div style={{ fontWeight: 600 }}>Instagram{instagramHandle ? ` · @${instagramHandle}` : ''}</div>
                  <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                    {instagramFollowersFormatted ? `${instagramFollowersFormatted} followers` : 'Follower data pending'}
                  </div>
                </div>
                <div style={{ padding: '1rem', background: `${COLORS.border}20`, borderRadius: 8 }}>
                  <div style={{ fontWeight: 600 }}>News</div>
                  <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{dashboard.news_articles_count ?? 0} articles monitored</div>
                </div>
              </div>
            </div>

            <div className="fade-in" style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '2rem', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
              <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Aggregate engagement</h3>
              <div className="engagement-grid">
                <div style={{ padding: '1rem', background: `${COLORS.border}20`, borderRadius: 8 }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>𝕏 engagement</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: COLORS.gold }}>{(dashboard.avg_engagement_rate_twitter ?? agg.avg_engagement_rate_twitter_pct) != null ? `${(dashboard.avg_engagement_rate_twitter ?? agg.avg_engagement_rate_twitter_pct)}%` : '—'}</div>
                </div>
                <div style={{ padding: '1rem', background: `${COLORS.border}20`, borderRadius: 8 }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Instagram engagement</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: COLORS.gold }}>{(dashboard.avg_engagement_rate_instagram ?? agg.avg_engagement_rate_instagram_pct) != null ? `${(dashboard.avg_engagement_rate_instagram ?? agg.avg_engagement_rate_instagram_pct)}%` : '—'}</div>
                </div>
                <div style={{ padding: '1rem', background: `${COLORS.border}20`, borderRadius: 8 }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Total visibility</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: COLORS.gold }}>{dashboard.total_mentions ?? 0}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Timeline */}
          {dashboard.timeline_events?.length > 0 && (
            <div className="fade-in" style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '2rem', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
              <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Timeline</h3>
              {dashboard.timeline_events.slice(0, 15).map((ev, i, arr) => (
                <div key={i} style={{ padding: '0.75rem 0', borderBottom: i < arr.length - 1 ? `1px solid ${COLORS.border}` : 'none' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>
                    {ev.date ? new Date(ev.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''} · {ev.platforms}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#e2e8f0' }}>{ev.title}</div>
                  {ev.description && !ev.articles?.length && (
                    <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.25rem' }}>{ev.description}</div>
                  )}
                  {ev.articles?.length > 0 && (
                    <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      {ev.articles.map((a, j) => (
                        <div key={j} style={{ fontSize: '0.82rem', color: '#94a3b8', paddingLeft: '0.75rem', borderLeft: `2px solid ${COLORS.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                          <span>{a.title}</span>
                          {a.source && <span style={{ color: COLORS.gold, fontWeight: 600, flexShrink: 0, fontSize: '0.75rem' }}>{a.source}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Recent content — Overview only */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem', marginTop: '2rem' }}>
            {dashboard.recent_tweets?.length > 0 && (
              <div className="fade-in" style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '2rem', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
                <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Most recent posts on 𝕏</h3>
                {dashboard.recent_tweets.slice(0, 5).map((t) => (
                  <div key={t.id} style={{ padding: '0.75rem 0', borderBottom: '1px solid ' + COLORS.border }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {t.createdAt ? new Date(t.createdAt).toLocaleDateString('en-GB') : ''}&nbsp;·&nbsp;♥ {t.likes ?? 0} · 🔁 {t.retweets ?? 0}
                    </div>
                    <div style={{ fontSize: '0.9rem', marginTop: '0.25rem' }}>{(t.text || '').substring(0, 120)}…</div>
                  </div>
                ))}
              </div>
            )}
            {(dashboard.recent_instagram_posts?.length > 0 || pd.recent_instagram_posts?.length > 0) && (
              <div className="fade-in" style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '2rem', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
                <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Most recent posts on Instagram</h3>
                {instagramHandle && <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.75rem' }}>@{instagramHandle}</div>}
                {(dashboard.recent_instagram_posts || pd.recent_instagram_posts || []).slice(0, 5).map((p, i) => (
                  <div key={p.id || i} style={{ padding: '0.75rem 0', borderBottom: '1px solid ' + COLORS.border }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {p.timestamp ? new Date(p.timestamp).toLocaleDateString('en-GB') : ''}&nbsp;·&nbsp;♥ {p.likes ?? 0} · 💬 {p.comments ?? 0}
                    </div>
                    <div style={{ fontSize: '0.9rem', marginTop: '0.25rem' }}>{(p.caption || 'Instagram post').substring(0, 120)}…</div>
                  </div>
                ))}
              </div>
            )}
            {dashboard.recent_news?.length > 0 && (
              <div className="fade-in" style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '2rem', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
                <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Most recent news</h3>
                {dashboard.recent_news.slice(0, 5).map((a, i) => (
                  <div key={i} style={{ padding: '0.75rem 0', borderBottom: '1px solid ' + COLORS.border }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {a.publishedAt ? new Date(a.publishedAt).toLocaleDateString('en-GB') : ''}
                      {a.source?.name || a.source ? <span style={{ marginLeft: '0.5rem', color: COLORS.gold, fontWeight: 600 }}>· {a.source?.name || a.source}</span> : ''}
                    </div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 500, marginTop: '0.25rem' }}>{a.title}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── SCORE HISTORY TAB ── */}
      {activeTab === 'temporal' && (
        <div style={{ background: COLORS.cardBg, border: `2px solid ${COLORS.gold}40`, borderRadius: 12, padding: '2rem', marginBottom: '2rem', boxShadow: '0 8px 24px rgba(0,0,0,0.4), 0 3px 10px rgba(201,169,97,0.2)' }}>
          <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Score evolution over time</h3>
          <div className="temporal-scroll">
            <table className="temporal-table">
              <thead>
                <tr style={{ borderBottom: `3px solid ${COLORS.gold}` }}>
                  <th style={{ textAlign: 'left', padding: '1rem', fontSize: '0.8rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Metric</th>
                  <th style={{ textAlign: 'right', padding: '1rem', fontSize: '0.8rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Today's score<br/><span style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 400 }}>(24hr snapshot)</span></th>
                  <th style={{ textAlign: 'right', padding: '1.5rem', fontSize: '1rem', color: COLORS.gold, fontWeight: 900, textTransform: 'uppercase', background: `${COLORS.gold}15`, borderLeft: `3px solid ${COLORS.gold}`, borderRight: `3px solid ${COLORS.gold}` }}>
                    7-DAY AVERAGE<br/><span style={{ fontSize: '0.7rem', fontWeight: 600 }}>(smoothed trend)</span>
                  </th>
                  <th style={{ textAlign: 'right', padding: '1rem', fontSize: '0.8rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>1 week ago</th>
                  <th style={{ textAlign: 'right', padding: '1rem', fontSize: '0.8rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>1 month ago</th>
                  <th style={{ textAlign: 'right', padding: '1rem', fontSize: '0.8rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Monthly trend</th>
                </tr>
              </thead>
              <tbody>
                {scoreEvolution.map((row) => (
                  <tr key={row.metric} style={{ borderBottom: `1px solid ${COLORS.border}20` }}>
                    <td style={{ padding: '1rem', fontWeight: 600, fontSize: '0.95rem' }}>{row.metric}</td>
                    <td style={{ padding: '1rem', textAlign: 'right', fontWeight: 600, fontSize: '1rem', color: '#cbd5e1' }}>{row.current}</td>
                    <td style={{ padding: '1.5rem', textAlign: 'right', color: COLORS.gold, fontWeight: 900, fontSize: '1.5rem', background: `${COLORS.gold}10`, borderLeft: `3px solid ${COLORS.gold}40`, borderRight: `3px solid ${COLORS.gold}40`, textShadow: `0 0 10px ${COLORS.gold}30` }}>{row.rolling7d}</td>
                    <td style={{ padding: '1rem', textAlign: 'right', color: '#94a3b8', fontSize: '0.9rem' }}>{row.day7}</td>
                    <td style={{ padding: '1rem', textAlign: 'right', color: '#94a3b8', fontSize: '0.9rem' }}>{row.day30}</td>
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
        </div>
      )}

      {/* ── ALERTS TAB ── */}
      {activeTab === 'alerts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          <div className={alertLevel === 'critical' ? 'critical-glow' : ''} style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', padding: '1.75rem', background: `${alertConfig.color}12`, border: `2px solid ${alertConfig.color}50`, borderRadius: 12 }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: `${alertConfig.color}20`, border: `2px solid ${alertConfig.color}60`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <AlertIcon size={26} color={alertConfig.color} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: '1.3rem', color: alertConfig.color }}>
                {alertConfig.label === 'HEALTHY' ? 'Reputation is healthy' : alertConfig.label === 'WARNING' ? 'Reputation needs attention' : 'Reputation at risk — act now'}
              </div>
              <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.3rem' }}>
                {alertConfig.label === 'HEALTHY' ? 'All key metrics are within normal range. No immediate action required.' : alertConfig.label === 'WARNING' ? 'One or more metrics have moved outside normal range. Review recommended.' : 'Critical metrics detected. Immediate strategic response advised.'}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.5rem' }}>
                Last checked: {dashboard.updated_at ? new Date(dashboard.updated_at).toLocaleString() : '—'}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
            <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '1.75rem', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
              <h3 style={{ margin: '0 0 1.5rem', fontSize: '1rem', fontWeight: 700, color: COLORS.gold, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Metric thresholds</h3>
              <ThresholdBar label="Sentiment" value={sentimentVal} isInverse={false} zones={{ critical: 50, warning: 60 }} />
              <ThresholdBar label="Controversy" value={controversyVal} isInverse={true} zones={{ warning: 30, critical: 40 }} />
            </div>
            <div style={{ background: COLORS.cardBg, border: `2px solid ${srConfig.border}`, borderRadius: 12, padding: '1.75rem', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
              <h3 style={{ margin: '0 0 1.5rem', fontSize: '1rem', fontWeight: 700, color: COLORS.gold, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Commercial risk assessment</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
                <div style={{ width: 16, height: 16, borderRadius: '50%', background: srConfig.color, boxShadow: `0 0 10px ${srConfig.color}80`, flexShrink: 0 }} />
                <span style={{ fontWeight: 800, fontSize: '1.2rem', color: srConfig.color }}>{srConfig.label}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {[
                  { label: 'Sentiment', value: sentimentVal, threshold: 60, isInverse: false },
                  { label: 'Controversy', value: controversyVal, threshold: 30, isInverse: true },
                  { label: 'Credibility', value: dashboard.credibility_score ?? 0, threshold: 60, isInverse: false },
                ].map(({ label, value, threshold, isInverse }) => {
                  const ok = isInverse ? value < threshold : value >= threshold;
                  return (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.9rem', background: ok ? `${COLORS.success}10` : `${COLORS.danger}10`, borderRadius: 6, border: `1px solid ${ok ? COLORS.success : COLORS.danger}30` }}>
                      <span style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>{label}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 700, color: ok ? COLORS.success : COLORS.danger }}>{value}</span>
                        <span style={{ fontSize: '0.7rem', color: ok ? COLORS.success : COLORS.danger }}>{ok ? '✓' : '⚠'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '1.75rem', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 700, color: COLORS.gold, textTransform: 'uppercase', letterSpacing: '0.05em' }}>30-day risk trajectory</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
              <div style={{ padding: '1rem', background: `${COLORS.border}20`, borderRadius: 8 }}>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.5rem', fontWeight: 600 }}>Sentiment trend</div>
                <Sparkline data={sentimentSparkData} color={COLORS.gold} inverse={false} />
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.4rem' }}>Current: <strong style={{ color: '#e2e8f0' }}>{sentimentVal}</strong></div>
              </div>
              <div style={{ padding: '1rem', background: `${COLORS.border}20`, borderRadius: 8 }}>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.5rem', fontWeight: 600 }}>Controversy trend</div>
                <Sparkline data={controversySparkData} color={COLORS.warning} inverse={true} />
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.4rem' }}>Current: <strong style={{ color: '#e2e8f0' }}>{controversyVal}</strong></div>
              </div>
            </div>
          </div>

          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '1.75rem', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 700, color: COLORS.gold, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Incident log</h3>
            {incidents.length === 0 ? (
              <div style={{ fontSize: '0.9rem', color: '#475569', padding: '1rem', background: `${COLORS.success}08`, border: `1px solid ${COLORS.success}20`, borderRadius: 8 }}>
                ✓ No incidents recorded. Reputation is clean.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {incidents.map((inc, i) => {
                  const sevColor = inc.severity === 'high' ? COLORS.danger : inc.severity === 'medium' ? COLORS.warning : '#94a3b8';
                  const sevLabel = inc.severity === 'high' ? 'HIGH' : inc.severity === 'medium' ? 'MEDIUM' : 'LOW';
                  return (
                    <div key={i} style={{ padding: '1rem 1.25rem', background: `${sevColor}08`, border: `1px solid ${sevColor}30`, borderLeft: `4px solid ${sevColor}`, borderRadius: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: sevColor, background: `${sevColor}20`, padding: '2px 8px', borderRadius: 4 }}>{sevLabel}</span>
                          <div style={{ fontSize: '0.9rem', color: '#e2e8f0', fontWeight: 500, marginTop: '0.4rem' }}>{inc.description || inc.incident || 'Incident recorded'}</div>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', flexShrink: 0 }}>
                          {inc.date ? new Date(inc.date).toLocaleDateString('en-GB') : ''}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '1.75rem', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 700, color: COLORS.gold, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Active metric alerts</h3>
            {alerts.map((alert, i) => {
              const isOk = alert.severity === 'nominal';
              const alertColour = alert.severity === 'critical' ? COLORS.danger : alert.severity === 'elevated' ? COLORS.warning : COLORS.success;
              const severityLabel = alert.severity === 'critical' ? 'CRITICAL' : alert.severity === 'elevated' ? 'WARNING' : 'ALL CLEAR';
              return (
                <div key={i} style={{ padding: '1.25rem 1.5rem', marginBottom: '0.75rem', background: `${alertColour}10`, border: `1px solid ${alertColour}30`, borderLeft: `4px solid ${alertColour}`, borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: alertColour, background: `${alertColour}20`, padding: '2px 8px', borderRadius: 4 }}>{severityLabel}</span>
                      <div style={{ marginTop: '0.5rem', fontSize: '0.95rem', fontWeight: 500, color: '#e2e8f0' }}>{alert.message}</div>
                    </div>
                    {!isOk && (
                      <div style={{ textAlign: 'right', fontSize: '0.8rem', color: '#64748b' }}>
                        <div>Threshold: <span style={{ color: '#94a3b8' }}>{alert.threshold}</span></div>
                        <div>Current: <span style={{ color: alertColour, fontWeight: 700 }}>{alert.current}</span></div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      )}

      {/* ── INTELLIGENCE TAB ── */}
      {activeTab === 'intelligence' && (
        <>
          {pd.strategic_intelligence && (
            <div style={{ background: COLORS.cardBg, border: `2px solid ${COLORS.gold}40`, borderRadius: 12, padding: '2.5rem', marginBottom: '2rem', boxShadow: '0 8px 24px rgba(0,0,0,0.4), 0 3px 10px rgba(201,169,97,0.2)' }}>
              <h3 style={{ margin: '0 0 2rem', color: COLORS.gold, fontSize: '1.5rem', fontWeight: 800 }}>Strategic Intelligence</h3>
              {pd.strategic_intelligence.strategic_overview && (
                <div style={{ marginBottom: '2rem', padding: '1.5rem', background: `${COLORS.border}20`, borderRadius: 8, borderLeft: `4px solid ${COLORS.gold}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                    <Target size={24} color={COLORS.gold} />
                    <h4 style={{ margin: 0, color: COLORS.gold, fontSize: '1.1rem', fontWeight: 700 }}>Strategic Overview</h4>
                  </div>
                  <p style={{ lineHeight: 1.7, color: '#e2e8f0', margin: 0, fontSize: '0.95rem' }}>{pd.strategic_intelligence.strategic_overview}</p>
                </div>
              )}
              {pd.strategic_intelligence.key_risks?.length > 0 && (
                <div style={{ marginBottom: '2rem', padding: '1.5rem', background: `${COLORS.danger}10`, border: `2px solid ${COLORS.danger}40`, borderRadius: 8, borderLeft: `4px solid ${COLORS.danger}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                    <AlertCircle size={24} color={COLORS.danger} />
                    <h4 style={{ margin: 0, color: COLORS.danger, fontSize: '1.1rem', fontWeight: 700 }}>Key Risks</h4>
                  </div>
                  <div style={{ color: '#fca5a5', lineHeight: 1.8, fontSize: '0.95rem' }}>
                    {pd.strategic_intelligence.key_risks.map((risk, i) => <p key={i} style={{ margin: i > 0 ? '1rem 0 0' : 0 }}>{risk}</p>)}
                  </div>
                </div>
              )}
              {pd.strategic_intelligence.immediate_recommendations?.length > 0 && (
                <div style={{ marginBottom: '2rem', padding: '1.5rem', background: `${COLORS.success}10`, border: `2px solid ${COLORS.success}40`, borderRadius: 8, borderLeft: `4px solid ${COLORS.success}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                    <CheckCircle size={24} color={COLORS.success} />
                    <h4 style={{ margin: 0, color: COLORS.success, fontSize: '1.1rem', fontWeight: 700 }}>Immediate Recommendations</h4>
                  </div>
                  <div style={{ color: '#86efac', lineHeight: 1.8, fontSize: '0.95rem' }}>
                    {pd.strategic_intelligence.immediate_recommendations.map((rec, i) => <p key={i} style={{ margin: i > 0 ? '1rem 0 0' : 0 }}>{rec}</p>)}
                  </div>
                </div>
              )}
              {pd.strategic_intelligence.watch_outs?.length > 0 && (
                <div style={{ padding: '1.5rem', background: `${COLORS.warning}10`, border: `2px solid ${COLORS.warning}40`, borderRadius: 8, borderLeft: `4px solid ${COLORS.warning}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                    <Eye size={24} color={COLORS.warning} />
                    <h4 style={{ margin: 0, color: COLORS.warning, fontSize: '1.1rem', fontWeight: 700 }}>Watch-Outs</h4>
                  </div>
                  <div style={{ color: '#fcd34d', lineHeight: 1.8, fontSize: '0.95rem' }}>
                    {pd.strategic_intelligence.watch_outs.map((watch, i) => <p key={i} style={{ margin: i > 0 ? '1rem 0 0' : 0 }}>{watch}</p>)}
                  </div>
                </div>
              )}
            </div>
          )}
          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '2rem', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 1.5rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.gold }}>Overall perception summary</h3>
            <p style={{ lineHeight: 1.7, color: '#e2e8f0', fontSize: '0.95rem' }}>
              {(pd.Sentiment?.summary && pd.Sentiment.summary.trim()) ? pd.Sentiment.summary : `${dashboard.athlete_name} maintains a reputation driven by sentiment (${dashboard.sentiment_score ?? '—'}), credibility (${dashboard.credibility_score ?? '—'}), and relevance (${dashboard.relevance_score ?? '—'}).`}
            </p>
          </div>
        </>
      )}

      {/* ── DISCLAIMER ── */}
      {disclaimerVisible && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'rgba(10,14,26,0.97)', backdropFilter: 'blur(12px)', borderTop: `2px solid ${COLORS.gold}60`, padding: '0.9rem 2rem', fontSize: '0.72rem', color: '#94a3b8', lineHeight: 1.5, zIndex: 1000, boxShadow: '0 -4px 16px rgba(0,0,0,0.4)' }}>
          <button onClick={() => setDisclaimerVisible(false)} style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', right: '1.5rem', background: 'transparent', border: 'none', color: COLORS.gold, cursor: 'pointer', padding: '0.25rem', display: 'flex', alignItems: 'center' }} title="Dismiss">
            <X size={18} />
          </button>
          <div style={{ maxWidth: '1200px', margin: '0 auto', paddingRight: '3rem' }}>
            <strong style={{ color: COLORS.gold }}>Legal Disclaimer: </strong>
            This dashboard presents data-driven intelligence based on publicly available information and automated analysis. Scores are indicative assessments only and should not be considered definitive measures of reputation or character. Blue & Lintell Limited provides this information for strategic guidance purposes only and accepts no liability for decisions made based on this data. Users should exercise independent professional judgement when acting on insights provided.
          </div>
        </div>
      )}

      {!disclaimerVisible && (
        <button onClick={() => setDisclaimerVisible(true)} style={{ position: 'fixed', bottom: '1rem', right: '1.5rem', background: 'transparent', border: 'none', color: '#475569', padding: 0, fontSize: '0.7rem', cursor: 'pointer', fontWeight: 600, letterSpacing: '0.03em', zIndex: 999, textDecoration: 'underline', textUnderlineOffset: 3 }}>
          Legal disclaimer
        </button>
      )}

    </div>
  );
}
