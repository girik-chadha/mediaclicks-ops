-- Names become two columns, and full_name becomes derived from them.
--
-- Hand-ordered. drizzle-kit emitted: drop full_name, add the generated
-- full_name, add first_name NOT NULL. Run against a table with rows that
-- fails at the third statement (NOT NULL, no default, existing rows) — and
-- by then the first statement has already thrown every name away, inside a
-- transaction that will roll back only if the migrator wraps it. Nothing
-- should depend on that. So: add the parts nullable, fill them from the
-- column that still exists, only then tighten and replace.
--
-- The split is on the first space: "Rohaan Fernandes" -> Rohaan / Fernandes,
-- "Miniz" -> Miniz / NULL. Deliberately naive; a person corrects it in
-- Profile with two fields in front of them. Matches splitFullName() in
-- src/lib/users/name.ts, which the tests pin.

ALTER TABLE "users" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_name" text;--> statement-breakpoint

UPDATE "users" SET
  "first_name" = split_part(btrim(regexp_replace("full_name", '\s+', ' ', 'g')), ' ', 1),
  "last_name"  = nullif(
    btrim(substr(
      btrim(regexp_replace("full_name", '\s+', ' ', 'g')),
      length(split_part(btrim(regexp_replace("full_name", '\s+', ' ', 'g')), ' ', 1)) + 1
    )),
    ''
  );--> statement-breakpoint

-- A row whose full_name was somehow blank gets the part of its address
-- before the @, never an empty string: first_name is about to be NOT NULL,
-- and displayFirstName() would fall back the same way anyway.
UPDATE "users" SET "first_name" = split_part("email", '@', 1)
  WHERE "first_name" IS NULL OR "first_name" = '';--> statement-breakpoint

ALTER TABLE "users" ALTER COLUMN "first_name" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "users" DROP COLUMN "full_name";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "full_name" text
  GENERATED ALWAYS AS (trim(both ' ' from (first_name || ' ' || coalesce(last_name, '')))) STORED
  NOT NULL;
