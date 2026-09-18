/**
 * Settings / Fitness - /settings/fitness
 * Compatibility route that forwards fitness configuration requests to the fluency settings surface with preserved repository context.
 */
import { redirect } from "next/navigation";

type SearchParams = {
  workspaceId?: string | string[];
  codebaseId?: string | string[];
  repoPath?: string | string[];
};

export default async function FitnessSettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  const workspaceId = Array.isArray(params.workspaceId)
    ? params.workspaceId[0]
    : params.workspaceId;
  const codebaseId = Array.isArray(params.codebaseId)
    ? params.codebaseId[0]
    : params.codebaseId;
  const repoPath = Array.isArray(params.repoPath)
    ? params.repoPath[0]
    : params.repoPath;

  if (workspaceId) query.set("workspaceId", workspaceId);
  if (codebaseId) query.set("codebaseId", codebaseId);
  if (repoPath) query.set("repoPath", repoPath);

  const suffix = query.toString();
  redirect(suffix ? `/settings/fluency?${suffix}` : "/settings/fluency");
}
