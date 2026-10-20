# Public-readiness review

Reviewed 2026-10-19. This records checks of the educational implementation, not a legal clearance or a production certification.

## Scope and provenance

The working tree, all three existing Git commits, seeded generator, representative calculations and handlers, tests, documentation, generated HTML, and diagram were inspected. Synthetic account names, staff, contacts, notes, call mentions, and measurements are defined in `scripts/generate.ts` with a fixed seed. No private source systems were consulted.

Gitleaks reported no secrets in the tree or reachable history. An owner-maintained 4,066-term private denylist found only public dependency-name collisions and terms embedded in the old scrub script's own detection patterns. The current scrub script keeps private terms outside the repository and reports paths and line numbers without printing matching content. PNGs contain no text or EXIF metadata; inspected screenshots show seeded fixtures.

## Corrections made locally

- Set copyright to Geoffrey Lew, all rights reserved, and package metadata to `UNLICENSED`.
- Ignore `.DS_Store` files.
- Replace old internal attribution and review notes with this public-safe record; prior documents are preserved outside the repository.
- Remove an unsupported incident narrative from `docs/post.md` and a private-source process reference from `docs/mechanism.md`.
- Rewrite README around Situation, Complication, and Our Answer; group mechanisms by the decisions they support.
- Replace the trap/check inventory diagram with a conceptual flow from customer records to review and confirmed assignments.

## Verification

All 19 existing tests passed against an isolated local PostgreSQL database. TypeScript typechecking passed. Two complete synthetic demo runs produced identical text and matched the saved transcript after removing its Markdown wrapper. No application logic was changed.

The imported `node_modules` contained an incomplete macOS native dependency and a runtime that stalled on this host. Tests and demos used existing compatible Vitest 2.1.8 and tsx runtimes; a fresh dependency installation remains the expected setup for another machine. The package lock was not changed.

Independent editorial, engineering-value, technical, essence, and rendered-diagram review found no material issues. The README explains account understanding, attention and membership review, and confirmed actions without presenting generated HTML as a connected deployed application.

## Publication snapshot

Publication uses a fresh single-commit snapshot of the reviewed files. Earlier local Git metadata is archived outside this repository and is not part of the release.
