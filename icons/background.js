chrome.runtime.onInstalled.addListener(() => {
  console.log("PropWise Stats Extension Installed");
});

async function fetchMLBStats() {
  try {
    const response = await fetch('https://statsapi.mlb.com/api/v1/schedule/games/?sportId=1&date=2024-06-20', {
      method: 'GET',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    const gameData = data.dates[0].games;

    const playerStatsPromises = gameData.map(game => fetchPlayerStats(game.gamePk));
    const players = await Promise.all(playerStatsPromises);

    return { players: players.flat() };
  } catch (error) {
    console.error('Error fetching MLB stats:', error);
  }
}

async function fetchPlayerStats(gameId) {
  try {
    const response = await fetch(`https://statsapi.mlb.com/api/v1/game/${gameId}/boxscore`, {
      method: 'GET',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    const players = [];

    // Process home team players
    for (const playerId in data.teams.home.players) {
      const player = data.teams.home.players[playerId];
      players.push(processPlayerStats(player, data.teams.home.team));
    }

    // Process away team players
    for (const playerId in data.teams.away.players) {
      const player = data.teams.away.players[playerId];
      players.push(processPlayerStats(player, data.teams.away.team));
    }

    return players;
  } catch (error) {
    console.error('Error fetching player stats:', error);
    return [];
  }
}

function processPlayerStats(player, team) {
  const seasonAvg = `${player.seasonStats.avg.toFixed(3)} AVG, ${player.seasonStats.hr} HR, ${player.seasonStats.rbi} RBI`;
  const lastGameStats = `${player.stats.hits} H, ${player.stats.homeRuns} HR, ${player.stats.rbi} RBI`;
  return {
    fullName: player.person.fullName,
    imageUrl: `https://mlb.com/images/${player.person.id}.jpg`,
    team: team.name,
    primaryPosition: player.position.abbreviation,
    seasonAvg,
    lastGameStats,
    gameTime: player.gameTime
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fetchMLBStats') {
    fetchMLBStats().then(stats => {
      sendResponse({ stats });
    });
    return true; // Will respond asynchronously
  } else if (message.action === 'fetchPlayerSeasonAvg') {
    fetchPlayerSeasonAvg(message.name).then(stats => {
      sendResponse({ stats });
    });
    return true; // Will respond asynchronously
  } else if (message.action === 'fetchPlayerLastGameStats') {
    fetchPlayerLastGameStats(message.name).then(stats => {
      sendResponse({ stats });
    });
    return true; // Will respond asynchronously
  }
});
