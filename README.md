# Venue Access

Credit-based access to any kind of venue. People load credits once, spend them on a pass,
and show a QR code at the door. Venue staff scan it on a phone. Venue *types* — gym,
coworking, expo, whatever comes next — are plugins.

**Web** React + Vite → Vercel · **Mobile** Expo → EAS · **API** Express → Render · **Data** MongoDB Atlas

```
packages/
  core/              domain rules + every port. Zero runtime dependencies.
  plugin-gym/        day passes, capacity, peak pricing
  plugin-coworking/  hour blocks, quantity pricing, re-entry
  plugin-expo/       fixed event dates, early-bird pricing
  shared/            DTOs + the API client. Web and mobile both import it.
apps/
  api/               Express, Mongoose, the ledger, the composition root
  web/               React — browse, buy, show a pass, desk check-in
  mobile/            Expo — same, plus the camera scanner at the door
```

Dependencies point inward. `packages/core` imports nothing — not Mongoose, not Express,
not even Node's `crypto`. Everything outside it is an adapter behind a port.

---

## Running it

```bash
corepack enable
pnpm install

# MongoDB. Transactions are required, so it must be a replica set.
docker compose up -d
docker compose exec mongo mongosh --eval 'rs.initiate()'

cp apps/api/.env.example apps/api/.env
# then fill in, at minimum:
#   JWT_SECRET=$(openssl rand -base64 48)
#   PASS_TOKEN_SECRET=$(openssl rand -base64 32)

pnpm --filter @venue/api seed     # demo venues + two accounts
pnpm --filter @venue/api dev      # http://localhost:5080
pnpm --filter @venue/web dev      # http://localhost:5173
pnpm --filter @venue/mobile dev   # Expo Go / dev client
```

Seeded accounts: `sathish@example.com` (customer, 1000 credits) and
`operator@example.com` (venue staff), both with password `password123`.

Without `BREVO_API_KEY` and `MSG91_AUTH_KEY`, verification codes are printed to the API
log instead of sent — which is how you get through signup locally.

---

## Adding a venue type

Nothing in `packages/core` or `apps/api` changes.

1. `packages/plugin-<name>/` — depend on `@venue/core` only.
2. Export a `PluginModule`: a key, a display name, a JSON schema for the operator's plan
   form, an `AccessPolicy` and a `PricingPolicy`.
3. Add it to `AVAILABLE_PLUGINS` in `apps/api/src/container.ts`.
4. Add its key to `PLUGINS_ENABLED`.
5. Optional: a renderer in each app's `venue-types/registry`. An unknown key falls back
   to a plain renderer rather than crashing — a shipped mobile app cannot be redeployed
   as fast as the API, so it has to tolerate a venue type it has never heard of.
6. Add it to `PLUGINS` in `packages/plugin-gym/test/contract.test.ts`. The same suite
   runs against every plugin.

Removing a type is step 4 in reverse. Existing passes keep working; no new ones sell.

If a new venue type cannot satisfy the contract suite without a change inside
`packages/core`, the port is wrong. Fix the port — do not special-case the plugin.

### The boundary is enforced, not just documented

TypeScript will happily let someone `import mongoose` inside `packages/core`. The .NET
compiler used to stop that; here `pnpm lint:boundaries` does, and it runs in CI.
Without it the plug-and-play structure dissolves over a few months of "just this once".

---

## The parts that carry real risk

**The credit ledger** — `apps/api/src/adapters/mongoLedgerStore.ts`. Credits move through
exactly one method. Three things keep it correct, none of them application-level checks:

- a conditional `findOneAndUpdate` with `balance: { $gte: amount }`, so MongoDB matches
  and decrements atomically — there is no read-then-write gap to lose a race in
- a unique index on `idempotencyKey`, so a retried request returns the original entry
- a transaction around both writes, so the balance and the entry cannot disagree

`LedgerEntry` rows are append-only. A refund is a new compensating entry, never an edit.
`reconcile()` compares the cached balance against the signed sum of the ledger — run it
nightly and alarm on drift.

Do not "simplify" this into read-balance → compare in JavaScript → update. That version
passes every single-user test and loses money the first time someone double-taps.

**Transactions need a replica set.** A standalone `mongod` silently is not one, so the
API checks at boot and refuses to start rather than letting the numbers drift apart
unnoticed. Atlas, including the free M0 tier, is already a replica set.

**Payments** — the Razorpay webhook credits the wallet, never the browser callback. The
HMAC signature is verified *before* the body is parsed, and the webhook route is mounted
ahead of `express.json()` because the signature covers the exact bytes sent.

**Check-in** — the QR holds a ~30-second HMAC-signed token, not a pass id, so a forwarded
screenshot is dead on arrival. Consuming an entry is one atomic `findOneAndUpdate` whose
filter carries every rule, so two scanners racing for the last entry cannot both win. No
lock needed. `(passId, scanNonce)` makes a replayed scan idempotent.

**OTP** — codes are stored hashed with a TTL index, capped at 5 attempts and 5 sends per
hour per number, and never logged in production.

---

## Tests

```bash
pnpm test              # 42 tests, no infrastructure needed
pnpm lint:boundaries   # architecture rules
```

The suite that matters needs a real database, because the guarantee lives in MongoDB
rather than in the JavaScript:

```bash
TEST_MONGODB_URI=mongodb://localhost:27017/venue-access-test?replicaSet=rs0 \
  pnpm --filter @venue/api test
```

It proves four things: 100 concurrent spends against a wallet holding enough for 10 let
exactly 10 through; the balance never goes negative under load; one idempotency key moves
credits once however many times it arrives; and two scanners racing for the last entry
admit exactly one person. **Do not ship the wallet until you have watched these pass.**
Without `TEST_MONGODB_URI` they skip rather than fail, so CI stays green.

---

## Deploying

**API → Render.** `render.yaml` is a blueprint; create the service from it and fill in the
secrets marked `sync: false`. The build bundles the workspace packages into one file with
tsup, so Render never has to resolve a pnpm symlink at runtime. Point `MONGODB_URI` at
Atlas, and set `CORS_ORIGINS` to your Vercel URL. Add the Razorpay webhook in their
dashboard: `https://<your-api>.onrender.com/api/webhooks/razorpay`.

Note the free tier sleeps after inactivity, so the first request after a quiet spell takes
30–50 seconds. Fine for a demo; move up a tier before anyone stands at a door with it.

**Web → Vercel.** Set Root Directory to `apps/web`. Vercel detects pnpm workspaces. Set
`VITE_API_URL` to your Render URL plus `/api`, and `VITE_GOOGLE_CLIENT_ID`.

**Mobile → EAS.** `eas build --profile preview --platform android` gives an installable
APK; `production` gives an AAB for Play. The API URL per profile lives in `eas.json`.
Replace the placeholder `projectId` in `app.json` with your own from `eas init`.

---

## Not built yet

- Operator onboarding and platform-admin screens — venues are created through the API.
- Razorpay checkout on mobile. `startTopUp` returns the order; wiring
  `react-native-razorpay` to it is the remaining step.
- Expiring old passes in the background. They are marked lazily when someone looks.
- A shared rate-limit store. The in-process limiter is per instance, which is correct for
  one Render instance and wrong the moment there are two.
