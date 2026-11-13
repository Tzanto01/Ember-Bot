import { TapLink } from '@/components/auth/busy-button';
import { CrisisLines } from '@/components/moment/crisis-lines';
import { PageHeader } from '@/components/page-header';

/** `/help`, public: crisis lines for the picked region, a door to the moment flow and a way back. */
export default function HelpPage() {
  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Help right now"
        lede="If things feel like too much, a person is there to listen, any time of day."
      />
      <CrisisLines />
      <div className="flex flex-wrap gap-x-6">
        <TapLink to="/moment">Take a moment</TapLink>
        <TapLink to="/">Back to Ember</TapLink>
      </div>
    </div>
  );
}
