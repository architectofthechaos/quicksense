// SPDX-License-Identifier: Apache-2.0

package store

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5" // register pgx5 driver
	"github.com/golang-migrate/migrate/v4/source/iofs"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

//go:embed migrations/*.sql
var migrationsDir embed.FS

// MigrationsFS is the embedded filesystem containing the SQL migration files.
// It is exported so that hermetic tests can inspect the embedded content.
var MigrationsFS fs.FS = migrationsDir

// Migrate applies all pending up-migrations idempotently.
// It is a no-op when the schema is already current.
func Migrate(dsn string) error {
	d, err := iofs.New(MigrationsFS, "migrations")
	if err != nil {
		return err
	}

	// The golang-migrate pgx/v5 driver registers under the "pgx5" scheme.
	// Rewrite postgres:// → pgx5:// so the correct driver is selected.
	dbDSN := strings.Replace(dsn, "postgres://", "pgx5://", 1)
	dbDSN = strings.Replace(dbDSN, "postgresql://", "pgx5://", 1)

	m, err := migrate.NewWithSourceInstance("iofs", d, dbDSN)
	if err != nil {
		return err
	}
	defer m.Close()

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return err
	}
	return nil
}

// EnsureDatabase connects to the maintenance database identified by adminDSN
// and issues CREATE DATABASE for dbName, silently ignoring the Postgres
// duplicate_database error (42P04) when the database already exists.
func EnsureDatabase(ctx context.Context, adminDSN, dbName string) error {
	conn, err := pgx.Connect(ctx, adminDSN)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)

	// Quote the identifier so a mixed/upper-case name (e.g. QUICKSENSE) is
	// preserved verbatim; an unquoted CREATE DATABASE folds it to lower case,
	// which then mismatches the case-sensitive database name in the DSN.
	_, err = conn.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{dbName}.Sanitize())
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42P04" {
			// duplicate_database — already exists, that's fine
			return nil
		}
		return err
	}
	return nil
}
