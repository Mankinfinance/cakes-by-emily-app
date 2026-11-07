import { requireAdmin } from "@/lib/auth";
import { getRepo } from "@/lib/data";
import { SettingsEditor } from "./SettingsEditor";

export default async function SettingsPage() {
  await requireAdmin();
  const repo = await getRepo();
  const [settings, daysOff, peaks] = await Promise.all([repo.getSettings(), repo.listDaysOff(), repo.listPeakDates()]);
  return (
    <div>
      <h1 className="font-serif text-3xl">Calendar and settings</h1>
      <SettingsEditor settings={settings} daysOff={daysOff} peaks={peaks} />
    </div>
  );
}
