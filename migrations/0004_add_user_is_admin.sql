-- A user with a functional role (coordinator/engineer) can also hold admin
-- rights. The standalone 'admin' role remains for pure administrators.
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
