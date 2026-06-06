# DB access security

Backend default is `adminDb` service role. Service role bypasses Supabase RLS, so
RLS is defense-in-depth unless a route uses a user-scoped client.

`createUserScopedDbFromJwt(jwt)` uses the publishable key plus the request bearer
token. Supabase must accept that JWT for `auth.jwt()` policies to work.

Current auth test:

- App JWT with `walletAddress` claim returned `PGRST301 No suitable key or wrong key type`.
- Meaning: current `JWT_SECRET` is not accepted by Supabase PostgREST.
- To make RLS active, sign app JWTs with the Supabase JWT secret or switch these
  routes to Supabase-issued JWTs.

Client map:

- `adminDb`: service jobs, Circle wallet writes, ledgers, cron, Telegram, agent internals.
- `createUserScopedDbFromJwt`: user CRUD surfaces where RLS should enforce row
  ownership. Contacts API is wired with feature flag `SUPABASE_RLS_USER_CLIENT=true`.
