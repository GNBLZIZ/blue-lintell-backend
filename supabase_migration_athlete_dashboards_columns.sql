-- Add missing athlete_dashboards columns (run in Supabase SQL Editor if you get
-- "Could not find the 'avg_comments_instagram' column" or similar)
ALTER TABLE athlete_dashboards ADD COLUMN IF NOT EXISTS avg_engagement_rate_twitter NUMERIC;
ALTER TABLE athlete_dashboards ADD COLUMN IF NOT EXISTS avg_engagement_rate_instagram NUMERIC;
ALTER TABLE athlete_dashboards ADD COLUMN IF NOT EXISTS avg_likes_twitter INTEGER;
ALTER TABLE athlete_dashboards ADD COLUMN IF NOT EXISTS avg_comments_retweets_twitter INTEGER;
ALTER TABLE athlete_dashboards ADD COLUMN IF NOT EXISTS avg_likes_instagram INTEGER;
ALTER TABLE athlete_dashboards ADD COLUMN IF NOT EXISTS avg_comments_instagram INTEGER;
ALTER TABLE athlete_dashboards ADD COLUMN IF NOT EXISTS recent_instagram_posts JSONB DEFAULT '[]';
ALTER TABLE athlete_dashboards ADD COLUMN IF NOT EXISTS engagement_aggregates JSONB;
