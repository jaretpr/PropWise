document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.sendMessage({ action: 'fetchStats' }, response => {
    if (response && response.stats) {
      displayNBAStats(response.stats);
    }
  });

  // Add event listener to search input
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase();
    filterPlayers(query);
  });
});

let allPlayers = [];

function displayNBAStats(stats) {
  const statsContainer = document.getElementById('statsContainer');
  statsContainer.innerHTML = ''; // Clear previous content

  const players = stats.data;
  const playerDetails = stats.included;
  const today = new Date().toISOString().split('T')[0]; // Get today's date in 'YYYY-MM-DD' format

  // Filter NBA and NBA1H players for today
  const nbaPlayers = players.filter(player => {
    const league = player.relationships.league.data.id;
    const boardTime = player.attributes.board_time ? player.attributes.board_time.split('T')[0] : null;
    const startTime = player.attributes.start_time ? player.attributes.start_time.split('T')[0] : null;
    return (league === '7' || league === '84') && (boardTime === today || startTime === today);
  });

  allPlayers = nbaPlayers.map(projection => {
    const playerId = projection.relationships.new_player.data.id;
    const player = playerDetails.find(p => p.id === playerId);

    if (player) {
      const displayName = player.attributes.display_name;
      const imageUrl = player.attributes.image_url;
      const league = player.attributes.league;
      const market = player.attributes.market;
      const position = player.attributes.position;
      const name = player.attributes.name;
      const team = player.attributes.team;
      const teamName = player.attributes.team_name;
      const statType = projection.attributes.stat_type;
      const lineScore = projection.attributes.line_score;
      const description = projection.attributes.description; // Use description for match-up
      const gameTime = projection.attributes.start_time ? new Date(projection.attributes.start_time).toLocaleString('en-US', { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric', 
        hour: 'numeric', 
        minute: 'numeric', 
        hour12: true 
      }) : 'N/A';

      return {
        displayName,
        imageUrl,
        league,
        market,
        position,
        name,
        team,
        teamName,
        statType,
        lineScore,
        matchUp: `vs. ${description}`,
        gameTime
      };
    }
    return null;
  }).filter(player => player !== null);

  renderPlayers(allPlayers);
}

function renderPlayers(players) {
  const statsContainer = document.getElementById('statsContainer');
  statsContainer.innerHTML = ''; // Clear previous content

  if (players.length === 0) {
    statsContainer.innerHTML = '<p class="no-players-found">No players found</p>';
    return;
  }

  players.forEach(player => {
    const playerElement = document.createElement('div');
    playerElement.className = 'player-card';
    playerElement.innerHTML = `
      <div class="player-header">
        <img src="icons/icon48.png" alt="Stats" class="stat-button">
        <img src="${player.imageUrl}" alt="${player.displayName}" class="player-image">
        <img src="icons/live_stats_icon.png" alt="Live Stats" class="live-stats-button">
      </div>
      <div class="player-info">
        <h2>${player.displayName}</h2>
        <p>${player.team} - ${player.position}</p>
        <p>${player.gameTime}</p>
        <p class="match-up">${player.matchUp}</p>
      <div class="stat-line">
        <p class="line-score">${player.lineScore}</p>
        <p class="stat-type">${player.statType}</p>
      </div>
    `;

    // Add event listener for advanced stats button
    playerElement.querySelector('.stat-button').addEventListener('click', () => {
      fetchAndDisplayAdvancedStats(player.displayName);
    });

    // Add event listener for playoff stats button
    playerElement.querySelector('.live-stats-button').addEventListener('click', () => {
      fetchAndDisplayPlayoffStats(player.displayName, 2024);
    });

    statsContainer.appendChild(playerElement);
  });
}

function filterPlayers(query) {
  const filteredPlayers = allPlayers.filter(player => player.displayName.toLowerCase().includes(query));
  renderPlayers(filteredPlayers);
}

function fetchAndDisplayAdvancedStats(names) {
  const playerNames = names.split(' + ');
  const season = 2024; // Assuming the season is the same for both players

  Promise.all(playerNames.map(name => 
    new Promise((resolve) => {
      // Use proper Unicode characters for "Jokić" and "Dončić"
      const correctedName = name.replace('Nikola Jokic', 'Nikola Jokić').replace('Luka Doncic', 'Luka Dončić').replace('Kristaps Porzingis', 'Kristaps Porziņģis');
      chrome.runtime.sendMessage({ action: 'fetchPlayerAdvancedStats', name: correctedName, season }, response => {
        if (response && response.stats) {
          resolve(response.stats);
        } else {
          resolve([]);
        }
      });
    })
  )).then(statsArray => {
    displayAdvancedStats(statsArray);
  });
}

