// BLUE & LINTELL - ATHLETE DASHBOARD BACKEND (Phase 1 MVP)
// Automated data collection from Twitter, Instagram, News, and Sentiment Analysis

/**
 * SETUP INSTRUCTIONS:
 * 
 * 1. Install dependencies:
 *    npm install express axios dotenv @supabase/supabase-js @aws-sdk/client-comprehend node-cron
 * 
 * 2. Create .env file with API keys:
 *    NETROWS_API_KEY=your_netrows_key
 *    INSTAGRAM_ACCESS_TOKEN=your_instagram_token
 *    NEWSDATA_API_KEY=your_newsdata_key
 *    AWS_ACCESS_KEY_ID=your_aws_key
 *    AWS_SECRET_ACCESS_KEY=your_aws_secret
 *    AWS_REGION=us-east-1
 *    SUPABASE_URL=your_supabase_url
 *    SUPABASE_KEY=your_supabase_key
 * 
 * 3. Run: node server.js
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const { ComprehendClient, DetectSentimentCommand, DetectEntitiesCommand } = require('@aws-sdk/client-comprehend');

const app = express();
app.use(express.json());

// ==================== CONFIGURATION ====================

const PORT = process.env.PORT || 3000;

// Initialize Supabase (database)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Initialize AWS Comprehend (sentiment analysis)
const comprehendClient = new ComprehendClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// ==================== TWITTER/X DATA (via Netrows) ====================

/**
 * Get Twitter user profile data
 * Cost: 1 credit per request
 */
async function getTwitterProfile(username) {
  try {
    const response = await axios.get('https://api.netrows.com/twitter/user', {
      params: {
        username: username.replace('@', ''),
        apiKey: process.env.NETROWS_API_KEY
      }
    });
    
    return {
      username: response.data.username,
      name: response.data.name,
      followers: response.data.followers_count,
      following: response.data.following_count,
      verified: response.data.verified,
      bio: response.data.description,
      profileImage: response.data.profile_image_url
    };
  } catch (error) {
    console.error(`Twitter profile error for ${username}:`, error.message);
    return null;
  }
}

/**
 * Get recent tweets from user
 * Cost: 5 credits per 20 tweets
 */
async function getRecentTweets(username, count = 20) {
  try {
    const response = await axios.get('https://api.netrows.com/twitter/user-tweets', {
      params: {
        username: username.replace('@', ''),
        count: count,
        apiKey: process.env.NETROWS_API_KEY
      }
    });
    
    return response.data.tweets.map(tweet => ({
      id: tweet.id,
      text: tweet.text,
      createdAt: tweet.created_at,
      likes: tweet.like_count,
      retweets: tweet.retweet_count,
      replies: tweet.reply_count,
      views: tweet.view_count
    }));
  } catch (error) {
    console.error(`Twitter tweets error for ${username}:`, error.message);
    return [];
  }
}

/**
 * Get mentions of user
 * Cost: 5 credits per 20 mentions
 */
async function getTwitterMentions(username, count = 20) {
  try {
    const response = await axios.get('https://api.netrows.com/twitter/mentions', {
      params: {
        username: username.replace('@', ''),
        count: count,
        apiKey: process.env.NETROWS_API_KEY
      }
    });
    
    return response.data.mentions;
  } catch (error) {
    console.error(`Twitter mentions error for ${username}:`, error.message);
    return [];
  }
}

// ==================== INSTAGRAM DATA (Meta Graph API) ====================

/**
 * Get Instagram profile data
 * Cost: FREE
 */
async function getInstagramProfile(instagramBusinessId) {
  try {
    const response = await axios.get(`https://graph.instagram.com/${instagramBusinessId}`, {
      params: {
        fields: 'username,name,followers_count,follows_count,media_count,biography,profile_picture_url',
        access_token: process.env.INSTAGRAM_ACCESS_TOKEN
      }
    });
    
    return {
      username: response.data.username,
      name: response.data.name,
      followers: response.data.followers_count,
      following: response.data.follows_count,
      posts: response.data.media_count,
      bio: response.data.biography,
      profileImage: response.data.profile_picture_url
    };
  } catch (error) {
    console.error(`Instagram profile error:`, error.message);
    return null;
  }
}

