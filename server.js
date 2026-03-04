// BLUE & LINTELL - ATHLETE DASHBOARD BACKEND (Phase 1 MVP)
// Includes CORS, historical tracking, and /api/athlete/:id/history/:days (Milestone 1)
// HYBRID SCANDAL DETECTION: NewsData.io + NewsAPI.org (tabloids) + Twitter scanning

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

// --- Apify (Twitter + Instagram) - replaces Netrows and Meta Instagram Graph API ---
const APIFY_TOKEN = process.env.APIFY_API_TOKEN || '';
if (!APIFY_TOKEN) {
  console.warn('⚠️ APIFY_API_TOKEN is missing. Twitter and Instagram data collection will fail.');
}

function logApiError(prefix, e) {
  const status = e.response?.status;
  const body = e.response?.data;
  if (status != null || body != null) {
    console.error(prefix, status != null ? `status ${status}` : '', body != null ? JSON.stringify(body) : e.message);
  } else {
    console.error(prefix, e.message);
  }
}

/** Run an Apify actor synchronously and return dataset items (JSON). See https://docs.apify.com/api/v2 */
async function apifyRunSync(actorId, input, options = {}) {
  if (!APIFY_TOKEN) return [];
  const timeout = options.timeout ?? 120;
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}&format=json&timeout=${timeout}`;
  try {
    const res = await axios.post(url, input, {
      headers: { 'Content-Type': 'application/json' },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: (timeout + 10) * 1000
    });
    return Array.isArray(res.data) ? res.data : [];
  } catch (e) {
    logApiError(`Apify ${actorId}:`, e);
    return [];
  }
}

// --- Twitter via Apify apidojo/tweet-scraper (replaces Netrows) ---
const APIFY_TWEET_SCRAPER = 'apidojo~tweet-scraper';

async function getTwitterProfile(username) {
  const handle = username.replace('@', '');
  const items = await apifyRunSync(APIFY_TWEET_SCRAPER, {
    twitterHandles: [handle],
    maxItems: 5,
    sort: 'Latest'
  }, { timeout: 90 });
  if (!items.length) return null;
  const first = items[0];
  // Apify may return user object first (type 'user') or tweet with nested user
  const isUserObj = first.type === 'user' || (first.followers != null && first.full_text == null && first.text == null);
  const user = isUserObj ? first : (first.user ?? first.author ?? first);
  // Apify apidojo/tweet-scraper: user object may have followers_count, public_metrics.followers_count, or followers
  const followersRaw = user.followers_count ?? user.public_metrics?.followers_count ?? user.followers ?? user.followersCount ?? 0;
  const followingRaw = user.following_count ?? user.public_metrics?.following_count ?? user.following ?? user.followingCount ?? 0;
  const followers = typeof followersRaw === 'number' ? followersRaw : parseInt(followersRaw, 10) || 0;
  const following = typeof followingRaw === 'number' ? followingRaw : parseInt(followingRaw, 10) || 0;
  return {
    username: user.userName ?? user.username ?? user.screen_name ?? handle,
    name: user.name ?? user.username ?? user.userName ?? handle,
    followers,
    following,
    verified: user.isBlueVerified ?? user.verified ?? user.verified_user ?? false,
    bio: user.description ?? user.bio ?? '',
    profileImage: user.profilePicture ?? user.profile_image_url_https ?? user.profile_image_url ?? user.avatar ?? null
  };
}

async function getRecentTweets(username, count = 20) {
  const handle = username.replace('@', '');
  const items = await apifyRunSync(APIFY_TWEET_SCRAPER, {
    twitterHandles: [handle],
    maxItems: Math.min(count, 100),
    sort: 'Latest'
  }, { timeout: 120 });
  const list = Array.isArray(items) ? items : [];
  // Apify can return user/profile objects first; skip items that are clearly not tweets (no content, no tweet id)
  const tweetsOnly = list.filter(t => {
    if (t.type === 'user') return false;
    const text = t.full_text ?? t.text ?? t.content ?? '';
    const hasContent = typeof text === 'string' && text.trim().length > 0;
    const hasTweetId = t.tweet_id ?? t.id_str ?? t.id;
    return hasContent || hasTweetId;
  });
  return tweetsOnly.map(t => ({
    id: t.id ?? t.tweet_id ?? t.id_str,
    text: t.full_text ?? t.text ?? t.content ?? '',
    createdAt: t.created_at ?? t.createdAt ?? t.date ?? t.created,
    likes: t.likeCount ?? t.likes ?? t.favorite_count ?? t.like_count ?? 0,
    retweets: t.retweetCount ?? t.retweets ?? t.retweet_count ?? 0,
    replies: t.replyCount ?? t.replies ?? t.reply_count ?? 0,
    views: t.viewCount ?? t.views ?? t.view_count ?? 0
  })).map(t => ({
    ...t,
    likes: Number(t.likes) || 0,
    retweets: Number(t.retweets) || 0,
    replies: Number(t.replies) || 0,
    views: Number(t.views) || 0
  }));
}

async function getTwitterMentions(username, count = 20) {
  const handle = username.replace('@', '');
  const items = await apifyRunSync(APIFY_TWEET_SCRAPER, {
    searchTerms: [`@${handle}`],
    maxItems: Math.min(count, 100),
    sort: 'Latest'
  }, { timeout: 120 });
  return Array.isArray(items) ? items : [];
}

// --- Instagram via Apify apify/instagram-profile-scraper (replaces Meta Graph API) ---
const APIFY_INSTAGRAM_SCRAPER = 'apify~instagram-profile-scraper';

/**
 * Resolve Instagram identifier to username for Apify.
 * Apify expects username (e.g. mosalah), not Meta numeric ID (e.g. 27298082519781975).
 * - Accepts: username, @username, or profile URL (https://www.instagram.com/username/).
 * - If value is purely numeric (old Meta Business ID), returns '' and skips Instagram (logs once).
 * - Fallback: INSTAGRAM_USER_ID env (use a username only; numeric ID will be rejected and Instagram skipped).
 */
function resolveInstagramUsername(instagramBusinessId) {
  const fromAthlete = (instagramBusinessId && String(instagramBusinessId).trim()) || '';
  const fromEnv = (process.env.INSTAGRAM_USER_ID && String(process.env.INSTAGRAM_USER_ID).trim()) || '';
  const v = fromAthlete || fromEnv;
  const raw = v.replace('@', '').trim();
  if (!raw) return '';

  // Extract username from Instagram profile URL if present
  const urlMatch = raw.match(/instagram\.com\/([^/?]+)/i);
  const candidate = urlMatch ? urlMatch[1] : raw;

  // Apify does not accept numeric IDs; only usernames (letters, numbers, underscores, dots)
  const isNumericId = /^\d+$/.test(candidate);
  if (isNumericId) {
    const source = fromAthlete ? 'athlete record' : 'INSTAGRAM_USER_ID env';
    console.warn(`⚠️ Instagram skipped: ${source} is a numeric ID. Apify needs username (e.g. mosalah). Use Instagram username in athletes.instagram_business_id and in .env INSTAGRAM_USER_ID if set.`);
    return '';
  }

  return candidate;
}

async function getInstagramProfile(instagramBusinessId) {
  const username = resolveInstagramUsername(instagramBusinessId);
  if (!username) return null;
  try {
    // Official apify/instagram-profile-scraper input: { usernames: string[] }. No resultsLimit.
    const input = { usernames: [username] };
    const items = await apifyRunSync(APIFY_INSTAGRAM_SCRAPER, input, { timeout: 120 });
    const raw = items && items[0] ? items[0] : null;
    if (!raw) {
      console.warn('📷 Instagram profile: Apify returned no items for username', username);
      return null;
    }
    // Apify output: followersCount, followsCount, postsCount, username, fullName, profilePicUrl
    const followersRaw = raw.followersCount ?? raw.followers ?? raw.edge_followed_by?.count ?? 0;
    const followingRaw = raw.followsCount ?? raw.following ?? raw.edge_follow ?? 0;
    const followers = typeof followersRaw === 'number' ? followersRaw : parseInt(followersRaw, 10) || 0;
    const following = typeof followingRaw === 'number' ? followingRaw : parseInt(followingRaw, 10) || 0;
    const profile = {
      username: raw.username ?? raw.fullName ?? raw.full_name ?? username,
      name: raw.fullName ?? raw.full_name ?? raw.username ?? username,
      followers,
      following,
      posts: raw.postsCount ?? raw.mediaCount ?? raw.edge_owner_to_timeline_media?.count ?? 0,
      bio: raw.biography ?? raw.bio ?? '',
      profileImage: raw.profilePicUrl ?? raw.profilePicUrlHD ?? raw.profile_picture_url ?? raw.profile_pic_url ?? null
    };
    if (followers > 0 || profile.username) console.log('📷 Instagram profile OK:', profile.username, followers, 'followers');
    return profile;
  } catch (e) {
    logApiError('Instagram profile error:', e);
    return null;
  }
}

async function getInstagramPosts(instagramBusinessId, limit = 10) {
  const username = resolveInstagramUsername(instagramBusinessId);
  if (!username) return [];
  try {
    const input = { usernames: [username] };
    const items = await apifyRunSync(APIFY_INSTAGRAM_SCRAPER, input, { timeout: 120 });
    const raw = items && items[0] ? items[0] : null;
    const posts = raw?.latestPosts ?? raw?.latest_posts ?? raw?.posts ?? [];
    const list = Array.isArray(posts) ? posts.slice(0, limit) : [];
    const mapped = list.map(p => ({
      id: p.id ?? p.shortCode,
      caption: p.caption ?? p.captionText ?? '',
      type: p.type ?? p.mediaType ?? 'IMAGE',
      url: p.displayUrl ?? p.url ?? p.mediaUrl ?? null,
      permalink: p.url ?? p.permalink ?? null,
      timestamp: p.timestamp ?? p.takenAt ?? p.createdAt,
      likes: Number(p.likesCount ?? p.likes ?? 0) || 0,
      comments: Number(p.commentsCount ?? p.comments ?? 0) || 0
    }));
    if (mapped.length > 0) console.log('📷 Instagram posts:', mapped.length, 'for', username);
    else if (raw && !raw.latestPosts?.length) console.warn('📷 Instagram posts: profile has no latestPosts for', username);
    return mapped;
  } catch (e) {
    logApiError('Instagram posts error:', e);
    return [];
  }
}

async function getInstagramInsights(instagramBusinessId) {
  const username = resolveInstagramUsername(instagramBusinessId);
  if (!username) return {};
  try {
    const input = { usernames: [username] };
    const items = await apifyRunSync(APIFY_INSTAGRAM_SCRAPER, input, { timeout: 120 });
    const raw = items && items[0] ? items[0] : null;
    if (!raw) return {};
    return {
      impressions: raw.impressions ?? null,
      reach: raw.reach ?? null,
      profile_views: raw.profileViews ?? null
    };
  } catch (e) {
    return {};
  }
}

// --- News (NewsData.io) - apikey + q + language (required); avoid unsupported params that cause 422 ---
async function searchNews(athleteName, daysBack = 7, country, sport = 'football') {
  try {
    const q = (athleteName || '').trim();
    if (q.length < 3) return [];
    
    // Add sport context to disambiguate common names (e.g. "Anthony Gordon football" vs basketball player)
    const searchQuery = sport ? `${q} ${sport}` : q;
    
    const res = await axios.get('https://newsdata.io/api/1/news', {
      params: {
        apikey: process.env.NEWSDATA_API_KEY,
        q: searchQuery,
        language: 'en',
        ...(country ? { country } : {})
      }
    });
    return (res.data.results || []).map(a => ({ title: a.title, description: a.description, content: a.content, url: a.link, source: a.source_id, publishedAt: a.pubDate, imageUrl: a.image_url, category: a.category, sentiment: a.sentiment }));
  } catch (e) {
    logApiError('News search error:', e);
    return [];
  }
}

// --- NewsAPI.org for tabloid/scandal coverage (Free tier: 100 requests/day) ---
const NEWSAPI_KEY = process.env.NEWSAPI_KEY || '';
let newsApiRequestCount = 0;
const NEWS_API_DAILY_LIMIT = 100;

async function searchNewsAPI(athleteName, daysBack = 30) {
  if (!NEWSAPI_KEY) {
    console.log('⚠️  NewsAPI.org key not set - skipping tabloid search. Add NEWSAPI_KEY to Railway environment variables.');
    return [];
  }
  if (newsApiRequestCount >= NEWS_API_DAILY_LIMIT) {
    console.warn(`⚠️  NewsAPI.org daily limit reached (${NEWS_API_DAILY_LIMIT} requests). Consider upgrading to paid tier ($49/month) for unlimited requests.`);
    return [];
  }
  try {
    const q = (athleteName || '').trim();
    if (q.length < 3) return [];
    const toDate = new Date();
    const fromDate = new Date(Date.now() - daysBack * 86400000);
    const from = fromDate.toISOString().split('T')[0];
    const to = toDate.toISOString().split('T')[0];
    newsApiRequestCount++;
    console.log(`📰 NewsAPI.org request ${newsApiRequestCount}/${NEWS_API_DAILY_LIMIT} (Free tier)`);
    const res = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        apiKey: NEWSAPI_KEY,
        q,
        language: 'en',
        from,
        to,
        sortBy: 'publishedAt',
        pageSize: 20
      },
      timeout: 10000
    });
    if (res.data.status === 'ok' && res.data.articles) {
      const articles = res.data.articles.map(a => ({
        title: a.title,
        description: a.description,
        content: a.content,
        url: a.url,
        source: a.source?.name || 'Unknown',
        publishedAt: a.publishedAt,
        imageUrl: a.urlToImage,
        category: ['sports'],
        sentiment: null
      }));
      console.log(`📰 NewsAPI.org found ${articles.length} articles from tabloid sources`);
      return articles;
    }
    return [];
  } catch (e) {
    if (e.response?.status === 429) {
      console.error('⚠️  NewsAPI.org rate limit hit! Upgrade to paid tier ($49/month) for unlimited requests.');
    } else {
      logApiError('NewsAPI.org search error:', e);
    }
    return [];
  }
}

// --- Twitter mention scandal detection ---
function scanTwitterForScandals(tweets, brandRiskKeywords) {
  const scandalSignals = [];
  tweets.forEach(tweet => {
    const text = (tweet.text || '').toLowerCase();
    const matchedKeywords = brandRiskKeywords.filter(keyword => 
      text.includes(keyword.toLowerCase())
    );
    if (matchedKeywords.length > 0) {
      scandalSignals.push({
        text: tweet.text,
        keywords: matchedKeywords,
        likes: tweet.likes || 0,
        retweets: tweet.retweets || 0,
        date: tweet.createdAt,
        engagement: (tweet.likes || 0) + (tweet.retweets || 0)
      });
    }
  });
  scandalSignals.sort((a, b) => b.engagement - a.engagement);
  return scandalSignals.slice(0, 5);
}

// --- Sentiment (AWS) ---
const NEUTRAL_FALLBACK = { sentiment: 'NEUTRAL', scores: { positive: 0, negative: 0, neutral: 1, mixed: 0 } };

async function analyzeSentiment(text, languageCode = 'en') {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed || trimmed.length < 1) return NEUTRAL_FALLBACK;
  try {
    const cmd = new DetectSentimentCommand({ Text: trimmed.substring(0, 5000), LanguageCode: languageCode });
    const res = await comprehendClient.send(cmd);
    return { sentiment: res.Sentiment, scores: { positive: res.SentimentScore.Positive, negative: res.SentimentScore.Negative, neutral: res.SentimentScore.Neutral, mixed: res.SentimentScore.Mixed } };
  } catch (e) {
    if (e.message && e.message.includes('subscription')) {
      console.error('Sentiment error: AWS Comprehend not enabled for this account. Enable it in AWS Console → Comprehend, or check IAM/subscription.');
    } else {
      console.error('Sentiment error:', e.message);
    }
    return { sentiment: 'NEUTRAL', scores: { positive: 0, negative: 0, neutral: 1, mixed: 0 } };
  }
}

function calculateOverallSentiment(sentimentResults) {
  const valid = (sentimentResults || []).filter(r => r && r.scores);
  if (valid.length === 0) return 50;
  let total = 0;
  valid.forEach(r => { total += (r.scores.positive * 100) + (r.scores.neutral * 50) + (r.scores.negative * 0) + (r.scores.mixed * 50); });
  return Math.round(total / valid.length);
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
  
  // RECALIBRATED CREDIBILITY SCORE (more discriminating) - AGGRESSIVE CAPS
  // Components: verification (10), follower reach (max 30), news quality (max 20), engagement quality (max 15)
  const verificationBonus = athleteData.profile?.verified ? 10 : 0;
  
  // Follower reach: logarithmic but capped at 30 (reduced from 40)
  const followerScore = Math.min(30, Math.log10(followers) * 8);
  
  // News quality: weight by count but cap at 20 (reduced from 25)
  const newsScore = Math.min(20, news.length * 2.5);
  
  // Engagement quality: high follower count but low engagement = penalty
  const totalFollowers = followers + (instagram?.profile?.followers || 0);
  const totalEngagement = twitterEng + instaEng;
  const totalPosts = tweets.length + instaPosts.length;
  const avgEngagement = totalPosts > 0 ? totalEngagement / totalPosts : 0;
  const engagementRate = totalFollowers > 0 ? (avgEngagement / totalFollowers) * 100 : 0;
  const engagementScore = Math.min(15, engagementRate * 400); // 0.0375% = 15 points (reduced from 20)
  
  // Controversy penalty: high controversy reduces credibility (increased penalty)
  const validS = allS.filter(s => s && s.scores);
  const negRatio = validS.length === 0 ? 0 : validS.reduce((sum, s) => sum + (s.scores.negative || 0) + (s.scores.mixed || 0) * 0.4, 0) / validS.length;
  const controversyPenalty = Math.round(negRatio * 20); // Up to -20 points for high controversy (increased from -15)
  
  const credibilityScore = Math.max(30, Math.min(100, Math.round(
    verificationBonus + followerScore + newsScore + engagementScore - controversyPenalty
  )));
  
  const avgTweetEng = tweets.length ? twitterEng / tweets.length : 0;
  const likeabilityScore = Math.max(40, Math.min(100, Math.round(50 + Math.log10(1 + avgTweetEng) * 8 + (instaPosts.length ? 5 : 0))));
  
  // ENHANCED CONTROVERSY SCORE with 3-layer brand risk detection
  
  // Comprehensive brand risk keywords (organized by category)
  const brandRiskKeywords = [
    // Personal life / relationships
    'divorce', 'divorced', 'divorcing', 'split', 'splits', 'splitting', 'separation', 'separated', 
    'affair', 'affairs', 'cheating', 'cheated', 'unfaithful', 'infidelity', 'mistress', 
    'marriage problems', 'marital issues', 'custody battle', 'ex-wife', 'ex-husband', 'breakup',
    
    // Sexual / inappropriate associations
    'onlyfans', 'only fans', 'escort', 'escorts', 'prostitute', 'sex worker', 'call girl',
    'strip club', 'stripper', 'adult entertainment', 'porn', 'pornography', 'sex scandal',
    'sexual misconduct', 'sexual harassment', 'inappropriate relationship', 'sex tape',
    'groped', 'groping', 'sexual assault', 'rape allegation', 'indecent',
    
    // Violence / aggression
    'assault', 'assaulted', 'assaulting', 'attacked', 'attack', 'fight', 'fighting', 'fought',
    'brawl', 'altercation', 'confrontation', 'violent', 'violence', 'aggressive', 'aggression',
    'punched', 'kicked', 'hit', 'beaten', 'domestic violence', 'domestic abuse', 'battery',
    
    // Legal issues
    'arrested', 'arrest', 'charged', 'charges', 'court', 'lawsuit', 'sued', 'suing',
    'legal action', 'prosecution', 'prosecuted', 'trial', 'convicted', 'conviction',
    'guilty', 'plea deal', 'settlement', 'injunction', 'restraining order', 'police investigation',
    'criminal charges', 'indicted', 'indictment', 'allegation', 'allegations', 'accused',
    
    // Discipline / conduct
    'banned', 'ban', 'suspension', 'suspended', 'fine', 'fined', 'disciplinary', 'discipline',
    'misconduct', 'investigation', 'investigated', 'probe', 'inquiry', 'scandal', 'controversy',
    'inappropriate behaviour', 'inappropriate behavior', 'unprofessional', 'code of conduct',
    
    // Substance abuse
    'drugs', 'drug', 'cocaine', 'cannabis', 'marijuana', 'substance abuse', 'addiction',
    'overdose', 'rehab', 'rehabilitation', 'drunk', 'drunken', 'intoxicated', 'inebriated',
    'drink driving', 'drunk driving', 'dui', 'dwi', 'failed drugs test', 'failed drug test',
    'positive test', 'banned substance', 'performance enhancing', 'doping', 'steroids',
    
    // Gambling
    'gambling', 'gamble', 'betting scandal', 'bet', 'casino', 'poker', 'gambling addiction',
    'match fixing', 'spot fixing', 'corruption', 'bribery', 'bribes', 'illegal betting',
    
    // Financial misconduct
    'fraud', 'fraudulent', 'tax evasion', 'tax avoidance', 'money laundering', 'bankruptcy',
    'bankrupt', 'debt', 'financial problems', 'unpaid taxes', 'hmrc investigation',
    
    // Discrimination / offensive behavior
    'racist', 'racism', 'racial abuse', 'discriminat', 'homophobic', 'homophobia',
    'sexist', 'sexism', 'offensive', 'abusive', 'slur', 'insult', 'hate speech',
    'islamophobic', 'anti-semitic', 'prejudice', 'bigot', 'xenophobic',
    
    // Social media / public behavior
    'deleted tweet', 'twitter storm', 'social media storm', 'backlash', 'outrage',
    'apologises', 'apologizes', 'apology', 'sorry for', 'regrets', 'inappropriate post',
    'offensive tweet', 'controversial post', 'slammed for', 'criticised for', 'criticized for',
    
    // Nightlife / partying
    'nightclub incident', 'nightclub', 'club incident', 'party', 'partying', 'wild night',
    'booze', 'boozy', 'alcohol', 'alcoholic', 'binge drinking', '3am', '4am',
    
    // Crashes / reckless behavior
    'car crash', 'crash', 'speeding', 'reckless driving', 'dangerous driving', 'road rage',
    'traffic offence', 'traffic offense', 'driving ban', 'points on licence',
    
    // Career misconduct
    'sacked', 'fired', 'dismissed', 'contract terminated', 'walked out', 'refused to play',
    'training ground bust-up', 'dressing room row', 'fell out with', 'disciplined by club'
  ];
  
  // SOURCE 1: NewsData.io + NewsAPI.org headlines
  let brandRiskCount = 0;
  const brandRiskArticles = [];
  
  news.forEach(article => {
    const headline = (article.title || '').toLowerCase();
    const description = (article.description || '').toLowerCase();
    const content = headline + ' ' + description;
    
    const matchedKeywords = brandRiskKeywords.filter(keyword => 
      content.includes(keyword.toLowerCase())
    );
    
    if (matchedKeywords.length > 0) {
      brandRiskCount++;
      brandRiskArticles.push({
        title: article.title,
        source: article.source || 'Unknown',
        keywords: matchedKeywords,
        date: article.publishedAt,
        detectSource: 'news'
      });
    }
  });
  
  // SOURCE 2: Twitter scandal signals (NEW!)
  const twitterScandals = scanTwitterForScandals(mentions, brandRiskKeywords);
  const significantTwitterScandals = twitterScandals.filter(t => t.engagement >= 100);
  const twitterRiskCount = Math.min(3, significantTwitterScandals.length);
  brandRiskCount += twitterRiskCount;
  
  significantTwitterScandals.slice(0, 3).forEach(scandal => {
    brandRiskArticles.push({
      title: scandal.text.substring(0, 100) + '...',
      source: 'Twitter',
      keywords: scandal.keywords,
      date: scandal.date,
      engagement: scandal.engagement,
      detectSource: 'twitter'
    });
  });
  
  console.log(`🚨 Brand risk: ${brandRiskCount} incidents (${brandRiskArticles.filter(a => a.detectSource === 'news').length} news + ${twitterRiskCount} Twitter)`);
  
  // Calculate brand risk penalty (each risky article/tweet adds 8 points, max 40 points)
  const brandRiskPenalty = Math.min(40, brandRiskCount * 8);
  
  // Add manual controversy incidents (if any)
  const manualIncidents = athleteData.manualIncidents || [];
  const manualPoints = manualIncidents.reduce((sum, incident) => sum + (incident.points || 0), 0);
  
  if (manualIncidents.length > 0) {
    console.log(`🚨 Manual incidents: ${manualIncidents.length} flagged (${manualPoints} points)`);
    manualIncidents.forEach(incident => {
      brandRiskArticles.push({
        title: incident.title,
        source: incident.source + ' (Manual)',
        keywords: ['manually flagged'],
        date: incident.date,
        detectSource: 'manual',
        severity: incident.severity,
        points: incident.points
      });
    });
  }
  
  // Combine sentiment-based controversy with brand risk AND manual incidents
  const baseControversy = Math.round(negRatio * 100);
  const controversyScore = Math.min(100, baseControversy + brandRiskPenalty + manualPoints);
  
  // RECALIBRATED RELEVANCE: Square root scaling for realistic differentiation
  // 75 = good coverage, 90+ = superstar, 100 = global icon only
  const relevanceScore = Math.min(100, Math.round(
    (Math.sqrt(mentions.length) * 7) +        // Diminishing returns on mentions
    (Math.sqrt(news.length) * 9) +            // Diminishing returns on articles
    (instagram?.insights?.impressions ? Math.log10(instagram.insights.impressions) * 5 : 0)
  ));
  const leadershipScore = Math.max(50, Math.min(100, Math.round((credibilityScore * 0.35) + (sentimentScore * 0.35) + (relevanceScore * 0.2) + (news.length > 5 ? 5 : 0))));
  const authenticityScore = Math.max(50, Math.min(100, Math.round((sentimentScore * 0.4) + (likeabilityScore * 0.4) + (validS.length ? 10 : 0))));
  
  return { 
    sentimentScore, 
    credibilityScore, 
    likeabilityScore, 
    leadershipScore, 
    authenticityScore, 
    controversyScore, 
    relevanceScore,
    brandRiskArticles
  };
}

function calculateAlertLevel(data) {
  const s = data.sentiment_score ?? 70, c = data.controversy_score ?? 30;
  if (s < 50 || c > 40) return 'critical';
  if (s < 60 || c > 30) return 'elevated';
  return 'nominal';
}

// --- Claude (Anthropic) API for score explanations (perception_details) ---
// See https://docs.anthropic.com/en/api/messages and https://platform.claude.com/docs/en/api/messages
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_VERSION = '2023-06-01';
// Use current model; claude-3-5-sonnet-20241022 is deprecated and can return 404
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

async function generateScoreExplanation(metricName, score, context, athleteName) {
  if (!ANTHROPIC_API_KEY) return { summary: '', breakdown: [] };
  
  // Build actual news headlines (not just counts)
  const newsHeadlines = (context.recentNewsHeadlines || []).slice(0, 5).map((article, i) => 
    `${i + 1}. "${article.title}" (${article.source}, ${article.date})`
  ).join('\n') || 'No recent news articles available.';
  
  // Build actual tweet content (not just percentages)
  const recentTweets = (context.recentTweets || []).slice(0, 5).map((tweet, i) => 
    `${i + 1}. "${tweet.text}" (${tweet.likes} likes, ${tweet.retweets} retweets, ${tweet.date})`
  ).join('\n') || 'No recent tweets available.';
  
  // Score-specific guidance to make each explanation distinct
  const scoreGuidance = {
    'Sentiment': `This metric measures EMOTIONAL TONE - how people feel about the athlete.
