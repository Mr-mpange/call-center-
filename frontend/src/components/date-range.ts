export type DateFilterValue = {
  label: string;
  range: "today" | "7d" | "14d" | "month" | "custom";
  from?: string;
  to?: string;
};

export const TODAY_FILTER: DateFilterValue = { label: "Today", range: "today" };
export const FOURTEEN_DAY_FILTER: DateFilterValue = { label: "Last 14 days", range: "14d" };

export function dashboardDateParams(value: DateFilterValue) {
  const params = new URLSearchParams({ range: value.range });
  if (value.range === "custom" && value.from) params.set("from", value.from);
  if (value.range === "custom" && value.to) params.set("to", value.to);
  return params.toString();
}
