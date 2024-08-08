chrome.runtime.onInstalled.addListener(() => {
  console.log("PropWise Stats Extension Installed");
});

async function fetchNBAStats() {
  try {
    const response = await fetch('https://api.prizepicks.com/projections', {
      method: 'GET',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching NBA stats:', error);
  }
}

async function fetchPlayerAdvancedStats(name, season) {
  const query = `
    query GetPlayerByNameAndSeason($name: String!, $season: Int!) {
      playerPerGame(name: $name, season: $season) {
        playerName
        team
        points
        assists
        blocks
        fieldGoals
        fieldAttempts
        fieldPercent
        games
        gamesStarted
        offensiveRb
        steals
        threePercent
        threeFg
        threeAttempts
        age
        defensiveRb
        effectFgPercent
        ft
        ftAttempts
        ftPercent
        minutesPg
        personalFouls
        position
        totalRb
        turnovers
        twoAttempts
        twoPercent
        twoFg
      }
    }
  `.trim();

  const variables = {
    name: name,
    season: season
  };

  try {
    const requestBody = JSON.stringify({
      query: query,
      variables: variables,
      operationName: "GetPlayerByNameAndSeason"
    });

    const response = await fetch('https://www.nbaapi.com/graphql/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: requestBody,
    });

    const result = await response.json();

    if (result.errors) {
      console.error('GraphQL errors:', result.errors);
      result.errors.forEach(error => console.error(error.message));
      return [];
    }

    return result.data.playerPerGame || [];
  } catch (error) {
    console.error('Error fetching player advanced stats:', error);
    return [];
  }
}

async function fetchPlayoffStats(name, season) {
  const query = `
    query GetPlayerPlayoffStats($name: String!, $season: Int!) {
      playerTotalsPlayoffs(name: $name, season: $season) {
        id
        playerName
        position
        age
        games
        gamesStarted
        minutesPg
        fieldGoals
        fieldAttempts
        fieldPercent
        threeFg
        threeAttempts
        threePercent
        twoFg
        twoAttempts
        twoPercent
        effectFgPercent
        ft
        ftAttempts
        ftPercent
        offensiveRb
        defensiveRb
        totalRb
        assists
        steals
        blocks
        turnovers
        personalFouls
        points
        team
        season
        playerId
      }
    }
  `.trim();

  const variables = {
    name: name,
    season: season
  };

  try {
    const requestBody = JSON.stringify({
      query: query,
      variables: variables,
      operationName: "GetPlayerPlayoffStats"
    });

    const response = await fetch('https://www.nbaapi.com/graphql/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: requestBody,
    });

    const result = await response.json();

    if (result.errors) {
      console.error('GraphQL errors:', result.errors);
      result.errors.forEach(error => console.error(error.message));
      return [];
    }

    return result.data.playerTotalsPlayoffs || [];
  } catch (error) {
    console.error('Error fetching playoff stats:', error);
    return [];
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fetchStats') {
    fetchNBAStats().then(stats => {
      sendResponse({ stats });
    });
    return true; // Will respond asynchronously
  } else if (message.action === 'fetchPlayerAdvancedStats') {
    const { name, season } = message;
    fetchPlayerAdvancedStats(name, season).then(stats => {
      sendResponse({ stats });
    });
    return true; // Will respond asynchronously
  } else if (message.action === 'fetchPlayoffStats') {
    const { name, season } = message;
    fetchPlayoffStats(name, season).then(stats => {
      sendResponse({ stats });
    });
    return true; // Will respond asynchronously
  }
});
