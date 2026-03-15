// ============================================================
//  WyrdBot — Through the Breach Fate Deck Bot
//  Built for discord.js v14 (slash + prefix commands)
// ============================================================

const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = '!';
const STATE_FILE = path.join(__dirname, 'state.json');
const FM_ROLE = 'Fate Master';   // Discord role name required for FM commands

// Commands only a Fate Master may use
const FM_ONLY = new Set(['flip', 'shuffle', 'reshuffle', 'deckinfo', 'twistShuffle', 'clearhand', 'createTwistDeck']);

function isFateMaster(member) {
  if (!member) return false;
  // Server owner always counts as FM
  if (member.id === member.guild.ownerId) return true;
  return member.roles.cache.some(r => r.name === FM_ROLE);
}

// ── Card Data ─────────────────────────────────────────────────
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['Tomes', 'Masks', 'Rams', 'Crows'];           // Through the Breach suits
const SUIT_EMOJI = { Tomes: '📚', Masks: '🎭', Rams: '🐏', Crows: '🐦‍⬛' };
const SUIT_COLOR = { Tomes: 0xb8860b, Masks: 0x8b1a1a, Rams: 0x2e8b8b, Crows: 0x3a3a5c };
const RANK_VALUE = { A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, RJ: 14, BJ: 0 };

// Standard suit aliases players can type
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

function cardValue(card) {
  return RANK_VALUE[card.rank] ?? 0;
}

// ── State Persistence ─────────────────────────────────────────
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch { }
  return {};
}

function saveState(state) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch { }
}

// state shape per guild:
// state[guildId] = {
//   deck: [...],
//   discard: [...],
//   lastFlips: [...],       // cards currently on the "table"
//   players: {
//     [userId]: {
//       name: string,
//       hand: [...],
//       twistDeck: [...],
//       twistDiscard: [...],
//       twistSuits: { Defining, Ascendant, Center, Descendant }
//     }
//   }
// }

const globalState = loadState();

function getGuild(guildId) {
  if (!globalState[guildId]) {
    globalState[guildId] = {
      deck: shuffle(buildDeck()),
      discard: [],
      lastFlips: [],
      players: {},
    };
    saveState(globalState);
  }
  return globalState[guildId];
}

function getPlayer(guildId, userId, username) {
  const g = getGuild(guildId);
  if (!g.players[userId]) {
    g.players[userId] = {
      name: username,
      hand: [],
      twistDeck: [],
      twistDiscard: [],
      twistSuits: null,
    };
    saveState(globalState);
  } else {
    // Keep name fresh
    g.players[userId].name = username;
  }
  return g.players[userId];
}

function save() { saveState(globalState); }

// ── Draw from fate deck (auto-reshuffle) ───────────────────────
function drawFate(g) {
  if (g.deck.length === 0) {
    if (g.discard.length === 0) return null;
    g.deck = shuffle([...g.discard]);
    g.discard = [];
  }
  return g.deck.pop();
}

// ── Embed helpers ─────────────────────────────────────────────
function baseEmbed(title, color = 0xb8860b) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setFooter({ text: 'Through the Breach · Fate Deck' });
}

