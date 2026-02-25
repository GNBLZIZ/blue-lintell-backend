# Postman tests – after schema is run in Supabase

Use these once the schema has been run in the Supabase SQL Editor.  
Base URL: **`http://localhost:3000`** (or your server URL).

---

## Test with a real athlete (real API data)

To verify real Twitter/News/sentiment data, add a high-profile athlete and refresh:

### Step 1 – Create the athlete

- **Method:** POST  
- **URL:** `http://localhost:3000/api/athletes`  
- **Headers:** `Content-Type: application/json`  
- **Body (raw JSON):**

**Marcus Rashford** (Manchester United, high Twitter & news coverage):

```json
{
  "name": "Marcus Rashford",
  "twitter_handle": "@MarcusRashford",
  "sport": "Football",
  "team": "Manchester United",
  "position": "Forward",
  "age": 26
}
```

**Or Mohamed Salah** (Liverpool):

```json
{
  "name": "Mohamed Salah",
  "twitter_handle": "@MoSalah",
  "sport": "Football",
  "team": "Liverpool",
  "position": "Forward",
  "age": 31
}
```

From the response, copy the **`id`** (UUID).

### Step 2 – Refresh (fetch real data)

- **Method:** POST  
- **URL:** `http://localhost:3000/api/athlete/refresh`  
- **Headers:** `Content-Type: application/json`  
- **Body (raw JSON)** — use the `id` from Step 1 and match name/handle:

For Rashford:
```json
{
  "athleteId": "<paste id from Step 1>",
  "athleteName": "Marcus Rashford",
  "twitterHandle": "@MarcusRashford",
  "instagramBusinessId": ""
}
```

For Salah:
```json
{
  "athleteId": "<paste id from Step 1>",
  "athleteName": "Mohamed Salah",
  "twitterHandle": "@MoSalah",
  "instagramBusinessId": ""
}
```

Wait 15–45 seconds. You should get `{ "success": true, "data": { ... } }` with real scores, tweets, and news if your Netrows and NewsData.io keys are valid.

### Step 3 – View in dashboard

Open **`http://localhost:5173`** and click the new athlete, or **GET** `http://localhost:3000/api/athlete/<id>` to see the full payload.

---

## Run daily update now (cron once) — get real data for all athletes

To refresh **all** active athletes in one go (same as the scheduled daily job, but run now):

- **Method:** GET  
- **URL:** `http://localhost:3000/api/cron/daily`  
  If you set `CRON_SECRET` in `.env`, use: `http://localhost:3000/api/cron/daily?secret=YOUR_CRON_SECRET`
- **Body:** none  

**Expected:** `200` with `{ "success": true, "updated": N }` (N = number of athletes). The request can take 10–30+ seconds per athlete (Twitter, Instagram, News, sentiment). After it finishes, **GET /api/athletes** and the dashboard will show real data for all athletes.

---

## Creating data via Postman (step-by-step)

You already have **one seed athlete** (Kieran Trippier) from the schema. To get dashboard and history data:

### Option A – Use the existing seed athlete

1. **GET** `http://localhost:3000/api/athletes/list`  
   → Copy the `id` from the response (e.g. Kieran Trippier).
2. **POST** `http://localhost:3000/api/athlete/refresh`  
   - Body (raw JSON):
   ```json
   {
     "athleteId": "<paste the id from step 1>",
     "athleteName": "Kieran Trippier",
     "twitterHandle": "@trippier2",
     "instagramBusinessId": ""
   }
   ```
   → This creates/updates the dashboard and today’s history snapshot (takes 10–30 s).
3. Then call **GET /api/athletes**, **GET /api/athlete/:id**, and **GET /api/athlete/:id/history/7** to see the data.

### Option B – Create more athletes, then refresh

1. **POST** `http://localhost:3000/api/athletes` to add an athlete (see **§ 3** below).  
2. Use the returned `id` in **POST /api/athlete/refresh** (same body shape as above; use the new athlete’s `name` and `twitter_handle`).  
3. Repeat for other athletes if needed.

