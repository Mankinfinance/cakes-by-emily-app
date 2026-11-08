import { requireAdmin } from "@/lib/auth";
import { getRepo } from "@/lib/data";
import { automationMap } from "@/lib/domain/automations";
import { AUTOMATION_KEYS } from "@/lib/domain/types";
import { AutomationsEditor } from "./AutomationsEditor";

export default async function AutomationsPage() {
  await requireAdmin();
  const map = automationMap(await (await getRepo()).listAutomations());
  return (
    <div>
      <h1 className="font-serif text-3xl">Automatic messages</h1>
      <p className="mt-1 text-sm text-muted">
        What customers receive by email without you lifting a finger. Each message is only ever sent once per order. The daily job sends the
        scheduled ones each morning.
      </p>
      <AutomationsEditor automations={AUTOMATION_KEYS.map((k) => map[k])} />
    </div>
  );
}
