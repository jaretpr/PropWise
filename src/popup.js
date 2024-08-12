document.addEventListener('DOMContentLoaded', () => {
  try {
    chrome.runtime.sendMessage({ action: 'fetchStats' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error fetching stats:', chrome.runtime.lastError);
        return;
      }
      if (response && response.stats) {
        displayMLBStats(response.stats);
      } else {
        console.warn('No stats found in response:', response);
      }
    });
  } catch (error) {
    console.error('Error in DOMContentLoaded event handler:', error);
  }

  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase();
      filterPlayers(query);
    });
  } else {
    console.warn('Search input element not found');
  }
});

let allPlayers = [];

function displayMLBStats(stats) {
  const statsContainer = document.getElementById('statsContainer');
  if (!statsContainer) {
    console.warn('Stats container element not found');
    return;
  }
  
  statsContainer.innerHTML = ''; // Clear previous content

  if (!Array.isArray(stats) || stats.length === 0) {
    statsContainer.innerHTML = '<p class="no-players-found">No players found</p>';
    return;
  }

  allPlayers = stats;
  renderPlayers(allPlayers);
}

function renderPlayers(players) {
  const statsContainer = document.getElementById('statsContainer');
  if (!statsContainer) {
    console.warn('Stats container element not found');
    return;
  }

  statsContainer.innerHTML = ''; // Clear previous content

  if (!Array.isArray(players) || players.length === 0) {
    statsContainer.innerHTML = '<p class="no-players-found">No players found</p>';
    return;
  }

  players.forEach(player => {
    if (!player || !player.name || !player.imageUrl) {
      console.warn('Invalid player data:', player);
      return;
    }

    const playerElement = document.createElement('div');
    playerElement.className = 'player-card';
    playerElement.innerHTML = `
      <div class="player-header">
        <img src="icons/icon48.png" alt="Stats" class="stat-button">
        <img src="${player.imageUrl}" alt="${player.name}" class="player-image">
        <img src="icons/live_stats_icon.png" alt="Live Stats" class="live-stats-button">
      </div>
      <div class="player-info">
        <h2>${player.name}</h2>
        <p>${player.team || 'Unknown Team'} - ${player.position || 'Unknown Position'}</p>
        <p>${new Date(player.startTime).toLocaleString()}</p>
        <p class="match-up">vs. ${player.description || 'No Description'}</p>
        <div class="stat-line">
          <p class="line-score">${player.lineScore || 'N/A'}</p>
          <p class="stat-type">${player.statType || 'N/A'}</p>
        </div>
      </div>
    `;

    const statButton = playerElement.querySelector('.stat-button');
    if (statButton) {
      statButton.addEventListener('click', () => {
        fetchAndDisplayAdvancedStats(player.name);
      });
    }

    const liveStatsButton = playerElement.querySelector('.live-stats-button');
    if (liveStatsButton) {
      liveStatsButton.addEventListener('click', () => {
        fetchAndDisplayLiveGameStats(player.name);
      });
    }

    statsContainer.appendChild(playerElement);
  });
}

function filterPlayers(query) {
  if (typeof query !== 'string') {
    console.error('Invalid query for filtering players:', query);
    return;
  }

  const filteredPlayers = allPlayers.filter(player => player.name.toLowerCase().includes(query));
  renderPlayers(filteredPlayers);
}

function formatStatKey(key) {
  const statKeyMapping = {
    // Mapping as provided
  };

  return statKeyMapping[key] || key;
}

function fetchAndDisplayAdvancedStats(playerName) {
  try {
    chrome.runtime.sendMessage({ action: 'fetchSeasonStats' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error fetching advanced stats:', chrome.runtime.lastError);
        return;
      }
      if (response && response.stats) {
        const playerStats = response.stats.find(player => player.name === playerName);
        displayAdvancedStats(playerStats);
      } else {
        console.warn('No season stats found in response:', response);
      }
    });
  } catch (error) {
    console.error('Error in fetchAndDisplayAdvancedStats:', error);
  }
}

