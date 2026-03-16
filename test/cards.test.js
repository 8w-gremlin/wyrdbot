const { RANKS, SUITS, SUIT_ALIASES, RANK_VALUE, buildDeck, shuffle, cardValue } = require('../lib/cards');

describe('buildDeck', () => {
  let deck;
  beforeEach(() => { deck = buildDeck(); });

  test('returns 54 cards', () => {
    expect(deck).toHaveLength(54);
  });

  test('contains 52 suited cards', () => {
    expect(deck.filter(c => c.suit !== null)).toHaveLength(52);
  });

  test('contains exactly one Red Joker', () => {
    expect(deck.filter(c => c.rank === 'RJ')).toHaveLength(1);
  });

  test('contains exactly one Black Joker', () => {
    expect(deck.filter(c => c.rank === 'BJ')).toHaveLength(1);
  });

  test('jokers have null suit', () => {
    expect(deck.find(c => c.rank === 'RJ').suit).toBeNull();
    expect(deck.find(c => c.rank === 'BJ').suit).toBeNull();
  });

  test('each suit has exactly 13 cards', () => {
    for (const suit of SUITS) {
      expect(deck.filter(c => c.suit === suit)).toHaveLength(13);
    }
  });

  test('each rank appears exactly 4 times across suited cards', () => {
    for (const rank of RANKS) {
      expect(deck.filter(c => c.rank === rank)).toHaveLength(4);
    }
  });

  test('no duplicate cards', () => {
    const keys = deck.map(c => `${c.rank}:${c.suit}`);
    expect(new Set(keys).size).toBe(54);
  });

  test('all suited cards have valid suit and rank values', () => {
    const suited = deck.filter(c => c.suit !== null);
    for (const card of suited) {
      expect(SUITS).toContain(card.suit);
      expect(RANKS).toContain(card.rank);
    }
  });
});

describe('shuffle', () => {
  test('returns an array of the same length', () => {
    expect(shuffle([1, 2, 3, 4, 5])).toHaveLength(5);
  });

  test('returns a new array reference', () => {
    const arr = [1, 2, 3];
    expect(shuffle(arr)).not.toBe(arr);
  });

  test('does not mutate the original array', () => {
    const arr = [1, 2, 3, 4, 5];
    const copy = [...arr];
    shuffle(arr);
    expect(arr).toEqual(copy);
  });

  test('contains the same elements', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7];
    expect(shuffle(arr).sort((a, b) => a - b)).toEqual([...arr].sort((a, b) => a - b));
  });

  test('works on an empty array', () => {
    expect(shuffle([])).toEqual([]);
  });

  test('works on a single-element array', () => {
    expect(shuffle([42])).toEqual([42]);
  });
});

describe('cardValue', () => {
  test('Ace = 1', () => {
    expect(cardValue({ rank: 'A', suit: 'Tomes' })).toBe(1);
  });

  test.each([2, 3, 4, 5, 6, 7, 8, 9, 10])('%i = %i', (n) => {
    expect(cardValue({ rank: String(n), suit: 'Tomes' })).toBe(n);
  });

  test('J = 11', () => expect(cardValue({ rank: 'J', suit: 'Tomes' })).toBe(11));
  test('Q = 12', () => expect(cardValue({ rank: 'Q', suit: 'Tomes' })).toBe(12));
  test('K = 13', () => expect(cardValue({ rank: 'K', suit: 'Tomes' })).toBe(13));

  test('Red Joker = 14', () => {
    expect(cardValue({ rank: 'RJ', suit: null })).toBe(14);
  });

  test('Black Joker = 0', () => {
    expect(cardValue({ rank: 'BJ', suit: null })).toBe(0);
  });

  test('unknown rank returns 0', () => {
    expect(cardValue({ rank: 'X', suit: null })).toBe(0);
  });
});

describe('constants', () => {
  test('RANKS has 13 entries', () => {
    expect(RANKS).toHaveLength(13);
  });

  test('SUITS has exactly the four Malifaux suits', () => {
    expect(SUITS).toHaveLength(4);
    expect(SUITS).toEqual(expect.arrayContaining(['Tomes', 'Masks', 'Rams', 'Crows']));
  });

  test('RANK_VALUE covers all 13 ranks plus both jokers', () => {
    const expected = [...RANKS, 'RJ', 'BJ'];
    for (const key of expected) {
      expect(RANK_VALUE).toHaveProperty(key);
    }
  });

  test.each([
    ['t', 'Tomes'], ['tome', 'Tomes'], ['tomes', 'Tomes'],
    ['m', 'Masks'], ['mask', 'Masks'], ['masks', 'Masks'],
    ['r', 'Rams'],  ['ram', 'Rams'],   ['rams', 'Rams'],
    ['c', 'Crows'], ['crow', 'Crows'], ['crows', 'Crows'],
  ])('SUIT_ALIASES["%s"] = "%s"', (alias, expected) => {
    expect(SUIT_ALIASES[alias]).toBe(expected);
  });
});
