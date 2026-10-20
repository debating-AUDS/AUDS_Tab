# AUDS Leaderboard

An online replacement for the AUDS tournament spreadsheet, built for Cloudflare's free tier (Workers + D1 database + static assets).

* **Public:** live leaderboard (teams and speakers), published draws and results, a "find my room" search, a feedback form that writes straight into the database, and an archive of past tournaments.
* **Admin (password):** roll and attendance, adjudicator list, draw generation (random, strict or broad power pairing) with click-to-swap editing, results entry, adjudicator feedback, archiving, export.
* Both **3v3** (Aff/Neg) and **BP** (OG/OO/CG/CO) formats. No speaker or adjudicator data from the old template is included.

---

## Part 1. Deploy it (about 15 minutes)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and [Node.js](https://nodejs.org) 20 or newer.

1. **Get the code onto your computer** and open a terminal in the `auds-leaderboard` folder.
2. **Install:** `npm install`
3. **Log in to Cloudflare:** `npx wrangler login` (a browser window opens; approve it).
4. **Create the database:** `npx wrangler d1 create auds-leaderboard`
   Copy the `database_id` it prints and paste it into `wrangler.jsonc` in place of `PASTE-YOUR-DATABASE-ID-HERE`.
5. **Create the tables:** `npm run db:migrate` (answer `y`). This applies every file in `migrations/` in order.
6. **Set the secrets** (you will be prompted to type each value; they are never stored in the code):
   * `npx wrangler secret put ADMIN_PASSWORD` – the admin login password. Make it long.
   * `npx wrangler secret put SESSION_SECRET` – any long random string (mash the keyboard for 40 characters).

   The first `secret put` before the first deploy may offer to create the Worker; say yes.
7. **Deploy:** `npm run deploy`. It prints your address, `https://auds-leaderboard.<your-subdomain>.workers.dev`.
8. Open it, click **Admin sign in**, and enter your password.

### Use your own domain (e.g. AUDSLeaderboard.online)
Buy or transfer the domain to Cloudflare (Domain Registration or add the site). Then in the dashboard: **Workers & Pages → auds-leaderboard → Settings → Domains & Routes → Add → Custom domain**. HTTPS is automatic.

### Optional: deploy automatically from GitHub
Push the folder to a GitHub repo, then **Workers & Pages → Create → Import a repository**. Use build command *(none)* and deploy command `npx wrangler deploy`. Every push redeploys. Secrets stay in Cloudflare.

### Optional: extra lock on the admin API
The app already has a password with login rate limiting. For more, put **Cloudflare Access** (Zero Trust, free up to 50 users) in front of the path `/api/admin/*`.

### Try it locally first
* Demo with fake data, no Cloudflare needed (Node 22+): `npm run demo` then open http://localhost:8787 (admin password `admin123`).
* Real Worker locally: copy `.dev.vars.example` to `.dev.vars`, run `npm run db:migrate:local`, then `npm run dev`.
* Tests of the draw/scoring engine and API: `npm test`.

---

## Part 2. Running a tournament

| Spreadsheet step | In the website |
|---|---|
| Fill in the roll | **Admin → New tournament**, then **Roll**: paste `Name, Team` lines or add people one by one, untick absentees, answer the Y/N questions for one- and two-person teams, tick **Roll complete** |
| Adjudicator sheet | **Adjudicators**: add people, tick **Attending**, tick **Trainee** where needed. Scores come only from this tournament's feedback |
| Generate draw buttons | **Rounds → Draw**: choose random / strict / broad (round 1 is always random) and **Generate** |
| Manual tweaks | While the draw is unpublished, retype any speaker or adjudicator name, or click one team or adjudicator and then another to swap. **Save**. Unassigned adjudicators appear below the draw |
| Publishing | **Publish draw**. If a name in the draw isn't a present speaker on the roll, or an attending adjudicator, you are asked to confirm before it goes public. A published draw must be unpublished before it can be edited |
| Round names and topic | At the top of each round page: give the round a name (e.g. Semi Final, Grand Final) and a topic. The topic shows with the published draw. To add a final, raise the number of rounds under **Settings** |
| Results sheet | **Results → Build results sheet**, enter scores (50–100), pick the speaker for any `CHOOSE IRON` row, **Complete round**. The leaderboard updates immediately |
| Google Form feedback | Public **Give feedback** page. Turn it on or off, and optionally set a code, under **Feedback**/**Settings**. Admins can see, override or delete any score per round |
| Start new file | **Settings → Archive tournament**. It becomes read-only on the public Archive. Adjudicator names stay on the list for next time, but scores and attendance start fresh |

Notes
* One tournament can be active at a time. Archive it before creating the next.
* Generating a draw un-ticks **Roll complete**, so you re-confirm attendance each round.
* Break eligibility needs 3 debates (teams) or 3 scored performances (speakers), as in the spreadsheet.
* Adjudicator ranking uses the same Wilson lower-bound score, from this tournament's feedback only. Until feedback arrives, chairs are picked at random.
* Public feedback: duplicate submissions from the same device replace the earlier one; each device is limited to 60 ratings per hour. Use a feedback code on the venue signage to stop outsiders.
* Settings has an **Export JSON** for your own records.

## Updating an already-deployed site
If you deployed an earlier version, run `npm run db:migrate` again (it applies only the new `migrations/0002_round_names_topics.sql`), then `npm run deploy`. If you used the dashboard route, paste the contents of `migrations/0002_round_names_topics.sql` into the D1 console and let GitHub redeploy.

## Free-tier limits
Workers free: 100,000 requests/day. D1 free: 5 GB, 5 million row reads/day. A tournament is a tiny fraction of that.

## Project layout
`src/` Worker (API + draw/scoring engine in `src/engine`), `migrations/` database schema, `public/` the website (plain HTML/CSS/JS, no build step), `test/` tests and the demo server.

## Honest caveats
This was built and tested in a sandbox where Wrangler and Cloudflare could not be reached, so it has been exercised against an in-memory SQLite stand-in for D1 and in a headless browser, but **not** yet on real Cloudflare. If `wrangler deploy` complains, the most likely culprits are the `database_id` or a Wrangler version difference. One assumption: the old form's "Feedback #" is treated as the round number.
