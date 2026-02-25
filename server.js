// BLUE & LINTELL - ATHLETE DASHBOARD BACKEND (Phase 1 MVP)
// Includes CORS, historical tracking, and /api/athlete/:id/history/:days (Milestone 1)

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { ComprehendClient, DetectSentimentCommand, DetectEntitiesCommand } = require('@aws-sdk/client-comprehend');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('⚠️ SUPABASE_URL or SUPABASE_KEY is missing. Set both in .env.');
}
if (SUPABASE_URL && !SUPABASE_URL.startsWith('https://')) {
  console.warn('⚠️ SUPABASE_URL should start with https:// (e.g. https://your-project.supabase.co)');
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const comprehendClient = new ComprehendClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// --- Twitter (Netrows) ---
async function getTwitterProfile(username) {
  try {
    const res = await axios.get('https://api.netrows.com/twitter/user', {
      params: { username: username.replace('@', ''), apiKey: process.env.NETROWS_API_KEY }
    });
    return { username: res.data.username, name: res.data.name, followers: res.data.followers_count, following: res.data.following_count, verified: res.data.verified, bio: res.data.description, profileImage: res.data.profile_image_url };
  } catch (e) { console.error('Twitter profile error:', e.message); return null; }
}

async function getRecentTweets(username, count = 20) {
  try {
    const res = await axios.get('https://api.netrows.com/twitter/user-tweets', {
      params: { username: username.replace('@', ''), count, apiKey: process.env.NETROWS_API_KEY }
    });
    return (res.data.tweets || []).map(t => ({ id: t.id, text: t.text, createdAt: t.created_at, likes: t.like_count, retweets: t.retweet_count, replies: t.reply_count, views: t.view_count }));
  } catch (e) { console.error('Twitter tweets error:', e.message); return []; }
}

async function getTwitterMentions(username, count = 20) {
  try {
    const res = await axios.get('https://api.netrows.com/twitter/mentions', {
      params: { username: username.replace('@', ''), count, apiKey: process.env.NETROWS_API_KEY }
    });
    return res.data.mentions || [];
  } catch (e) { console.error('Twitter mentions error:', e.message); return []; }
}

// --- Instagram ---
async function getInstagramProfile(instagramBusinessId) {
  try {
    const res = await axios.get(`https://graph.instagram.com/${instagramBusinessId}`, {
      params: { fields: 'username,name,followers_count,follows_count,media_count,biography,profile_picture_url', access_token: process.env.INSTAGRAM_ACCESS_TOKEN }
    });
    return { username: res.data.username, name: res.data.name, followers: res.data.followers_count, following: res.data.follows_count, posts: res.data.media_count, bio: res.data.biography, profileImage: res.data.profile_picture_url };
  } catch (e) { console.error('Instagram profile error:', e.message); return null; }
}

async function getInstagramPosts(instagramBusinessId, limit = 10) {
  try {
    const res = await axios.get(`https://graph.instagram.com/${instagramBusinessId}/media`, {
      params: { fields: 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count', limit, access_token: process.env.INSTAGRAM_ACCESS_TOKEN }
    });
    return (res.data.data || []).map(p => ({ id: p.id, caption: p.caption, type: p.media_type, url: p.media_url, permalink: p.permalink, timestamp: p.timestamp, likes: p.like_count, comments: p.comments_count }));
  } catch (e) { console.error('Instagram posts error:', e.message); return []; }
}

async function getInstagramInsights(instagramBusinessId) {
  try {
    const res = await axios.get(`https://graph.instagram.com/${instagramBusinessId}/insights`, {
      params: { metric: 'impressions,reach,profile_views', period: 'day', access_token: process.env.INSTAGRAM_ACCESS_TOKEN }
    });
    const o = {}; (res.data.data || []).forEach(m => { o[m.name] = m.values?.[0]?.value; }); return o;
  } catch (e) { console.error('Instagram insights error:', e.message); return {}; }
}

// --- News ---
async function searchNews(athleteName, daysBack = 7) {
  try {
    const fromDate = new Date(); fromDate.setDate(fromDate.getDate() - daysBack);
    const res = await axios.get('https://newsdata.io/api/1/news', {
      params: { apikey: process.env.NEWSDATA_API_KEY, q: athleteName, language: 'en', category: 'sports', from_date: fromDate.toISOString().split('T')[0], size: 50 }
    });
    return (res.data.results || []).map(a => ({ title: a.title, description: a.description, content: a.content, url: a.link, source: a.source_id, publishedAt: a.pubDate, imageUrl: a.image_url, category: a.category, sentiment: a.sentiment }));
  } catch (e) { console.error('News search error:', e.message); return []; }
}

// --- Sentiment (AWS) ---
async function analyzeSentiment(text, languageCode = 'en') {
  try {
    const cmd = new DetectSentimentCommand({ Text: text.substring(0, 5000), LanguageCode: languageCode });
    const res = await comprehendClient.send(cmd);
    return { sentiment: res.Sentiment, scores: { positive: res.SentimentScore.Positive, negative: res.SentimentScore.Negative, neutral: res.SentimentScore.Neutral, mixed: res.SentimentScore.Mixed } };
  } catch (e) { console.error('Sentiment error:', e.message); return { sentiment: 'NEUTRAL', scores: { positive: 0, negative: 0, neutral: 1, mixed: 0 } }; }
}

function calculateOverallSentiment(sentimentResults) {
  if (!sentimentResults || sentimentResults.length === 0) return 50;
  let total = 0;
  sentimentResults.forEach(r => { total += (r.scores.positive * 100) + (r.scores.neutral * 50) + (r.scores.negative * 0) + (r.scores.mixed * 50); });
  return Math.round(total / sentimentResults.length);
}

function calculateReputationScores(athleteData) {
  const { tweets, mentions, news, instagram } = athleteData;
  const tweetS = (tweets || []).map(t => t.sentiment);
  const newsS = (news || []).map(n => n.sentiment);
  const allS = [...tweetS, ...newsS];
  const sentimentScore = calculateOverallSentiment(allS);
  const followers = athleteData.profile?.followers || 1;
  const twitterEng = (tweets || []).reduce((s, t) => s + (t.likes + t.retweets + t.replies), 0);
  const instaPosts = instagram?.posts || [];
  const instaEng = instaPosts.reduce((s, p) => s + (p.likes + p.comments), 0);
  const credibilityScore = Math.min(100, Math.round((athleteData.profile?.verified ? 30 : 0) + (Math.log10(followers) * 10) + (news.length * 2)));
  const likeabilityScore = Math.max(60, Math.min(100, Math.round((twitterEng / Math.max(1, tweets.length)) / 100)));
  const negCount = allS.filter(s => s && s.sentiment === 'NEGATIVE').length;
  const controversyScore = Math.round((negCount / Math.max(1, allS.length)) * 100);
  const relevanceScore = Math.min(100, Math.round((mentions.length * 2) + (news.length * 3) + (instagram?.insights?.impressions ? Math.log10(instagram.insights.impressions) * 5 : 0)));
  return { sentimentScore, credibilityScore, likeabilityScore, leadershipScore: 75, authenticityScore: 75, controversyScore, relevanceScore };
}

function calculateAlertLevel(data) {
  const s = data.sentiment_score ?? 70, c = data.controversy_score ?? 30;
  if (s < 50 || c > 40) return 'critical';
  if (s < 60 || c > 30) return 'elevated';
  return 'nominal';
}

async function saveHistoricalSnapshot(athleteId, dashboardData) {
  const today = new Date().toISOString().split('T')[0];
  const { data: existing } = await supabase.from('athlete_score_history').select('id').eq('athlete_id', athleteId).eq('snapshot_date', today).maybeSingle();
  if (existing) return { data: existing, error: null };
  const row = { athlete_id: athleteId, snapshot_date: today, sentiment_score: dashboardData.sentiment_score, credibility_score: dashboardData.credibility_score, likeability_score: dashboardData.likeability_score, leadership_score: dashboardData.leadership_score, authenticity_score: dashboardData.authenticity_score, controversy_score: dashboardData.controversy_score, relevance_score: dashboardData.relevance_score, twitter_followers: dashboardData.twitter_followers, instagram_followers: dashboardData.instagram_followers, news_mentions: dashboardData.total_mentions ?? dashboardData.news_articles_count ?? 0, overall_alert_level: calculateAlertLevel(dashboardData) };
  const { data, error } = await supabase.from('athlete_score_history').insert(row).select().single();
  if (error) { console.error('Snapshot error:', error.message); return { data: null, error }; }
  console.log('✅ Historical snapshot saved');
  return { data, error: null };
}

function generateTimeline(tweets, news) {
  const events = [];
  (tweets || []).forEach(t => { const eng = t.likes + t.retweets + t.replies; if (eng > 1000) events.push({ date: new Date(t.createdAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }), platforms: 'TWITTER', title: t.text.substring(0, 100), description: `${t.likes.toLocaleString()} likes, ${t.retweets.toLocaleString()} retweets`, sentiment: t.sentiment?.sentiment || 'NEUTRAL' }); });
  (news || []).forEach(a => events.push({ date: new Date(a.publishedAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }), platforms: 'NEWS MEDIA', title: a.title, description: a.description || (a.content || '').substring(0, 200), sentiment: a.sentiment?.sentiment || 'NEUTRAL' }));
  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  return events.slice(0, 10);
}

