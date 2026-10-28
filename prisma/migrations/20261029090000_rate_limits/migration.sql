-- CreateTable
CREATE TABLE "rate_limit_counters" (
    "key" VARCHAR(200) NOT NULL,
    "hits" INTEGER NOT NULL,
    "reset_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rate_limit_counters_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "rate_limit_counters_reset_at_idx" ON "rate_limit_counters"("reset_at");

ALTER TABLE "rate_limit_counters"
  ADD CONSTRAINT "rate_limit_counters_hits_positive" CHECK ("hits" >= 0);