/**
 * Get recent Instagram posts with engagement
 * Cost: FREE
 */
async function getInstagramPosts(instagramBusinessId, limit = 10) {
  try {
    const response = await axios.get(`https://graph.instagram.com/${instagramBusinessId}/media`, {
      params: {
        fields: 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count',
        limit: limit,
        access_token: process.env.INSTAGRAM_ACCESS_TOKEN
      }
    });
    
    return response.data.data.map(post => ({
      id: post.id,
      caption: post.caption,
      type: post.media_type,
      url: post.media_url,
      permalink: post.permalink,
      timestamp: post.timestamp,
      likes: post.like_count,
      comments: post.comments_count
    }));
  } catch (error) {
    console.error(`Instagram posts error:`, error.message);
    return [];
  }
}

/**
 * Get Instagram insights (requires Business account)
 * Cost: FREE
 */
async function getInstagramInsights(instagramBusinessId) {
  try {
    const response = await axios.get(`https://graph.instagram.com/${instagramBusinessId}/insights`, {
      params: {
        metric: 'impressions,reach,profile_views',
        period: 'day',
        access_token: process.env.INSTAGRAM_ACCESS_TOKEN
      }
    });
    
    const insights = {};
    response.data.data.forEach(metric => {
      insights[metric.name] = metric.values[0].value;
    });
    
    return insights;
  } catch (error) {
    console.error(`Instagram insights error:`, error.message);
    return {};
  }
}

// ==================== NEWS DATA (NewsData.io) ====================

/**
 * Search for news articles about athlete
 * Cost: 1 credit per request
 */
async function searchNews(athleteName, daysBack = 7) {
  try {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - daysBack);
    
    const response = await axios.get('https://newsdata.io/api/1/news', {
      params: {
        apikey: process.env.NEWSDATA_API_KEY,
        q: athleteName,
        language: 'en',
        category: 'sports',
        from_date: fromDate.toISOString().split('T')[0],
        size: 50
      }
    });
    
    return response.data.results.map(article => ({
      title: article.title,
      description: article.description,
      content: article.content,
      url: article.link,
      source: article.source_id,
      publishedAt: article.pubDate,
      imageUrl: article.image_url,
      category: article.category,
      sentiment: article.sentiment // NewsData.io includes basic sentiment
    }));
  } catch (error) {
    console.error(`News search error for ${athleteName}:`, error.message);
    return [];
  }
}

// ==================== SENTIMENT ANALYSIS (AWS Comprehend) ====================

/**
 * Analyze sentiment of text
 * Cost: ~3 units per tweet (280 chars), ~10 units per news article (1000 chars)
 * $0.0001 per unit = $0.0003 per tweet, $0.001 per article
 */
async function analyzeSentiment(text, languageCode = 'en') {
  try {
    const command = new DetectSentimentCommand({
      Text: text.substring(0, 5000), // Max 5000 chars
      LanguageCode: languageCode
    });
    
    const response = await comprehendClient.send(command);
    
    return {
      sentiment: response.Sentiment, // POSITIVE, NEGATIVE, NEUTRAL, MIXED
      scores: {
        positive: response.SentimentScore.Positive,
        negative: response.SentimentScore.Negative,
        neutral: response.SentimentScore.Neutral,
        mixed: response.SentimentScore.Mixed
      }
    };
  } catch (error) {
    console.error('Sentiment analysis error:', error.message);
    return { sentiment: 'NEUTRAL', scores: { positive: 0, negative: 0, neutral: 1, mixed: 0 } };
  }
}

/**
 * Extract entities from text (people, organizations, locations)
 * Cost: Same as sentiment (~3 units per tweet)
 */
