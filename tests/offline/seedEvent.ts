// Seed the EVENT doc through the emulator's rules-bypassing REST endpoint
// (`Bearer owner`). The Phase 1.5 day-scoped board rules gate every
// `days/{dayIndex}/boards/{uid}` write on `events/{id}.days[dayIndex].unlockAt`,
// but a CLIENT can never create the event doc itself — the create rule reads
// the (nonexistent) doc's own `admins`, which errors and denies — so the
// schedule has to be planted the way production does: out-of-band. Shared by
// the offline suites; each calls it against its own isolated demo project.
export async function seedEventDoc(
  projectId: string,
  eventId: string,
  dayCount = 1,
): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  const int = (n: number) => ({ integerValue: String(n) });
  const str = (s: string) => ({ stringValue: s });
  const bool = (b: boolean) => ({ booleanValue: b });
  // Every Day unlocked an hour ago: these suites test offline durability, not
  // the unlock gate, so the time gate must always pass — including when a
  // queued write drains at the END of a slow emulator run.
  const dayVal = (index: number) => ({
    mapValue: {
      fields: {
        index: int(index),
        unlockAt: int(Date.now() - 3_600_000),
        pool: str('main'),
        tutorial: bool(false),
      },
    },
  });
  const res = await fetch(
    `http://${host}/v1/projects/${projectId}/databases/(default)/documents/events/${eventId}`,
    {
      method: 'PATCH',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          name: str('Cruise'),
          status: str('active'),
          admins: { arrayValue: { values: [] } },
          days: {
            arrayValue: { values: Array.from({ length: dayCount }, (_, i) => dayVal(i)) },
          },
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`event seed failed: ${res.status} ${await res.text()}`);
}
