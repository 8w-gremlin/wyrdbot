// ============================================================
//  WyrdBot — Through the Breach Fate Deck Bot
// ============================================================

const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = '!';
const STATE_FILE = path.join(__dirname, 'state.json');
const FM_ROLE = 'Fate Master';
const FM_ONLY = new Set(['shuffle', 'reshuffle', 'clearhand', 'newsession', 'weirdlookin', 'setreleasechannel']);

const { version } = require('./package.json');
const buildHash = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev';
const BUILD_STRING = `v${version} (build ${buildHash})`;

function isFateMaster(member) {
  if (!member) return false;
  if (member.id === member.guild.ownerId) return true;
  return member.roles.cache.some(r => r.name === FM_ROLE);
}

// ── Card Data ─────────────────────────────────────────────────
const {
  RANKS, SUIT_EMOJI_FALLBACK, SUIT_COLOR, SUIT_ALIASES,
  buildDeck, shuffle, cardValue,
} = require('./lib/cards');

function nextRank(rank) {
  const i = RANKS.indexOf(rank);
  return (i === -1 || i >= RANKS.length - 1) ? rank : RANKS[i + 1];
}
function boostRankBy(rank, n) {
  let r = rank;
  for (let i = 0; i < n; i++) r = nextRank(r);
  return r;
}

// Custom emoji IDs — resolved to full strings at runtime if available in the guild
const SUIT_EMOJI_CUSTOM = {
  Tomes: { name: 'tome', id: '1482914230838497292' },
  Masks: { name: 'mask', id: '1482915010522120416' },
  Rams: { name: 'ram', id: '1482915012732387378' },
  Crows: { name: 'crow', id: '1482914225625235626' },
};

// Resolved at runtime — starts with fallbacks, upgraded on bot ready
const SUIT_EMOJI = { ...SUIT_EMOJI_FALLBACK };

async function resolveSuitEmoji(client) {
  try { await client.application.emojis.fetch(); } catch { /* ignore */ }
  for (const [suit, custom] of Object.entries(SUIT_EMOJI_CUSTOM)) {
    const found = client.emojis.cache.get(custom.id)
               || client.application.emojis.cache.get(custom.id);
    SUIT_EMOJI[suit] = found ? found.toString() : SUIT_EMOJI_FALLBACK[suit];
  }
  console.log('Suit emoji resolved:', SUIT_EMOJI);
}
function cardLabel(card) {
  if (card.rank === 'RJ') return '★ Red Joker';
  if (card.rank === 'BJ') return '✦ Black Joker';
  return `${card.rank} of ${SUIT_EMOJI[card.suit]} ${card.suit}`;
}

// ── State ─────────────────────────────────────────────────────
function loadState() {
  try { if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { /* ignore */ }
  return {};
}
function saveState(s) { try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch { /* ignore */ } }

const globalState = loadState();

function getGuild(guildId) {
  if (!globalState[guildId]) {
    globalState[guildId] = { deck: shuffle(buildDeck()), discard: [], lastFlips: [], players: {}, sleevedCard: null, countingCards: null };
    saveState(globalState);
  }
  const g = globalState[guildId];
  if (g.sidebar === undefined) g.sidebar = g.sleevedCard ?? null;
  if (g.countingCards === undefined) g.countingCards = null;
  if (g.releaseChannel === undefined) g.releaseChannel = null;
  return g;
}

function getPlayer(guildId, userId, username) {
  const g = getGuild(guildId);
  if (!g.players[userId]) {
    g.players[userId] = { name: username, hand: [], twistDeck: [], twistDiscard: [], twistSuits: null, usedMulligan: false, usedFiftyFifty: false, pendingMarked: null, pendingGlimpse: null, configuration: [], handLimit: HAND_LIMIT, weirdLookin: false, twistBoosts: {}, empoweredByFateCount: 0 };
    saveState(globalState);
  } else {
    g.players[userId].name = username;
    if (g.players[userId].usedMulligan === undefined) g.players[userId].usedMulligan = false;
    if (g.players[userId].usedFiftyFifty === undefined) g.players[userId].usedFiftyFifty = false;
    if (g.players[userId].pendingMarked === undefined) g.players[userId].pendingMarked = null;
    if (g.players[userId].pendingGlimpse === undefined) g.players[userId].pendingGlimpse = null;
    if (g.players[userId].configuration === undefined) g.players[userId].configuration = [];
    if (g.players[userId].handLimit === undefined) g.players[userId].handLimit = HAND_LIMIT;
    if (g.players[userId].weirdLookin === undefined) g.players[userId].weirdLookin = false;
    if (g.players[userId].twistBoosts === undefined) g.players[userId].twistBoosts = {};
    if (g.players[userId].empoweredByFateCount === undefined) g.players[userId].empoweredByFateCount = 0;
  }
  return g.players[userId];
}

function save() { saveState(globalState); }

function drawFate(g) {
  if (g.deck.length === 0) {
    if (g.discard.length === 0) return null;
    g.deck = shuffle([...g.discard]);
    g.discard = [];
  }
  return g.deck.pop();
}

function drawFromDiscard(g) {
  return g.discard.length > 0 ? g.discard.pop() : null;
}

const HAND_LIMIT = 5;

async function warnHandLimit(channel, player) {
  if (player.hand.length > player.handLimit) {
    await channel.send(`⚠️ **${player.name}** has ${player.hand.length} cards — over their hand limit of ${player.handLimit}. Use \`!discard\` to discard down to ${player.handLimit}.`);
  }
}

// ── Embeds ────────────────────────────────────────────────────
function flipEmbed(cards, actor, cheated = false) {
  const top = cards[0]; // sorted descending, so index 0 is highest/active
  let color, title;

  if (top.rank === 'RJ') {
    color = 0xc0392b;
    title = '★ Red Joker — choose any suit';
  } else if (top.rank === 'BJ') {
    color = 0x222222;
    title = '✦ Black Joker — cannot be cheated';
  } else {
    color = SUIT_COLOR[top.suit] ?? 0xb8860b;
    title = `${cardLabel(top)} · ${cardValue(top)}${cheated ? ' *(cheated)*' : ''}`;
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setFooter({ text: actor });

  if (cards.length > 1) {
    const lines = cards.map((c, i) =>
      `${i === 0 ? '▶' : '  '} ${cardLabel(c)} · ${cardValue(c)}`
    ).join('\n');
    embed.setDescription(lines);
  }

  return embed;
}

// ── Commands ──────────────────────────────────────────────────
const commands = {};

// !flip [n]
commands.flip = async (msg, args, g, player) => {
  const count = Math.min(parseInt(args[0]) || 1, 4);

  // Move any previous active flips to discard
  for (const c of g.lastFlips) g.discard.push(c);
  g.lastFlips = [];

  const usingDiscard = g.countingCards === msg.author.id;
  const flipped = [];
  let fateReshuffled = false;
  for (let i = 0; i < count; i++) {
    const willReshuffle = !usingDiscard && g.deck.length === 0 && g.discard.length > 0;
    const c = usingDiscard ? drawFromDiscard(g) : drawFate(g);
    if (!c) { await msg.reply(usingDiscard ? 'No cards in the discard pile.' : 'No cards remain.'); return; }
    if (willReshuffle) fateReshuffled = true;
    flipped.push(c);
  }

  // Sort descending by value — highest is the active card (last in array)
  flipped.sort((a, b) => cardValue(b) - cardValue(a));
  g.lastFlips = flipped;
  save();

  const top = flipped[0]; // highest value = active
  const components = [];
  if (top.rank !== 'BJ') {
    const buttons = [];
    if (player.hand.length > 0) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`cheat_${msg.author.id}`)
          .setLabel('Cheat Fate')
          .setStyle(ButtonStyle.Primary)
      );
    }
    if (g.sidebar) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId('usesidebar')
          .setLabel(`Use Sidebar (${g.sidebar.playerName})`)
          .setStyle(ButtonStyle.Secondary)
      );
    }
    if (buttons.length > 0) components.push(new ActionRowBuilder().addComponents(...buttons));
  }

  const embed = flipEmbed(flipped, msg.author.username);
  await msg.reply({ embeds: [embed], components });
  if (fateReshuffled) await msg.channel.send('The Fate Deck was reshuffled. Each player may use `!draw` to draw a card.');
};

