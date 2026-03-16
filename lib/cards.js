// ── Pure card logic — no Discord dependency ───────────────────

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['Tomes', 'Masks', 'Rams', 'Crows'];

const SUIT_EMOJI_FALLBACK = { Tomes: '♦', Masks: '♠', Rams: '♥', Crows: '♣' };
const SUIT_COLOR = { Tomes: 0xb8860b, Masks: 0x8b1a1a, Rams: 0x2e8b8b, Crows: 0x3a3a5c };

const RANK_VALUE = {
  A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10,
  J: 11, Q: 12, K: 13, RJ: 14, BJ: 0,
};

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

function cardValue(card) { return RANK_VALUE[card.rank] ?? 0; }

module.exports = {
  RANKS, SUITS, SUIT_EMOJI_FALLBACK, SUIT_COLOR, RANK_VALUE, SUIT_ALIASES,
  buildDeck, shuffle, cardValue,
};
