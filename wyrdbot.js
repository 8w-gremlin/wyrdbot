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
const FM_ONLY = new Set(['shuffle', 'reshuffle', 'clearhand', 'newsession']);

function isFateMaster(member) {
  if (!member) return false;
  if (member.id === member.guild.ownerId) return true;
  return member.roles.cache.some(r => r.name === FM_ROLE);
}

// ── Card Data ─────────────────────────────────────────────────
const {
  SUIT_EMOJI_FALLBACK, SUIT_COLOR, SUIT_ALIASES,
  buildDeck, shuffle, cardValue,
} = require('./lib/cards');

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
  return g;
}

function getPlayer(guildId, userId, username) {
  const g = getGuild(guildId);
  if (!g.players[userId]) {
    g.players[userId] = { name: username, hand: [], twistDeck: [], twistDiscard: [], twistSuits: null, usedMulligan: false, usedFiftyFifty: false, pendingMarked: null };
    saveState(globalState);
  } else {
    g.players[userId].name = username;
    if (g.players[userId].usedMulligan === undefined) g.players[userId].usedMulligan = false;
    if (g.players[userId].usedFiftyFifty === undefined) g.players[userId].usedFiftyFifty = false;
    if (g.players[userId].pendingMarked === undefined) g.players[userId].pendingMarked = null;
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
  if (player.hand.length > HAND_LIMIT) {
    await channel.send(`⚠️ **${player.name}** has ${player.hand.length} cards — over the hand limit of ${HAND_LIMIT}. Use \`!discard\` to discard down to ${HAND_LIMIT}.`);
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
    await msg.author.send(`**Hand (${player.hand.length}/${HAND_LIMIT}):**\n${handLines}`);
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

  // Draw back up to DRAW_TARGET, capped by HAND_LIMIT
  const drawCount = Math.max(0, Math.min(DRAW_TARGET - player.hand.length, HAND_LIMIT - player.hand.length));
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
  announcement += ` drew ${drawn.length} card(s). Hand: ${player.hand.length}/${HAND_LIMIT}.`;
  if (player.hand.length >= HAND_LIMIT) announcement += ' *(at hand limit)*';
  await msg.channel.send(announcement);

  // Send updated hand privately
  if (player.hand.length === 0) { await msg.reply('Your hand is now empty.'); return; }
  const handLines = player.hand.map((c, i) => `${i + 1}. ${cardLabel(c)} (${cardValue(c)})`).join('\n');
  try {
    await msg.author.send(`**Hand (${player.hand.length}/${HAND_LIMIT}):**\n${handLines}`);
    await msg.reply('Check your DMs for your updated hand.');
  } catch {
    await msg.reply(`**Your hand (${player.hand.length}/${HAND_LIMIT}):**\n${handLines}`);
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

// !luckofthedraw — draw 2 cards instead of 1 when the Fate Deck is reshuffled
commands.luckofthedraw = async (msg, args, g, player) => {
  if (!player.twistSuits) { await msg.reply('No Twist Deck. Use `!createTwistDeck` first.'); return; }
  const drawn = [];
  for (let i = 0; i < 2; i++) {
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
    await msg.author.send(`**Hand (${player.hand.length}/${HAND_LIMIT}):**\n${handLines}`);
    await msg.reply(`**Luck of the Draw** — ${msg.author.username} draws ${drawn.length} cards. Check your DMs.`);
  } catch {
    await msg.reply(`**Luck of the Draw** — drew ${drawn.length}.\n**Your hand:**\n${handLines}`);
  }
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
  await msg.reply(`**Marked Cards** — ${msg.author.username} puts the cards back. Top of deck: **${cardLabel(peek[order[0]])} · ${cardValue(peek[order[0]])}**.`);
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
    // Rebuild twist deck from suits if the player has them, otherwise clear
    if (p.twistSuits) {
      const s = p.twistSuits;
      p.twistDeck = shuffle([
        ...['A', '5', '9', 'K'].map(rank => ({ rank, suit: s.Defining, twistCard: true })),
        ...['4', '8', 'Q'].map(rank => ({ rank, suit: s.Ascendant, twistCard: true })),
        ...['3', '7', 'J'].map(rank => ({ rank, suit: s.Center, twistCard: true })),
        ...['2', '6', '10'].map(rank => ({ rank, suit: s.Descendant, twistCard: true })),
      ]);
    } else {
      p.twistDeck = [];
    }
  }
  save();
  await msg.reply('@here New session started. Fate Deck reset, all hands cleared, Twist Decks reshuffled. Use `!draw` to draw your starting hand.');
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
            name: 'Fate Deck 🔒',
            value: '`!flip [n]` · `!shuffle` · `!reshuffle` · `!newsession` · `!deckinfo`',
          },
          {
            name: 'Fate Deck 🔒',
            value: '`!clearhand`',
          },
          {
            name: 'Players',
            value: '`!createTwistDeck D A C De` · `!twistShuffle` · `!draw [n]` · `!hand` · `!cheat <n>` · `!discard <n>` · `!pile` · `!edt [cards...]`',
          },
          {
            name: 'Abilities',
            value: '`!luckofthedraw` · `!sidebar [n]` · `!usesidebar` · `!peek <n>` · `!markedkeep [order]` · `!markeddiscard` · `!countingcards <n>` · `!mulligan` · `!fiftyfifty`',
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
  console.log(`WyrdBot online as ${client.user.tag}`);
  await resolveSuitEmoji(client);
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
  const aliases = { createtwistdeck: 'createTwistDeck', twistshuffle: 'twistShuffle', deckinfo: 'deckinfo', clearhand: 'clearhand' };
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
