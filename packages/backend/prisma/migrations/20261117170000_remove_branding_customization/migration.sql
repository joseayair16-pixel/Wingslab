-- WingsLab uses a single fixed brand identity. Per-restaurant brand colour
-- and menu background theme are no longer offered, so their persisted settings
-- are removed. `menuTheme` was never applied in the customer portal and
-- `accentColor` fell back to the fixed WingsLab red.
ALTER TABLE "Restaurant"
  DROP COLUMN "accentColor",
  DROP COLUMN "menuTheme";