// !draw [n]
commands.draw = async (msg, args, g, player) => {
  if (!player.twistSuits) {
    await msg.reply('No Twist Deck. Use `!createTwistDeck <Defining> <Ascendant> <Center> <Descendant>`');
    return;
  }
  const count = Math.min(parseInt(args[0]) || 1, 6);
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (player.twistDeck.length === 0) {
      if (player.twistDiscard.length === 0) break;
      player.twistDeck = shuffle([...player.twistDiscard]);
      player.twistDiscard = [];
      await msg.channel.send(`${msg.author.username}'s Twist Deck reshuffled.`);
    }
    const c = player.twistDeck.pop();
    player.hand.push(c);
    drawn.push(c);
  }
  save();

  if (!drawn.length) { await msg.reply('Twist Deck and discard are empty.'); return; }

  await warnHandLimit(msg.channel, player);
  const handLines = player.hand.map((c, i) => `${i + 1}. ${cardLabel(c)} (${cardValue(c)})`).join('\n');
  try {
    await msg.author.send(`**Hand (${player.hand.length}/${player.handLimit}):**\n${handLines}`);
    await msg.reply(`Drew ${drawn.length}. Check your DMs.`);
  } catch {
    await msg.reply(`Drew ${drawn.length}.\n**Your hand:**\n${handLines}`);
  }
};

// !hand
commands.hand = async (msg, args, g, player) => {
  if (player.hand.length === 0) { await msg.reply('Hand is empty.'); return; }
  const handLines = player.hand.map((c, i) => `${i + 1}. ${cardLabel(c)} (${cardValue(c)})`).join('\n');
  try {
    await msg.author.send(`**Hand (${player.hand.length}):**\n${handLines}`);
    await msg.reply('Check your DMs.');
  } catch {
    await msg.reply(`**Hand:**\n${handLines}`);
  }
};

// !cheat <n>
commands.cheat = async (msg, args, g, player) => {
  if (!args[0]) { await msg.reply('Usage: `!cheat <card number>`'); return; }
  if (!g.lastFlips || g.lastFlips.length === 0) { await msg.reply('No active flip.'); return; }

  const top = g.lastFlips[0]; // highest/active card is index 0
  if (top.rank === 'BJ') { await msg.reply('The Black Joker cannot be cheated.'); return; }

  const cardNum = parseInt(args[0]);
  if (isNaN(cardNum) || cardNum < 1 || cardNum > player.hand.length) {
    await msg.reply(`Invalid number. You have ${player.hand.length} card(s). Use \`!hand\` to check.`);
    return;
  }

  const handCard = player.hand[cardNum - 1];

  // Hand card replaces the flip; old flip goes to fate discard; used hand card goes to twist discard
  player.hand.splice(cardNum - 1, 1);
  g.discard.push(top);
  player.twistDiscard.push(handCard);
  g.lastFlips[0] = handCard;
  save();

  await msg.reply({ embeds: [flipEmbed(g.lastFlips, msg.author.username, true)] });
};

// !createTwistDeck
commands.createTwistDeck = async (msg, args, g, player) => {
  if (args.length < 4) {
    await msg.reply('Usage: `!createTwistDeck <Defining> <Ascendant> <Center> <Descendant>`\nSuits: Tomes, Masks, Rams, Crows');
    return;
  }
  const positions = ['Defining', 'Ascendant', 'Center', 'Descendant'];
  const suits = {};
  for (let i = 0; i < 4; i++) {
    const suit = SUIT_ALIASES[args[i].toLowerCase()];
    if (!suit) { await msg.reply(`Unknown suit: ${args[i]}. Use Tomes, Masks, Rams or Crows.`); return; }
    suits[positions[i]] = suit;
  }

  player.twistSuits = suits;
  // Defining: A,5,9,K (4 cards) · Ascendant: 4,8,Q (3) · Center: 3,7,J (3) · Descendant: 2,6,10 (3)
  const twistCards = [
    ...['A', '5', '9', 'K'].map(rank => ({ rank, suit: suits.Defining, twistCard: true })),
    ...['4', '8', 'Q'].map(rank => ({ rank, suit: suits.Ascendant, twistCard: true })),
    ...['3', '7', 'J'].map(rank => ({ rank, suit: suits.Center, twistCard: true })),
    ...['2', '6', '10'].map(rank => ({ rank, suit: suits.Descendant, twistCard: true })),
  ];
  player.twistDeck = shuffle(twistCards);
  player.twistDiscard = [];
  player.hand = [];
  save();

  const lines = positions.map(p => `${p}: ${SUIT_EMOJI[suits[p]]} ${suits[p]}`).join(' · ');
  await msg.reply(`Twist Deck created for ${msg.author.username}. ${lines}`);
};

// !shuffle
commands.shuffle = async (msg, args, g, _player) => {
  const count = g.discard.length;
  g.deck = shuffle([...g.deck, ...g.discard]);
  g.discard = [];
  save();
  await msg.reply(`Reshuffled ${count} card(s). Deck: ${g.deck.length} — each player may use \`!draw\` to draw a card.`);
};

// !reshuffle
commands.reshuffle = async (msg, args, g, _player) => {
  g.deck = shuffle(buildDeck());
  g.discard = [];
  g.lastFlips = [];
  g.sidebar = null;
  g.countingCards = null;
  for (const p of Object.values(g.players)) {
    p.pendingMarked = null;
  }
  save();
  await msg.reply('@here Fate Deck reset — each player may use `!draw` to draw a card.');
};

// !twistShuffle
commands.twistShuffle = async (msg, args, g, player) => {
  if (!player.twistSuits) { await msg.reply('No Twist Deck yet.'); return; }
  player.twistDeck = shuffle([...player.twistDeck, ...player.twistDiscard]);
  player.twistDiscard = [];
  save();
  await msg.reply(`${msg.author.username}'s Twist Deck reshuffled (${player.twistDeck.length} cards).`);
};

// !deckinfo
commands.deckinfo = async (msg, args, g, _player) => {
  const last = g.lastFlips.length ? cardLabel(g.lastFlips[0]) : 'none';
  await msg.reply(`Deck: ${g.deck.length} · Discard: ${g.discard.length} · Last flip: ${last}`);
};

// !discard <n> — discard card n from hand to twist discard
commands.discard = async (msg, args, g, player) => {
  if (!args[0]) { await msg.reply('Usage: `!discard <card number>` — use `!hand` to see your cards.'); return; }
  if (player.hand.length === 0) { await msg.reply('Your hand is empty.'); return; }
  const cardNum = parseInt(args[0]);
  if (isNaN(cardNum) || cardNum < 1 || cardNum > player.hand.length) {
    await msg.reply(`Invalid number. You have ${player.hand.length} card(s). Use \`!hand\` to check.`);
    return;
  }
  const [discarded] = player.hand.splice(cardNum - 1, 1);
  player.twistDiscard.push(discarded);
  save();
  await msg.reply(`${msg.author.username} discarded ${cardLabel(discarded)} · ${cardValue(discarded)}.`);
};

