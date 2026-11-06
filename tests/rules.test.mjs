import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canAdd, species, status} from '../public/rules.mjs';

const cards = new Map([
  ['fish-a', {key: 'magikarp', max: 4}],
  ['fish-b', {key: 'magikarp', max: 4}],
  ['water', {key: 'water', max: 6}],
  ['splash', {key: 'splash', max: 3}],
  ['wind', {key: 'removal', max: 1}],
  ['blower', {key: 'removal', max: 1}],
  ...species.map(name => [name, {key: name, max: 1}]),
  ['espeon-2', {key: 'Espeon', max: 1}],
  ...Array.from({length: 11}, (_, i) => ['trainer-' + i, {key: 'trainer-' + i, max: 4}])
]);
const rest = Object.fromEntries(Array.from({length: 11}, (_, i) => ['trainer-' + i, 4]));

test('validates a complete deck with mixed Magikarp and energy printings', () => {
  const deck = {'fish-a': 2, 'fish-b': 2, water: 3, splash: 3, ...rest, wind: 1,
    Jolteon: 1, Vaporeon: 1, Flareon: 1, Espeon: 1, Umbreon: 1};
  assert.equal(status(deck, cards).valid, true);
  assert.equal(status({...deck, water: 2, splash: 4}, cards).valid, false);
  assert.equal(status({...deck, wind: 0, unknown: 1}, cards).valid, false);
});

test('enforces shared caps and reserves slots for mandatory cards', () => {
  assert.equal(canAdd({wind: 1}, cards, 'blower'), false);
  assert.equal(canAdd({Espeon: 1}, cards, 'espeon-2'), false);
  assert.equal(canAdd({'fish-a': 4}, cards, 'fish-b'), false);
  assert.equal(canAdd({water: 4, splash: 2}, cards, 'splash'), false);
  assert.equal(canAdd({...rest, wind: 1}, cards, 'blower'), false);
  assert.equal(canAdd({...rest, wind: 1}, cards, 'Espeon'), true);
  assert.equal(canAdd(Object.fromEntries(species.slice(0, 5).map(name => [name, 1])), cards, 'Glaceon'), false);
});
