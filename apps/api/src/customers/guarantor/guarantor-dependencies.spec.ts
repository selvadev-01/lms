import {
  GUARANTOR_DEPENDENCIES,
  summarizeGuarantorBlockers,
} from './guarantor-dependencies';

/**
 * The guarantor delete guard's reporting half (Module 05 Scenarios 32, 55).
 *
 * The counting lives in `GuarantorService.remove`; what is asserted here is the
 * translation from raw counts to the list the caller is shown. Two properties
 * matter: zero-count entries never appear, because an empty result is what tells
 * the caller the delete may proceed, and the labels survive, because "cannot
 * delete, and here is what is in the way" is the whole point of returning
 * blockers rather than a bare refusal.
 */
describe('summarizeGuarantorBlockers', () => {
  it('reports a dependency that has references', () => {
    const blockers = summarizeGuarantorBlockers({ loanGuarantor: 3 });

    expect(blockers).toEqual([
      {
        entity: 'loanGuarantor',
        label: 'Loan guarantor relationships',
        count: 3,
      },
    ]);
  });

  // An empty list is the signal that the delete may proceed, so a zero must not
  // arrive as `count: 0` and read as a blocker.
  it('drops zero counts', () => {
    expect(summarizeGuarantorBlockers({ loanGuarantor: 0 })).toEqual([]);
  });

  it('treats a missing count as zero', () => {
    expect(summarizeGuarantorBlockers({})).toEqual([]);
  });

  /**
   * `GuarantorDocument` cascades — it is the guarantor's own paperwork, not
   * history shared with another party. Listing it would block every delete on
   * documents the schema is happy to remove.
   */
  it('does not treat guarantor documents as a blocker', () => {
    const entities = GUARANTOR_DEPENDENCIES.map((row) => row.entity);

    expect(entities).not.toContain('guarantorDocument');
  });

  it('names only Restrict relations', () => {
    expect(GUARANTOR_DEPENDENCIES.map((row) => row.entity)).toEqual([
      'loanGuarantor',
    ]);
  });
});