Focus on: Positive/negative language in tweets and headlines, fan emotional reactions, praise vs criticism, affectionate vs hostile tone.
Distinguish from other scores: Sentiment is about FEELINGS, not facts. A high sentiment means people feel warmly; low means they feel negatively.
Key evidence: Tweet sentiment percentages, emotional language in headlines ("beloved", "disappointing"), fan reaction intensity.`,

    'Credibility': `This metric measures TRUST & AUTHORITY - how believable and authoritative the athlete is perceived.
Focus on: Verification status, tier-1 media coverage (BBC, Times, Telegraph vs tabloids), expert opinions, institutional recognition, follower quality vs quantity.
Distinguish from other scores: Credibility is about TRUSTWORTHINESS and INSTITUTIONAL RESPECT, not popularity or likeability.
Key evidence: Quality of news sources covering them, verified account, engagement rate (shows real vs fake followers), professional achievements.`,

    'Likeability': `This metric measures FAN AFFECTION & APPROACHABILITY - how much people personally like and feel connected to the athlete.
Focus on: Engagement rates (likes/comments showing active affection), positive interactions, community connection, personal warmth, accessibility.
Distinguish from other scores: Likeability is about PERSONAL CONNECTION, not performance or authority. Can be liked without being respected, or respected without being liked.
Key evidence: Like ratios on personal posts, positive comment sentiment, community work mentions, fan testimonials, approachability signals.`,

    'Leadership': `This metric measures INFLUENCE & ON-FIELD AUTHORITY - leadership qualities and team influence.
