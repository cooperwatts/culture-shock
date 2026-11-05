## What this changes

<!-- And why. If the reasoning is not obvious from the diff, put it here rather than
     making the reviewer reconstruct it. -->

## How it was tested

<!-- "Ran the suite" is fine for a contained change. For matching, delivery or privacy,
     say what you actually exercised. -->

## Checks

- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] Added or updated a test that would have failed before this change
- [ ] Updated the docs if behaviour or configuration changed

## Does this touch a sensitive area?

- [ ] Pack capability surface (`packages/pack-sdk/src/capabilities.ts`)
- [ ] Privacy: redaction, cohort suppression, consent, export shape
- [ ] Matching fairness: hard constraints, fairness report
- [ ] Authorization (`packages/domain/src/authorization.ts`)
- [ ] None of the above

<!-- If you ticked any of the first four, explain the reasoning below. These get
     reviewed more closely, which is not a judgement on the change. -->
