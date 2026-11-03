/** Putting the app on a band member's phone (2026-11-03): which device, when to offer, and the steps. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installGuide, offerInstall, platformOf } from '../harness/install.ts';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const MAC = IPAD;

test('device: iPhone, iPad (a Mac with touch), Android, or a computer', () => {
  assert.equal(platformOf(IPHONE), 'ios');
  assert.equal(platformOf(IPAD, 5), 'ios');
  assert.equal(platformOf(MAC, 0), 'desktop');
  assert.equal(platformOf(ANDROID), 'android');
  assert.equal(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0'), 'desktop');
  assert.equal(platformOf(''), 'desktop');
});

test('offered by itself once, to a band member, in a browser only', () => {
  assert.equal(offerInstall({ member: true, standalone: false, offeredBefore: false }), true);
  assert.equal(offerInstall({ member: true, standalone: false, offeredBefore: true }), false, 'once per account on this device');
  assert.equal(offerInstall({ member: true, standalone: true, offeredBefore: false }), false, 'already on the Home Screen');
  assert.equal(offerInstall({ member: false, standalone: false, offeredBefore: false }), false, 'owners: unchanged');
});

test('iPhone: Share, Add to Home Screen, then sign in again there (its own storage)', () => {
  const g = installGuide('ios', 'https://zuniga.example/');
  assert.equal(g.steps.length, 3);
  assert.match(g.steps[0]!, /Share/);
  assert.match(g.steps[1]!, /Add to Home Screen/);
  assert.match(g.steps[2]!, /sign in again with the same email/);
});

test('Android: Chrome menu, Install app; stays signed in', () => {
  const g = installGuide('android', 'https://zuniga.example/');
  assert.match(g.steps[1]!, /Install app/);
  assert.match(g.steps[2]!, /stay signed in/);
});

test('a computer: open the app on the phone, sign in with the same email, add it', () => {
  const g = installGuide('desktop', 'https://zuniga.example/');
  assert.equal(g.steps[0], 'On your phone, open https://zuniga.example/');
  assert.match(g.steps[1]!, /same email/);
  assert.match(g.steps[2]!, /iPhone.*Android/);
});