async function extractEntities(text, languageCode = 'en') {
  try {
    const command = new DetectEntitiesCommand({
      Text: text.substring(0, 5000),
      LanguageCode: languageCode
    });
    
    const response = await comprehendClient.send(command);
    
    return response.Entities.map(entity => ({
      text: entity.Text,
      type: entity.Type, // PERSON, ORGANIZATION, LOCATION, etc.
      score: entity.Score
    }));
  } catch (error) {
    console.error('Entity extraction error:', error.message);
    return [];
  }
}

/**
 * Calculate overall sentiment score from multiple texts
 */
function calculateOverallSentiment(sentimentResults) {
  if (!sentimentResults || sentimentResults.length === 0) return 50;
  
  let totalScore = 0;
  sentimentResults.forEach(result => {
    // Convert sentiment to 0-100 scale
    // Positive = 100, Neutral = 50, Negative = 0, Mixed = 50
    const score = (result.scores.positive * 100) + 
                 (result.scores.neutral * 50) + 
                 (result.scores.negative * 0) +
                 (result.scores.mixed * 50);
    totalScore += score;
  });
  
  return Math.round(totalScore / sentimentResults.length);
}

// ==================== SCORE CALCULATION ====================

/**
 * Calculate reputation scores based on collected data
 */
function calculateReputationScores(athleteData) {
  const { tweets, mentions, news, instagram } = athleteData;
  
  // Sentiment Score (from tweet and news sentiment)
  const tweetSentiments = tweets.map(t => t.sentiment);
  const newsSentiments = news.map(n => n.sentiment);
  const allSentiments = [...tweetSentiments, ...newsSentiments];
  const sentimentScore = calculateOverallSentiment(allSentiments);
  
  // Engagement Score (based on social media engagement)
  const twitterEngagement = tweets.reduce((sum, t) => sum + (t.likes + t.retweets + t.replies), 0);
  const instagramEngagement = instagram.posts.reduce((sum, p) => sum + (p.likes + p.comments), 0);
  const totalEngagement = twitterEngagement + instagramEngagement;
  
  // Credibility Score (based on verification, followers, media mentions)
  const credibilityScore = Math.min(100, Math.round(
    (tweets[0]?.verified ? 30 : 0) +
    (Math.log10(athleteData.profile.followers) * 10) +
    (news.length * 2)
  ));
  
  // Likeability Score (based on positive interactions)
  const likesRatio = twitterEngagement / Math.max(1, tweets.length);
  const likeabilityScore = Math.min(100, Math.round(likesRatio / 100));
  
  // Controversy Score (based on negative sentiment percentage)
  const negativeCount = allSentiments.filter(s => s.sentiment === 'NEGATIVE').length;
  const controversyScore = Math.round((negativeCount / Math.max(1, allSentiments.length)) * 100);
  
  // Relevance Score (based on mention frequency)
  const relevanceScore = Math.min(100, Math.round(
    (mentions.length * 2) +
    (news.length * 3) +
    (instagram.insights.impressions ? Math.log10(instagram.insights.impressions) * 5 : 0)
  ));
  
  return {
    sentimentScore,
    credibilityScore,
    likeabilityScore: Math.max(60, likeabilityScore), // Minimum 60
    leadershipScore: 75, // Default, would need manual input or analysis
    authenticityScore: 75, // Default, would need manual input or analysis
    controversyScore,
    relevanceScore
  };
}

// ==================== TIMELINE GENERATION ====================

/**
 * Generate timeline events from news and social media
 */
function generateTimeline(tweets, news) {
  const events = [];
  
  // Major tweet events (high engagement)
  tweets.forEach(tweet => {
    const totalEngagement = tweet.likes + tweet.retweets + tweet.replies;
    if (totalEngagement > 1000) { // High engagement threshold
      events.push({
        date: new Date(tweet.createdAt).toLocaleDateString('en-GB', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        }),
        platforms: 'TWITTER',
        title: tweet.text.substring(0, 100),
        description: `${tweet.likes.toLocaleString()} likes, ${tweet.retweets.toLocaleString()} retweets`,
        sentiment: tweet.sentiment?.sentiment || 'NEUTRAL'
      });
    }
  });
  
  // News events
  news.forEach(article => {
    events.push({
      date: new Date(article.publishedAt).toLocaleDateString('en-GB', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      }),
      platforms: 'NEWS MEDIA',
      title: article.title,
      description: article.description || article.content?.substring(0, 200),
      sentiment: article.sentiment?.sentiment || 'NEUTRAL'
    });
  });
  
  // Sort by date (most recent first)
  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  // Return top 10 most significant events
  return events.slice(0, 10);
}

