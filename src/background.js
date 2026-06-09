chrome.runtime.onInstalled.addListener(() => {
  console.log("PropWise Extension Installed");
});

// Cache for PrizePicks stats to prevent heavy repeated calls
let prizePicksCache = {};
const CACHE_EXPIRY_MS = 60000; // 1 minute cache for projections
let topPicksCache = {};
const TOP_PICKS_CACHE_EXPIRY_MS = 2 * 60 * 1000;
const performanceProfileCache = new Map();
const rawPlayerProfileCache = new Map();
let mlbPlayerDirectoryPromise = null;
let nflRosterDirectoryPromise = null;
let mlbTeamContextPromise = null;
const gameContextCache = new Map();

const MODEL_VERSION = 'V2';
const PROFILE_CACHE_EXPIRY_MS = 15 * 60 * 1000;

function formatPosition(position) {
  if (position === null || position === undefined || position === '') return 'N/A';
  if (typeof position === 'string' || typeof position === 'number') return String(position);
  if (Array.isArray(position)) {
    const formatted = position.map(formatPosition).filter(value => value !== 'N/A');
    return formatted.length > 0 ? formatted.join(', ') : 'N/A';
  }

  if (typeof position === 'object') {
    const preferredKeys = [
      'abbreviation',
      'abbrev',
      'shortName',
      'short_name',
      'displayName',
      'display_name',
      'name',
      'label',
      'title',
      'value'
    ];

    for (const key of preferredKeys) {
      if (position[key]) return formatPosition(position[key]);
    }
  }

  return 'N/A';
}