// !edt [card numbers...] — end of Dramatic Time: discard any cards, draw back up to 3 (hand limit 5)
commands.edt = async (msg, args, g, player) => {
  const DRAW_TARGET = 3;

  if (!player.twistSuits) { await msg.reply('No Twist Deck. Use `!createTwistDeck` first.'); return; }

  // Parse and validate cards to discard
  const toDiscard = args.map(a => parseInt(a)).filter(n => !isNaN(n));
  if (toDiscard.length > 0) {
    const sorted = [...new Set(toDiscard)].sort((a, b) => b - a); // dedupe, descending
    for (const n of sorted) {
      if (n < 1 || n > player.hand.length) {
        await msg.reply(`Invalid card number ${n}. You have ${player.hand.length} card(s). Use \`!hand\` to check.`);
        return;
      }
    }
    for (const n of sorted) {
      const [discarded] = player.hand.splice(n - 1, 1);
      player.twistDiscard.push(discarded);
    }
  }

  // Draw back up to DRAW_TARGET, capped by player's hand limit
  const drawCount = Math.max(0, Math.min(DRAW_TARGET - player.hand.length, player.handLimit - player.hand.length));
  const drawn = [];
  for (let i = 0; i < drawCount; i++) {
    if (player.twistDeck.length === 0) {
      if (player.twistDiscard.length === 0) break;
      player.twistDeck = shuffle([...player.twistDiscard]);
      player.twistDiscard = [];
    }
    const c = player.twistDeck.pop();
    player.hand.push(c);
    drawn.push(c);
  }
  save();

  // Public announcement (no card details)
  let announcement = `**End of Dramatic Time** — ${msg.author.username}`;
  if (toDiscard.length > 0) announcement += ` discarded ${toDiscard.length} card(s) and`;
  announcement += ` drew ${drawn.length} card(s). Hand: ${player.hand.length}/${player.handLimit}.`;
  if (player.hand.length >= player.handLimit) announcement += ' *(at hand limit)*';
  await msg.channel.send(announcement);

  // Send updated hand privately
  if (player.hand.length === 0) { await msg.reply('Your hand is now empty.'); return; }
  const handLines = player.hand.map((c, i) => `${i + 1}. ${cardLabel(c)} (${cardValue(c)})`).join('\n');
  try {
    await msg.author.send(`**Hand (${player.hand.length}/${player.handLimit}):**\n${handLines}`);
    await msg.reply('Check your DMs for your updated hand.');
  } catch {
    await msg.reply(`**Your hand (${player.hand.length}/${player.handLimit}):**\n${handLines}`);
  }
};

// !pile — show player's own twist discard pile
commands.pile = async (msg, args, g, player) => {
  if (player.twistDiscard.length === 0) { await msg.reply('Your twist discard is empty.'); return; }
  const sorted = [...player.twistDiscard].sort((a, b) => cardValue(b) - cardValue(a));
  const lines = sorted.map(c => `${cardLabel(c)} · ${cardValue(c)}`).join('\n');
  try {
    await msg.author.send(`**Your twist discard (${player.twistDiscard.length}):**\n${lines}`);
    await msg.reply('Check your DMs.');
  } catch {
    await msg.reply(`**Your twist discard (${player.twistDiscard.length}):**\n${lines}`);
  }
};

// !clearhand
commands.clearhand = async (msg, args, g, player) => {
  for (const c of player.hand) player.twistDiscard.push(c);
  const count = player.hand.length;
  player.hand = [];
  save();
  await msg.reply(`Discarded ${count} card(s) from ${msg.author.username}'s hand.`);
};

// ── Abilities ─────────────────────────────────────────────────

// !glimpse — draw top Twist Deck card privately; then !glimpse keep or !glimpse remove
commands.glimpse = async (msg, args, g, player) => {
  if (args[0] === 'keep') {
    if (!player.pendingGlimpse) { await msg.reply('No pending glimpse. Use `!glimpse` first.'); return; }
    const card = player.pendingGlimpse;
    const insertAt = Math.floor(Math.random() * (player.twistDeck.length + 1));
    player.twistDeck.splice(insertAt, 0, card);
    player.pendingGlimpse = null;
    save();
    await msg.reply(`**Sight in Two Worlds** — ${msg.author.username} shuffles the card back into their Twist Deck.`);
    return;
  }
  if (args[0] === 'remove') {
    if (!player.pendingGlimpse) { await msg.reply('No pending glimpse. Use `!glimpse` first.'); return; }
    player.pendingGlimpse = null;
    save();
    await msg.reply(`**Sight in Two Worlds** — ${msg.author.username} removes the card from play for the session.`);
    return;
  }
  if (!player.twistSuits) { await msg.reply('No Twist Deck. Use `!createTwistDeck` first.'); return; }
  if (player.twistDeck.length === 0) {
    if (player.twistDiscard.length === 0) { await msg.reply('Twist Deck and discard are empty.'); return; }
    player.twistDeck = shuffle([...player.twistDiscard]);
    player.twistDiscard = [];
    await msg.channel.send(`${msg.author.username}'s Twist Deck reshuffled.`);
  }
  const card = player.twistDeck.pop();
  player.pendingGlimpse = card;
  save();
  await msg.channel.send(`**Sight in Two Worlds** — ${msg.author.username} glimpses the top card of their Twist Deck. Result sent privately.`);
  try {
    await msg.author.send(`**Sight in Two Worlds** — you drew: **${cardLabel(card)} · ${cardValue(card)}**\n\nUse \`!glimpse keep\` to shuffle it back in, or \`!glimpse remove\` to remove it from play for the session.`);
  } catch {
    await msg.reply(`**${cardLabel(card)} · ${cardValue(card)}**\n\nUse \`!glimpse keep\` to shuffle back or \`!glimpse remove\` to remove.`);
  }
};

// !configure [n...] — place cards as Configuration; no args = show current
commands.configure = async (msg, args, g, player) => {
  if (!args.length) {
    if (!player.configuration.length) { await msg.reply('No Configuration Cards. Use `!configure <card numbers>` to place some.'); return; }
    const lines = player.configuration.map((c, i) => `${i + 1}. ${cardLabel(c)} · ${cardValue(c)}`).join('\n');
    await msg.reply(`**${msg.author.username}'s Configuration (${player.configuration.length}):**\n${lines}`);
    return;
  }
  if (player.hand.length === 0) { await msg.reply('Your hand is empty.'); return; }
  const nums = [...new Set(args.map(a => parseInt(a)).filter(n => !isNaN(n)))].sort((a, b) => b - a);
  if (!nums.length) { await msg.reply('Usage: `!configure <card numbers>` — use `!hand` to see your cards.'); return; }
  for (const n of nums) {
    if (n < 1 || n > player.hand.length) { await msg.reply(`Invalid card number ${n}. You have ${player.hand.length} card(s).`); return; }
  }
  const placed = [];
  for (const n of nums) {
    const [card] = player.hand.splice(n - 1, 1);
    player.configuration.push(card);
    placed.push(card);
  }
  save();
  const placedLine = placed.map(c => `${cardLabel(c)} · ${cardValue(c)}`).join(', ');
  const configLines = player.configuration.map((c, i) => `${i + 1}. ${cardLabel(c)} · ${cardValue(c)}`).join('\n');
  await msg.channel.send(`**The Configuration** — ${msg.author.username} places ${placed.length} card(s): ${placedLine}\n**Configuration (${player.configuration.length}):**\n${configLines}`);
};

