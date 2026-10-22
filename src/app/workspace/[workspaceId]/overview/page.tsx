/**
 * Workspace / Overview - /workspace/:workspaceId/overview
 * "Needs you" page: cards that need the owner across this workspace
 * (`?view=all` for every workspace), sorted by design-spec §4 severity.
 */
import { InboxPageClient } from "./inbox-page-client";

export async function generateStaticParams() {
  if (process.env.ROUTA_BUILD_STATIC === "1") {
    return [{ workspaceId: "__placeholder__" }];
  }
  return [];
}

export default function WorkspaceOverviewPage() {
  return <InboxPageClient />;
}