async function fetchPrizePicksStats(sport = 'mlb') {
  const cached = prizePicksCache[sport];
  if (cached && (Date.now() - cached.timestamp < CACHE_EXPIRY_MS)) {
    return cached.data;
  }

  try {
    const response = await fetch('https://api.prizepicks.com/projections', {
      method: 'GET',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    const projections = data.data;
    const playerDetails = data.included;

    // Define league IDs for different sports
    const leagueIds = {
      mlb: ['2', '231'], // MLB and MLBLIVE
      nba: ['7', '84', '192'],  // NBA, NBA1H, NBA1Q
      nfl: ['9', '163']  // NFL and NFLSZN
    };

    const sportProjections = projections.filter(proj => {
      const leagueId = proj.relationships.league.data.id;
      return leagueIds[sport] && leagueIds[sport].includes(leagueId);
    });

    // Group projections by player ID to solve the duplicate player cards issue
    const playerStatsMap = {};

    sportProjections.forEach(projection => {
      const playerId = projection.relationships.new_player.data.id;
      const player = playerDetails.find(p => p.id === playerId);

      if (player) {
        const attributes = player.attributes;
        if (!playerStatsMap[playerId]) {
          playerStatsMap[playerId] = {
            id: playerId,
            name: attributes.display_name || attributes.name,
            imageUrl: attributes.image_url,
            league: attributes.league,
            leagueId: String(projection.relationships.league.data.id),
            market: attributes.market,
            position: formatPosition(attributes.position),
            team: attributes.team,
            teamName: attributes.team_name,
            description: projection.attributes.description,
            startTime: projection.attributes.start_time,
            status: projection.attributes.status,
            sport: sport,
            projections: [] // Store all projections for this player
          };
        }

        playerStatsMap[playerId].projections.push({
          id: projection.id,
          statType: projection.attributes.stat_type,
          lineScore: projection.attributes.line_score,
          description: projection.attributes.description,
          leagueId: String(projection.relationships.league.data.id),
          oddsType: projection.attributes.odds_type,
          rank: projection.attributes.rank,
          trendingCount: projection.attributes.trending_count || 0,
          startTime: projection.attributes.start_time,
          status: projection.attributes.status,
          isLive: Boolean(projection.attributes.is_live),
          isPromo: Boolean(projection.attributes.is_promo),
          adjustedOdds: Boolean(projection.attributes.adjusted_odds)
        });
      }
    });

    const playerStats = Object.values(playerStatsMap);
    prizePicksCache[sport] = {
      timestamp: Date.now(),
      data: playerStats
    };

    return playerStats;
  } catch (error) {
    console.error(`Error fetching ${sport.toUpperCase()} stats from PrizePicks:`, error);
    return [];
  }
}

// On-demand Season Stats Fetching
async function fetchOnDemandSeasonStats(name, sport) {
  if (sport === 'mlb') {
    try {
      // 1. Search player
      const searchRes = await fetch(`https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}`);
      if (!searchRes.ok) throw new Error(`Search failed: ${searchRes.status}`);
      const searchData = await searchRes.json();
      if (!searchData.people || searchData.people.length === 0) return null;
      const player = searchData.people[0];
      const personId = player.id;

      // 2. Fetch season stats with year fallbacks (in parallel for maximum speed)
      const currentYear = new Date().getFullYear();
      const years = [currentYear, currentYear - 1, 2024];
      const requests = years.map(year =>
        fetch(`https://statsapi.mlb.com/api/v1/people/${personId}/stats/?stats=season&group=hitting,pitching,fielding&season=${year}`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            const hasSplits = data && data.stats && data.stats.some(s => s.splits && s.splits.length > 0);
            return hasSplits ? data : null;
          })
          .catch(() => null)
      );
      const results = await Promise.all(requests);
      const statsData = results.find(r => r !== null);

      if (!statsData) return null;

      const result = {
        name: player.fullName,
        position: player.primaryPosition?.name || 'N/A',
        battingStats: {},
        pitchingStats: {},
        fieldingStats: {}
      };

      statsData.stats.forEach(groupObj => {
        const groupName = groupObj.group.displayName;
        if (groupObj.splits && groupObj.splits.length > 0) {
          const statData = groupObj.splits[0].stat;
          if (groupName === 'hitting') result.battingStats = statData;
          else if (groupName === 'pitching') result.pitchingStats = statData;
          else if (groupName === 'fielding') result.fieldingStats = statData;
        }
      });

      return result;
    } catch (error) {
      console.error(`Error fetching MLB season stats for ${name}:`, error);
      return null;
    }
  } else if (sport === 'nba' || sport === 'nfl') {
    try {
      const sportName = sport === 'nba' ? 'basketball' : 'football';
      
      // 1. Search player
      const searchRes = await fetch(`https://site.web.api.espn.com/apis/search/v2?query=${encodeURIComponent(name)}&limit=5`);
      if (!searchRes.ok) throw new Error(`Search failed: ${searchRes.status}`);
      const searchData = await searchRes.json();
      const players = searchData.results?.find(r => r.type === 'player');
      if (!players || !players.contents || players.contents.length === 0) return null;
      
      const athlete = players.contents[0];
      const match = athlete.uid.match(/~a:(\d+)/);
      if (!match) return null;
      const athleteId = match[1];

      // 2. Fetch stats with year fallbacks (in parallel for maximum speed)
      const currentYear = new Date().getFullYear();
      const years = [currentYear, currentYear - 1, 2025, 2024];
      const requests = years.map(year =>
        fetch(`https://sports.core.api.espn.com/v2/sports/${sportName}/leagues/${sport}/seasons/${year}/types/2/athletes/${athleteId}/statistics`)
          .then(res => res.ok ? res.json() : null)
          .catch(() => null)
      );
      const results = await Promise.all(requests);
      const statsData = results.find(r => r !== null);

      if (!statsData) return null;

      const battingStats = {};
      const pitchingStats = {};
      const fieldingStats = {};

      if (statsData.splits && statsData.splits.categories) {
        statsData.splits.categories.forEach(cat => {
          cat.stats.forEach(s => {
            const val = s.displayValue;
            if (sport === 'nba') {
              if (cat.name === 'offensive') battingStats[s.name] = val;
              else if (cat.name === 'defensive') pitchingStats[s.name] = val;
              else if (cat.name === 'general') fieldingStats[s.name] = val;
            } else if (sport === 'nfl') {
              if (cat.name === 'passing') battingStats[s.name] = val;
              else if (cat.name === 'rushing' || cat.name === 'receiving') pitchingStats[s.name] = val;
              else if (cat.name === 'defense' || cat.name === 'scoring' || cat.name === 'general') fieldingStats[s.name] = val;
            }
          });
        });
      }

      return {
        name: athlete.displayName,
        position: athlete.position?.abbreviation || athlete.position || 'N/A',
        battingStats,
        pitchingStats,
        fieldingStats
      };
    } catch (error) {
      console.error(`Error fetching ESPN season stats for ${name}:`, error);
      return null;
    }
  }
  return null;
}

// On-demand Live Game Stats Fetching
async function fetchOnDemandLiveStats(name, sport) {
  if (sport === 'mlb') {
    try {
      // 1. Search player
      const searchRes = await fetch(`https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}`);
      if (!searchRes.ok) throw new Error(`Search failed: ${searchRes.status}`);
      const searchData = await searchRes.json();
      if (!searchData.people || searchData.people.length === 0) return null;
      const player = searchData.people[0];
      const personId = player.id;

      // 2. Fetch gamelog with year fallbacks (in parallel for maximum speed)
      const currentYear = new Date().getFullYear();
      const years = [currentYear, currentYear - 1, 2024];
      const requests = years.map(year => {
        const statsUrl = `https://statsapi.mlb.com/api/v1/people/${personId}/stats/?stats=gameLog&group=hitting,pitching,fielding&season=${year}`;
        return fetch(statsUrl)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            const hasSplits = data && data.stats && data.stats.some(s => s.splits && s.splits.length > 0);
            return hasSplits ? data : null;
          })
          .catch(() => null);
      });
      const results = await Promise.all(requests);
      const statsData = results.find(r => r !== null);

      if (!statsData) return null;

      const result = {
        name: player.fullName,
        position: player.primaryPosition?.name || 'N/A',
        battingStats: {},
        pitchingStats: {},
        fieldingStats: {}
      };

      statsData.stats.forEach(groupObj => {
        const groupName = groupObj.group.displayName;
        if (groupObj.splits && groupObj.splits.length > 0) {
          // Sort splits descending to get latest game
          const sortedSplits = [...groupObj.splits].sort((a, b) => new Date(b.date) - new Date(a.date));
          const latestGameStat = sortedSplits[0].stat;
          
          latestGameStat['gameDate'] = sortedSplits[0].date;
          latestGameStat['opponent'] = sortedSplits[0].opponent?.name || 'Unknown';
          
          if (groupName === 'hitting') result.battingStats = latestGameStat;
          else if (groupName === 'pitching') result.pitchingStats = latestGameStat;
          else if (groupName === 'fielding') result.fieldingStats = latestGameStat;
        }
      });

      return result;
    } catch (error) {
      console.error(`Error fetching MLB live stats for ${name}:`, error);
      return null;
    }
  } else if (sport === 'nba' || sport === 'nfl') {
    try {
      const sportName = sport === 'nba' ? 'basketball' : 'football';

      // 1. Search player
      const searchRes = await fetch(`https://site.web.api.espn.com/apis/search/v2?query=${encodeURIComponent(name)}&limit=5`);
      if (!searchRes.ok) throw new Error(`Search failed: ${searchRes.status}`);
      const searchData = await searchRes.json();
      const players = searchData.results?.find(r => r.type === 'player');
      if (!players || !players.contents || players.contents.length === 0) return null;

      const athlete = players.contents[0];
      const match = athlete.uid.match(/~a:(\d+)/);
      if (!match) return null;
      const athleteId = match[1];

      // 2. Fetch gamelog
      const gamelogUrl = `https://site.web.api.espn.com/apis/common/v3/sports/${sportName}/${sport}/athletes/${athleteId}/gamelog`;
      const gamelogRes = await fetch(gamelogUrl);
      if (!gamelogRes.ok) return null;
      const gamelogData = await gamelogRes.json();

      const battingStats = {}; 
      const pitchingStats = {}; 
      const fieldingStats = {};

      if (gamelogData.seasonTypes && gamelogData.seasonTypes.length > 0) {
        let allGamelogEvents = [];
        gamelogData.seasonTypes.forEach(st => {
          if (st.categories) {
            st.categories.forEach(cat => {
              if (cat.events) {
                cat.events.forEach(e => {
                  const eventInfo = gamelogData.events[e.eventId];
                  if (eventInfo) {
                    allGamelogEvents.push({
                      eventId: e.eventId,
                      stats: e.stats,
                      date: eventInfo.gameDate,
                      opponent: eventInfo.opponent?.displayName || 'Unknown',
                      score: eventInfo.score,
                      result: eventInfo.gameResult
                    });
                  }
                });
              }
            });
          }
        });

        if (allGamelogEvents.length > 0) {
          // Sort descending
          allGamelogEvents.sort((a, b) => new Date(b.date) - new Date(a.date));
          const latestEvent = allGamelogEvents[0];
          
          const statsMap = {};
          gamelogData.names.forEach((nameKey, idx) => {
            const val = latestEvent.stats[idx];
            if (val !== undefined) {
              statsMap[nameKey] = val;
            }
          });

          // Add metadata
          statsMap['gameDate'] = new Date(latestEvent.date).toLocaleDateString();
          statsMap['opponent'] = latestEvent.opponent;
          statsMap['score'] = latestEvent.score;
          statsMap['gameResult'] = latestEvent.result;

          if (sport === 'nba') {
            // Offensive
            ['points', 'assists', 'totalRebounds', 'fieldGoalsMade-fieldGoalsAttempted', 'fieldGoalPct', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'threePointPct', 'freeThrowsMade-freeThrowsAttempted', 'freeThrowPct'].forEach(k => {
              if (statsMap[k] !== undefined) battingStats[k] = statsMap[k];
            });
            // Defensive
            ['blocks', 'steals', 'fouls', 'turnovers', 'minutes'].forEach(k => {
              if (statsMap[k] !== undefined) pitchingStats[k] = statsMap[k];
            });
            // Metadata
            fieldingStats['gameDate'] = statsMap['gameDate'];
            fieldingStats['opponent'] = statsMap['opponent'];
            fieldingStats['score'] = statsMap['score'];
            fieldingStats['gameResult'] = statsMap['gameResult'];
          } else if (sport === 'nfl') {
            // Passing
            ['completions', 'passingAttempts', 'passingYards', 'completionPct', 'yardsPerPassAttempt', 'passingTouchdowns', 'interceptions', 'longPassing', 'sacks', 'QBRating', 'adjQBR'].forEach(k => {
              if (statsMap[k] !== undefined) battingStats[k] = statsMap[k];
            });
            // Rushing & Receiving
            ['rushingAttempts', 'rushingYards', 'yardsPerRushAttempt', 'rushingTouchdowns', 'longRushing'].forEach(k => {
              if (statsMap[k] !== undefined) pitchingStats[k] = statsMap[k];
            });
            // Metadata
            fieldingStats['gameDate'] = statsMap['gameDate'];
            fieldingStats['opponent'] = statsMap['opponent'];
            fieldingStats['score'] = statsMap['score'];
            fieldingStats['gameResult'] = statsMap['gameResult'];
          }
        }
      }

      return {
        name: athlete.displayName,
        position: athlete.position?.abbreviation || athlete.position || 'N/A',
        battingStats,
        pitchingStats,
        fieldingStats
      };

    } catch (error) {
      console.error(`Error fetching ESPN live stats for ${name}:`, error);
      return null;
    }
  }
  return null;
}