async function collectAthleteData(athleteId, athleteName, twitterHandle, instagramBusinessId) {
  console.log('\n📊 Collecting data for', athleteName);
  try {
    console.log('🐦 Twitter...');
    const twitterProfile = await getTwitterProfile(twitterHandle);
    const tweets = await getRecentTweets(twitterHandle, 20);
    const mentions = await getTwitterMentions(twitterHandle, 20);
    console.log('📷 Instagram...');
    const instagramProfile = instagramBusinessId ? await getInstagramProfile(instagramBusinessId) : null;
    const instagramPosts = instagramBusinessId ? await getInstagramPosts(instagramBusinessId, 10) : [];
    const instagramInsights = instagramBusinessId ? await getInstagramInsights(instagramBusinessId) : {};
    console.log('📰 News...');
    const news = await searchNews(athleteName, 7);
    console.log('🤖 Sentiment...');
    const tweetSents = await Promise.all(tweets.slice(0, 10).map(t => analyzeSentiment(t.text)));
    tweets.forEach((t, i) => { if (i < 10) t.sentiment = tweetSents[i]; });
    const newsSents = await Promise.all(news.slice(0, 10).map(a => analyzeSentiment(a.title + ' ' + (a.description || ''))));
    news.forEach((a, i) => { if (i < 10) a.sentiment = newsSents[i]; });
    const athleteData = { profile: twitterProfile, tweets, mentions, instagram: { profile: instagramProfile, posts: instagramPosts, insights: instagramInsights }, news };
    console.log('📈 Scores...');
    const scores = calculateReputationScores(athleteData);
    const timeline = generateTimeline(tweets, news);
    // Use snake_case for DB columns (schema expects sentiment_score, not sentimentScore)
    const dashboardData = {
      athlete_id: athleteId,
      athlete_name: athleteName,
      updated_at: new Date().toISOString(),
      twitter_handle: twitterHandle,
      twitter_followers: twitterProfile?.followers ?? null,
      instagram_followers: instagramProfile?.followers ?? null,
      sentiment_score: scores.sentimentScore,
      credibility_score: scores.credibilityScore,
      likeability_score: scores.likeabilityScore,
      leadership_score: scores.leadershipScore,
      authenticity_score: scores.authenticityScore,
      controversy_score: scores.controversyScore,
      relevance_score: scores.relevanceScore,
      recent_tweets: tweets.slice(0, 10),
      recent_news: news.slice(0, 10),
      timeline_events: timeline,
      total_mentions: mentions.length,
      news_articles_count: news.length,
      avg_tweet_engagement: tweets.length ? Math.round(tweets.reduce((s, t) => s + t.likes + t.retweets, 0) / tweets.length) : 0
    };
    dashboardData.overall_alert_level = calculateAlertLevel(dashboardData);
    console.log('💾 Saving...');
    const { error } = await supabase.from('athlete_dashboards').upsert(dashboardData, { onConflict: 'athlete_id' });
    if (error) { console.error('❌ DB error:', error.message); return null; }
    console.log('✅ Dashboard updated');
    await saveHistoricalSnapshot(athleteId, dashboardData);
    return dashboardData;
  } catch (e) { console.error('❌ Error:', e); return null; }
}

