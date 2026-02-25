import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function Home() {
  const [dashboards, setDashboards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .athletes()
      .then(setDashboards)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading dashboards…</div>;
  if (error) return <div className="error">Error: {error}</div>;

  if (dashboards.length === 0) {
    return (
      <div className="card">
        <p>No athlete dashboards yet. Refresh an athlete from the API (e.g. POST /api/athlete/refresh) to populate data.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Athlete dashboards</h2>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {dashboards.map((d) => (
          <li key={d.athlete_id} style={{ marginBottom: '1rem' }}>
            <Link to={`/athlete/${d.athlete_id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="card" style={{ marginBottom: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span style={{ fontWeight: 600 }}>{d.athlete_name || 'Unknown'}</span>
                  <span className={`badge ${d.overall_alert_level || 'nominal'}`}>{d.overall_alert_level || 'nominal'}</span>
                </div>
                <div className="score-grid" style={{ marginTop: '0.75rem' }}>
                  <div className="score-item">
                    <label>Sentiment</label>
                    <span className="value">{d.sentiment_score ?? '—'}</span>
                  </div>
                  <div className="score-item">
                    <label>Credibility</label>
                    <span className="value">{d.credibility_score ?? '—'}</span>
                  </div>
                  <div className="score-item">
                    <label>Controversy</label>
                    <span className="value">{d.controversy_score ?? '—'}</span>
                  </div>
                </div>
                <p className="updated" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                  Updated: {d.updated_at ? new Date(d.updated_at).toLocaleString() : '—'}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