function flipEmbed(cards, actor, cheated = false) {
  const top = cards[cards.length - 1];
  let color = 0xb8860b;
  let title = '✦ Fate Flip';
  let desc = '';

  if (top.rank === 'RJ') {
    color = 0xc0392b;
    title = '★ RED JOKER — Extraordinary Fate!';
    desc = '**Highest possible value.** Choose any suit. Something extraordinary happens — a critical success with an extra effect!';
  } else if (top.rank === 'BJ') {
    color = 0x222222;
    title = '✦ BLACK JOKER — Dire Fate!';
    desc = '**Worst possible result.** This flip **cannot be Cheated**. Something goes terribly wrong.';
  } else {
    color = SUIT_COLOR[top.suit] ?? 0xb8860b;
    desc = `**Value: ${cardValue(top)}**`;
    if (top.rank === 'A') desc += ' *(Ace — lowest, value 1)*';
    if (top.rank === 'K') desc += ' *(King — highest natural value)*';
    if (top.suit) desc += `\n\nSuit: ${SUIT_EMOJI[top.suit]} **${top.suit}**`;
  }

  if (cheated) desc += '\n\n*Fate was cheated.*';

  const embed = baseEmbed(title, color)
    .setDescription(desc)
    .addFields({ name: 'Flipped by', value: actor, inline: true });

  if (cards.length > 1) {
    embed.addFields({
      name: 'All flips this round',
      value: cards.map((c, i) => `${i + 1}. ${cardLabel(c)}${i === cards.length - 1 ? ' ← **active**' : ''}`).join('\n'),
    });
  } else {
    embed.addFields({ name: 'Card', value: cardLabel(top), inline: true });
  }

  return embed;
}

// ── Commands ──────────────────────────────────────────────────
const commands = {};

// !flip [n]
commands.flip = async (msg, args, g, player) => {
  const count = Math.min(parseInt(args[0]) || 1, 10);
  const flipped = [];
  for (let i = 0; i < count; i++) {
    const c = drawFate(g);
    if (!c) { await msg.reply('⚠️ No cards remain!'); return; }
    flipped.push(c);
  }
  g.lastFlips = flipped;
  save();

  const embed = flipEmbed(flipped, msg.author.username);
  const components = [];

  // Only show Cheat button if top card is not Black Joker and player has cards in hand
  const top = flipped[flipped.length - 1];
  if (top.rank !== 'BJ' && player.hand.length > 0) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cheat_${msg.author.id}`)
        .setLabel('Cheat Fate')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🃏'),
    );
    components.push(row);
  }

  await msg.reply({ embeds: [embed], components });
};

// !draw [n]
commands.draw = async (msg, args, g, player) => {
  if (!player.twistSuits) {
    await msg.reply('⚠️ You haven\'t created your Twist Deck yet. Use `!createTwistDeck <Defining> <Ascendant> <Center> <Descendant>`');
    return;
  }
  const count = Math.min(parseInt(args[0]) || 1, 6);
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (player.twistDeck.length === 0) {
      if (player.twistDiscard.length === 0) break;
      player.twistDeck = shuffle([...player.twistDiscard]);
      player.twistDiscard = [];
      await msg.channel.send(`🔀 ${msg.author.username}'s Twist Deck was empty — reshuffled discard.`);
    }
    drawn.push(player.twistDeck.pop());
    player.hand.push(drawn[drawn.length - 1]);
  }
  save();

  if (!drawn.length) { await msg.reply('⚠️ Your Twist Deck and discard are both empty!'); return; }

  // Send cards to player privately via DM, acknowledge in channel
  const handLines = player.hand.map((c, i) => `\`${i + 1}.\` ${cardLabel(c)}`).join('\n');
  try {
    await msg.author.send({
      embeds: [
        baseEmbed(`🃏 You drew ${drawn.length} card(s), ${msg.author.username}`)
          .setDescription(`**Drew:** ${drawn.map(cardLabel).join(', ')}\n\n**Your full hand (${player.hand.length} cards):**\n${handLines}`)
          .setFooter({ text: 'Only you can see this · Through the Breach' }),
      ],
    });
    await msg.reply(`📬 Drew ${drawn.length} card(s). Check your DMs for your hand!`);
  } catch {
    // DMs closed — show in channel as fallback
    await msg.reply({
      embeds: [
        baseEmbed(`🃏 ${msg.author.username} drew ${drawn.length} card(s)`)
          .setDescription(`*(Could not DM — showing here)*\n\n**Drew:** ${drawn.map(cardLabel).join(', ')}\n\n**Hand:** ${handLines}`),
      ],
    });
  }
};

