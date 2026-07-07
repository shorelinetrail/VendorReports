'use client';

import { useMemo, useState } from 'react';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { asDate, VISIT_STATUS_LABELS } from '@/lib/labels';
import type { VisitStatus } from '@/types/database';

export interface CalendarEvent {
  id: string;
  date: string;
  title: string;
  subtitle?: string;
  status: VisitStatus;
}

const STATUS_COLORS: Record<VisitStatus, string> = {
  scheduled: 'bg-yellow-400',
  date_confirmed: 'bg-blue-400',
  report_uploaded: 'bg-blue-500',
  recommendations_created: 'bg-purple-400',
  in_review: 'bg-purple-500',
  completed: 'bg-green-500',
  cancelled: 'bg-gray-400',
};

interface CalendarProps {
  events?: CalendarEvent[];
  onDateClick?: (date: Date, events: CalendarEvent[]) => void;
  onEventClick?: (event: CalendarEvent) => void;
  selectedDate?: Date | null;
}

export default function Calendar({ events = [], onDateClick, onEventClick, selectedDate }: CalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const key = format(asDate(event.date), 'yyyy-MM-dd');
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return map;
  }, [events]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    const result: Date[] = [];
    for (let day = start; day <= end; day = addDays(day, 1)) result.push(day);
    return result;
  }, [currentMonth]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900">{format(currentMonth, 'MMMM yyyy')}</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
            aria-label="Previous month"
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setCurrentMonth(new Date())}
            className="rounded-md px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
            aria-label="Next month"
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
          <div key={day} className="bg-gray-50 py-1.5 text-center text-xs font-medium text-gray-500">
            {day}
          </div>
        ))}
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const dayEvents = eventsByDate.get(key) ?? [];
          const inMonth = isSameMonth(day, currentMonth);
          const selected = selectedDate ? isSameDay(day, selectedDate) : false;
          const today = isToday(day);

          return (
            <button
              key={key}
              type="button"
              onClick={() => onDateClick?.(day, dayEvents)}
              aria-label={`${format(day, 'MMMM d, yyyy')}${dayEvents.length ? `, ${dayEvents.length} visits` : ''}`}
              className={`min-h-[72px] p-1 text-left align-top transition-colors ${
                inMonth ? 'bg-white hover:bg-gray-50' : 'bg-gray-50 text-gray-400'
              } ${selected ? 'bg-primary-50 ring-2 ring-inset ring-primary-500' : ''}`}
            >
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                  today ? 'bg-primary-600 font-semibold text-white' : ''
                }`}
              >
                {format(day, 'd')}
              </span>
              <div className="mt-0.5 space-y-0.5">
                {dayEvents.slice(0, 3).map((event) => (
                  <span
                    key={event.id}
                    role="link"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick?.(event);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.stopPropagation();
                        onEventClick?.(event);
                      }
                    }}
                    title={`${event.title} — ${VISIT_STATUS_LABELS[event.status]}`}
                    className={`block truncate rounded px-1 text-[10px] leading-4 text-white ${STATUS_COLORS[event.status]}`}
                  >
                    <span className="hidden sm:inline">{event.title}</span>
                    <span className="sm:hidden">&nbsp;</span>
                  </span>
                ))}
                {dayEvents.length > 3 && (
                  <span className="block px-1 text-[10px] text-gray-500">+{dayEvents.length - 3} more</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {(Object.keys(STATUS_COLORS) as VisitStatus[]).map((status) => (
          <span key={status} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className={`h-2.5 w-2.5 rounded-sm ${STATUS_COLORS[status]}`} />
            {VISIT_STATUS_LABELS[status]}
          </span>
        ))}
      </div>
    </div>
  );
}
