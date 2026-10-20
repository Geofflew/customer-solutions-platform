# Run the example

Use Node 22 or later and PostgreSQL 14 or later. Create an empty database for this example: generation and tests recreate its `cs` schema.

```sh
export DATABASE_URL=postgres://127.0.0.1:5432/acme_solutions
pnpm install --frozen-lockfile
pnpm demo
pnpm test
pnpm typecheck
```

The demo generates synthetic records and writes the HTML pages to `out/`. Open those files locally to inspect the views. [Screenshots](screens.md), [calculation details](mechanisms.md), and the [demo transcript](demo-output.md) provide deeper references. All displayed accounts, people, notes, and measurements come from the [seeded generator](../scripts/generate.ts).

