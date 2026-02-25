import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function AthleteDetail() {
  const { athleteId } = useParams();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [historyDays, setHistoryDays] = useState(7);

  const loadDashboard = () => {
    setError(null);
    api
      .athlete(athleteId)
      .then(setDashboard)
      .catch((e) => setError(e.message));
  };

  const loadHistory = () => {
    api
      .athleteHistory(athleteId, historyDays)
      .then(setHistory)
      .catch(() => setHistory([]));
  };

  useEffect(() => {
    setLoading(true);
    loadDashboard();
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
      })
      .then((res) => {
        if (res.success) {
          loadDashboard();
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

  const scores = [
    { label: 'Sentiment', value: dashboard.sentiment_score },
    { label: 'Credibility', value: dashboard.credibility_score },
    { label: 'Likeability', value: dashboard.likeability_score },
    { label: 'Leadership', value: dashboard.leadership_score },
    { label: 'Authenticity', value: dashboard.authenticity_score },
    { label: 'Controversy', value: dashboard.controversy_score },
    { label: 'Relevance', value: dashboard.relevance_score },
  ];

  const maxHist = Math.max(...history.map((h) => h.sentiment_score || 0), 1);

  return (
    <div>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <button className="btn secondary" style={{ marginRight: '0.5rem' }} onClick={() => navigate('/')}>← Back</button>
            <h2 style={{ display: 'inline-block', marginLeft: '0.5rem', margin: 0 }}>{dashboard.athlete_name}</h2>
            <span className={`badge ${dashboard.overall_alert_level || 'nominal'}`} style={{ marginLeft: '0.5rem' }}>
              {dashboard.overall_alert_level || 'nominal'}
            </span>
          </div>
          <button className="btn" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh data'}
          </button>
        </div>
        <p className="updated">Last updated: {dashboard.updated_at ? new Date(dashboard.updated_at).toLocaleString() : '—'}</p>
        {dashboard.twitter_handle && <p className="updated">Twitter: {dashboard.twitter_handle}</p>}
      </div>

      <div className="card">
        <h3>Reputation scores</h3>
        <div className="score-grid">
          {scores.map((s) => (
            <div key={s.label} className="score-item">
              <label>{s.label}</label>
              <span className="value">{s.value ?? '—'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Sentiment trend ({historyDays} days)</h3>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              className={historyDays === d ? 'btn' : 'btn secondary'}
              onClick={() => setHistoryDays(d)}
            >
              {d}d
            </button>
          ))}
        </div>
        {history.length > 0 ? (
          <div className="history-chart">
            {history.map((h) => (
              <div
                key={h.snapshot_date}
                className="history-bar"
                title={`${h.snapshot_date}: ${h.sentiment_score}`}
                style={{ height: `${((h.sentiment_score || 0) / maxHist) * 100}%` }}
              />
            ))}
          </div>
        ) : (
          <p className="updated">No history yet. Run Refresh to record today’s snapshot.</p>
        )}
      </div>

      {(dashboard.timeline_events?.length > 0) && (
        <div className="card">
          <h3>Timeline</h3>
          {dashboard.timeline_events.slice(0, 10).map((ev, i) => (
            <div key={i} className="timeline-event">
              <div className="meta">{ev.date} · {ev.platforms}</div>
              <div><strong>{ev.title}</strong></div>
              {ev.description && <div className="updated">{ev.description}</div>}
            </div>
          ))}
        </div>
      )}

      {(dashboard.recent_tweets?.length > 0) && (
        <div className="card">
          <h3>Recent tweets</h3>
          {dashboard.recent_tweets.slice(0, 5).map((t) => (
            <div key={t.id} className="tweet-item">
              <div className="meta">{t.createdAt ? new Date(t.createdAt).toLocaleString() : ''} · ♥ {t.likes ?? 0} · 🔁 {t.retweets ?? 0}</div>
              <div>{t.text?.substring(0, 200)}{(t.text?.length || 0) > 200 ? '…' : ''}</div>
            </div>
          ))}
        </div>
      )}

      {(dashboard.recent_news?.length > 0) && (
        <div className="card">
          <h3>Recent news</h3>
          {dashboard.recent_news.slice(0, 5).map((a, i) => (
            <div key={i} className="news-item">
              <div className="meta">{a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : ''}</div>
              <div><strong>{a.title}</strong></div>
              {a.description && <div className="updated">{a.description.substring(0, 150)}…</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
