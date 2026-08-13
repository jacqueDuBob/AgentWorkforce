export interface PromptContext {
  ticket: unknown;
  repository?: unknown;
  workspaceInstructions?: string;
  refinementAnswers?: unknown;
  runContext?: unknown;
  requesterEmail?: string;
  domain?: string;
  agentName?: string;
}

export function renderPromptTemplate(template: string, context: PromptContext): string {
  if (!template.trim()) throw new Error("The selected agent prompt is empty.");

  const values: Record<string, string> = {
    ticket: JSON.stringify(context.ticket, null, 2),
    repository: context.repository ? JSON.stringify(context.repository, null, 2) : "No repository selected.",
    workspaceInstructions: context.workspaceInstructions?.trim() || "No workspace instructions configured.",
    refinementAnswers: JSON.stringify(context.refinementAnswers ?? [], null, 2),
    runContext: JSON.stringify(context.runContext ?? {}, null, 2),
    requesterEmail: context.requesterEmail ?? "",
    domain: context.domain ?? "",
    agentName: context.agentName ?? "",
  };

  const unknown = new Set<string>();
  const rendered = template.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, (placeholder, key: string) => {
    if (!(key in values)) {
      unknown.add(placeholder);
      return placeholder;
    }
    return values[key];
  });
  if (unknown.size) throw new Error(`Unknown prompt placeholder${unknown.size === 1 ? "" : "s"}: ${[...unknown].join(", ")}`);
  return rendered.trim();
}