app.get('/api/health', (req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));
// List athletes from master table (use this to get athleteId for /api/athlete/refresh when you don't have dashboard access)
app.get('/api/athletes/list', async (req, res) => {
  try {
    const { data, error } = await supabase.from('athletes').select('id, name, twitter_handle, instagram_business_id').eq('active', true).order('name');
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Create a new athlete (for seeding / testing via Postman)
app.post('/api/athletes', async (req, res) => {
  const { name, twitter_handle, instagram_business_id, sport, team, position, age } = req.body;
  if (!name || !twitter_handle) return res.status(400).json({ error: 'Missing required fields: name, twitter_handle' });
  try {
    const row = { name, twitter_handle, instagram_business_id: instagram_business_id || null, sport: sport || 'Football', team: team || null, position: position || null, age: age != null ? parseInt(age, 10) : null };
    const { data, error } = await supabase.from('athletes').insert(row).select('id, name, twitter_handle, instagram_business_id, sport, team, position, age').single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/athlete/:athleteId', async (req, res) => {
  try {
    const { data, error } = await supabase.from('athlete_dashboards').select('*').eq('athlete_id', req.params.athleteId).single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/athlete/:athleteId/history/:days', async (req, res) => {
  try {
    const daysNum = Math.min(30, Math.max(1, parseInt(req.params.days, 10) || 7));
    const fromStr = new Date(Date.now() - daysNum * 86400000).toISOString().split('T')[0];
    const { data, error } = await supabase.from('athlete_score_history').select('*').eq('athlete_id', req.params.athleteId).gte('snapshot_date', fromStr).order('snapshot_date', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/athlete/refresh', async (req, res) => {
  const { athleteId, athleteName, twitterHandle, instagramBusinessId } = req.body;
  if (!athleteId || !athleteName || !twitterHandle) return res.status(400).json({ error: 'Missing required fields: athleteId, athleteName, twitterHandle' });
  try {
    const data = await collectAthleteData(athleteId, athleteName, twitterHandle, instagramBusinessId || null);
    res.json({ success: !!data, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/athletes', async (req, res) => {
  try {
    const { data, error } = await supabase.from('athlete_dashboards').select('*').order('updated_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Daily job (used by in-process cron and by HTTP trigger for production) ---
async function runDailyUpdate() {
  console.log('\n🔄 DAILY UPDATE');
  try {
    const { data: athletes, error } = await supabase.from('athletes').select('*').eq('active', true);
    if (error) throw error;
    for (const a of athletes || []) {
      await collectAthleteData(a.id, a.name, a.twitter_handle, a.instagram_business_id);
      await new Promise(r => setTimeout(r, 5000));
    }
    console.log('✅ Daily update done');
    return { success: true, updated: (athletes || []).length };
  } catch (e) {
    console.error('❌ Daily update failed:', e);
    throw e;
  }
}

// In-process cron: runs daily at 06:00 server time
cron.schedule('0 6 * * *', runDailyUpdate);

// HTTP-triggered cron: for production hosts that sleep (e.g. Render). Call from cron-job.org or similar.
// Secured by CRON_SECRET in env. Example: GET /api/cron/daily?secret=your-secret
app.get('/api/cron/daily', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.query.secret !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await runDailyUpdate();
    res.json(result);
  } catch (e) {
    const msg = e.message || String(e);
    const hint = (msg.includes('ENOTFOUND') || msg.includes('fetch failed')) && process.env.SUPABASE_URL
      ? ' Check SUPABASE_URL in .env (use https://your-project.supabase.co from Supabase Dashboard → Project Settings → API).'
      : '';
    res.status(500).json({ error: msg + hint });
  }
});

app.listen(PORT, () => {
  console.log('\n🚀 Blue & Lintell Backend on port', PORT);
  console.log('   GET /api/health  GET /api/athletes/list  POST /api/athletes  GET /api/athlete/:id  GET /api/athlete/:id/history/:days  POST /api/athlete/refresh  GET /api/athletes  GET /api/cron/daily\n');
});

module.exports = app;
