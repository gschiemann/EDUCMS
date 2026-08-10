import { Card, PageHeader } from "@/components/ui";
import AssetForm from "../AssetForm";
import { createAsset } from "../actions";

export const dynamic = "force-dynamic";

export default function NewAssetPage() {
  return (
    <div>
      <PageHeader
        title="Add equipment"
        sub="Tractor, printer, trailer, building — anything worth tracking gets a profile."
      />
      <Card>
        <AssetForm action={createAsset} submitLabel="Save equipment" />
      </Card>
    </div>
  );
}