// !hand
commands.hand = async (msg, args, g, player) => {
  if (player.hand.length === 0) {
    await msg.reply('Your hand is empty. Use `!draw` to draw from your Twist Deck.');
    return;
  }
  const handLines = player.hand.map((c, i) => `\`${i + 1}.\` ${cardLabel(c)}  *(value: ${cardValue(c)})*`).join('\n');
  try {
    await msg.author.send({
      embeds: [
        baseEmbed(`🃏 Your Hand — ${player.hand.length} card(s)`)
          .setDescription(handLines)
          .addFields({ name: 'To Cheat Fate', value: 'Use `!cheat <card number>` after a flip in your game channel.' })
          .setFooter({ text: 'Only you can see this · Through the Breach' }),
      ],
    });
    await msg.reply('📬 Check your DMs for your hand!');
  } catch {
    await msg.reply({
      embeds: [baseEmbed(`🃏 ${msg.author.username}'s Hand`).setDescription(`*(DMs closed — showing here)*\n\n${handLines}`)],
    });
  }
};

// !cheat <card number>
commands.cheat = async (msg, args, g, player) => {
  if (!args[0]) {
    await msg.reply('Usage: `!cheat <card number>` — e.g. `!cheat 2` to use card #2 from your hand.\nUse `!hand` to see your card numbers.');
    return;
  }
  if (!g.lastFlips || g.lastFlips.length === 0) {
    await msg.reply('⚠️ No fate flip is active. Use `!flip` first.');
    return;
  }

  const top = g.lastFlips[g.lastFlips.length - 1];
  if (top.rank === 'BJ') {
    await msg.reply('⚠️ The **Black Joker** cannot be cheated! Dire fate cannot be avoided.');
    return;
  }

  const cardNum = parseInt(args[0]);
  if (isNaN(cardNum) || cardNum < 1 || cardNum > player.hand.length) {
    await msg.reply(`⚠️ Invalid card number. You have ${player.hand.length} card(s) in hand. Use \`!hand\` to see them.`);
    return;
  }

  const handCard = player.hand[cardNum - 1];

  // Remove from hand, put old flip in hand, put hand card as new top flip
  player.hand.splice(cardNum - 1, 1);
  player.hand.push(top);                          // old flip goes to hand
  g.lastFlips[g.lastFlips.length - 1] = handCard; // replace top flip
  save();

  const embed = flipEmbed(g.lastFlips, msg.author.username, true)
    .addFields({
      name: '🔄 Cheat Fate',
      value: `Replaced **${cardLabel(top)}** with **${cardLabel(handCard)}** from ${msg.author.username}'s hand.`,
    });

  await msg.reply({ embeds: [embed] });
};

// !createTwistDeck <Defining> <Ascendant> <Center> <Descendant>
commands.createTwistDeck = async (msg, args, g, player) => {
  if (args.length < 4) {
    await msg.reply(
      '**Usage:** `!createTwistDeck <Defining> <Ascendant> <Center> <Descendant>`\n' +
      '**Suits:** Tomes, Masks, Rams, Crows\n' +
      '**Example:** `!createTwistDeck Rams Crows Masks Tomes`'
    );
    return;
  }

  const positions = ['Defining', 'Ascendant', 'Center', 'Descendant'];
  const suits = {};
  for (let i = 0; i < 4; i++) {
    const input = args[i].toLowerCase();
    const suit = SUIT_ALIASES[input];
    if (!suit) {
      await msg.reply(`⚠️ Unknown suit: **${args[i]}**. Valid suits: Tomes, Masks, Rams, Crows`);
      return;
    }
    suits[positions[i]] = suit;
  }

  // Build a personal 13-card Twist Deck (one per rank, suits based on destiny)
  // Standard rule: Twist Deck = full 13-card deck with destiny suits influencing which suit each card belongs to
  // Simplified: 13 ranks, suit = the player's primary suit (Defining) for simplicity,
  // but mark it with all 4 destiny positions
  const twistDeck = RANKS.map(rank => ({ rank, suit: suits.Defining, twistCard: true }));

  player.twistSuits = suits;
  player.twistDeck = shuffle(twistDeck);
  player.twistDiscard = [];
  player.hand = [];
  save();

  const lines = positions.map(p => `**${p}:** ${SUIT_EMOJI[suits[p]]} ${suits[p]}`).join('\n');
  await msg.reply({
    embeds: [
      baseEmbed(`🎴 Twist Deck Created — ${msg.author.username}`)
        .setDescription(`Your destiny has been set.\n\n${lines}\n\nYour Twist Deck has been shuffled with **13 cards**.\nUse \`!draw\` to draw into your hand.`),
    ],
  });
};

