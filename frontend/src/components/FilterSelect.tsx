import { ListFilter } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Small dropdown filter used in table toolbars. "all" means no filter. Pass includeAll={false} to use it as a plain form select. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  includeAll = true,
  className,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  includeAll?: boolean;
  className?: string;
  allLabel?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className={cn("soft-filter h-9 w-full min-w-0 capitalize sm:w-[150px]", className)}
        aria-label={label}
      >
        <ListFilter className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {includeAll && <SelectItem value="all">{allLabel ?? `All ${label.toLowerCase()}`}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o} value={o} className="capitalize">
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export const matches = (value: string, filter: string) =>
  filter === "all" || value.toLowerCase() === filter.toLowerCase();
