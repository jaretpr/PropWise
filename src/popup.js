document.addEventListener('DOMContentLoaded', () => {
  loadCurrentView();

  const viewButtons = document.querySelectorAll('.view-button');
  viewButtons.forEach(button => {
    button.addEventListener('click', () => {
      viewButtons.forEach(viewButton => {
        const isActive = viewButton === button;
        viewButton.classList.toggle('active', isActive);
        viewButton.setAttribute('aria-selected', String(isActive));
      });
      currentView = button.dataset.view;
      updateViewVisibility();
      loadCurrentView();
    });
  });

  const tabButtons = document.querySelectorAll('.tab-button');
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      tabButtons.forEach(tab => tab.classList.remove('active'));
      button.classList.add('active');
      currentSport = button.dataset.sport;
      document.getElementById('searchInput').value = '';
      loadCurrentView();
    });
  });

  const searchInput = document.getElementById('searchInput');
  let searchTimeout = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      filterPlayers(searchInput.value.toLowerCase());
    }, 150);
  });
});

let currentSport = 'mlb';
let currentView = 'players';
let allPlayers = [];
const sportNames = {
  mlb: 'MLB',
  nba: 'NBA',
  nfl: 'NFL'
};

function updateViewVisibility() {
  const isPicksView = currentView === 'picks';
  document.getElementById('playersControls').classList.toggle('hidden', isPicksView);
  document.getElementById('picksIntro').classList.toggle('hidden', !isPicksView);
  document.getElementById('responsibleNote').classList.toggle('hidden', !isPicksView);

  const statsContainer = document.getElementById('statsContainer');
  statsContainer.classList.toggle('players-view', !isPicksView);
  statsContainer.classList.toggle('picks-view', isPicksView);
}

function loadCurrentView() {
  updateViewVisibility();
  if (currentView === 'picks') {
    loadSportPicks(currentSport);
  } else {
    loadSportStats(currentSport);
  }
}

function loadSportStats(sport) {
  currentSport = sport;
  const requestedSport = sport;
  const statsContainer = document.getElementById('statsContainer');
  statsContainer.innerHTML = '<div class="loader-container"><div class="spinner"></div><p>Fetching lines from PrizePicks...</p></div>';

  chrome.runtime.sendMessage({ action: 'fetchStats', sport }, response => {
    if (currentView !== 'players' || currentSport !== requestedSport) return;
    if (chrome.runtime.lastError) {
      statsContainer.innerHTML = '<p class="no-players-found">Failed to fetch data</p>';
    } else if (response && Array.isArray(response.stats)) {
      displayStats(response.stats, sport);
    } else {
      statsContainer.innerHTML = '<p class="no-players-found">Failed to fetch data</p>';
    }
  });
}

function displayStats(stats, sport) {
  allPlayers = stats;
  renderPlayers(allPlayers, sport);
}

function loadSportPicks(sport) {
  currentSport = sport;
  const requestedSport = sport;
  const statsContainer = document.getElementById('statsContainer');
  const picksTitle = document.getElementById('picksTitle');
  const picksSubtitle = document.getElementById('picksSubtitle');
  picksTitle.textContent = `Top ${sportNames[sport]} Picks`;
  picksSubtitle.textContent = sport === 'nfl'
    ? 'Up to 5 season picks using production, availability, age, and current role.'
    : 'Up to 5 picks using form, volatility, role, and matchup context.';
  statsContainer.innerHTML = '<div class="loader-container"><div class="spinner"></div><p>Ranking the strongest live lines...</p><span>Checking performance history and line quality</span></div>';

  chrome.runtime.sendMessage({ action: 'fetchTopPicks', sport }, response => {
    if (currentView !== 'picks' || currentSport !== requestedSport) return;
    if (chrome.runtime.lastError) {
      renderPicksError();
    } else if (response && Array.isArray(response.picks)) {
      renderPicks(response.picks, sport, response);
    } else {
      renderPicksError();
    }
  });
}