const supportedPickStats = {
  mlb: new Set([
    'Pitcher Strikeouts',
    'Hits Allowed',
    'Earned Runs Allowed',
    'Pitching Outs',
    'Walks Allowed',
    'Hitter Strikeouts',
    'Singles',
    'Total Bases',
    'Hits',
    'Runs',
    'RBIs',
    'Walks',
    'Hits+Runs+RBIs'
  ]),
  nba: new Set([
    'Points',
    'Rebounds',
    'Assists',
    'Pts+Rebs+Asts',
    'Pts+Asts',
    'Pts+Rebs',
    'Rebs+Asts',
    'Blks+Stls',
    'Turnovers',
    '3-PT Made',
    '3-PT Attempted',
    'Free Throws Made',
    'Free Throws Attempted',
    'FG Attempted',
    'Two Pointers Made',
    'Fantasy Score'
  ]),
  nfl: new Set([
    'Receiving Yards',
    'Rush Yards',
    'Pass Yards',
    'Rec TDs',
    'Rush TDs',
    'Pass TDs',
    'Rush+Rec TDs',
    'Sacks',
    'INT',
    'Regular Season Games Started'
  ])
};

const statReliability = {
  mlb: {
    'Pitcher Strikeouts': 1,
    'Pitching Outs': 0.96,
    'Hits Allowed': 0.78,
    'Walks Allowed': 0.72,
    'Earned Runs Allowed': 0.62,
    'Hitter Strikeouts': 0.88,
    'Hits': 0.76,
    'Total Bases': 0.7,
    'Hits+Runs+RBIs': 0.66,
    'Singles': 0.62,
    'Walks': 0.6,
    'Runs': 0.56,
    'RBIs': 0.54
  },
  nba: {
    'Points': 0.92,
    'Rebounds': 0.88,
    'Assists': 0.88,
    'FG Attempted': 0.88,
    'Pts+Rebs+Asts': 0.82,
    'Pts+Asts': 0.82,
    'Pts+Rebs': 0.82,
    'Rebs+Asts': 0.8,
    'Free Throws Attempted': 0.78,
    '3-PT Attempted': 0.76,
    'Free Throws Made': 0.72,
    'Two Pointers Made': 0.7,
    '3-PT Made': 0.66,
    'Fantasy Score': 0.66,
    'Turnovers': 0.62,
    'Blks+Stls': 0.5
  },
  nfl: {
    'Pass Yards': 0.92,
    'Receiving Yards': 0.86,
    'Rush Yards': 0.86,
    'Regular Season Games Started': 0.8,
    'Pass TDs': 0.66,
    'Rush+Rec TDs': 0.58,
    'Rec TDs': 0.54,
    'Rush TDs': 0.54,
    'Sacks': 0.54,
    'INT': 0.48
  }
};

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function madeFromAttempts(value, attemptIndex = 0) {
  if (typeof value !== 'string') return toNumber(value);
  const parts = value.split('-');
  return toNumber(parts[attemptIndex]);
}

function inningsToOuts(value) {
  const text = String(value ?? '');
  const [innings, partial = '0'] = text.split('.');
  const fullInnings = Number(innings);
  const partialOuts = Number(partial);
  if (!Number.isFinite(fullInnings) || !Number.isFinite(partialOuts)) return null;
  return (fullInnings * 3) + partialOuts;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function medianAbsoluteDeviation(values) {
  if (!values.length) return 0;
  const center = median(values);
  return median(values.map(value => Math.abs(value - center))) * 1.4826;
}

function exponentiallyWeightedAverage(values, decay = 0.84) {
  if (!values.length) return 0;
  let weight = 1;
  let weightedTotal = 0;
  let totalWeight = 0;
  values.forEach(value => {
    weightedTotal += value * weight;
    totalWeight += weight;
    weight *= decay;
  });
  return weightedTotal / totalWeight;
}

function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + (0.3275911 * x));
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x ** 2)));
  return 0.5 * (1 + erf);
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function normalizePersonName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function roundStat(value) {
  if (!Number.isFinite(value)) return 'N/A';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getMlbStatValue(statType, stat) {
  const valueMap = {
    'Pitcher Strikeouts': () => toNumber(stat.strikeOuts),
    'Hits Allowed': () => toNumber(stat.hits),
    'Earned Runs Allowed': () => toNumber(stat.earnedRuns),
    'Pitching Outs': () => inningsToOuts(stat.inningsPitched),
    'Walks Allowed': () => toNumber(stat.baseOnBalls),
    'Hitter Strikeouts': () => toNumber(stat.strikeOuts),
    'Total Bases': () => toNumber(stat.totalBases),
    'Hits': () => toNumber(stat.hits),
    'Runs': () => toNumber(stat.runs),
    'RBIs': () => toNumber(stat.rbi),
    'Walks': () => toNumber(stat.baseOnBalls),
    'Singles': () => {
      const hits = toNumber(stat.hits);
      const doubles = toNumber(stat.doubles) || 0;
      const triples = toNumber(stat.triples) || 0;
      const homeRuns = toNumber(stat.homeRuns) || 0;
      return hits === null ? null : hits - doubles - triples - homeRuns;
    },
    'Hits+Runs+RBIs': () => {
      const hits = toNumber(stat.hits);
      const runs = toNumber(stat.runs);
      const rbis = toNumber(stat.rbi);
      return [hits, runs, rbis].some(value => value === null) ? null : hits + runs + rbis;
    }
  };
  return valueMap[statType] ? valueMap[statType]() : null;
}

async function fetchMlbRecentValues(name, statType) {
  const searchRes = await fetch(`https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}`);
  if (!searchRes.ok) return null;
  const searchData = await searchRes.json();
  const player = searchData.people?.find(person =>
    normalizePersonName(person.fullName) === normalizePersonName(name)
  ) || searchData.people?.[0];
  if (!player) return null;

  const currentYear = new Date().getFullYear();
  let statsData = null;
  for (const year of [currentYear, currentYear - 1]) {
    const statsRes = await fetch(
      `https://statsapi.mlb.com/api/v1/people/${player.id}/stats/?stats=gameLog&group=hitting,pitching&season=${year}`
    );
    if (!statsRes.ok) continue;
    const candidate = await statsRes.json();
    if (candidate.stats?.some(group => group.splits?.length)) {
      statsData = candidate;
      break;
    }
  }
  if (!statsData) return null;

  const needsPitching = ['Pitcher Strikeouts', 'Hits Allowed', 'Earned Runs Allowed', 'Pitching Outs', 'Walks Allowed'].includes(statType);
  const targetGroup = needsPitching ? 'pitching' : 'hitting';
  const group = statsData.stats.find(item => item.group?.displayName === targetGroup && item.splits?.length);
  if (!group) return null;

  const values = [...group.splits]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map(split => getMlbStatValue(statType, split.stat || {}))
    .filter(value => Number.isFinite(value))
    .slice(0, 10);

  return values.length ? { values } : null;
}

async function findEspnAthlete(name, sport) {
  const searchRes = await fetch(`https://site.web.api.espn.com/apis/search/v2?query=${encodeURIComponent(name)}&limit=8`);
  if (!searchRes.ok) return null;
  const searchData = await searchRes.json();
  const players = searchData.results?.find(result => result.type === 'player')?.contents || [];
  const athlete = players.find(player =>
    player.defaultLeagueSlug === sport
    && normalizePersonName(player.displayName) === normalizePersonName(name)
  ) || players.find(player => player.defaultLeagueSlug === sport) || players[0];
  if (!athlete) return null;
  const match = athlete.uid?.match(/~a:(\d+)/);
  if (!match) return null;
  return { id: match[1], athlete };
}

function getNbaStatValue(statType, stats) {
  const points = toNumber(stats.points);
  const rebounds = toNumber(stats.totalRebounds);
  const assists = toNumber(stats.assists);
  const blocks = toNumber(stats.blocks);
  const steals = toNumber(stats.steals);
  const turnovers = toNumber(stats.turnovers);
  const fieldGoalsMade = madeFromAttempts(stats['fieldGoalsMade-fieldGoalsAttempted'], 0);
  const fieldGoalsAttempted = madeFromAttempts(stats['fieldGoalsMade-fieldGoalsAttempted'], 1);
  const threesMade = madeFromAttempts(stats['threePointFieldGoalsMade-threePointFieldGoalsAttempted'], 0);
  const threesAttempted = madeFromAttempts(stats['threePointFieldGoalsMade-threePointFieldGoalsAttempted'], 1);
  const freeThrowsMade = madeFromAttempts(stats['freeThrowsMade-freeThrowsAttempted'], 0);
  const freeThrowsAttempted = madeFromAttempts(stats['freeThrowsMade-freeThrowsAttempted'], 1);

  const sum = (...values) => values.some(value => value === null) ? null : values.reduce((total, value) => total + value, 0);
  const valueMap = {
    'Points': points,
    'Rebounds': rebounds,
    'Assists': assists,
    'Pts+Rebs+Asts': sum(points, rebounds, assists),
    'Pts+Asts': sum(points, assists),
    'Pts+Rebs': sum(points, rebounds),
    'Rebs+Asts': sum(rebounds, assists),
    'Blks+Stls': sum(blocks, steals),
    'Turnovers': turnovers,
    '3-PT Made': threesMade,
    '3-PT Attempted': threesAttempted,
    'Free Throws Made': freeThrowsMade,
    'Free Throws Attempted': freeThrowsAttempted,
    'FG Attempted': fieldGoalsAttempted,
    'Two Pointers Made': fieldGoalsMade === null || threesMade === null ? null : fieldGoalsMade - threesMade,
    'Fantasy Score': [points, rebounds, assists, blocks, steals, turnovers].some(value => value === null)
      ? null
      : points + (1.2 * rebounds) + (1.5 * assists) + (3 * blocks) + (3 * steals) - turnovers
  };
  return Number.isFinite(valueMap[statType]) ? valueMap[statType] : null;
}

async function fetchNbaRecentValues(name, statType) {
  const player = await findEspnAthlete(name, 'nba');
  if (!player) return null;
  const gamelogRes = await fetch(
    `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${player.id}/gamelog`
  );
  if (!gamelogRes.ok) return null;
  const gamelogData = await gamelogRes.json();
  if (!Array.isArray(gamelogData.names)) return null;

  const events = new Map();
  (gamelogData.seasonTypes || []).forEach(seasonType => {
    (seasonType.categories || []).forEach(category => {
      (category.events || []).forEach(event => {
        if (!events.has(event.eventId)) events.set(event.eventId, event);
      });
    });
  });

  const values = [...events.values()]
    .map(event => {
      const stats = {};
      gamelogData.names.forEach((key, index) => {
        stats[key] = event.stats?.[index];
      });
      return {
        date: gamelogData.events?.[event.eventId]?.gameDate || '',
        value: getNbaStatValue(statType, stats)
      };
    })
    .filter(item => Number.isFinite(item.value))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10)
    .map(item => item.value);

  return values.length ? { values } : null;
}

