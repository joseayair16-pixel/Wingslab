-- Optional editorial overrides for search and social snippets. Empty values
-- fall back to the restaurant's existing public profile and service settings.
ALTER TABLE "Restaurant"
  ADD COLUMN "seoTitle" TEXT,
  ADD COLUMN "seoDescription" TEXT;