// !attune <n...> — add more hand cards to Configuration
commands.attune = async (msg, args, g, player) => {
  if (!args.length) { await msg.reply('Usage: `!attune <card numbers>` — use `!hand` to see your cards.'); return; }
  if (player.hand.length === 0) { await msg.reply('Your hand is empty.'); return; }
  const nums = [...new Set(args.map(a => parseInt(a)).filter(n => !isNaN(n)))].sort((a, b) => b - a);
  if (!nums.length) { await msg.reply('Usage: `!attune <card numbers>`'); return; }
  for (const n of nums) {
    if (n < 1 || n > player.hand.length) { await msg.reply(`Invalid card number ${n}. You have ${player.hand.length} card(s).`); return; }
  }
  const placed = [];
  for (const n of nums) {
    const [card] = player.hand.splice(n - 1, 1);
    player.configuration.push(card);
    placed.push(card);
  }
  save();
  const placedLine = placed.map(c => `${cardLabel(c)} · ${cardValue(c)}`).join(', ');
  const configLines = player.configuration.map((c, i) => `${i + 1}. ${cardLabel(c)} · ${cardValue(c)}`).join('\n');
  await msg.channel.send(`**The Configuration** — ${msg.author.username} attunes ${placed.length} more card(s): ${placedLine}\n**Configuration (${player.configuration.length}):**\n${configLines}`);
};

// !tap <+1/-1> — move one Configuration Card to bottom of Twist Deck, modify duel total
commands.tap = async (msg, args, g, player) => {
  if (player.configuration.length === 0) { await msg.reply('No Configuration Cards. Use `!configure` first.'); return; }
  if (args[0] !== '+1' && args[0] !== '-1') { await msg.reply('Usage: `!tap +1` or `!tap -1`'); return; }
  const card = player.configuration.shift();
  player.twistDeck.unshift(card);
  save();
  await msg.channel.send(`**The Configuration** — ${msg.author.username} taps ${cardLabel(card)} · ${cardValue(card)} — duel total modified by **${args[0]}**.`);
};

// !aethersight — move one Configuration Card to bottom of Twist Deck, reveal top of each player's Twist Deck to them privately
commands.aethersight = async (msg, args, g, player) => {
  if (player.configuration.length === 0) { await msg.reply('No Configuration Cards. Use `!configure` first.'); return; }
  const card = player.configuration.shift();
  player.twistDeck.unshift(card);
  save();
  await msg.channel.send(`**Sight Beyond** — ${msg.author.username} uses Aethersight. The top card of each player's Twist Deck is revealed to them privately.`);
  for (const [uid, p] of Object.entries(g.players)) {
    if (p.twistDeck.length === 0) continue;
    const top = p.twistDeck[p.twistDeck.length - 1];
    try {
      const discordUser = await msg.client.users.fetch(uid);
      await discordUser.send(`**Sight Beyond** — the top card of your Twist Deck is: **${cardLabel(top)} · ${cardValue(top)}**`);
    } catch { /* ignore */ }
  }
};

// !alter <n> <+2/-2> — move up to 3 Configuration Cards to bottom of Twist Deck, modify duel total
commands.alter = async (msg, args, g, player) => {
  const count = parseInt(args[0]);
  const modifier = args[1];
  if (isNaN(count) || count < 1 || count > 3) { await msg.reply('Usage: `!alter <1–3> <+2/-2>`'); return; }
  if (modifier !== '+2' && modifier !== '-2') { await msg.reply('Usage: `!alter <1–3> <+2/-2>`'); return; }
  if (player.configuration.length < count) { await msg.reply(`Not enough Configuration Cards — you have ${player.configuration.length}.`); return; }
  const used = player.configuration.splice(0, count);
  for (const c of used) player.twistDeck.unshift(c);
  save();
  const total = count * (modifier === '+2' ? 2 : -2);
  const totalStr = total >= 0 ? `+${total}` : `${total}`;
  const usedLine = used.map(c => `${cardLabel(c)} · ${cardValue(c)}`).join(', ');
  await msg.channel.send(`**Alteration** — ${msg.author.username} uses ${count} Configuration Card(s) (${usedLine}) — duel total modified by **${totalStr}**.`);
};