// !shuffle — reshuffle fate discard into deck
commands.shuffle = async (msg, args, g, player) => {
  const count = g.discard.length;
  g.deck = shuffle([...g.deck, ...g.discard]);
  g.discard = [];
  save();
  await msg.reply({
    embeds: [baseEmbed('🔀 Fate Deck Reshuffled').setDescription(`Shuffled **${count}** discard card(s) back in. Deck now has **${g.deck.length}** cards.`)],
  });
};

// !reshuffle — full reset, notify all to draw a card
commands.reshuffle = async (msg, args, g, player) => {
  g.deck = shuffle(buildDeck());
  g.discard = [];
  g.lastFlips = [];
  save();
  await msg.reply({
    embeds: [
      baseEmbed('♻️ Full Reshuffle!', 0xc0392b)
        .setDescription('The Fate Deck has been **completely reset** and reshuffled.\n\n@here — Draw a card from your Twist Deck to replenish your hand!'),
    ],
  });
};

// !twistShuffle — reshuffle personal twist deck
commands.twistShuffle = async (msg, args, g, player) => {
  if (!player.twistSuits) {
    await msg.reply('⚠️ You haven\'t created your Twist Deck yet. Use `!createTwistDeck`.');
    return;
  }
  player.twistDeck = shuffle([...player.twistDeck, ...player.twistDiscard]);
  player.twistDiscard = [];
  save();
  await msg.reply(`🔀 ${msg.author.username}'s Twist Deck reshuffled! (**${player.twistDeck.length}** cards)`);
};

// !deckinfo
commands.deckinfo = async (msg, args, g, player) => {
  await msg.reply({
    embeds: [
      baseEmbed('📊 Fate Deck Status')
        .addFields(
          { name: 'Cards in Deck', value: `${g.deck.length}`, inline: true },
          { name: 'Cards in Discard', value: `${g.discard.length}`, inline: true },
          { name: 'Active Players', value: `${Object.keys(g.players).length}`, inline: true },
          { name: 'Last Flip', value: g.lastFlips.length ? cardLabel(g.lastFlips[g.lastFlips.length - 1]) : 'None', inline: false },
        ),
    ],
  });
};

// !clearhand
commands.clearhand = async (msg, args, g, player) => {
  const count = player.hand.length;
  for (const c of player.hand) player.twistDiscard.push(c);
  player.hand = [];
  save();
  await msg.reply(`🗑️ Discarded **${count}** card(s) from your hand.`);
};

