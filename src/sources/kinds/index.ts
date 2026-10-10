import type { SourceKind } from "../../db/schema";
import type { KindHandler } from "../types";
import { eol } from "./eol";
import { feed } from "./feed";
import { github } from "./github";
import { npm } from "./npm";
import { page } from "./page";
import { pypi } from "./pypi";

export const KINDS: Record<SourceKind, KindHandler> = {
  npm,
  pypi,
  github_repo: github,
  eol,
  feed,
  page,
};
