import { OrganizationDetailsClient } from "./organization-details-client";

export default async function OrganizationDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrganizationDetailsClient organizationId={id} />;
}

