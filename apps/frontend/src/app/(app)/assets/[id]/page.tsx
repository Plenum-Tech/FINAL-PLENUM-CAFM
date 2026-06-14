import { AssetDetailsClient } from "./asset-details-client";

export default async function AssetDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AssetDetailsClient assetId={id} />;
}

