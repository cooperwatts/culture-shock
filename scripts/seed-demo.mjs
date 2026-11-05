#!/usr/bin/env node
/**
 * Populates a local installation with an organization, an enabled pack, a
 * launched run and enrolled participants, so the interface has something in it.
 *
 * Local only. It uses the development sign-in route, which refuses to run
 * outside ENVIRONMENT=development.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const API = process.env.API_BASE ?? "http://localhost:8788";
// Must match PUBLIC_BASE_URL, which the API compares against on unsafe methods.
const ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const PARTICIPANTS = Number(process.env.SEED_PARTICIPANTS ?? 24);

const DEPARTMENTS = ["technology", "marketing", "retail", "finance", "people"];
const ZONES = ["America/Toronto", "America/Vancouver", "Europe/London", "Asia/Singapore"];
const REMOTE = ["remote", "hybrid", "onsite"];

function setupToken() {
  const fromEnv = process.env.SETUP_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    const vars = readFileSync(new URL("../apps/api/.dev.vars", import.meta.url), "utf8");
    const match = vars.match(/^SETUP_TOKEN\s*=\s*"?([^"\n]+)"?/m);
    if (match?.[1]) return match[1];
  } catch {
    // falls through to the error below
  }
  throw new Error("No SETUP_TOKEN. Set it in apps/api/.dev.vars or pass it in the environment.");
}

/** Minimal cookie jar. Each caller gets its own, so participants stay distinct. */
function jar() {
  const cookies = new Map();
  return {
    capture(response) {
      for (const line of response.headers.getSetCookie?.() ?? []) {
        const [pair] = line.split(";");
        const index = pair.indexOf("=");
        if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
    },
    header() {
      return [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    csrf() {
      return cookies.get("cs_csrf") ?? cookies.get("__Host-cs_csrf") ?? "";
    },
  };
}

async function call(cookies, method, path, body, extraHeaders = {}) {
  const headers = { cookie: cookies.header(), ...extraHeaders };
  if (method !== "GET") {
    headers["content-type"] = "application/json";
    headers["x-cs-csrf"] = cookies.csrf();
    headers.origin = ORIGIN;
  }

  const response = await fetch(`${API}/api/v1${path}`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    redirect: "manual",
  });
  cookies.capture(response);

  if (response.status === 204 || response.status === 302) return { data: null, meta: {} };

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const code = payload?.error?.code ?? response.status;
    const message = payload?.error?.message ?? "request failed";
    const error = new Error(`${method} ${path} -> ${code}: ${message}`);
    error.code = code;
    throw error;
  }
  return payload;
}

async function signIn(handle, role) {
  const cookies = jar();
  const response = await fetch(
    `${API}/api/v1/auth/dev-login?as=${role}&handle=${encodeURIComponent(handle)}`,
    { redirect: "manual" },
  );
  cookies.capture(response);
  if (!cookies.csrf()) {
    throw new Error(`Sign-in failed for ${handle}. Is the API running with ENVIRONMENT=development?`);
  }
  return cookies;
}

function offsetDays(days) {
  return new Date(Date.now() + days * 86400 * 1000).toISOString();
}

async function main() {
  process.stdout.write(`Seeding ${API}\n`);

  const anonymous = jar();
  try {
    await call(anonymous, "POST", "/admin/bootstrap", {
      organizationName: "Northwind Trading",
      organizationSlug: "northwind",
      locale: "en-CA",
      timeZone: "America/Toronto",
      identityProviders: [],
    }, { "x-setup-token": setupToken() });
    process.stdout.write("  organization created, built-in packs seeded\n");
  } catch (error) {
    if (error.code !== "conflict") throw error;
    process.stdout.write("  organization already exists, continuing\n");
  }

  const admin = await signIn("admin", "admin");
  process.stdout.write("  signed in as admin\n");

  const slug = "coffee-roulette";
  try {
    await call(admin, "POST", `/packs/${slug}/enable`);
    process.stdout.write(`  enabled ${slug}\n`);
  } catch (error) {
    if (error.code !== "conflict") throw error;
  }

  const packs = await call(admin, "GET", "/packs");
  const pack = packs.data.find((entry) => entry.slug === slug);
  if (!pack?.latestVersion) throw new Error(`${slug} has no published version`);

  const experience = await call(admin, "POST", "/experiences", {
    name: "Spring Coffee Roulette",
    description: "Fifteen minutes with someone you would not otherwise meet.",
    packSlug: slug,
    packVersion: pack.latestVersion,
  });
  process.stdout.write(`  created experience ${experience.data.id}\n`);

  const instance = await call(
    admin,
    "POST",
    `/experiences/${experience.data.id}/instances`,
    {
      name: "March cohort",
      timeZone: "America/Toronto",
      enrollmentClosesAt: offsetDays(3),
      startsAt: offsetDays(4),
      endsAt: offsetDays(18),
      participationMode: "optional",
    },
    { "idempotency-key": randomUUID() },
  );
  const instanceId = instance.data.id;

  await call(admin, "POST", `/instances/${instanceId}/launch`, {}, {
    "idempotency-key": randomUUID(),
    "if-match": "1",
  });
  process.stdout.write(`  launched instance ${instanceId}\n`);

  let enrolled = 0;
  for (let index = 0; index < PARTICIPANTS; index += 1) {
    const handle = `person${String(index + 1).padStart(2, "0")}`;
    const participant = await signIn(handle, "participant");
    await call(participant, "POST", `/instances/${instanceId}/enroll`);
    await call(participant, "PUT", `/instances/${instanceId}/participants/me/preferences`, {
      timeZone: ZONES[index % ZONES.length],
      remotePreference: REMOTE[index % REMOTE.length],
      department: DEPARTMENTS[index % DEPARTMENTS.length],
      team: `team-${index % 7}`,
      geography: index % 2 === 0 ? "ca" : "us",
      tenureBand: index % 5 === 0 ? "lt_3_months" : "gte_3_years",
      interests: [`topic-${index % 6}`],
      languages: ["en"],
      schedulingConstraints: [],
      consent: {
        profile_derivation: index % 4 !== 0,
        ai_processing: false,
        messaging: true,
        insights_survey: true,
      },
    });
    enrolled += 1;
  }
  process.stdout.write(`  enrolled ${enrolled} participants\n`);

  process.stdout.write(`
Done. Open these in a browser:

  Admin        ${ORIGIN}/api/v1/auth/dev-login?as=admin&redirect=/admin
  Designer     ${ORIGIN}/api/v1/auth/dev-login?as=admin&redirect=/designer
  Participant  ${ORIGIN}/api/v1/auth/dev-login?as=participant&handle=person01&redirect=/participant

The run is open for enrolment with ${enrolled} people in it. To see matching,
close enrolment on the instance page, generate a preview, then publish.

  Instance     ${ORIGIN}/designer/instances/${instanceId}
`);
}

main().catch((error) => {
  process.stderr.write(`\n${error.message}\n`);
  process.exit(1);
});
