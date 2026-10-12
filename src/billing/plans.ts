// Plans and limits (SPEC §10). Free: 1 project (public repo or manual), email alerts, weekly digest.
// Team: unlimited projects, private repos through the GitHub App, Slack, up to 10 members, CSV
// export. Every check here is server-side; pages only hide what these refuse.
//
// A team is a Team-plan user (the owner) plus the members who accepted an invite. Members share
// the owner's projects, and new projects they create belong to the owner. Membership counts only
// while the owner is on Team: a lapsed subscription leaves the rows in place, inactive.
import { and, asc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import type { Ctx } from "../context";
import { projects, teamMembers, users, type Plan, type User } from "../db/schema";

export const FREE_PROJECTS = 1;
/** Owner included. */
export const TEAM_SIZE = 10;
export const PRICES = { month: 19, year: 190 } as const;
/** What each plan includes, as shown on /pricing, in Settings and on every upgrade page. */
export const FREE_FEATURES = [`${FREE_PROJECTS} project: pick services or import a public repo`, "Every service and runtime in the catalog, plus your packages", "Email alerts, at most 3 a day", "Weekly digest"];
export const TEAM_FEATURES = ["Unlimited projects", "Private repos through our GitHub App, re-imported on push", "Slack alerts", `Up to ${TEAM_SIZE} people sharing projects`, "CSV export of vendor risk"];

export interface Account {
  /** Whose projects new projects go to and whose plan applies: the user, or their team's owner. */
  ownerId: number;
  plan: Plan;
  role: "solo" | "owner" | "member";
  /** User ids whose projects this user can see and edit (self first). */
  projectOwners: number[];
  ownerEmail?: string;
}

export const isTeamPlan = (u: Pick<User, "plan">) => u.plan === "team";

/** The plan and project scope that apply to `user` right now. */
export async function accountOf(ctx: Ctx, user: User): Promise<Account> {
  const team = await ctx.db
    .select({ ownerId: teamMembers.ownerId, ownerEmail: users.email })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.ownerId))
    .where(and(eq(teamMembers.userId, user.id), isNotNull(teamMembers.joinedAt), eq(users.plan, "team")))
    .get();
  if (team) return { ownerId: team.ownerId, plan: "team", role: "member", projectOwners: [user.id, team.ownerId], ownerEmail: team.ownerEmail };
  const plan: Plan = isTeamPlan(user) ? "team" : "free";
  return { ownerId: user.id, plan, role: plan === "team" ? "owner" : "solo", projectOwners: [user.id] };
}

/**
 * SQL true when the user id `userExpr` has Team features: their own Team plan, or an accepted
 * membership of a Team owner's team. Used where there is no request (fan-out, delivery, webhooks).
 */
export function teamPlanSql(userExpr: SQL): SQL {
  return sql`(EXISTS (SELECT 1 FROM users tp WHERE tp.id = ${userExpr} AND tp.plan = 'team')
    OR EXISTS (SELECT 1 FROM team_members tpm JOIN users tpo ON tpo.id = tpm.owner_id
               WHERE tpm.user_id = ${userExpr} AND tpm.joined_at IS NOT NULL AND tpo.plan = 'team'))`;
}

export async function hasTeamPlan(ctx: Ctx, userId: number): Promise<boolean> {
  const [row] = await ctx.db.all<{ ok: number }>(sql`SELECT ${teamPlanSql(sql`${userId}`)} AS ok`);
  return !!row?.ok;
}

/** Projects the account owner already has (the Free limit counts the owner's own projects). */
export async function projectCount(ctx: Ctx, ownerId: number): Promise<number> {
  const [row] = await ctx.db.all<{ n: number }>(sql`SELECT count(*) AS n FROM projects WHERE user_id = ${ownerId}`);
  return row?.n ?? 0;
}

export async function canCreateProject(ctx: Ctx, account: Account): Promise<boolean> {
  return account.plan === "team" || (await projectCount(ctx, account.ownerId)) < FREE_PROJECTS;
}

/**
 * On Free, only the owner's oldest project is watched for alerts; the rest stay visible (after a
 * downgrade, say) but quiet. SQL true when project `p` alerts.
 */
export function projectAlertsSql(projectAlias = "p"): SQL {
  const p = sql.raw(projectAlias);
  return sql`(${teamPlanSql(sql`${p}.user_id`)} OR ${p}.id = (SELECT min(id) FROM projects WHERE user_id = ${p}.user_id))`;
}

/** The project a Free owner keeps alerts on (their oldest). */
export async function freeProjectId(ctx: Ctx, ownerId: number): Promise<number | undefined> {
  return (await ctx.db.select({ id: projects.id }).from(projects).where(eq(projects.userId, ownerId)).orderBy(asc(projects.id)).limit(1).get())?.id;
}
