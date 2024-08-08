document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.sendMessage({ action: 'fetchMLBStats' }, response => {
    if (response && response.stats) {
      displayMLBStats(response.stats);
    }
  });

  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase();
    filterPlayers(query);
  });
});

let allPlayers = [];

function displayMLBStats(stats) {
  const statsContainer = document.getElementById('statsContainer');
  statsContainer.innerHTML = ''; // Clear previous content

  const players = stats.players;
  const today = new Date().toISOString().split('T')[0]; // Get today's date in 'YYYY-MM-DD' format

  allPlayers = players.map(player => {
    const displayName = player.fullName;
    const imageUrl = player.imageUrl;
    const team = player.team;
    const position = player.primaryPosition;
    const seasonAvg = player.seasonAvg;
    const lastGameStats = player.lastGameStats;
    const gameTime = player.gameTime ? new Date(player.gameTime).toLocaleString('en-US', {
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
      team,
      position,
      seasonAvg,
      lastGameStats,
      gameTime
    };
  });

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
        <div class="stat-line">
          <p class="line-score">${player.seasonAvg}</p>
          <p class="stat-type">Season Avg</p>
        </div>
        <div class="stat-line">
          <p class="line-score">${player.lastGameStats}</p>
          <p class="stat-type">Last Game</p>
        </div>
      </div>
    `;

    playerElement.querySelector('.stat-button').addEventListener('click', () => {
      fetchAndDisplaySeasonAvg(player.displayName);
    });

    playerElement.querySelector('.live-stats-button').addEventListener('click', () => {
      fetchAndDisplayLastGameStats(player.displayName);
    });

    statsContainer.appendChild(playerElement);
  });
}

function filterPlayers(query) {
  const filteredPlayers = allPlayers.filter(player => player.displayName.toLowerCase().includes(query));
  renderPlayers(filteredPlayers);
}

function fetchAndDisplaySeasonAvg(name) {
  chrome.runtime.sendMessage({ action: 'fetchPlayerSeasonAvg', name }, response => {
    if (response && response.stats) {
      displaySeasonAvg(response.stats);
    }
  });
}

function fetchAndDisplayLastGameStats(name) {
  chrome.runtime.sendMessage({ action: 'fetchPlayerLastGameStats', name }, response => {
    if (response && response.stats) {
      displayLastGameStats(response.stats);
    }
  });
}

function displaySeasonAvg(stats) {
  const modal = document.getElementById('seasonAvgModal');
  const modalContent = document.getElementById('seasonAvgContent');
  modalContent.innerHTML = ''; // Clear previous content

  if (stats) {
    const playerContent = `
      <div class="player-stats">
        <h2>${stats.playerName} - ${stats.team}</h2>
        <p>Average: ${stats.average}</p>
        <p>Home Runs: ${stats.homeRuns}</p>
        <p>RBIs: ${stats.RBIs}</p>
        <p>Hits: ${stats.hits}</p>
        <p>Runs: ${stats.runs}</p>
      </div>
    `;
    modalContent.innerHTML += playerContent;
    modal.style.display = 'block';
  } else {
    modalContent.innerHTML += '<p>No season average stats available.</p>';
    modal.style.display = 'block';
  }

  const span = document.getElementsByClassName('close')[0];
  span.onclick = function() {
    modal.style.display = 'none';
  }
  window.onclick = function(event) {
    if (event.target == modal) {
      modal.style.display = 'none';
    }
  }
}

function displayLastGameStats(stats) {
  const modal = document.getElementById('lastGameStatsModal');
  const modalContent = document.getElementById('lastGameStatsContent');
  modalContent.innerHTML = ''; // Clear previous content

  if (stats) {
    const playerContent = `
      <div class="player-stats">
        <h2>${stats.playerName} - ${stats.team}</h2>
        <p>Hits: ${stats.hits}</p>
        <p>Home Runs: ${stats.homeRuns}</p>
        <p>RBIs: ${stats.RBIs}</p>
        <p>Runs: ${stats.runs}</p>
      </div>
    `;
    modalContent.innerHTML += playerContent;
    modal.style.display = 'block';
  } else {
    modalContent.innerHTML += '<p>No last game stats available.</p>';
    modal.style.display = 'block';
  }

  const span = document.getElementsByClassName('close')[1];
  span.onclick = function() {
    modal.style.display = 'none';
  }
  window.onclick = function(event) {
    if (event.target == modal) {
      modal.style.display = 'none';
    }
  }
}
