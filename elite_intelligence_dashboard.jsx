import React, { useState, useEffect } from 'react';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Cell } from 'recharts';
import { AlertTriangle, TrendingUp, TrendingDown, Shield, Target, Activity, Clock, ChevronRight, Bell, Eye, MessageSquare, Users, Radio } from 'lucide-react';

const EliteAthleteIntelligenceDashboard = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const [timeRange, setTimeRange] = useState('7d');
  const [alertLevel, setAlertLevel] = useState('nominal'); // nominal, elevated, critical
  const [isLive, setIsLive] = useState(true);

  // NEW: Real data from API
  const [athleteData, setAthleteData] = useState(null);
  const [rollingData, setRollingData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Simulated real-time data (in production, this comes from backend)
  const [currentTimestamp, setCurrentTimestamp] = useState(new Date());

  // NEW: Fetch athlete data from backend
  const ATHLETE_ID = '1574bdb1-db3d-44e9-8011-7e424b27afc6'; // Trippier
  const API_BASE = 'https://blue-lintell-backend-production-4040.up.railway.app';

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch rolling average data
        const rollingResponse = await fetch(`${API_BASE}/api/athlete/${ATHLETE_ID}/rolling/7`);
        if (!rollingResponse.ok) {
          throw new Error('Failed to fetch rolling average data');
        }
        const rollingJson = await rollingResponse.json();
        setRollingData(rollingJson);
        
        // Fetch full athlete data for perception details
        const athleteResponse = await fetch(`${API_BASE}/api/athlete/${ATHLETE_ID}`);
        if (!athleteResponse.ok) {
          throw new Error('Failed to fetch athlete data');
        }
        const athleteJson = await athleteResponse.json();
        setAthleteData(athleteJson);
        
        setLoading(false);
      } catch (err) {
        console.error('Error fetching data:', err);
        setError(err.message);
        setLoading(false);
      }
    };

    fetchData();
    
    // Refresh data every 5 minutes
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTimestamp(new Date());
    }, 60000); // Update every minute
    return () => clearInterval(interval);
  }, []);

  // Brand colors
  const COLORS = {
    navy: '#1a3a5c',
    gold: '#c9a961',
    danger: '#dc2626',
    warning: '#f59e0b',
    success: '#10b981',
    neutral: '#6b7280',
    bg: '#0a0e1a',
    cardBg: '#151b2e',
    border: '#1e293b'
  };

  // === CONVERT API DATA TO DASHBOARD FORMAT ===
  
  // Convert rolling data to scoreEvolution format
  const scoreEvolution = rollingData ? [
    { 
      metric: 'Sentiment', 
      current: rollingData.scores.sentiment.current,
      rolling_avg: rollingData.scores.sentiment.rolling_avg,
      change_from_yesterday: rollingData.scores.sentiment.change_from_yesterday,
      trend: rollingData.scores.sentiment.trend,
      change: rollingData.scores.sentiment.change_from_yesterday > 0 ? `+${rollingData.scores.sentiment.change_from_yesterday}` : `${rollingData.scores.sentiment.change_from_yesterday}`
    },
    { 
      metric: 'Credibility', 
      current: rollingData.scores.credibility.current,
      rolling_avg: rollingData.scores.credibility.rolling_avg,
      change_from_yesterday: rollingData.scores.credibility.change_from_yesterday,
      trend: rollingData.scores.credibility.trend,
      change: rollingData.scores.credibility.change_from_yesterday > 0 ? `+${rollingData.scores.credibility.change_from_yesterday}` : `${rollingData.scores.credibility.change_from_yesterday}`
    },
    { 
      metric: 'Likeability', 
      current: rollingData.scores.likeability.current,
      rolling_avg: rollingData.scores.likeability.rolling_avg,
      change_from_yesterday: rollingData.scores.likeability.change_from_yesterday,
      trend: rollingData.scores.likeability.trend,
      change: rollingData.scores.likeability.change_from_yesterday > 0 ? `+${rollingData.scores.likeability.change_from_yesterday}` : `${rollingData.scores.likeability.change_from_yesterday}`
    },
    { 
      metric: 'Leadership', 
      current: rollingData.scores.leadership.current,
      rolling_avg: rollingData.scores.leadership.rolling_avg,
      change_from_yesterday: rollingData.scores.leadership.change_from_yesterday,
      trend: rollingData.scores.leadership.trend,
      change: rollingData.scores.leadership.change_from_yesterday > 0 ? `+${rollingData.scores.leadership.change_from_yesterday}` : `${rollingData.scores.leadership.change_from_yesterday}`
    },
    { 
      metric: 'Authenticity', 
      current: rollingData.scores.authenticity.current,
      rolling_avg: rollingData.scores.authenticity.rolling_avg,
      change_from_yesterday: rollingData.scores.authenticity.change_from_yesterday,
      trend: rollingData.scores.authenticity.trend,
      change: rollingData.scores.authenticity.change_from_yesterday > 0 ? `+${rollingData.scores.authenticity.change_from_yesterday}` : `${rollingData.scores.authenticity.change_from_yesterday}`
    },
    { 
      metric: 'Controversy', 
      current: rollingData.scores.controversy.current,
      rolling_avg: rollingData.scores.controversy.rolling_avg,
      change_from_yesterday: rollingData.scores.controversy.change_from_yesterday,
      trend: rollingData.scores.controversy.trend,
      change: rollingData.scores.controversy.change_from_yesterday > 0 ? `+${rollingData.scores.controversy.change_from_yesterday}` : `${rollingData.scores.controversy.change_from_yesterday}`
    },
    { 
      metric: 'Relevance', 
      current: rollingData.scores.relevance.current,
      rolling_avg: rollingData.scores.relevance.rolling_avg,
      change_from_yesterday: rollingData.scores.relevance.change_from_yesterday,
      trend: rollingData.scores.relevance.trend,
      change: rollingData.scores.relevance.change_from_yesterday > 0 ? `+${rollingData.scores.relevance.change_from_yesterday}` : `${rollingData.scores.relevance.change_from_yesterday}`
    }
  ] : [];

  // === MOCK DATA WITH TEMPORAL TRENDS (KEEP FOR CHARTS) ===
  
  // 30-day historical sentiment data
  const sentimentHistory = Array.from({ length: 30 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (29 - i));
    return {
      date: date.toISOString().split('T')[0],
      sentiment: 65 + Math.sin(i / 3) * 15 + Math.random() * 5,
      volume: 1200 + Math.random() * 800,
      positive: 45 + Math.random() * 15,
      neutral: 35 + Math.random() * 10,
      negative: 15 + Math.random() * 10
    };
  });

  // Platform engagement trends
  const platformTrends = [
    { platform: 'Twitter', followers: athleteData?.twitter_followers || 2847000, change: '+12.4K', changePercent: 0.44, engagement: 3.2, posts: 156, sentiment: 71 },
    { platform: 'Instagram', followers: athleteData?.instagram_followers || 4521000, change: '+28.1K', changePercent: 0.62, engagement: 5.8, posts: 89, sentiment: 78 },
    { platform: 'News', mentions: athleteData?.news_articles_count || 1247, change: '+89', changePercent: 7.7, sentiment: 68, reach: '12.4M', impact: 'High' },
    { platform: 'Forums', mentions: 3421, change: '+234', changePercent: 7.3, sentiment: 64, reach: '2.1M', impact: 'Medium' }
  ];

  // Critical alerts & threat monitoring
  const alerts = [
    { 
      id: 1, 
      severity: 'elevated', 
      type: 'sentiment_drop', 
      message: 'Sentiment dropped 8pts in 48hrs - Investigation recommended',
      timestamp: '2 hours ago',
      source: 'Twitter Analytics',
      actionable: true,
      threshold: 'Warning: <65',
      current: 63
    },
    {
      id: 2,
      severity: 'nominal',
      type: 'controversy_spike',
      message: 'Controversy score stable - Below alert threshold',
      timestamp: '6 hours ago',
      source: 'News Monitoring',
      actionable: false,
      threshold: 'Critical: >40',
      current: 28
    },
    {
      id: 3,
      severity: 'elevated',
      type: 'engagement_anomaly',
      message: 'Instagram engagement -32% vs 7-day average',
      timestamp: '12 hours ago',
      source: 'Platform Analytics',
      actionable: true,
      threshold: 'Warning: -25%',
      current: '-32%'
    }
  ];

  // Narrative intelligence - What's driving the numbers
  const narrativeInsights = [
    {
      category: 'Primary Driver',
      insight: 'Transfer speculation (54% of volume)',
      sentiment: 'Mixed',
      impact: 'High',
      trend: 'Increasing',
      icon: TrendingUp
    },
    {
      category: 'Emerging Theme',
      insight: 'Community work recognition (+18% positive mentions)',
      sentiment: 'Positive',
      impact: 'Medium',
      trend: 'Growing',
      icon: Users
    },
    {
      category: 'Risk Factor',
      insight: 'Contract negotiation criticism (12% of volume)',
      sentiment: 'Negative',
      impact: 'Medium',
      trend: 'Stable',
      icon: AlertTriangle
    }
  ];

  // Perception breakdown for each score (use real data from API if available)
  const perceptionDetails = athleteData?.perception_details || {
    Sentiment: {
      score: 72,
      summary: 'Overall sentiment: Positive. Strong professional support.',
      breakdown: [
        '• Twitter/X: 78% positive - fans loyal, plead for him to stay',
        '• Instagram: 85% positive - strong engagement on posts',
        '• News Media: 60% neutral - mix of sports/tabloid coverage',
        '• Marriage split coverage slightly impacted overall score',
        '• Professional performance keeps sentiment elevated'
      ]
    },
    Credibility: {
      score: 85,
      summary: 'Established expertise with proven track record across platforms.',
      breakdown: [
        '• 54 England caps - International recognition',
        '• World Cup 2018 semi-finalist (scored in semi)',
        '• La Liga champion with Atletico Madrid',
        '• PFA Team of the Year multiple times',
        '• Eddie Howe: "One of the best RBs in the Premier League"'
      ]
    },
    Likeability: {
      score: 75,
      summary: 'Warmth and approachability. Genuine fan connection.',
      breakdown: [
        '• Instagram: 2M followers with high engagement rates',
        '• Captaincy armband gesture to Miley went viral',
        '• Direct fan engagement (even during confrontation)',
        '• Family-focused content resonates well',
        '• Marriage split handled with dignity and maturity'
      ]
    },
    Leadership: {
      score: 80,
      summary: 'Strong leader on and off the field. Team influence.',
      breakdown: [
        '• Former club captain, still regularly wears armband',
        '• Lifted 2025 Carabao Cup (first trophy in 70 years)',
        '• Eddie Howe: "Key dressing room leader"',
        '• Mentors young players like Lewis Miley',
        '• Led Newcastle from relegation to Champions League'
      ]
    },
    Authenticity: {
      score: 77,
      summary: 'Genuine and unscripted. Shows real emotion and transparency.',
      breakdown: [
        '• Confronted angry fan directly vs avoiding',
        '• Publicly emotional after losses and wins',
        '• Social media feels personal, not PR-managed',
        '• Handled marriage split with honest statement',
        '• Instagram shows genuine family side'
      ]
    },
    Controversy: {
      score: 28,
      summary: 'Lower score indicates less controversy. Clean professional record.',
      breakdown: [
        '• June 2025: Marriage split made public, tabloid coverage',
        '• Spotted with reality TV star Chloe Ferry in Ibiza',
        '• Nov 2023: Fan confrontation (quickly resolved)',
        '• No professional misconduct or red cards',
        '• Transfer speculation creates regular headlines'
      ]
    },
    Relevance: {
      score: 82,
      summary: 'Media attention and public interest driven by performance.',
      breakdown: [
        '• Contract expires June 2026 - constant speculation',
        '• Weekly mentions in Newcastle match reports',
        '• Marriage split drove 2-month media spike (Jun-Jul 2025)',
        '• Champions League performances keep him relevant',
        '• At 35, age/retirement narrative emerging'
      ]
    }
  };

  // === ALERT THRESHOLD SYSTEM ===
  
  const thresholds = {
    sentiment: { critical: 50, warning: 60, optimal: 70 },
    controversy: { critical: 40, warning: 30, optimal: 20 },
    engagement: { critical: -30, warning: -15, optimal: 0 }
  };

  const calculateOverallAlertLevel = () => {
    if (!rollingData) return 'nominal';
    const sentiment = rollingData.scores.sentiment.rolling_avg;
    const controversy = rollingData.scores.controversy.rolling_avg;
    
    if (sentiment < thresholds.sentiment.critical || controversy > thresholds.controversy.critical) {
      return 'critical';
    } else if (sentiment < thresholds.sentiment.warning || controversy > thresholds.controversy.warning) {
      return 'elevated';
    }
    return 'nominal';
  };

  const overallAlert = calculateOverallAlertLevel();

  // === LOADING & ERROR STATES ===
  
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0a0e1a 0%, #151b2e 100%)',
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', color: COLORS.gold, marginBottom: '16px' }}>
            Loading athlete intelligence...
          </div>
          <div style={{ fontSize: '14px', color: '#94a3b8' }}>
            Fetching real-time reputation data
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0a0e1a 0%, #151b2e 100%)',
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        <div style={{ textAlign: 'center', maxWidth: '500px', padding: '24px' }}>
          <AlertTriangle size={48} color={COLORS.danger} style={{ marginBottom: '16px' }} />
          <div style={{ fontSize: '18px', color: COLORS.danger, marginBottom: '16px' }}>
            Error Loading Data
          </div>
          <div style={{ fontSize: '14px', color: '#94a3b8', marginBottom: '24px' }}>
            {error}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '12px 24px',
              background: COLORS.gold,
              border: 'none',
              borderRadius: '6px',
              color: COLORS.navy,
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!rollingData || !athleteData) {
    return null;
  }

  // === SOPHISTICATED UI COMPONENTS ===

  const AlertStatusBar = () => {
    const statusConfig = {
      nominal: { color: COLORS.success, label: 'NOMINAL', icon: Shield },
      elevated: { color: COLORS.warning, label: 'ELEVATED', icon: AlertTriangle },
      critical: { color: COLORS.danger, label: 'CRITICAL', icon: AlertTriangle }
    };
    
    const config = statusConfig[overallAlert];
    const Icon = config.icon;
    
    return (
      <div style={{
        background: `linear-gradient(135deg, ${config.color}15, ${config.color}05)`,
        border: `1px solid ${config.color}40`,
        padding: '16px 24px',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        marginBottom: '24px'
      }}>
        <div style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          background: `${config.color}20`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `2px solid ${config.color}`
        }}>
          <Icon size={24} color={config.color} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ 
              fontSize: '18px', 
              fontWeight: '700', 
              color: config.color,
              letterSpacing: '1px'
            }}>
              THREAT LEVEL: {config.label}
            </span>
            {isLive && (
              <span style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: COLORS.success,
                fontWeight: '600'
              }}>
                <Radio size={12} />
                LIVE MONITORING
              </span>
            )}
          </div>
          <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>
            Last updated: {currentTimestamp.toLocaleTimeString()} • {alerts.filter(a => a.severity !== 'nominal').length} active alerts • 7-day rolling average ({rollingData.period_start} to {rollingData.period_end})
          </div>
        </div>
      </div>
    );
  };

  const ScoreCard = ({ metric, current, rolling_avg, trend, change, threshold }) => {
    const [showDetails, setShowDetails] = useState(false);
    const trendColor = trend === 'up' ? COLORS.success : trend === 'down' ? COLORS.danger : COLORS.neutral;
    const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Activity;
    
    // Determine if score is in danger zone
    const isDanger = metric === 'Controversy' ? rolling_avg > thresholds.controversy.warning : rolling_avg < thresholds.sentiment.warning;
    
    const details = perceptionDetails[metric];
    
    return (
      <div 
        style={{
          background: COLORS.cardBg,
          border: `1px solid ${isDanger ? COLORS.danger + '40' : COLORS.border}`,
          borderRadius: '12px',
          padding: '20px',
          position: 'relative',
          overflow: 'hidden',
          cursor: 'pointer',
          transition: 'all 0.3s'
        }}
        onClick={() => setShowDetails(!showDetails)}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-4px)';
          e.currentTarget.style.boxShadow = `0 8px 24px ${COLORS.gold}20`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        {isDanger && (
          <div style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: '40px',
            height: '40px',
            background: `${COLORS.danger}20`,
            borderBottomLeftRadius: '100%',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'flex-end',
            padding: '6px'
          }}>
            <AlertTriangle size={16} color={COLORS.danger} />
          </div>
        )}
        
        <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '8px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {metric}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '8px' }}>
          <span style={{ fontSize: '42px', fontWeight: '700', color: '#ffffff' }}>
            {rolling_avg || current}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <TrendIcon size={16} color={trendColor} />
            <span style={{ fontSize: '16px', fontWeight: '600', color: trendColor }}>
              {change}
            </span>
          </div>
        </div>
        
        {/* 7-day average label */}
        <div style={{ 
          fontSize: '11px', 
          color: '#64748b', 
          marginBottom: showDetails ? '12px' : '0',
          fontWeight: '600',
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}>
          7-day average
        </div>
        
        {/* Summary */}
        {details && (
          <div style={{ 
            fontSize: '13px', 
            color: '#94a3b8', 
            marginBottom: showDetails ? '12px' : '0',
            marginTop: '8px',
            lineHeight: '1.5'
          }}>
            {details.summary}
          </div>
        )}
        
        {/* Expanded Details */}
        {showDetails && details && (
          <div style={{
            marginTop: '16px',
            paddingTop: '16px',
            borderTop: `1px solid ${COLORS.border}`,
            fontSize: '12px',
            color: '#cbd5e1',
            lineHeight: '1.8'
          }}>
            {details.breakdown.map((line, i) => (
              <div key={i} style={{ marginBottom: '6px' }}>
                {line}
              </div>
            ))}
          </div>
        )}
        
        {/* Click hint */}
        <div style={{ 
          marginTop: '12px', 
          fontSize: '11px', 
          color: '#64748b',
          textAlign: 'center',
          opacity: showDetails ? 0 : 0.6
        }}>
          Click for details
        </div>
        
        {/* Mini trend sparkline */}
        <div style={{ height: '32px', marginTop: '12px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sentimentHistory.slice(-7).map((d, i) => ({ 
              value: (rolling_avg || current) + (Math.random() - 0.5) * 5 
            }))}>
              <defs>
                <linearGradient id={`gradient-${metric}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={trendColor} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area 
                type="monotone" 
                dataKey="value" 
                stroke={trendColor} 
                strokeWidth={2}
                fill={`url(#gradient-${metric})`}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  const AlertCard = ({ alert }) => {
    const severityConfig = {
      critical: { color: COLORS.danger, bg: `${COLORS.danger}10`, border: COLORS.danger },
      elevated: { color: COLORS.warning, bg: `${COLORS.warning}10`, border: COLORS.warning },
      nominal: { color: COLORS.success, bg: `${COLORS.success}10`, border: COLORS.success }
    };
    
    const config = severityConfig[alert.severity];
    
    return (
      <div style={{
        background: config.bg,
        border: `1px solid ${config.border}40`,
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '12px',
        borderLeft: `4px solid ${config.border}`
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              fontSize: '11px',
              fontWeight: '700',
              color: config.color,
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              {alert.severity}
            </span>
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              {alert.source}
            </span>
          </div>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            {alert.timestamp}
          </span>
        </div>
        
        <div style={{ fontSize: '14px', color: '#e2e8f0', marginBottom: '8px', fontWeight: '500' }}>
          {alert.message}
        </div>
        
        <div style={{ display: 'flex', gap: '16px', fontSize: '12px' }}>
          <span style={{ color: '#94a3b8' }}>
            Threshold: <span style={{ color: config.color, fontWeight: '600' }}>{alert.threshold}</span>
          </span>
          <span style={{ color: '#94a3b8' }}>
            Current: <span style={{ color: '#ffffff', fontWeight: '600' }}>{alert.current}</span>
          </span>
        </div>
        
        {alert.actionable && (
          <button style={{
            marginTop: '12px',
            padding: '6px 12px',
            background: `${config.color}20`,
            border: `1px solid ${config.color}`,
            borderRadius: '4px',
            color: config.color,
            fontSize: '12px',
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            View Details <ChevronRight size={14} />
          </button>
        )}
      </div>
    );
  };

  // === MAIN DASHBOARD RENDER ===

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0e1a 0%, #151b2e 100%)',
      color: '#ffffff',
      padding: '24px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      {/* Header */}
      <div style={{
        background: COLORS.navy,
        borderRadius: '12px',
        padding: '24px',
        marginBottom: '24px',
        border: `1px solid ${COLORS.gold}40`,
        boxShadow: `0 0 20px ${COLORS.gold}10`
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <h1 style={{ margin: 0, fontSize: '28px', fontWeight: '700' }}>
                {athleteData.athlete_name || 'KIERAN TRIPPIER'}
              </h1>
              <span style={{
                background: `${COLORS.gold}20`,
                border: `1px solid ${COLORS.gold}`,
                color: COLORS.gold,
                padding: '4px 12px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: '700',
                letterSpacing: '0.5px'
              }}>
                ELITE TIER
              </span>
            </div>
            <div style={{ fontSize: '14px', color: '#94a3b8' }}>
              Newcastle United • England International • Defender
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>
                MONITORING PERIOD
              </div>
              <select 
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value)}
                style={{
                  background: COLORS.cardBg,
                  border: `1px solid ${COLORS.border}`,
                  color: '#ffffff',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                <option value="24h">24 Hours</option>
                <option value="7d">7 Days</option>
                <option value="30d">30 Days</option>
                <option value="90d">90 Days</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Alert Status Bar */}
      <AlertStatusBar />

      {/* Navigation Tabs */}
      <div style={{ 
        display: 'flex', 
        gap: '8px', 
        marginBottom: '24px',
        borderBottom: `1px solid ${COLORS.border}`,
        paddingBottom: '0'
      }}>
        {['overview', 'temporal', 'alerts', 'intelligence'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: activeTab === tab ? COLORS.cardBg : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab ? `2px solid ${COLORS.gold}` : '2px solid transparent',
              color: activeTab === tab ? COLORS.gold : '#94a3b8',
              padding: '12px 24px',
              fontSize: '14px',
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <>
          {/* Score Cards Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px',
            marginBottom: '24px'
          }}>
            {scoreEvolution.map(score => (
              <ScoreCard key={score.metric} {...score} threshold={thresholds} />
            ))}
          </div>

          {/* Main Intelligence Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
            {/* Sentiment Trend Chart */}
            <div style={{
              background: COLORS.cardBg,
              border: `1px solid ${COLORS.border}`,
              borderRadius: '12px',
              padding: '24px'
            }}>
              <h3 style={{ margin: '0 0 20px 0', fontSize: '16px', fontWeight: '700', color: COLORS.gold }}>
                SENTIMENT EVOLUTION (30 DAYS)
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={sentimentHistory}>
                  <defs>
                    <linearGradient id="sentimentGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS.gold} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={COLORS.gold} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                  <XAxis 
                    dataKey="date" 
                    stroke="#64748b"
                    style={{ fontSize: '12px' }}
                    tickFormatter={(date) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  />
                  <YAxis stroke="#64748b" style={{ fontSize: '12px' }} />
                  <Tooltip 
                    contentStyle={{ 
                      background: COLORS.cardBg, 
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: '8px'
                    }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="sentiment" 
                    stroke={COLORS.gold} 
                    strokeWidth={2}
                    fill="url(#sentimentGradient)"
                  />
                  {/* Threshold lines */}
                  <Line 
                    type="monotone" 
                    dataKey={() => thresholds.sentiment.warning} 
                    stroke={COLORS.warning}
                    strokeWidth={1}
                    strokeDasharray="5 5"
                    dot={false}
                  />
                  <Line 
                    type="monotone" 
                    dataKey={() => thresholds.sentiment.critical} 
                    stroke={COLORS.danger}
                    strokeWidth={1}
                    strokeDasharray="5 5"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
              
              {/* Threshold Legend */}
              <div style={{ display: 'flex', gap: '20px', marginTop: '16px', fontSize: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '20px', height: '2px', background: COLORS.danger }} />
                  <span style={{ color: '#94a3b8' }}>Critical ({thresholds.sentiment.critical})</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '20px', height: '2px', background: COLORS.warning }} />
                  <span style={{ color: '#94a3b8' }}>Warning ({thresholds.sentiment.warning})</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '20px', height: '2px', background: COLORS.success }} />
                  <span style={{ color: '#94a3b8' }}>Optimal ({thresholds.sentiment.optimal}+)</span>
                </div>
              </div>
            </div>

            {/* Platform Performance */}
            <div style={{
              background: COLORS.cardBg,
              border: `1px solid ${COLORS.border}`,
              borderRadius: '12px',
              padding: '24px'
            }}>
              <h3 style={{ margin: '0 0 20px 0', fontSize: '16px', fontWeight: '700', color: COLORS.gold }}>
                PLATFORM PERFORMANCE
              </h3>
              {platformTrends.map((platform, index) => (
                <div 
                  key={platform.platform}
                  style={{
                    padding: '16px',
                    background: index % 2 === 0 ? `${COLORS.border}20` : 'transparent',
                    borderRadius: '8px',
                    marginBottom: '8px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: '600' }}>{platform.platform}</span>
                    <span style={{ 
                      fontSize: '12px', 
                      color: platform.changePercent > 0 ? COLORS.success : COLORS.danger,
                      fontWeight: '600'
                    }}>
                      {platform.change}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                    {platform.followers ? `${(platform.followers / 1000000).toFixed(1)}M followers` : `${platform.mentions} mentions`} • 
                    Sentiment: <span style={{ color: platform.sentiment > 70 ? COLORS.success : platform.sentiment > 60 ? COLORS.warning : COLORS.danger, fontWeight: '600' }}>
                      {platform.sentiment}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* TEMPORAL TAB */}
      {activeTab === 'temporal' && (
        <>
          {/* Score Evolution Comparison */}
          <div style={{
            background: COLORS.cardBg,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '24px'
          }}>
            <h3 style={{ margin: '0 0 20px 0', fontSize: '16px', fontWeight: '700', color: COLORS.gold }}>
              SCORE EVOLUTION ANALYSIS
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                    <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>Metric</th>
                    <th style={{ textAlign: 'right', padding: '12px', fontSize: '12px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>7-Day Avg</th>
                    <th style={{ textAlign: 'right', padding: '12px', fontSize: '12px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>Current</th>
                    <th style={{ textAlign: 'right', padding: '12px', fontSize: '12px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>Change</th>
                    <th style={{ textAlign: 'center', padding: '12px', fontSize: '12px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {scoreEvolution.map((score, index) => (
                    <tr key={score.metric} style={{ borderBottom: `1px solid ${COLORS.border}20` }}>
                      <td style={{ padding: '16px', fontSize: '14px', fontWeight: '600' }}>{score.metric}</td>
                      <td style={{ padding: '16px', textAlign: 'right', fontSize: '18px', fontWeight: '700', color: '#ffffff' }}>{score.rolling_avg}</td>
                      <td style={{ padding: '16px', textAlign: 'right', fontSize: '14px', color: '#94a3b8' }}>{score.current}</td>
                      <td style={{ 
                        padding: '16px', 
                        textAlign: 'right', 
                        fontSize: '14px', 
                        fontWeight: '600',
                        color: score.trend === 'up' ? COLORS.success : score.trend === 'down' ? COLORS.danger : COLORS.neutral
                      }}>
                        {score.change}
                      </td>
                      <td style={{ padding: '16px', textAlign: 'center' }}>
                        <div style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          background: score.trend === 'up' ? `${COLORS.success}20` : score.trend === 'down' ? `${COLORS.danger}20` : `${COLORS.neutral}20`,
                          border: `1px solid ${score.trend === 'up' ? COLORS.success : score.trend === 'down' ? COLORS.danger : COLORS.neutral}`,
                          fontSize: '12px',
                          fontWeight: '600'
                        }}>
                          {score.trend === 'up' ? <TrendingUp size={14} /> : score.trend === 'down' ? <TrendingDown size={14} /> : <Activity size={14} />}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Radar Comparison - Current vs 7-Day Average */}
          <div style={{
            background: COLORS.cardBg,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '12px',
            padding: '24px'
          }}>
            <h3 style={{ margin: '0 0 20px 0', fontSize: '16px', fontWeight: '700', color: COLORS.gold }}>
              REPUTATION PROFILE: CURRENT VS 7-DAY AVERAGE
            </h3>
            <ResponsiveContainer width="100%" height={400}>
              <RadarChart data={scoreEvolution.map(s => ({
                metric: s.metric,
                current: s.current,
                rolling_avg: s.rolling_avg
              }))}>
                <PolarGrid stroke={COLORS.border} />
                <PolarAngleAxis dataKey="metric" stroke="#94a3b8" style={{ fontSize: '12px' }} />
                <PolarRadiusAxis stroke="#64748b" />
                <Radar name="Current" dataKey="current" stroke={COLORS.gold} fill={COLORS.gold} fillOpacity={0.3} strokeWidth={2} />
                <Radar name="7-Day Average" dataKey="rolling_avg" stroke="#64748b" fill="#64748b" fillOpacity={0.1} strokeWidth={1} strokeDasharray="5 5" />
                <Legend />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* ALERTS TAB */}
      {activeTab === 'alerts' && (
        <>
          <div style={{
            background: COLORS.cardBg,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '24px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: COLORS.gold }}>
                ACTIVE THREAT MONITORING
              </h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button style={{
                  padding: '6px 12px',
                  background: `${COLORS.danger}20`,
                  border: `1px solid ${COLORS.danger}`,
                  borderRadius: '4px',
                  color: COLORS.danger,
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}>
                  Critical ({alerts.filter(a => a.severity === 'critical').length})
                </button>
                <button style={{
                  padding: '6px 12px',
                  background: `${COLORS.warning}20`,
                  border: `1px solid ${COLORS.warning}`,
                  borderRadius: '4px',
                  color: COLORS.warning,
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}>
                  Elevated ({alerts.filter(a => a.severity === 'elevated').length})
                </button>
              </div>
            </div>
            
            {alerts.map(alert => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>

          {/* Threshold Configuration */}
          <div style={{
            background: COLORS.cardBg,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '12px',
            padding: '24px'
          }}>
            <h3 style={{ margin: '0 0 20px 0', fontSize: '16px', fontWeight: '700', color: COLORS.gold }}>
              ALERT THRESHOLD CONFIGURATION
            </h3>
            <div style={{ display: 'grid', gap: '20px' }}>
              {Object.entries(thresholds).map(([key, values]) => (
                <div key={key} style={{
                  padding: '16px',
                  background: `${COLORS.border}20`,
                  borderRadius: '8px'
                }}>
                  <div style={{ 
                    fontSize: '14px', 
                    fontWeight: '600', 
                    marginBottom: '12px',
                    textTransform: 'capitalize',
                    color: '#ffffff'
                  }}>
                    {key}
                  </div>
                  <div style={{ display: 'flex', gap: '20px', fontSize: '12px' }}>
                    <div>
                      <span style={{ color: '#94a3b8' }}>Critical: </span>
                      <span style={{ color: COLORS.danger, fontWeight: '600' }}>{values.critical}</span>
                    </div>
                    <div>
                      <span style={{ color: '#94a3b8' }}>Warning: </span>
                      <span style={{ color: COLORS.warning, fontWeight: '600' }}>{values.warning}</span>
                    </div>
                    <div>
                      <span style={{ color: '#94a3b8' }}>Optimal: </span>
                      <span style={{ color: COLORS.success, fontWeight: '600' }}>{values.optimal}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* INTELLIGENCE TAB */}
      {activeTab === 'intelligence' && (
        <>
          {/* Overall Perception Summary */}
          <div style={{
            background: COLORS.cardBg,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '24px'
          }}>
            <h3 style={{ margin: '0 0 20px 0', fontSize: '16px', fontWeight: '700', color: COLORS.gold }}>
              OVERALL PERCEPTION SUMMARY
            </h3>
            <div style={{
              fontSize: '15px',
              lineHeight: '1.8',
              color: '#e2e8f0',
              marginBottom: '24px'
            }}>
              <p style={{ marginBottom: '16px' }}>
                <strong style={{ color: COLORS.gold }}>Public Perception:</strong> {athleteData.athlete_name || 'Kieran Trippier'} maintains a <strong>predominantly positive</strong> reputation across digital platforms. 
                Fan loyalty remains strong on Twitter/X with supporters consistently advocating for his retention at the club. 
                Instagram engagement is particularly high, with family-focused and personal content resonating well with followers.
              </p>
              <p style={{ marginBottom: '16px' }}>
                <strong style={{ color: COLORS.gold }}>Professional Standing:</strong> Credibility scores reflect his established international recognition 
                (54 England caps) and proven track record at elite level (La Liga champion, World Cup semi-finalist). Leadership qualities are evident 
                both on-field through captaincy duties and off-field through mentoring younger players.
              </p>
              <p style={{ marginBottom: '16px' }}>
                <strong style={{ color: COLORS.gold }}>Authenticity Factor:</strong> Authenticity ratings benefit from genuine, unscripted social media presence 
                and direct fan engagement. The handling of personal matters (including marriage split) with dignity and transparency has maintained trust. 
                Public displays of emotion after both victories and defeats reinforce perception of genuineness.
              </p>
              <p style={{ marginBottom: '0' }}>
                <strong style={{ color: COLORS.gold }}>Risk Factors:</strong> Controversy metrics remain low with no professional misconduct. 
                Personal life coverage (marriage split, social appearances) generated temporary media attention but has not significantly impacted 
                professional reputation. Transfer speculation drives ongoing media volume but sentiment remains largely neutral-to-positive.
              </p>
            </div>
            
            {/* Key Metrics Overview */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '16px',
              marginTop: '24px',
              paddingTop: '24px',
              borderTop: `1px solid ${COLORS.border}`
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '32px', fontWeight: '700', color: COLORS.gold, marginBottom: '8px' }}>
                  78%
                </div>
                <div style={{ fontSize: '13px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Positive Sentiment<br/>Twitter/X
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '32px', fontWeight: '700', color: COLORS.gold, marginBottom: '8px' }}>
                  85%
                </div>
                <div style={{ fontSize: '13px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Positive Sentiment<br/>Instagram
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '32px', fontWeight: '700', color: COLORS.gold, marginBottom: '8px' }}>
                  54
                </div>
                <div style={{ fontSize: '13px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  England Caps<br/>International Recognition
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '32px', fontWeight: '700', color: COLORS.gold, marginBottom: '8px' }}>
                  {athleteData.instagram_followers ? `${(athleteData.instagram_followers / 1000000).toFixed(1)}M` : '2M+'}
                </div>
                <div style={{ fontSize: '13px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Instagram Followers<br/>High Engagement
                </div>
              </div>
            </div>
          </div>

          {/* Narrative Intelligence */}
          <div style={{
            background: COLORS.cardBg,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '24px'
          }}>
            <h3 style={{ margin: '0 0 20px 0', fontSize: '16px', fontWeight: '700', color: COLORS.gold }}>
              NARRATIVE INTELLIGENCE
            </h3>
            <div style={{ display: 'grid', gap: '16px' }}>
              {narrativeInsights.map((insight, index) => {
                const Icon = insight.icon;
                return (
                  <div 
                    key={index}
                    style={{
                      padding: '20px',
                      background: `${COLORS.border}20`,
                      borderRadius: '8px',
                      display: 'flex',
                      gap: '16px',
                      alignItems: 'start'
                    }}
                  >
                    <div style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '8px',
                      background: `${COLORS.gold}20`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      <Icon size={20} color={COLORS.gold} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase' }}>
                        {insight.category}
                      </div>
                      <div style={{ fontSize: '14px', color: '#ffffff', marginBottom: '8px', fontWeight: '500' }}>
                        {insight.insight}
                      </div>
                      <div style={{ display: 'flex', gap: '16px', fontSize: '12px' }}>
                        <span style={{ color: '#94a3b8' }}>
                          Sentiment: <span style={{ 
                            color: insight.sentiment === 'Positive' ? COLORS.success : insight.sentiment === 'Negative' ? COLORS.danger : COLORS.warning,
                            fontWeight: '600'
                          }}>
                            {insight.sentiment}
                          </span>
                        </span>
                        <span style={{ color: '#94a3b8' }}>
                          Impact: <span style={{ color: '#ffffff', fontWeight: '600' }}>{insight.impact}</span>
                        </span>
                        <span style={{ color: '#94a3b8' }}>
                          Trend: <span style={{ color: COLORS.gold, fontWeight: '600' }}>{insight.trend}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default EliteAthleteIntelligenceDashboard;