function getNflSeasonStat(statType, categories, position) {
  const byCategory = Object.fromEntries(
    categories.map(category => [
      category.name,
      Object.fromEntries((category.stats || []).map(stat => [stat.name, toNumber(stat.displayValue)]))
    ])
  );
  const passing = byCategory.passing || {};
  const rushing = byCategory.rushing || {};
  const receiving = byCategory.receiving || {};
  const defense = byCategory.defensive || byCategory.defense || {};
  const general = byCategory.general || {};
  const scoring = byCategory.scoring || {};

  const valueMap = {
    'Receiving Yards': receiving.receivingYards,
    'Rush Yards': rushing.rushingYards,
    'Pass Yards': passing.passingYards,
    'Rec TDs': receiving.receivingTouchdowns ?? scoring.receivingTouchdowns,
    'Rush TDs': rushing.rushingTouchdowns ?? scoring.rushingTouchdowns,
    'Pass TDs': passing.passingTouchdowns ?? scoring.passingTouchdowns,
    'Rush+Rec TDs': (rushing.rushingTouchdowns ?? scoring.rushingTouchdowns) !== undefined
      && (receiving.receivingTouchdowns ?? scoring.receivingTouchdowns) !== undefined
      ? (rushing.rushingTouchdowns ?? scoring.rushingTouchdowns) + (receiving.receivingTouchdowns ?? scoring.receivingTouchdowns)
      : null,
    'Sacks': defense.sacks,
    'INT': position === 'QB' ? passing.interceptions : defense.interceptions,
    'Regular Season Games Started': general.gamesStarted
  };

  const gamesPlayed = general.gamesPlayed
    ?? passing.gamesPlayed
    ?? rushing.gamesPlayed
    ?? receiving.gamesPlayed
    ?? defense.gamesPlayed;
  const value = valueMap[statType];
  return Number.isFinite(value) && Number.isFinite(gamesPlayed) && gamesPlayed > 0
    ? { value, gamesPlayed }
    : null;
}

function getCachedRawProfile(cacheKey, loader) {
  const cached = rawPlayerProfileCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < PROFILE_CACHE_EXPIRY_MS) return cached.promise;
  const promise = loader().catch(error => {
    console.warn(`Unable to load ${cacheKey}:`, error);
    return null;
  });
  rawPlayerProfileCache.set(cacheKey, { timestamp: Date.now(), promise });
  return promise;
}

async function getMlbPlayerDirectory() {
  if (!mlbPlayerDirectoryPromise) {
    mlbPlayerDirectoryPromise = fetch(
      `https://statsapi.mlb.com/api/v1/sports/1/players?season=${new Date().getFullYear()}`
    ).then(response => response.ok ? response.json() : null).then(data => {
      const directory = new Map();
      (data?.people || []).forEach(person => directory.set(normalizePersonName(person.fullName), person));
      return directory;
    }).catch(() => new Map());
  }
  return mlbPlayerDirectoryPromise;
}

async function fetchMlbRawProfile(name) {
  return getCachedRawProfile(`mlb:${normalizePersonName(name)}`, async () => {
    const directory = await getMlbPlayerDirectory();
    let person = directory.get(normalizePersonName(name));
    if (!person) {
      const searchRes = await fetch(`https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}`);
      if (!searchRes.ok) return null;
      const searchData = await searchRes.json();
      person = searchData.people?.[0];
    }
    if (!person) return null;

    const currentYear = new Date().getFullYear();
    for (const year of [currentYear, currentYear - 1]) {
      const statsRes = await fetch(
        `https://statsapi.mlb.com/api/v1/people/${person.id}/stats/?stats=gameLog&group=hitting,pitching&season=${year}`
      );
      if (!statsRes.ok) continue;
      const statsData = await statsRes.json();
      if (!statsData.stats?.some(group => group.splits?.length)) continue;
      return {
        person,
        year,
        groups: Object.fromEntries(
          statsData.stats
            .filter(group => group.splits?.length)
            .map(group => [
              group.group.displayName,
              [...group.splits].sort((a, b) => new Date(b.date) - new Date(a.date))
            ])
        )
      };
    }
    return null;
  });
}