Focus on: Team role, captaincy, on-field decision-making, manager/teammate quotes about leadership, critical moment performances, vocal presence.
Distinguish from other scores: Leadership is about TEAM INFLUENCE and AUTHORITY, not individual popularity or performance stats.
Key evidence: Captaincy mentions, manager quotes about leadership ("senior voice", "leads by example"), critical moments where they stepped up, team responsibility.`,

    'Authenticity': `This metric measures GENUINE VOICE & CONSISTENCY - whether the athlete appears real vs manufactured.
Focus on: Consistency in messaging over time, personal brand alignment, transparency, genuine moments vs scripted PR, personal voice vs corporate speak.
Distinguish from other scores: Authenticity is about REALNESS and CONSISTENCY, not quality or popularity. Can be authentic but disliked, or inauthentic but popular.
Key evidence: Consistency in post tone over time, personal vs PR language, genuine moments (family, passion) vs scripted corporate messaging, transparency in difficult moments.`,

    'Controversy': `This metric measures RISK & SCANDALS - negative incidents and reputational damage (both on-field AND off-field).
Focus on: Specific incidents (red cards, fines, confrontations), disciplinary issues, inappropriate content, negative press patterns, risky behaviour, BRAND-DAMAGING PERSONAL LIFE ISSUES (divorces, inappropriate associations, legal troubles, substance issues).
Distinguish from other scores: Controversy is about PROBLEMS and RISKS, not general negativity. Specific incidents, not poor performance. Includes off-field scandals even if media tone is neutral.
Key evidence: Disciplinary records, specific incidents with dates, inappropriate social media content, legal issues, personal life scandals (divorce, affairs, nightclub incidents), inappropriate associations (Only Fans models, gambling, substances), pattern of negative behaviour vs isolated incidents.
CRITICAL: Even neutrally-reported scandals damage brands - "spotted with Only Fans model" is brand-toxic even if not criticized. MANUAL INCIDENTS: Some incidents are manually flagged when automated detection misses them and appear as "(Manual)" in the source - these are confirmed, verified incidents requiring strategic attention.`,

    'Relevance': `This metric measures CULTURAL IMPACT & VISIBILITY - how much the athlete is part of the conversation.
