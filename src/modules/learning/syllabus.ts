/**
 * The programme's modules, as the public sees them: the "What you study"
 * list on PB-01 and the modules a faculty applicant can offer to teach.
 * One list, so the two can never disagree.
 */
export const SYLLABUS = [
  {
    title: 'The Act itself',
    body: 'The NDPA 2023 read in full and in order: scope, the lawful bases, the rights it creates and the penalties behind them. Not a summary of a summary.',
  },
  {
    title: 'GAID 2025 in practice',
    body: 'What the General Application and Implementation Directive actually requires of a controller of major importance, on what cadence, and what evidence satisfies it.',
  },
  {
    title: 'Consent that holds up',
    body: 'Separate, purpose specific, as easy to withdraw as to give. Where consent is the wrong basis entirely, and what to use instead.',
  },
  {
    title: 'DPIAs and privacy by design',
    body: 'Running an assessment that changes a design decision, rather than one filed after the system ships.',
  },
  {
    title: 'Breach handling',
    body: 'The 72 hour clock from the moment it starts: containment, the assessment, notifying the Commission, and telling the people whose data it was.',
  },
  {
    title: 'Audit and the DPCO regime',
    body: 'Annual audit filing, working with a licensed DPCO, and the record keeping that makes the filing a formality instead of a scramble.',
  },
];

export const MODULE_TITLES = SYLLABUS.map((m) => m.title);
