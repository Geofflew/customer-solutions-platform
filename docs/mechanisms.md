# The five mechanisms in full

One section per mechanism: the trap, the design, the rejected alternative, the code, the test and
the demo section. The README carries one paragraph each. Full demo output is in
[`demo-output.md`](demo-output.md); the screenshots are in [`screens.md`](screens.md).

## 1. Activation score

**Trap.** `naiveActivation` averages three completion rates (close checklist, reconciliations,
variance review), each the best of the last three closed months against an 80% target, and counts
a feature with nothing to show as 0%. Harbor & Finch has its checklist switched off and cannot use
variance review without the ERP integration; it reconciles 92% and reads 33. Saltmarsh Foods has
every feature paused, off or not applicable and reads 0, the same as Ironwood Mills, which uses
nothing it has switched on.

**Design.** `computeActivation` returns a `FeatureResult` per feature that is either
`{ status: 'scored', score, pcts, reason }` or `{ status: 'excluded', kind, reason }`. A feature is
excluded when it is switched off (the reason a person typed), snoozed until a future date, or not
applicable (variance review without the ERP integration). Per scored feature:
`min(best month / 0.8, 1) × (1 − months at zero / 3)`. Utilisation is the mean of scored features.
Engineering escalations (10% each, capped at 10%) and complaints weighted by severity (high 1,
medium 0.5, low 0.25, divided by 5, capped at 20%) take a combined share capped at 30%, and only
when utilisation is above 0: a penalty on zero use would only hide the bigger fact. New accounts
get `60 × e^(−days since kickoff / 45)` points. If every feature is excluded the score is null.

`selectPeriods` decides which months count. The current month never does. For a live account in
the first 14 days of a month, the previous month does not either, because its close is still
running and a half-finished close reads as low use. A month with no rows stays missing; nothing
older fills the slot.

**The case a reviewer stops on.** A feature switched on with no rows at all is scored 0 with the
reason "no usage recorded", not excluded. Excluding it would be generous to exactly the accounts
the score is for: the ones that turned something on and never used it. The flag `no-usage-rows`
marks it on the page.

**Rejected.** A `has_data` boolean next to a 0. It is one more column every view must read, and
the first CSV export drops it. Also rejected: scoring excluded features as 100 so they do not drag
the average, which makes an account with everything off read perfect.

**Every zero has a reason.** `zerosWithReasons` lists every zero and exclusion the page will show
and throws if one has no sentence. The book page renders 57 of them on the seed.

**Change attribution.** `explainChange(prev, cur)` splits a week-on-week change into product use,
penalties and newness decay by swapping one input at a time, plus a named remainder for rounding
and the 0-100 cap. The parts sum to the change exactly. The status report uses it.

**Next cases tried.** A snooze that has expired counts the feature again (test: snoozed to
2026-02-28 scores 50, to 2026-05-01 scores 100). A live account on the 11th uses Nov-Jan; a
training account on the same day uses Dec-Feb.

**Tests.** "excludes off and not-applicable features with a reason instead of scoring them 0",
"says 'not scored' when every feature is excluded, and keeps a real zero a zero", "counts a feature
again once its snooze has passed, and skips the in-flight month for live accounts", "attributes a
week-on-week change in parts that add up to the change". **Demo:** section 1.

## 2. Status report

**Trap.** `snapshotReport` lists every account sorted by score. Bluestem Clinics drops 69.3 → 55.4
after one high complaint and sits at row 24 of 40, yellow last week and this week.

**Design.** `flagFor` gives each account one flag, the most severe: drop (10 or more points between
the last two calendar weeks, both scored, severity 4), approaching a line (a straight line through the last three weeks crosses 40 or
70 within two weeks, severity 3), declining (down more than 3 over the last four weeks, severity
2), silent (no meeting in 21 days, past kickoff and not live, severity 1). Severity maps to
critical, warning and watch. Each row carries `changeSentence`, the `explainChange` parts larger
than half a point, largest first. `buildReport` also returns `unowned`: flagged rows with no owner
or no next step, which the page puts first. Wins (up 5 or more, at 60 or above) and accounts new to
scope (kicked off under three weeks ago) are listed separately.

**The average.** `averageTrend(book, weeks, pinned)` averages either everyone with a score at each
week or one fixed cohort scored in every week. On the seed the first goes 50.8 → 49.3, the second
(25 accounts) 50.8 → 55.2. New accounts enter late, start on a decaying newness premium and drag
the first line down; neither line is wrong arithmetic, but only the pinned one answers "is the book
getting better".

**Rejected.** Zone counts as the headline: red/yellow/green went 13/14/12 → 17/11/11 and say
nothing about which accounts moved or why. Also rejected: flagging every change over a threshold,
which buries a 14-point drop under newness decay. The "what changed" sentence is what lets a reader
see that most of the warnings this week are the premium wearing off, not use falling.

**Tests.** "flags a 10-point drop that stays inside one zone as critical", "puts flagged rows without
an owner or next step at the top", "averages a pinned cohort, not whoever has a score that week".
**Demo:** section 2.

## 3. Segmentation

**Trap.** A saved segment shows a name and a count. "Expansion-ready" read 5 at its review on
2026-02-18 and 5 today, with four accounts in and four out.