Focus on: Trending status, transfer speculation, mainstream media attention, cultural crossover (non-sports coverage), meme-ability, social conversation volume.
Distinguish from other scores: Relevance is about VISIBILITY and CULTURAL PRESENCE, not quality or sentiment. Can be relevant for negative reasons.
Key evidence: Transfer rumour volume, trending topics, non-sports media mentions, social media mention volume, cultural moments beyond football.`
  };

  const guidance = scoreGuidance[metricName] || 'Analyse this score based on the available data.';
  
  // Add brand risk information for Controversy score
  const brandRiskInfo = (metricName === 'Controversy' && context.brandRiskArticles && context.brandRiskArticles.length > 0) 
    ? `\n\nBRAND RISK ALERTS DETECTED (${context.brandRiskArticles.length} articles with brand-damaging keywords):
${context.brandRiskArticles.map((article, i) => 
  `${i + 1}. "${article.title}" - Contains: ${article.keywords.slice(0, 3).join(', ')}${article.keywords.length > 3 ? '...' : ''}`
).join('\n')}

IMPORTANT: These articles contain keywords associated with brand risk (personal scandals, inappropriate associations, legal issues, substance abuse, etc.) even if the tone appears neutral. Sponsors and brands consider these toxic.`
    : '';
  
  const prompt = `You are analyzing reputation data for a professional athlete.

ATHLETE: ${athleteName || 'Professional Athlete'}
METRIC: ${metricName}
SCORE: ${score}/100

${guidance}${brandRiskInfo}

RECENT NEWS HEADLINES (Last 7 days):
${newsHeadlines}

RECENT TWEETS (Last 7 days):
${recentTweets}

STATISTICS:
- Twitter: ${context.twitterPctPositive}% positive sentiment, ${context.twitterFollowers} followers, ${context.twitterMentions} mentions
- Instagram: ${context.instagramPctPositive}% positive, ${context.instagramFollowers} followers, ${context.instagramPosts} posts
- News: ${context.newsMentions} articles total, ${context.newsSentiment} sentiment breakdown

TASK: Write a compelling, natural explanation for this ${metricName} score of ${score}.

CRITICAL FILTERING RULE - READ CAREFULLY:
You are analyzing ${athleteName} ONLY. Many headlines will mention OTHER players (teammates, opponents). You MUST IGNORE articles where ${athleteName} is NOT the primary subject.

Examples of what to IGNORE:
- "Lewis Miley targets return from injury" → This is about MILEY, NOT ${athleteName}. IGNORE IT COMPLETELY.
- "Jacob Murphy warns Newcastle" → This is about MURPHY, NOT ${athleteName}. IGNORE IT COMPLETELY.
- "Newcastle midfielder injured" → If it doesn't explicitly name ${athleteName}, IGNORE IT.

Only use articles where:
- ${athleteName} is named in the headline, OR
- The article is clearly and primarily ABOUT ${athleteName}

If you're unsure whether an article is about ${athleteName}, DO NOT USE IT.

