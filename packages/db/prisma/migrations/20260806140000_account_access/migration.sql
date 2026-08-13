-- Per-user SocialAccount grants for grant-scoped roles (REVIEWER/WORKER/ANALYST).
CREATE TABLE "account_access" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_access_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_access_userId_accountId_key" ON "account_access"("userId", "accountId");

CREATE INDEX "account_access_userId_idx" ON "account_access"("userId");

CREATE INDEX "account_access_accountId_idx" ON "account_access"("accountId");

ALTER TABLE "account_access" ADD CONSTRAINT "account_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "account_access" ADD CONSTRAINT "account_access_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
