// Shared return shape for all server actions. Actions never throw for
// expected failures — they return { ok: false } so the UI can toast it.
export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

export const ok = (message?: string): ActionResult => ({ ok: true, message });
export const err = (error: string): ActionResult => ({ ok: false, error });

/** Result of a CSV bulk import. `ok` means every row imported. */
export interface ImportResult {
  ok: boolean;
  success: number;
  failed: number;
  errors: string[];
}
