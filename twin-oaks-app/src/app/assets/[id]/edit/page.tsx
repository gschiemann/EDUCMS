import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import AssetForm from "../../AssetForm";
import { updateAsset } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditAssetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const asset = await prisma.asset.findUnique({ where: { id } });
  if (!asset) notFound();

  return (
    <div>
      <PageHeader title="Edit equipment" sub={asset.name} />
      <Card>
        <AssetForm action={updateAsset} submitLabel="Save changes" defaults={asset} />
      </Card>
    </div>
  );
}
