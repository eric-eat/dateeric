# Swipe Right On Me

A joke dating app where every card is you.

This project is static-first for GitHub Pages (HTML/CSS/JS), with optional
Supabase storage for:

- Swipe event tracking
- Instagram handle submissions (with optional message)
- Referral code capture via URL query param (`?ref=yourcode`)

## 1) Add your photos

Put your images in `images/` and update `profiles.js`.

Example profile entry:

```js
{
  id: "me-001",
  name: "You",
  bio: "Your one-liner",
  photo: "./images/me-1.jpg",
}
```

## 2) Set up Supabase

1. Create a Supabase project.
2. Open SQL Editor and run `supabase/schema.sql`.
   - If you already ran an older version, run it again. It includes `alter table`
     statements for safe updates.
3. Go to `Project Settings -> API` and copy:
   - Project URL
   - anon public key
4. Put values in `config.js`:

```js
export const APP_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT_ID.supabase.co",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
};
```

Without config, the app still runs visually but storage calls are disabled.

## Referral links

Share links like:

`https://<your-username>.github.io/<repo-name>/?ref=friend123`

Spaces are supported. URL-encode them as `%20`:

`https://<your-username>.github.io/<repo-name>/?ref=Melanie%20Toh`

When a visitor opens the link:

- They get a popup: "You've been referred to DateEric by friend123."
- `referral_code` is saved with swipe events and Instagram submissions.

## 3) Run locally

Serve with any static server (for module imports):

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## 4) Deploy to GitHub Pages

1. Push this folder to a GitHub repo.
2. Repo Settings -> Pages.
3. Source: `Deploy from a branch`.
4. Branch: `main`, folder: `/ (root)`.
5. Save.

After deploy, your site is live at
`https://eric-chng.github.io/dating-app/`.

For a referral link:
`https://eric-chng.github.io/dating-app/?ref=first%20second`

## Notes on spam and privacy

- A honeypot field and cooldown are included client-side, but this is not full
  bot protection.
- For stronger protection, add Cloudflare Turnstile or hCaptcha and validate
  token server-side (Cloudflare Worker / Supabase Edge Function).
- Keep in mind GitHub Pages is public. Do not commit private content.
