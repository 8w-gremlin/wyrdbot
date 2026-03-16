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
const FM_ONLY = new Set(['shuffle', 'reshuffle', 'clearhand']);

function isFateMaster(member) {
  if (!member) return false;
  if (member.id === member.guild.ownerId) return true;
  return member.roles.cache.some(r => r.name === FM_ROLE);
}

// ── Card Data ─────────────────────────────────────────────────
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['Tomes', 'Masks', 'Rams', 'Crows'];
// Fallback standard emoji if custom ones aren't found
const SUIT_EMOJI_FALLBACK = { Tomes: '♦', Masks: '♠', Rams: '♥', Crows: '♣' };

// Custom emoji IDs — resolved to full strings at runtime if available in the guild
const SUIT_EMOJI_CUSTOM = {
  Tomes: { name: 'tome', id: '1134359150818758837' },
  Masks: { name: 'mask', id: '1134359109987209296' },
  Rams: { name: 'ram', id: '1134359131545948160' },
  Crows: { name: 'crow', id: '1134370225664557096' },
};

// Resolved at runtime — starts with fallbacks, upgraded on bot ready
const SUIT_EMOJI = { ...SUIT_EMOJI_FALLBACK };

function resolveSuitEmoji(client) {
  for (const [suit, custom] of Object.entries(SUIT_EMOJI_CUSTOM)) {
    const found = client.emojis.cache.get(custom.id);
    SUIT_EMOJI[suit] = found ? found.toString() : SUIT_EMOJI_FALLBACK[suit];
  }
  console.log('Suit emoji resolved:', SUIT_EMOJI);
}
const SUIT_COLOR = { Tomes: 0xb8860b, Masks: 0x8b1a1a, Rams: 0x2e8b8b, Crows: 0x3a3a5c };
const RANK_VALUE = { A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, RJ: 14, BJ: 0 };
const SUIT_ALIASES = {
  tomes: 'Tomes', tome: 'Tomes', t: 'Tomes',
  masks: 'Masks', mask: 'Masks', m: 'Masks',
  rams: 'Rams', ram: 'Rams', r: 'Rams',
  crows: 'Crows', crow: 'Crows', c: 'Crows',
};

function buildDeck() {
  const cards = [];
  for (const suit of SUITS)
    for (const rank of RANKS)
      cards.push({ rank, suit });
  cards.push({ rank: 'RJ', suit: null });
  cards.push({ rank: 'BJ', suit: null });
  return cards;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cardLabel(card) {
  if (card.rank === 'RJ') return '★ Red Joker';
  if (card.rank === 'BJ') return '✦ Black Joker';
  return `${card.rank} of ${SUIT_EMOJI[card.suit]} ${card.suit}`;
}

function cardValue(card) { return RANK_VALUE[card.rank] ?? 0; }

// ── State ─────────────────────────────────────────────────────
function loadState() {
  try { if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { }
  return {};
}
function saveState(s) { try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch { } }

const globalState = loadState();

function getGuild(guildId) {
  if (!globalState[guildId]) {
    globalState[guildId] = { deck: shuffle(buildDeck()), discard: [], lastFlips: [], players: {} };
    saveState(globalState);
  }
  return globalState[guildId];
}

function getPlayer(guildId, userId, username) {
  const g = getGuild(guildId);
  if (!g.players[userId]) {
    g.players[userId] = { name: username, hand: [], twistDeck: [], twistDiscard: [], twistSuits: null };
    saveState(globalState);
  } else {
    g.players[userId].name = username;
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

  const flipped = [];
  for (let i = 0; i < count; i++) {
    const c = drawFate(g);
    if (!c) { await msg.reply('No cards remain.'); return; }
    flipped.push(c);
  }

  // Sort descending by value — highest is the active card (last in array)
  flipped.sort((a, b) => cardValue(b) - cardValue(a));
  g.lastFlips = flipped;
  save();

  const top = flipped[0]; // highest value = active
  const components = [];
  if (top.rank !== 'BJ' && player.hand.length > 0) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cheat_${msg.author.id}`)
        .setLabel('Cheat Fate')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🃏')
    ));
  }

  const embed = flipEmbed(flipped, msg.author.username);
  await msg.reply({ embeds: [embed], components });
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

  const handLines = player.hand.map((c, i) => `${i + 1}. ${cardLabel(c)} (${cardValue(c)})`).join('\n');
  try {
    await msg.author.send(`**Hand (${player.hand.length}):**\n${handLines}`);
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
commands.shuffle = async (msg, args, g, player) => {
  const count = g.discard.length;
  g.deck = shuffle([...g.deck, ...g.discard]);
  g.discard = [];
  save();
  await msg.reply(`Reshuffled ${count} card(s). Deck: ${g.deck.length}`);
};

// !reshuffle
commands.reshuffle = async (msg, args, g, player) => {
  g.deck = shuffle(buildDeck());
  g.discard = [];
  g.lastFlips = [];
  save();
  await msg.reply('@here Fate Deck reset. Draw a card to replenish your hand.');
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
commands.deckinfo = async (msg, args, g, player) => {
  const last = g.lastFlips.length ? cardLabel(g.lastFlips[0]) : 'none';
  await msg.reply(`Deck: ${g.deck.length} · Discard: ${g.discard.length} · Last flip: ${last}`);
};

// !discard — show player's own twist discard pile
commands.discard = async (msg, args, g, player) => {
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
            value: '`!flip [n]` · `!shuffle` · `!reshuffle` · `!deckinfo`',
          },
          {
            name: 'Fate Deck 🔒',
            value: '`!clearhand`',
          },
          {
            name: 'Players',
            value: '`!createTwistDeck D A C De` · `!twistShuffle` · `!draw [n]` · `!hand` · `!cheat <n>` · `!discard`',
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

client.once('ready', () => {
  console.log(`WyrdBot online as ${client.user.tag}`);
  resolveSuitEmoji(client);
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
