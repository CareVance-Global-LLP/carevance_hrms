import { describe, expect, it } from 'vitest';
import { mergeCatalogueAvailability } from './filingAvailability';

const card = (key: string, complianceStatus = 'ready') => ({
  key,
  label: key,
  complianceStatus,
});

describe('mergeCatalogueAvailability', () => {
  it('marks a filing unavailable when the server says its template is missing', () => {
    const merged = mergeCatalogueAvailability(
      [card('form_19')],
      {
        form_19: {
          label: 'Form 19',
          available: false,
          unavailable_reason: 'The statutory template for this form has not been written yet.',
        },
      },
    );

    expect(merged[0].available).toBe(false);
    expect(merged[0].unavailableReason).toBe(
      'The statutory template for this form has not been written yet.',
    );
  });

  it('does not reuse the state-specific not_configured status, which would claim something untrue', () => {
    const merged = mergeCatalogueAvailability(
      [card('form_19')],
      { form_19: { label: 'Form 19', available: false, unavailable_reason: 'Not written yet.' } },
    );

    expect(merged[0].complianceStatus).toBe('unavailable');
    expect(merged[0].complianceStatus).not.toBe('not_configured');
  });

  it('leaves an available filing untouched', () => {
    const merged = mergeCatalogueAvailability(
      [card('pf_ecr')],
      { pf_ecr: { label: 'PF ECR', available: true, unavailable_reason: null } },
    );

    expect(merged[0].available).toBe(true);
    expect(merged[0].unavailableReason).toBeNull();
    expect(merged[0].complianceStatus).toBe('ready');
  });

  it('treats a filing the server does not mention as available, so a client newer than its backend never hides a working filing', () => {
    const merged = mergeCatalogueAvailability(
      [card('bonus_form_c', 'not_configured')],
      {},
    );

    expect(merged[0].available).toBe(true);
    expect(merged[0].complianceStatus).toBe('not_configured');
  });

  it('preserves every other field on the card', () => {
    const merged = mergeCatalogueAvailability(
      [{ ...card('form_31'), tooltip: 'Transfer application', pattern: 'A' }],
      { form_31: { label: 'Form 31', available: false, unavailable_reason: 'Not written yet.' } },
    );

    expect(merged[0].tooltip).toBe('Transfer application');
    expect(merged[0].pattern).toBe('A');
  });

  it('returns the same number of cards it was given', () => {
    const merged = mergeCatalogueAvailability(
      [card('pf_ecr'), card('form_19'), card('form_124')],
      {
        pf_ecr: { label: 'PF ECR', available: true, unavailable_reason: null },
        form_19: { label: 'Form 19', available: false, unavailable_reason: 'Not written yet.' },
        form_124: { label: 'Form 124', available: false, unavailable_reason: 'Not written yet.' },
      },
    );

    expect(merged).toHaveLength(3);
    expect(merged.filter((f) => !f.available).map((f) => f.key)).toEqual(['form_19', 'form_124']);
  });
});