function fetchAndDisplayPlayoffStats(names, season) {
  const playerNames = names.split(' + ');

  Promise.all(playerNames.map(name => 
    new Promise((resolve) => {
	  // Use proper Unicode characters for "Jokić" and "Dončić"
      const correctedName = name.replace('Nikola Jokic', 'Nikola Jokić').replace('Luka Doncic', 'Luka Dončić').replace('Kristaps Porzingis', 'Kristaps Porziņģis');
      chrome.runtime.sendMessage({ action: 'fetchPlayoffStats', name: correctedName, season }, response => {
        if (response && response.stats) {
          resolve(response.stats);
        } else {
          resolve([]);
        }
      });
    })
  )).then(statsArray => {
    displayPlayoffStats(statsArray);
  });
}

function displayAdvancedStats(statsArray) {
  const modal = document.getElementById('advancedStatsModal');
  const modalContent = document.getElementById('advancedStatsContent');
  modalContent.innerHTML = ''; // Clear previous content

  if (statsArray.length > 0) {
    statsArray.forEach(stats => {
      if (stats.length > 0) {
        const playerStats = stats[0];
        const playerContent = `
          <div class="player-stats">
            <h2>${playerStats.playerName} - ${playerStats.team}</h2>
            <p>Age: ${playerStats.age}</p>
            <p>Position: ${playerStats.position}</p>
            <p>Games: ${playerStats.games}</p>
            <p>Games Started: ${playerStats.gamesStarted}</p>
            <p>Minutes per Game: ${playerStats.minutesPg}</p>
            <p>Points: ${playerStats.points}</p>
            <p>Assists: ${playerStats.assists}</p>
            <p>Total Rebounds: ${playerStats.totalRb}</p>
            <p>Defensive Rebounds: ${playerStats.defensiveRb}</p>
            <p>Offensive Rebounds: ${playerStats.offensiveRb}</p>
            <p>Blocks: ${playerStats.blocks}</p>
            <p>Steals: ${playerStats.steals}</p>
            <p>Turnovers: ${playerStats.turnovers}</p>
            <p>Personal Fouls: ${playerStats.personalFouls}</p>
            <p>Field Goals: ${playerStats.fieldGoals}</p>
            <p>Field Attempts: ${playerStats.fieldAttempts}</p>
            <p>Field Percent: ${(playerStats.fieldPercent * 100).toFixed(1)}%</p>
            <p>Effective Field Percent: ${(playerStats.effectFgPercent * 100).toFixed(1)}%</p>
            <p>Two Field Goals: ${playerStats.twoFg}</p>
            <p>Two Attempts: ${playerStats.twoAttempts}</p>
            <p>Two Percent: ${(playerStats.twoPercent * 100).toFixed(1)}%</p>
            <p>Three Field Goals: ${playerStats.threeFg}</p>
            <p>Three Attempts: ${playerStats.threeAttempts}</p>
            <p>Three Percent: ${(playerStats.threePercent * 100).toFixed(1)}%</p>
            <p>Free Throws: ${playerStats.ft}</p>
            <p>Free Throw Attempts: ${playerStats.ftAttempts}</p>
            <p>Free Throw Percent: ${(playerStats.ftPercent * 100).toFixed(1)}%</p>
          </div>
          <hr>`;
        modalContent.innerHTML += playerContent;
      } else {
        modalContent.innerHTML += '<p>No advanced stats available.</p>';
      }
    });
    modal.style.display = 'block';
  } else {
    modalContent.innerHTML = '<p>No advanced stats available.</p>';
    modal.style.display = 'block';
  }

  // Close the modal when the user clicks on <span> (x)
  const span = document.getElementsByClassName('close')[0];
  span.onclick = function() {
    modal.style.display = 'none';
  }

  // Close the modal when the user clicks anywhere outside of the modal
  window.onclick = function(event) {
    if (event.target == modal) {
      modal.style.display = 'none';
    }
  }
}

