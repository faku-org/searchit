import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgresJs } from "drizzle-orm/postgres-js";
import { migrate as migratePostgresJs } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";

// Resolved from this file's location rather than the process cwd, so
// migrations still resolve once this runs as a bundled sidecar with an
// arbitrary working directory.
const MIGRATIONS_FOLDER = path.join(import.meta.dir, "..", "..", "drizzle");

const connectionString = process.env.DATABASE_URL;

/**
 * Two backends:
 * - DATABASE_URL set: an external Postgres (the `docker-compose up` dev loop).
 * - otherwise: an embedded PGlite instance (Postgres-in-WASM + the pgvector
 *   extension), so the app is fully self-contained on a fresh machine with
 *   no Docker/Postgres install. Data dir defaults alongside the other
 *   SEARCHIT_*_DIR paths, overridable via SEARCHIT_DB_DIR.
 */
function createPostgresBackend(url: string) {
  const client = postgres(url);
  const db = drizzlePostgresJs(client, { schema });
  return {
    db,
    migrate: async () => {
      await client`CREATE EXTENSION IF NOT EXISTS vector`;
      await migratePostgresJs(db, { migrationsFolder: MIGRATIONS_FOLDER });
    },
    close: () => client.end(),
  };
}

function createPgliteBackend() {
  const dbDir = path.resolve(process.env.SEARCHIT_DB_DIR ?? "../data/pgdata");
  const client = new PGlite(dbDir, { extensions: { vector } });
  const db = drizzlePglite(client, { schema });
  return {
    db,
    migrate: async () => {
      await client.exec("CREATE EXTENSION IF NOT EXISTS vector");
      await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
    },
    close: () => client.close(),
  };
}

const backend = connectionString
  ? createPostgresBackend(connectionString)
  : createPgliteBackend();

export const db = backend.db;
export const runMigrations = backend.migrate;
export const closeDb = backend.close;