// !fateweave <value> <suit> — move 2 Configuration Cards to bottom of Twist Deck, set active flip
commands.fateweave = async (msg, args, g, player) => {
  if (player.configuration.length < 2) { await msg.reply(`Not enough Configuration Cards — you have ${player.configuration.length} (need 2).`); return; }
  if (!g.lastFlips || g.lastFlips.length === 0) { await msg.reply('No active flip.'); return; }
  const value = parseInt(args[0]);
  if (isNaN(value) || value < 1 || value > 13) { await msg.reply('Usage: `!fateweave <1–13> <suit>` e.g. `!fateweave 11 Rams`'); return; }
  const suit = SUIT_ALIASES[args[1]?.toLowerCase()];
  if (!suit) { await msg.reply('Unknown suit. Use Tomes, Masks, Rams, or Crows.'); return; }
  const RANK_FOR_VALUE = { 1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K' };
  const newCard = { rank: RANK_FOR_VALUE[value], suit };
  const used = player.configuration.splice(0, 2);
  for (const c of used) player.twistDeck.unshift(c);
  g.discard.push(g.lastFlips[0]);
  g.lastFlips[0] = newCard;
  save();
  const usedLine = used.map(c => `${cardLabel(c)} · ${cardValue(c)}`).join(', ');
  await msg.channel.send({ content: `**From Across the Aether** — ${msg.author.username} uses ${usedLine} to weave fate.`, embeds: [flipEmbed(g.lastFlips, msg.author.username, true)] });
};

// !sidebar [n] — set card n aside face up; no arg shows the current sidebar card
commands.sidebar = async (msg, args, g, player) => {
  if (!args[0]) {
    if (!g.sidebar) { await msg.reply('No card is currently set aside. Use `!sidebar <card number>` to place one.'); return; }
    const sb = g.sidebar;
    await msg.reply(`**${sb.playerName}** has **${cardLabel(sb.card)} · ${cardValue(sb.card)}** set aside. Use \`!usesidebar\` to send it to ${sb.playerName}'s twist discard.`);
    return;
  }
  if (player.hand.length === 0) { await msg.reply('Your hand is empty.'); return; }
  const cardNum = parseInt(args[0]);
  if (isNaN(cardNum) || cardNum < 1 || cardNum > player.hand.length) {
    await msg.reply(`Invalid number. You have ${player.hand.length} card(s). Use \`!hand\` to check.`);
    return;
  }
  const [set] = player.hand.splice(cardNum - 1, 1);
  g.sidebar = { playerId: msg.author.id, playerName: msg.author.username, card: set };
  save();
  await msg.reply(`**Cards Up a Sleeve** — ${msg.author.username} sets **${cardLabel(set)} · ${cardValue(set)}** aside face up. Any player can use \`!usesidebar\` to send it to ${msg.author.username}'s twist discard.`);
};

// !usesidebar — cheat the active flip using the sidebar card; card goes to owner's twist discard
commands.usesidebar = async (msg, args, g, _player) => {
  if (!g.sidebar) { await msg.reply('No card is currently set aside. Use `!sidebar` to check.'); return; }
  if (!g.lastFlips || g.lastFlips.length === 0) { await msg.reply('No active flip to cheat.'); return; }
  const top = g.lastFlips[0];
  if (top.rank === 'BJ') { await msg.reply('The Black Joker cannot be cheated.'); return; }
  const { playerId, playerName, card: sidebarCard } = g.sidebar;
  const owner = g.players[playerId];
  g.discard.push(top);
  g.lastFlips[0] = sidebarCard;
  if (owner) owner.twistDiscard.push(sidebarCard);
  g.sidebar = null;
  save();
  await msg.reply({ content: `**${msg.author.username}** uses the sidebar — **${cardLabel(sidebarCard)}** goes to ${playerName}'s twist discard.`, embeds: [flipEmbed(g.lastFlips, msg.author.username, true)] });
};

// !peek <n> — discard card n, peek at top 3 of Fate Deck (Marked Cards ability)
commands.peek = async (msg, args, g, player) => {
  if (!args[0]) { await msg.reply('Usage: `!peek <card number to discard>`'); return; }
  if (player.hand.length === 0) { await msg.reply('Your hand is empty.'); return; }
  const cardNum = parseInt(args[0]);
  if (isNaN(cardNum) || cardNum < 1 || cardNum > player.hand.length) {
    await msg.reply(`Invalid number. You have ${player.hand.length} card(s). Use \`!hand\` to check.`);
    return;
  }
  const available = Math.min(3, g.deck.length);
  if (available === 0) { await msg.reply('The Fate Deck is empty.'); return; }
  const [discarded] = player.hand.splice(cardNum - 1, 1);
  player.twistDiscard.push(discarded);
  // Peek at top n cards (highest index = top); store in display order (top first)
  const peek = g.deck.slice(g.deck.length - available).reverse();
  player.pendingMarked = peek;
  save();
  const lines = peek.map((c, i) => `${i + 1}. ${cardLabel(c)} · ${cardValue(c)}`).join('\n');
  // Always announce publicly so the table knows a peek is happening
  await msg.channel.send(`**Marked Cards** — ${msg.author.username} discards ${cardLabel(discarded)} and peeks at the top ${available} card(s) of the Fate Deck. Results sent privately.`);
  try {
    await msg.author.send(`**Marked Cards** — top ${available} of the Fate Deck (1 = next flip):\n${lines}\n\nUse \`!markedkeep\` to put back in the same order, \`!markedkeep 3 1 2\` to reorder (1 = top), or \`!markeddiscard\` to discard all ${available}.`);
  } catch {
    await msg.author.send(`**Marked Cards** — top ${available} of the Fate Deck (1 = next flip):\n${lines}\n\nUse \`!markedkeep\` to put back or \`!markeddiscard\` to discard all.`).catch(async () => {
      await msg.reply(`**Top ${available}:**\n${lines}\n\nUse \`!markedkeep [order]\` to put back, or \`!markeddiscard\` to discard all.`);
    });
  }
};

// !markedkeep [order] — put peeked cards back in given order (default: same)
commands.markedkeep = async (msg, args, g, player) => {
  if (!player.pendingMarked || player.pendingMarked.length === 0) {
    await msg.reply('No pending Marked Cards. Use `!peek <n>` first.');
    return;
  }
  const peek = player.pendingMarked;
  const n = peek.length;
  let order = peek.map((_, i) => i); // default: [0,1,2] = same order (0 = top)
  if (args.length >= n) {
    const parsed = args.slice(0, n).map(a => parseInt(a) - 1);
    const valid = parsed.every(i => i >= 0 && i < n) && new Set(parsed).size === n;
    if (!valid) {
      await msg.reply(`Provide ${n} unique numbers 1–${n}. Example: \`!markedkeep ${Array.from({ length: n }, (_, i) => i + 1).join(' ')}\``);
      return;
    }
    order = parsed;
  }
  // Remove peeked cards from top of deck (they're still there since we only peeked)
  g.deck.splice(g.deck.length - n, n);
  // Push back — last pushed = top of deck (next flip). order[0] = desired top.
  for (let i = order.length - 1; i >= 0; i--) g.deck.push(peek[order[i]]);
  player.pendingMarked = null;
  save();
  await msg.reply(`**Marked Cards** — ${msg.author.username} puts the cards back.`);
};

// !markeddiscard — discard all peeked cards from the Fate Deck
commands.markeddiscard = async (msg, args, g, player) => {
  if (!player.pendingMarked || player.pendingMarked.length === 0) {
    await msg.reply('No pending Marked Cards. Use `!peek <n>` first.');
    return;
  }
  const n = player.pendingMarked.length;
  const removed = g.deck.splice(g.deck.length - n, n);
  g.discard.push(...removed);
  player.pendingMarked = null;
  save();
  await msg.reply(`**Marked Cards** — ${msg.author.username} discards the top ${n} card(s) from the Fate Deck.`);
};

// !countingcards <n> — discard a Twist Card, flip from discard pile this turn. Use again to end.
commands.countingcards = async (msg, args, g, player) => {
  if (g.countingCards === msg.author.id) {
    g.countingCards = null;
    save();
    await msg.reply(`**Counting Cards** — ${msg.author.username} ends their counting cards turn.`);
    return;
  }
  if (!args[0]) { await msg.reply('Usage: `!countingcards <card number to discard>`. Use again to end it.'); return; }
  if (player.hand.length === 0) { await msg.reply('Your hand is empty.'); return; }
  const cardNum = parseInt(args[0]);
  if (isNaN(cardNum) || cardNum < 1 || cardNum > player.hand.length) {
    await msg.reply(`Invalid number. You have ${player.hand.length} card(s). Use \`!hand\` to check.`);
    return;
  }
  const card = player.hand[cardNum - 1];
  if (!card.twistCard) { await msg.reply('Counting Cards requires discarding a **Twist Card** (drawn from your Twist Deck).'); return; }
  player.hand.splice(cardNum - 1, 1);
  player.twistDiscard.push(card);
  g.countingCards = msg.author.id;
  save();
  await msg.reply(`**Counting Cards** — ${msg.author.username} discards ${cardLabel(card)} and will flip from the discard pile this turn. Use \`!countingcards\` to end it.`);
};

// !mulligan — once per session: discard hand, reshuffle twist deck, draw 3
commands.mulligan = async (msg, args, g, player) => {
  if (player.usedMulligan) { await msg.reply('You have already used **Mulligan** this session.'); return; }
  if (player.hand.length === 0) { await msg.reply('Your hand is empty — nothing to mulligan.'); return; }
  const twistCardsInHand = player.hand.filter(c => c.twistCard).length;
  for (const c of player.hand) player.twistDiscard.push(c);
  player.hand = [];
  player.twistDeck = shuffle([...player.twistDeck, ...player.twistDiscard]);
  player.twistDiscard = [];
  const drawn = [];
  for (let i = 0; i < 3; i++) {
    if (player.twistDeck.length === 0) break;
    const c = player.twistDeck.pop();
    player.hand.push(c);
    drawn.push(c);
  }
  player.usedMulligan = true;
  let fateReshuffled = false;
  if (twistCardsInHand > 0) {
    g.deck = shuffle([...g.deck, ...g.discard]);
    g.discard = [];
    fateReshuffled = true;
  }
  save();
  let reply = `**Mulligan** — ${msg.author.username} discards their hand, reshuffles their Twist Deck, and draws ${drawn.length} card(s).`;
  if (fateReshuffled) reply += '\n@here The Fate Deck has also been reshuffled — draw a card to replenish your hand!';
  const handLines = player.hand.map((c, i) => `${i + 1}. ${cardLabel(c)} (${cardValue(c)})`).join('\n');
  try {
    await msg.author.send(`**Hand (${player.hand.length}):**\n${handLines}`);
    await msg.reply(reply + ' Check your DMs for your new hand.');
  } catch {
    await msg.reply(`${reply}\n**New hand:**\n${handLines}`);
  }
};

// !fiftyfifty — once per Dramatic Time: find both Jokers, FM gets one blind, you flip the other
commands.fiftyfifty = async (msg, args, g, player) => {
  if (player.usedFiftyFifty) { await msg.reply('You have already used **Fifty-Fifty Chance** this Dramatic Time. Resets on `!reshuffle`.'); return; }
  // Find all jokers in deck and discard
  const jokers = [];
  const deckIdxs = [];
  const discardIdxs = [];
  for (let i = g.deck.length - 1; i >= 0; i--) {
    if (g.deck[i].rank === 'RJ' || g.deck[i].rank === 'BJ') { jokers.push(g.deck[i]); deckIdxs.push(i); }
  }
  for (let i = g.discard.length - 1; i >= 0; i--) {
    if (g.discard[i].rank === 'RJ' || g.discard[i].rank === 'BJ') { jokers.push(g.discard[i]); discardIdxs.push(i); }
  }
  if (jokers.length === 0) { await msg.reply('No Jokers found in the deck or discard pile.'); return; }
  // Remove all found jokers
  for (const i of deckIdxs.sort((a, b) => b - a)) g.deck.splice(i, 1);
  for (const i of discardIdxs.sort((a, b) => b - a)) g.discard.splice(i, 1);
  // Discard previous active flips
  for (const c of g.lastFlips) g.discard.push(c);
  g.lastFlips = [];
  if (jokers.length === 1) {
    g.lastFlips = [jokers[0]];
    player.usedFiftyFifty = true;
    save();
    await msg.reply({ content: '**Fifty-Fifty Chance** — only one Joker found!', embeds: [flipEmbed([jokers[0]], msg.author.username)] });
    return;
  }
  // Two jokers: randomly assign
  const [fmJoker, playerJoker] = shuffle(jokers);
  const insertAt = Math.floor(Math.random() * (g.deck.length + 1));
  g.deck.splice(insertAt, 0, fmJoker);
  g.lastFlips = [playerJoker];
  player.usedFiftyFifty = true;
  save();
  await msg.reply({ content: `**Fifty-Fifty Chance** — both Jokers found. The FM's pick is shuffled back into the deck blind.`, embeds: [flipEmbed([playerJoker], msg.author.username)] });
};

// !newsession — FM only: full reset, preserving each player's twist deck suit assignments
commands.newsession = async (msg, args, g, _player) => {
  g.deck = shuffle(buildDeck());
  g.discard = [];
  g.lastFlips = [];
  g.sidebar = null;
  g.countingCards = null;
  for (const p of Object.values(g.players)) {
    p.hand = [];
    p.twistDiscard = [];
    p.usedMulligan = false;
    p.usedFiftyFifty = false;
    p.pendingMarked = null;
    p.pendingGlimpse = null;
    p.configuration = [];
    // Rebuild twist deck from suits if the player has them, otherwise clear
    if (p.twistSuits) {
      const s = p.twistSuits;
      const baseCards = [
        ...['A', '5', '9', 'K'].map(rank => ({ rank, suit: s.Defining, twistCard: true })),
        ...['4', '8', 'Q'].map(rank => ({ rank, suit: s.Ascendant, twistCard: true })),
        ...['3', '7', 'J'].map(rank => ({ rank, suit: s.Center, twistCard: true })),
        ...(p.weirdLookin
          ? [
              { rank: '10', suit: s.Defining, twistCard: true },
              { rank: '7', suit: s.Ascendant, twistCard: true },
              { rank: '4', suit: s.Center, twistCard: true },
            ]
          : ['2', '6', '10'].map(rank => ({ rank, suit: s.Descendant, twistCard: true }))),
      ];
      // Apply persistent Twisted Fates boosts
      const boosts = p.twistBoosts || {};
      for (const card of baseCards) {
        const key = `${card.rank}|${card.suit}`;
        if (boosts[key]) card.rank = boostRankBy(card.rank, boosts[key]);
      }
      // Re-add any Red Jokers from Empowered by Fate
      const rjCount = p.empoweredByFateCount || 0;
      for (let i = 0; i < rjCount; i++) baseCards.push({ rank: 'RJ', suit: null, twistCard: true });
      p.twistDeck = shuffle(baseCards);
    } else {
      p.twistDeck = [];
    }
  }
  save();
  await msg.reply('@here New session started. Fate Deck reset, all hands cleared, Twist Decks reshuffled. Use `!draw` to draw your starting hand.');
};

// !setreleasechannel — FM only: set this channel as the release announcement channel (no args = clear)
commands.setreleasechannel = async (msg, args, g, _player) => {
  if (args[0] === 'clear') {
    g.releaseChannel = null;
    save();
    await msg.reply('Release announcement channel cleared.');
    return;
  }
  g.releaseChannel = msg.channel.id;
  save();
  await msg.reply(`Release announcements will be posted here. Current build: **${BUILD_STRING}**`);
};

// !handsize [n] or !handsize @player n (FM only for others)
commands.handsize = async (msg, args, g, player) => {
  const fm = isFateMaster(msg.member);
  const mention = msg.mentions.users.first();
  let target = player;
  let targetName = msg.author.username;
  if (mention && mention.id !== msg.author.id) {
    if (!fm) { await msg.reply(`Only the **${FM_ROLE}** can set another player's hand size.`); return; }
    target = getPlayer(msg.guild.id, mention.id, mention.username);
    targetName = mention.username;
  }
  const numStr = args.find(a => /^\d+$/.test(a));
  const n = parseInt(numStr);
  if (isNaN(n) || n < 1 || n > 10) {
    await msg.reply(`**${targetName}**'s current hand limit: **${target.handLimit}**. Usage: \`!handsize <1–10>\` or \`!handsize @player <1–10>\` (FM only for others).`);
    return;
  }
  target.handLimit = n;
  save();
  await msg.channel.send(`**${targetName}**'s hand limit set to **${n}** card${n === 1 ? '' : 's'}.`);
  if (target.hand.length > n) {
    await msg.channel.send(`⚠️ **${targetName}** has ${target.hand.length} cards — use \`!discard\` to discard down to ${n}.`);
  }
};

// !weirdlookin @player — FM only: grant Weird Lookin' (replaces Descendant cards with bonus cards)
commands.weirdlookin = async (msg, _args, _g, _player) => {
  const mention = msg.mentions.users.first();
  if (!mention) { await msg.reply('Usage: `!weirdlookin @player`'); return; }
  const target = getPlayer(msg.guild.id, mention.id, mention.username);
  if (!target.twistSuits) { await msg.reply(`${mention.username} has no Twist Deck yet.`); return; }
  if (target.weirdLookin) { await msg.reply(`${mention.username} already has **Weird Lookin'**.`); return; }
  const s = target.twistSuits;
  // Remove all Descendant-suited cards from deck, hand, and discard
  const isDescendant = c => c.suit === s.Descendant;
  target.twistDeck = target.twistDeck.filter(c => !isDescendant(c));
  target.hand = target.hand.filter(c => !isDescendant(c));
  target.twistDiscard = target.twistDiscard.filter(c => !isDescendant(c));
  // Add replacement cards shuffled into deck
  const newCards = [
    { rank: '10', suit: s.Defining, twistCard: true },
    { rank: '7', suit: s.Ascendant, twistCard: true },
    { rank: '4', suit: s.Center, twistCard: true },
  ];
  target.twistDeck = shuffle([...target.twistDeck, ...newCards]);
  target.weirdLookin = true;
  save();
  await msg.channel.send(
    `**Weird Lookin'** — ${mention.username} gains this ability. ` +
    `Descendant (${SUIT_EMOJI[s.Descendant]} ${s.Descendant}) cards removed; ` +
    `added 10 of ${SUIT_EMOJI[s.Defining]} ${s.Defining}, 7 of ${SUIT_EMOJI[s.Ascendant]} ${s.Ascendant}, 4 of ${SUIT_EMOJI[s.Center]} ${s.Center}.`
  );
};

// !twistedfates [n] — permanently increase one of your Twist Deck cards' value by 1
commands.twistedfates = async (msg, args, _g, player) => {
  if (!player.twistSuits) { await msg.reply('No Twist Deck yet. Use `!createTwistDeck` first.'); return; }
  // Build combined pool (deck + hand + discard) sorted by value
  const pool = [
    ...player.twistDeck.map(c => ({ card: c, location: 'deck' })),
    ...player.hand.map(c => ({ card: c, location: 'hand' })),
    ...player.twistDiscard.map(c => ({ card: c, location: 'discard' })),
  ].sort((a, b) => cardValue(a.card) - cardValue(b.card));
  const numArg = args.find(a => /^\d+$/.test(a));
  if (!numArg) {
    if (pool.length === 0) { await msg.reply('Your Twist pool is empty.'); return; }
    const lines = pool.map((e, i) => `${i + 1}. ${cardLabel(e.card)} · ${cardValue(e.card)} (${e.location})`).join('\n');
    await msg.reply(`**Your Twist Pool:**\n${lines}\n\nUse \`!twistedfates <n>\` to permanently boost a card.`);
    return;
  }
  const n = parseInt(numArg);
  if (n < 1 || n > pool.length) { await msg.reply(`Invalid number. You have ${pool.length} Twist card(s).`); return; }
  const { card } = pool[n - 1];
  const oldRank = card.rank;
  if (oldRank === 'K' || oldRank === 'RJ' || oldRank === 'BJ') {
    await msg.reply(`${cardLabel(card)} is already at max value and cannot be boosted.`); return;
  }
  const newRank = nextRank(oldRank);
  // Store the boost keyed by original rank (before any previous boost)
  const origRank = card.origRank ?? card.rank;
  const key = `${origRank}|${card.suit}`;
  player.twistBoosts[key] = (player.twistBoosts[key] || 0) + 1;
  card.origRank = origRank;
  card.rank = newRank;
  save();
  await msg.channel.send(
    `**Twisted Fates** — ${msg.author.username}'s ${cardLabel({ rank: oldRank, suit: card.suit })} permanently increased to **${cardLabel(card)} · ${cardValue(card)}**.`
  );
};

// !empoweredbyfate — add a Red Joker to your Twist Deck
commands.empoweredbyfate = async (msg, _args, _g, player) => {
  if (!player.twistSuits) { await msg.reply('No Twist Deck yet. Use `!createTwistDeck` first.'); return; }
  const rj = { rank: 'RJ', suit: null, twistCard: true };
  const insertAt = Math.floor(Math.random() * (player.twistDeck.length + 1));
  player.twistDeck.splice(insertAt, 0, rj);
  player.empoweredByFateCount = (player.empoweredByFateCount || 0) + 1;
  save();
  await msg.channel.send(`**Empowered by Fate** — a Red Joker has been added to ${msg.author.username}'s Twist Deck (${player.twistDeck.length} cards in deck).`);
};

// !test
commands.test = async (msg, args, g, player) => {
  const suitLine = Object.entries(SUIT_EMOJI)
    .map(([suit, emoji]) => `${emoji} ${suit}`)
    .join('  ');
  const twistStatus = player.twistSuits
    ? `${player.twistDeck.length} in deck · ${player.hand.length} in hand · ${player.twistDiscard.length} in discard`
    : 'No Twist Deck';
  await msg.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('WyrdBot — Diagnostics')
        .addFields(
          { name: 'Suit Icons', value: suitLine },
          { name: 'Fate Deck', value: `${g.deck.length} in deck · ${g.discard.length} in discard`, inline: true },
          { name: 'Your Twist Deck', value: twistStatus, inline: true },
          { name: 'FM Role', value: isFateMaster(msg.member) ? 'Yes' : 'No', inline: true },
        )
        .setFooter({ text: `Bot online · ${client.ws.ping}ms` }),
    ],
  });
};

