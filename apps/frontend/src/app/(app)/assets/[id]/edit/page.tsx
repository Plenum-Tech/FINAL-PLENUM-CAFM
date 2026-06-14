import { AssetForm } from "@/features/assets/asset-form";

export default async function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4">
      <AssetForm mode="edit" assetId={id} />
    </main>
  );
}
