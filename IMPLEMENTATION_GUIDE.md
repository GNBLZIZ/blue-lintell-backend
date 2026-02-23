# BLUE & LINTELL - DEVELOPER IMPLEMENTATION GUIDE
## Elite Intelligence Dashboard Backend Implementation

**Project:** Elite Athlete Reputation Intelligence System
**Last Updated:** 19 February 2026
**Status:** Developer Selected - Ready to Start

---

## 📋 PROJECT OVERVIEW

You've been selected to implement the backend for an **elite-tier intelligence dashboard** for athlete reputation monitoring. 

**The code is already 90% written** - your job is to:

1. Set up API accounts (Twitter, Instagram, News, AWS)
2. Configure the backend with API keys
3. Test all integrations
4. Connect the elite React frontend to the backend
5. Implement historical data storage (30-day tracking)
6. Deploy to production
7. Set up automated daily updates

---

## 🎯 WHAT YOU'RE BUILDING

An **elite intelligence system** that:
- Monitors Twitter/Instagram/News for athletes 24/7
- Analyzes sentiment using AWS AI
- Calculates 7 reputation scores automatically
- **Stores 30 days of historical data** for trend analysis
- Generates perception summaries and narrative intelligence
- **Alert system** with 3-tier threat levels (nominal/elevated/critical)
- **Temporal tracking** (day-to-day, week-to-week changes)
- Updates daily via cron job
- Provides REST API for elite React dashboard

---

## 📦 FILES PROVIDED

You have access to:

1. **athlete_backend_mvp.js** (400 lines) - Complete backend code
2. **elite_intelligence_dashboard.jsx** (700+ lines) - Elite React frontend
3. **SETUP_GUIDE.md** - Step-by-step setup instructions
4. **API_RECOMMENDATIONS.md** - All API providers and pricing
5. **Database schema SQL** - Supabase setup commands

---

## 🗄️ DATABASE SCHEMA

You'll need to create **3 tables** in Supabase:

### Table 1: athletes
```sql
CREATE TABLE athletes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  twitter_handle TEXT,
  instagram_business_id TEXT,
  sport TEXT DEFAULT 'Football',
  team TEXT,
  position TEXT,
  age INTEGER,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Table 2: athlete_dashboards
```sql
CREATE TABLE athlete_dashboards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  athlete_id UUID REFERENCES athletes(id),
  athlete_name TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  twitter_handle TEXT,
  twitter_followers INTEGER,
  instagram_followers INTEGER,
  sentiment_score INTEGER,
  credibility_score INTEGER,
  likeability_score INTEGER,
  leadership_score INTEGER,
  authenticity_score INTEGER,
  controversy_score INTEGER,
  relevance_score INTEGER,
  recent_tweets JSONB,
  recent_news JSONB,
  timeline_events JSONB,
  total_mentions INTEGER,
  news_articles_count INTEGER,
  avg_tweet_engagement INTEGER,
  overall_alert_level TEXT,
  perception_details JSONB
);
```

### Table 3: athlete_score_history (NEW - for temporal tracking)
```sql
CREATE TABLE athlete_score_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  athlete_id UUID REFERENCES athletes(id),
  snapshot_date DATE NOT NULL,
  sentiment_score INTEGER,
  credibility_score INTEGER,
  likeability_score INTEGER,
  leadership_score INTEGER,
  authenticity_score INTEGER,
  controversy_score INTEGER,
  relevance_score INTEGER,
  twitter_followers INTEGER,
  instagram_followers INTEGER,
  news_mentions INTEGER,
  overall_alert_level TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_athlete_history ON athlete_score_history(athlete_id, snapshot_date);
