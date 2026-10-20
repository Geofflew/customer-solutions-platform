# The mechanisms, in one page

Calculation and workflow reference for the synthetic customer-solutions implementation.

**Activation score.** A 0 to 100 value score per account, computed from closed monthly periods
of product use. Three features are measured: close checklist tasks, account reconciliations and
variance review. For each feature and period the input is completed over total. The last three
usable periods are taken: the current month never counts, and for a live customer early in the
month the previous month does not count either, because its close is still running. A missing
period stays missing; nothing older is pulled in to fill it. Per feature the score is the best
period's completion against an 80% target, capped at 1, times one minus the share of the three
periods at zero. A feature is excluded from the average, not scored 0, when it is switched off
for the customer (with a written reason), snoozed until a date, or not applicable (variance
review needs the ERP integration). A feature that is switched on but has no rows at all is the
opposite case: that is no use, and it scores 0. Utilisation is the mean of the included features.
Engineering escalations and complaints (weighted by severity) subtract a capped share, but only
when utilisation is above 0. New customers get a premium that decays from 60 points with a 45-day
time constant from kickoff. If every feature is excluded the score is not 0 but "not scored". The
output keeps the inputs, the excluded features with their reasons, and flags (fewer than two
periods, no kickoff date, kickoff in the future).

**Status report.** A weekly page per customer, over a whole book. Each account has a weekly score
series. One flag per account, the most severe: a drop of 10 or more points week on week; a
projection of the last three weeks that crosses the 40 or 70 line within two weeks; a downward
trend; or no meeting in 21 days for an account that is past kickoff and not yet live. Flags sort
accounts into critical, warning and watch. Each row says what changed, the risk, the owner, the
next step and the latest status note with its author and date. The portfolio average trend is
computed over a fixed cohort of accounts that have the whole window, because averaging whoever
has a score at each position lets short histories drift the line. Wins (up 5 or more and at least
60) and accounts new to scope (kickoff under three weeks) are listed separately.

**Segmentation.** A registry of signals. Each signal reads facts about an account and returns lit,
unlit or no-data; no-data is used whenever its source does not cover the account, so a missing
source never reads as "not lit". A segment is a saved rule over signal states (and, or, not). If
any signal the rule touches is no-data, the whole rule is no-data for that account: an uncovered
branch can never be outvoted by a lit one. Manual includes and excludes sit on top, and an
exclude always wins. Each segment stores the member list someone last accepted; the page diffs
live membership against it and shows what entered and left until someone accepts again.

**Churn and champions.** Churn: a feature vector per account feeds sub-signals, each 0 to 1 or
null with a reason. Sub-signals roll into four cells (adoption, engagement, users, feedback), and
the headline is a sigmoid of a bias plus four cell weights (five head weights). One sub-signal
matches keyword families in account notes (competitor, layoffs, right-sizing, champion left, no
response, discount). The weights are fitted and checked against labelled past snapshots.
Champions: candidates come from the verified contact roster, executive meetings and names
mentioned on recorded calls. A call-mentioned name survives only if it matches a roster contact
(exact or by whole-word prefix); our own staff are removed; duplicates collapse to the best score.

**Bot.** An app mention is routed as a question (ends in "?" or starts with a question word) or
an assignment command ("account, name onboarding, name cash"). The command resolves the account
and the people against a roster and the server records what it will do. The rebuild here makes
the next step explicit: the bot proposes, the person confirms, and the server applies the
proposal it stored, never a list carried by the confirm message.
