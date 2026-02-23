# BLUE & LINTELL MVP BACKEND - SETUP GUIDE
## Complete Step-by-Step Instructions

---

## 📋 WHAT YOU'RE BUILDING

An automated backend that:
- ✅ Collects Twitter/X data (followers, tweets, mentions)
- ✅ Collects Instagram data (followers, posts, engagement)
- ✅ Searches news articles about athletes
- ✅ Analyzes sentiment using AI
- ✅ Calculates 7 reputation scores automatically
- ✅ Generates timeline of key events
- ✅ Updates daily at 6 AM automatically
- ✅ Stores everything in database
- ✅ Provides API for your React dashboard

**Time to Setup:** 2-3 hours
**Cost:** $49-78/month for 10 athletes

---

## 🔧 PREREQUISITES

### **Required:**
1. Node.js installed (v18 or higher)
2. npm or yarn package manager
3. Code editor (VS Code recommended)
4. Credit/debit card for API signups (some have free tiers)

### **Accounts Needed:**
- Netrows (Twitter data) - netrows.com
- Meta for Developers (Instagram) - developers.facebook.com
- NewsData.io (News) - newsdata.io
- AWS (Sentiment analysis) - aws.amazon.com
- Supabase (Database) - supabase.com

---

## 📦 STEP 1: PROJECT SETUP

### **1.1 Create Project Folder**
```bash
mkdir blue-lintell-backend
cd blue-lintell-backend
npm init -y
```

### **1.2 Install Dependencies**
```bash
npm install express axios dotenv @supabase/supabase-js @aws-sdk/client-comprehend node-cron cors
```

### **1.3 Create Files**
```bash
touch server.js
touch .env
touch .gitignore
```

### **1.4 Add to .gitignore**
```
node_modules/
.env
.env.local
*.log
```

---

## 🔑 STEP 2: GET API KEYS

### **2.1 Netrows (Twitter/X Data)**

**Signup:**
1. Go to netrows.com
2. Click "Get Started"
3. Choose "Starter" plan ($49/month)
4. Add payment details
5. Go to Dashboard → API Keys

**Get API Key:**
```
Dashboard → Settings → API Keys → Copy
```

**Save to .env:**
```
NETROWS_API_KEY=your_netrows_api_key_here
```

**Test with curl:**
```bash
curl "https://api.netrows.com/twitter/user?username=trippier2&apiKey=YOUR_KEY"
```

---

### **2.2 Meta Graph API (Instagram)**

**Setup (Free):**
1. Go to developers.facebook.com
2. Click "My Apps" → "Create App"
3. Choose "Business" type
4. Name it "Blue & Lintell Dashboard"
5. Add Instagram Graph API product

**Get Access Token:**
1. Go to Tools → Graph API Explorer
2. Select your app
3. Add permissions: `instagram_basic`, `instagram_manage_insights`
4. Click "Generate Access Token"
5. Copy the token

**Get Instagram Business ID:**
For each athlete:
1. They need Instagram Business/Creator account
2. Connected to Facebook Page
3. Get Business ID: `https://graph.instagram.com/me?fields=id&access_token=YOUR_TOKEN`

**Save to .env:**
```
INSTAGRAM_ACCESS_TOKEN=your_long_access_token_here
```

**Important:** Access tokens expire! You'll need to refresh them or use permanent tokens.

**Get Permanent Token:**
Follow: https://developers.facebook.com/docs/instagram-basic-display-api/guides/long-lived-access-tokens

---

### **2.3 NewsData.io (News Articles)**

**Signup:**
1. Go to newsdata.io
2. Click "Get Started Free"
3. Email confirmation
4. Go to Dashboard

**Get API Key:**
```
Dashboard → API Key → Copy
```

**Free Tier:**
- 200 credits/day
- Good for testing 5-10 athletes

**Upgrade Later:**
- Starter: $29/month (10,000 credits)
- Pro: $129/month (50,000 credits)

