import { useEffect, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { type DateFilterValue } from "@/components/date-range";
import { cn } from "@/lib/utils";

function dateParam(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function dateLabel(range: DateRange | undefined) {
  if (!range?.from) return "Choose dates";
  if (!range.to || range.from.getTime() === range.to.getTime())
    return format(range.from, "MMM d, yyyy");
  return `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`;
}

export function DateRangeFilter({
  value,
  onChange,
  className,
}: {
  value: DateFilterValue;
  onChange: (value: DateFilterValue) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(() =>
    value.from
      ? {
          from: new Date(`${value.from}T00:00:00`),
          to: value.to ? new Date(`${value.to}T00:00:00`) : undefined,
        }
      : undefined,
  );

  useEffect(() => {
    setDraft(
      value.from
        ? {
            from: new Date(`${value.from}T00:00:00`),
            to: value.to ? new Date(`${value.to}T00:00:00`) : undefined,
          }
        : undefined,
    );
  }, [value.from, value.to]);

  const selectRange = (next: DateRange | undefined) => {
    setDraft(next);
    if (!next?.from || !next.to) return;
    const from = dateParam(next.from);
    const to = dateParam(next.to);
    onChange({
      label: dateLabel(next),
      range: "custom",
      from,
      to,
    });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn("shrink-0", className)}
          aria-label="Filter by date"
          title={value.label}
        >
          <CalendarIcon className="h-4 w-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto max-w-[calc(100vw-1rem)] p-0">
        <Calendar
          mode="range"
          selected={draft}
          onSelect={selectRange}
          numberOfMonths={1}
          captionLayout="dropdown"
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
