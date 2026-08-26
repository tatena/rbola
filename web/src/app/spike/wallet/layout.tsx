import Providers from "./providers";

export default function WalletSpikeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Providers>{children}</Providers>;
}
