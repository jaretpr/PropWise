# PropWise Privacy Policy

Effective November 24, 2026. Applies to PropWise 1.6.1 and later versions with the behavior described below.

PropWise is a Chrome extension for researching NBA, NFL, and MLB player props and player statistics. It does not require a separate PropWise account and has no developer-operated analytics or data-collection backend.

## Information processed

On app.prizepicks.com, PropWise observes successful public league and projection responses that the page already requests. It copies a limited set of public sports fields, including player names, teams, positions, images, market names, line values, league identifiers, event times, and line types. This is used to display the board and calculate rankings in the extension. The observer does not inspect request headers, cookies, credentials, account information, payments, or lineups.

The observer checks the game-mode and state-code parameters on those board requests so boards from different regional contexts are not mixed. The state code is processed temporarily in the page; it is not sent to PropWise's background service or stored in board snapshots. A random context identifier is passed instead. PropWise does not request GPS access or obtain precise coordinates. PrizePicks may independently request location to operate its website.

PropWise identifies an open PrizePicks tab to open or focus the board and select the requested sport. It does not record browsing history on other websites or log general clicks or keystrokes. Board timestamps and the source tab identifier are used locally to manage freshness. The last selected sport is saved locally.

## Storage and retention

Public board snapshots and their context information are stored in Chrome session storage on your device. Snapshots older than 30 minutes are excluded from use and removed during subsequent board updates. Chrome clears session storage when the browser restarts or the extension reloads or is removed. Snapshots older than two minutes are labeled as saved lines and are not used for new rankings unless a fresh eligible board is available. The selected-sport preference remains in local extension storage until that storage or the extension is removed.

## Requests to data providers

PropWise requests public board data from PrizePicks and public sports data from ESPN and MLB. Player-statistics requests may include the player name or athlete identifier and the selected sport. Player images are loaded from the source URLs supplied by those providers. These services receive ordinary network information, such as your IP address, when your browser contacts them; their own privacy policies apply. All extension API requests use HTTPS.

PropWise does not send board snapshots, browsing history, personal account data, or usage analytics to the developer. The developer does not sell extension user data, use it for advertising, or use it for credit or lending decisions. Data is used only to provide the visible sports-research features. PropWise's handling of data adheres to the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Permissions

- Storage: keeps temporary public board snapshots available between popup openings.
- app.prizepicks.com: observes the public board responses and opens, focuses, or selects the requested sports board.
- api.prizepicks.com: retrieves public leagues and projections when direct requests are available.
- statsapi.mlb.com: retrieves MLB rosters, statistics, and game information.
- site.api.espn.com, site.web.api.espn.com, and sports.core.api.espn.com: retrieve NBA/NFL rosters, athlete searches, statistics, game logs, and game context.

PropWise does not place entries, submit bets, or make payments.

## Your controls and contact

You can close PrizePicks to stop new page-based board observations, disable PropWise's access to that site in Chrome, or disable or remove the extension. Removing the extension clears its local data. Closing the browser or reloading the extension clears the session snapshots.

For questions, use the support options on the PropWise Chrome Web Store listing or [PropWise's GitHub issues](https://github.com/jaretpr/PropWise/issues). GitHub issues are public; do not post private account details, credentials, payment information, or precise location.

Changes to these practices will be reflected in this policy and, where applicable, the extension's store disclosures.