// !start
commands.start = async (msg, _args, _g, _player) => {
  const suits = `${SUIT_EMOJI.Tomes} Tomes · ${SUIT_EMOJI.Masks} Masks · ${SUIT_EMOJI.Rams} Rams · ${SUIT_EMOJI.Crows} Crows`;
  const embed = new EmbedBuilder()
    .setColor(0xb8860b)
    .setTitle('Welcome to Through the Breach!')
    .setDescription("Here's how to get set up and ready to play.")
    .addFields(
      {
        name: 'Step 1 — Create your Twist Deck',
        value: `Your Twist Deck is your personal hand of cards. You need to assign one of the four suits to each of your character's four aspects.\n\n**Suits:** ${suits}\n\n\`\`\`!createTwistDeck <Defining> <Ascendant> <Center> <Descendant>\`\`\`**Example:** \`!createTwistDeck Rams Crows Masks Tomes\`\n\nCheck your character sheet for which suits correspond to which aspect.`,
      },
      {
        name: 'Step 2 — Draw your starting hand',
        value: 'Once your Twist Deck is created, draw cards to fill your hand. Your Fate Master will tell you how many to start with.\n\n```!draw 4```',
      },
      {
        name: 'During Play',
        value: [
          '`!flip` — flip a card from the Fate Deck when making a duel or challenge',
          '`!cheat <n>` — replace the active flip with a card from your hand',
          '`!draw [n]` — draw more cards to your hand',
          '`!hand` — check what cards you\'re holding',
          '`!discard <n>` — discard a card from your hand',
          '`!pile` — see your twist discard pile',
          '`!deckinfo` — check how many cards are left in the Fate Deck',
          '`!help` — show all commands',
        ].join('\n'),
      },
      {
        name: 'Tips',
        value: '• Your hand is private — cards are always sent to you via DM\n• The Black Joker cannot be cheated\n• You can only cheat a flip if you have cards in your hand',
      },
    )
    .setFooter({ text: 'Good luck, Fated.' });

  try {
    await msg.author.send({ embeds: [embed] });
    await msg.reply('Check your DMs for a getting started guide!');
  } catch {
    await msg.reply({ content: 'I couldn\'t DM you — check your privacy settings.', embeds: [embed] });
  }
};

