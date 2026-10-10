-- Repair consumer users identity sequence
-- Migration 022
--
-- Existing consumers can log in without allocating a new users.id.
-- Brand-new consumers require nextval(users_id_seq). If the sequence ever
-- falls behind MAX(users.id), new signups fail while existing login continues
-- to work. This migration safely realigns the sequence.

BEGIN;

SELECT setval(
  pg_get_serial_sequence('users', 'id'),
  COALESCE((SELECT MAX(id) FROM users), 1),
  EXISTS(SELECT 1 FROM users)
);

COMMIT;