async function fetchNbaRawProfile(name) {
  return getCachedRawProfile(`nba:${normalizePersonName(name)}`, async () => {
    const player = await findEspnAthlete(name, 'nba');
    if (!player) return null;
    const gamelogRes = await fetch(
      `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${player.id}/gamelog`
    );
    if (!gamelogRes.ok) return null;
    const gamelogData = await gamelogRes.json();
    if (!Array.isArray(gamelogData.names)) return null;

    const events = new Map();
    (gamelogData.seasonTypes || []).forEach(seasonType => {
      (seasonType.categories || []).forEach(category => {
        (category.events || []).forEach(event => {
          if (!events.has(event.eventId)) events.set(event.eventId, event);
        });
      });
    });

    const games = [...events.values()].map(event => {
      const stats = {};
      gamelogData.names.forEach((key, index) => {
        stats[key] = event.stats?.[index];
      });
      return {
        date: gamelogData.events?.[event.eventId]?.gameDate || '',
        stats
      };
    }).sort((a, b) => new Date(b.date) - new Date(a.date));

    return { athlete: player.athlete, games };
  });
}

async function getNflRosterDirectory() {
  if (!nflRosterDirectoryPromise) {
    nflRosterDirectoryPromise = (async () => {
      const teamsRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams');
      if (!teamsRes.ok) return new Map();
      const teamsData = await teamsRes.json();
      const teams = teamsData.sports?.[0]?.leagues?.[0]?.teams || [];
      const rosters = await mapWithConcurrency(teams, 8, async teamEntry => {
        const team = teamEntry.team;
        const [rosterRes, depthRes] = await Promise.all([
          fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.id}/roster`),
          fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.id}/depthcharts`)
        ]);
        if (!rosterRes.ok) return [];
        const rosterData = await rosterRes.json();
        const depthData = depthRes.ok ? await depthRes.json() : null;
        const depthRanks = new Map();
        (depthData?.depthchart || []).forEach(chart => {
          Object.values(chart.positions || {}).forEach(position => {
            (position.athletes || []).forEach((athlete, index) => {
              const currentRank = depthRanks.get(String(athlete.id));
              const rank = index + 1;
              if (!currentRank || rank < currentRank) depthRanks.set(String(athlete.id), rank);
            });
          });
        });
        return (rosterData.athletes || []).flatMap(group => group.items || []).map(athlete => ({
          ...athlete,
          team: team.abbreviation,
          depthRank: depthRanks.get(String(athlete.id)) || null
        }));
      });
      const directory = new Map();
      rosters.flat().forEach(athlete => directory.set(normalizePersonName(athlete.fullName), athlete));
      return directory;
    })().catch(() => new Map());
  }
  return nflRosterDirectoryPromise;
}

async function fetchNflRawProfile(name) {
  return getCachedRawProfile(`nfl:${normalizePersonName(name)}`, async () => {
    const directory = await getNflRosterDirectory();
    let athlete = directory.get(normalizePersonName(name));
    let athleteId = athlete?.id;
    if (!athleteId) {
      const searchResult = await findEspnAthlete(name, 'nfl');
      athleteId = searchResult?.id;
      athlete = searchResult?.athlete;
    }
    if (!athleteId) return null;

    const currentYear = new Date().getFullYear();
    const seasonData = await Promise.all([currentYear - 1, currentYear - 2].map(async year => {
      const statsRes = await fetch(
        `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${year}/types/2/athletes/${athleteId}/statistics`
      );
      if (!statsRes.ok) return null;
      const statsData = await statsRes.json();
      return { year, categories: statsData.splits?.categories || [] };
    }));

    return { athlete, seasons: seasonData.filter(Boolean) };
  });
}

function getPerformanceProfile(player, projection, sport) {
  const cacheKey = `${MODEL_VERSION}:${sport}:${player.name}:${projection.statType}`;
  const cached = performanceProfileCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < PROFILE_CACHE_EXPIRY_MS) return cached.promise;

  const profilePromise = (async () => {
    if (sport === 'mlb') {
      const raw = await fetchMlbRawProfile(player.name);
      if (!raw) return null;
      const pitchingStats = ['Pitcher Strikeouts', 'Hits Allowed', 'Earned Runs Allowed', 'Pitching Outs', 'Walks Allowed'];
      const groupName = pitchingStats.includes(projection.statType) ? 'pitching' : 'hitting';
      const splits = raw.groups[groupName] || [];
      const values = splits
        .map(split => getMlbStatValue(projection.statType, split.stat || {}))
        .filter(Number.isFinite)
        .slice(0, 15);
      const roleValues = splits.map(split => groupName === 'pitching'
        ? (toNumber(split.stat?.numberOfPitches) ?? inningsToOuts(split.stat?.inningsPitched))
        : (toNumber(split.stat?.plateAppearances) ?? toNumber(split.stat?.atBats))
      ).filter(Number.isFinite).slice(0, 15);
      return { values, roleValues, dates: splits.map(split => split.date).slice(0, 15), year: raw.year };
    }

    if (sport === 'nba') {
      const raw = await fetchNbaRawProfile(player.name);
      if (!raw) return null;
      const games = raw.games.map(game => ({
        date: game.date,
        value: getNbaStatValue(projection.statType, game.stats),
        minutes: toNumber(game.stats.minutes)
      })).filter(game => Number.isFinite(game.value)).slice(0, 15);
      return {
        values: games.map(game => game.value),
        roleValues: games.map(game => game.minutes).filter(Number.isFinite),
        dates: games.map(game => game.date)
      };
    }

    const raw = await fetchNflRawProfile(player.name);
    if (!raw) return null;
    const seasons = raw.seasons.map(season => {
      const seasonStat = getNflSeasonStat(projection.statType, season.categories, formatPosition(player.position));
      return seasonStat ? {
        year: season.year,
        total: seasonStat.value,
        gamesPlayed: seasonStat.gamesPlayed,
        perGame: seasonStat.value / seasonStat.gamesPlayed
      } : null;
    }).filter(Boolean);
    return { seasons, athlete: raw.athlete };
  })().catch(() => null);

  performanceProfileCache.set(cacheKey, { timestamp: Date.now(), promise: profilePromise });
  return profilePromise;
}

async function getMlbTeamContext() {
  if (!mlbTeamContextPromise) {
    mlbTeamContextPromise = (async () => {
      const season = new Date().getFullYear();
      const teamsRes = await fetch(`https://statsapi.mlb.com/api/v1/teams?sportId=1&season=${season}`);
      if (!teamsRes.ok) return null;
      const teamsData = await teamsRes.json();
      const rows = await mapWithConcurrency(teamsData.teams || [], 8, async team => {
        const statsRes = await fetch(
          `https://statsapi.mlb.com/api/v1/teams/${team.id}/stats?stats=season&group=hitting,pitching&season=${season}`
        );
        if (!statsRes.ok) return null;
        const statsData = await statsRes.json();
        const groups = Object.fromEntries((statsData.stats || []).map(group => [
          group.group.displayName,
          group.splits?.[0]?.stat || {}
        ]));
        return { abbreviation: team.abbreviation, groups };
      });
      const teams = new Map(rows.filter(Boolean).map(row => [row.abbreviation, row.groups]));
      const metricAverage = (group, key) => average([...teams.values()].map(groups => {
        const stats = groups[group] || {};
        const games = toNumber(stats.gamesPlayed);
        const value = toNumber(stats[key]);
        return games && value !== null ? value / games : null;
      }).filter(Number.isFinite));
      return {
        teams,
        averages: {
          hittingStrikeouts: metricAverage('hitting', 'strikeOuts'),
          hittingHits: metricAverage('hitting', 'hits'),
          hittingRuns: metricAverage('hitting', 'runs'),
          hittingWalks: metricAverage('hitting', 'baseOnBalls'),
          pitchingStrikeouts: metricAverage('pitching', 'strikeOuts'),
          pitchingHits: metricAverage('pitching', 'hits'),
          pitchingRuns: metricAverage('pitching', 'runs'),
          pitchingWalks: metricAverage('pitching', 'baseOnBalls')
        }
      };
    })().catch(() => null);
  }
  return mlbTeamContextPromise;
}

