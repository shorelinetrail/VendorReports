'use client';

import { useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useAction } from '@/lib/use-action';
import { saveDeadlines } from '@/lib/actions/settings';
import { DEADLINE_DEFAULTS, DEADLINE_META, type DeadlineKey } from '@/lib/config';

export default function SettingsForm({ initial, disabled }: { initial: Record<DeadlineKey, string>; disabled: boolean }) {
  const [values, setValues] = useState(initial);
  const { pending, run } = useAction();

  const keys = Object.keys(DEADLINE_DEFAULTS) as DeadlineKey[];

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveDeadlines(values));
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {keys.map((key) => (
          <Input
            key={key}
            label={DEADLINE_META[key].label}
            name={key}
            type="number"
            min={1}
            max={365}
            required
            disabled={disabled}
            value={values[key]}
            onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            helperText={DEADLINE_META[key].description}
          />
        ))}
      </div>
      {!disabled && (
        <div className="flex justify-end gap-3 border-t pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setValues(
                Object.fromEntries(keys.map((key) => [key, String(DEADLINE_DEFAULTS[key])])) as Record<
                  DeadlineKey,
                  string
                >,
              )
            }
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset to Defaults
          </Button>
          <Button type="submit" loading={pending}>
            <Save className="mr-2 h-4 w-4" />
            Save Settings
          </Button>
        </div>
      )}
    </form>
  );
}
