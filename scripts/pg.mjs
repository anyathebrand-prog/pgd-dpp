/**
 * Local Postgres without Docker.
 *
 * `docker compose up -d db` is still the documented path and is what CI uses.
 * This is the fallback for machines where Docker cannot run — on this one,
 * WSL2 has no distro provisioned, and EnterpriseDB's download host returns 403
 * to this network, which rules out winget, Chocolatey and the portable zip
 * alike.
 *
 * It drives real PostgreSQL 16 binaries, shipped through npm as
 * `@embedded-postgres/windows-x64`, from a data directory inside the project.
 * Nothing is installed system-wide and no administrator rights are needed.
 *
 *   node scripts/pg.mjs start     initdb on first run, then start on port 5433
 *   node scripts/pg.mjs stop
 *   node scripts/pg.mjs status
 *   node scripts/pg.mjs destroy   delete the data directory entirely
 *
 * Port 5433 matches docker-compose.yml, so .env is identical either way.
 *
 * Note the binary package ships only initdb, pg_ctl and postgres — there is no
 * psql or createdb — so database creation below goes through the `postgres`
 * driver the application already depends on.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import postgres from 'postgres';

const ROOT = resolve(import.meta.dirname, '..');
const BIN = join(ROOT, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin');
const DATA = join(ROOT, '.pgdata');
const LOG = join(DATA, 'server.log');
const PORT = 5433;

/** Matches POSTGRES_USER / POSTGRES_PASSWORD in docker-compose.yml. */
const OWNER = 'pgd_owner';
const PASSWORD = 'pgd_local_dev';
const DBNAME = 'pgd_dpp';

const exe = (name) => join(BIN, `${name}.exe`);

function isRunning() {
  return spawnSync(exe('pg_ctl'), ['status', '-D', DATA], { encoding: 'utf8' }).status === 0;
}

async function waitForReady(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sql = postgres({
      host: '127.0.0.1',
      port: PORT,
      user: OWNER,
      password: PASSWORD,
      database: 'postgres',
      max: 1,
      connect_timeout: 2,
      onnotice: () => {},
    });
    try {
      await sql`SELECT 1`;
      await sql.end();
      return true;
    } catch {
      await sql.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

async function start() {
  if (!existsSync(BIN)) {
    console.error(
      'PostgreSQL binaries are missing. Run:\n' +
        '  npm install --save-dev @embedded-postgres/windows-x64@16.14.0-beta.17',
    );
    process.exit(1);
  }

  if (!existsSync(join(DATA, 'PG_VERSION'))) {
    console.log('Initialising a new cluster in .pgdata…');
    mkdirSync(DATA, { recursive: true });

    // initdb takes the superuser password from a file rather than a flag, so it
    // never lands in the process list or the shell history.
    const pwFile = join(ROOT, '.pgpass-init');
    writeFileSync(pwFile, PASSWORD, 'utf8');
    try {
      execFileSync(
        exe('initdb'),
        ['-D', DATA, '-U', OWNER, '--pwfile', pwFile, '-E', 'UTF8', '--locale', 'C',
          // scram-sha-256 rather than trust, so local auth behaves the way a
          // real deployment does instead of quietly accepting anything.
          '-A', 'scram-sha-256'],
        { stdio: 'inherit' },
      );
    } finally {
      rmSync(pwFile, { force: true });
    }
  }

  if (isRunning()) {
    console.log(`Already running on port ${PORT}.`);
  } else {
    console.log(`Starting PostgreSQL on port ${PORT}…`);
    // stdio must NOT be inherited: the daemon keeps the inherited handles open
    // for its lifetime, so the calling shell would never see the pipe close and
    // would appear to hang even though the server started fine.
    execFileSync(
      exe('pg_ctl'),
      ['start', '-D', DATA, '-l', LOG, '-o', `-p ${PORT} -c listen_addresses=127.0.0.1`],
      { stdio: 'ignore' },
    );
  }

  if (!(await waitForReady())) {
    console.error(`Postgres did not accept connections in time. See ${LOG}`);
    process.exit(1);
  }

  const admin = postgres({
    host: '127.0.0.1', port: PORT, user: OWNER, password: PASSWORD,
    database: 'postgres', max: 1, onnotice: () => {},
  });
  const [existing] = await admin`SELECT 1 AS ok FROM pg_database WHERE datname = ${DBNAME}`;
  if (!existing) {
    console.log(`Creating database ${DBNAME}…`);
    await admin.unsafe(`CREATE DATABASE "${DBNAME}" OWNER "${OWNER}"`);
  }
  await admin.end();

  console.log(`\nReady on postgresql://${OWNER}@localhost:${PORT}/${DBNAME}`);
  console.log('Next: npm run db:reset');
}

function stop() {
  if (!isRunning()) return console.log('Not running.');
  execFileSync(exe('pg_ctl'), ['stop', '-D', DATA, '-m', 'fast', '-w'], { stdio: 'ignore' });
  console.log('Stopped.');
}

function status() {
  console.log(isRunning() ? `Running on port ${PORT}.` : 'Not running.');
}

function destroy() {
  if (isRunning()) stop();
  rmSync(DATA, { recursive: true, force: true });
  console.log('Deleted .pgdata. The next start initialises a fresh cluster.');
}

const commands = { start, stop, status, destroy };
const command = process.argv[2] ?? 'start';

if (!commands[command]) {
  console.error(`Usage: node scripts/pg.mjs <${Object.keys(commands).join('|')}>`);
  process.exit(1);
}
await commands[command]();
