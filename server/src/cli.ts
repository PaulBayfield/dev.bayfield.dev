// Account chores from the command line (or `docker compose exec devtime npm run user -- …`).
// Everyone signs in through the identity provider; these only prepare or adjust accounts.
//
//   npm run user -- list
//   npm run user -- create <username> [--admin] [--email you@example.com]   (claimed on first sign-in)
//   npm run user -- make-admin <username>
//   npm run user -- sign-out <username>

import { migrate, sql } from "./db.ts";
import { USERNAME } from "./users.ts";

const [command, username, ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.includes(`--${name}`);
const opt = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

async function requireUser(id: string | undefined) {
  if (!id) throw new Error("Give a username");
  const [u] = await sql<{ id: string }[]>`SELECT id FROM users WHERE lower(id) = lower(${id})`;
  if (!u) throw new Error(`No user ${id}`);
  return u.id;
}

async function main() {
  await migrate();
  switch (command) {
    case "list": {
      console.table(await sql`SELECT id, email, is_admin, oidc_sub IS NOT NULL AS sso_linked, last_seen_at FROM users ORDER BY created_at`);
      break;
    }
    case "create": {
      if (!username || !USERNAME.test(username)) throw new Error("Give a valid username (letters, numbers, . _ -)");
      await sql`INSERT INTO users (id, name, email, is_admin) VALUES (${username}, ${username}, ${opt("email")?.toLowerCase() ?? null}, ${flag("admin")})`;
      console.log(`Created ${username}${flag("admin") ? " (admin)" : ""}. It's claimed by the first sign-in with that email or username.`);
      break;
    }
    case "make-admin": {
      const id = await requireUser(username);
      await sql`UPDATE users SET is_admin = true WHERE id = ${id}`;
      console.log(`${id} is now an admin.`);
      break;
    }
    case "sign-out": {
      const id = await requireUser(username);
      await sql`DELETE FROM sessions WHERE user_id = ${id}`;
      console.log(`${id} was signed out everywhere.`);
      break;
    }
    default:
      console.log("Commands: list | create <username> [--admin] [--email x] | make-admin <username> | sign-out <username>");
  }
}

try {
  await main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