// ==================== MAIN DATA COLLECTION FUNCTION ====================

/**
 * Collect all data for an athlete and update dashboard
 */
async function collectAthleteData(athleteId, athleteName, twitterHandle, instagramBusinessId) {
  console.log(`\n📊 Collecting data for ${athleteName}...`);
  
  try {
    // 1. Get Twitter data
    console.log('🐦 Fetching Twitter data...');
    const twitterProfile = await getTwitterProfile(twitterHandle);
    const tweets = await getRecentTweets(twitterHandle, 20);
    const mentions = await getTwitterMentions(twitterHandle, 20);
    
    // 2. Get Instagram data
    console.log('📷 Fetching Instagram data...');
    const instagramProfile = instagramBusinessId ? await getInstagramProfile(instagramBusinessId) : null;
    const instagramPosts = instagramBusinessId ? await getInstagramPosts(instagramBusinessId, 10) : [];
    const instagramInsights = instagramBusinessId ? await getInstagramInsights(instagramBusinessId) : {};
    
    // 3. Get News data
    console.log('📰 Fetching news articles...');
    const news = await searchNews(athleteName, 7); // Last 7 days
    
    // 4. Analyze sentiment for tweets
    console.log('🤖 Analyzing sentiment...');
    const tweetSentiments = await Promise.all(
      tweets.slice(0, 10).map(tweet => analyzeSentiment(tweet.text))
    );
    tweets.forEach((tweet, i) => {
      if (i < 10) tweet.sentiment = tweetSentiments[i];
    });
    
    // 5. Analyze sentiment for news
    const newsSentiments = await Promise.all(
      news.slice(0, 10).map(article => 
        analyzeSentiment(article.title + ' ' + (article.description || ''))
      )
    );
    news.forEach((article, i) => {
      if (i < 10) article.sentiment = newsSentiments[i];
    });
    
    // 6. Compile all data
    const athleteData = {
      profile: twitterProfile,
      tweets,
      mentions,
      instagram: {
        profile: instagramProfile,
        posts: instagramPosts,
        insights: instagramInsights
      },
      news
    };
    
    // 7. Calculate reputation scores
    console.log('📈 Calculating reputation scores...');
    const scores = calculateReputationScores(athleteData);
    
    // 8. Generate timeline
    console.log('📅 Generating timeline...');
    const timeline = generateTimeline(tweets, news);
    
    // 9. Save to database
    console.log('💾 Saving to database...');
    const dashboardData = {
      athlete_id: athleteId,
      athlete_name: athleteName,
      updated_at: new Date().toISOString(),
      
      // Profile data
      twitter_handle: twitterHandle,
      twitter_followers: twitterProfile?.followers,
      instagram_followers: instagramProfile?.followers,
      
      // Scores
      ...scores,
      
      // Detailed data
      recent_tweets: tweets.slice(0, 10),
      recent_news: news.slice(0, 10),
      timeline_events: timeline,
      
      // Metrics
      total_mentions: mentions.length,
      news_articles_count: news.length,
      avg_tweet_engagement: tweets.length > 0 
        ? Math.round(tweets.reduce((sum, t) => sum + (t.likes + t.retweets), 0) / tweets.length)
        : 0
    };
    
    // Insert or update in Supabase
    const { data, error } = await supabase
      .from('athlete_dashboards')
      .upsert(dashboardData, { onConflict: 'athlete_id' });
    
    if (error) {
      console.error('❌ Database error:', error);
    } else {
      console.log('✅ Dashboard updated successfully!');
    }
    
    return dashboardData;
    
  } catch (error) {
    console.error(`❌ Error collecting data for ${athleteName}:`, error);
    return null;
  }
}