function getOpponentCode(description) {
  const match = String(description || '').trim().match(/^([A-Z]{2,3})\b/);
  return match ? match[1] : null;
}

function getMlbContextAdjustment(statType, description, context) {
  const opponent = getOpponentCode(description);
  const groups = opponent ? context?.teams?.get(opponent) : null;
  if (!groups) return { multiplier: 1, notes: [] };
  const hitting = groups.hitting || {};
  const pitching = groups.pitching || {};
  const perGame = (stats, key) => {
    const games = toNumber(stats.gamesPlayed);
    const value = toNumber(stats[key]);
    return games && value !== null ? value / games : null;
  };
  const metricMap = {
    'Pitcher Strikeouts': [perGame(hitting, 'strikeOuts'), context.averages.hittingStrikeouts, 0.35],
    'Hits Allowed': [perGame(hitting, 'hits'), context.averages.hittingHits, 0.24],
    'Earned Runs Allowed': [perGame(hitting, 'runs'), context.averages.hittingRuns, 0.28],
    'Walks Allowed': [perGame(hitting, 'baseOnBalls'), context.averages.hittingWalks, 0.26],
    'Hitter Strikeouts': [perGame(pitching, 'strikeOuts'), context.averages.pitchingStrikeouts, 0.28],
    'Hits': [perGame(pitching, 'hits'), context.averages.pitchingHits, 0.22],
    'Singles': [perGame(pitching, 'hits'), context.averages.pitchingHits, 0.18],
    'Total Bases': [perGame(pitching, 'hits'), context.averages.pitchingHits, 0.2],
    'Runs': [perGame(pitching, 'runs'), context.averages.pitchingRuns, 0.24],
    'RBIs': [perGame(pitching, 'runs'), context.averages.pitchingRuns, 0.24],
    'Hits+Runs+RBIs': [perGame(pitching, 'runs'), context.averages.pitchingRuns, 0.24],
    'Walks': [perGame(pitching, 'baseOnBalls'), context.averages.pitchingWalks, 0.24]
  };
  const [value, leagueAverage, influence] = metricMap[statType] || [];
  if (!Number.isFinite(value) || !Number.isFinite(leagueAverage) || leagueAverage <= 0) {
    return { multiplier: 1, notes: [] };
  }
  const multiplier = clamp(1 + (((value / leagueAverage) - 1) * influence), 0.9, 1.1);
  const direction = multiplier >= 1 ? 'raises' : 'lowers';
  return {
    multiplier,
    notes: [`${opponent} context ${direction} the projection ${Math.round(Math.abs(multiplier - 1) * 100)}%.`]
  };
}

function normalizeTeamCode(team) {
  const aliases = {
    NYK: 'NY',
    SAS: 'SA',
    GSW: 'GS',
    NOP: 'NO',
    UTA: 'UTAH'
  };
  return aliases[team] || team;
}