**Save to .env:**
```
NEWSDATA_API_KEY=your_newsdata_api_key_here
```

**Test:**
```bash
curl "https://newsdata.io/api/1/news?apikey=YOUR_KEY&q=footballer&language=en"
```

---

### **2.4 AWS (Sentiment Analysis)**

**Setup:**
1. Go to aws.amazon.com
2. Click "Create AWS Account"
3. Enter email, create password
4. Choose "Personal" account
5. Enter billing info (free tier available)
6. Complete verification

**Get Credentials:**
1. Sign in to AWS Console
2. Click your name (top right) → Security credentials
3. Scroll to "Access keys"
4. Click "Create access key"
5. Choose "Application running on AWS compute service"
6. Download .csv file

**Save to .env:**
```
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
AWS_REGION=us-east-1
```

**Enable Comprehend:**
1. Go to AWS Console → Services
2. Search "Comprehend"
3. Click "Get Started"
4. No additional setup needed

**Free Tier:**
- 50,000 units/month for 12 months
- Enough for 1,600 tweets/month or 500 articles/month

---

### **2.5 Supabase (Database)**

**Setup:**
1. Go to supabase.com
2. Click "Start your project"
3. Sign in with GitHub
4. Click "New project"
5. Name: "blue-lintell-db"
6. Database password: (save this!)
7. Region: Choose nearest (e.g., eu-west-1 for UK)
8. Click "Create project" (takes 2 mins)

**Get Credentials:**
1. Go to Project Settings → API
2. Copy "Project URL"
3. Copy "anon public" key

**Save to .env:**
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_anon_public_key_here
```

**Create Database Tables:**
1. Go to SQL Editor in Supabase
2. Click "New query"
3. Copy paste this SQL:

```sql
-- Athletes table
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
  created_at TIMESTAMP DEFAULT NOW()
);

-- Athlete dashboards table
CREATE TABLE athlete_dashboards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  athlete_id UUID REFERENCES athletes(id),
  athlete_name TEXT,
  updated_at TIMESTAMP DEFAULT NOW(),
  twitter_handle TEXT,
  twitter_followers INTEGER,
  instagram_followers INTEGER,
  sentiment_score INTEGER DEFAULT 70,
  credibility_score INTEGER DEFAULT 85,
  likeability_score INTEGER DEFAULT 75,
  leadership_score INTEGER DEFAULT 80,
  authenticity_score INTEGER DEFAULT 75,
  controversy_score INTEGER DEFAULT 30,
  relevance_score INTEGER DEFAULT 70,
  recent_tweets JSONB DEFAULT '[]',
  recent_news JSONB DEFAULT '[]',
  timeline_events JSONB DEFAULT '[]',
  total_mentions INTEGER DEFAULT 0,
  news_articles_count INTEGER DEFAULT 0,
  avg_tweet_engagement INTEGER DEFAULT 0,
  UNIQUE(athlete_id)
);

-- Create indexes for performance
CREATE INDEX idx_athlete_id ON athlete_dashboards(athlete_id);
CREATE INDEX idx_updated_at ON athlete_dashboards(updated_at DESC);
CREATE INDEX idx_active_athletes ON athletes(active) WHERE active = true;

-- Insert sample athlete (Kieran Trippier)
INSERT INTO athletes (name, twitter_handle, sport, team, position, age)
VALUES ('Kieran Trippier', '@trippier2', 'Football', 'Newcastle United', 'Right-Back', 35);
```

4. Click "Run" (bottom right)
5. You should see "Success. No rows returned"

---

## 📄 STEP 3: CREATE .ENV FILE

Create a file named `.env` in your project root with all your API keys:

```bash
# Netrows (Twitter/X data)
NETROWS_API_KEY=your_netrows_api_key_here

# Meta Graph API (Instagram)
INSTAGRAM_ACCESS_TOKEN=your_instagram_access_token_here