// ==================== API ENDPOINTS ====================

/**
 * GET /api/athlete/:athleteId
 * Get dashboard data for specific athlete
 */
app.get('/api/athlete/:athleteId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('athlete_dashboards')
      .select('*')
      .eq('athlete_id', req.params.athleteId)
      .single();
    
    if (error) throw error;
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/athlete/refresh
 * Manually trigger data refresh for athlete
 */
app.post('/api/athlete/refresh', async (req, res) => {
  const { athleteId, athleteName, twitterHandle, instagramBusinessId } = req.body;
  
  if (!athleteId || !athleteName || !twitterHandle) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  try {
    const data = await collectAthleteData(athleteId, athleteName, twitterHandle, instagramBusinessId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/athletes
 * Get all athletes dashboards
 */
app.get('/api/athletes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('athlete_dashboards')
      .select('*')
      .order('updated_at', { ascending: false });
    
    if (error) throw error;
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== AUTOMATED DAILY UPDATES ====================

/**
 * Run daily at 6 AM to update all athletes
 */
cron.schedule('0 6 * * *', async () => {
  console.log('\n🔄 AUTOMATED DAILY UPDATE STARTED');
  console.log('Time:', new Date().toISOString());
  
  try {
    // Get all athletes from database
    const { data: athletes, error } = await supabase
      .from('athletes')
      .select('*')
      .eq('active', true);
    
    if (error) throw error;
    
    console.log(`📊 Updating ${athletes.length} athletes...`);
    
    // Update each athlete (with delay to avoid rate limits)
    for (const athlete of athletes) {
      await collectAthleteData(
        athlete.id,
        athlete.name,
        athlete.twitter_handle,
        athlete.instagram_business_id
      );
      
      // Wait 5 seconds between athletes to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    console.log('✅ AUTOMATED UPDATE COMPLETED');
  } catch (error) {
    console.error('❌ AUTOMATED UPDATE FAILED:', error);
  }
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
  console.log('\n🚀 Blue & Lintell Backend Server Started');
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🕒 Automated updates scheduled for 6 AM daily`);
  console.log('\n📋 Available endpoints:');
  console.log(`   GET  /api/athlete/:athleteId`);
  console.log(`   POST /api/athlete/refresh`);
  console.log(`   GET  /api/athletes`);
  console.log('\n');
});

// ==================== DATABASE SCHEMA (Supabase SQL) ====================

/**
 * Run this SQL in Supabase to create tables:
 * 
 * -- Athletes table
 * CREATE TABLE athletes (
 *   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   name TEXT NOT NULL,
 *   twitter_handle TEXT,
 *   instagram_business_id TEXT,
 *   sport TEXT,
 *   team TEXT,
 *   active BOOLEAN DEFAULT true,
 *   created_at TIMESTAMP DEFAULT NOW()
 * );
 * 
 * -- Athlete dashboards table
 * CREATE TABLE athlete_dashboards (
 *   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   athlete_id UUID REFERENCES athletes(id),
 *   athlete_name TEXT,
 *   updated_at TIMESTAMP,
 *   twitter_handle TEXT,
 *   twitter_followers INTEGER,
 *   instagram_followers INTEGER,
 *   sentiment_score INTEGER,
 *   credibility_score INTEGER,
 *   likeability_score INTEGER,
 *   leadership_score INTEGER,
 *   authenticity_score INTEGER,
 *   controversy_score INTEGER,
 *   relevance_score INTEGER,
 *   recent_tweets JSONB,
 *   recent_news JSONB,
 *   timeline_events JSONB,
 *   total_mentions INTEGER,
 *   news_articles_count INTEGER,
 *   avg_tweet_engagement INTEGER,
 *   UNIQUE(athlete_id)
 * );
 * 
 * -- Create indexes for performance
 * CREATE INDEX idx_athlete_id ON athlete_dashboards(athlete_id);
 * CREATE INDEX idx_updated_at ON athlete_dashboards(updated_at);
 */

module.exports = app; // For testing