async function getGameContexts(sport, startTime) {
  const date = String(startTime || '').slice(0, 10).replace(/-/g, '');
  if (!date) return [];
  const cacheKey = `${sport}:${date}`;
  if (!gameContextCache.has(cacheKey)) {
    const sportName = sport === 'nba' ? 'basketball' : 'football';
    gameContextCache.set(cacheKey, fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${sportName}/${sport}/scoreboard?dates=${date}`
    ).then(response => response.ok ? response.json() : null).then(data => data?.events || []).catch(() => []));
  }
  return gameContextCache.get(cacheKey);
}

async function getNbaContextAdjustment(player, projection) {
  const events = await getGameContexts('nba', projection.startTime || player.startTime);
  const team = normalizeTeamCode(player.team);
  const event = events.find(item => item.competitions?.[0]?.competitors?.some(
    competitor => normalizeTeamCode(competitor.team?.abbreviation) === team
  ));
  const competition = event?.competitions?.[0];
  const odds = competition?.odds?.[0];
  let multiplier = 1;
  const notes = [];

  const total = toNumber(odds?.overUnder);
  if (total !== null) {
    const totalMultiplier = clamp(1 + (((total / 228) - 1) * 0.28), 0.96, 1.04);
    multiplier *= totalMultiplier;
    if (Math.abs(totalMultiplier - 1) >= 0.008) {
      notes.push(`The ${roundStat(total)} game total ${totalMultiplier >= 1 ? 'supports' : 'tempers'} counting stats.`);
    }
  }

  const spread = Math.abs(toNumber(odds?.spread) || 0);
  if (spread >= 10) {
    multiplier *= 0.975;
    notes.push('A large spread adds some playing-time risk.');
  }
  return { multiplier, notes };
}

function getRoleAdjustment(roleValues) {
  if (!roleValues?.length || roleValues.length < 6) return { multiplier: 1, stability: 0.7, notes: [] };
  const recent = average(roleValues.slice(0, 5));
  const baseline = average(roleValues.slice(0, 12));
  const roleSigma = standardDeviation(roleValues.slice(0, 12));
  const multiplier = baseline > 0
    ? clamp(1 + (((recent / baseline) - 1) * 0.35), 0.92, 1.08)
    : 1;
  const stability = baseline > 0 ? clamp(1 - (roleSigma / (baseline + 1)), 0.35, 1) : 0.7;
  const notes = Math.abs(multiplier - 1) >= 0.015
    ? [`Recent role ${multiplier >= 1 ? 'is above' : 'is below'} the longer baseline.`]
    : [];
  return { multiplier, stability, notes };
}

async function analyzeRecentPickV2(player, projection, sport, profile, sportContext) {
  const values = profile?.values || [];
  const line = toNumber(projection.lineScore);
  if (line === null || values.length < 8) return null;

  const sample = values.slice(0, 15);
  const recentWeighted = exponentiallyWeightedAverage(sample);
  const robustCenter = (recentWeighted * 0.5) + (median(sample.slice(0, 10)) * 0.3) + (average(sample) * 0.2);
  const role = getRoleAdjustment(profile.roleValues);
  const context = sport === 'mlb'
    ? getMlbContextAdjustment(projection.statType, projection.description, sportContext)
    : await getNbaContextAdjustment(player, projection);
  const rawProjection = robustCenter * role.multiplier * context.multiplier;
  const sigma = Math.max(
    standardDeviation(sample),
    medianAbsoluteDeviation(sample),
    Math.abs(robustCenter) * 0.08,
    0.35
  );
  const consistency = clamp(1 - (sigma / (Math.abs(robustCenter) + sigma + 0.5)), 0.2, 0.95);
  const sampleReliability = clamp(sample.length / 15, 0.45, 1);
  const typeReliability = statReliability[sport]?.[projection.statType] || 0.5;
  const reliability = clamp(
    sampleReliability * typeReliability * (0.7 + (consistency * 0.3)) * (0.75 + (role.stability * 0.25)),
    0.25,
    0.96
  );
  const modelProjection = line + ((rawProjection - line) * (0.55 + (0.35 * reliability)));
  const direction = modelProjection >= line ? 'more' : 'less';
  const nonPushValues = sample.filter(value => value !== line);
  const hits = nonPushValues.filter(value => direction === 'more' ? value > line : value < line).length;
  const misses = nonPushValues.length - hits;
  if (nonPushValues.length < 7) return null;

  const empiricalProbability = (hits + 2.5) / (hits + misses + 5);
  const zScore = (line - modelProjection) / sigma;
  const distributionProbability = direction === 'more' ? 1 - normalCdf(zScore) : normalCdf(zScore);
  const blendedProbability = 0.58 * empiricalProbability + 0.42 * distributionProbability;
  const adjustedProbability = 0.5 + ((blendedProbability - 0.5) * (0.7 + (0.3 * reliability)));
  const standardizedEdge = Math.abs(modelProjection - line) / sigma;
  const edgePercent = (Math.abs(modelProjection - line) / Math.max(Math.abs(line), 1)) * 100;

  if (adjustedProbability < 0.565 || standardizedEdge < 0.16 || hits / nonPushValues.length < 0.53) return null;

  const confidence = Math.round(clamp(
    50 + ((adjustedProbability - 0.5) * 100 * reliability) + (Math.min(standardizedEdge, 1.5) * 5),
    52,
    91
  ));
  const consistencyScore = Math.round(consistency * 100);
  const notes = [...role.notes, ...context.notes];
  const reason = `${MODEL_VERSION} projects ${roundStat(modelProjection)} against ${roundStat(line)}. `
    + `${direction === 'more' ? 'More' : 'Less'} hit ${hits} of ${nonPushValues.length} non-push games with `
    + `${consistencyScore}/100 consistency.${notes.length ? ` ${notes.slice(0, 2).join(' ')}` : ''}`;

  return {
    direction,
    confidence,
    hitRate: Math.round((hits / nonPushValues.length) * 100),
    recentAverage: roundStat(modelProjection),
    modelProjection: roundStat(modelProjection),
    consistency: consistencyScore,
    edgePercent: Math.round(edgePercent),
    sampleSize: nonPushValues.length,
    reason,
    score: ((adjustedProbability - 0.5) * 100) + (standardizedEdge * 10) + (reliability * 12) + (typeReliability * 5)
  };
}

function getNflAgeAdjustment(position, age) {
  if (!Number.isFinite(age)) return 1;
  if (position === 'RB' && age >= 29) return 0.94;
  if (position === 'WR' && age >= 31) return 0.96;
  if (position === 'TE' && age >= 32) return 0.97;
  if (position === 'QB' && age >= 36) return 0.97;
  if (age <= 24) return 1.02;
  return 1;
}

function hasMaterialInjury(athlete) {
  const text = JSON.stringify(athlete?.injuries || []).toLowerCase();
  return ['out', 'injured reserve', 'physically unable', 'questionable'].some(status => text.includes(status));
}

function getNflRoleReliability(player, projection, athlete) {
  const position = formatPosition(player.position);
  const depthRank = toNumber(athlete?.depthRank);
  let reliability = 1;
  let disqualified = false;
  const notes = [];

  if (['Pass Yards', 'Pass TDs'].includes(projection.statType)) {
    if (position !== 'QB') disqualified = true;
    if (depthRank !== null && depthRank > 1) disqualified = true;
  } else if (projection.statType === 'Rush Yards') {
    if (position === 'RB') {
      reliability *= depthRank === null ? 0.78 : depthRank === 1 ? 1 : depthRank === 2 ? 0.78 : 0.5;
    } else if (position === 'QB') {
      reliability *= 0.82;
    } else {
      reliability *= 0.58;
      notes.push('Rushing volume is secondary to the listed position.');
    }
  } else if (projection.statType === 'Receiving Yards') {
    if (['WR', 'TE'].includes(position)) {
      reliability *= depthRank === null ? 0.78 : depthRank === 1 ? 1 : depthRank === 2 ? 0.8 : 0.55;
    } else if (position === 'RB') {
      reliability *= 0.72;
    } else {
      reliability *= 0.5;
    }
  }

  if (depthRank !== null && depthRank > 1) {
    notes.push(`Current depth-chart rank is ${depthRank}.`);
  }
  return { reliability, disqualified, notes };
}

function analyzeNflPickV2(player, projection, profile) {
  const line = toNumber(projection.lineScore);
  const seasons = profile?.seasons || [];
  if (line === null || !seasons.length) return null;

  const weights = seasons.length > 1 ? [0.68, 0.32] : [1];
  const weightedRate = seasons.reduce((sum, season, index) => sum + (season.perGame * weights[index]), 0);
  const weightedGames = seasons.reduce((sum, season, index) => sum + (season.gamesPlayed * weights[index]), 0);
  const expectedGames = projection.statType === 'Regular Season Games Started'
    ? clamp((17 * 0.6) + (weightedGames * 0.4), 8, 17)
    : clamp((17 * 0.62) + (weightedGames * 0.38), 10, 17);
  const position = formatPosition(player.position);
  const age = toNumber(profile.athlete?.age);
  const role = getNflRoleReliability(player, projection, profile.athlete);
  if (role.disqualified) return null;
  const ageAdjustment = getNflAgeAdjustment(position, age);
  const injuryAdjustment = hasMaterialInjury(profile.athlete) ? 0.93 : 1;
  const rawProjection = projection.statType === 'Regular Season Games Started'
    ? expectedGames * ageAdjustment * injuryAdjustment
    : weightedRate * expectedGames * ageAdjustment * injuryAdjustment;
  const typeReliability = statReliability.nfl[projection.statType] || 0.5;
  const availabilityReliability = clamp(weightedGames / 17, 0.45, 1);
  const seasonReliability = seasons.length > 1 ? 1 : 0.72;
  const reliability = clamp(
    typeReliability * availabilityReliability * seasonReliability * role.reliability,
    0.2,
    0.92
  );
  if (reliability < 0.46) return null;
  const modelProjection = line + ((rawProjection - line) * (0.35 + (0.3 * reliability)));
  const direction = modelProjection >= line ? 'more' : 'less';
  const yearOverYearSpread = seasons.length > 1
    ? Math.abs(seasons[0].perGame - seasons[1].perGame) * expectedGames
    : Math.abs(modelProjection) * 0.16;
  const baseVolatility = {
    'Pass Yards': 0.14,
    'Receiving Yards': 0.2,
    'Rush Yards': 0.2,
    'Regular Season Games Started': 0.14,
    'Pass TDs': 0.24,
    'Rush+Rec TDs': 0.3,
    'Rec TDs': 0.32,
    'Rush TDs': 0.32,
    'Sacks': 0.3,
    'INT': 0.34
  }[projection.statType] || 0.25;
  const sigma = Math.max(
    Math.abs(modelProjection) * baseVolatility,
    yearOverYearSpread * 0.55,
    Math.abs(rawProjection - line) * 0.35,
    0.75
  );
  const zScore = (line - modelProjection) / sigma;
  const rawProbability = direction === 'more' ? 1 - normalCdf(zScore) : normalCdf(zScore);
  const adjustedProbability = 0.5 + ((rawProbability - 0.5) * (0.68 + (0.32 * reliability)));
  const standardizedEdge = Math.abs(modelProjection - line) / sigma;
  const edgePercent = (Math.abs(modelProjection - line) / Math.max(Math.abs(line), 1)) * 100;
  if (adjustedProbability < 0.57 || standardizedEdge < 0.18 || edgePercent < 5 || reliability < 0.52) return null;

  const consistency = Math.round(clamp(reliability * 100, 30, 90));
  const confidence = Math.round(clamp(
    50 + ((adjustedProbability - 0.5) * 100 * reliability) + (Math.min(standardizedEdge, 1.5) * 5),
    52,
    87
  ));
  const latest = seasons[0];
  const injuryNote = injuryAdjustment < 1 ? ' Current injury status reduces the estimate.' : '';
  const ageNote = ageAdjustment < 1 ? ' Age-curve regression is included.' : '';
  const reason = `${MODEL_VERSION} projects ${roundStat(modelProjection)} against ${roundStat(line)} using `
    + `${seasons.length} season${seasons.length === 1 ? '' : 's'} and ${roundStat(expectedGames)} expected games. `
    + `Latest production was ${roundStat(latest.total)} in ${latest.gamesPlayed} games.${injuryNote}${ageNote}`
    + `${role.notes.length ? ` ${role.notes.join(' ')}` : ''}`;

  return {
    direction,
    confidence,
    hitRate: null,
    recentAverage: roundStat(modelProjection),
    modelProjection: roundStat(modelProjection),
    consistency,
    edgePercent: Math.round(edgePercent),
    sampleSize: latest.gamesPlayed,
    reason,
    score: confidence + (reliability * 10) + (Math.min(standardizedEdge, 1.5) * 3)
  };
}

async function analyzePickCandidateV2(player, projection, sport, sportContext) {
  try {
    const profile = await getPerformanceProfile(player, projection, sport);
    const analysis = sport === 'nfl'
      ? analyzeNflPickV2(player, projection, profile)
      : await analyzeRecentPickV2(player, projection, sport, profile, sportContext);
    if (!analysis) return null;

    return {
      id: `${player.id}-${projection.id}`,
      playerId: player.id,
      name: player.name,
      imageUrl: player.imageUrl,
      team: player.team,
      teamName: player.teamName,
      position: player.position,
      description: projection.description,
      startTime: projection.startTime || player.startTime,
      sport,
      statType: projection.statType,
      lineScore: projection.lineScore,
      projections: [projection],
      modelVersion: MODEL_VERSION,
      ...analysis
    };
  } catch (error) {
    console.warn(`Unable to analyze ${player.name} ${projection.statType}:`, error);
    return null;
  }
}

function selectDiversifiedPicks(analyzed) {
  const selected = [];
  const selectedPlayers = new Set();
  const teamCounts = new Map();
  const statCounts = new Map();
  const matchupCounts = new Map();

  const canSelect = (pick, relaxed = false) => {
    if (selectedPlayers.has(pick.playerId)) return false;
    if (relaxed) return true;
    if ((teamCounts.get(pick.team) || 0) >= 2) return false;
    if ((statCounts.get(pick.statType) || 0) >= 2) return false;
    if (pick.sport === 'mlb' && (matchupCounts.get(pick.description) || 0) >= 2) return false;
    return true;
  };

  const addPick = pick => {
    selected.push(pick);
    selectedPlayers.add(pick.playerId);
    teamCounts.set(pick.team, (teamCounts.get(pick.team) || 0) + 1);
    statCounts.set(pick.statType, (statCounts.get(pick.statType) || 0) + 1);
    matchupCounts.set(pick.description, (matchupCounts.get(pick.description) || 0) + 1);
  };

  for (const pick of analyzed) {
    if (canSelect(pick)) addPick(pick);
    if (selected.length === 5) return selected;
  }
  for (const pick of analyzed) {
    if (canSelect(pick, true)) addPick(pick);
    if (selected.length === 5) break;
  }
  return selected;
}

async function fetchTopPicks(sport = 'mlb') {
  const cached = topPicksCache[sport];
  if (cached && Date.now() - cached.timestamp < TOP_PICKS_CACHE_EXPIRY_MS) {
    return cached.data;
  }

  const leagueIds = {
    mlb: new Set(['2']),
    nba: new Set(['7']),
    nfl: new Set(['163'])
  };
  const players = await fetchPrizePicksStats(sport);
  const candidates = [];

  players.forEach(player => {
    (player.projections || []).forEach(projection => {
      const line = toNumber(projection.lineScore);
      const startTime = projection.startTime ? new Date(projection.startTime).getTime() : 0;
      if (!leagueIds[sport]?.has(projection.leagueId)) return;
      if (!supportedPickStats[sport]?.has(projection.statType)) return;
      if (projection.oddsType !== 'standard' || projection.status !== 'pre_game') return;
      if (projection.isLive || projection.isPromo || projection.adjustedOdds || line === null) return;
      if (startTime && startTime < Date.now() - (5 * 60 * 1000)) return;
      candidates.push({ player, projection });
    });
  });

  const playerGroups = new Map();
  candidates.forEach(candidate => {
    if (!playerGroups.has(candidate.player.id)) {
      playerGroups.set(candidate.player.id, { player: candidate.player, projections: [] });
    }
    playerGroups.get(candidate.player.id).projections.push(candidate.projection);
  });

  const groups = [...playerGroups.values()].sort((a, b) => {
    const aReliability = Math.max(...a.projections.map(projection => statReliability[sport]?.[projection.statType] || 0));
    const bReliability = Math.max(...b.projections.map(projection => statReliability[sport]?.[projection.statType] || 0));
    if (bReliability !== aReliability) return bReliability - aReliability;
    const aInterest = Math.max(...a.projections.map(projection => projection.trendingCount || 0));
    const bInterest = Math.max(...b.projections.map(projection => projection.trendingCount || 0));
    return bInterest - aInterest;
  });

  const profileLimits = { mlb: 120, nba: 40, nfl: 110 };
  const profiledGroups = groups.slice(0, profileLimits[sport]);
  const sportContext = sport === 'mlb' ? await getMlbTeamContext() : null;
  const analyzedGroups = await mapWithConcurrency(profiledGroups, 10, async group => {
    const results = await Promise.all(group.projections.map(projection =>
      analyzePickCandidateV2(group.player, projection, sport, sportContext)
    ));
    return results.filter(Boolean);
  });
  const analyzed = analyzedGroups.flat().sort((a, b) => b.score - a.score);
  const selected = selectDiversifiedPicks(analyzed);

  const data = {
    picks: selected,
    generatedAt: new Date().toISOString(),
    analyzedCount: analyzed.length,
    screenedCount: candidates.length,
    profiledPlayers: profiledGroups.length,
    modelVersion: MODEL_VERSION
  };
  topPicksCache[sport] = { timestamp: Date.now(), data };
  return data;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fetchTopPicks') {
    const sport = message.sport || 'mlb';
    fetchTopPicks(sport).then(data => {
      sendResponse(data);
    }).catch(error => {
      console.error(`Error ranking ${sport.toUpperCase()} picks:`, error);
      sendResponse({ picks: [], generatedAt: new Date().toISOString(), error: true });
    });
    return true;
  } else if (message.action === 'fetchStats') {
    const sport = message.sport || 'mlb';
    fetchPrizePicksStats(sport).then(stats => {
      sendResponse({ stats });
    });
    return true; // Will respond asynchronously
  } else if (message.action === 'fetchLiveGameStats') {
    const { name, sport } = message;
    fetchOnDemandLiveStats(name, sport).then(stats => {
      sendResponse({ stats });
    }).catch(err => {
      console.error(err);
      sendResponse({ stats: null });
    });
    return true; // Will respond asynchronously
  } else if (message.action === 'fetchSeasonStats') {
    const { name, sport } = message;
    fetchOnDemandSeasonStats(name, sport).then(stats => {
      sendResponse({ stats });
    }).catch(err => {
      console.error(err);
      sendResponse({ stats: null });
    });
    return true; // Will respond asynchronously
  }
});