function displayAdvancedStats(player) {
  const modal = document.getElementById('advancedStatsModal');
  const modalContent = document.getElementById('advancedStatsContent');
  if (!modal || !modalContent) {
    console.warn('Modal elements not found');
    return;
  }

  modalContent.innerHTML = ''; // Clear previous content

  if (player) {
    const battingStatsAvailable = player.battingStats && Object.keys(player.battingStats).length > 0;
    const pitchingStatsAvailable = player.pitchingStats && Object.keys(player.pitchingStats).length > 0;
    const fieldingStatsAvailable = player.fieldingStats && Object.keys(player.fieldingStats).length > 0;

    const allStatsUnavailable = !battingStatsAvailable && !pitchingStatsAvailable && !fieldingStatsAvailable;

    if (allStatsUnavailable) {
      modalContent.innerHTML = '<p>Season stats not available.</p>';
    } else {
      const playerContent = `
        <div class="player-stats">
          <h2>${player.name} - ${player.position}</h2>
          <p class="stats-heading">Season Batting Stats:</p>
          ${battingStatsAvailable ? Object.entries(player.battingStats).map(([key, value]) => `<p>${formatStatKey(key)}: ${value}</p>`).join('') : '<p>Season batting stats not available.</p>'}
          <p class="stats-heading">Season Pitching Stats:</p>
          ${pitchingStatsAvailable ? Object.entries(player.pitchingStats).map(([key, value]) => `<p>${formatStatKey(key)}: ${value}</p>`).join('') : '<p>Season pitching stats not available.</p>'}
          <p class="stats-heading">Season Fielding Stats:</p>
          ${fieldingStatsAvailable ? Object.entries(player.fieldingStats).map(([key, value]) => `<p>${formatStatKey(key)}: ${value}</p>`).join('') : '<p>Season fielding stats not available.</p>'}
        </div>
      `;
      modalContent.innerHTML += playerContent;
    }
  } else {
    modalContent.innerHTML = '<p>Season stats not available.</p>';
  }

  modal.style.display = 'block';

  const closeButtons = document.getElementsByClassName('close');
  if (closeButtons.length > 0) {
    closeButtons[0].onclick = function () {
      modal.style.display = 'none';
    };
  } else {
    console.warn('Close button for advanced stats modal not found');
  }

  window.onclick = function (event) {
    if (event.target == modal) {
      modal.style.display = 'none';
    }
  };
}

function fetchAndDisplayLiveGameStats(playerName) {
  try {
    chrome.runtime.sendMessage({ action: 'fetchLiveGameStats' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error fetching live game stats:', chrome.runtime.lastError);
        return;
      }
      if (response && response.stats) {
        const playerStats = response.stats.find(player => player.name === playerName);
        displayLiveGameStats(playerStats);
      } else {
        console.warn('No live game stats found in response:', response);
      }
    });
  } catch (error) {
    console.error('Error in fetchAndDisplayLiveGameStats:', error);
  }
}

function displayLiveGameStats(player) {
  const modal = document.getElementById('liveStatsModal');
  const modalContent = document.getElementById('liveStatsContent');
  if (!modal || !modalContent) {
    console.warn('Modal elements not found');
    return;
  }

  modalContent.innerHTML = ''; // Clear previous content

  if (player) {
    const battingStatsAvailable = player.battingStats && Object.keys(player.battingStats).length > 0;
    const pitchingStatsAvailable = player.pitchingStats && Object.keys(player.pitchingStats).length > 0;
    const fieldingStatsAvailable = player.fieldingStats && Object.keys(player.fieldingStats).length > 0;

    const allStatsUnavailable = !battingStatsAvailable && !pitchingStatsAvailable && !fieldingStatsAvailable;

    if (allStatsUnavailable) {
      modalContent.innerHTML = '<p>Last game\'s stats not available.</p>';
    } else {
      const playerContent = `
        <div class="player-stats">
          <h2>${player.name} - ${player.position}</h2>
          <p class="stats-heading">Last Game's Batting Stats:</p>
          ${battingStatsAvailable ? Object.entries(player.battingStats).map(([key, value]) => `<p>${formatStatKey(key)}: ${value}</p>`).join('') : '<p>Last game\'s batting stats not available.</p>'}
          <p class="stats-heading">Last Game's Pitching Stats:</p>
          ${pitchingStatsAvailable ? Object.entries(player.pitchingStats).map(([key, value]) => `<p>${formatStatKey(key)}: ${value}</p>`).join('') : '<p>Last game\'s pitching stats not available.</p>'}
          <p class="stats-heading">Last Game's Fielding Stats:</p>
          ${fieldingStatsAvailable ? Object.entries(player.fieldingStats).map(([key, value]) => `<p>${formatStatKey(key)}: ${value}</p>`).join('') : '<p>Last game\'s fielding stats not available.</p>'}
        </div>
      `;
      modalContent.innerHTML += playerContent;
    }
  } else {
    modalContent.innerHTML = '<p>Last game\'s stats not available.</p>';
  }

  modal.style.display = 'block';

  const closeButtons = document.getElementsByClassName('close');
  if (closeButtons.length > 1) {
    closeButtons[1].onclick = function () {
      modal.style.display = 'none';
    };
  } else {
    console.warn('Close button for live stats modal not found');
  }

  window.onclick = function (event) {
    if (event.target == modal) {
      modal.style.display = 'none';
    }
  };
}
