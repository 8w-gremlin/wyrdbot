# WyrdBot 🎴
**Through the Breach — Fate Deck Discord Bot**

A Discord bot for playing Through the Breach by Wyrd Games. Handles the full Fate Deck, personal Twist Decks, private hands (via DM), and Cheating Fate.

---

## Commands

| Command | Description |
|---|---|
| `!flip` | Flip a card from the Fate Deck |
| `!flip 3` | Flip multiple cards |
| `!shuffle` | Reshuffle discard pile into deck |
| `!reshuffle` | Full reset — new deck, notifies everyone to draw |
| `!deckinfo` | Show deck/discard counts and last flip |
| `!createTwistDeck Rams Crows Masks Tomes` | Set up your personal Twist Deck |
| `!draw` | Draw 1 card to your hand (sent privately via DM) |
| `!draw 3` | Draw multiple cards |
| `!hand` | See your current hand (sent privately via DM) |
| `!cheat 2` | Replace the active flip with card #2 from your hand |
| `!clearhand` | Discard all cards from your hand |
| `!twistShuffle` | Reshuffle your personal Twist Deck |
| `!help` | Show all commands |

**Suits:** 📚 Tomes · 🎭 Masks · 🐏 Rams · 🐦 Crows

---

## Setup Guide — Step by Step

### Step 1 — Create your Discord Bot

1. Go to [https://discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → give it a name (e.g. "WyrdBot") → **Create**
3. Click **Bot** in the left sidebar
4. Click **Reset Token** → copy the token and save it somewhere safe (you'll need it later)
5. Scroll down to **Privileged Gateway Intents** and turn ON:
   - ✅ **Message Content Intent**
   - ✅ **Server Members Intent**
6. Click **Save Changes**

### Step 2 — Invite the Bot to your Server

1. Click **OAuth2** → **URL Generator** in the left sidebar
2. Under **Scopes**, check: `bot`
3. Under **Bot Permissions**, check:
   - `Send Messages`
   - `Read Messages/View Channels`
   - `Embed Links`
   - `Read Message History`
4. Copy the generated URL at the bottom and open it in your browser
5. Select your Discord server → **Authorise**

### Step 3 — Deploy on Railway (Free, No Credit Card)

Railway is the easiest free hosting option.

1. Go to [https://railway.app](https://railway.app) and **sign up with GitHub**
2. Click **New Project** → **Deploy from GitHub Repo**
3. Select your `wyrdbot` repository
4. Once it loads, click on the service → go to **Variables** tab
5. Click **New Variable** and add:
   - **Name:** `DISCORD_TOKEN`
   - **Value:** the token you copied in Step 1
6. Click **Deploy** — Railway will install packages and start the bot automatically

That's it! The bot will show as online in Discord within ~1 minute.

### Step 4 — Update the Bot (when you make changes)

Whenever you push changes to GitHub:
```
git add .
git commit -m "update bot"
git push
```
Railway automatically redeploys when you push to GitHub.

---

## Local Development

```bash
# 1. Clone the repo
git clone https://github.com/8w-gremlin/wyrdbot
cd wyrdbot

# 2. Install dependencies
npm install

# 3. Create your .env file
cp .env.example .env
# Edit .env and paste your DISCORD_TOKEN

# 4. Run the bot
npm start
```

---

## How Cheating Fate Works

1. The Fate Master calls `!flip`
2. A card appears in the channel with a **Cheat Fate** button
3. The player clicks the button — the bot DMs them their hand with card numbers
4. The player types `!cheat 2` (or whichever number) in the channel
5. The flip is replaced with their chosen hand card; the old flip goes to their hand

> The **Black Joker** can never be cheated.

---

## Notes

- Hands are sent privately via **DM** so other players can't see them
- If a player's DMs are closed, the bot falls back to showing the hand in the channel
- State (deck, hands) is saved to `state.json` so it persists through bot restarts
- Each Discord server gets its own independent deck state
