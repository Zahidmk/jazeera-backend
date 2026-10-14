-- Remove the unused RELAY_REP role.
-- Postgres cannot drop a single enum value, so the type is recreated. The guard aborts the whole
-- migration (nothing is changed) if any user still has the role.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE "role"::text = 'RELAY_REP') THEN
    RAISE EXCEPTION 'Cannot remove RELAY_REP: users still have this role. Reassign them first.';
  END IF;
END $$;

ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER', 'DRIVER', 'STORE_KEEPER', 'SALESMAN', 'MERCHANDISER');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'DRIVER';
DROP TYPE "Role_old";
