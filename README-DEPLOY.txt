PERMANENT RELAY ON RENDER (free) — do this once, ~10 minutes, no coding.

WHAT YOU GET: https://YOUR-NAME.onrender.com — works forever, PC can be off.
One tradeoff: after ~15 min with nobody syncing, Render sleeps it. First
sync of the day takes ~1 min to wake. Then it's instant. Avatars re-send
themselves in seconds after a wake, nothing breaks.

STEP 1 — put the code on GitHub (2 minutes, no git needed):
  1. Go to https://github.com and log in (or make a free account).
  2. Click + (top right) -> New repository. Name it roclothes-relay.
     Public is fine (this code has no passwords in it). Create.
  3. Click "uploading an existing file".
  4. From THIS folder, drag in: render.yaml, relay/server.js,
     relay/package.json — all three. (Do NOT upload node_modules.)
  5. Commit. Done — your code is online.

STEP 2 — launch it on Render (3 minutes):
  1. Go to https://render.com and sign up with the "GitHub" button
     (one click, no new password).
  2. Dashboard -> "New +" -> "Web Service" -> "Build and deploy from
     a Git repository" -> pick roclothes-relay -> Connect.
     (If it offers "New from Blueprint" because it sees render.yaml,
     use that instead — everything fills itself in.)
  3. Settings (if asked, otherwise defaults are fine):
       Runtime: Node
       Build Command: npm install
       Start Command: node server.js
       Plan: Free
  4. Create Web Service. Wait ~2 minutes while it builds.
  5. Open https://YOUR-NAME.onrender.com/health in your browser.
     You must see {"ok":true,...}. If yes — it's live.

STEP 3 — finish (your AI helper does the rest):
  Send the https://....onrender.com address to your AI helper.
  It will bake it into the script, test publish+poll from the outside
  itself, and tell you when to grab the fresh copy.
  After that: delete the tunnel/starter routine. No PC needed. Ever.
