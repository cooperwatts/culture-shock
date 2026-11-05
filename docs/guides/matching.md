# Matching

Matching is scoring-based and reproducible. The same input produces the same output, every time, regardless of the order participants arrive in.

There is no random assignment anywhere, and a model is never the matcher. AI can propose bounded weights for a human to accept, and that is the limit of its involvement.

## How a run works

A designer closes enrolment, which locks the participant list. They request a preview, choosing a strategy. The run produces proposed groups, diagnostics and a fairness report. Nothing is visible to participants until the designer publishes it.

Runs are keyed by a hash of the input snapshot and the strategy. Asking for the same preview twice returns the stored run rather than recomputing, which also means a retried job cannot produce a different answer.

## Strategies

| Key | Optimises for |
| --- | --- |
| `cross-functional` | Different departments and teams, avoiding repeats |
| `diversity-optimized` | Spread across department, geography and tenure |
| `remote-first` | Working-hours overlap and compatible formats |
| `new-hire-friendly` | Pairing a new starter with an experienced buddy |
| `leadership-mix` | Mixing role levels, with safeguards |

Each exposes weight keys a pack or designer can tune. Values outside 0 to 1 are clamped rather than rejected, so a bad weight degrades the result instead of failing the run.

`leadership-mix` refuses to pair across a large role gap inside the same team, since that is probably a reporting line and a candid conversation is unlikely.

`new-hire-friendly` requires exactly one new starter per pair and refuses a buddy who is themselves in their first three months.

## Hard constraints

Resolved before any scoring, and not negotiable by weighting.

```
no_self_match             no_repeat_match
different_department      same_department
different_team            require_timezone_overlap
respect_capacity
```

Prior matches are checked in both directions. One record of the pair having met is enough.

If constraints are too strict, people go unmatched. The dry run will tell you during pack authoring, and the fairness report tells the designer before they publish.

## Missing attributes

Someone who declined to share a department scores 0.5 on department comparisons: neutral, not excluded.

This is a deliberate choice. The alternative, treating absent data as a mismatch, quietly punishes people for exercising a choice the product explicitly offers them. Optional has to mean optional.

## Candidate generation

For small pools every pair is considered. Above a budget, each participant gets a bounded number of candidates chosen by rotation and stride, so candidates still span the whole population rather than clustering by sort order.

At 1,200 participants, exhaustive enumeration is roughly 719,000 pairs. The bounded approach considers far fewer while keeping the result good, and the diagnostics report `consideredEdges` so you can see which path ran.

## The approximation

Pairs are matched greedily by descending score, then improved with a bounded 2-opt pass that swaps partners between nearby pairs when it raises the total.

This is an approximation, not exact maximum-weight matching. There is no blossom implementation. The diagnostics say which path ran:

- `greedy_locally_optimal` — greedy found nothing to improve
- `greedy_with_two_opt_improvement` — the improvement pass helped
- `time_budget_exceeded_greedy_only` — the budget ran out, greedy result kept

Groups larger than two use deterministic greedy set packing: seed with the best remaining pair, then add whoever scores highest against the current group.

Ties break on participant id. Reproducibility matters more here than squeezing out the last fraction of score, because a designer who re-runs a preview and sees different groups has no reason to trust either.

## Odd counts

With `allowTriadForOddCount` on, the last person joins the pair they score best with.

With it off, they are reported as unmatched with a reason code, and publishing is blocked until the designer explicitly acknowledges it. The intent is that somebody notices and talks to them.

There is no configuration under which a participant is silently dropped.

## Fairness report

Produced with every preview, for the designer to read before publishing.

It covers participation and unmatched counts by department and by remote preference, repeat exposure, the score distribution, and group size balance.

Cohorts below the installation's `minimumCohortSize` are suppressed and report zeros rather than a residual that could be back-calculated. At the default of ten, a department with six people produces no row worth reading, which is the point.

The report never infers or displays a protected characteristic. The cohorts available are organizational metadata the participant chose to share.

## Publishing

The designer approves; the system does not publish on its own.

Publication is a single-winner compare-and-swap guarded by a unique partial index on published runs per instance. A retry either wins once or conflicts cleanly. Two designers racing cannot both publish.

If unmatched participants exist, the publish call requires `acknowledgedUnmatched: true`. It is a small piece of friction placed deliberately.

## After publication

Withdrawal after publication flags affected groups as `remediated` for a designer rather than silently reassigning peers. Somebody's partner disappearing without explanation is worse than the inconvenience of handling it.

Peer visibility follows the instance's privacy mode on every read. Before a reveal, the API returns a pseudonym, whatever the client asks for.
