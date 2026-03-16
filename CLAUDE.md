# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # run the bot
npm run dev        # run with auto-restart on file changes
npm test           # run Jest tests
npm run lint       # ESLint check
npm run lint:fix   # ESLint auto-fix
```

Run a single test file:
```bash
npx jest test/cards.test.js
```

Run tests matching a name:
```bash
npx jest -t "buildDeck"
```

## Architecture

This is a single-server Discord bot. All runtime logic lives in **`wyrdbot.js`**. Pure card logic (constants and stateless functions) is extracted to **`lib/cards.js`** so it can be unit tested without Discord.

### State model

State is persisted to `state.json` as a flat JSON object keyed by guild ID. The shape is:

```
globalState[guildId] = {
  deck: Card[],          // remaining fate cards, top = last element (pop)
  discard: Card[],       // fate discard pile
  lastFlips: Card[],     // active flip(s), index 0 = highest value (active)
  sidebar: { playerId, playerName, card } | null,
  countingCards: userId | null,
  players: {
    [userId]: {
      name, hand, twistDeck, twistDiscard, twistSuits,
      usedMulligan, usedFiftyFifty, pendingMarked
    }
  }
}
```

`getGuild()` and `getPlayer()` handle both initialisation of new entries and **migration of existing state** — always add new fields there with `=== undefined` guards.

### Card objects

```js
{ rank: 'A'–'K', suit: 'Tomes'|'Masks'|'Rams'|'Crows' }  // suited card
{ rank: 'RJ', suit: null }  // Red Joker  (value 14)
{ rank: 'BJ', suit: null }  // Black Joker (value 0, cannot be cheated)
{ rank, suit, twistCard: true }  // card from a player's Twist Deck
```

### Command dispatch

`messageCreate` lowercases the command token, checks `aliases` for camelCase commands, resolves to a handler in `commands`, then checks `FM_ONLY` before calling `handler(msg, args, g, player)`. All handlers receive the full guild state and calling player's state.

### Button interactions

Two button types are handled in `handleButton`:
- `cheat_<userId>` — shows the flipper their hand (ephemeral), prompting them to type `!cheat <n>`
- `usesidebar` — directly executes the sidebar cheat fate effect (usable by any player)

Buttons appear on flip messages via an `ActionRowBuilder`. The sidebar button is shown whenever `g.sidebar` is set and the active card is not the Black Joker.

### Suit emoji

Custom emoji are resolved once at startup in `resolveSuitEmoji()`, checking both `client.emojis.cache` (guild emoji) and `client.application.emojis.cache` (application emoji uploaded via Developer Portal). `SUIT_EMOJI` starts as the fallback symbols and is upgraded in place. `cardLabel()` reads from `SUIT_EMOJI` at call time, so it always uses the resolved values.

### Role gating

`FM_ONLY` is a `Set` of command names restricted to the **Fate Master** role (or server owner). Add new FM-only commands to this set.

### Once-per-X abilities

`usedMulligan` and `usedFiftyFifty` are per-player flags. They are **not** reset by `!reshuffle` — only by `!newsession`.

### Tests

Tests live in `test/cards.test.js` and cover only the pure functions in `lib/cards.js`. Discord-dependent code in `wyrdbot.js` is not unit tested. When adding new pure logic, put it in `lib/cards.js` and add tests there.