---

## 1. Health check

- **Method:** GET  
- **URL:** `http://localhost:3000/api/health`  
- **Body:** none  

**Expected:** `200` with JSON like `{ "ok": true, "timestamp": "..." }`

---

## 2. List athletes (master list) – get athlete IDs for refresh

- **Method:** GET  
- **URL:** `http://localhost:3000/api/athletes/list`  
- **Body:** none  

**Expected:** `200` with JSON array like `[{ "id": "uuid-here", "name": "Kieran Trippier", "twitter_handle": "@trippier2", "instagram_business_id": null }]`.  
Use the `id` from any row as `athleteId` in the refresh request below.

---

## 3. Create an athlete (seed data via Postman)

- **Method:** POST  
- **URL:** `http://localhost:3000/api/athletes`  
- **Headers:** `Content-Type: application/json`  
- **Body (raw JSON):**

**Minimal (required only):**
```json
{
  "name": "Marcus Rashford",
  "twitter_handle": "@MarcusRashford"
}
```

**Full (all optional fields):**
```json
{
  "name": "Marcus Rashford",
  "twitter_handle": "@MarcusRashford",
  "instagram_business_id": "",
  "sport": "Football",
  "team": "Manchester United",
  "position": "Forward",
  "age": 26
}
```

**Expected:** `201` with the created athlete including `id`. Use that `id` in **POST /api/athlete/refresh** (with the same `name` and `twitter_handle`).

---

## 4. List athlete dashboards (current snapshots)

- **Method:** GET  
- **URL:** `http://localhost:3000/api/athletes`  
- **Body:** none  

**Expected:** `200` with JSON array (empty `[]` until you run refresh).

---

## 5. Refresh one athlete (creates/updates dashboard + history)

- **Method:** POST  
- **URL:** `http://localhost:3000/api/athlete/refresh`  
- **Headers:** `Content-Type: application/json`  
- **Body (raw JSON):**

```json
{
  "athleteId": "<PASTE_ATHLETE_UUID_HERE>",
  "athleteName": "Kieran Trippier",
  "twitterHandle": "@trippier2",
  "instagramBusinessId": ""
}
```

**How to get `athleteId`:** Call **GET /api/athletes/list** first; use the `id` from the response (e.g. the sample "Kieran Trippier" row).

**Expected:** `200` with `{ "success": true, "data": { ... } }` (may take 10–30 seconds while Twitter/Instagram/News are fetched).

---

## 6. Get one athlete dashboard

- **Method:** GET  
- **URL:** `http://localhost:3000/api/athlete/:athleteId`  
  Example: `http://localhost:3000/api/athlete/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`  
- **Body:** none  

**Expected:** `200` with full dashboard JSON, or `500` if ID not found.

---

## 7. Get athlete history (7 days)

- **Method:** GET  
- **URL:** `http://localhost:3000/api/athlete/:athleteId/history/7`  
  Example: `http://localhost:3000/api/athlete/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx/history/7`  
- **Body:** none  

**Expected:** `200` with JSON array of historical snapshots (one per day). After first refresh you’ll have 1 row; after 7 days of cron/refreshes, up to 7.

---

## 8. Get athlete history (30 days)

- **Method:** GET  
- **URL:** `http://localhost:3000/api/athlete/:athleteId/history/30`  
- **Body:** none  

**Expected:** `200` with array of history rows (max 30).

---

## Quick test order

1. **GET /api/health** – confirm server is up.  
2. **GET /api/athletes/list** – get the seed athlete’s `id`.  
3. **POST /api/athlete/refresh** – paste that `id` as `athleteId`, set `athleteName` and `twitterHandle` to match (e.g. Kieran Trippier, @trippier2).  
4. **GET /api/athletes** – should list one dashboard.  
5. **GET /api/athlete/:id** – full dashboard for that athlete.  
6. **GET /api/athlete/:id/history/7** – at least one history snapshot.  
7. *(Optional)* **POST /api/athletes** – create another athlete, then **POST /api/athlete/refresh** with the new `id` to add more data.