**Design.** `SIGNALS` is the registry. Each signal names its source and has `covers`, `lit` and
`evidence`. If the source does not cover the account the tag is no-data, never unlit: "competitor
named on calls" is no-data for accounts without call recordings, "activation 70+" is no-data for
an account that is not scored. A segment is a `Rule` (and, or, not over signal keys). `evaluate`
first walks the whole rule; if any signal it touches is no-data, the answer is no-data before any
boolean logic runs. An unknown key is no-data too. Manual overrides are an append-only log;
`activeOverrides` keeps an account's latest include and latest exclude separately (`clear` removes
both and is remembered), and `membership` applies `(rule ∪ includes) − excludes`, so an exclude
wins whichever was written last. `reviewDiff` compares live membership with the baseline someone
accepted and names a cause per account: the signals that flipped between the two dates with their
evidence, the override that was added, or the clear that removed one, by whom and why.

**Rejected.** Letting OR short-circuit: OR(lit, no-data) as lit is right about this account and
wrong as a policy, because the same rule then reads unlit-or-no-data as "no". Showing "can't tell"
keeps the unknowns visible; the cost is that a lit signal does not put an account in a segment
whose other branch it cannot see. Also rejected: auto-accepting membership on each recompute (that
is the silent drift) or freezing it (a static list no one updates).

**Next case tried.** An include written after an exclude still loses; a later `clear` restores the
rule's verdict; an include cleared after the review is reported with who cleared it (tests).

**Tests.** "lets no-data win over any boolean", "names who cleared a manual include after the review, and
why", "applies excludes after includes, and the latest log
entry wins", "reports every entry and exit behind an unchanged count, each with a cause".
**Demo:** section 3.

## 4. Churn and champions

**Trap, churn.** `scoreNaive` counts every keyword family with a hit in the last 60 days of notes.
Copperline Freight's note "no layoffs planned" matches `layoffs` and moves the headline 0.50 → 0.73,
yellow to red.

**Design, churn.** Sub-signals map a feature to risk 0-0.85 through three bands (healthy, concern,
risky), or null with "no data". Cells roll their sub-signals up with a worst-anchor and noisy-OR
(`max(0.7 × worst, 1 − Π(1 − x))`), skipping nulls. The headline is
`sigmoid(bias + Σ weight × cell)` with five head weights (bias −2.2, adoption 2.4, engagement 1.4,
users 1.8, feedback 2.0). `keywordHits` keeps the sentence, author and date of every hit;
`corroborated` counts a family only with two different authors on two different days (tests cover
one author on two days and two authors on one day). A single hit
stays on the page as evidence at weight 0.

**Backtest.** 200 labelled past snapshots. Real risk appears in the generator as the same family
written by two people on two days; benign single mentions ("not interested", "fewer seats is not
on the table") land at random. AUC 0.827 counting every hit, 0.829 corroborated only. Single notes
change the zone of 12 snapshots; 8 of those renewed.

**Rejected.** Dropping keyword features altogether (they carry real signal when corroborated), and
lowering their weight (a smaller weight still moves a headline that sits near a line).

**Trap, champions.** Ranking names by call mentions puts our own CSM (7), the customer's audit
partner (6) and "Sam" (5) on top.

**Design, champions.** `candidates` starts from the verified roster. A call mention is resolved by
`nameKey` (strip parentheses and dash suffixes, flip "Last, First", lowercase) and `sameName`
(equal, or a whole-word prefix). It must match exactly one roster contact: our staff are dropped
first, no match is "not on the verified contact roster", two matches are "ambiguous". Meeting
attendees not on the roster are dropped with a reason too. Each kept candidate lists its sources
and evidence.

**Tests.** "counts a keyword family only from two authors on two days", "keeps the headline zone when
one note is the only thing that changed", "drops call names that are our staff, off the roster, or
ambiguous". **Demo:** section 4.

## 5. Bot

**Trap.** `confirmNaive` applies the list in the confirm payload. A relayed confirm for a one-change
proposal carried three changes and wrote three assignments.

**Design.** `route` sends text ending in "?" or starting with a question word to `answer`
(read-only). `parseCommand` reads "account, name role, name role". `propose` resolves the account
by prefix and each name against the staff roster (ambiguous or unknown refuses), refuses a person
named twice for one role, and stores the proposal with requester, thread, changes and a one-day
expiry. Ids come from a sequence (`P-0001`), so two proposals at once never collide. A role can have
several holders: "Hana onboarding, Wes onboarding" writes two rows.
`confirm` takes a dedicated connection and, in one transaction, locks the row (`FOR UPDATE`),
refuses unless pending, unexpired, confirmed by the requester and from the proposal's thread, refuses and closes the proposal
when the payload's list or hash differs from the stored one, then applies the stored list and marks
it applied. The reply lists the rows it wrote and, separately, changes that were already true. Two
racing confirms on one proposal: the lock lets one through; the other reads "already applied".

**Why close on mismatch.** If a mismatched confirm only refused, the next confirm with no list would
apply the stored proposal, which a person may no longer mean once they have seen a three-item
version going around. Closing forces a fresh request.

**Rejected.** Validating the payload list (each item must be in the proposal): it passes a subset,
and the person confirmed the whole thing, not a subset. Also rejected: trusting the chat platform's
button payload, which is client-supplied.

**Tests.** "applies the stored proposal, refuses a longer relayed list, a stranger and a replay",
"writes both holders of one role and reports exactly the rows it wrote", "refuses a confirm from
another thread, and two racing confirms apply once", "refuses an expired proposal and an ambiguous
name". **Demo:** section 5.
