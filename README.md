# Cash Position — live tracker

A private web app that reads your Supabase data, runs the validated cash engine,
and shows your NGN weekly and foreign monthly boards with live closing balances.
You can add transactions and inter-company transfers from the page.

It is protected by a single password and the database key never reaches the
browser (all data access happens on the server).

---

## What you need (all free, all in the browser — no terminal, no Node)

1. The Supabase project you already created (with `schema.sql` + `seed.sql` run).
2. A free GitHub account — https://github.com
3. A free Vercel account — https://vercel.com (sign in with GitHub)

---

## Step A — Get three values from Supabase

In your Supabase project, open **Project Settings → API** and copy:

- **Project URL**  → this is your `SUPABASE_URL`
- **service_role key** (under "Project API keys" — click "reveal") → `SUPABASE_SERVICE_ROLE_KEY`
- Choose any password you like → `APP_PASSWORD` (this is what you'll type to log in)

Keep them somewhere for Step C. The service_role key is sensitive — treat it like
a master key and never paste it into a public place.

## Step B — Put the code on GitHub (drag and drop)

1. On GitHub, click **New repository**, name it e.g. `cash-position`, set it to
   **Private**, and click **Create repository**.
2. On the new repo page, click **"uploading an existing file"**.
3. Unzip the project on your computer, then drag **all the files and folders**
   from inside the unzipped folder into the GitHub upload area.
   (Do not upload the `node_modules` folder if it exists — it isn't included.)
4. Click **Commit changes**.

## Step C — Deploy on Vercel

1. On Vercel, click **Add New… → Project**, and **Import** the `cash-position`
   repo you just created.
2. Before clicking Deploy, open **Environment Variables** and add the three from
   Step A, one at a time (Name on the left, value on the right):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `APP_PASSWORD`
3. Click **Deploy**. Wait ~1 minute.
4. Vercel gives you a live URL (like `cash-position.vercel.app`). Open it, enter
   your password, and you'll see your live cash position.

---

## Changing things later

- Edit a file directly on GitHub (pencil icon) → commit → Vercel redeploys
  automatically in about a minute.
- To change the password, update `APP_PASSWORD` in Vercel → Settings →
  Environment Variables, then redeploy.

## Note on data

Opening balances were seeded for the May periods. As you add transactions and
transfers, the closing balances recompute instantly. Auto-reading bank
statements (extraction) is the next module to add.
