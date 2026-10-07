# Snake Arena v12

v12 keeps the PostgreSQL backend from v11 and fixes snake growth behavior.

## Growth changes
- COMBO does not increase snake length.
- Each food can add at most one segment.
- Snake length is capped at 14 segments to prevent sudden oversized snakes.
- New growth gets a tiny visual pulse.
- Speed progression remains gradual.

## Run
npm install
npm start

Set `DATABASE_URL`, `BOT_TOKEN`, and `BOT_USERNAME` in production.