```

**Test Data - Insert this athlete:**
```sql
INSERT INTO athletes (name, twitter_handle, sport, team, position, age)
VALUES ('Kieran Trippier', '@trippier2', 'Football', 'Newcastle United', 'Right-Back', 34);
```

---

## 🔧 IMPLEMENTATION CHECKLIST

### **Phase 1: API Setup**

**Create these accounts:**
- [ ] Netrows (Twitter data) - https://netrows.com - $49/month plan
- [ ] Meta Developer (Instagram) - https://developers.facebook.com - FREE
- [ ] NewsData.io (News) - https://newsdata.io - FREE tier
- [ ] AWS (Sentiment analysis) - https://aws.amazon.com - FREE tier
- [ ] Supabase (Database) - https://supabase.com - FREE tier

**Get these API keys:**
- [ ] Netrows: Dashboard → API Keys
- [ ] Instagram: Meta Developer → Graph API Explorer → Generate Token
- [ ] NewsData.io: Dashboard → Copy API Key
- [ ] AWS: Console → Security Credentials → Create Access Key
- [ ] Supabase: Project Settings → API → Copy URL and anon key

---

### **Phase 2: Project Setup**

**Install dependencies:**
```bash
npm install express axios dotenv @supabase/supabase-js @aws-sdk/client-comprehend node-cron cors
```

**Create .env file:**
```bash
# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_anon_key

# API Keys
NETROWS_API_KEY=your_netrows_key
INSTAGRAM_ACCESS_TOKEN=your_instagram_token
NEWSDATA_API_KEY=your_newsdata_key

# AWS
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1

# Server
PORT=3000
```

**Create .gitignore:**
```
node_modules/
.env
*.log
.DS_Store
```

---

### **Phase 3: Historical Tracking Implementation**

**Add this function to server.js:**

```javascript
// Save daily snapshot for temporal tracking
async function saveHistoricalSnapshot(athleteId, dashboardData) {
  const today = new Date().toISOString().split('T')[0];
  
  // Check if snapshot already exists for today
  const { data: existing } = await supabase
    .from('athlete_score_history')
    .select('id')
    .eq('athlete_id', athleteId)
    .eq('snapshot_date', today)
    .single();
  
  if (existing) {
    console.log('📊 Snapshot already exists for today');
    return { data: existing, error: null };
  }
  
  const { data, error } = await supabase
    .from('athlete_score_history')
    .insert({
      athlete_id: athleteId,
      snapshot_date: today,
      sentiment_score: dashboardData.sentiment_score,
      credibility_score: dashboardData.credibility_score,
      likeability_score: dashboardData.likeability_score,
      leadership_score: dashboardData.leadership_score,
      authenticity_score: dashboardData.authenticity_score,
      controversy_score: dashboardData.controversy_score,
      relevance_score: dashboardData.relevance_score,
      twitter_followers: dashboardData.twitter_followers,
      instagram_followers: dashboardData.instagram_followers,
      news_mentions: dashboardData.total_mentions,
      overall_alert_level: calculateAlertLevel(dashboardData)
    });
  
  if (error) {
    console.error('❌ Error saving snapshot:', error);
    return { data: null, error };
  }
  
  console.log('✅ Historical snapshot saved');
  return { data, error: null };
}

