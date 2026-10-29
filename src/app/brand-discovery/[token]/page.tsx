import type { Metadata } from "next";
import BrandDiscoveryRespondent from "./BrandDiscoveryRespondent";

export const metadata: Metadata = {
  title: "Guided Brand Discovery | Franchise Kart",
  description: "A guided, one-question-at-a-time business discovery questionnaire.",
  robots: { index: false, follow: false },
};

export default async function BrandDiscoveryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <BrandDiscoveryRespondent token={token} />;
}