// !help
commands.help = async (msg) => {
  const fm = msg.member && isFateMaster(msg.member);
  await msg.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xb8860b)
        .setTitle('WyrdBot Commands')
        .addFields(
          {
            name: 'Fate Deck',
            value: [
              '`!flip [n]` — flip up to 4 cards; highest is active',
              '`!deckinfo` — deck and discard counts',
            ].join('\n'),
          },
          {
            name: 'Fate Deck 🔒',
            value: [
              '`!shuffle` — reshuffle discard pile into deck',
              '`!reshuffle` — full deck reset',
              '`!newsession` — new session reset (keeps twist suits)',
              '`!clearhand` — discard a player\'s hand',
              '`!setreleasechannel` — set this channel for release announcements (`clear` to remove)',
            ].join('\n'),
          },
          {
            name: 'Abilities — FM Grants 🔒',
            value: [
              '`!weirdlookin @player` — grant Weird Lookin\': replace Descendant cards with 10/Defining, 7/Ascendant, 4/Center',
            ].join('\n'),
          },
          {
            name: 'Abilities — Twist Deck Upgrades',
            value: [
              '`!twistedfates [n]` — permanently boost one of your Twist Deck cards by 1 (no n = list cards)',
              '`!empoweredbyfate` — add a Red Joker to your Twist Deck',
            ].join('\n'),
          },
          {
            name: 'Your Hand',
            value: [
              '`!createTwistDeck D A C De` — set up your Twist Deck',
              '`!twistShuffle` — reshuffle your Twist Deck',
              '`!draw [n]` — draw cards into your hand (sent via DM)',
              '`!hand` — view your current hand (sent via DM)',
              '`!discard <n>` — discard card n from your hand',
              '`!pile` — view your twist discard pile (sent via DM)',
              '`!cheat <n>` — replace the active flip with card n',
              '`!edt [cards...]` — end of Dramatic Time: discard then draw back up to 3',
              '`!handsize [n]` — view or set your hand limit (FM: `!handsize @player n`)',
            ].join('\n'),
          },
          {
            name: 'Abilities — Sight in Two Worlds / The Configuration',
            value: [
              '`!glimpse` — draw top Twist Deck card privately; then `!glimpse keep` or `!glimpse remove`',
              '`!configure [n...]` — place cards as Configuration Cards (no arg = view current)',
              '`!attune <n...>` — add more hand cards to your Configuration',
              '`!tap <+1/-1>` — use one Configuration Card to modify a duel total',
              '`!aethersight` — use one Configuration Card; reveals top of each player\'s Twist Deck to them',
              '`!alter <1–3> <+2/-2>` — use up to 3 Configuration Cards to modify a duel total',
              '`!fateweave <1–13> <suit>` — use 2 Configuration Cards to set the active flip',
            ].join('\n'),
          },
          {
            name: 'Abilities — Other',
            value: [
              '`!sidebar [n]` — set card n aside face-up (no arg = show current)',
              '`!usesidebar` — cheat fate with the sidebar card',
              '`!peek <n>` — discard card n, peek at top 3 of Fate Deck',
              '`!markedkeep [order]` — put peeked cards back (optionally reordered)',
              '`!markeddiscard` — discard all peeked cards',
              '`!countingcards <n>` — discard a Twist Card, flip from discard this turn',
              '`!mulligan` — once per session: discard hand, reshuffle, draw 3',
              '`!fiftyfifty` — once per Dramatic Time: joker flip showdown',
            ].join('\n'),
          },
          {
            name: 'Suits',
            value: `${SUIT_EMOJI.Tomes} Tomes  ${SUIT_EMOJI.Masks} Masks  ${SUIT_EMOJI.Rams} Rams  ${SUIT_EMOJI.Crows} Crows`,
          },
          {
            name: 'Your role',
            value: fm ? 'Fate Master' : 'Player',
            inline: true,
          },
        )
        .setFooter({ text: '🔒 = Fate Master role required' }),
    ],
  });
};