// Calculate alert level based on thresholds
function calculateAlertLevel(data) {
  const sentiment = data.sentiment_score || 70;
  const controversy = data.controversy_score || 30;
  
  // Critical thresholds
  if (sentiment < 50 || controversy > 40) {
    return 'critical';
  }
  
  // Warning thresholds
  if (sentiment < 60 || controversy > 30) {
    return 'elevated';
  }
  
  // All good
  return 'nominal';
}
```

**Call this function after updating dashboard:**
```javascript
// After saving to athlete_dashboards
await saveHistoricalSnapshot(athleteId, dashboardData);
```

---

### **Phase 4: API Endpoints**

**You need to create these endpoints:**

#### GET /api/athlete/:athleteId
Returns current dashboard state with perception details

**Expected Response:**
```json
{
  "athlete_name": "Kieran Trippier",
  "updated_at": "2026-02-19T10:30:00Z",
  "twitter_handle": "@trippier2",
  "twitter_followers": 2847000,
  "instagram_followers": 4521000,
  "sentiment_score": 72,
  "credibility_score": 85,
  "likeability_score": 75,
  "leadership_score": 80,
  "authenticity_score": 77,
  "controversy_score": 28,
  "relevance_score": 82,
  "overall_alert_level": "nominal",
  "recent_tweets": [...],
  "recent_news": [...],
  "timeline_events": [...],
  "perception_details": {
    "Sentiment": {
      "summary": "Overall sentiment: Positive. Strong professional support.",
      "breakdown": [
        "• Twitter/X: 78% positive - fans loyal, plead for him to stay",
        "• Instagram: 85% positive - strong engagement on posts",
        "• News Media: 60% neutral - mix of sports/tabloid coverage"
      ]
    }
  }
}
```

#### GET /api/athlete/:athleteId/history/:days
Returns historical scores for temporal charts (7, 14, or 30 days)

**Implementation:**
```javascript
app.get('/api/athlete/:athleteId/history/:days', async (req, res) => {
  const { athleteId, days } = req.params;
  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - parseInt(days));
  
  const { data, error } = await supabase
    .from('athlete_score_history')
    .select('*')
    .eq('athlete_id', athleteId)
    .gte('snapshot_date', daysAgo.toISOString().split('T')[0])
    .order('snapshot_date', { ascending: true });
    
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
```

#### POST /api/athlete/refresh
Triggers manual data refresh for an athlete

**Expected Request:**
```json
{
  "athleteId": "uuid-here",
  "athleteName": "Kieran Trippier",
  "twitterHandle": "@trippier2"
}
```

---

### **Phase 5: Perception Details Structure**

**Add this to your dashboard data:**

```javascript
const perceptionDetails = {
  Sentiment: {
    summary: "Overall sentiment: Positive. Strong professional support.",
    breakdown: [
      "• Twitter/X: 78% positive - fans loyal, plead for him to stay",
      "• Instagram: 85% positive - strong engagement on posts",
      "• News Media: 60% neutral - mix of sports/tabloid coverage",
      "• Marriage split coverage slightly impacted overall score",
      "• Professional performance keeps sentiment elevated"
    ]
  },
  Credibility: {
    summary: "Established expertise with proven track record across platforms.",
    breakdown: [
      "• 54 England caps - International recognition",
      "• World Cup 2018 semi-finalist (scored in semi)",
      "• La Liga champion with Atletico Madrid",
      "• PFA Team of the Year multiple times",
      "• Eddie Howe: \"One of the best RBs in the Premier League\""
    ]
  },
  Likeability: {
    summary: "Warmth and approachability. Genuine fan connection.",
    breakdown: [
      "• Instagram: 2M followers with high engagement rates",
      "• Captaincy armband gesture to Miley went viral",
      "• Direct fan engagement (even during confrontation)",
      "• Family-focused content resonates well",
      "• Marriage split handled with dignity and maturity"
    ]
  },
  Leadership: {
    summary: "Strong leader on and off the field. Team influence.",
    breakdown: [
      "• Former club captain, still regularly wears armband",
      "• Lifted 2025 Carabao Cup (first trophy in 70 years)",
      "• Eddie Howe: \"Key dressing room leader\"",
      "• Mentors young players like Lewis Miley",
      "• Led Newcastle from relegation to Champions League"
    ]
  },
  Authenticity: {
    summary: "Genuine and unscripted. Shows real emotion and transparency.",
    breakdown: [
      "• Confronted angry fan directly vs avoiding",
      "• Publicly emotional after losses and wins",
      "• Social media feels personal, not PR-managed",
      "• Handled marriage split with honest statement",
      "• Instagram shows genuine family side"
    ]
  },
  Controversy: {
    summary: "Lower score indicates less controversy. Clean professional record.",
    breakdown: [
      "• June 2025: Marriage split made public, tabloid coverage",
      "• Spotted with reality TV star Chloe Ferry in Ibiza",
      "• Nov 2023: Fan confrontation (quickly resolved)",
      "• No professional misconduct or red cards",
      "• Transfer speculation creates regular headlines"
    ]
  },
  Relevance: {
    summary: "Media attention and public interest driven by performance.",
    breakdown: [
      "• Contract expires June 2026 - constant speculation",
      "• Weekly mentions in Newcastle match reports",
      "• Marriage split drove 2-month media spike (Jun-Jul 2025)",
      "• Champions League performances keep him relevant",
      "• At 35, age/retirement narrative emerging"
    ]
  }
};

// Include in your dashboard response
dashboardData.perception_details = perceptionDetails;
```

---

### **Phase 6: Testing**

**Test Locally:**
```bash
# Start server
node server.js

# Test current dashboard
curl http://localhost:3000/api/athlete/ATHLETE_UUID

# Test refresh
curl -X POST http://localhost:3000/api/athlete/refresh \
  -H "Content-Type: application/json" \
  -d '{"athleteId":"UUID","athleteName":"Kieran Trippier","twitterHandle":"@trippier2"}'

# Test historical data (after running for 3+ days)
curl http://localhost:3000/api/athlete/ATHLETE_UUID/history/30
```

**What to verify:**
- [ ] All API integrations working (Twitter, Instagram, News, AWS)
- [ ] Data saving to all 3 database tables
- [ ] Historical snapshots creating daily
- [ ] Alert level calculating correctly
- [ ] Perception details structure correct
- [ ] Timeline events generating

---

### **Phase 7: Deployment**

**Deploy to Vercel:**

1. Create `vercel.json`:
```json
{
  "version": 2,
  "builds": [{"src": "server.js", "use": "@vercel/node"}],
  "routes": [{"src": "/(.*)", "dest": "server.js"}]
}
```

2. Deploy:
```bash
npm install -g vercel
vercel login
vercel
```

3. Add environment variables in Vercel dashboard (all .env values)

4. Test live endpoint:
```bash
curl https://your-app.vercel.app/api/athlete/UUID
```

**Alternative: Railway.app** (recommended for cron jobs)
- Better for scheduled tasks
- More reliable cron execution
- Similar deployment process

---

### **Phase 8: Automated Daily Updates**

**Add cron endpoint:**
```javascript
app.get('/api/cron/update', async (req, res) => {
  console.log('🔄 Running daily update cron job...');
  
  // Fetch all active athletes
  const { data: athletes, error } = await supabase
    .from('athletes')
    .select('*')
    .eq('active', true);
  
  if (error) {
    console.error('❌ Error fetching athletes:', error);
    return res.status(500).json({ error: error.message });
  }
  
  const results = [];
  
  // Update each athlete
  for (const athlete of athletes) {
    try {
      console.log(`📊 Updating ${athlete.name}...`);
      await refreshAthleteData(athlete.id, athlete.name, athlete.twitter_handle);
      results.push({ athlete: athlete.name, status: 'success' });
    } catch (err) {
      console.error(`❌ Error updating ${athlete.name}:`, err);
      results.push({ athlete: athlete.name, status: 'error', error: err.message });
    }
  }
  
  res.json({ 
    success: true, 
    updated: results.filter(r => r.status === 'success').length,
    failed: results.filter(r => r.status === 'error').length,
    results 
  });
});
```

**Configure Vercel Cron:**
Add to `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/cron/update",
    "schedule": "0 6 * * *"
  }]
}
```

This runs daily at 6 AM UTC.

**Test cron manually:**
```bash
curl https://your-app.vercel.app/api/cron/update
```

---

## 🎯 SUCCESS CRITERIA

**You're done when:**

✅ Backend deployed and accessible via URL
✅ All 4 APIs working (Twitter, Instagram, News, AWS)
✅ Data stored in Supabase (3 tables populated)
✅ Historical snapshots saving daily
✅ Elite dashboard displays real data across all 4 tabs:
   - Overview (score cards with perception details)
   - Temporal (historical comparison charts)
   - Alerts (threat level monitoring)
   - Intelligence (perception summary)
✅ Automated daily updates running
✅ Can add new athletes and data appears
✅ Alert system correctly identifies elevated/critical states

---

## 🔍 TESTING THE ELITE DASHBOARD

**The dashboard has 4 tabs - test each:**

**1. OVERVIEW Tab:**
- [ ] 7 score cards display with correct values
- [ ] Each card shows sparkline trend
- [ ] Click score card to expand perception details
- [ ] 30-day sentiment chart displays with threshold lines
- [ ] Platform performance section shows all 4 platforms

**2. TEMPORAL Tab:**
- [ ] Score evolution table shows current vs 7/14/30 days
- [ ] Trend indicators (up/down/stable) display correctly
- [ ] Radar chart compares current vs 30 days ago
- [ ] All 7 metrics visible on radar

**3. ALERTS Tab:**
- [ ] Active alerts display with correct severity
- [ ] Threshold configuration shows for all metrics
- [ ] Alert level calculated correctly (nominal/elevated/critical)
- [ ] Alert cards show actionable items

**4. INTELLIGENCE Tab:**
- [ ] Overall perception summary displays (4 paragraphs)
- [ ] Key metrics show (78% Twitter, 85% Instagram, etc.)
- [ ] Narrative intelligence cards display (3 insights)
- [ ] No peer comparison section (removed)

---

## 🚨 COMMON ISSUES & SOLUTIONS

**Issue: Netrows API 401 Unauthorized**
→ Check API key is correct from Dashboard, not Account Settings

**Issue: Instagram token expired**
→ Generate long-lived access token (60 days): https://developers.facebook.com/docs/instagram-basic-display-api/guides/long-lived-access-tokens

**Issue: AWS Comprehend permission denied**
→ Go to IAM → Attach policy "ComprehendFullAccess" to your user

**Issue: Supabase connection failed**
→ Check if project is paused (free tier). Wake it up in dashboard

**Issue: Historical data not appearing**
→ Wait 24-48 hours for snapshots to accumulate, or manually insert test data

**Issue: Vercel deployment timeout**
→ Cold start issue. Use Railway instead for better reliability

**Issue: CORS error in React**
→ Add to server.js: `const cors = require('cors'); app.use(cors());`

---

## 📧 DELIVERABLES

**When you're done, provide:**

1. **Backend URL** (deployed Vercel/Railway link)
2. **Test credentials** (if needed to access)
3. **Database access** (Supabase project shared OR exported SQL)
4. **Handover document** covering:
   - How to add new athletes
   - How to trigger manual refresh
   - How to check cron logs
   - Where API keys are stored
   - Any issues encountered
5. **Screen recording** (5-10 mins) showing:
   - All 4 dashboard tabs working
   - Data updating in real-time
   - Historical charts with multiple days of data
   - Alert system in action

---

## 📁 REFERENCE FILES

**Refer to these for detailed setup:**
- **SETUP_GUIDE.md** - Complete step-by-step instructions
- **API_RECOMMENDATIONS.md** - Why each API was chosen
- **athlete_backend_mvp.js** - Backend code to implement
- **elite_intelligence_dashboard.jsx** - Frontend to connect

---

## 🎯 KEY REMINDERS

1. **Historical tracking is critical** - The temporal tab won't work without daily snapshots
2. **Alert thresholds are hardcoded** - Sentiment <60 warning, <50 critical
3. **Perception details must match structure** - 7 metrics, each with summary + breakdown array
4. **Test for 3+ days** - Historical trends need multiple data points
5. **CORS must be enabled** - Frontend will fail without it

---

**You have everything you need to get started. Follow the SETUP_GUIDE.md for detailed API configuration, then implement the enhancements above. Good luck! 🚀**

---

**Questions? Check the documentation first, then reach out via Upwork.**

*Blue & Lintell Limited - Developer Implementation Guide v2.0*