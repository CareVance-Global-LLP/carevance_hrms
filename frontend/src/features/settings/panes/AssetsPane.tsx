import MyAssetsCard from '@/components/assets/MyAssetsCard';
import SettingsCard from '../components/SettingsCard';
import type { SettingsController } from '../useSettingsController';

/**
 * The kit this person is holding.
 *
 * Not to be confused with the main sidebar's Assets entry, which is the
 * organisation-wide register and is gated on `assets.view`. This is the
 * read-only view of what has been issued to you, and it is ungated because
 * everyone has some.
 *
 * It lived at the bottom of the Profile pane until now, below the timezone
 * picker and under the identity and KYC sections — which is not where anybody
 * looks for their laptop.
 */
export default function AssetsPane({ controller }: { controller: SettingsController }) {
  const { user } = controller;

  return (
    <SettingsCard
      title="Assigned to you"
      description="Company assets currently issued to you. Ask an admin or your manager to update this."
    >
      <MyAssetsCard userId={user?.id} />
    </SettingsCard>
  );
}