// !help
commands.help = async (msg) => {
  const fm = msg.member && isFateMaster(msg.member);
  await msg.reply({
    embeds: [
      baseEmbed('📖 WyrdBot Commands')
        .setDescription('Through the Breach — Fate Deck Bot\n🔒 = **Fate Master** role required')
        .addFields(
          {
            name: '🎴 Fate Deck  🔒',
            value: [
              '`!flip` — Flip a card from the Fate Deck',
              '`!flip 3` — Flip multiple cards',
              '`!shuffle` — Reshuffle discard into deck',
              '`!reshuffle` — Full reset (notify all to draw)',
              '`!deckinfo` — Show deck status',
            ].join('\n'),
          },
          {
            name: '🃏 Twist Deck & Hand  🔒',
            value: [
              '`!createTwistDeck Rams Crows Masks Tomes` — Set up a player\'s Twist Deck',
              '`!clearhand` — Discard all cards from your hand',
              '`!twistShuffle` — Reshuffle your Twist Deck',
            ].join('\n'),
          },
          {
            name: '🙋 Player Commands (anyone)',
            value: [
              '`!draw` — Draw 1 card to hand (DM\'d privately)',
              '`!draw 3` — Draw multiple cards',
              '`!hand` — See your current hand (DM\'d privately)',
              '`!cheat 2` — Replace active flip with card #2 from your hand',
              '',
              'After a `!flip`, use `!hand` to see your card numbers,',
              'then `!cheat <number>` to swap a better card in.',
              'You **cannot** cheat the Black Joker.',
            ].join('\n'),
          },
          {
            name: '📚 Suits',
            value: `${SUIT_EMOJI.Tomes} Tomes  ${SUIT_EMOJI.Masks} Masks  ${SUIT_EMOJI.Rams} Rams  ${SUIT_EMOJI.Crows} Crows`,
          },
          {
            name: 'Your Role',
            value: fm ? '✅ You have the **Fate Master** role.' : '🙋 You are a **Player**.',
          },
        ),
    ],
  });
};

// ── Button interaction handler (cheat fate via button) ─────────
async function handleButton(interaction) {
  const [action, targetUserId] = interaction.customId.split('_');
  if (action !== 'cheat') return;
  if (interaction.user.id !== targetUserId) {
    await interaction.reply({ content: '⚠️ Only the player who flipped can cheat fate.', ephemeral: true });
    return;
  }

  const g = getGuild(interaction.guildId);
  const player = getPlayer(interaction.guildId, interaction.user.id, interaction.user.username);

  if (player.hand.length === 0) {
    await interaction.reply({ content: '⚠️ You have no cards in hand. Use `!draw` first.', ephemeral: true });
    return;
  }

  const handLines = player.hand.map((c, i) => `\`${i + 1}.\` ${cardLabel(c)}  *(value: ${cardValue(c)})*`).join('\n');
  await interaction.reply({
    content: `**Your hand — pick a card number then type \`!cheat <number>\` in the channel:**\n${handLines}`,
    ephemeral: true,
  });
}

// ── Discord client ─────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once('ready', () => {
  console.log(`✅ WyrdBot online as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    try { await handleButton(interaction); } catch (e) { console.error(e); }
  }
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith(PREFIX)) return;

  const [rawCmd, ...args] = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase();

  // Resolve command (handle aliases)
  const aliases = {
    createtwistdeck: 'createTwistDeck',
    twistshuffle: 'twistShuffle',
    deckinfo: 'deckinfo',
    clearhand: 'clearhand',
  };
  const resolved = aliases[cmd] || cmd;
  const handler = commands[resolved];
  if (!handler) return;

  // Guild-only commands
  if (!msg.guild) {
    await msg.reply('Please use WyrdBot commands in your Discord server channel.');
    return;
  }

  // FM-only check
  if (FM_ONLY.has(resolved)) {
    if (!isFateMaster(msg.member)) {
      await msg.reply(`⚠️ Only someone with the **${FM_ROLE}** role can use \`!${resolved}\`.`);
      return;
    }
  }

  try {
    const g = getGuild(msg.guild.id);
    const player = getPlayer(msg.guild.id, msg.author.id, msg.author.username);
    await handler(msg, args, g, player);
  } catch (err) {
    console.error(`Error in !${resolved}:`, err);
    await msg.reply('⚠️ Something went wrong. Check the bot logs.').catch(() => { });
  }
});

// ── Start ──────────────────────────────────────────────────────
if (!TOKEN) {
  console.error('❌  DISCORD_TOKEN environment variable is not set!');
  console.error('    Create a .env file with:  DISCORD_TOKEN=your_token_here');
  process.exit(1);
}

client.login(TOKEN);