# NewsData.io (News articles)
NEWSDATA_API_KEY=your_newsdata_api_key_here

# AWS Comprehend (Sentiment analysis)
AWS_ACCESS_KEY_ID=your_aws_access_key_here
AWS_SECRET_ACCESS_KEY=your_aws_secret_key_here
AWS_REGION=us-east-1

# Supabase (Database)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_anon_public_key_here

# Server settings
PORT=3000
```

**Important:** Never commit .env to git!

---

## 🚀 STEP 4: RUN THE SERVER

### **4.1 Copy Backend Code**
Copy the `athlete_backend_mvp.js` file content into your `server.js`

### **4.2 Start Server**
```bash
node server.js
```

You should see:
```
🚀 Blue & Lintell Backend Server Started
📡 Server running on port 3000
🕒 Automated updates scheduled for 6 AM daily

📋 Available endpoints:
   GET  /api/athlete/:athleteId
   POST /api/athlete/refresh
   GET  /api/athletes
```

---

## 🧪 STEP 5: TEST THE SYSTEM

### **5.1 Get Athlete ID**
1. Go to Supabase → Table Editor → athletes
2. Copy the UUID of Kieran Trippier (or your test athlete)

### **5.2 Trigger Manual Update**

**Using curl:**
```bash
curl -X POST http://localhost:3000/api/athlete/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "athleteId": "paste-uuid-here",
    "athleteName": "Kieran Trippier",
    "twitterHandle": "@trippier2"
  }'
```

**Using Postman:**
1. Method: POST
2. URL: `http://localhost:3000/api/athlete/refresh`
3. Body (raw JSON):
```json
{
  "athleteId": "paste-uuid-here",
  "athleteName": "Kieran Trippier",
  "twitterHandle": "@trippier2"
}
```

### **5.3 Watch the Console**
You should see:
```
📊 Collecting data for Kieran Trippier...
🐦 Fetching Twitter data...
📷 Fetching Instagram data...
📰 Fetching news articles...
🤖 Analyzing sentiment...
📈 Calculating reputation scores...
📅 Generating timeline...
💾 Saving to database...
✅ Dashboard updated successfully!
```

### **5.4 Check Database**
1. Go to Supabase → Table Editor → athlete_dashboards
2. You should see a new row with all the data!

### **5.5 Get Dashboard Data**
```bash
curl http://localhost:3000/api/athlete/paste-uuid-here
```

You should get JSON with:
- Follower counts
- 7 reputation scores
- Recent tweets
- Recent news
- Timeline events

---

## 🔄 STEP 6: DEPLOY TO PRODUCTION

### **Option A: Vercel (Easiest, Free)**

1. Install Vercel CLI:
```bash
npm install -g vercel
```

2. Create `vercel.json`:
```json
{
  "version": 2,
  "builds": [
    {
      "src": "server.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "server.js"
    }
  ],
  "env": {
    "NETROWS_API_KEY": "@netrows-api-key",
    "INSTAGRAM_ACCESS_TOKEN": "@instagram-token",
    "NEWSDATA_API_KEY": "@newsdata-api-key",
    "AWS_ACCESS_KEY_ID": "@aws-access-key",
    "AWS_SECRET_ACCESS_KEY": "@aws-secret-key",
    "AWS_REGION": "us-east-1",
    "SUPABASE_URL": "@supabase-url",
    "SUPABASE_KEY": "@supabase-key"
  }
}
```

3. Deploy:
```bash
vercel
```

4. Add environment variables:
```bash
vercel env add NETROWS_API_KEY
# Paste your key, press enter
# Repeat for all variables
```

5. Done! You'll get a URL like: `https://blue-lintell.vercel.app`

---

### **Option B: Railway (Also Free, Better for cron)**

1. Go to railway.app
2. Sign in with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Connect your repo
5. Add environment variables in dashboard
6. Deploy!

**Advantage:** Supports cron jobs better than Vercel

---

### **Option C: AWS EC2 (More control, $10/month)**

