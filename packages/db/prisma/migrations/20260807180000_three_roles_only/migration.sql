-- Collapse user roles to OWNER / ADMIN / REVIEWER.
-- Remap legacy WORKER and ANALYST users to REVIEWER (account-scoped operators
-- and read-only analysts both become grant-scoped Reviewers).

-- 1) Remap existing rows while the old enum values still exist.
UPDATE "users" SET "role" = 'REVIEWER' WHERE "role" IN ('WORKER', 'ANALYST');

-- 2) Drop default so we can swap the enum type.
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;

-- 3) Recreate Role enum without WORKER / ANALYST (Postgres cannot DROP ENUM values).
CREATE TYPE "Role_new" AS ENUM ('OWNER', 'ADMIN', 'REVIEWER');

ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "Role_new"
  USING ("role"::text::"Role_new");

DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";

-- 4) New default for invites / creates without an explicit role.
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'REVIEWER'::"Role";
