# WyrdBot — Setup Guide

This guide walks you through getting WyrdBot running in your own Discord server so your group can manage the Fate Deck and Twist Decks for **Through the Breach**.

No coding experience required. The whole process takes about 10–15 minutes.

---

## What You'll Need

- A Discord account with permission to manage your server
- A free [Railway](https://railway.app) account (sign up with GitHub — no credit card needed)
- A free [GitHub](https://github.com) account

---

## Step 1 — Fork the Repository

1. Go to the [WyrdBot GitHub repository](https://github.com/8w-gremlin/wyrdbot)
2. Click the **Fork** button in the top-right corner
3. Click **Create fork** — this gives you your own copy of the bot code

---

## Step 2 — Create a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** in the top-right
3. Give it a name (e.g. `WyrdBot`) and click **Create**
4. Click **Bot** in the left sidebar
5. Click **Reset Token**, confirm, then **copy the token** — save it somewhere safe, you'll need it in Step 4

   > Keep your token private. Anyone with it can control your bot.

6. Scroll down to **Privileged Gateway Intents** and enable:
   - **Message Content Intent**
   - **Server Members Intent**
7. Click **Save Changes**

---

## Step 3 — Invite the Bot to Your Server

1. In the Developer Portal, go to **OAuth2** → **URL Generator** in the left sidebar
2. Under **Scopes**, check: `bot`
3. Under **Bot Permissions**, check:
   - `Send Messages`
   - `Read Messages / View Channels`
   - `Embed Links`
   - `Read Message History`
   - `Use External Emojis`
4. Copy the generated URL at the bottom of the page and open it in your browser
5. Select your Discord server from the dropdown and click **Authorise**

The bot will now appear in your server's member list (shown as offline until you deploy it).

---

## Step 4 — Deploy on Railway

Railway hosts the bot for free and auto-deploys whenever you update the code.

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **New Project** → **Deploy from GitHub Repo**
3. Select your forked `wyrdbot` repository
4. Once the project loads, click the service → go to the **Variables** tab
5. Click **New Variable** and add:
   - **Name:** `DISCORD_TOKEN`
   - **Value:** the token you copied in Step 2
6. Go to the **Deploy** tab and click **Deploy** (or it may deploy automatically)

Within about a minute, your bot will show as **online** in Discord.

---

## Step 5 — Set Up the Fate Master Role

The **Fate Master** is the GM equivalent in Through the Breach. Certain commands (`!shuffle`, `!reshuffle`, `!clearhand`) are restricted to members with the Fate Master role.

1. In your Discord server, go to **Server Settings** → **Roles**
2. Click **Create Role**
3. Name it exactly: `Fate Master` (capitalisation matters)
4. Assign the role to whoever is running the game

> The server owner always has Fate Master permissions automatically, regardless of role.

---

## Step 6 — Start Playing

Once the bot is online, try these commands in any channel the bot can read:

| Command | What it does |
|---|---|
| `!help` | Show all available commands |
| `!flip` | Flip a card from the Fate Deck |
| `!deckinfo` | Check how many cards are left |
| `!createTwistDeck Rams Crows Masks Tomes` | Set up your personal Twist Deck |
| `!draw` | Draw a card to your hand (sent privately via DM) |

See the full command reference in [README.md](README.md).

---

## Updating the Bot

Whenever a new version of WyrdBot is released:

1. Go to your forked repository on GitHub
2. Click **Sync fork** → **Update branch**

Railway will detect the change and redeploy automatically.

---

## Troubleshooting

**Bot is online but not responding**
- Make sure the bot has permission to read and send messages in the channel
- Check that you enabled **Message Content Intent** in the Developer Portal (Step 2)

**Commands work but suit icons show as ♦ ♠ ♥ ♣ instead of Malifaux icons**
- The custom Malifaux suit emoji are stored in the original bot's server. Standard card symbols are used as a fallback — this doesn't affect gameplay.

**Bot goes offline**
- Check the Railway dashboard for errors under the **Logs** tab
- Make sure your `DISCORD_TOKEN` variable is set correctly

**"Only the Fate Master can use this" error**
- Create a role named exactly `Fate Master` (see Step 5) and assign it to the right person

---

## Need Help?

Open an issue on the [GitHub repository](https://github.com/8w-gremlin/wyrdbot/issues).
