# Blue & Lintell — Athlete Intelligence Platform

Backend API and dashboard for tracking athlete reputation: Twitter, Instagram, news, and sentiment scores with historical trends.

---

## Prerequisites

- **Node.js** 18+
- **Supabase** project (run `supabase_schema.sql` once in SQL Editor)
- **API keys**: Netrows (Twitter), optional Instagram/NewsData.io/AWS Comprehend (see [Environment variables](#environment-variables))

---

## Repository structure

```
├── server.js              # Backend API (Express)
├── supabase_schema.sql    # Database schema (run once in Supabase)
├── dashboard/             # React (Vite) dashboard
│   ├── src/
│   │   ├── api.js         # API client
│   │   ├── App.jsx
│   │   └── pages/         # Home, AthleteDetail
│   └── package.json
├── .env.example
├── README.md              # Full documentation (this file)
└── POSTMAN_TESTS.md       # API testing with Postman
```

---

## Environment variables

Copy `.env.example` to `.env` and set:

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_KEY` | Yes | Supabase anon or service role key |
| `NETROWS_API_KEY` | Yes | Netrows (Twitter) API key |
| `INSTAGRAM_ACCESS_TOKEN` | No | Meta Graph API token (Instagram) |
| `NEWSDATA_API_KEY` | No | NewsData.io key |
| `AWS_ACCESS_KEY_ID` | No | AWS Comprehend (sentiment) |
| `AWS_SECRET_ACCESS_KEY` | No | AWS Comprehend |
| `AWS_REGION` | No | e.g. `us-east-1` (default) |
| `PORT` | No | Server port (default `3000`) |
| `CRON_SECRET` | No | Secret for HTTP cron trigger (production) |

Dashboard (in `dashboard/`): optional `VITE_API_URL` — backend URL in production; leave empty in dev (proxy used).

---

## Local development

### Backend

```bash
npm install
cp .env.example .env   # then fill .env
npm start
```

Server runs at `http://localhost:3000`. Endpoints: `/api/health`, `/api/athletes`, `/api/athlete/:id`, etc.

### Dashboard

```bash
cd dashboard
npm install
npm run dev
```

Dashboard runs at `http://localhost:5173`. In dev, API requests are proxied to `http://localhost:3000` (no `VITE_API_URL` needed).

---

## API reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/athletes/list` | List athletes (master table) |
| POST | `/api/athletes` | Create athlete |
| GET | `/api/athletes` | List current dashboards |
| GET | `/api/athlete/:id` | Single athlete dashboard |
| GET | `/api/athlete/:id/history/:days` | Historical snapshots (1–30 days) |
| POST | `/api/athlete/refresh` | Refresh one athlete (fetch Twitter, News, etc.) |
| GET | `/api/cron/daily` | Run daily update for all athletes (optional `?secret=CRON_SECRET`) |

Request/response examples: see **POSTMAN_TESTS.md**.

---

## Real data: refresh vs cron

- **Real-time data** comes from the **refresh** step: it calls Twitter, Instagram, News, and AWS and writes the current dashboard + one history snapshot. You get real data by:
  - Using the dashboard **“Refresh data”** button for one athlete, or
  - Calling **POST /api/athlete/refresh** for one athlete, or
  - Running the **daily job** (see below), which refreshes *all* active athletes.
- **Cron is not required** for real data. It is for **automated** daily updates of all athletes. Use it so every active athlete is refreshed once per day without manual action. For testing, you can run the same job once by calling **GET /api/cron/daily** (see POSTMAN_TESTS.md).

---

## Cron (daily update)

The backend can update all active athletes daily.

### In-process cron

When the server runs 24/7, a job runs **every day at 06:00** (server time). No extra setup.

---

## Production deployment

### Backend (e.g. Railway)

Deploy the Express app to an always-on Node host (e.g. **Railway**). Vercel is better for the **dashboard** (static frontend), not for this long-running backend.

**Railway:** New Project → Deploy from GitHub → select repo → Root Directory = repo root → Build: `npm install` → Start: `npm start` → add env vars from `.env.example` → Deploy.

Note the backend URL for the dashboard (e.g. `https://your-app.railway.app`).

### Dashboard (Vercel or Netlify)

1. Set **root directory** to `dashboard`.
2. **Build command:** `npm install && npm run build`
3. **Output directory:** `dist`
4. **Environment variable:** `VITE_API_URL` = your backend URL (e.g. `https://your-app.railway.app`) — no trailing slash.
5. Deploy. The built app will call your production API.

CORS is enabled on the backend, so the dashboard origin is allowed.

---

## One-time setup: Supabase

Run the SQL schema once in Supabase: open your project → **SQL Editor** → **New query** → paste the contents of **supabase_schema.sql** → **Run**. This creates the tables and a sample athlete.

---

## Documentation

- **README.md** (this file) — Setup, env vars, API reference, cron, deployment, troubleshooting.
- **POSTMAN_TESTS.md** — API testing with Postman (creating data, refresh, cron).

---

## Troubleshooting
- **Twitter (Netrows) 404** — Usually invalid or missing `NETROWS_API_KEY`, or the Twitter handle isn’t found. Check [Netrows](https://netrows.com) dashboard and ensure the key is correct and the handle (e.g. `@trippier2`) exists. The job still runs and saves; scores use defaults when Twitter fails.
- **News (NewsData.io) 422** — Often invalid or missing `NEWSDATA_API_KEY`, or quota exceeded. Check [NewsData.io](https://newsdata.io) and your plan. The job still runs and saves; news-related scores use defaults when the API fails.
- **Same scores for every athlete / "dummy" data** — This happens when Twitter and News APIs fail (404/422). With no tweets or news, the backend uses fallback scores (e.g. Sentiment 50, Credibility 0). Fix Netrows and NewsData.io keys; then run **POST /api/athlete/refresh** again.
---

## License

UNLICENSED (private).
