import { describe, expect, it } from 'vitest';
import { getMaskedId } from './idValidation';

describe('getMaskedId', () => {
  it('reveals only the last four digits of an Aadhaar', () => {
    // Was `1234XXXX5678` — first four AND last four, so 8 of the 12 digits were
    // visible. UIDAI's masked-Aadhaar format shows the last four only.
    expect(getMaskedId('aadhaar', '2345 6789 0123')).toBe('XXXXXXXX0123');
    expect(getMaskedId('aadhaar', '234567890123')).toBe('XXXXXXXX0123');
  });

  it('does not leak the first four via a different case', () => {
    expect(getMaskedId('AADHAAR', '234567890123')).not.toContain('2345');
  });

  it('keeps UAN readable, because it is a PF account number not an identity document', () => {
    expect(getMaskedId('uan', '100234567890')).toBe('1002XXXX7890');
  });

  it('masks PAN to its first two and last three, which is the convention', () => {
    expect(getMaskedId('pan', 'ABCDE1234F')).toBe('ABXXXXX34F');
  });

  it('falls back to last four for an unrecognised type', () => {
    expect(getMaskedId('something_else', '9876543210')).toBe('XXXX3210');
  });
});
