-- Migration: Homepage Billboards (Uber Eats style full-width banner carousel)
-- Admin configura imágenes 960x408, enlace opcional, zonas y orden.
CREATE TABLE IF NOT EXISTS "Billboard" (
    "id" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "linkUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "regions" TEXT[],
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Billboard_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Billboard_isActive_idx" ON "Billboard"("isActive");
CREATE INDEX IF NOT EXISTS "Billboard_sortIndex_idx" ON "Billboard"("sortIndex");
