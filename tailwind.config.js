# Novare Shift Sign-Off Tracker

This is the standalone, publicly-hostable version of the training shift tracker
built in Claude. It's the same app, with one change under the hood: instead of
using Claude's artifact storage (which only works inside claude.ai and only
for people who can log into your Claude account), it uses a real database
(Supabase) — so anyone with the link can use it, no Claude account required.

Nothing about how the app *works* changed. Same dashboard, same Nowsta CSV
imports, same PIN-based trainee identity, same calendar. Only the plumbing
underneath changed.

## What you need (all free tiers)

1. A [Supabase](https://supabase.com) account — this is your database.
2. A [GitHub](https://github.com) account — to hold the code.
3. A [Vercel](https://vercel.com) account — to host the site.

## Setup steps

### 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project (pick
   any name/region, set a database password — you won't need to remember it
   for this app).
2. Once it's created, open the **SQL Editor** in the left sidebar.
3. Click **New query**, paste in the contents of `supabase-schema.sql` from
   this project, and click **Run**. This creates the one table the app needs.
4. Go to **Settings → API**. You'll need two values from this page in a
   minute: the **Project URL** and the **anon public** key.

### 2. Configure the app with your Supabase details

1. In this project folder, copy `.env.example` to a new file named `.env`.
2. Paste in your Project URL and anon key from step 1.4 above.

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

### 3. Try it locally (optional, but a good sanity check)

```
npm install
npm run dev
```

Open the local URL it prints. You should see the app load, and if you go to
Roster and add a venue, then refresh the page, the venue should still be
there — that confirms Supabase is wired up correctly.

### 4. Push the code to GitHub

If you don't already have this in a repo:

```
git init
git add .
git commit -m "Initial commit"
```

Then create a new (empty) repository on GitHub and follow the "push an
existing repository" instructions it shows you.

### 5. Deploy on Vercel

1. Go to [vercel.com](https://vercel.com), sign in, and click **Add New →
   Project**.
2. Import the GitHub repo you just created.
3. Before deploying, open **Environment Variables** and add the same two
   values from your `.env` file:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Click **Deploy**.

A minute or two later, you'll have a real public URL — something like
`novare-shift-tracker.vercel.app`. That's the link you send to trainees and
admins. No Claude account, no login wall, works for anyone.

## Important: a note on security

This version keeps the same PIN-based trainee identity system as before —
it was never meant to be bank-grade security, just a speed bump against
casual misuse, and that's still true here. The Supabase table is also set
up to allow public read/write access (see the comments in
`supabase-schema.sql`), matching the trust model the app already had. If
you later want real user accounts and locked-down permissions, that would
mean adding Supabase Auth and rewriting the database policies to check
`auth.uid()` — a follow-up project, not something needed to get this
live.

## Updating the app later

Once this is deployed, if you want changes made (new features, bug fixes),
the cleanest path is to open this project in Claude Code and describe what
you want changed — Claude Code can edit `src/App.jsx` directly and you just
push the update to GitHub, which Vercel will automatically redeploy.

## Project structure

```
├── src/
│   ├── App.jsx          # The entire app (same as the Claude artifact version)
│   ├── main.jsx          # Entry point, mounts App into the page
│   ├── index.css          # Tailwind setup
│   └── lib/
│       └── db.js          # Supabase-backed storage, replacing window.storage
├── supabase-schema.sql   # Run once in Supabase's SQL Editor
├── .env.example           # Copy to .env and fill in your Supabase details
└── package.json
```