// ── Button handler ────────────────────────────────────────────
async function handleButton(interaction) {
  const [action, targetUserId] = interaction.customId.split('_');

  if (action === 'usesidebar') {
    const g = getGuild(interaction.guildId);
    if (!g.sidebar) {
      await interaction.reply({ content: 'No sidebar card available.', ephemeral: true });
      return;
    }
    if (!g.lastFlips || g.lastFlips.length === 0) {
      await interaction.reply({ content: 'No active flip.', ephemeral: true });
      return;
    }
    const top = g.lastFlips[0];
    if (top.rank === 'BJ') {
      await interaction.reply({ content: 'The Black Joker cannot be cheated.', ephemeral: true });
      return;
    }
    const { playerId, playerName, card: sidebarCard } = g.sidebar;
    const owner = g.players[playerId];
    g.discard.push(top);
    g.lastFlips[0] = sidebarCard;
    if (owner) owner.twistDiscard.push(sidebarCard);
    g.sidebar = null;
    save();
    await interaction.reply({ content: `**${interaction.user.username}** uses the sidebar — **${cardLabel(sidebarCard)}** goes to ${playerName}'s twist discard.`, embeds: [flipEmbed(g.lastFlips, interaction.user.username, true)] });
    return;
  }

  if (action !== 'cheat') return;
  if (interaction.user.id !== targetUserId) {
    await interaction.reply({ content: 'Only the player who flipped can cheat fate.', ephemeral: true });
    return;
  }
  const player = getPlayer(interaction.guildId, interaction.user.id, interaction.user.username);
  if (player.hand.length === 0) {
    await interaction.reply({ content: 'No cards in hand. Use `!draw` first.', ephemeral: true });
    return;
  }
  const lines = player.hand.map((c, i) => `${i + 1}. ${cardLabel(c)} (${cardValue(c)})`).join('\n');
  await interaction.reply({ content: `**Your hand:**\n${lines}\n\nType \`!cheat <number>\` in the channel.`, ephemeral: true });
}

// ── Client ────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once('ready', async () => {
  console.log(`WyrdBot online as ${client.user.tag} — ${BUILD_STRING}`);
  await resolveSuitEmoji(client);
  for (const guild of client.guilds.cache.values()) {
    const g = getGuild(guild.id);
    if (!g.releaseChannel) continue;
    const channel = guild.channels.cache.get(g.releaseChannel);
    if (!channel) continue;
    try {
      await channel.send(`**WyrdBot ${BUILD_STRING}** is now live.`);
    } catch { /* ignore if no permission */ }
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    try { await handleButton(interaction); } catch (e) { console.error(e); }
  }
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot || !msg.content.startsWith(PREFIX)) return;

  const [rawCmd, ...args] = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase();
  const aliases = { createtwistdeck: 'createTwistDeck', twistshuffle: 'twistShuffle', deckinfo: 'deckinfo', clearhand: 'clearhand', weirdlookin: 'weirdlookin', twistedfates: 'twistedfates', empoweredbyfate: 'empoweredbyfate', setreleasechannel: 'setreleasechannel' };
  const resolved = aliases[cmd] || cmd;
  const handler = commands[resolved];
  if (!handler) return;

  if (!msg.guild) { await msg.reply('Use WyrdBot in a server channel.'); return; }

  if (FM_ONLY.has(resolved) && !isFateMaster(msg.member)) {
    await msg.reply(`Only the **${FM_ROLE}** can use \`!${resolved}\`.`);
    return;
  }

  try {
    const g = getGuild(msg.guild.id);
    const player = getPlayer(msg.guild.id, msg.author.id, msg.author.username);
    await handler(msg, args, g, player);
  } catch (err) {
    console.error(`Error in !${resolved}:`, err);
    await msg.reply('Something went wrong.').catch(() => { });
  }
});

if (!TOKEN) { console.error('DISCORD_TOKEN not set.'); process.exit(1); }
client.login(TOKEN);
