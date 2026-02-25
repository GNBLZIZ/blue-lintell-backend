-- Blue & Lintell - Supabase schema
-- Run this entire file in Supabase Dashboard → SQL Editor → New query

-- Table 1: Athletes (master list of tracked athletes)
CREATE TABLE IF NOT EXISTS athletes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

-- Table 2: Athlete dashboards (current snapshot per athlete)
CREATE TABLE IF NOT EXISTS athlete_dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID REFERENCES athletes(id) ON DELETE CASCADE,
  athlete_name TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
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
  overall_alert_level TEXT DEFAULT 'nominal',
  perception_details JSONB,
  UNIQUE(athlete_id)
);

-- Table 3: Historical snapshots (for 7/14/30-day trends)
CREATE TABLE IF NOT EXISTS athlete_score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID REFERENCES athletes(id) ON DELETE CASCADE,
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_athlete_dashboards_athlete_id ON athlete_dashboards(athlete_id);
CREATE INDEX IF NOT EXISTS idx_athlete_dashboards_updated_at ON athlete_dashboards(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_athletes_active ON athletes(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_athlete_history_lookup ON athlete_score_history(athlete_id, snapshot_date);

-- Sample athletes (run once; omit if you add athletes manually)
INSERT INTO athletes (name, twitter_handle, sport, team, position, age)
VALUES ('Kieran Trippier', '@trippier2', 'Football', 'Newcastle United', 'Right-Back', 34);

-- Optional: real athlete for testing live Twitter/News data (run in SQL Editor if you want them in DB without Postman)
-- INSERT INTO athletes (name, twitter_handle, sport, team, position, age)
-- VALUES ('Marcus Rashford', '@MarcusRashford', 'Football', 'Manchester United', 'Forward', 26);
