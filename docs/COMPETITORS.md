# Competitor check: what Dependabot/GitHub, Snyk and Socket flag today

Date of research: 2026-10-11. All pages below were accessed on 2026-10-11 (via fetch tools that summarise a page, so quotes are as returned by the tool; re-check a quote against the page before using it in public copy).

Question (from SPEC §2 "Positioning"): for upstream licence changes, package deprecations, archived or unmaintained repos, and hosted-service changes (pricing, free tier, terms, end of development, acquisitions), what do GitHub (Dependabot, dependency graph, dependency review), Snyk and Socket.dev flag, and is it a pushed alert or only a check at PR/scan time? Free or paid? Which ecosystems? What are the gaps?

Method limits. Official docs were fetched where they exist. Where a docs page is silent, this file says "not documented", which is not proof the feature is absent. Absence claims are marked **unverified** unless a page positively says so. Third-party pricing blogs are not used as a basis for claims except where marked.

## Comparison table

| Signal | Dependabot / GitHub | Snyk | Socket | Stackquake (planned, SPEC §5) |
|---|---|---|---|---|
| Licence change alert (upstream dep goes MIT to BUSL/SSPL) | **No alert.** Dependabot alerts cover vulnerabilities (and malware) only. Dependency graph shows each dependency's licence. Dependency review can fail a PR on a licence allow/deny list: a PR-time check, free on public repos, paid (GitHub Code Security) on private. | **No change alert documented.** Licence policy flags disallowed licences at scan time (UI, CLI, PR checks). Licence issues can appear in issue-alert emails for monitored projects. Licence compliance management is Enterprise-only per its docs (page is internally inconsistent). | **No "licence change" alert type.** Nine licence alert types (e.g. Non-permissive, Copyleft, License Policy Violation) judge the licence of a package version, not a change between versions. Free tier includes "license risks" detection; per-plan policy features unclear. | Event when the licence field or LICENSE file of a watched package or repo changes, with a quote and an "affects you" note. |
| Package deprecation (npm `deprecated`, PyPI inactive/yanked) | **Not documented** for Dependabot or dependency graph. Dependabot's own page says it covers vulnerable dependencies. | **UI indicator only, npm only.** Warning icon plus a "Deprecated" filter on the Dependencies tab. No deprecation notification documented. PyPI inactive/yanked: not documented. | **Yes, as an alert.** "Deprecated" (medium): "The maintainer of the package marked it as deprecated." Runs on every PR; also in the dashboard. A push notification for an already-merged dependency becoming deprecated is **not documented** (see Socket section). | Event when npm `deprecated` is set, PyPI project is marked inactive, or latest version is yanked; pushed by email. |
| Archived upstream repo | **No** (dependency graph and Dependabot docs are silent; "Dependabot doesn't scan archived repositories" is about the user's own repos). Archived status is in OpenSSF Scorecard output of dependency review (see below), not an alert. | **Not documented.** | **No archived-repo alert type found** in the alert type lists. "Unmaintained" exists but means no publish for more than 5 years. | Event when `archived` flips to true or the repo is transferred. |
| Hosted service pricing / free tier / terms | **No.** Not applicable to a manifest scanner. | **No.** | **No.** | Core feature: vendor pricing and terms pages, with old and new values. |
| End-of-development notice (runtime/service) | **No.** | **No** for services. (Snyk Container flags EOL OS images; not checked here, **unverified**.) | **No.** | Core feature: vendor feed classifier plus endoflife.date. |
| Acquisitions | **No.** | **No.** | **No.** (Socket has an "Unstable ownership" alert, but that means a new collaborator publishing package versions, not a company acquisition.) | Core feature: vendor feed classifier. |

Summary: for packages, GitHub, Snyk and Socket cover pieces of licence-at-scan-time and deprecation (Socket most directly), almost all as PR/scan-time checks rather than "this changed upstream" alerts. For hosted services and runtimes, none of the three covers anything. That matches the SPEC §2 expectation.

## GitHub: Dependabot, dependency graph, dependency review

**What Dependabot alerts cover.** The docs describe alerts as notifying "you about vulnerable dependencies so you can upgrade to secure versions", fired when "a new vulnerability is added to the GitHub Advisory Database", and only for advisories reviewed by GitHub. The page does not mention deprecated packages, licence changes or unmaintained packages. It does say "Dependabot doesn't scan archived repositories" (a limit on the user's own archived repos, not an alert about upstream). Source: https://docs.github.com/en/code-security/dependabot/dependabot-alerts/about-dependabot-alerts (2026-10-11). Dependabot alerts are listed under features "available for all GitHub plans", so free for public and private repos: https://docs.github.com/en/code-security/getting-started/github-security-features (2026-10-11).

**Ecosystems.** Dependabot supports a long list including npm/pnpm, pip/poetry/pipenv, Cargo, Go modules, Maven, Gradle, NuGet, Composer, Bundler, Bun, Deno, Docker, Helm, GitHub Actions, Terraform-adjacent OpenTofu, and more (list cut off in the fetch, so possibly longer): https://docs.github.com/en/code-security/dependabot/ecosystems-supported-by-dependabot/supported-ecosystems-and-repositories (2026-10-11).

**Deprecation.** No GitHub docs page found says Dependabot or the dependency graph flags `deprecated` npm packages or PyPI inactive/yanked projects. A web search for a 2026 GitHub changelog entry on this found nothing. Status: **not documented; absence unverified.** Dependabot *version updates* open a PR when a newer version exists, which may indirectly surface a replacement, but that is not a deprecation alert.

**Dependency graph (licence info).** Per the docs, for each dependency "you can see the version, license information, the manifest file which included it". The page does not mention deprecated or archived status. Free on all plans per the features page. Source: https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-the-dependency-graph (2026-10-11). Supported ecosystems for the graph: Bazel, Cargo, Composer, Deno, NuGet, GitHub Actions, Go, Gradle, Julia, Maven, npm, OpenTofu, pip, pnpm, pub, Poetry, RubyGems, Swift Package Manager, Yarn: https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/dependency-graph-supported-package-ecosystems (2026-10-11).

**Dependency review and the dependency review action (licence checks).** This is a PR-time check, not an alert. The overview says it "provides information on license, dependents, and age of dependencies" and the action can "set an allow or deny list for licenses to scan": https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-dependency-review (2026-10-11). The action README says "The action will fail on pull requests that introduce dependencies with licenses that do not match the list", and "If we can't detect the license for a dependency we will inform you, but the action won't fail." Licence data comes from ClearlyDefined. `deny-licenses` is itself marked deprecated; `allow-licenses` is the recommended option. Options also include `deny-packages`, `deny-groups`, and OpenSSF Scorecard output (`show-openssf-scorecard`, default true; `warn-on-openssf-scorecard-level`, default 3). Latest action version in the docs is v5 (node24). Source: https://github.com/actions/dependency-review-action (2026-10-11). Availability: free on public repos; private repos need GitHub Code Security (or Advanced Security): the about page and https://docs.github.com/en/code-security/getting-started/github-security-features (2026-10-11).

**Archived/unmaintained via Scorecard.** OpenSSF Scorecard's Maintained check says "If the project is archived, it receives the lowest score." (https://github.com/ossf/scorecard/blob/main/docs/checks.md, 2026-10-11). Dependency review can show that score for dependencies *changed in a PR* and warn below a threshold, so GitHub effectively has a PR-time archived/unmaintained signal, though the action docs do not describe it as an "archived" check. It only runs when a PR touches dependencies.

**Gaps (GitHub).**
- Nothing pushes you a message when an *existing* dependency's licence, deprecation or archived state changes.
- Licence checks are triggered by a PR that adds or changes a dependency. A licence change in a new upstream version is seen when a bump PR (often a Dependabot PR) arrives. That is an inference from how the action works, not a documented statement.
- Repo-level licence changes that are not tied to a new package version (for example a project relicensing its `main` branch while the registry package keeps its old licence) are outside what these tools describe.
- Private-repo dependency review is paid.
- Nothing on hosted services.

## Snyk

**Licence compliance.** Snyk checks licences "alongside vulnerability scanning in the web UI, CLI, and PR Checks", covering direct and indirect dependencies, "against Snyk known licenses", with severity set by policy. The page does not say whether Snyk alerts when a dependency's licence changes, and does not state plan requirements. Ecosystems listed: C/C++ (unmanaged), Cocoapods, Composer, Go, Maven, npm, NuGet, PyPI, RubyGems. Source: https://docs.snyk.io/scan-fix-and-prevent/scan-with-snyk/snyk-open-source/scan-open-source-libraries-and-licenses/open-source-license-compliance.md (2026-10-11).

**Licence policy (paid).** "Snyk License Compliance Management is available only with Enterprise plans" while the same page also lists being on "a Snyk paid plan" as a prerequisite, so the page is inconsistent. Custom policies per Organization with severity per licence. Source: https://docs.snyk.io/scan-fix-and-prevent/scan-with-snyk/snyk-open-source/scan-open-source-libraries-and-licenses/snyk-license-compliance-management.md (2026-10-11). Third-party pricing blogs claim licence compliance sits in Team and above (e.g. https://costbench.com/software/vulnerability-management/snyk/free-plan/, not an official source; **unverified**).

**Notifications.** Notification types are "vulnerabilities", "license issues", "weekly summary report", "usage alerts", "report status". Licence alerts exist only as part of issue-alert emails (per Org or Project). Nothing on deprecated or unmaintained packages. Source: https://docs.snyk.io/platform-administration/snyk-hierarchy/manage-notifications.md (2026-10-11). These emails are about issues Snyk finds in your monitored projects against your policy, not about an upstream project changing its licence. Whether a licence change in a *newly published* version triggers an email before you upgrade is **not documented**.

**Deprecation.** "For npm only, a warning icon appears next to the package name if a package is deprecated", plus a "Deprecated" filter on the Dependencies tab. It is a UI view, "not an alert". "Latest version" and "Last publish" columns are "supported for npm and Maven only". Source: https://docs.snyk.io/manage-risk/reporting/dependencies-and-licenses/view-dependencies (2026-10-11). Older Snyk material (2019 blog) says the same; PyPI and other registries are not documented. Source: https://snyk.io/blog/dependency-health-assessing-package-risk-with-snyk/ (2026-10-11, via search result summary).

**Maintenance / archived.** Snyk Advisor pages showed a "Package Health Score" and a "Healthy/Inactive" maintenance label. A search result noted an Advisor page saying Advisor "will be sunsetting during Jan, 2026" with data moving to Snyk Security DB (https://dev.snyk.io/advisor/npm-package/deprecated, search snippet, 2026-10-11). Current state of that migration is **unverified**. No archived-repo alert documented.

**Plans.** A free plan exists (official limits not confirmed here; third-party blogs mention a cap of about 200 open-source tests per month, **unverified**).

**Gaps (Snyk).** No licence-change alert documented; deprecation is a UI marker, npm only; no archived-repo signal; the licence feature is behind paid tiers; nothing on services.

## Socket.dev

**Alert types (the most relevant coverage of the three).**
- **Deprecated** (medium): "The maintainer of the package marked it as deprecated." It "could indicate that a single version should not be used, or that the package is no longer maintained and any new vulnerabilities will not be fixed." Socket "automatically runs checks with every GitHub PR for packages that have been designated as Deprecated". Sources: https://socket.dev/alerts/deprecated and https://docs.socket.dev/docs/maintenance.md (2026-10-11).
- **Unmaintained** (low): "Package has not been updated in more than 5 years and may be unmaintained." Same maintenance page.
- **Licence alerts**, nine types: License Policy Violation (critical), Explicitly Unlicensed Item (high), Misc. License Issues (medium), and low-severity Copyleft License, No License Found, Non-permissive License, Unidentified License, Ambiguous License Classifier, License Exception. The page has "no alert for a license change between versions" (tool-summary wording; the page lists no such type). Source: https://docs.socket.dev/docs/license.md (2026-10-11). Licence policy is default-deny: licences not set to Block, Warn or Monitor are "treated as Denied": https://docs.socket.dev/docs/license-policy.md (2026-10-11).
- **Ownership**: Unstable ownership (high: "A new collaborator has begun publishing package versions"), New author (medium), Non-existent author (high). No archived-repo or licence-change alert in the supply-chain-risk list: https://docs.socket.dev/docs/supply-chain-risk.md (2026-10-11).

**Push or check?** Socket scans on commits and PRs: "Socket currently does not initiate a scan until there is a commit or a pull request (PR)", and org-level alerts "are not populated unless a PR is merged into the default branch". The docs do not say alerts are re-evaluated when an upstream package later becomes deprecated without a code change; **unverified**, Socket support would need to confirm. Source: https://docs.socket.dev/docs/organization-alerts.md (2026-10-11). The deprecated alert page does say Socket "alerts you when a package you use becomes deprecated" (tool summary of https://socket.dev/alerts/deprecated), which suggests some push behaviour; the two pages are not clearly reconciled.

**Notifications and plans.** Org alert notifications (created, changed, cleared; filtered by category including Maintenance and License) go by email and Microsoft Teams, as a digest after about 20 minutes, and "are available on Team, Business, and Enterprise plans". The same page says Slack is "not yet available", while a separate Slack alerts page exists and describes PR notifications; treat Slack coverage as unclear. Sources: https://docs.socket.dev/docs/notifications.md and https://docs.socket.dev/docs/slack-alerts.md (2026-10-11).

**Pricing.** Free $0 ("unlimited developers and repos", 1,000 scans per month, "Detection of 70+ risk types, including license risks"); Team $25 per developer per month (min 5); Business $50 per developer per month (min 20); Enterprise custom. Slack alerts for malware/vulnerabilities are listed under Team. Source: https://socket.dev/pricing (2026-10-11).

**Ecosystems.** The ecosystem support page lists npm, Go, Maven, NuGet, Cargo and RubyGems as GA, and Python (uv, pip, Poetry) as GA, with variation by feature: https://docs.socket.dev/docs/language-support (2026-10-11, search result summary). Whether the deprecated alert works equally across all of them is **unverified**.

**Gaps (Socket).** No archived-repo or licence-change alert found; push notifications for state changes in already-merged dependencies not documented, and sit on paid tiers; licence policy enforcement is PR-time; no coverage of hosted services, pricing, terms, end of development or acquisitions.

## Adjacent tools

| Tool | What it does for this question | Pushed or check? | Free/paid | Source |
|---|---|---|---|---|
| Renovate (Mend) | Dependency Dashboard adds "a prominent warning" for "packages flagged as deprecated on their registry" or with a community replacement; `abandonmentThreshold` marks packages with no release in a set period as abandoned. | Appears in the dashboard issue and PRs, so closer to a push than a scan, but only for deps in your repos. Licence changes: not documented in what was read. | Open source (Mend-hosted app is free for GitHub; plans unverified) | https://docs.renovatebot.com/key-concepts/dashboard/ , https://docs.renovatebot.com/configuration-options/ (2026-10-11) |
| FOSSA / Mend SCA | Licence compliance and policy for dependencies. Searches found no "licence changed upstream" alert for either; Mend opens a GitHub issue per licence-policy violation at scan time. | Scan-time | Paid | https://docs.mend.io/integrations/latest/view-results-of-your-mend-for-github-sca-scan , https://docs.fossa.com/docs/issue-support-docs (2026-10-11). Absence **unverified**. |
| OpenSSF Scorecard / deps.dev | Scorecard "Maintained" check: "If the project is archived, it receives the lowest score." License check tests whether a licence is published. Point-in-time snapshot, not alerting. deps.dev not checked in depth (**unverified**). | Snapshot | Free | https://github.com/ossf/scorecard/blob/main/docs/checks.md (2026-10-11) |
| endoflife.date | Support/EOL dates for products, including some cloud services (e.g. managed Kubernetes). Offers an API and iCalendar support and an Atom feed of newly added products. No email notifications mentioned. Does not cover pricing, free tiers, terms or acquisitions. | Pull (API, calendar) | Free | https://endoflife.date/ (2026-10-11) |
| Visualping and similar page monitors | Generic page-change monitoring: alerts by email, Slack, Teams, webhook with before/after view and AI "does it matter" flag. Not tied to your stack; you pick and maintain each URL; no catalog, no "does this affect you". | Pushed | Free personal tier; paid for business | https://www.visualping.io/ (2026-10-11) |
| SaaS Price Pulse | Tracks pricing changes for 260+ SaaS tools, aimed at competitors and pricing teams ("Never miss a competitor pricing change"); "Pro Alerts" described as launching. Pricing only per the page; free tier and terms not mentioned. | Alerts planned | Unknown | https://www.saaspricepulse.com/blog/how-to-track-saas-pricing (2026-10-11) |

Two things this check found about the generic route. First, monitoring vendor pricing and terms pages with a page monitor is possible today, and third-party sources describe pricing pages as noisy (one vendor says most "changes" are packaging, renames or retired plans; self-interested source, treat with care: https://www.saaspricepulse.com/blog/state-of-saas-pricing-q2-2026). That supports the SPEC §5 normalisation and materiality steps. Second, none of the adjacent tools combines a stack list, vendor pricing/terms/EOL/acquisition events, and a "what this means for you" note.

## Where Stackquake differs

Honest starting point: package-level signals (licence field, `deprecated`, archived repo) are or can easily become table stakes. Socket already alerts on deprecated packages, GitHub and Snyk already check licences at PR/scan time, and any of them could add the rest. Do not claim these as unique.

- **It watches the services you run on, not only your packages.** Pricing, free-tier limits, terms, end-of-development notices and acquisitions for hosted services and runtimes (Cloudflare, Vercel, Supabase, Deno). We found no such coverage in GitHub, Snyk or Socket docs.
- **It tells you when something changes, not only when you open a pull request.** Dependabot, dependency review, Snyk and Socket mostly check at PR or scan time. Stackquake polls the sources and emails you when the deal changes, whether or not anyone touched your repo.
- **Every alert quotes the source and says what to do.** The exact line from the vendor's post or pricing page, whether it affects your usage (hosted or self-hosted, commercial or personal), the deadline, and two or three ways out.
- **Independent of any platform.** It can be blunt about any vendor, including GitHub and Microsoft. It works for GitLab users and self-hosters, and you can start with no repo at all.
- **Quiet by design.** Target of about one alert per user per week. It does not do vulnerabilities or routine version bumps; keep using Dependabot or Snyk for those.
- **Catches relicensing that never reaches a scanner.** A project can relicense its repository or announce an end of development with no new registry version, so a manifest scanner has nothing to see until you upgrade. (Landing-page wording should say "often", since this is inferred from how the tools work, not from a tool's statement.)

## Sources

All accessed 2026-10-11.

GitHub
- https://docs.github.com/en/code-security/dependabot/dependabot-alerts/about-dependabot-alerts
- https://docs.github.com/en/code-security/getting-started/github-security-features
- https://docs.github.com/en/code-security/dependabot/ecosystems-supported-by-dependabot/supported-ecosystems-and-repositories
- https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-the-dependency-graph
- https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/dependency-graph-supported-package-ecosystems
- https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-dependency-review
- https://github.com/actions/dependency-review-action

Snyk
- https://docs.snyk.io/scan-fix-and-prevent/scan-with-snyk/snyk-open-source/scan-open-source-libraries-and-licenses/open-source-license-compliance.md
- https://docs.snyk.io/scan-fix-and-prevent/scan-with-snyk/snyk-open-source/scan-open-source-libraries-and-licenses/snyk-license-compliance-management.md
- https://docs.snyk.io/platform-administration/snyk-hierarchy/manage-notifications.md
- https://docs.snyk.io/manage-risk/reporting/dependencies-and-licenses/view-dependencies
- https://snyk.io/blog/dependency-health-assessing-package-risk-with-snyk/
- https://dev.snyk.io/advisor/npm-package/deprecated
- https://costbench.com/software/vulnerability-management/snyk/free-plan/ (third party, unverified)

Socket
- https://socket.dev/alerts/deprecated
- https://socket.dev/pricing
- https://docs.socket.dev/llms.txt
- https://docs.socket.dev/docs/maintenance.md
- https://docs.socket.dev/docs/license.md
- https://docs.socket.dev/docs/license-policy.md
- https://docs.socket.dev/docs/supply-chain-risk.md
- https://docs.socket.dev/docs/organization-alerts.md
- https://docs.socket.dev/docs/notifications.md
- https://docs.socket.dev/docs/slack-alerts.md
- https://docs.socket.dev/docs/language-support

Adjacent
- https://docs.renovatebot.com/key-concepts/dashboard/
- https://docs.renovatebot.com/configuration-options/
- https://github.com/ossf/scorecard/blob/main/docs/checks.md
- https://endoflife.date/
- https://docs.fossa.com/docs/issue-support-docs
- https://docs.mend.io/integrations/latest/view-results-of-your-mend-for-github-sca-scan
- https://www.visualping.io/
- https://www.saaspricepulse.com/blog/how-to-track-saas-pricing
- https://www.saaspricepulse.com/blog/state-of-saas-pricing-q2-2026

## Still unverified (to check before public claims)

- Whether Dependabot/GitHub flags npm-deprecated or PyPI-yanked/inactive packages anywhere (nothing found).
- Whether Socket pushes a notification when an already-merged dependency later becomes deprecated.
- Whether Snyk emails on a licence change in a newly published upstream version before you upgrade.
- Snyk plan tier for licence policy (official page contradicts itself) and the state of Snyk Advisor/package health after the stated January 2026 sunset.
- deps.dev coverage, Mend/FOSSA upstream-licence-change alerts, Snyk Container EOL coverage.
- Which Socket ecosystems actually get deprecated and licence alerts.

## Re-check before launch (2026-10-11, M6)

The quotes used on the landing page were re-read on the live pages in a browser (full page text,
not a summarising fetch):

- GitHub dependency-review-action README: "The dependency review action scans your pull requests
  for dependency changes, and will raise an error if any vulnerabilities or invalid licenses are
  being introduced." Also confirmed: "The action will fail on pull requests that introduce
  dependencies with licenses that do not match the list."
- Socket, Organization Alerts: "Socket currently does not initiate a scan until there is a commit or
  a pull request (PR) containing manifest files that Socket supports." (The earlier quote stopped
  at "(PR)".)
- Snyk, View dependencies (now under scan-fix-and-prevent/prevent/…): "For npm only, a warning icon
  appears next to the package name if a package is deprecated." Confirmed word for word.
- Dependabot alerts (page moved to /code-security/concepts/supply-chain-security/dependabot-alerts):
  now reads "Dependabot alerts help you find and fix vulnerable dependencies before they become
  security risks." The earlier wording above came from the summarising fetch; it is not used publicly.
- **New since the first check:** GitHub "Open source license compliance" (public preview, for
  organisations in an enterprise with GitHub Code Security). It is PR-time policy enforcement:
  "When a pull request changes package manifests, GitHub compares dependency changes between the
  base and pull request branches, evaluates detected licenses against policy, and reports
  violations." It covers transitive dependencies from the dependency graph. Still no alert when an
  existing dependency's licence changes upstream, so the landing page's claims stand.
