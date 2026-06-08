document.addEventListener('DOMContentLoaded', () => {
  let currentSport = 'mlb';
  
  // Load initial MLB stats
  loadSportStats(currentSport);
  
  // Setup tab event listeners
  const tabButtons = document.querySelectorAll('.tab-button');
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      tabButtons.forEach(tab => tab.classList.remove('active'));
      button.classList.add('active');
      currentSport = button.dataset.sport;
      loadSportStats(currentSport);
    });
  });

  const searchInput = document.getElementById('searchInput');
  let searchTimeout = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const query = searchInput.value.toLowerCase();
      filterPlayers(query);
    }, 150);
  });
});

let allPlayers = [];
let currentSport = 'mlb';

function loadSportStats(sport) {
  currentSport = sport;
  const statsContainer = document.getElementById('statsContainer');
  statsContainer.innerHTML = '<div class="loader-container"><div class="spinner"></div><p>Fetching lines from PrizePicks...</p></div>';

  chrome.runtime.sendMessage({ action: 'fetchStats', sport: sport }, response => {
    if (response && response.stats) {
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
    const position = formatPosition(player.position);
    
    const startTime = player.startTime ? new Date(player.startTime).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }) : 'TBD';

    let projectionsHtml = '<div class="projections-list">';
    if (player.projections && player.projections.length > 0) {
      player.projections.forEach(proj => {
        projectionsHtml += `
          <div class="projection-row">
            <span class="proj-type">${formatStatTypeLabel(proj.statType)}</span>
            <span class="proj-line">${proj.lineScore}</span>
          </div>
        `;
      });
    } else {
      projectionsHtml += `
        <div class="projection-row">
          <span class="proj-type">${formatStatTypeLabel(player.statType)}</span>
          <span class="proj-line">${player.lineScore || 'N/A'}</span>
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
          <img src="${player.imageUrl || 'icons/icon48.png'}" alt="${player.name}" class="player-image">
        </div>
        <button class="action-btn live-btn" title="Last Game Stats">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
          </svg>
        </button>
      </div>
      <div class="player-info">
        <h2>${player.name}</h2>
        <p class="player-details">${player.team || player.teamName || 'N/A'} - ${position}</p>
        <div class="divider-sub"></div>
        <p class="match-up">${player.description || player.matchup || 'vs. TBD'}</p>
        <p class="game-time">${startTime}</p>
        <div class="divider-sub"></div>
        ${projectionsHtml}
      </div>
    `;

    const playerImage = playerCard.querySelector('.player-image');
    playerImage.addEventListener('error', () => {
      playerImage.src = 'icons/icon48.png';
    }, { once: true });

    // Listeners with loaders
    playerCard.querySelector('.stat-btn').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      btn.classList.add('loading');
      fetchAndDisplayAdvancedStats(player, sport, () => btn.classList.remove('loading'));
    });

    playerCard.querySelector('.live-btn').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      btn.classList.add('loading');
      fetchAndDisplayLiveGameStats(player, sport, () => btn.classList.remove('loading'));
    });

    statsContainer.appendChild(playerCard);
  });
}

function filterPlayers(query) {
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
