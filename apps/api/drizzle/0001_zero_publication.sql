-- zero-cache replicates only this publication (ZERO_APP_PUBLICATIONS=zero_app).
-- Auth internals (session/account/verification) and private user columns are excluded.
CREATE PUBLICATION zero_app FOR TABLE
  freezer, freezer_member, drawer, item, food_suggestion, invite,
  "user" (id, name, email);