CRITICAL STYLE REQUIREMENTS:
1. Write in NATURAL PROSE - like a sports analyst, not an academic report
2. NO markdown formatting (no **, no ##, no labels)
3. Be PUNCHY and DIRECT - short, impactful sentences
4. Extract SPECIFIC events with dates from the data above
5. Use "the athlete" not "the player's" or possessive forms
6. Lead with insight, not score definition
7. USE BRITISH ENGLISH: realise (not realize), analyse (not analyze), whilst (not while), favour (not favor), match (not game for football)
8. FOCUS ON THE SPECIFIC EVIDENCE RELEVANT TO THIS METRIC - don't repeat the same points across all scores

FORMAT (output exactly this way):

[2-3 sentences of natural prose explaining what drives this score. Be specific about actual events. No labels, no bold text, just flowing sentences.]

• [Specific detail with date/evidence - keep it punchy, under 25 words]
• [Another specific achievement or incident - direct and clear]
• [Concrete example with numbers - no fluff]
• [Supporting evidence - actual event or stat]

GOOD EXAMPLE (COPY THIS STYLE):
The athlete's Sentiment score of 67 reflects moderately positive perception driven by strong social media engagement but tempered by neutral news coverage. Recent contract uncertainty and match disappointments prevent the score reaching elite territory, though loyal fanbase provides solid foundation.

• March 2026: Contract talks dominate headlines as two articles signal unresolved future at Newcastle
• February 28 defeat vs Everton (3/10 player rating) damages reputation narrative
• Zero positive stories in past week - 8 neutral articles fail to reinforce reputation
• Twitter shows 80% positive sentiment with contract tweet earning 28,951 likes

BAD EXAMPLE (DO NOT DO THIS):
**Summary:** Kieran Trippier's sentiment score of 67/100 reflects a player whose social media presence remains largely positive but whose news cycle is dominated by contract uncertainty...

**Breakdown:**
- **March 1, 2026: Contract uncertainty dominates the news cycle** — Two headlines...

CRITICAL: 
- NO bold text (**), NO markdown, NO section labels
- Write like a professional analyst briefing a client
- Keep bullets under 25 words each
- Be specific with dates, stats, and actual events from the data above`;

  try {
    const res = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: CLAUDE_MODEL,
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': ANTHROPIC_VERSION
        },
        timeout: 60000,
        validateStatus: () => true
      }
    );
    if (res.status !== 200) {
      const errMsg = res.data?.error?.message || res.statusText;
      const errType = res.data?.error?.type;
      console.error('Claude API error for', metricName, ':', res.status, errType || '', errMsg);
      return { summary: '', breakdown: [] };
    }
    const text = res.data?.content?.[0]?.text || '';
    // Remove any markdown bold/italic that Claude might still use
    const cleanText = text.replace(/\*\*/g, '').replace(/\*/g, '');
    const lines = cleanText.split('\n').map(s => s.trim()).filter(Boolean);
    // Accept both • and - as bullet markers
    const bulletLines = lines.filter(l => l.startsWith('•') || l.startsWith('-'));
    const summaryLines = lines.filter(l => !l.startsWith('•') && !l.startsWith('-'));
    const summary = summaryLines.join(' ').trim() || '';
    // Ensure bullets start with • for consistency
    const breakdown = bulletLines.map(l => {
      const cleaned = l.replace(/^[•\-]\s*/, '');
      return `• ${cleaned}`;
    });
    return { summary, breakdown };
  } catch (e) {
    console.error('Claude explanation error for', metricName, ':', e.message);
    return { summary: '', breakdown: [] };
  }
}

/** Generate strategic intelligence report with risks, recommendations, and watch-outs */
async function generateStrategicIntelligence(scores, athleteData, context, athleteName) {
  if (!ANTHROPIC_API_KEY) return null;
  
  const newsHeadlines = (context.recentNewsHeadlines || []).slice(0, 8).map((article, i) => 
    `${i + 1}. "${article.title}" (${article.source}, ${article.date})`
  ).join('\n') || 'No recent news articles available.';
  
  const recentTweets = (context.recentTweets || []).slice(0, 5).map((tweet, i) => 
    `${i + 1}. "${tweet.text}" (${tweet.likes} likes, ${tweet.retweets} retweets, ${tweet.date})`
  ).join('\n') || 'No recent tweets available.';

  const prompt = `You are an elite athlete reputation intelligence advisor providing strategic analysis.

ATHLETE: ${athleteName || 'Professional Athlete'}

ATHLETE REPUTATION SCORES:
- Sentiment: ${scores.sentimentScore}/100
- Credibility: ${scores.credibilityScore}/100
- Likeability: ${scores.likeabilityScore}/100
- Leadership: ${scores.leadershipScore}/100
- Authenticity: ${scores.authenticityScore}/100
- Controversy: ${scores.controversyScore}/100
- Relevance: ${scores.relevanceScore}/100

RECENT NEWS HEADLINES (Last 7 days):
${newsHeadlines}

RECENT SOCIAL MEDIA (Last 7 days):
${recentTweets}

STATISTICS:
- Twitter: ${context.twitterPctPositive}% positive, ${context.twitterFollowers} followers, ${context.twitterMentions} mentions
- Instagram: ${context.instagramPctPositive}% positive, ${context.instagramFollowers} followers, ${context.instagramPosts} posts
- News: ${context.newsMentions} articles, ${context.newsSentiment}

TASK: Provide strategic intelligence analysis for this athlete's reputation.

CRITICAL FILTERING RULE - READ CAREFULLY:
You are analyzing ${athleteName} ONLY. The news headlines include articles about OTHER Newcastle players (Lewis Miley, Jacob Murphy, etc.). You MUST COMPLETELY IGNORE any article where ${athleteName} is NOT the primary subject.

DO NOT USE articles that are about other players, even if they mention the team:
- "Lewis Miley targets return from injury" → About MILEY, NOT ${athleteName}. DO NOT reference this injury. IGNORE COMPLETELY.
- "Jacob Murphy warns Newcastle" → About MURPHY, NOT ${athleteName}. IGNORE COMPLETELY.
- "Newcastle midfielder frustrated by injury" → If it doesn't name ${athleteName}, IGNORE IT.

ONLY use articles where:
- ${athleteName} is explicitly named in the headline, OR
- The article is clearly and primarily ABOUT ${athleteName}

If an article is about another player's injury, DO NOT apply that injury to ${athleteName}. DO NOT assume ${athleteName} is injured unless the article explicitly says so.

YOU ARE NOT A DATA REPORTER. You are a strategic advisor helping protect and enhance an elite athlete's reputation. Write with authority and insight.

OUTPUT FORMAT (no labels, no markdown, natural sections separated by blank lines):

[STRATEGIC OVERVIEW - 3-4 sentences]
Assess the athlete's current reputation position. Identify critical inflection points or vulnerabilities. Reference specific events from the headlines. Be direct about what's working and what's at risk.

[KEY RISKS - 3-4 bullet points with •]
Identify specific reputation threats based on actual headlines and scores. Each risk should be actionable and time-bound. Reference actual events. Be specific about what could escalate.

[IMMEDIATE RECOMMENDATIONS - 4-5 bullet points with •]
Provide tactical actions the athlete/team should take in next 7-14 days. Be specific and actionable. Reference actual opportunities in the data. Prioritize by urgency.

[WATCH-OUTS - 3-4 bullet points with •]
Flag early warning signals that need monitoring. Reference upcoming events or trends that could shift sentiment. Be specific about timing and triggers.

STYLE REQUIREMENTS:
- NO markdown (no **, no labels, no headers)
- Write in natural flowing prose for overview
- Bullets should be punchy, under 30 words
- Be SPECIFIC - use actual dates, events, numbers from headlines
- Write like you're briefing a client who pays £12K/month for this intelligence
- Don't say "the athlete should consider" - say "Accelerate contract resolution"
- Don't be cautious - be direct and authoritative
- USE BRITISH ENGLISH: realise (not realize), analyse (not analyze), whilst (not while), favour (not favor), match (not game for football), utilise (not utilize)

GOOD EXAMPLE:
The athlete is navigating a critical reputation inflection point. With contract talks unresolved and performance scrutiny intensifying following the Everton defeat, the next 4-6 weeks will define whether the Newcastle legacy ends on positive or contentious terms. Current sentiment remains salvageable (67/100) but requires proactive narrative management. Zero positive news stories in the past week creates vulnerability.

• Contract stalemate narrative: Two articles on March 1 signal prolonged uncertainty - risk of "unwanted player" framing if not resolved quickly
• Performance criticism escalation: 3/10 rating provides ammunition for critics; another poor showing could trigger sustained negative cycle
• Transfer speculation toxicity: Arsenal interest could polarize fanbase between those wanting departure vs. defending legacy

• Accelerate contract resolution (public or private) to eliminate uncertainty as story angle before next match
• Proactive positive content: Share training footage, community work, or behind-scenes to counter performance narrative within 48 hours
• Leverage Twitter goodwill: 80% positive sentiment and 28K-like contract tweet show fanbase supportive - engage directly this week
• Media management: Secure positive feature placement to balance neutral-heavy news cycle (0/10 positive stories problematic)
• Performance bounce-back critical: Strong showing in next match (within 7 days) can shift narrative immediately

• Newcastle's next match result - another loss magnifies scrutiny exponentially
• Contract deadline approaching - silence becomes story itself within 14 days
• Arsenal transfer rumors escalating - could shift sentiment rapidly if new reports emerge
• Fan sentiment shift: Currently strong (80% positive) but fragile given performance concerns - monitor Twitter tone after next match

BAD EXAMPLE (DO NOT DO THIS):
**Strategic Overview:**
The athlete's reputation scores indicate a mixed picture with some areas of strength...

**Key Risks:**
- **Negative media coverage** - Some recent articles have been critical
- **Performance concerns** - Scores could be affected by poor results`;

  try {
    const res = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: CLAUDE_MODEL,
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': ANTHROPIC_VERSION
        },
        timeout: 60000,
        validateStatus: () => true
      }
    );
    if (res.status !== 200) {
      console.error('Claude strategic intelligence error:', res.status, res.data?.error?.type);
      return null;
    }
    
    const text = res.data?.content?.[0]?.text || '';
    const cleanText = text.replace(/\*\*/g, '').replace(/\*/g, '');
    
    // More robust parsing: collect all bullets regardless of section breaks
    const allLines = cleanText.split('\n').map(s => s.trim()).filter(Boolean);
    
    // Find overview (everything before first bullet)
    const firstBulletIndex = allLines.findIndex(line => line.startsWith('•') || line.startsWith('-'));
    const overviewLines = firstBulletIndex > 0 ? allLines.slice(0, firstBulletIndex) : [allLines[0] || ''];
    const overview = overviewLines.join(' ').trim();
    
    // Extract all bullets
    const allBullets = allLines
      .filter(line => line.startsWith('•') || line.startsWith('-'))
      .map(line => {
        const cleaned = line.replace(/^[•\-]\s*/, '');
        return `• ${cleaned}`;
      });
    
    // Try to intelligently split bullets into sections
    // Assume roughly equal distribution: first ~1/3 are risks, middle ~1/3 are recommendations, last ~1/3 are watch-outs
    const totalBullets = allBullets.length;
    
    if (totalBullets === 0) {
      // Fallback: no bullets found
      return {
        strategic_overview: overview,
        key_risks: ['• No specific risks identified from current data'],
        immediate_recommendations: ['• Continue monitoring social media sentiment and news coverage'],
        watch_outs: ['• Track any sudden changes in engagement or controversy scores']
      };
    }
    
    // If we have 10+ bullets, split them intelligently
    // Otherwise, try to identify sections by content/keywords
    let risks = [];
    let recommendations = [];
    let watchouts = [];
    
    if (totalBullets >= 9) {
      // Assume first ~3-4 are risks, middle ~3-5 are recommendations, last ~3-4 are watch-outs
      const splitPoint1 = Math.floor(totalBullets / 3);
      const splitPoint2 = Math.floor((totalBullets * 2) / 3);
      risks = allBullets.slice(0, splitPoint1);
      recommendations = allBullets.slice(splitPoint1, splitPoint2);
      watchouts = allBullets.slice(splitPoint2);
    } else {
      // For fewer bullets, try keyword-based assignment
      for (const bullet of allBullets) {
        const lower = bullet.toLowerCase();
        if (lower.includes('risk') || lower.includes('threat') || lower.includes('danger') || 
            lower.includes('concern') || lower.includes('escalat') || lower.includes('penalty') ||
            lower.includes('negative') || lower.includes('damag')) {
          risks.push(bullet);
        } else if (lower.includes('recommend') || lower.includes('accelerate') || lower.includes('should') ||
                   lower.includes('leverage') || lower.includes('proactive') || lower.includes('secure') ||
                   lower.includes('engage') || lower.includes('address')) {
          recommendations.push(bullet);
        } else if (lower.includes('watch') || lower.includes('monitor') || lower.includes('track') ||
                   lower.includes('next') || lower.includes('upcoming') || lower.includes('if ')) {
          watchouts.push(bullet);
        } else {
          // Default: put early bullets in risks, later in recommendations
          if (risks.length < recommendations.length) {
            risks.push(bullet);
          } else {
            recommendations.push(bullet);
          }
        }
      }
      
      // Ensure we have at least 1 in each category
      if (risks.length === 0) risks.push(allBullets[0] || '• Monitor current reputation metrics');
      if (recommendations.length === 0) recommendations.push(allBullets[1] || '• Maintain current engagement levels');
      if (watchouts.length === 0) watchouts.push(allBullets[allBullets.length - 1] || '• Track sentiment changes');
    }
    
    return {
      strategic_overview: overview,
      key_risks: risks.length > 0 ? risks : ['• No immediate risks detected'],
      immediate_recommendations: recommendations.length > 0 ? recommendations : ['• Continue current strategy'],
      watch_outs: watchouts.length > 0 ? watchouts : ['• Monitor ongoing metrics']
    };
  } catch (e) {
    console.error('Strategic intelligence generation error:', e.message);
    return null;
  }
}

/** Template-based explanation when Claude API is not available */
function getTemplateExplanation(metricName, score, context) {
  const s = score ?? 0;
  const templates = {
    Sentiment: {
      summary: s >= 70 ? `Positive sentiment detected across recent posts and news. Fans and media are largely supportive.` : s >= 50 ? `Mixed to neutral sentiment. Some positive coverage with limited negative mentions.` : `Elevated negative sentiment in recent coverage. Consider monitoring and response.`,
      breakdown: [
        `Twitter: ${context.twitterPctPositive}% positive in sampled posts`,
        `News: ${context.newsSentiment}`,
        `Based on ${context.twitterMentions} Twitter mentions and ${context.newsMentions} news articles`
      ]
    },
    Credibility: {
      summary: s >= 70 ? `Strong credibility from verification, follower base, and media presence.` : s >= 50 ? `Moderate credibility. Verification and reach contribute to score.` : `Credibility score reflects limited verification or reach data.`,
      breakdown: [
        `Twitter followers: ${context.twitterFollowers}; Instagram: ${context.instagramFollowers}`,
        `News mentions: ${context.newsMentions}`,
        `Verified status and engagement feed into this score`
      ]
    },
    Likeability: {
      summary: s >= 70 ? `High engagement and positive interaction on social channels.` : s >= 50 ? `Solid engagement levels. Audience responds well to content.` : `Engagement metrics are modest; more active posting may improve likeability.`,
      breakdown: [
        `Average engagement from tweets and posts`,
        `Instagram posts sampled: ${context.instagramPosts}`,
        `Engagement rate and fan interaction drive this metric`
      ]
    },
    Leadership: {
      summary: s >= 70 ? `Strong leadership perception from credibility, sentiment, and relevance.` : s >= 50 ? `Leadership score reflects current media and social footprint.` : `Leadership metric is based on limited data points.`,
      breakdown: [
        `Combines credibility, sentiment, and relevance scores`,
        `News coverage volume: ${context.newsMentions} articles`,
        `Higher media presence and positive sentiment raise this score`
      ]
    },
    Authenticity: {
      summary: s >= 70 ? `Authentic voice and consistent positive sentiment across channels.` : s >= 50 ? `Authenticity reflected in sentiment and likeability signals.` : `Score based on available sentiment and engagement data.`,
      breakdown: [
        `Sentiment and likeability contribute equally`,
        `Consistency of message and fan reaction factor in`,
        `More data improves accuracy of this score`
      ]
    },
    Controversy: {
      summary: s > 40 ? `Elevated controversy from negative or mixed sentiment in recent coverage. Worth monitoring.` : s > 20 ? `Some negative or mixed sentiment detected. Generally stable.` : `Low controversy. Sentiment is predominantly positive or neutral.`,
      breakdown: [
        `Derived from negative and mixed sentiment in tweets and news`,
        `Twitter and news sentiment analysis feed this score`,
        `Lower score indicates less contentious coverage`
      ]
    },
    Relevance: {
      summary: s >= 70 ? `High relevance: strong mention count and media coverage.` : s >= 50 ? `Relevance reflects current mention and news volume.` : `Relevance score is based on mention and news counts.`,
      breakdown: [
        `Twitter mentions: ${context.twitterMentions}, News: ${context.newsMentions}`,
        `Instagram impressions and engagement also factor in`,
        `More mentions and coverage increase relevance`
      ]
    }
  };
  const t = templates[metricName] || { summary: `Score: ${s}. Based on available social and news data.`, breakdown: [] };
  return { summary: t.summary, breakdown: t.breakdown || [] };
}

async function buildPerceptionDetails(scores, athleteData, context, athleteName) {
  const base = { data_quality: context.data_quality || {} };
  const metricNames = ['Sentiment', 'Credibility', 'Likeability', 'Leadership', 'Authenticity', 'Controversy', 'Relevance'];
  const scoreKeys = ['sentimentScore', 'credibilityScore', 'likeabilityScore', 'leadershipScore', 'authenticityScore', 'controversyScore', 'relevanceScore'];
  for (let i = 0; i < metricNames.length; i++) {
    const score = scores[scoreKeys[i]] ?? 0;
    let summary = '';
    let breakdown = [];
    if (ANTHROPIC_API_KEY) {
      const result = await generateScoreExplanation(metricNames[i], score, context, athleteName);
      summary = result.summary || '';
      breakdown = Array.isArray(result.breakdown) ? result.breakdown : [result.breakdown].filter(Boolean);
    }
    if (!summary) {
      const template = getTemplateExplanation(metricNames[i], score, context);
      summary = template.summary;
      breakdown = template.breakdown;
    }
    base[metricNames[i]] = { summary, breakdown };
  }
  
  // Generate strategic intelligence report
  if (ANTHROPIC_API_KEY) {
    console.log('📋 Generating strategic intelligence...');
    const strategicIntel = await generateStrategicIntelligence(scores, athleteData, context, athleteName);
    if (strategicIntel) {
      base.strategic_intelligence = strategicIntel;
    }
  }
  
  return base;
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

function generateTimeline(tweets, news, instagramPosts) {
  const events = [];
  (tweets || []).forEach(t => { const eng = t.likes + t.retweets + t.replies; if (eng > 500) events.push({ date: new Date(t.createdAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }), platforms: 'TWITTER', title: (t.text || '').substring(0, 100), description: `${(t.likes || 0).toLocaleString()} likes, ${(t.retweets || 0).toLocaleString()} retweets`, sentiment: t.sentiment?.sentiment || 'NEUTRAL' }); });
  (news || []).forEach(a => events.push({ date: new Date(a.publishedAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }), platforms: 'NEWS MEDIA', title: a.title, description: (a.description || a.content || '').substring(0, 200), sentiment: a.sentiment?.sentiment || 'NEUTRAL' }));
  (instagramPosts || []).slice(0, 5).forEach(p => { const ts = p.timestamp || p.takenAt || p.createdAt; if (ts) events.push({ date: new Date(ts).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }), platforms: 'INSTAGRAM', title: (p.caption || 'Instagram post').substring(0, 100), description: `${(p.likes || 0).toLocaleString()} likes, ${(p.comments || 0).toLocaleString()} comments`, sentiment: 'NEUTRAL' }); });
  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  return events.slice(0, 15);
}

async function collectAthleteData(athleteId, athleteName, twitterHandle, instagramBusinessId, country, sport = 'football') {
  console.log('\n📊 Collecting data for', athleteName);
  try {
    console.log('🐦 Twitter...');
    const twitterProfile = await getTwitterProfile(twitterHandle);
    const tweets = await getRecentTweets(twitterHandle, 20);
    const mentions = await getTwitterMentions(twitterHandle, 50);
    console.log('📷 Instagram...');
console.log('📷 Instagram ID received:', instagramBusinessId);
const resolvedUsername = resolveInstagramUsername(instagramBusinessId);
console.log('📷 Resolved username:', resolvedUsername);
const hasInstagram = !!resolvedUsername;
console.log('📷 hasInstagram:', hasInstagram);
    const instagramProfile = hasInstagram ? await getInstagramProfile(instagramBusinessId) : null;
    const instagramPosts = hasInstagram ? await getInstagramPosts(instagramBusinessId, 10) : [];
    const instagramInsights = hasInstagram ? await getInstagramInsights(instagramBusinessId) : {};
    console.log('📰 News (NewsData.io)...');
    const news = await searchNews(athleteName, 7, country, sport);
    console.log('📰 Checking tabloids (NewsAPI.org)...');
    const tabloidNews = await searchNewsAPI(athleteName, 28);
    
    // Merge and deduplicate news sources
    const allNews = [...news];
    let tabloidCount = 0;
    tabloidNews.forEach(article => {
      const exists = allNews.some(a => a.title && article.title && a.title.toLowerCase() === article.title.toLowerCase());
      if (!exists) { 
        allNews.push(article); 
        tabloidCount++; 
      }
    });
    console.log(`📰 Added ${tabloidCount} unique tabloid articles. Total: ${allNews.length} articles`);
    
    // Fetch manual controversy incidents from database
    console.log('⚠️  Checking manual incidents...');
    let manualIncidents = [];
    try {
      const { data: athleteRow } = await supabase
        .from('athletes')
        .select('manual_controversy_incidents')
        .eq('id', athleteId)
        .maybeSingle();
      
      manualIncidents = athleteRow?.manual_controversy_incidents || [];
      if (manualIncidents.length > 0) {
        console.log(`⚠️  Found ${manualIncidents.length} manual incidents`);
      }
    } catch (e) {
      console.error('Error fetching manual incidents:', e.message);
    }
    
    console.log('🤖 Sentiment...');
    const tweetSents = await Promise.all(tweets.slice(0, 10).map(t => analyzeSentiment(t.text)));
    tweets.forEach((t, i) => { if (i < 10) t.sentiment = tweetSents[i]; });
    const newsSents = await Promise.all(allNews.slice(0, 10).map(a => analyzeSentiment(a.title + ' ' + (a.description || ''))));
    allNews.forEach((a, i) => { if (i < 10) a.sentiment = newsSents[i]; });
    
    const athleteData = { profile: twitterProfile, tweets, mentions, instagram: { profile: instagramProfile, posts: instagramPosts, insights: instagramInsights }, news: allNews, manualIncidents };
    
    const twitterOk = !!twitterProfile;
    const sentimentOk = (tweetSents.length > 0 && tweetSents.some(s => s && s.scores && (s.scores.positive + s.scores.negative) > 0)) || (newsSents.length > 0 && newsSents.some(s => s && s.scores && (s.scores.positive + s.scores.negative) > 0));
    console.log('📈 Scores...');
    const scores = calculateReputationScores(athleteData);
    const timeline = generateTimeline(tweets, allNews, instagramPosts);
    const twitterPos = tweetSents.filter(s => s && s.sentiment === 'POSITIVE').length;
    const twitterPctPositive = tweetSents.length ? Math.round((twitterPos / tweetSents.length) * 100) : 0;
    const newsPos = newsSents.filter(s => s && s.sentiment === 'POSITIVE').length;
    const newsNeutral = newsSents.filter(s => s && s.sentiment === 'NEUTRAL').length;
    const newsSentimentStr = newsSents.length ? `${newsPos} positive, ${newsNeutral} neutral` : 'no data';
    const claudeContext = {
      twitterPctPositive,
      twitterFollowers: (twitterProfile?.followers || 0).toLocaleString(),
      twitterMentions: mentions.length,
      instagramPctPositive: instagramPosts.length ? 70 : 0,
      instagramFollowers: (instagramProfile?.followers || 0).toLocaleString(),
      instagramPosts: instagramPosts.length,
      newsMentions: allNews.length,
      newsSentiment: newsSentimentStr,
      data_quality: { twitter_ok: twitterOk, sentiment_ok: sentimentOk },
      // NEW: Pass actual content for Claude to analyze
      recentNewsHeadlines: allNews.slice(0, 5).map(article => ({
        title: article.title,
        source: article.source || 'Unknown',
        date: article.publishedAt ? new Date(article.publishedAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Recent'
      })),
      recentTweets: tweets.slice(0, 5).map(tweet => ({
        text: (tweet.text || '').substring(0, 200), // Truncate long tweets
        likes: tweet.likes || 0,
        retweets: tweet.retweets || 0,
        date: tweet.createdAt ? new Date(tweet.createdAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Recent'
      })),
      // Brand risk articles for controversy detection
      brandRiskArticles: scores.brandRiskArticles || []
    };
    console.log('📝 Generating score explanations (Claude)...');
    const perception_details = await buildPerceptionDetails(scores, athleteData, claudeContext, athleteName);
    const avgInstaEng = instagramPosts.length ? Math.round(instagramPosts.reduce((s, p) => s + (p.likes || 0) + (p.comments || 0), 0) / instagramPosts.length) : 0;
    const twitterFollowerCount = twitterProfile?.followers ?? 0;
    const instagramFollowerCount = instagramProfile?.followers ?? 0;
    const totalTweetEng = tweets.reduce((s, t) => s + (t.likes || 0) + (t.retweets || 0) + (t.replies || 0), 0);
    const totalInstaEng = instagramPosts.reduce((s, p) => s + (p.likes || 0) + (p.comments || 0), 0);
    const avgEngRateTwitter = tweets.length && twitterFollowerCount > 0 ? Number(((totalTweetEng / tweets.length) / twitterFollowerCount * 100).toFixed(2)) : null;
    const avgEngRateInstagram = instagramPosts.length && instagramFollowerCount > 0 ? Number(((totalInstaEng / instagramPosts.length) / instagramFollowerCount * 100).toFixed(2)) : null;
    const avgLikesTwitter = tweets.length ? Math.round(tweets.reduce((s, t) => s + (t.likes || 0), 0) / tweets.length) : 0;
    const avgCommentsTwitter = tweets.length ? Math.round(tweets.reduce((s, t) => s + (t.replies || 0), 0) / tweets.length) : 0;
    const avgRetweets = tweets.length ? Math.round(tweets.reduce((s, t) => s + (t.retweets || 0), 0) / tweets.length) : 0;
    const avgLikesInstagram = instagramPosts.length ? Math.round(instagramPosts.reduce((s, p) => s + (p.likes || 0), 0) / instagramPosts.length) : 0;
    const avgCommentsInstagram = instagramPosts.length ? Math.round(instagramPosts.reduce((s, p) => s + (p.comments || 0), 0) / instagramPosts.length) : 0;
    const resolvedIgUsername = resolveInstagramUsername(instagramBusinessId);
    perception_details.instagram_handle = instagramProfile?.username ?? (resolvedIgUsername || null);
    perception_details.twitter_pct_positive = twitterPctPositive;
    perception_details.instagram_pct_positive = instagramPosts.length ? 70 : (twitterPctPositive || 0);
    perception_details.recent_instagram_posts = instagramPosts.slice(0, 5);
    perception_details.avg_instagram_engagement = avgInstaEng;
    perception_details.engagement_aggregates = {
      avg_engagement_rate_twitter_pct: avgEngRateTwitter,
      avg_engagement_rate_instagram_pct: avgEngRateInstagram,
      avg_likes_per_post_twitter: avgLikesTwitter,
      avg_comments_replies_twitter: avgCommentsTwitter,
      avg_retweets: avgRetweets,
      avg_likes_per_post_instagram: avgLikesInstagram,
      avg_comments_per_post_instagram: avgCommentsInstagram
    };
    // total_mentions = Twitter @mentions count + news articles count (combined social + news visibility)
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
      recent_news: allNews.slice(0, 10),
      timeline_events: timeline,
      total_mentions: mentions.length,
      news_articles_count: allNews.length,
      avg_tweet_engagement: tweets.length ? Math.round(tweets.reduce((s, t) => s + t.likes + t.retweets, 0) / tweets.length) : 0,
      perception_details,
      recent_instagram_posts: instagramPosts.slice(0, 10),
      avg_engagement_rate_twitter: avgEngRateTwitter,
      avg_engagement_rate_instagram: avgEngRateInstagram,
      avg_likes_twitter: avgLikesTwitter,
      avg_comments_retweets_twitter: avgCommentsTwitter + avgRetweets,
      avg_likes_instagram: avgLikesInstagram,
      avg_comments_instagram: avgCommentsInstagram,
      engagement_aggregates: {
        avg_engagement_rate_twitter_pct: avgEngRateTwitter,
        avg_engagement_rate_instagram_pct: avgEngRateInstagram,
        avg_likes_per_post_twitter: avgLikesTwitter,
        avg_comments_replies_twitter: avgCommentsTwitter,
        avg_retweets: avgRetweets,
        avg_likes_per_post_instagram: avgLikesInstagram,
        avg_comments_per_post_instagram: avgCommentsInstagram
      }
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
    const { data: dashboard, error } = await supabase.from('athlete_dashboards').select('*').eq('athlete_id', req.params.athleteId).single();
    if (error) throw error;
    if (!dashboard) { res.json(null); return; }
    const { data: athlete } = await supabase.from('athletes').select('instagram_business_id').eq('id', req.params.athleteId).maybeSingle();
    const payload = { ...dashboard };
    if (athlete?.instagram_business_id && !payload.perception_details?.instagram_handle) {
      payload.perception_details = { ...(payload.perception_details || {}), instagram_handle: athlete.instagram_business_id };
    }
    res.json(payload);
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
  const { athleteId, athleteName, twitterHandle, instagramBusinessId, instagramUsername, userName, country, sport } = req.body;
  if (!athleteId || !athleteName || !twitterHandle) return res.status(400).json({ error: 'Missing required fields: athleteId, athleteName, twitterHandle' });
  
  console.log('🔍 REFRESH DEBUG - Body received:', { athleteId, athleteName, twitterHandle, instagramBusinessId, instagramUsername, userName });
  
  // Prefer athletes table as source of truth so Instagram username from DB is used
  let instagramId = instagramUsername ?? userName ?? instagramBusinessId ?? null;
  let useName = athleteName;
  let useTwitter = twitterHandle;
  let useCountry = country;
  let useSport = sport || 'football';
  
  console.log('🔍 REFRESH DEBUG - Initial instagramId:', instagramId);
  
  try {
    const { data: athleteRow, error: dbError } = await supabase
      .from('athletes')
      .select('instagram_business_id, twitter_handle, name, sport')
      .eq('id', athleteId)
      .maybeSingle();
    
    console.log('🔍 REFRESH DEBUG - DB query error:', dbError);
    console.log('🔍 REFRESH DEBUG - athleteRow:', athleteRow);
    
    if (athleteRow) {
      if (athleteRow.instagram_business_id != null && String(athleteRow.instagram_business_id).trim() !== '') {
        instagramId = athleteRow.instagram_business_id;
        console.log('🔍 REFRESH DEBUG - Set instagramId from DB:', instagramId);
      }
      if (athleteRow.twitter_handle != null && String(athleteRow.twitter_handle).trim() !== '') useTwitter = athleteRow.twitter_handle;
      if (athleteRow.name != null && String(athleteRow.name).trim() !== '') useName = athleteRow.name;
      if (athleteRow.country != null && String(athleteRow.country).trim() !== '') useCountry = athleteRow.country;
      if (athleteRow.sport != null && String(athleteRow.sport).trim() !== '') useSport = athleteRow.sport;
    }
  } catch (e) {
    console.error('🔍 REFRESH DEBUG - Exception fetching from DB:', e.message);
  }
  
  console.log('🔍 REFRESH DEBUG - Final instagramId being passed:', instagramId);
  
  try {
    const data = await collectAthleteData(athleteId, useName, useTwitter, instagramId, useCountry, useSport);
    res.json({ success: !!data, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/athletes', async (req, res) => {
  try {
    const { data, error } = await supabase.from('athlete_dashboards').select('*').order('updated_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- MANUAL CONTROVERSY OVERRIDE ENDPOINTS ---

// Add manual controversy incident
app.post('/api/athlete/controversy/add', async (req, res) => {
  const { athleteId, incident } = req.body;
  
  if (!athleteId || !incident) {
    return res.status(400).json({ error: 'Missing required fields: athleteId, incident' });
  }
  
  if (!incident.title || !incident.date || !incident.source) {
    return res.status(400).json({ error: 'Incident must have title, date, and source' });
  }
  
  try {
    const { data: athlete, error: fetchError } = await supabase
      .from('athletes')
      .select('manual_controversy_incidents')
      .eq('id', athleteId)
      .single();
    
    if (fetchError) throw fetchError;
    
    const currentIncidents = athlete?.manual_controversy_incidents || [];
    const severity = incident.severity || 'medium';
    const points = severity === 'low' ? 8 : severity === 'high' ? 24 : 16;
    
    const newIncident = {
      id: Date.now().toString(),
      title: incident.title,
      date: incident.date,
      source: incident.source,
      severity,
      points,
      added_at: new Date().toISOString(),
      notes: incident.notes || ''
    };
    
    const updatedIncidents = [...currentIncidents, newIncident];
    
    const { error: updateError } = await supabase
      .from('athletes')
      .update({ manual_controversy_incidents: updatedIncidents })
      .eq('id', athleteId);
    
    if (updateError) throw updateError;
    
    console.log(`✅ Added manual controversy incident for athlete ${athleteId}: ${newIncident.title}`);
    
    res.json({ 
      success: true, 
      incident: newIncident,
      total_incidents: updatedIncidents.length,
      total_points: updatedIncidents.reduce((sum, i) => sum + i.points, 0)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Remove manual controversy incident
app.delete('/api/athlete/controversy/remove', async (req, res) => {
  const { athleteId, incidentId } = req.body;
  
  if (!athleteId || !incidentId) {
    return res.status(400).json({ error: 'Missing required fields: athleteId, incidentId' });
  }
  
  try {
    const { data: athlete, error: fetchError } = await supabase
      .from('athletes')
      .select('manual_controversy_incidents')
      .eq('id', athleteId)
      .single();
    
    if (fetchError) throw fetchError;
    
    const currentIncidents = athlete?.manual_controversy_incidents || [];
    const updatedIncidents = currentIncidents.filter(i => i.id !== incidentId);
    
    if (updatedIncidents.length === currentIncidents.length) {
      return res.status(404).json({ error: 'Incident not found' });
    }
    
    const { error: updateError } = await supabase
      .from('athletes')
      .update({ manual_controversy_incidents: updatedIncidents })
      .eq('id', athleteId);
    
    if (updateError) throw updateError;
    
    console.log(`✅ Removed manual controversy incident ${incidentId} for athlete ${athleteId}`);
    
    res.json({ 
      success: true,
      removed_id: incidentId,
      remaining_incidents: updatedIncidents.length,
      total_points: updatedIncidents.reduce((sum, i) => sum + i.points, 0)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List manual controversy incidents
app.get('/api/athlete/controversy/list/:athleteId', async (req, res) => {
  try {
    const { data: athlete, error } = await supabase
      .from('athletes')
      .select('manual_controversy_incidents, name')
      .eq('id', req.params.athleteId)
      .single();
    
    if (error) throw error;
    
    const incidents = athlete?.manual_controversy_incidents || [];
    const totalPoints = incidents.reduce((sum, i) => sum + i.points, 0);
    
    res.json({
      athlete_id: req.params.athleteId,
      athlete_name: athlete?.name,
      incidents,
      total_incidents: incidents.length,
      total_points: totalPoints
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Daily job (used by in-process cron and by HTTP trigger for production) ---
// When: in-process cron at 06:00 server time (0 6 * * *). Same logic as POST /api/athlete/refresh (Apify Twitter/Instagram, News, Sentiment).
async function runDailyUpdate() {
  console.log('\n🔄 DAILY UPDATE');
  try {
    const { data: athletes, error } = await supabase.from('athletes').select('*').eq('active', true);
    if (error) throw error;
    for (const a of athletes || []) {
      await collectAthleteData(a.id, a.name, a.twitter_handle, a.instagram_business_id, a.country, a.sport || 'football');
      await new Promise(r => setTimeout(r, 5000));
    }
    console.log('✅ Daily update done');
    return { success: true, updated: (athletes || []).length };
  } catch (e) {
    console.error('❌ Daily update failed:', e);
    throw e;
  }
}

// In-process cron: runs daily at 06:00 server time (same Apify/Instagram logic as manual refresh)
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
