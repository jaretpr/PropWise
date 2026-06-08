chrome.runtime.onInstalled.addListener(() => {
  console.log("PropWise Extension Installed");
});

// Cache for PrizePicks stats to prevent heavy repeated calls
let prizePicksCache = {};
const CACHE_EXPIRY_MS = 60000; // 1 minute cache for projections

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
            name: attributes.display_name,
            imageUrl: attributes.image_url,
            league: attributes.league,
            market: attributes.market,
            position: formatPosition(attributes.position),
            team: attributes.team,
            teamName: attributes.team_name,
            startTime: projection.attributes.start_time,
            status: projection.attributes.status,
            sport: sport,
            projections: [] // Store all projections for this player
          };
        }

        playerStatsMap[playerId].projections.push({
          statType: projection.attributes.stat_type,
          lineScore: projection.attributes.line_score,
          description: projection.attributes.description
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fetchStats') {
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
