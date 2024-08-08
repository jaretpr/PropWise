document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.sendMessage({ action: 'fetchStats' }, response => {
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

  if (stats.length === 0) {
    statsContainer.innerHTML = '<p class="no-players-found">No players found</p>';
    return;
  }

  allPlayers = stats;

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
        <img src="${player.imageUrl}" alt="${player.name}" class="player-image">
        <img src="icons/live_stats_icon.png" alt="Live Stats" class="live-stats-button">
      </div>
      <div class="player-info">
        <h2>${player.name}</h2>
        <p>${player.team} - ${player.position}</p>
        <p>${new Date(player.startTime).toLocaleString()}</p>
        <p class="match-up">vs. ${player.description}</p>
        <div class="stat-line">
          <p class="line-score">${player.lineScore}</p>
          <p class="stat-type">${player.statType}</p>
        </div>
      </div>
    `;

    playerElement.querySelector('.stat-button').addEventListener('click', () => {
      fetchAndDisplayAdvancedStats(player.name);
    });

    playerElement.querySelector('.live-stats-button').addEventListener('click', () => {
      fetchAndDisplayLiveGameStats(player.name);
    });

    statsContainer.appendChild(playerElement);
  });
}

function filterPlayers(query) {
  const filteredPlayers = allPlayers.filter(player => player.name.toLowerCase().includes(query));
  renderPlayers(filteredPlayers);
}

function formatStatKey(key) {
  const statKeyMapping = {
	note: 'Note',
    summary: 'Summary',
    gamesPlayed: 'Games Played',
    flyOuts: 'Fly Outs',
    groundOuts: 'Ground Outs',
    airOuts: 'Air Outs',
    runs: 'Runs',
    doubles: 'Doubles',
    triples: 'Triples',
    homeRuns: 'Home Runs',
    strikeOuts: 'Strike Outs',
    baseOnBalls: 'Walks',
    intentionalWalks: 'Intentional Walks',
    hits: 'Hits',
    hitByPitch: 'Hit By Pitch',
    avg: 'Average',
    atBats: 'At Bats',
    obp: 'On-Base Percentage',
    slg: 'Slugging Percentage',
    ops: 'On-base Plus Slugging',
    caughtStealing: 'Caught Stealing',
    stolenBases: 'Stolen Bases',
    stolenBasePercentage: 'Stolen Base Percentage',
    groundIntoDoublePlay: 'Ground Into Double Play',
    numberOfPitches: 'Number of Pitches',
    plateAppearances: 'Plate Appearances',
    totalBases: 'Total Bases',
    rbi: 'Runs Batted In',
    leftOnBase: 'Left On Base',
    sacBunts: 'Sacrifice Bunts',
    sacFlies: 'Sacrifice Flies',
    babip: 'Batting Average on Balls In Play',
    groundOutsToAirouts: 'Ground Outs to Air Outs Ratio',
    catchersInterference: 'Catcher’s Interference',
    atBatsPerHomeRun: 'At Bats Per Home Run',
    groundIntoTriplePlay: 'Ground Into Triple Play',
    pickoffs: 'Pickoffs',
    popOuts: 'Pop Outs',
    lineOuts: 'Line Outs',
    assists: 'Assists',
    putOuts: 'Put Outs',
    errors: 'Errors',
    chances: 'Chances',
    fielding: 'Fielding Percentage',
    passedBall: 'Passed Ball',
    gamesStarted: 'Games Started',
    games: 'Games',
    doublePlays: 'Double Plays',
    triplePlays: 'Triple Plays',
    throwingErrors: 'Throwing Errors',
    rangeFactorPerGame: 'Range Factor Per Game',
    rangeFactorPer9Inn: 'Range Factor Per 9 Innings',
    innings: 'Innings',
  };

  return statKeyMapping[key] || key;
}

function fetchAndDisplayAdvancedStats(playerName) {
  chrome.runtime.sendMessage({ action: 'fetchSeasonStats' }, response => {
    if (response && response.stats) {
      const playerStats = response.stats.find(player => player.name === playerName);
      displayAdvancedStats(playerStats);
    }
  });
}

function displayAdvancedStats(player) {
  const modal = document.getElementById('advancedStatsModal');
  const modalContent = document.getElementById('advancedStatsContent');
  modalContent.innerHTML = ''; // Clear previous content

  if (player) {
    const battingStatsAvailable = Object.keys(player.battingStats).length > 0;
    const pitchingStatsAvailable = Object.keys(player.pitchingStats).length > 0;
    const fieldingStatsAvailable = Object.keys(player.fieldingStats).length > 0;

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

  const span = document.getElementsByClassName('close')[0];
  span.onclick = function () {
    modal.style.display = 'none';
  }

  window.onclick = function (event) {
    if (event.target == modal) {
      modal.style.display = 'none';
    }
  }
}

function fetchAndDisplayLiveGameStats(playerName) {
  chrome.runtime.sendMessage({ action: 'fetchLiveGameStats' }, response => {
    if (response && response.stats) {
      const playerStats = response.stats.find(player => player.name === playerName);
      displayLiveGameStats(playerStats);
    }
  });
}

function displayLiveGameStats(player) {
  const modal = document.getElementById('liveStatsModal');
  const modalContent = document.getElementById('liveStatsContent');
  modalContent.innerHTML = ''; // Clear previous content

  if (player) {
    const battingStatsAvailable = Object.keys(player.battingStats).length > 0;
    const pitchingStatsAvailable = Object.keys(player.pitchingStats).length > 0;
    const fieldingStatsAvailable = Object.keys(player.fieldingStats).length > 0;

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

  const span = document.getElementsByClassName('close')[1];
  span.onclick = function () {
    modal.style.display = 'none';
  }

  window.onclick = function (event) {
    if (event.target == modal) {
      modal.style.display = 'none';
    }
  }
}
