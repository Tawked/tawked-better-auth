import { describe, expect, it } from 'vitest';
import { isSaudiMobile, toSaudiE164 } from '../src/index.js';
import * as client from '../src/client.js';

describe('toSaudiE164', () => {
  it.each([
    ['+966512345678', '+966512345678'],
    ['966512345678', '+966512345678'],
    ['00966512345678', '+966512345678'],
    ['0512345678', '+966512345678'],
    ['512345678', '+966512345678'],
    ['+966 51 234 5678', '+966512345678'],
    ['051-234-5678', '+966512345678'],
    ['٠٥١٢٣٤٥٦٧٨', '+966512345678'],
    ['۰۵۱۲۳۴۵۶۷۸', '+966512345678'],
    ['‎+966 512345678‏', '+966512345678'],
    ['  0512345678  ', '+966512345678'],
  ])('reads %j as %s', (input, expected) => {
    expect(toSaudiE164(input)).toBe(expected);
    expect(isSaudiMobile(input)).toBe(true);
  });

  it.each(['', '+15551234567', '0112345678', '+9665123456789', '+96651234567', '05123456789', 'abc', '+966 41 234 5678'])(
    'refuses %j',
    (input) => {
      expect(toSaudiE164(input)).toBeNull();
      expect(isSaudiMobile(input)).toBe(false);
    },
  );

  it('refuses what is not a string', () => {
    expect(toSaudiE164(undefined as unknown as string)).toBeNull();
  });

  it('is in the browser entry too', () => {
    expect(client.toSaudiE164('0512345678')).toBe('+966512345678');
  });
});
