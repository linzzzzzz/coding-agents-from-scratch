export type AgentMode = "build" | "plan";

export type PlanState = {
  mode: AgentMode;
  approvedPlan?: string;
};