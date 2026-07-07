'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { CalendarDays, X } from 'lucide-react';
import Calendar, { type CalendarEvent } from '@/components/ui/Calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { VISIT_STATUS_LABELS, VISIT_STATUS_VARIANTS } from '@/lib/labels';

export interface CalendarVisitEvent extends CalendarEvent {
  vendorName: string;
  description: string;
}

export default function CalendarSection({ events }: { events: CalendarVisitEvent[] }) {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<CalendarVisitEvent[]>([]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 sm:gap-6">
      <Card className="lg:col-span-2">
        <CardContent className="pt-6">
          <Calendar
            events={events}
            selectedDate={selectedDate}
            onDateClick={(date, dayEvents) => {
              setSelectedDate(date);
              setSelectedEvents(dayEvents as CalendarVisitEvent[]);
            }}
            onEventClick={(event) => router.push(`/visits/${event.id}`)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            {selectedDate ? format(selectedDate, 'EEEE, MMM d, yyyy') : 'Select a Date'}
          </CardTitle>
          {selectedDate && (
            <button
              type="button"
              aria-label="Clear selected date"
              onClick={() => {
                setSelectedDate(null);
                setSelectedEvents([]);
              }}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </CardHeader>
        <CardContent>
          {!selectedDate ? (
            <EmptyState
              icon={CalendarDays}
              title="No date selected"
              description="Click a date in the calendar to see its scheduled visits."
            />
          ) : selectedEvents.length === 0 ? (
            <EmptyState icon={CalendarDays} title="No visits on this date" />
          ) : (
            <div className="space-y-2">
              {selectedEvents.map((event) => (
                <Link
                  key={event.id}
                  href={`/visits/${event.id}`}
                  className="block rounded-lg border border-gray-100 p-3 transition-colors hover:bg-gray-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{event.title}</p>
                      <p className="text-xs text-gray-500">{event.vendorName}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-gray-400">{event.description}</p>
                    </div>
                    <Badge variant={VISIT_STATUS_VARIANTS[event.status]} size="sm">
                      {VISIT_STATUS_LABELS[event.status]}
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