function fetchAndDisplayPlayoffStats(names, season) {
  const playerNames = names.split(' + ');

  Promise.all(playerNames.map(name => 
    new Promise((resolve) => {
	  const correctedName = name.replace('Nikola Jokic', 'Nikola Jokić').replace('Luka Doncic', 'Luka Dončić').replace('Kristaps Porzingis', 'Kristaps Porziņģis');
      chrome.runtime.sendMessage({ action: 'fetchPlayoffStats', name: correctedName.trim(), season }, response => {
        if (response && response.stats) {
          resolve(response.stats);
        } else {
          resolve([]);
        }
      });
    })
  )).then(statsArray => {
    displayPlayoffStats(statsArray.flat()); // Use flat() to combine stats from multiple players
  });
}

function displayPlayoffStats(statsArray) {
  const modal = document.getElementById('liveStatsModal');
  const modalContent = document.getElementById('liveStatsContent');
  modalContent.innerHTML = ''; // Clear previous content

  if (statsArray.length > 0) {
    statsArray.forEach(playerStats => {
      const games = playerStats.games; // Number of games played

      // Displaying stats, ensuring proper averaging and formatting
      const playerContent = `
          <div class="player-stats">
            <h2>${playerStats.playerName} - ${playerStats.team}</h2>
            <p>Age: ${playerStats.age}</p>
            <p>Position: ${playerStats.position}</p>
            <p>Games: ${games}</p>
            <p>Games Started: ${playerStats.gamesStarted}</p>
            <p>Minutes per Game: ${(playerStats.minutesPg / games).toFixed(1)}</p>
            <p>Points: ${(playerStats.points / games).toFixed(1)}</p>
            <p>Assists: ${(playerStats.assists / games).toFixed(1)}</p>
            <p>Total Rebounds: ${(playerStats.totalRb / games).toFixed(1)}</p>
            <p>Defensive Rebounds: ${(playerStats.defensiveRb / games).toFixed(1)}</p>
            <p>Offensive Rebounds: ${(playerStats.offensiveRb / games).toFixed(1)}</p>
            <p>Blocks: ${(playerStats.blocks / games).toFixed(1)}</p>
            <p>Steals: ${(playerStats.steals / games).toFixed(1)}</p>
            <p>Turnovers: ${(playerStats.turnovers / games).toFixed(1)}</p>
            <p>Personal Fouls: ${(playerStats.personalFouls / games).toFixed(1)}</p>
            <p>Field Goals: ${(playerStats.fieldGoals / games).toFixed(1)}</p>
            <p>Field Attempts: ${(playerStats.fieldAttempts / games).toFixed(1)}</p>
            <p>Field Percent: ${(playerStats.fieldPercent * 100).toFixed(1)}%</p>
            <p>Effective Field Percent: ${(playerStats.effectFgPercent * 100).toFixed(1)}%</p>
            <p>Two Field Goals: ${(playerStats.twoFg / games).toFixed(1)}</p>
            <p>Two Attempts: ${(playerStats.twoAttempts / games).toFixed(1)}</p>
            <p>Two Percent: ${(playerStats.twoPercent * 100).toFixed(1)}%</p>
            <p>Three Field Goals: ${(playerStats.threeFg / games).toFixed(1)}</p>
            <p>Three Attempts: ${(playerStats.threeAttempts / games).toFixed(1)}</p>
            <p>Three Percent: ${(playerStats.threePercent * 100).toFixed(1)}%</p>
            <p>Free Throws: ${(playerStats.ft / games).toFixed(1)}</p>
            <p>Free Throw Attempts: ${(playerStats.ftAttempts / games).toFixed(1)}</p>
            <p>Free Throw Percent: ${(playerStats.ftPercent * 100).toFixed(1)}%</p>
          </div>
          <hr>`;
      modalContent.innerHTML += playerContent;
    });
    modal.style.display = 'block';
  } else {
    modalContent.innerHTML = '<p>No playoff stats available.</p>';
    modal.style.display = 'block';
  }

  // Close the modal when the user clicks on <span> (x)
  const span = document.getElementsByClassName('close')[1];
  span.onclick = function() {
    modal.style.display = 'none';
  }

  // Close the modal when the user clicks anywhere outside of the modal
  window.onclick = function(event) {
    if (event.target == modal) {
      modal.style.display = 'none';
    }
  }
}
