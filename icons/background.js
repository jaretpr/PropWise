chrome.runtime.onInstalled.addListener(() => {
  console.log("PropWise Extension Installed");
});

async function fetchPrizePicksStats() {
  try {
    const response = await fetch('https://api.prizepicks.com/projections', {
      method: 'GET',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    const players = data.data;
    const playerDetails = data.included;

    const mlbPlayers = players.filter(player => {
      const leagueId = player.relationships.league.data.id;
      return leagueId === '2' || leagueId === '231'; // MLB and MLBLIVE league IDs
    });

    const playerStats = mlbPlayers.map(projection => {
      const playerId = projection.relationships.new_player.data.id;
      const player = playerDetails.find(p => p.id === playerId);

      if (player) {
        const attributes = player.attributes;
        return {
          id: playerId,
          name: attributes.display_name,
          imageUrl: attributes.image_url,
          league: attributes.league,
          market: attributes.market,
          position: attributes.position,
          team: attributes.team,
          teamName: attributes.team_name,
          statType: projection.attributes.stat_type,
          lineScore: projection.attributes.line_score,
          description: projection.attributes.description,
          startTime: projection.attributes.start_time,
          status: projection.attributes.status // Include status
        };
      }
      return null;
    }).filter(player => player !== null);

    return playerStats;
  } catch (error) {
    console.error('Error fetching MLB stats from PrizePicks:', error);
  }
}

async function fetchMLBStats(group) {
  const statsUrl = `https://statsapi.mlb.com/api/v1/stats?stats=season&group=${group}&season=2024&gameType=R&limit=100000`;
  const response = await fetch(statsUrl);
  return response.ok ? response.json() : Promise.reject(`Failed to fetch ${group} stats: ${response.status}`);
}

async function fetchCombinedSeasonStats() {
  try {
    const [hittingData, pitchingData, fieldingData] = await Promise.all([
      fetchMLBStats('hitting'),
      fetchMLBStats('pitching'),
      fetchMLBStats('fielding')
    ]);

    const playerStatsMap = {};

    const processStats = (data, statType) => {
      for (const stat of data.stats) {
        for (const split of stat.splits) {
          const player = split.player;
          if (player && player.id) {
            if (!playerStatsMap[player.id]) {
              playerStatsMap[player.id] = {
                id: player.id,
                name: player.fullName,
                position: split.position.name,
                battingStats: {},
                pitchingStats: {},
                fieldingStats: {}
              };
            }
            playerStatsMap[player.id][`${statType}Stats`] = split.stat;
          }
        }
      }
    };

    processStats(hittingData, 'batting');
    processStats(pitchingData, 'pitching');
    processStats(fieldingData, 'fielding');

    return playerStatsMap;
  } catch (error) {
    console.error('Error fetching combined season stats:', error);
  }
}

async function fetchRecentGamesStats(days = 3) {
  let date = new Date();
  const allPlayersStatsMap = {};
  for (let i = 0; i < days; i++) {
    date.setDate(date.getDate() - 1);
    const formattedDate = date.toISOString().split('T')[0];
    console.log(`Checking games for date: ${formattedDate}`);
    const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule/games/?sportId=1&date=${formattedDate}`;
    const scheduleResponse = await fetch(scheduleUrl);

    if (scheduleResponse.ok) {
      const scheduleData = await scheduleResponse.json();
      if (scheduleData.dates.length > 0) {
        const games = scheduleData.dates[0].games;

        for (const game of games) {
          const gameId = game.gamePk;
          console.log(`Fetching boxscore for game ID: ${gameId}`);
          const boxscoreUrl = `https://statsapi.mlb.com/api/v1/game/${gameId}/boxscore`;
          const boxscoreResponse = await fetch(boxscoreUrl);
          if (boxscoreResponse.ok) {
            const boxscoreData = await boxscoreResponse.json();

            for (const teamKey of ['home', 'away']) {
              const team = boxscoreData.teams[teamKey];
              console.log(`Processing team: ${team.team.name}`);
              const players = team.players;

              for (const playerId in players) {
                const playerInfo = players[playerId];
                const playerStat = {
                  id: playerId,
                  name: playerInfo.person.fullName,
                  position: playerInfo.position.name,
                  battingStats: playerInfo.stats.batting || {},
                  pitchingStats: playerInfo.stats.pitching || {},
                  fieldingStats: playerInfo.stats.fielding || {},
                  seasonBattingStats: playerInfo.seasonStats.batting || {},
                  seasonPitchingStats: playerInfo.seasonStats.pitching || {},
                  seasonFieldingStats: playerInfo.seasonStats.fielding || {},
                };

                // Merge stats if player already exists
                if (allPlayersStatsMap[playerId]) {
                  allPlayersStatsMap[playerId] = {
                    ...allPlayersStatsMap[playerId],
                    battingStats: { ...allPlayersStatsMap[playerId].battingStats, ...playerStat.battingStats },
                    pitchingStats: { ...allPlayersStatsMap[playerId].pitchingStats, ...playerStat.pitchingStats },
                    fieldingStats: { ...allPlayersStatsMap[playerId].fieldingStats, ...playerStat.fieldingStats },
                  };
                } else {
                  allPlayersStatsMap[playerId] = playerStat;
                }
              }
            }
          } else {
            console.error(`Failed to retrieve boxscore data for game ${gameId}: ${boxscoreResponse.status}`);
          }
        }
      }
    } else {
      console.error(`Failed to retrieve schedule: ${scheduleResponse.status}`);
    }
  }

  return allPlayersStatsMap;
}

async function fetchAndCombineStats() {
  try {
    const [recentGameStats, seasonStats] = await Promise.all([
      fetchRecentGamesStats(),
      fetchCombinedSeasonStats()
    ]);

    // Merge recent game stats with season stats
    for (const playerId in recentGameStats) {
      if (seasonStats[playerId]) {
        recentGameStats[playerId].seasonBattingStats = seasonStats[playerId].battingStats;
        recentGameStats[playerId].seasonPitchingStats = seasonStats[playerId].pitchingStats;
        recentGameStats[playerId].seasonFieldingStats = seasonStats[playerId].fieldingStats;
      }
    }

    return Object.values(recentGameStats);
  } catch (error) {
    console.error('Error fetching and combining stats:', error);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fetchStats') {
    fetchPrizePicksStats().then(stats => {
      sendResponse({ stats });
    });
    return true; // Will respond asynchronously
  } else if (message.action === 'fetchLiveGameStats') {
    fetchAndCombineStats().then(stats => {
      sendResponse({ stats });
    });
    return true; // Will respond asynchronously
  } else if (message.action === 'fetchSeasonStats') {
    fetchCombinedSeasonStats().then(stats => {
      sendResponse({ stats: Object.values(stats) });
    });
    return true; // Will respond asynchronously
  }
});