1. Launch t2.micro instance (Ubuntu)
2. SSH into server
3. Install Node.js
4. Clone repo
5. Install PM2: `npm install -g pm2`
6. Run: `pm2 start server.js`
7. Setup nginx reverse proxy

**Good for:** Production with 50+ athletes

---

## 📅 STEP 7: SCHEDULE AUTOMATED UPDATES

The server already has a cron job that runs daily at 6 AM.

**To change schedule:**
Edit this line in `server.js`:
```javascript
cron.schedule('0 6 * * *', async () => {
```

**Cron patterns:**
- `'0 6 * * *'` = Every day at 6 AM
- `'0 */4 * * *'` = Every 4 hours
- `'*/30 * * * *'` = Every 30 minutes
- `'0 0 * * 0'` = Every Sunday at midnight

**For Vercel:** Use Vercel Cron (vercel.json):
```json
{
  "crons": [{
    "path": "/api/cron/update",
    "schedule": "0 6 * * *"
  }]
}
```

---

## 🔌 STEP 8: CONNECT TO REACT DASHBOARD

Update your React app to fetch from the backend:

```javascript
// In your React dashboard component
const [athleteData, setAthleteData] = useState(null);

useEffect(() => {
  async function fetchDashboard() {
    const response = await fetch(
      `https://your-backend.vercel.app/api/athlete/${athleteId}`
    );
    const data = await response.json();
    setAthleteData(data);
  }
  fetchDashboard();
}, [athleteId]);

// Now you can use athleteData instead of manual input!
```

---

## 💰 COST MONITORING

### **Track Your Usage:**

**Netrows:**
- Dashboard shows credit usage
- Alert at 80% usage

**NewsData.io:**
- Dashboard → Usage
- Upgrade before hitting limit

**AWS:**
- Billing Dashboard → Cost Explorer
- Set up billing alerts

**Monthly Budget:**
- Starter (10 athletes): $49-78/month
- Pro (50 athletes): $600-700/month

---

## 🐛 TROUBLESHOOTING

### **"Cannot find module" errors:**
```bash
npm install
```

### **"Unauthorized" from Twitter:**
- Check Netrows API key is correct
- Check credit balance

### **"Invalid access token" from Instagram:**
- Token may have expired
- Generate new long-lived token

### **"Rate limit exceeded":**
- Add delays between requests
- Upgrade API tier

### **Database connection failed:**
- Check Supabase URL and key
- Check if project is paused (free tier)

### **Sentiment analysis errors:**
- Check AWS credentials
- Check free tier hasn't expired
- Verify region is correct

---

## ✅ SUCCESS CHECKLIST

Before going live:

- [ ] All API keys working
- [ ] Database tables created
- [ ] Test athlete data collected successfully
- [ ] Scores calculating correctly
- [ ] Timeline generating events
- [ ] Dashboard endpoint returning data
- [ ] Cron job scheduled
- [ ] Deployed to production
- [ ] React dashboard connected
- [ ] Cost monitoring set up

---

## 📚 NEXT STEPS

### **Week 1-2:**
- Add 2-3 real athletes
- Monitor API costs
- Fine-tune score algorithms

### **Month 1:**
- Add all current clients
- Set up client accounts
- Begin charging

### **Month 2-3:**
- Implement real-time alerts (Twilio SMS)
- Add PDF report generation
- Build client portal

### **Month 6:**
- Add competitor benchmarking
- Implement predictive analytics
- Scale to Pro tier APIs

---

## 🆘 SUPPORT

**If stuck:**
1. Check the error message carefully
2. Verify all API keys in .env
3. Check API provider dashboards for issues
4. Review API documentation
5. Check rate limits and quotas

**Common issues solved:**
- 90% of errors = wrong API key
- 5% = rate limits
- 5% = network/timeout issues

---

**You're ready to build! 🚀**

**Total Monthly API Costs:** £68/month for 10 athletes