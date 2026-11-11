# Google AdSense on vector-box

Ads are **off** until `ADSENSE_CLIENT` is set in `.env`. They appear only on
`pages/giochi.php` (between "With friends" and "On your own") and `pages/ads.php`
(Support). Never inside a game, never on the library, chat or account pages.

## Turning them on

1. Sign up at <https://adsense.google.com> with `https://vector-box.duckdns.org`.
   Google checks the site before approving it: the games and support pages must be
   reachable without logging in (they are).
2. Copy the publisher id (`ca-pub-…`, Account > Settings > Account information).
3. Create `public/ads.txt` with this single line (it must be in git, so it survives
   `updatesite.sh`):

   ```
   google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
   ```

   (the same digits as the publisher id, with `pub-` instead of `ca-pub-`).
4. In the server's `.env`:

   ```
   ADSENSE_CLIENT=ca-pub-XXXXXXXXXXXXXXXX
   ```

   PHP rereads `.env`: no restart needed. From this moment the AdSense script loads on
   the two pages and Google can verify the site.
5. Once approved: AdSense > Ads > By ad unit > Display ads, create two units
   ("vector-box games", "vector-box support") and put their numeric ids in
   `ADSENSE_SLOT_GAMES` and `ADSENSE_SLOT_SUPPORT`.
6. **Consent (required in the EU):** AdSense > Privacy & messaging > European
   regulations: create and publish the consent message (Google's own certified CMP).
   Without it, Google serves only limited ads to visitors from the EU.

## Rules that keep the account alive

- Never ask people to click, view or "keep the page open" for the ads.
- No ads on pages without real content, and none next to game buttons.
- Don't click your own ads; don't reload the page to "generate views".
- The library is private (friends only): it stays login-only, out of search
  engines (`robots.txt`), and never gets ads.

## CSP

Pages define `VB_ADS_PAGE` before including `includes/head.php`; only on those pages,
and only when `ADSENSE_CLIENT` is valid, the CSP allows Google's ad and consent domains
(`sendPageSecurityHeaders()` in `api/helpers.php`). Everything else keeps the strict policy.