function renderPicksError() {
  const statsContainer = document.getElementById('statsContainer');
  statsContainer.innerHTML = `
    <div class="empty-picks">
      <h2>Unable to rank the board</h2>
      <p>Live lines or performance data could not be loaded. Try reopening PropWise in a moment.</p>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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

function formatStatTypeLabel(label) {
  if (!label) return 'N/A';
  let clean = label.trim();
  
  // Specific combo replacements (case-insensitive)
  const combos = [
    { pattern: /Points\+Rebounds\+Assists/i, replacement: 'PTS+REB+AST' },
    { pattern: /Pts\+Rebs\+Asts/i, replacement: 'PTS+REB+AST' },
    { pattern: /Points\+Rebounds/i, replacement: 'PTS+REB' },
    { pattern: /Pts\+Rebs/i, replacement: 'PTS+REB' },
    { pattern: /Points\+Assists/i, replacement: 'PTS+AST' },
    { pattern: /Pts\+Asts/i, replacement: 'PTS+AST' },
    { pattern: /Rebounds\+Assists/i, replacement: 'REB+AST' },
    { pattern: /Rebs\+Asts/i, replacement: 'REB+AST' },
    { pattern: /3-Pt Made/i, replacement: '3PM' },
    { pattern: /3-Point Field Goals Made/i, replacement: '3PM' },
    { pattern: /3-Pt Field Goals Attempted/i, replacement: '3PA' },
    { pattern: /3-Point Field Goals Attempted/i, replacement: '3PA' }
  ];
  
  for (const combo of combos) {
    if (combo.pattern.test(clean)) {
      return combo.replacement;
    }
  }
  
  return clean
    .replace(/\bHitter Fantasy Score\b/i, 'Hitter FS')
    .replace(/\bPitcher Fantasy Score\b/i, 'Pitcher FS')
    .replace(/\bFantasy Score\b/i, 'Fantasy')
    .replace(/\bPoints\b/i, 'PTS')
    .replace(/\bRebounds\b/i, 'REB')
    .replace(/\bAssists\b/i, 'AST')
    .replace(/\bPts\b/i, 'PTS')
    .replace(/\bRebs\b/i, 'REB')
    .replace(/\bAsts\b/i, 'AST')
    .replace(/\bStrikeouts\b/i, 'Ks')
    .replace(/\bHits\b/i, 'Hits')
    .replace(/\bHome Runs\b/i, 'HR')
    .replace(/\bPitches Thrown\b/i, 'Pitches')
    .replace(/\bPassing Yards\b/i, 'Pass Yds')
    .replace(/\bRushing Yards\b/i, 'Rush Yds')
    .replace(/\bReceiving Yards\b/i, 'Rec Yds')
    .replace(/\bTouchdowns\b/i, 'TDs')
    .replace(/\bFree Throws Made\b/i, 'FTM')
    .replace(/\bFree Throws Attempted\b/i, 'FTA')
    .replace(/\bField Goals Made\b/i, 'FGM')
    .replace(/\bField Goals Attempted\b/i, 'FGA')
    .replace(/\bOffensive Rebounds\b/i, 'OREB')
    .replace(/\bDefensive Rebounds\b/i, 'DREB')
    .replace(/\bTurnovers\b/i, 'TO')
    .replace(/\bSteals\b/i, 'STL')
    .replace(/\bBlocks\b/i, 'BLK');
}

function renderPicks(picks, sport = 'mlb', metadata = {}) {
  const statsContainer = document.getElementById('statsContainer');
  statsContainer.innerHTML = '';

  if (picks.length === 0) {
    statsContainer.innerHTML = `
      <div class="empty-picks">
        <h2>No qualified ${sportNames[sport]} picks</h2>
        <p>Nothing on the live board currently clears the recent-form and line-value thresholds.</p>
      </div>
    `;
    return;
  }

  picks.forEach((player, index) => {
    const pickCard = document.createElement('article');
    pickCard.className = `pick-card ${sport}-pick`;
    const position = escapeHtml(formatPosition(player.position));
    const playerName = escapeHtml(player.name);
    const team = escapeHtml(player.team || player.teamName || 'N/A');
    const description = escapeHtml(player.description || 'Matchup TBD');
    const statType = escapeHtml(formatStatTypeLabel(player.statType));
    const lineScore = escapeHtml(player.lineScore);
    const direction = player.direction === 'less' ? 'Less' : 'More';
    const startTime = player.startTime ? new Date(player.startTime).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }) : 'TBD';
    const hitRateMetric = player.hitRate === null
      ? `<span><strong>${escapeHtml(player.sampleSize)}</strong> games in latest sample</span>`
      : `<span><strong>${escapeHtml(player.hitRate)}%</strong> recent hit rate</span>`;

    pickCard.innerHTML = `
      <div class="pick-topline">
        <span class="pick-rank">#${index + 1} PICK</span>
        <span class="confidence-pill">${escapeHtml(player.modelVersion || 'V2')} ${escapeHtml(player.confidence)}/100</span>
      </div>
      <div class="pick-main">
        <img src="${escapeHtml(player.imageUrl || 'icons/icon48.png')}" alt="${playerName}" class="pick-player-image">
        <div class="pick-player-copy">
          <h2>${playerName}</h2>
          <p>${team} <span class="dot-separator">&middot;</span> ${position}</p>
          <span>${description} <span class="dot-separator">&middot;</span> ${escapeHtml(startTime)}</span>
        </div>
        <div class="line-call line-${player.direction}">
          <span>${direction}</span>
          <strong>${lineScore}</strong>
          <small>${statType}</small>
        </div>
      </div>
      <div class="why-pick">
        <span class="why-label">Why this pick</span>
        <p>${escapeHtml(player.reason)}</p>
      </div>
      <div class="pick-footer">
        <div class="pick-metrics">
          ${hitRateMetric}
          <span><strong>${escapeHtml(player.modelProjection || player.recentAverage)}</strong> V2 projection</span>
          <span><strong>${escapeHtml(player.consistency)}</strong>/100 consistency</span>
        </div>
        <div class="pick-actions">
          <button class="pick-action stat-btn" title="View season stats">
            Season
          </button>
          <button class="pick-action live-btn" title="View last game stats">
            Last game
          </button>
        </div>
      </div>
    `;

    const playerImage = pickCard.querySelector('.pick-player-image');
    playerImage.addEventListener('error', () => {
      playerImage.src = 'icons/icon48.png';
    }, { once: true });

    pickCard.querySelector('.stat-btn').addEventListener('click', (event) => {
      const button = event.currentTarget;
      button.classList.add('loading');
      fetchAndDisplayAdvancedStats(player, sport, () => button.classList.remove('loading'));
    });

    pickCard.querySelector('.live-btn').addEventListener('click', (event) => {
      const button = event.currentTarget;
      button.classList.add('loading');
      fetchAndDisplayLiveGameStats(player, sport, () => button.classList.remove('loading'));
    });

    statsContainer.appendChild(pickCard);
  });

  if (metadata.generatedAt) {
    const updated = document.createElement('p');
    updated.className = 'board-updated';
    const coverage = metadata.screenedCount
      ? ` | screened ${metadata.screenedCount} lines across ${metadata.profiledPlayers || 0} players`
      : '';
    updated.textContent = `${metadata.modelVersion || 'V2'} ranked ${new Date(metadata.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${coverage}`;
    statsContainer.appendChild(updated);
  }
}

function renderPlayers(players, sport = 'mlb') {
  const statsContainer = document.getElementById('statsContainer');
  statsContainer.innerHTML = '';

  if (players.length === 0) {
    statsContainer.innerHTML = '<p class="no-players-found">No players found</p>';
    return;
  }

  players.forEach(player => {
    const playerCard = document.createElement('div');
    playerCard.className = `player-card ${sport}-card`;
    const position = escapeHtml(formatPosition(player.position));
    const playerName = escapeHtml(player.name);
    const team = escapeHtml(player.team || player.teamName || 'N/A');
    const matchup = escapeHtml(player.description || player.matchup || 'vs. TBD');
    const startTime = player.startTime ? new Date(player.startTime).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }) : 'TBD';

    let projectionsHtml = '<div class="projections-list">';
    if (player.projections && player.projections.length > 0) {
      player.projections.forEach(projection => {
        projectionsHtml += `
          <div class="projection-row">
            <span class="proj-type">${escapeHtml(formatStatTypeLabel(projection.statType))}</span>
            <span class="proj-line">${escapeHtml(projection.lineScore)}</span>
          </div>
        `;
      });
    } else {
      projectionsHtml += `
        <div class="projection-row">
          <span class="proj-type">${escapeHtml(formatStatTypeLabel(player.statType))}</span>
          <span class="proj-line">${escapeHtml(player.lineScore || 'N/A')}</span>
        </div>
      `;
    }
    projectionsHtml += '</div>';

    playerCard.innerHTML = `
      <div class="player-header">
        <button class="action-btn stat-btn" title="Season Stats">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
            <line x1="18" y1="20" x2="18" y2="10"></line>
            <line x1="12" y1="20" x2="12" y2="4"></line>
            <line x1="6" y1="20" x2="6" y2="14"></line>
          </svg>
        </button>
        <div class="player-img-wrapper">
          <img src="${escapeHtml(player.imageUrl || 'icons/icon48.png')}" alt="${playerName}" class="player-image">
        </div>
        <button class="action-btn live-btn" title="Last Game Stats">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
          </svg>
        </button>
      </div>
      <div class="player-info">
        <h2>${playerName}</h2>
        <p class="player-details">${team} - ${position}</p>
        <div class="divider-sub"></div>
        <p class="match-up">${matchup}</p>
        <p class="game-time">${escapeHtml(startTime)}</p>
        <div class="divider-sub"></div>
        ${projectionsHtml}
      </div>
    `;

    const playerImage = playerCard.querySelector('.player-image');
    playerImage.addEventListener('error', () => {
      playerImage.src = 'icons/icon48.png';
    }, { once: true });

    playerCard.querySelector('.stat-btn').addEventListener('click', event => {
      const button = event.currentTarget;
      button.classList.add('loading');
      fetchAndDisplayAdvancedStats(player, sport, () => button.classList.remove('loading'));
    });

    playerCard.querySelector('.live-btn').addEventListener('click', event => {
      const button = event.currentTarget;
      button.classList.add('loading');
      fetchAndDisplayLiveGameStats(player, sport, () => button.classList.remove('loading'));
    });

    statsContainer.appendChild(playerCard);
  });
}

function filterPlayers(query) {
  if (currentView !== 'players') return;
  const filteredPlayers = allPlayers.filter(player => player.name.toLowerCase().includes(query));
  renderPlayers(filteredPlayers, currentSport);
}

function formatStatKey(key) {
  const statKeyMapping = {
    // MLB
    gamesPlayed: 'Games Played',
    gamesStarted: 'Games Started',
    runs: 'Runs',
    doubles: 'Doubles',
    triples: 'Triples',
    homeRuns: 'Home Runs',
    strikeOuts: 'Strike Outs',
    baseOnBalls: 'Walks',
    hits: 'Hits',
    avg: 'Batting Average',
    obp: 'On-Base Percentage',
    slg: 'Slugging Percentage',
    ops: 'OPS',
    era: 'ERA',
    whip: 'WHIP',
    inningsPitched: 'Innings Pitched',
    wins: 'Wins',
    losses: 'Losses',
    saves: 'Saves',
    strikeoutsPer9Inn: 'K/9',
    walksPer9Inn: 'BB/9',
    gameDate: 'Game Date',
    opponent: 'Opponent',
    score: 'Game Score',
    gameResult: 'Result',
    // NBA Season Stats
    avgPoints: 'Points PPG',
    avgAssists: 'Assists APG',
    avgRebounds: 'Rebounds RPG',
    avgSteals: 'Steals SPG',
    avgBlocks: 'Blocks BPG',
    avgMinutes: 'Minutes MPG',
    fieldGoalPct: 'FG%',
    threePointPct: '3P%',
    freeThrowPct: 'FT%',
    // NBA Live Stats (ESPN Gamelog Keys)
    points: 'Points',
    assists: 'Assists',
    totalRebounds: 'Rebounds',
    'fieldGoalsMade-fieldGoalsAttempted': 'FG M-A',
    'threePointFieldGoalsMade-threePointFieldGoalsAttempted': '3PT M-A',
    'freeThrowsMade-freeThrowsAttempted': 'FT M-A',
    blocks: 'Blocks',
    steals: 'Steals',
    fouls: 'Fouls',
    turnovers: 'Turnovers',
    minutes: 'Minutes',
    // NBA Season Stats (ESPN Athlete API Keys)
    threePointFieldGoalsAttempted: '3PA',
    threePointFieldGoalsMade: '3PM',
    fieldGoalsAttempted: 'FGA',
    fieldGoalsMade: 'FGM',
    freeThrowsAttempted: 'FTA',
    freeThrowsMade: 'FTM',
    offensiveRebounds: 'Off Rebounds',
    defensiveRebounds: 'Def Rebounds',
    personalFouls: 'Fouls',
    // NFL Stats
    passingYards: 'Passing Yds',
    passingTouchdowns: 'Passing TDs',
    interceptions: 'Interceptions',
    completionPct: 'Completion %',
    rushingYards: 'Rushing Yds',
    rushingTouchdowns: 'Rushing TDs',
    receptions: 'Receptions',
    receivingYards: 'Receiving Yds',
    receivingTouchdowns: 'Receiving TDs',
    fumblesLost: 'Fumbles Lost'
  };

  if (statKeyMapping[key]) return statKeyMapping[key];

  // Fallback: convert camelCase to Title Case
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .replace(/Pct\b/i, '%')
    .replace(/Avg\b/i, 'Average')
    .trim();
}

function formatStatValue(key, value) {
  if (value === null || value === undefined || value === '') return 'N/A';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const formatted = value
      .map(item => formatStatValue(key, item))
      .filter(item => item !== 'N/A');
    return formatted.length > 0 ? formatted.join(', ') : 'N/A';
  }

  if (typeof value === 'object') {
    const preferredKeys = String(key).toLowerCase().includes('position')
      ? ['displayName', 'display_name', 'name', 'label', 'title', 'abbreviation', 'abbrev', 'value']
      : ['displayValue', 'displayName', 'display_name', 'name', 'label', 'title', 'abbreviation', 'abbrev', 'value'];

    for (const preferredKey of preferredKeys) {
      if (value[preferredKey] !== null && value[preferredKey] !== undefined && value[preferredKey] !== '') {
        return formatStatValue(preferredKey, value[preferredKey]);
      }
    }

    const readableValues = Object.entries(value)
      .filter(([, nestedValue]) => ['string', 'number', 'boolean'].includes(typeof nestedValue))
      .map(([nestedKey, nestedValue]) => `${formatStatKey(nestedKey)}: ${nestedValue}`);
    return readableValues.length > 0 ? readableValues.join(', ') : 'N/A';
  }

  return String(value);
}

function fetchAndDisplayAdvancedStats(player, sport, callback) {
  chrome.runtime.sendMessage({ action: 'fetchSeasonStats', name: player.name, sport: sport }, response => {
    if (callback) callback();
    const stats = response && response.stats ? response.stats : null;
    displayAdvancedStats(stats, sport, player.name, player.position);
  });
}

function displayAdvancedStats(player, sport, fallbackName = '', fallbackPosition = 'N/A') {
  const modal = document.getElementById('advancedStatsModal');
  const modalContent = document.getElementById('advancedStatsContent');
  modalContent.innerHTML = '';

  const name = player?.name || fallbackName || 'Player';
  const position = formatPosition(player?.position && player.position !== 'N/A' ? player.position : fallbackPosition);

  if (player && (
    (player.battingStats && Object.keys(player.battingStats).length > 0) ||
    (player.pitchingStats && Object.keys(player.pitchingStats).length > 0) ||
    (player.fieldingStats && Object.keys(player.fieldingStats).length > 0)
  )) {
    const battingStatsAvailable = player.battingStats && Object.keys(player.battingStats).length > 0;
    const pitchingStatsAvailable = player.pitchingStats && Object.keys(player.pitchingStats).length > 0;
    const fieldingStatsAvailable = player.fieldingStats && Object.keys(player.fieldingStats).length > 0;

    let col1Header = 'Season Batting Stats';
    let col2Header = 'Season Pitching Stats';
    let col3Header = 'Season Fielding Stats';

    if (sport === 'nba') {
      col1Header = 'Offensive Stats';
      col2Header = 'Defensive Stats';
      col3Header = 'General Stats';
    } else if (sport === 'nfl') {
      col1Header = 'Passing Stats';
      col2Header = 'Rushing & Receiving';
      col3Header = 'Defense & General';
    }

    const renderSection = (title, stats, available) => {
      if (!available) return `<div class="stats-column"><h3>${title}</h3><p class="no-data">Not available</p></div>`;
      return `
        <div class="stats-column">
          <h3>${title}</h3>
          <div class="stats-grid-list">
            ${Object.entries(stats).map(([key, value]) => `
              <div class="stat-row">
                <span class="stat-name">${formatStatKey(key)}</span>
                <span class="stat-val">${formatStatValue(key, value)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    };

    modalContent.innerHTML = `
      <div class="modal-header-desc">
        <h2>${name}</h2>
        <span class="modal-pos-badge sport-accent-badge">${position}</span>
      </div>
      <div class="modal-stats-layout">
        ${renderSection(col1Header, player.battingStats, battingStatsAvailable)}
        ${renderSection(col2Header, player.pitchingStats, pitchingStatsAvailable)}
        ${renderSection(col3Header, player.fieldingStats, fieldingStatsAvailable)}
      </div>
    `;
  } else {
    modalContent.innerHTML = `
      <div class="modal-header-desc">
        <h2>${name}</h2>
        <span class="modal-pos-badge sport-accent-badge">${position}</span>
      </div>
      <div class="no-data-modal-container">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="empty-state-icon">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <p class="no-data-modal">Season stats are currently not available for this player.</p>
      </div>
    `;
  }

  modal.style.display = 'flex';

  const closeBtn = modal.querySelector('.close');
  closeBtn.onclick = () => {
    modal.style.display = 'none';
  };

  window.onclick = (event) => {
    if (event.target == modal) {
      modal.style.display = 'none';
    }
  };
}

function fetchAndDisplayLiveGameStats(player, sport, callback) {
  chrome.runtime.sendMessage({ action: 'fetchLiveGameStats', name: player.name, sport: sport }, response => {
    if (callback) callback();
    const stats = response && response.stats ? response.stats : null;
    displayLiveGameStats(stats, sport, player.name, player.position);
  });
}

function displayLiveGameStats(player, sport, fallbackName = '', fallbackPosition = 'N/A') {
  const modal = document.getElementById('liveStatsModal');
  const modalContent = document.getElementById('liveStatsContent');
  modalContent.innerHTML = '';

  const name = player?.name || fallbackName || 'Player';
  const position = formatPosition(player?.position && player.position !== 'N/A' ? player.position : fallbackPosition);

  if (player && (
    (player.battingStats && Object.keys(player.battingStats).length > 0) ||
    (player.pitchingStats && Object.keys(player.pitchingStats).length > 0) ||
    (player.fieldingStats && Object.keys(player.fieldingStats).length > 0)
  )) {
    const battingStatsAvailable = player.battingStats && Object.keys(player.battingStats).length > 0;
    const pitchingStatsAvailable = player.pitchingStats && Object.keys(player.pitchingStats).length > 0;
    const fieldingStatsAvailable = player.fieldingStats && Object.keys(player.fieldingStats).length > 0;

    let col1Header = "Last Game's Batting";
    let col2Header = "Last Game's Pitching";
    let col3Header = "Last Game's Fielding";

    if (sport === 'nba') {
      col1Header = 'Offensive Stats';
      col2Header = 'Defensive Stats';
      col3Header = 'Game Details';
    } else if (sport === 'nfl') {
      col1Header = 'Passing Stats';
      col2Header = 'Rushing & Receiving';
      col3Header = 'Game Details';
    }

    // Attempt to extract metadata for Game Details
    const gameDate = player.fieldingStats?.gameDate || player.battingStats?.gameDate || 'Recent';
    const opponent = player.fieldingStats?.opponent || player.battingStats?.opponent || 'N/A';
    const scoreText = player.fieldingStats?.score ? `${player.fieldingStats.score} (${player.fieldingStats.gameResult || ''})` : '';

    const renderSection = (title, stats, available) => {
      const filteredStats = Object.entries(stats || {}).filter(([k]) => !['gameDate', 'opponent', 'score', 'gameResult'].includes(k));
      if (!available || filteredStats.length === 0) {
        return `<div class="stats-column"><h3>${title}</h3><p class="no-data">Not active in game</p></div>`;
      }
      return `
        <div class="stats-column">
          <h3>${title}</h3>
          <div class="stats-grid-list">
            ${filteredStats.map(([key, value]) => `
              <div class="stat-row">
                <span class="stat-name">${formatStatKey(key)}</span>
                <span class="stat-val">${formatStatValue(key, value)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    };

    modalContent.innerHTML = `
      <div class="modal-header-desc">
        <div>
          <h2>${name}</h2>
          <p class="game-meta-subtitle">vs. ${opponent} (${gameDate}) ${scoreText ? '- ' + scoreText : ''}</p>
        </div>
        <span class="modal-pos-badge sport-accent-badge">${position}</span>
      </div>
      <div class="modal-stats-layout">
        ${renderSection(col1Header, player.battingStats, battingStatsAvailable)}
        ${renderSection(col2Header, player.pitchingStats, pitchingStatsAvailable)}
        ${sport !== 'nba' && sport !== 'nfl' ? renderSection(col3Header, player.fieldingStats, fieldingStatsAvailable) : ''}
      </div>
    `;
  } else {
    modalContent.innerHTML = `
      <div class="modal-header-desc">
        <h2>${name}</h2>
        <span class="modal-pos-badge sport-accent-badge">${position}</span>
      </div>
      <div class="no-data-modal-container">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="empty-state-icon">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <p class="no-data-modal">Last game stats are currently not available for this player.</p>
      </div>
    `;
  }

  modal.style.display = 'flex';

  const closeBtn = modal.querySelector('.close');
  closeBtn.onclick = () => {
    modal.style.display = 'none';
  };

  window.onclick = (event) => {
    if (event.target == modal) {
      modal.style.display = 'none';
    }
  };
}
