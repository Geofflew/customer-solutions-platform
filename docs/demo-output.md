# Full demo output

`pnpm demo` against a fresh database (seed `20260318`, as of 2026-03-18). Identical on every run.

```text
Acme Analytics customer-success platform, as of 2026-03-18: 40 accounts, 12 weekly scores each, 6 pages rendered to out/.

==============================================================================
1. Activation score: a zero that means disabled, not unused
==============================================================================
BROKEN   average of three completion rates, a feature with nothing to show counted as 0%:
         Harbor & Finch 33.3 (red). Saltmarsh Foods 0.0 (red). Ironwood Mills 0.0.
GUARDED  Harbor & Finch 90.0 (green):
           Close checklist: Off: runs its close checklist in its own project tool
           Reconciliations: scored 100 (253 of 275 completed, best month 92%)
           Variance review: Not applicable: needs the ERP integration
         Saltmarsh Foods not scored:
           Close checklist: Snoozed until 2026-05-01: paused during their ERP migration
           Reconciliations: Off: reconciliations are done by their outsourced accountant
           Variance review: Not applicable: needs the ERP integration
         Ironwood Mills 0.0, a real zero:
           Close checklist: scored 0 (On and used 0 of 86 in 3 closed months)
           Reconciliations: scored 0 (On and used 0 of 187 in 3 closed months)
           Variance review: scored 0 (On and used 0 of 46 in 3 closed months)
DIFF     the naive average puts 25 accounts in red, the activation score 17. 8 accounts land in a different zone
         when their switched-off, snoozed or not-applicable features are averaged in as 0% than when they are left out:
         Harbor & Finch, Saltmarsh Foods, Juniper Outfitters, Tidewater Logistics, Redfern Capital, Silverleaf Systems, Ravenmoor Systems, Wrenfield Partners.
         The book page shows 57 zeros or exclusions; every one carries a reason (zerosWithReasons throws on one that does not).

==============================================================================
2. Status report: lead with what changed
==============================================================================
BROKEN   the snapshot report, every account sorted by score: Bluestem Clinics 55.4 at row 24 of 40,
         yellow last week (69.3) and yellow this week. Zone counts red/yellow/green: 13/14/12 -> 17/11/11.
GUARDED  critical: Bluestem Clinics, Drop -14: complaints penalty -13.8.
           owner Jordan Okafor; next step "Review open tickets with support and send a summary".
         flagged 1 critical, 10 warning, 5 watch; top of the page, flagged with no owner or no next step:
           Kestrel Robotics: no next step (Down 14 in 2 wks)
           Umberfield Logistics: no owner (Silent 45d)
DIFF     a 14-point drop inside one zone is invisible in a snapshot and first on the page here.
         Average score, 2025-12-31 to 2026-03-18: everyone with a score 50.8 -> 49.3; the pinned cohort of 25
         scored every week 50.8 -> 55.2. New accounts entering at the right-hand end move the first line, not the book.

==============================================================================
3. Segmentation: membership that changes under a saved view
==============================================================================
BROKEN   saved view "Expansion-ready": 5 members at review on 2026-02-18, 5 today. Looks unchanged.
GUARDED  review banner: 4 entered, 4 left since Priya Raman accepted it on 2026-02-18.
           + Cobalt & Vine: Exec engaged: unlit → lit (Met CFO on 2026-03-10); Going quiet: lit → unlit (Last meeting 2026-03-12 (6d ago))
           + Elmstead Supply: Exec engaged: unlit → lit (Met CFO on 2026-03-06); Going quiet: lit → unlit (Last meeting 2026-03-07 (11d ago))
           + Lanternfly Studios: Exec engaged: unlit → lit (Met CFO on 2026-03-13)
           + Lindenfield Analytics: Exec engaged: unlit → lit (Met CFO on 2026-03-03)
           - Harbor & Finch: Going quiet: unlit → lit (Last meeting 2026-02-09 (37d ago))
           - Silverleaf Systems: Exec engaged: lit → unlit (No executive meeting in 90 days); Going quiet: unlit → lit (Last meeting 2026-01-21 (56d ago))
           - Pinecrest Analytics: Going quiet: unlit → lit (Last meeting 2026-02-14 (32d ago))
           - Alder & Moss: Exec engaged: lit → unlit (No executive meeting in 90 days)
           manual include: Oakhaven Partners by Jordan Okafor on 2026-01-28 (CFO asked about a second entity on the last call)
           manual exclude: Ravenmoor Systems by Mei Lindqvist on 2026-03-02 (mid-migration; not the moment to talk expansion)
DIFF     8 membership changes behind a count that moved by 0.
         "Competitive risk" reads 14 accounts as no-data (no call recordings), shown as "can't tell", never as "no".

==============================================================================
4. Churn and champions: a headline that moves on one keyword hit
==============================================================================
BROKEN   Copperline Freight churn headline 0.50 (yellow) last week -> 0.73 (red) this week.
         What moved it: note keyword "layoffs" in one note.
GUARDED  0.50 (yellow). The hit is shown as evidence with weight 0 until a second author writes it on another day:
           "She said there are no layoffs planned; the team is hiring two analysts." (Rafael Duarte, 2026-03-16)
DIFF     backtest on 200 labelled snapshots (59 churned): AUC 0.827 counting every hit, 0.829 counting corroborated ones.
         Single notes changed the zone of 12 snapshots; 4 of those accounts churned. Red: 91 -> 84 snapshots,
         churn rate in red 51% -> 51%.
BROKEN   champions as the names mentioned most on calls: Rafael Duarte (7), Gil Navarro (6), Sam (5), Dana (4).
GUARDED  Dana Whitfield 95 [roster, meetings, calls]: On the roster as Controller; in 2 meetings, last 2026-03-08; named on 4 calls; 4 support tickets in 90d
         Lena Brandt 92 [roster, meetings, calls]: On the roster as CFO; in 2 meetings, last 2026-02-08; named on 1 call
         Owen Sato 38 [roster, meetings]: On the roster as Accounting Manager; in 1 meeting, last 2025-11-18; 1 support ticket in 90d
           dropped Rafael Duarte (7 mentions): one of our own staff
           dropped Gil Navarro (6 mentions): not on the verified contact roster
           dropped Sam (5 mentions): ambiguous: matches Sam Ortiz and Sam Patel
DIFF     the top three call names were our own CSM, the customer's auditor and a first name that fits two contacts.

==============================================================================
5. Bot: propose, confirm, apply the stored proposal
==============================================================================
BROKEN   "@acme-bot assign Harbor & Finch, Hana onboarding" proposed 1 change. A relayed confirm carried 3;
         the handler that applies the message's list wrote 3 assignments: onboarding = Hana Kowalski, cash = Wes Carver, owner = Rafael Duarte.
GUARDED  bot: (question) Harbor & Finch is in Live; owner Mei Lindqvist.
         bot: (command) Proposal P-0001. Nothing has changed yet. [onboarding = Hana Kowalski]
         relay: Confirm P-0001, forwarded from the request form [3 changes]
           -> refused: the confirm carried 3 changes; P-0001 proposed 1. Nothing applied; ask again.
         bot: Proposal P-0002. Nothing has changed yet. [onboarding = Hana Kowalski]
         click: Jordan Okafor presses Confirm on P-0002
           -> refused: only Mei Lindqvist, who asked, can confirm P-0002
         click: Mei Lindqvist presses Confirm on P-0002 (pasted into #cs-leads)
           -> refused: P-0002 was proposed in another thread; confirm it there
         click: Mei Lindqvist presses Confirm on P-0002
           -> ok: Applied P-0002: onboarding = Hana Kowalski
         click: Mei Lindqvist presses Confirm on P-0002
           -> refused: P-0002 is already applied
DIFF     3 assignments written by the naive handler, 1 by the guarded one. Proposals: P-0001 refused, P-0002 applied.
```
